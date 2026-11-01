// @vitest-environment jsdom
import { PaneSurfaceContext } from "../pane-surface";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  defaultCodexPreferences,
  type CodexApi,
  type CodexThreadSummary,
} from "../../shared/codex";
import type { TerminalEvent, TerminalSnapshot } from "../../shared/terminal";
const fake = vi.hoisted(() => ({ terms: [] as any[] }));
vi.mock("ghostty-web", () => ({
  Ghostty: { load: vi.fn(async () => ({ instanceId: crypto.randomUUID() })) },
  Terminal: class {
    cols = 80;
    rows = 24;
    options: any = {};
    textarea = document.createElement("textarea");
    data?: (value: string) => void;
    resized?: (size: { cols: number; rows: number }) => void;
    write = vi.fn((data: string, callback?: () => void) => {
      if (!data.length) throw new RangeError("offset is out of bounds");
      callback?.();
    });
    dispose = vi.fn();
    focus = vi.fn();
    constructor(options: unknown) {
      Object.assign(this.options, options);
      fake.terms.push(this);
    }
    open(element: HTMLElement) {
      element.append(this.textarea);
    }
    loadAddon() {}
    resize(cols: number, rows: number) {
      this.cols = cols;
      this.rows = rows;
    }
    onData(callback: (value: string) => void) {
      this.data = callback;
    }
    onResize(callback: (size: { cols: number; rows: number }) => void) {
      this.resized = callback;
    }
    attachCustomKeyEventHandler() {}
    hasSelection() {
      return false;
    }
  },
  FitAddon: class {
    fit() {}
    observeResize() {}
  },
}));
import { TerminalPanel } from "./terminal-panel";
let container: HTMLDivElement, root: Root;
const request = vi.fn();
const listeners = new Set<(event: TerminalEvent) => void>();
const thread: CodexThreadSummary = {
  id: "chat-a",
  repositoryId: "repo",
  title: "A",
  archived: false,
  createdAt: "",
  updatedAt: "",
  settings: defaultCodexPreferences,
  state: "idle",
  worktree: "/repo/a",
  branch: "codex/a",
  baseCommit: "base",
};
beforeEach(async () => {
  await import("./terminal-engine");
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  Object.defineProperty(container, "clientHeight", { value: 600 });
  document.body.append(container);
  root = createRoot(container);
  listeners.clear();
  fake.terms.length = 0;
  request.mockReset().mockImplementation(async (method, input) =>
    method === "terminalOpen"
      ? ({
          id: input.id,
          repositoryId: input.repositoryId,
          attachmentId: input.attachmentId,
          sessionId: `session-${input.id}`,
          cwd: thread.worktree,
          cols: 80,
          rows: 24,
          data: "history",
          sequence: 7,
          exited: false,
        } satisfies TerminalSnapshot)
      : undefined,
  );
  window.forgeCodex = {
    request,
    onChanged: () => () => {},
    onTerminalEvent: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  } as CodexApi;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  delete window.forgeCodex;
});
it("replays output, routes input and resize to its own session, then detaches without closing on navigation", async () => {
  await act(async () =>
    root.render(
      <TerminalPanel thread={thread} theme="light" onHide={() => {}} />,
    ),
  );
  const term = fake.terms[0];
  expect(term.write).toHaveBeenNthCalledWith(1, "\x1bc");
  expect(term.write).toHaveBeenCalledWith("history", expect.any(Function));
  expect(request).toHaveBeenCalledWith(
    "terminalOpen",
    expect.objectContaining({ id: thread.id, cols: 80, rows: 24 }),
  );
  await act(async () => term.data("pwd\r"));
  expect(request).toHaveBeenCalledWith("terminalWrite", {
    repositoryId: "repo",
    id: thread.id,
    sessionId: "session-chat-a",
    data: "pwd\r",
  });
  await act(async () => term.resized({ cols: 100, rows: 30 }));
  expect(request).toHaveBeenCalledWith(
    "terminalResize",
    expect.objectContaining({ id: thread.id, cols: 100, rows: 30 }),
  );
  const open = request.mock.calls.find(
    ([method]) => method === "terminalOpen",
  )![1];
  const emit = (event: Partial<TerminalEvent>) =>
    listeners.forEach((listener) =>
      listener({
        repositoryId: "repo",
        id: thread.id,
        sessionId: "session-chat-a",
        attachmentId: open.attachmentId,
        sequence: 10,
        data: "new",
        ...event,
      }),
    );
  act(() => emit({ id: "other" }));
  expect(term.write).toHaveBeenCalledTimes(2);
  await act(async () => emit({}));
  expect(term.write).toHaveBeenLastCalledWith("new", expect.any(Function));
  await act(async () =>
    root.render(
      <TerminalPanel
        key="b"
        thread={{ ...thread, id: "chat-b", worktree: "/repo/b" }}
        theme="dark"
        onHide={() => {}}
      />,
    ),
  );
  expect(request).toHaveBeenCalledWith(
    "terminalDetach",
    expect.objectContaining({
      id: "chat-a",
      sessionId: "session-chat-a",
      attachmentId: open.attachmentId,
    }),
  );
  expect(
    request.mock.calls.some(([method]) => method === "terminalClose"),
  ).toBe(false);
  expect(term.dispose).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledWith(
    "terminalOpen",
    expect.objectContaining({ id: "chat-b" }),
  );
});
it("hides without killing, ends explicitly and exposes keyboard resizing", async () => {
  const hide = vi.fn();
  await act(async () =>
    root.render(<TerminalPanel thread={thread} theme="light" onHide={hide} />),
  );
  const splitter = container.querySelector<HTMLElement>('[role="separator"]')!;
  expect(splitter.getAttribute("aria-valuenow")).toBe("220");
  act(() =>
    splitter.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    ),
  );
  expect(splitter.getAttribute("aria-valuenow")).toBe("240");
  act(() =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Hide terminal"]')!
      .click(),
  );
  expect(hide).toHaveBeenCalledOnce();
  expect(
    request.mock.calls.some(([method]) => method === "terminalClose"),
  ).toBe(false);
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="End terminal session"]')!
      .click(),
  );
  expect(request).toHaveBeenCalledWith("terminalClose", {
    repositoryId: "repo",
    id: thread.id,
    sessionId: "session-chat-a",
  });
  expect(hide).toHaveBeenCalledTimes(2);
});

it("reconnects the terminal view on theme changes without ending the shell", async () => {
  await act(async () =>
    root.render(
      <TerminalPanel thread={thread} theme="light" onHide={() => {}} />,
    ),
  );
  const first = fake.terms[0];
  await act(async () =>
    root.render(
      <TerminalPanel thread={thread} theme="dark" onHide={() => {}} />,
    ),
  );
  expect(first.dispose).toHaveBeenCalledOnce();
  expect(fake.terms).toHaveLength(2);
  expect(fake.terms[0].options.ghostty).toBeDefined();
  expect(fake.terms[1].options.ghostty).not.toBe(fake.terms[0].options.ghostty);
  expect(
    request.mock.calls.filter(([method]) => method === "terminalOpen"),
  ).toHaveLength(2);
  expect(
    request.mock.calls.some(([method]) => method === "terminalClose"),
  ).toBe(false);
  expect(fake.terms[1].write).toHaveBeenNthCalledWith(1, "\x1bc");
});

it("detaches while the window is hidden and reconnects on visibility without killing commands", async () => {
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  try {
    await act(async () =>
      root.render(
        <TerminalPanel thread={thread} theme="light" onHide={() => {}} />,
      ),
    );
    hidden.mockReturnValue(true);
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect(request).toHaveBeenCalledWith(
      "terminalDetach",
      expect.objectContaining({ id: thread.id }),
    );
    hidden.mockReturnValue(false);
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect(
      request.mock.calls.filter(([method]) => method === "terminalOpen"),
    ).toHaveLength(2);
    expect(
      request.mock.calls.some(([method]) => method === "terminalClose"),
    ).toBe(false);
  } finally {
    hidden.mockRestore();
  }
});

it("connects a new shell with an empty initial buffer and accepts its later prompt and input", async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (method, input) => {
    const result = await original(method, input);
    return method === "terminalOpen"
      ? { ...result, data: "", sequence: 0 }
      : result;
  });
  await act(async () =>
    root.render(
      <TerminalPanel thread={thread} theme="light" onHide={() => {}} />,
    ),
  );
  const term = fake.terms[0];
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).not.toContain("Starting terminal");
  expect(term.options.disableStdin).toBe(false);
  expect(term.write).not.toHaveBeenCalledWith("", expect.anything());
  const input = request.mock.calls.find(
    ([method]) => method === "terminalOpen",
  )![1];
  await act(async () =>
    listeners.forEach((listener) =>
      listener({
        repositoryId: thread.repositoryId,
        id: thread.id,
        sessionId: "session-chat-a",
        attachmentId: input.attachmentId,
        sequence: 8,
        data: "shell % ",
      }),
    ),
  );
  expect(term.write).toHaveBeenLastCalledWith("shell % ", expect.any(Function));
  await act(async () => term.data("pwd\r"));
  expect(request).toHaveBeenCalledWith(
    "terminalWrite",
    expect.objectContaining({ sessionId: "session-chat-a", data: "pwd\r" }),
  );
});

it("changes terminal renderers with the pane window while preserving the running session", async () => {
  const frame = document.createElement("iframe");document.body.append(frame);
  const child = frame.contentWindow!;
  const load = vi.fn(async () => (await import("./terminal-engine")).loadTerminalEngine());
  child.forgeContentTerminalEngine = load;
  const render = (target: Window) => act(async () => {
    root.render(<PaneSurfaceContext.Provider value={{ window: target, document: target.document, portalRoot: null }}><TerminalPanel thread={thread} theme="light" onHide={() => {}} /></PaneSurfaceContext.Provider>);
  });
  try {
    await render(window);
    await vi.waitFor(() => expect(request.mock.calls.some(([method]) => method === "terminalOpen")).toBe(true));
    await render(child);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(request.mock.calls.filter(([method]) => method === "terminalOpen")).toHaveLength(2));
    expect(request.mock.calls.some(([method]) => method === "terminalClose")).toBe(false);
    expect(fake.terms.at(-1).write).toHaveBeenCalledWith("history", expect.any(Function));
    await render(window);
    await vi.waitFor(() => expect(request.mock.calls.filter(([method]) => method === "terminalOpen")).toHaveLength(3));
    expect(request.mock.calls.some(([method]) => method === "terminalClose")).toBe(false);
  } finally {
    await act(async () => root.render(null));frame.remove();
  }
});
