import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { git, createWorktree } from "../../electron/main/codex/git";
import { threadStartOptions, prepareDirectCheckout, validateThreadStart } from "../../electron/main/codex/thread-start";
let folder: string, repo: string;
const run = (args: string[]) => git(repo, args);
beforeEach(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), "forge-start-"));
  repo = folder;
  await run(["init", "-b", "trunk"]);
  await run(["config", "user.name", "Test"]);
  await run(["config", "user.email", "test@example.com"]);
  await writeFile(path.join(repo, "file"), "default");
  await run(["add", "."]);
  await run(["commit", "-m", "Initial"]);
  await run(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk"]);
  await run(["update-ref", "refs/remotes/origin/trunk", "HEAD"]);
  await run(["switch", "-c", "feature"]);
  await writeFile(path.join(repo, "file"), "feature");
  await run(["commit", "-am", "Feature"]);
});
afterEach(async () => { await rm(folder, { recursive: true, force: true }); });
it("detects named default and current branches and isolates the default branch HEAD", async () => {
  expect(await threadStartOptions(run)).toEqual({ defaultBranch: "trunk", currentBranch: "feature" });
  const checkout = await createWorktree(repo, path.join(folder, "trees"), randomUUID(), 0, "refs/heads/trunk");
  expect(checkout.baseCommit).toBe((await run(["rev-parse", "trunk"])).trim());
  expect((await run(["branch", "--show-current"])).trim()).toBe("feature");
  expect((await git(checkout.worktree, ["show", "HEAD:file"]))).toBe("default");
});
it("starts directly on the named default branch", async () => {
  const checkout = await prepareDirectCheckout(run, { kind: "default", branch: "trunk" });
  expect(checkout.branch).toBe("trunk");
  expect((await run(["branch", "--show-current"])).trim()).toBe("trunk");
});
it("creates a named branch from the default HEAD", async () => {
  const checkout = await prepareDirectCheckout(run, { kind: "new", branch: "codex/task" });
  expect(checkout.baseCommit).toBe((await run(["rev-parse", "trunk"])).trim());
  expect((await run(["branch", "--show-current"])).trim()).toBe("codex/task");
  await expect(prepareDirectCheckout(run, { kind: "new", branch: "codex/task" })).rejects.toThrow();
});
it("keeps current branch changes and refuses stale choices or dirty branch switches", async () => {
  await writeFile(path.join(repo, "file"), "uncommitted");
  expect((await prepareDirectCheckout(run, { kind: "current", branch: "feature" })).branch).toBe("feature");
  await expect(prepareDirectCheckout(run, { kind: "default", branch: "trunk" })).rejects.toThrow("Commit or stash");
  await expect(prepareDirectCheckout(run, { kind: "new", branch: "codex/task" })).rejects.toThrow("Commit or stash");
  await expect(prepareDirectCheckout(run, { kind: "current", branch: "trunk" })).rejects.toThrow("repository branch changed");
  expect((await run(["diff"]))).toContain("uncommitted");
});
it("rejects invalid branch names without switching the checkout", async () => {
  await expect(prepareDirectCheckout(run, { kind: "new", branch: "../escape" })).rejects.toThrow();
  expect((await run(["branch", "--show-current"])).trim()).toBe("feature");
});

it("checks new branch availability against local and origin branches and rejects invalid names", async () => {
  await expect(validateThreadStart(run, { kind: "new", branch: "codex/available" })).resolves.toBeUndefined();
  await expect(validateThreadStart(run, { kind: "new", branch: "feature" })).rejects.toThrow("already exists");
  await run(["update-ref", "refs/remotes/origin/codex/remote", "HEAD"]);
  await expect(validateThreadStart(run, { kind: "new", branch: "codex/remote" })).rejects.toThrow("already exists");
  await expect(validateThreadStart(run, { kind: "new", branch: "invalid branch" })).rejects.toThrow();
});
