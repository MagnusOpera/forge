import {
  codexQuickActionPrompt,
  type CodexQuickAction,
} from "../../shared/codexActions";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  appendFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  CodexClient,
  type CodexTransport,
  type RpcEvent,
} from "../../electron/main/codex/client";
import { CodexStore, recoverThread } from "../../electron/main/codex/store";
import {
  createWorktree,
  git,
  inspectRepository,
  gitInfo,
} from "../../electron/main/codex/git";
import { ThreadManager } from "../../electron/main/codex/threads";
import { reduceCodexEvent } from "../../electron/main/codex/events";
import {
  defaultCodexPreferences,
  type CodexMessage,
  type CodexModel,
  type CodexThread,
  type JsonObject,
} from "../../shared/codex";
const temporary: string[] = [];
const clients: CodexClient[] = [];
const managers: ThreadManager[] = [];
function directory() {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-test-"));
  temporary.push(root);
  return root;
}
afterEach(() => {
  managers.splice(0).forEach((m) => m.flush());
  clients.splice(0).forEach((c) => c.stop());
  temporary
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true }));
});
const models: CodexModel[] = [
  {
    id: "test-model",
    name: "Test model",
    isDefault: true,
    efforts: ["medium", "high"],
    defaultEffort: "medium",
    fast: true,
    images: true,
  },
];
function makeThread(): CodexThread {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    repositoryId: "R_123",
    title: "Thread",
    archived: false,
    createdAt: now,
    updatedAt: now,
    settings: {
      ...defaultCodexPreferences,
      model: "test-model",
      effort: "medium",
    },
    state: "idle",
    repositoryPath: "",
    serverId: "server-thread",
    worktree: "",
    branch: "",
    baseCommit: "",
    items: [],
    requests: [],
    queue: [],
    queuePaused: false,
    draft: "saved draft",
    draftAttachments: [],
  };
}
const message = (value = "Implement the fix"): CodexMessage => ({
  id: randomUUID(),
  text: value,
  attachments: [],
});
class FakeTransport implements CodexTransport {
  onEvent = (_event: RpcEvent) => {};
  calls: { method: string; params: JsonObject }[] = [];
  responses: { id: string | number; result: JsonObject }[] = [];
  failSteer = false;
  turn = 0;
  nextThread = 0;
  hook?: (method: string, params: JsonObject) => Promise<void>;
  async start() {}
  stop() {}
  async request(method: string, params: JsonObject): Promise<unknown> {
    this.calls.push({ method, params });
    await this.hook?.(method, params);
    if (method === "account/read")
      return { account: { email: "test@example.invalid" } };
    if (method === "thread/start")
      return { thread: { id: `server-thread-${++this.nextThread}` } };
    if (method === "turn/start") {
      ++this.turn;
      return { turn: { id: `turn-${this.turn}` } };
    }
    if (method === "turn/steer" && this.failSteer)
      throw new Error("No active turn");
    return {};
  }
  respond(id: string | number, result: JsonObject) {
    this.responses.push({ id, result });
  }
  rejectRequest(id: string | number) {
    this.responses.push({ id, result: { rejected: true } });
  }
  emit(method: string, params: JsonObject, requestId?: string | number) {
    this.onEvent({ method, params, requestId });
  }
}
async function repository() {
  const root = directory();
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Forge test"]);
  await git(root, ["config", "user.email", "forge@example.invalid"]);
  writeFileSync(path.join(root, "file.txt"), "committed\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "initial"]);
  return root;
}
async function setup() {
  const root = directory(),
    repo = await repository(),
    store = new CodexStore(root),
    client = new FakeTransport();
  store.configuration.projects.R_123 = {
    repositoryId: "R_123",
    path: repo,
    overrides: {},
  };
  const manager = new ThreadManager(
    store,
    client,
    async () => models,
    vi.fn(),
    () => "attachment.png",
  );
  managers.push(manager);
  const summary = await manager.create("R_123"),
    thread = store.get("R_123", summary.id);
  return { store, client, manager, thread, repo };
}
describe("Codex events and persistence", () => {
  it("keeps the full transcript, reconciles streamed completion and paginates", () => {
    const thread = makeThread();
    for (let index = 0; index < 250; index++)
      reduceCodexEvent(thread, {
        method: "item/completed",
        params: {
          item: {
            id: String(index),
            type: "agentMessage",
            text: "x".repeat(33_000),
          },
        },
      });
    reduceCodexEvent(thread, {
      method: "item/agentMessage/delta",
      params: { itemId: "stream", delta: "Hello" },
    });
    reduceCodexEvent(thread, {
      method: "item/completed",
      params: {
        item: { id: "stream", type: "agentMessage", text: "Hello world" },
      },
    });
    expect(thread.items).toHaveLength(251);
    expect(thread.items[0].text).toHaveLength(33_000);
    expect(thread.items.at(-1)?.text).toBe("Hello world");
    const store = new CodexStore(directory()),
      manager = new ThreadManager(
        store,
        new FakeTransport(),
        async () => models,
        () => {},
        () => "",
      );
    managers.push(manager);
    store.threads.set(thread.id, thread);
    store.saveThread(thread);
    const page = manager.page(thread);
    expect(page.thread.items).toHaveLength(100);
    expect(page.before).toBe(151);
    expect(manager.page(thread, page.before!).thread.items).toHaveLength(100);
    const reloaded = new CodexStore(store.root);
    expect(reloaded.get(thread.repositoryId, thread.id).items).toHaveLength(
      251,
    );
  });
  it("recovers complete journal entries after a partial append", () => {
    const store = new CodexStore(directory()),
      thread = makeThread();
    thread.items.push({
      id: "message",
      kind: "agentMessage",
      text: "Preserved",
    });
    store.threads.set(thread.id, thread);
    store.saveThread(thread);
    const history = path.join(
      store.root,
      "threads",
      `${thread.id}.items.jsonl`,
    );
    appendFileSync(history, '{"id":"incomplete');
    const recovered = new CodexStore(store.root).get(
      thread.repositoryId,
      thread.id,
    );
    expect(recovered.items).toEqual(thread.items);
    expect(readFileSync(history, "utf8").endsWith("\n")).toBe(true);
    recovered.items[0].text += " and updated";
    const next = new CodexStore(store.root);
    next.threads.set(thread.id, recovered);
    next.saveThread(recovered);
    expect(
      new CodexStore(store.root).get(thread.repositoryId, thread.id).items[0]
        .text,
    ).toBe("Preserved and updated");
  });
  it("records structured execution plans", () => {
    const thread = makeThread();
    thread.turnId = "turn-1";
    reduceCodexEvent(thread, {
      method: "turn/plan/updated",
      params: {
        turnId: "turn-1",
        explanation: "Implementation plan",
        plan: [
          { step: "Inspect", status: "completed" },
          { step: "Implement", status: "inProgress" },
        ],
      },
    });
    expect(thread.items[0]).toMatchObject({
      kind: "plan",
      text: "Implementation plan\n- [x] Inspect\n- [ ] Implement (in progress)",
    });
  });
  it("preserves streamed command output when the final aggregate is shorter", () => {
    const thread = makeThread();
    reduceCodexEvent(thread, {
      method: "item/started",
      params: {
        item: { id: "cmd", type: "commandExecution", command: "npm test" },
      },
    });
    reduceCodexEvent(thread, {
      method: "item/commandExecution/outputDelta",
      params: { itemId: "cmd", delta: "full output\n".repeat(5000) },
    });
    reduceCodexEvent(thread, {
      method: "item/completed",
      params: {
        item: {
          id: "cmd",
          type: "commandExecution",
          command: "npm test",
          aggregatedOutput: "truncated",
          status: "completed",
        },
      },
    });
    expect(thread.items[0].text.startsWith("npm test\nfull output")).toBe(true);
    expect(thread.items[0].text.length).toBeGreaterThan(32000);
  });
  it("retains drafts and pauses queued messages while clearing stale requests on restart", () => {
    const thread = makeThread();
    thread.state = "waiting";
    thread.turnId = "old-turn";
    thread.requests = [
      { id: 9, method: "item/tool/requestUserInput", params: {} },
    ];
    thread.queue = [message()];
    const recovered = recoverThread(thread);
    expect(recovered).toMatchObject({
      state: "interrupted",
      requests: [],
      queuePaused: true,
      draft: "saved draft",
    });
    expect(recovered.queue).toHaveLength(1);
    expect(recovered.turnId).toBeUndefined();
  });
  it("does not render private reasoning and does deduplicate questions", () => {
    const thread = makeThread();
    reduceCodexEvent(thread, {
      method: "item/completed",
      params: { item: { id: "secret", type: "reasoning", text: "private" } },
    });
    const question = {
      method: "item/tool/requestUserInput",
      params: {
        questions: [
          {
            id: "q",
            question: "Which?",
            options: [{ label: "A", description: "Choice A" }],
          },
        ],
      },
      requestId: 1,
    };
    reduceCodexEvent(thread, question);
    reduceCodexEvent(thread, question);
    expect(thread.items).toHaveLength(0);
    expect(thread.requests).toHaveLength(1);
    expect(thread.state).toBe("waiting");
    reduceCodexEvent(thread, {
      method: "serverRequest/resolved",
      params: { requestId: 1 },
    });
    expect(thread.state).toBe("running");
  });
});
describe("isolated worktrees", () => {
  it("starts concurrent worktrees from committed HEAD and accepts linked worktrees", async () => {
    const repo = await repository(),
      root = directory();
    writeFileSync(path.join(repo, "file.txt"), "uncommitted\n");
    const [a, b] = await Promise.all([
      createWorktree(repo, root, randomUUID()),
      createWorktree(repo, root, randomUUID()),
    ]);
    expect(a.branch).not.toBe(b.branch);
    expect(a.baseCommit).toBe(b.baseCommit);
    expect(readFileSync(path.join(a.worktree, "file.txt"), "utf8")).toBe(
      "committed\n",
    );
    expect((await inspectRepository(repo, "owner/repo")).dirty).toBe(true);
    expect((await inspectRepository(a.worktree, "owner/repo")).path).toBe(
      realpathSync(a.worktree),
    );
    await git(repo, [
      "remote",
      "add",
      "origin",
      "git@github.com:owner/repo.git",
    ]);
    expect(
      (await inspectRepository(repo, "owner/repo")).warning,
    ).toBeUndefined();
    expect((await inspectRepository(repo, "another/repo")).warning).toContain(
      "does not match",
    );
  });
  it("rejects repositories without a committed HEAD and invalid IDs", async () => {
    const repo = directory();
    await git(repo, ["init"]);
    await expect(inspectRepository(repo, "owner/repo")).rejects.toThrow();
    await expect(
      createWorktree(repo, directory(), "../../escape"),
    ).rejects.toThrow("Invalid");
  });
});
describe("thread lifecycle", () => {
  it("snapshots project preferences, retains original folder, and enforces ownership", async () => {
    const { store, manager, thread } = await setup();
    store.configuration.defaults.effort = "high";
    store.configuration.projects.R_123.path = "/other";
    expect(thread.settings.effort).toBe("medium");
    expect(thread.repositoryPath).not.toBe("/other");
    expect(() => store.get("another", thread.id)).toThrow("does not belong");
    expect(await manager.create("R_123")).toMatchObject({
      settings: { effort: "high" },
    });
  });
  it("streams while running, queues in order, and dispatches exactly once after successful completion", async () => {
    const { manager, client, thread } = await setup();
    await manager.send(thread, message());
    thread.settings.followUp = "queue";
    await manager.send(thread, message("second"));
    await manager.send(thread, message("third"));
    expect(thread.queue.map((m) => m.text)).toEqual(["second", "third"]);
    client.emit("turn/completed", {
      threadId: thread.serverId,
      turn: { id: "turn-1", status: "completed" },
    });
    await vi.waitFor(() => expect(client.turn).toBe(2));
    expect(thread.queue.map((m) => m.text)).toEqual(["third"]);
    // A late duplicate completion from the first turn cannot finish the second turn.
    client.emit("turn/completed", {
      threadId: thread.serverId,
      turn: { id: "turn-1", status: "completed" },
    });
    expect(thread.state).toBe("running");
    expect(client.turn).toBe(2);
  });
  it("preserves the draft when steering races with completion", async () => {
    const { manager, client, thread } = await setup();
    await manager.send(thread, message());
    thread.draft = "correction";
    client.failSteer = true;
    await expect(manager.send(thread, message("correction"))).rejects.toThrow(
      "No active turn",
    );
    expect(thread.draft).toBe("correction");
    expect(client.calls.filter((c) => c.method === "turn/start")).toHaveLength(
      1,
    );
    expect(
      client.calls.find((c) => c.method === "turn/steer")?.params
        .expectedTurnId,
    ).toBe("turn-1");
  });
  it("does not resend a queued message when start is accepted but its RPC response is lost", async () => {
    const { manager, client, thread } = await setup();
    await manager.send(thread, message());
    thread.settings.followUp = "queue";
    await manager.send(thread, message("queued"));
    client.hook = async (method) => {
      if (method === "turn/start") {
        client.emit("turn/started", {
          threadId: thread.serverId,
          turn: { id: "turn-2" },
        });
        throw new Error("RPC response timed out");
      }
    };
    client.emit("turn/completed", {
      threadId: thread.serverId,
      turn: { id: "turn-1", status: "completed" },
    });
    await vi.waitFor(() => expect(thread.queuePaused).toBe(true));
    expect(thread.queue).toHaveLength(0);
    expect(thread.state).toBe("running");
    expect(thread.turnId).toBe("turn-2");
  });
  it("does not overlap a server turn discovered while resuming after an uncertain failure", async () => {
    const { manager, client, thread } = await setup();
    await manager.send(thread, message());
    client.emit("connection/failed", { message: "Disconnected" });
    const original = client.request.bind(client);
    client.request = async (method, params) =>
      method === "thread/resume"
        ? { thread: { turns: [{ id: "still-active", status: "inProgress" }] } }
        : original(method, params);
    await expect(manager.send(thread, message("retry"))).rejects.toThrow(
      "still has an active turn",
    );
    expect(thread.turnId).toBe("still-active");
    expect(thread.state).toBe("running");
    expect(client.turn).toBe(1);
  });
  it("pauses queues on Stop and failure and resumes only explicitly", async () => {
    const { manager, client, thread } = await setup();
    await manager.send(thread, message());
    thread.settings.followUp = "queue";
    await manager.send(thread, message("second"));
    await manager.stop(thread);
    expect(thread.queuePaused).toBe(true);
    client.emit("turn/completed", {
      threadId: thread.serverId,
      turn: { id: "turn-1", status: "interrupted" },
    });
    expect(client.turn).toBe(1);
    expect(thread.state).toBe("interrupted");
    manager.queue(thread, "resume");
    await vi.waitFor(() => expect(client.turn).toBe(2));
    client.emit("turn/completed", {
      threadId: thread.serverId,
      turn: {
        id: "turn-2",
        status: "failed",
        error: { message: "Model failed" },
      },
    });
    expect(thread.queuePaused).toBe(true);
    expect(thread.error).toBe("Model failed");
  });
  it("answers questions once, rejects stale answers, and handles permissions", async () => {
    const { manager, client, thread } = await setup();
    await manager.send(thread, message());
    client.emit(
      "item/tool/requestUserInput",
      {
        threadId: thread.serverId,
        turnId: "turn-1",
        questions: [{ id: "q", question: "Which option?", options: [] }],
      },
      42,
    );
    await expect(manager.answer(thread, 42, {})).rejects.toThrow(
      "Answer every",
    );
    await manager.answer(thread, 42, { q: "A" });
    expect(client.responses.at(-1)).toEqual({
      id: 42,
      result: { answers: { q: { answers: ["A"] } } },
    });
    await expect(manager.answer(thread, 42, { q: "B" })).rejects.toThrow(
      "no longer pending",
    );
    thread.settings.mode = "plan"; // Applies to the next turn only.
    client.emit(
      "item/permissions/requestApproval",
      {
        threadId: thread.serverId,
        turnId: "turn-1",
        permissions: { network: { enabled: true } },
      },
      "permission",
    );
    await manager.answer(thread, "permission", undefined, true);
    expect(client.responses.at(-1)?.result).toEqual({
      permissions: { network: { enabled: true } },
      scope: "turn",
    });
    thread.settings.permissions = "strict";
    thread.activeSettings = { ...thread.settings };
    client.emit(
      "item/commandExecution/requestApproval",
      { threadId: thread.serverId, turnId: "turn-1", command: "restricted" },
      43,
    );
    await expect(manager.answer(thread, 43, undefined, true)).rejects.toThrow(
      "does not allow",
    );
    await manager.answer(thread, 43, undefined, false);
    expect(client.responses.at(-1)?.result).toEqual({ decision: "decline" });
  });
  it("retains worktrees on archive and refuses missing server threads without replacement", async () => {
    const { manager, client, thread } = await setup();
    await manager.send(thread, message());
    client.emit("turn/completed", {
      threadId: thread.serverId,
      turn: { id: "turn-1", status: "completed" },
    });
    const worktree = thread.worktree;
    manager.update(thread, { archived: true });
    expect(thread.worktree).toBe(worktree);
    await expect(manager.send(thread, message())).rejects.toThrow("Restore");
    manager.update(thread, { archived: false });
    client.hook = async (method) => {
      if (method === "thread/resume") throw new Error("Thread not found");
    };
    await expect(manager.send(thread, message())).rejects.toThrow(
      "Thread not found",
    );
    expect(
      client.calls.filter((c) => c.method === "thread/start"),
    ).toHaveLength(1);
    expect(thread.worktree).toBe(worktree);
  });
  it("requires restoration before an archived queue can run", async () => {
    const { manager, thread } = await setup();
    thread.queue = [message("queued")];
    thread.queuePaused = true;
    manager.update(thread, { archived: true });
    expect(() => manager.queue(thread, "resume")).toThrow("Restore");
    expect(thread.queue).toHaveLength(1);
  });
  it("replays missed server history on explicit resume", async () => {
    const { manager, client, thread } = await setup();
    await manager.send(thread, message());
    client.emit("connection/failed", { message: "Disconnected" });
    const original = client.request.bind(client);
    client.request = async (method, params) =>
      method === "thread/resume"
        ? {
            thread: {
              turns: [
                {
                  id: "turn-1",
                  status: "completed",
                  items: [
                    {
                      id: "recovered",
                      type: "agentMessage",
                      text: "Recovered after disconnect",
                    },
                  ],
                },
              ],
            },
          }
        : original(method, params);
    await manager.send(thread, message("continue"));
    expect(thread.items.find((item) => item.id === "recovered")?.text).toBe(
      "Recovered after disconnect",
    );
  });
  it("can stop while preparing a turn without starting execution", async () => {
    const { manager, client, thread } = await setup();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    client.hook = async (method) => {
      if (method === "account/read") await held;
    };
    const sending = manager.send(thread, message());
    const outcome = expect(sending).rejects.toThrow("interrupted");
    await manager.stop(thread);
    release();
    await outcome;
    expect(thread.state).toBe("interrupted");
    expect(thread.queuePaused).toBe(true);
    expect(client.calls.some((call) => call.method === "turn/start")).toBe(
      false,
    );
  });
  it.each(["commit", "push", "create-pr"] as CodexQuickAction[])(
    "sends %s as a normal Codex message without losing drafts",
    async (action) => {
      const { manager, thread, client } = await setup();
      await manager.send(thread, message("prepare"));
      client.emit("turn/completed", {
        threadId: thread.serverId,
        turn: { id: thread.turnId, status: "completed" },
      });
      thread.draft = "My unfinished prompt";
      thread.draftAttachments = [{ id: "image-id", name: "reference.png" }];
      const settings = { ...thread.settings };
      await manager.quickAction(thread, action);
      const call = client.calls
        .filter((entry) => entry.method === "turn/start")
        .at(-1)!;
      expect(call.params.input).toEqual([
        {
          type: "text",
          text: codexQuickActionPrompt(action),
          text_elements: [],
        },
      ]);
      expect(thread.draft).toBe("My unfinished prompt");
      expect(thread.draftAttachments).toHaveLength(1);
      expect(thread.settings).toEqual(settings);
    },
  );
  it("rejects Git actions while running, in Plan, when archived, or with queued work", async () => {
    const { manager, thread, client } = await setup();
    await expect(manager.quickAction(thread, "commit")).rejects.toThrow(
      "worktree",
    );
    await manager.send(thread, message("prepare"));
    await expect(manager.quickAction(thread, "commit")).rejects.toThrow(
      "current turn",
    );
    client.emit("turn/completed", {
      threadId: thread.serverId,
      turn: { id: thread.turnId, status: "completed" },
    });
    thread.settings.mode = "plan";
    await expect(manager.quickAction(thread, "push")).rejects.toThrow(
      "Implement",
    );
    thread.settings.mode = "implement";
    thread.archived = true;
    await expect(manager.quickAction(thread, "push")).rejects.toThrow(
      "Restore",
    );
    thread.archived = false;
    thread.queue = [message("pending")];
    await expect(manager.quickAction(thread, "create-pr")).rejects.toThrow(
      "queued messages",
    );
  });
  it("reviews committed, staged, unstaged and untracked worktree changes against the thread base", async () => {
    const { manager, thread } = await setup();
    await manager.send(thread, message("prepare"));
    writeFileSync(path.join(thread.worktree, "file.txt"), "committed change\n");
    await git(thread.worktree, ["add", "file.txt"]);
    await git(thread.worktree, ["commit", "-m", "Thread change"]);
    writeFileSync(path.join(thread.worktree, "staged.txt"), "staged\n");
    await git(thread.worktree, ["add", "staged.txt"]);
    writeFileSync(
      path.join(thread.worktree, "file.txt"),
      "committed change\nunstaged change\n",
    );
    writeFileSync(path.join(thread.worktree, "untracked.txt"), "new file\n");
    const info = await gitInfo(thread);
    expect(info.diff).toContain("+committed change");
    expect(info.diff).toContain("+unstaged change");
    expect(info.diff).toContain("staged.txt");
    expect(info.untracked).toContainEqual({
      path: "untracked.txt",
      text: "new file\n",
    });
  });
  it("keeps simultaneous project threads and their questions independent", async () => {
    const { manager, client, thread, store } = await setup();
    const second = store.get("R_123", (await manager.create("R_123")).id);
    await Promise.all([
      manager.send(thread, message("first")),
      manager.send(second, message("second")),
    ]);
    expect(thread.serverId).not.toBe(second.serverId);
    expect(thread.worktree).not.toBe(second.worktree);
    client.emit(
      "item/tool/requestUserInput",
      {
        threadId: second.serverId,
        turnId: second.turnId,
        questions: [{ id: "q", question: "Second only" }],
      },
      "second-question",
    );
    expect(second.state).toBe("waiting");
    expect(thread.state).toBe("running");
    expect(thread.requests).toHaveLength(0);
    await manager.stop(thread);
    expect(client.calls.at(-1)?.params.threadId).toBe(thread.serverId);
    expect(second.requests).toHaveLength(1);
  });
  it("marks active threads interrupted and clears pending requests on process exit", async () => {
    const { manager, client, thread } = await setup();
    await manager.send(thread, message());
    client.emit("connection/failed", { message: "Process exited" });
    expect(thread).toMatchObject({
      state: "interrupted",
      requests: [],
      queuePaused: true,
      error: "Process exited",
    });
  });
});
function fakeExecutable(root: string): string {
  const executable = path.join(root, "fake-codex.cjs");
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const fs = require('node:fs'); const path = require('node:path');
if (process.argv.includes('--version')) { console.log('codex-cli test'); process.exit(0); }
if (process.argv.includes('generate-json-schema')) { fs.writeFileSync(path.join(process.argv[process.argv.indexOf('--out') + 1], 'ClientRequest.json'), JSON.stringify(['thread/start','thread/resume','turn/start','turn/steer','turn/interrupt','model/list','collaborationMode/list','account/login/start'])); process.exit(0); }
require('node:readline').createInterface({input: process.stdin}).on('line', line => {
 const m = JSON.parse(line); if (!m.id) return;
 if (m.method === 'hang') return;
 if (m.method === 'exit') return process.exit(3);
 if (m.method === 'bad') { console.log('not JSON'); console.log(JSON.stringify({ id: m.id, error: {message: 'RPC failed'} })); return; }
 if (m.method === 'question') console.log(JSON.stringify({id:'server-42',method:'item/tool/requestUserInput',params:{threadId:'thread',questions:[]}}));
 console.log(JSON.stringify({id:m.id,result:m.method==='account/read'?{account:null}:{ok:true}}));
});\n`,
    { mode: 0o700 },
  );
  return executable;
}
describe("stdio app-server transport", () => {
  it("initializes, ignores malformed data, routes questions and rejects RPC errors", async () => {
    const root = directory(),
      client = new CodexClient(
        path.join(root, "home"),
        () => fakeExecutable(root),
        1000,
      );
    clients.push(client);
    const events: RpcEvent[] = [];
    client.onEvent = (event) => events.push(event);
    await client.start();
    expect(await client.request("ping", {})).toEqual({ ok: true });
    await expect(client.request("bad", {})).rejects.toThrow("RPC failed");
    await client.request("question", {});
    expect(events[0]).toMatchObject({
      method: "item/tool/requestUserInput",
      requestId: "server-42",
    });
    client.respond("server-42", { answers: {} });
    expect(() => client.respond("server-42", {})).toThrow("no longer pending");
  });
  it("reports a missing CLI without emitting a reconnect retry cycle", async () => {
    const client = new CodexClient(directory(), () => "/missing/codex");
    clients.push(client);
    const event = vi.fn();
    client.onEvent = event;
    expect(await client.status()).toMatchObject({
      connected: false,
      error: expect.stringContaining("not found"),
    });
    expect(event).not.toHaveBeenCalled();
  });
  it("reports timeouts and fails pending work when the process exits", async () => {
    const root = directory(),
      client = new CodexClient(
        path.join(root, "home"),
        () => fakeExecutable(root),
        100,
      );
    clients.push(client);
    const events: RpcEvent[] = [];
    client.onEvent = (event) => events.push(event);
    await client.start();
    await expect(client.request("hang", {})).rejects.toThrow("timed out");
    await expect(client.request("exit", {})).rejects.toThrow("exited");
    expect(events.at(-1)?.method).toBe("connection/failed");
  });
});
