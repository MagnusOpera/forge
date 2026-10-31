import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { IPty } from "node-pty";
import {
  TerminalManager,
  terminalEnvironment,
} from "../../electron/main/codex/terminal";
import { git } from "../../electron/main/codex/git";
import { defaultCodexPreferences, type CodexThread } from "../../shared/codex";
import {
  terminalDimensions,
  terminalHeight,
  terminalInputChunks,
  type TerminalEvent,
} from "../../shared/terminal";
const roots: string[] = [],
  managers: TerminalManager[] = [];
afterEach(() => {
  managers.splice(0).forEach((manager) => manager.dispose());
  vi.useRealTimers();
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true }));
});
class FakePty {
  pid = 12345;
  write = vi.fn();
  resize = vi.fn();
  kill = vi.fn();
  pause = vi.fn();
  resume = vi.fn();
  data = new Set<(data: string) => void>();
  exit = new Set<(event: { exitCode: number; signal?: number }) => void>();
  onData(listener: (data: string) => void) {
    this.data.add(listener);
    return { dispose: () => this.data.delete(listener) };
  }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
    this.exit.add(listener);
    return { dispose: () => this.exit.delete(listener) };
  }
  output(data: string) {
    this.data.forEach((listener) => listener(data));
  }
  end(exitCode = 0) {
    this.exit.forEach((listener) => listener({ exitCode }));
  }
}
async function setup(factory?: (...args: any[]) => Promise<IPty> | IPty) {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-terminal-"));
  roots.push(root);
  await git(root, ["init", "-b", "main"]);
  await git(root, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-m",
    "Initial",
  ]);
  const thread: CodexThread = {
    id: randomUUID(),
    repositoryId: "repo",
    title: "Chat",
    archived: false,
    createdAt: "",
    updatedAt: "",
    settings: defaultCodexPreferences,
    state: "idle",
    repositoryPath: root,
    worktree: root,
    branch: "main",
    baseCommit: "HEAD",
    serverId: "",
    items: [],
    requests: [],
    queue: [],
    queuePaused: false,
    draft: "",
    draftAttachments: [],
  };
  const pty = new FakePty(),
    emit = vi.fn<(event: TerminalEvent) => void>(),
    spawn = vi.fn(factory ?? (() => pty as unknown as IPty));
  const manager = new TerminalManager(emit, spawn);
  managers.push(manager);
  return { root, thread, manager, pty, emit, spawn };
}
it("starts in the chat checkout and keeps the same shell and output when hidden", async () => {
  const { thread, manager, pty, spawn, emit } = await setup();
  const first = await manager.open(thread, 80, 24, "first");
  expect(spawn.mock.calls[0]?.[2]).toMatchObject({
    cwd: thread.worktree,
    cols: 80,
    rows: 24,
  });
  vi.useFakeTimers();
  pty.output("visible\r\n");
  vi.advanceTimersByTime(16);
  expect(emit).toHaveBeenCalledWith(
    expect.objectContaining({
      id: thread.id,
      attachmentId: "first",
      data: "visible\r\n",
    }),
  );
  manager.detach(thread, first.sessionId, "first");
  emit.mockClear();
  pty.output("while hidden\r\n");
  vi.advanceTimersByTime(16);
  expect(emit).not.toHaveBeenCalled();
  expect(pty.kill).not.toHaveBeenCalled();
  const restored = await manager.open(thread, 100, 30, "second");
  expect(restored.sessionId).toBe(first.sessionId);
  expect(restored.data).toContain("while hidden");
  expect(spawn).toHaveBeenCalledTimes(1);
  manager.detach(thread, first.sessionId, "first");
  pty.output("new attachment");
  vi.advanceTimersByTime(16);
  expect(emit).toHaveBeenCalledWith(
    expect.objectContaining({ attachmentId: "second", data: "new attachment" }),
  );
});
it("isolates chats and rejects stale sessions and invalid terminal operations", async () => {
  const { thread, manager, pty } = await setup();
  const first = await manager.open(thread, 80, 24);
  expect(() =>
    manager.write({ ...thread, id: randomUUID() }, first.sessionId, "bad"),
  ).toThrow("no longer available");
  expect(() =>
    manager.write({ ...thread, repositoryId: "other" }, first.sessionId, "bad"),
  ).toThrow("no longer available");
  expect(() =>
    manager.write(thread, first.sessionId, "x".repeat(65537)),
  ).toThrow("input");
  expect(() => manager.resize(thread, first.sessionId, 0, 24)).toThrow(
    "dimensions",
  );
  manager.write(thread, first.sessionId, "pwd\r");
  expect(pty.write).toHaveBeenCalledWith("pwd\r");
  manager.resize(thread, first.sessionId, 100, 40);
  expect(pty.resize).toHaveBeenCalledWith(100, 40);
  manager.close(thread, first.sessionId);
  expect(pty.kill).toHaveBeenCalledOnce();
  const next = await manager.open(thread, 80, 24);
  manager.close(thread, first.sessionId);
  expect(manager.has(thread.id)).toBe(true);
  expect(next.sessionId).not.toBe(first.sessionId);
  expect(() => manager.write(thread, first.sessionId, "bad")).toThrow(
    "no longer available",
  );
});
it("applies output backpressure and retains bounded recent output for hidden sessions", async () => {
  const { thread, manager, pty } = await setup();
  const first = await manager.open(thread, 80, 24, "current");
  vi.useFakeTimers();
  pty.output("x".repeat(140000));
  expect(pty.pause).toHaveBeenCalledOnce();
  manager.acknowledge(thread, first.sessionId, 140000, "old");
  expect(pty.resume).not.toHaveBeenCalled();
  manager.acknowledge(thread, first.sessionId, 140000, "current");
  expect(pty.resume).toHaveBeenCalledOnce();
  expect(() => manager.acknowledge(thread, first.sessionId, 140001)).toThrow(
    "acknowledgement",
  );
  manager.detach(thread, first.sessionId, "current");
  pty.output("y".repeat(2 * 1024 * 1024));
  const restored = await manager.open(thread, 80, 24);
  expect(restored.data.length).toBeLessThanOrEqual(1024 * 1024);
});
it("closes a prior session when its checkout changes and cancels a pending start on shutdown", async () => {
  const { root, thread, manager, pty, spawn } = await setup();
  await manager.open(thread, 80, 24);
  const next = path.join(root, "next");
  await git(root, ["worktree", "add", "-b", "next", next]);
  thread.worktree = next;
  thread.branch = "next";
  await manager.open(thread, 80, 24);
  expect(pty.kill).toHaveBeenCalledOnce();
  expect(spawn.mock.calls.at(-1)?.[2]).toMatchObject({ cwd: next });
  let release!: (pty: IPty) => void;
  const pending = await setup(
    () =>
      new Promise<IPty>((resolve) => {
        release = resolve;
      }),
  );
  const opening = pending.manager.open(pending.thread, 80, 24);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  pending.manager.dispose();
  release(pending.pty as unknown as IPty);
  await expect(opening).rejects.toThrow("changed");
  expect(pending.pty.kill).toHaveBeenCalledOnce();
  expect(pending.manager.has(pending.thread.id)).toBe(false);
});
it("records shell exit and ends sessions on app shutdown", async () => {
  const { thread, manager, pty, emit } = await setup();
  const first = await manager.open(thread, 80, 24);
  pty.end(7);
  expect(emit).toHaveBeenCalledWith(
    expect.objectContaining({ exited: true, exitCode: 7 }),
  );
  expect((await manager.open(thread, 80, 24)).exited).toBe(true);
  expect(() => manager.write(thread, first.sessionId, "bad")).toThrow(
    "no longer connected",
  );
  manager.dispose();
  expect(manager.has(thread.id)).toBe(false);
  await expect(manager.open(thread, 80, 24)).rejects.toThrow("quitting");
});
it("does not inherit Forge or Electron secrets, clamps pane sizes, and preserves Unicode paste chunks", () => {
  expect(
    terminalEnvironment({
      HOME: "/home/user",
      PATH: "/bin",
      LANG: "en_US.UTF-8",
      LC_CTYPE: "UTF-8",
      GITHUB_TOKEN: "secret",
      NODE_OPTIONS: "bad",
      ELECTRON_RUN_AS_NODE: "1",
    }),
  ).toEqual({
    HOME: "/home/user",
    PATH: "/bin",
    LANG: "en_US.UTF-8",
    LC_CTYPE: "UTF-8",
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "Forge",
  });
  expect(terminalHeight(1000, 600)).toBe(340);
  expect(terminalHeight(10, 600)).toBe(90);
  expect(terminalHeight(NaN, 600)).toBe(220);
  expect(() => terminalDimensions(501, 24)).toThrow();
  expect(() => terminalDimensions(80, 2.2)).toThrow();
  const input = "a".repeat(32767) + "😀" + "b".repeat(40000),
    chunks = terminalInputChunks(input);
  expect(chunks.join("")).toBe(input);
  expect(chunks.every((chunk) => chunk.length <= 32768)).toBe(true);
  expect(chunks[0]).toHaveLength(32767);
});
it("runs a real PTY with ANSI output, input, window resizing and an orderly exit", async () => {
  const { thread } = await setup();
  let finished!: (value: TerminalEvent) => void;
  const exit = new Promise<TerminalEvent>((resolve) => {
    finished = resolve;
  });
  const events: TerminalEvent[] = [];
  const manager = new TerminalManager((event) => {
    events.push(event);
    if (event.exited) finished(event);
  });
  managers.push(manager);
  const snapshot = await manager.open(thread, 80, 24);
  manager.resize(thread, snapshot.sessionId, 84, 28);
  manager.write(
    thread,
    snapshot.sessionId,
    "printf '\\033[31mFORGE_TERMINAL_OK\\033[0m\\n'; stty size; exit\r",
  );
  const timeout = setTimeout(
    () =>
      finished({
        id: thread.id,
        repositoryId: thread.repositoryId,
        sessionId: snapshot.sessionId,
        attachmentId: snapshot.attachmentId,
        sequence: 0,
        exitCode: -1,
      }),
    5000,
  );
  try {
    expect((await exit).exitCode).toBe(0);
    const output = events.map((event) => event.data ?? "").join("");
    expect(output).toContain("\x1b[31mFORGE_TERMINAL_OK\x1b[0m");
    expect(output).toMatch(/28\s+84/);
  } finally {
    clearTimeout(timeout);
  }
});

it("serializes simultaneous attaches to one shell and ignores the old view's detach", async () => {
  const { thread, manager, pty, spawn, emit } = await setup();
  const [first, second] = await Promise.all([
    manager.open(thread, 80, 24, "old"),
    manager.open(thread, 100, 30, "new"),
  ]);
  expect(first.sessionId).toBe(second.sessionId);
  expect(spawn).toHaveBeenCalledOnce();
  manager.detach(thread, first.sessionId, "old");
  vi.useFakeTimers();
  pty.output("still attached");
  vi.advanceTimersByTime(16);
  expect(emit).toHaveBeenCalledWith(
    expect.objectContaining({ attachmentId: "new", data: "still attached" }),
  );
});

it("delivers Ctrl+C to the foreground job and leaves the shell usable", async () => {
  const { thread } = await setup();
  let finished!: (event: TerminalEvent) => void;
  const exit = new Promise<TerminalEvent>((resolve) => {
    finished = resolve;
  });
  let output = "",
    interrupted = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  let snapshot: { sessionId: string };
  const manager = new TerminalManager((event) => {
    output += event.data ?? "";
    if (!interrupted && output.includes("\x1b[32mFORGE_RUNNING\x1b[0m")) {
      interrupted = true;
      timers.push(
        setTimeout(() => {
          manager.write(thread, snapshot.sessionId, "\x03");
          timers.push(
            setTimeout(
              () =>
                manager.write(
                  thread,
                  snapshot.sessionId,
                  "printf '\\033[32mFORGE_AFTER_INTERRUPT\\033[0m'; exit\r",
                ),
              100,
            ),
          );
        }, 50),
      );
    }
    if (event.exited) finished(event);
  });
  managers.push(manager);
  snapshot = await manager.open(thread, 80, 24);
  manager.write(
    thread,
    snapshot.sessionId,
    "printf '\\033[32mFORGE_RUNNING\\033[0m'; sleep 30\r",
  );
  timers.push(
    setTimeout(
      () =>
        finished({
          id: thread.id,
          repositoryId: thread.repositoryId,
          sessionId: snapshot.sessionId,
          attachmentId: "",
          sequence: 0,
          exitCode: -1,
        }),
      5000,
    ),
  );
  try {
    expect((await exit).exitCode).toBe(0);
    expect(interrupted).toBe(true);
    expect(output).toContain("\x1b[32mFORGE_AFTER_INTERRUPT\x1b[0m");
  } finally {
    timers.forEach(clearTimeout);
  }
});

it("discards the shell and retained output on archive, then starts fresh after restore", async () => {
  const { thread, manager, pty, spawn } = await setup();
  const first = await manager.open(thread, 80, 24);
  manager.detach(thread, first.sessionId, first.attachmentId);
  pty.output("old terminal history");
  thread.archived = true;
  manager.close(thread);
  expect(pty.kill).toHaveBeenCalledOnce();
  expect(manager.has(thread.id)).toBe(false);
  await expect(manager.open(thread, 80, 24)).rejects.toThrow("Restore");
  thread.archived = false;
  const fresh = await manager.open(thread, 80, 24);
  expect(fresh.sessionId).not.toBe(first.sessionId);
  expect(fresh.data).toBe("");
  expect(spawn).toHaveBeenCalledTimes(2);
});

it("opens remote terminals through SSH, reattaches after disconnect, and never treats a remote path as local cwd", async () => {
  const { thread } = await setup();
  thread.environment = {
    id: "remote",
    name: "Linux",
    host: "dev@host",
    executable: "codex",
    tmux: true,
  };
  thread.worktree = "/remote/path with ' quotes";
  const first = new FakePty(),
    second = new FakePty();
  const spawn = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
  const validate = vi.fn(async () => {});
  const manager = new TerminalManager(vi.fn(), spawn, validate);
  managers.push(manager);
  const opened = await manager.open(thread, 80, 24);
  expect(validate).toHaveBeenCalledWith(thread);
  expect(spawn.mock.calls[0][0]).toBe("/usr/bin/ssh");
  expect(spawn.mock.calls[0][1]).toContain("-tt");
  expect(spawn.mock.calls[0][1]).toContain("dev@host");
  expect(spawn.mock.calls[0][1].at(-1)).toContain(
    `tmux new-session -A -s 'forge-${thread.id}'`,
  );
  expect(spawn.mock.calls[0][2].cwd).toBe(os.homedir());
  first.end(255);
  const reattached = await manager.open(thread, 100, 30);
  expect(reattached.sessionId).not.toBe(opened.sessionId);
  expect(reattached.exited).toBe(false);
  expect(spawn).toHaveBeenCalledTimes(2);
  expect(spawn.mock.calls[1][1].at(-1)).toBe(spawn.mock.calls[0][1].at(-1));
  manager.detach(thread, reattached.sessionId);
  expect(second.kill).not.toHaveBeenCalled();
});

it("detaches terminal output ownership during a window handoff without stopping its process", async () => {
  const { thread, manager, pty } = await setup();
  const first = await manager.open(thread, 80, 24, "main-window");
  vi.useFakeTimers();
  pty.output("x".repeat(140000));
  expect(pty.pause).toHaveBeenCalledOnce();
  manager.detachAll([thread.id]);
  expect(pty.resume).not.toHaveBeenCalled();
  manager.detachAll();
  expect(pty.resume).toHaveBeenCalledOnce();
  expect(pty.kill).not.toHaveBeenCalled();
  const moved = await manager.open(thread, 100, 40, "thread-window");
  expect(moved.sessionId).toBe(first.sessionId);
  expect(moved.data).toContain("x".repeat(100));
  expect(moved.attachmentId).toBe("thread-window");
});
