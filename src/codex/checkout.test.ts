import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { git, createWorktree } from "../../electron/main/codex/git";
import * as gitCommands from "../../electron/main/codex/git";
import { ThreadManager } from "../../electron/main/codex/threads";
import { CodexStore } from "../../electron/main/codex/store";
import type { CodexTransport } from "../../electron/main/codex/client";
import { defaultCodexPreferences, type CodexThread } from "../../shared/codex";
import {
  prepareWorktreeMerge,
  executeWorktreeMerge,
  mergeConflictFiles,
  cleanupMergedWorktreeDirectory,
} from "../../electron/main/codex/merge";
const roots: string[] = [];
afterEach(() => vi.restoreAllMocks());
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
  writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n.DS_Store\n");
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
async function conflictingWorktree() {
  const context = await setup();
  const { repo, thread, commit } = context;
  writeFileSync(path.join(repo, "initial"), "local default change\n");
  await git(repo, ["add", "initial"]);
  await git(repo, ["commit", "-m", "local default change"]);
  writeFileSync(path.join(thread.worktree, "initial"), "worktree change\n");
  await commit("conflicting feature");
  return context;
}

it("parses conflict filenames without mistaking diagnostics or whitespace for paths", () => {
  expect(mergeConflictFiles("tree\0CHANGELOG.md\0folder/my file\nname.ts\0\0diagnostics\0"))
    .toEqual(["CHANGELOG.md", "folder/my file\nname.ts"]);
});

it("offers resolution against the local default commit and lets a verified resolution merge normally", async () => {
  const { repo, origin, store, thread, manager, request } = await conflictingWorktree();
  const localHead = (await git(repo, ["rev-parse", "HEAD"])).trim();
  const remoteHead = (await git(origin, ["rev-parse", "HEAD"])).trim();
  const sourceHead = (await git(thread.worktree, ["rev-parse", "HEAD"])).trim();
  expect(localHead).not.toBe(remoteHead);
  const confirm = vi.fn(async () => true);
  const result = await manager.checkout(thread, "merge", confirm);
  expect(result).toEqual({ conflict: {
    defaultBranch: "trunk", targetCommit: localHead, sourceCommit: sourceHead,
    sourceBranch: thread.branch, files: ["initial"],
  } });
  expect(confirm).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
  await manager.resolveMergeConflicts(thread);
  const input = request.mock.calls.find(([method]) => method === "turn/start")?.[1] as { input: { text: string }[] };
  const prompt = input.input[0].text;
  expect(prompt).toContain(`"targetCommit":"${localHead}"`);
  expect(prompt).toContain(`"sourceCommit":"${sourceHead}"`);
  expect(prompt).toContain('"files":["initial"]');
  expect(prompt).toContain("retain all relevant release-note bullets");
  expect(prompt).toContain("Do not merge into or modify the default branch checkout");
  expect(thread.draft).toBe("keep draft");
  expect((await git(repo, ["rev-parse", "HEAD"])).trim()).toBe(localHead);
  expect((await git(thread.worktree, ["rev-parse", "HEAD"])).trim()).toBe(sourceHead);
  expect(existsSync(thread.worktree)).toBe(true);

  // Simulate Codex resolving the authorized merge in the source worktree.
  await expect(git(thread.worktree, ["merge", "--no-edit", localHead])).rejects.toThrow();
  writeFileSync(path.join(thread.worktree, "initial"), "local default change\nworktree change\n");
  await git(thread.worktree, ["add", "initial"]);
  await git(thread.worktree, ["commit", "--no-edit"]);
  thread.state = "idle";
  thread.turnId = undefined;
  await manager.checkout(thread, "merge", confirm);
  expect(confirm).toHaveBeenCalledOnce();
  expect(thread.checkout).toBe("default");
  expect(readFileSync(path.join(repo, "initial"), "utf8")).toBe("local default change\nworktree change\n");
  expect((await git(origin, ["rev-parse", "HEAD"])).trim()).toBe(remoteHead);
  expect(new CodexStore(store.root).get(thread.repositoryId, thread.id).checkout).toBe("default");
});

it("revalidates resolution requests and keeps dirty worktrees, unrelated operations, and active chats untouched", async () => {
  const { repo, thread, manager, request } = await conflictingWorktree();
  writeFileSync(path.join(thread.worktree, "draft"), "unsaved work");
  await expect(manager.resolveMergeConflicts(thread)).rejects.toThrow("uncommitted");
  expect(request).not.toHaveBeenCalled();
  rmSync(path.join(thread.worktree, "draft"));
  const target = (await git(repo, ["rev-parse", "HEAD"])).trim();
  await expect(git(thread.worktree, ["merge", "--no-edit", target])).rejects.toThrow();
  await expect(manager.resolveMergeConflicts(thread)).rejects.toThrow("uncommitted");
  expect(request).not.toHaveBeenCalled();
  await git(thread.worktree, ["merge", "--abort"]);
  thread.state = "running";
  await expect(manager.resolveMergeConflicts(thread)).rejects.toThrow("current turn");
  expect(request).not.toHaveBeenCalled();
});

it("does not start a Codex turn when a conflict has already been resolved", async () => {
  const { thread, manager, request, commit } = await setup();
  await commit();
  await expect(manager.resolveMergeConflicts(thread)).rejects.toThrow("No merge conflicts remain");
  expect(request).not.toHaveBeenCalled();
});
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

it("continues on the default branch when removal unregisters the worktree but leaves files behind", async () => {
  const { repo, store, thread, manager, commit } = await setup();
  await commit();
  const source = thread.worktree;
  const runGit = gitCommands.git;
  vi.spyOn(gitCommands, "git").mockImplementation(async (cwd, args) => {
    const output = await runGit(cwd, args);
    if (args[0] === "worktree" && args[1] === "remove" && args.includes(source)) {
      mkdirSync(source, { recursive: true });
      writeFileSync(path.join(source, "initial"), "base");
      mkdirSync(path.join(source, "node_modules"));
      writeFileSync(path.join(source, "node_modules/cache"), "generated cache");
      throw new Error("Directory not empty");
    }
    return output;
  });
  const result = await manager.checkout(thread, "merge", async () => true);
  expect(result).toBeUndefined();
  expect(thread.checkout).toBe("default");
  expect(thread.worktree).toBe(repo);
  expect(thread.error).toBeUndefined();
  expect(thread.mergedInto).toBeUndefined();
  expect(thread.draft).toBe("keep draft");
  expect(new CodexStore(store.root).get(thread.repositoryId, thread.id).worktree).toBe(repo);
  expect(existsSync(source)).toBe(false);
  await manager.checkout(thread, "worktree", async () => true);
  expect(thread.worktree).toBe(`${source}-1`);
  expect(existsSync(source)).toBe(false);
  await commit("second feature");
  // New generation paths also pass the managed-worktree validation.
  expect(await prepareWorktreeMerge(thread, store.root)).toMatchObject({ worktree: `${source}-1` });
});

it("recovers a previously merged chat when its old directory exists without a registered checkout", async () => {
  const { repo, store, thread, manager, commit } = await setup();
  await commit();
  const source = thread.worktree;
  const sourceCommit = (await git(source, ["rev-parse", "HEAD"])).trim();
  await git(repo, ["merge", "--ff-only", thread.branch]);
  thread.mergedInto = { branch: "trunk", sourceCommit, targetPath: repo, commit: sourceCommit };
  thread.error = "Merged into trunk, but cleanup failed: Directory not empty";
  store.saveThread(thread);
  await git(repo, ["worktree", "remove", source]);
  mkdirSync(source);
  writeFileSync(path.join(source, ".git"), "gitdir: /missing/worktree/metadata\n");
  writeFileSync(path.join(source, "initial"), "base");
  const confirm = vi.fn(async () => true);
  const result = await manager.checkout(thread, "merge", confirm);
  expect(confirm).not.toHaveBeenCalled();
  expect(result).toBeUndefined();
  expect(thread.worktree).toBe(repo);
  expect(thread.checkout).toBe("default");
  expect(thread.error).toBeUndefined();
  expect(thread.mergedInto).toBeUndefined();
  expect(existsSync(source)).toBe(false);
});

it("does not recover onto the default branch if the registered source has newer commits", async () => {
  const { repo, thread, manager, commit } = await setup();
  await commit();
  const source = thread.worktree;
  const sourceCommit = (await git(source, ["rev-parse", "HEAD"])).trim();
  await git(repo, ["merge", "--ff-only", thread.branch]);
  thread.mergedInto = { branch: "trunk", sourceCommit, targetPath: repo, commit: sourceCommit };
  await commit("new work after merge");
  await expect(manager.checkout(thread, "merge", async () => true)).rejects.toThrow("not in the merged default branch");
  expect(thread.worktree).toBe(source);
  expect(thread.mergedInto).toBeDefined();
  expect(existsSync(source)).toBe(true);
});

it.each(["notes.txt", "initial"])("preserves new or changed source data during partial cleanup: %s", async (name) => {
  const { repo, store, thread, commit } = await setup();
  await commit();
  const sourceCommit = (await git(thread.worktree, ["rev-parse", "HEAD"])).trim();
  await git(repo, ["merge", "--ff-only", thread.branch]);
  thread.mergedInto = { branch: "trunk", sourceCommit, targetPath: repo, commit: sourceCommit };
  await git(repo, ["worktree", "remove", thread.worktree]);
  mkdirSync(thread.worktree);
  writeFileSync(path.join(thread.worktree, name), "new unsaved work");
  await expect(cleanupMergedWorktreeDirectory(thread, store.root)).rejects.toThrow("new or modified file");
  expect(readFileSync(path.join(thread.worktree, name), "utf8")).toBe("new unsaved work");
});

it("automatically removes a verified merged folder and its leftover registration", async () => {
  const { repo, root, thread, manager, commit } = await setup();
  const outside = path.join(root, "outside.txt");
  writeFileSync(outside, "do not touch the symlink target");
  symlinkSync(outside, path.join(thread.worktree, "link"));
  await commit();
  const source = thread.worktree;
  const runGit = gitCommands.git;
  let failed = false;
  vi.spyOn(gitCommands, "git").mockImplementation(async (cwd, args) => {
    if (args[0] === "worktree" && args[1] === "remove" && args.includes(source) && !failed) {
      failed = true;
      throw new Error("Directory not empty");
    }
    return runGit(cwd, args);
  });
  expect(await manager.checkout(thread, "merge", async () => true)).toBeUndefined();
  expect(failed).toBe(true);
  expect(thread.worktree).toBe(repo);
  expect(existsSync(source)).toBe(false);
  expect((await git(repo, ["worktree", "list", "--porcelain"]))).not.toContain(source);
  expect(readFileSync(outside, "utf8")).toBe("do not touch the symlink target");
});

it("squashes the feature into exactly one commit while keeping its original branch", async () => {
  const { repo, thread, manager, commit } = await setup();
  const base = (await git(repo, ["rev-parse", "HEAD"])).trim();
  await commit("first feature change");
  await commit("second feature change");
  const source = thread.worktree, branch = thread.branch;
  const sourceHead = (await git(source, ["rev-parse", "HEAD"])).trim();
  await manager.checkout(thread, "merge", async () => ({ method: "squash", message: "feat: complete feature" }));
  expect((await git(repo, ["rev-list", "--count", `${base}..HEAD`])).trim()).toBe("1");
  expect((await git(repo, ["rev-parse", "HEAD^"])).trim()).toBe(base);
  expect((await git(repo, ["log", "-1", "--format=%s"])).trim()).toBe("feat: complete feature");
  expect((await git(repo, ["rev-parse", branch])).trim()).toBe(sourceHead);
  await expect(git(repo, ["merge-base", "--is-ancestor", sourceHead, "HEAD"])).rejects.toThrow();
  expect(readFileSync(path.join(repo, "first feature change"), "utf8")).toBe("first feature change");
  expect(readFileSync(path.join(repo, "second feature change"), "utf8")).toBe("second feature change");
  expect(existsSync(source)).toBe(false);
  expect(thread.checkout).toBe("default");
});

it("leaves the default checkout untouched when a squash commit hook fails", async () => {
  const { root, repo, thread, manager, commit } = await setup();
  await commit();
  const main = (await git(repo, ["rev-parse", "HEAD"])).trim();
  const source = thread.worktree;
  const hooks = path.join(root, "hooks");
  mkdirSync(hooks);
  writeFileSync(path.join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  await git(repo, ["config", "core.hooksPath", hooks]);
  await expect(manager.checkout(thread, "merge", async () => ({ method: "squash", message: "Feature" }))).rejects.toThrow();
  expect((await git(repo, ["rev-parse", "HEAD"])).trim()).toBe(main);
  expect((await git(repo, ["status", "--porcelain"])).trim()).toBe("");
  expect((await git(source, ["status", "--porcelain"])).trim()).toBe("");
  expect(existsSync(source)).toBe(true);
  expect(thread.mergedInto).toBeUndefined();
  expect(thread.draft).toBe("keep draft");
});

it("recovers verified squash integration after an interrupted cleanup without requiring source ancestry", async () => {
  const { repo, thread, manager, commit } = await setup();
  await commit();
  const source = thread.worktree;
  const runGit = gitCommands.git;
  let preventCleanup = true;
  vi.spyOn(gitCommands, "git").mockImplementation(async (cwd, args) => {
    if (preventCleanup && args[0] === "hash-object") throw new Error("Temporary filesystem error");
    const output = await runGit(cwd, args);
    if (preventCleanup && args[0] === "worktree" && args[1] === "remove" && args.includes(source)) {
      mkdirSync(source);
      writeFileSync(path.join(source, "initial"), "base");
      throw new Error("Directory not empty");
    }
    return output;
  });
  await expect(manager.checkout(thread, "merge", async () => ({ method: "squash", message: "Feature" }))).rejects.toThrow("Temporary filesystem error");
  expect(thread.mergedInto?.method).toBe("squash");
  const squashed = (await git(repo, ["rev-parse", "HEAD"])).trim();
  preventCleanup = false;
  await manager.checkout(thread, "merge", async () => { throw Error("Already confirmed"); });
  expect(thread.worktree).toBe(repo);
  expect(thread.mergedInto).toBeUndefined();
  expect(existsSync(source)).toBe(false);
  expect((await git(repo, ["rev-parse", "HEAD"])).trim()).toBe(squashed);
});

it("squashes onto a newer remote default commit with a single final fast-forward", async () => {
  const { repo, thread, manager, commit } = await setup();
  const base = (await git(repo, ["rev-parse", "HEAD"])).trim();
  writeFileSync(path.join(repo, "remote-change"), "upstream");
  await git(repo, ["add", "remote-change"]);
  await git(repo, ["commit", "-m", "upstream change"]);
  const upstream = (await git(repo, ["rev-parse", "HEAD"])).trim();
  await git(repo, ["push", "origin", "trunk"]);
  await git(repo, ["reset", "--hard", base]);
  await commit("feature");
  await manager.checkout(thread, "merge", async () => ({ method: "squash", message: "Feature" }));
  expect((await git(repo, ["rev-parse", "HEAD^"])).trim()).toBe(upstream);
  expect(readFileSync(path.join(repo, "remote-change"), "utf8")).toBe("upstream");
  expect(readFileSync(path.join(repo, "feature"), "utf8")).toBe("feature");
  expect((await git(repo, ["status", "--porcelain"])).trim()).toBe("");
});

it("preserves outside target changes if the default branch moves during preparation", async () => {
  const { repo, thread, manager, commit } = await setup();
  await commit();
  const runGit = gitCommands.git;
  let externalHead = "";
  vi.spyOn(gitCommands, "git").mockImplementation(async (cwd, args) => {
    const output = await runGit(cwd, args);
    if (args[0] === "commit" && cwd.includes("merge-previews")) {
      writeFileSync(path.join(repo, "outside-work"), "keep outside work");
      await runGit(repo, ["add", "outside-work"]);
      await runGit(repo, ["commit", "-m", "outside work"]);
      externalHead = (await runGit(repo, ["rev-parse", "HEAD"])).trim();
    }
    return output;
  });
  await expect(manager.checkout(thread, "merge", async () => ({ method: "squash", message: "Feature" })))
    .rejects.toThrow("repository changed");
  expect(externalHead).not.toBe("");
  expect((await git(repo, ["rev-parse", "HEAD"])).trim()).toBe(externalHead);
  expect(readFileSync(path.join(repo, "outside-work"), "utf8")).toBe("keep outside work");
  expect(existsSync(path.join(repo, "feature"))).toBe(false);
  expect(existsSync(thread.worktree)).toBe(true);
});
