import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { git, createWorktree } from "../../electron/main/codex/git";
import { ThreadManager } from "../../electron/main/codex/threads";
import { CodexStore } from "../../electron/main/codex/store";
import type { CodexTransport } from "../../electron/main/codex/client";
import { defaultCodexPreferences, type CodexThread } from "../../shared/codex";
import {
  prepareWorktreeMerge,
  executeWorktreeMerge,
} from "../../electron/main/codex/merge";
const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
async function setup() {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "forge-checkout-")),
  );
  roots.push(root);
  const repo = path.join(root, "repo");
  mkdirSync(repo);
  await git(repo, ["init", "-b", "trunk"]);
  await git(repo, ["config", "user.name", "Test"]);
  await git(repo, ["config", "user.email", "test@example.com"]);
  writeFileSync(path.join(repo, "initial"), "base");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "initial"]);
  const origin = path.join(root, "origin.git");
  await git(root, ["clone", "--bare", repo, origin]);
  await git(repo, ["remote", "add", "origin", origin]);
  const store = new CodexStore(path.join(root, "store"));
  const id = randomUUID();
  const thread: CodexThread = {
    id,
    repositoryId: "repo",
    title: "same chat",
    archived: false,
    createdAt: "",
    updatedAt: "",
    settings: { ...defaultCodexPreferences, mode: "implement" },
    state: "idle",
    repositoryPath: repo,
    serverId: "same-server-thread",
    items: [
      { id: "reply", kind: "assistant", text: "history", status: "completed" },
    ],
    requests: [],
    queue: [],
    queuePaused: false,
    draft: "keep draft",
    draftAttachments: [],
    ...(await createWorktree(repo, path.join(store.root, "worktrees"), id)),
  };
  store.threads.set(id, thread);
  store.saveThread(thread);
  const request = vi.fn(async (method: string, _params: unknown) => {
    if (method === "account/read")
      return { account: { email: "test@example.com" } };
    if (method === "turn/start") return { turn: { id: "turn" } };
    return { thread: { id: "same-server-thread", turns: [] } };
  });
  const manager = new ThreadManager(
    store,
    {
      start: async () => {},
      stop: vi.fn(),
      request,
    } as unknown as CodexTransport,
    async () => [
      {
        id: "test",
        name: "Test",
        isDefault: true,
        efforts: ["medium"],
        defaultEffort: "medium",
        fast: false,
        images: false,
      },
    ],
    () => {},
    () => "",
  );
  async function commit(name = "feature") {
    writeFileSync(path.join(thread.worktree, name), name);
    await git(thread.worktree, ["add", "."]);
    await git(thread.worktree, ["commit", "-m", name]);
  }
  return { root, repo, store, thread, manager, commit, origin, request };
}
it("moves the same chat from worktree to default branch and back repeatedly, persisting the active folder", async () => {
  const { repo, store, thread, manager, commit, origin } = await setup();
  const originalBranch = thread.branch;
  const remoteBefore = (await git(origin, ["rev-parse", "HEAD"])).trim();
  for (let i = 0; i < 2; i++) {
    await commit(`feature-${i}`);
    const previousFolder = thread.worktree;
    const confirm = vi.fn(async (_title: string, _detail: string) => true);
    await manager.checkout(thread, "merge", confirm);
    expect(confirm.mock.calls[0]?.[0]).toContain("trunk");
    expect(thread.worktree).toBe(repo);
    expect(thread.branch).toBe("trunk");
    expect(thread.checkout).toBe("default");
    expect(existsSync(previousFolder)).toBe(false);
    expect(thread.serverId).toBe("same-server-thread");
    expect(thread.items).toHaveLength(1);
    expect(thread.draft).toBe("keep draft");
    expect(thread.archived).toBe(false);
    expect(store.list("repo")[0]?.checkout).toBe("default");
    expect(new CodexStore(store.root).get("repo", thread.id).worktree).toBe(
      repo,
    );
    await manager.checkout(thread, "worktree", async () => true);
    expect(thread.checkout).toBe("worktree");
    expect(thread.branch).toContain(`-${i + 1}`);
    expect(existsSync(path.join(thread.worktree, `feature-${i}`))).toBe(true);
  }
  expect((await git(repo, ["rev-parse", originalBranch])).trim()).toBeTruthy();
  expect((await git(origin, ["rev-parse", "HEAD"])).trim()).toBe(remoteBefore);
}, 15000);
it("cancelling either confirmation preserves the checkout and history", async () => {
  const { thread, manager, commit } = await setup();
  await commit();
  const before = thread.worktree;
  await manager.checkout(thread, "merge", async () => false);
  expect(thread.worktree).toBe(before);
  expect(existsSync(before)).toBe(true);
  await manager.checkout(thread, "merge", async () => true);
  const main = thread.worktree;
  await manager.checkout(thread, "worktree", async () => false);
  expect(thread.worktree).toBe(main);
  expect(thread.checkout).toBe("default");
});
it("blocks dirty source and target checkouts before confirmation or deletion", async () => {
  const { repo, thread, manager, commit } = await setup();
  writeFileSync(path.join(thread.worktree, "unsaved"), "keep");
  const confirm = vi.fn(async (_title: string, _detail: string) => true);
  await expect(manager.checkout(thread, "merge", confirm)).rejects.toThrow(
    "uncommitted",
  );
  expect(confirm).not.toHaveBeenCalled();
  expect(existsSync(thread.worktree)).toBe(true);
  await commit();
  writeFileSync(path.join(repo, "local"), "keep");
  await expect(manager.checkout(thread, "merge", confirm)).rejects.toThrow(
    "uncommitted",
  );
  expect(existsSync(thread.worktree)).toBe(true);
});
it("blocks conflicts and changed confirmation plans while keeping the worktree", async () => {
  const { repo, store, thread, commit } = await setup();
  await commit();
  const plan = await prepareWorktreeMerge(thread, store.root);
  await commit("another");
  await expect(
    executeWorktreeMerge(thread, store.root, plan, () => {}),
  ).rejects.toThrow("changed");
  writeFileSync(path.join(repo, "initial"), "main change");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "main change"]);
  writeFileSync(path.join(thread.worktree, "initial"), "worktree change");
  await commit("conflicting");
  await expect(prepareWorktreeMerge(thread, store.root)).rejects.toThrow(
    "conflicts",
  );
  expect(existsSync(thread.worktree)).toBe(true);
});
it("keeps a default branch checkout available even when it was not checked out before merging", async () => {
  const { repo, thread, manager, commit } = await setup();
  await commit();
  await git(repo, ["checkout", "-b", "unrelated"]);
  await manager.checkout(thread, "merge", async () => true);
  expect(thread.checkout).toBe("default");
  expect(thread.worktree).not.toBe(repo);
  expect(existsSync(thread.worktree)).toBe(true);
  expect(
    (await git(thread.worktree, ["branch", "--show-current"])).trim(),
  ).toBe("trunk");
  await manager.checkout(thread, "worktree", async () => true);
  expect(thread.checkout).toBe("worktree");
});
it("locks the repository during confirmation and never removes imported checkouts", async () => {
  const { thread, manager, commit } = await setup();
  await commit();
  await manager.checkout(thread, "merge", async () => {
    await expect(
      manager.send(thread, { id: "m", text: "hello", attachments: [] }),
    ).rejects.toThrow("checkout change");
    await expect(
      manager.checkout(thread, "merge", async () => true),
    ).rejects.toThrow("Stop active");
    return false;
  });
  thread.sourceHome = "/external";
  await expect(
    manager.checkout(thread, "merge", async () => true),
  ).rejects.toThrow("Forge-created");
  expect(existsSync(thread.worktree)).toBe(true);
});

it("resumes the same native chat with the current checkout on both sides of the round trip", async () => {
  const { thread, manager, commit, request } = await setup();
  await commit();
  await manager.checkout(thread, "merge", async () => true);
  await manager.send(thread, {
    id: "message1",
    text: "continue",
    attachments: [],
  });
  expect(request).toHaveBeenCalledWith(
    "thread/resume",
    expect.objectContaining({
      cwd: thread.worktree,
      threadId: "same-server-thread",
      runtimeWorkspaceRoots: [thread.worktree],
    }),
  );
  expect(request).toHaveBeenCalledWith(
    "turn/start",
    expect.objectContaining({ cwd: thread.worktree }),
  );
  thread.state = "idle";
  thread.turnId = undefined;
  await manager.checkout(thread, "worktree", async () => true);
  await manager.send(thread, {
    id: "message2",
    text: "continue again",
    attachments: [],
  });
  expect(request).toHaveBeenLastCalledWith(
    "turn/start",
    expect.objectContaining({
      cwd: thread.worktree,
      threadId: "same-server-thread",
    }),
  );
});
it("recovers the current default checkout after interruption between worktree removal and saving the folder", async () => {
  const { repo, store, thread, manager, commit } = await setup();
  await commit();
  const sourceCommit = (
    await git(thread.worktree, ["rev-parse", "HEAD"])
  ).trim();
  await git(repo, ["merge", "--ff-only", thread.branch]);
  thread.mergedInto = {
    branch: "trunk",
    sourceCommit,
    targetPath: repo,
    commit: sourceCommit,
  };
  store.saveThread(thread);
  await git(repo, ["worktree", "remove", thread.worktree]);
  await manager.checkout(thread, "merge", async () => {
    throw new Error("No new mutation to confirm");
  });
  expect(thread.checkout).toBe("default");
  expect(thread.worktree).toBe(repo);
  expect(thread.mergedInto).toBeUndefined();
  expect(thread.serverId).toBe("same-server-thread");
});
