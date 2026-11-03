import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { git, createWorktree } from "../../electron/main/codex/git";
import { threadStartOptions, prepareDirectCheckout, validateThreadStart, startBaseCommit } from "../../electron/main/codex/thread-start";
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

async function advanceOrigin() {
  const origin = path.join(repo, ".git", "origin.git");
  const writer = path.join(repo, ".git", "writer");
  await run(["clone", "--bare", repo, origin]);
  await run(["remote", "add", "origin", origin]);
  await run(["clone", "--branch", "trunk", origin, writer]);
  await git(writer, ["config", "user.name", "Test"]);
  await git(writer, ["config", "user.email", "test@example.com"]);
  await writeFile(path.join(writer, "file"), "upstream");
  await git(writer, ["commit", "-am", "Upstream"]);
  await git(writer, ["push", "origin", "trunk"]);
  return (await git(writer, ["rev-parse", "HEAD"])).trim();
}
it("fetches the default branch for worktrees instead of using stale origin or local commits", async () => {
  const upstream = await advanceOrigin();
  await run(["update-ref", "refs/heads/trunk", "feature"]);
  const before = (await run(["rev-parse", "origin/trunk"])).trim();
  expect(before).not.toBe(upstream);
  await writeFile(path.join(repo, "file"), "uncommitted");
  const base = await startBaseCommit(run, { kind: "worktree", branch: "trunk" }, true);
  const checkout = await createWorktree(repo, path.join(repo, ".git", "trees"), randomUUID(), 0, base);
  expect(checkout.baseCommit).toBe(upstream);
  expect(await git(checkout.worktree, ["show", "HEAD:file"])).toBe("upstream");
  expect((await run(["rev-parse", "trunk"])).trim()).not.toBe(upstream);
  expect((await run(["branch", "--show-current"])).trim()).toBe("feature");
  expect(await run(["diff"])).toContain("uncommitted");
});
it("starts named branches from freshly fetched origin and preserves the local default branch", async () => {
  const upstream = await advanceOrigin();
  const local = (await run(["rev-parse", "trunk"])).trim();
  expect((await prepareDirectCheckout(run, { kind: "new", branch: "codex/fresh" })).baseCommit).toBe(upstream);
  expect((await run(["rev-parse", "trunk"])).trim()).toBe(local);
});
it("does not silently fall back to stale refs when fetching origin fails", async () => {
  await run(["remote", "add", "origin", path.join(repo, ".git", "missing.git")]);
  await expect(startBaseCommit(run, { kind: "worktree", branch: "trunk" }, true)).rejects.toThrow();
  await expect(prepareDirectCheckout(run, { kind: "new", branch: "codex/fail" })).rejects.toThrow();
  expect((await run(["branch", "--show-current"])).trim()).toBe("feature");
  await expect(run(["show-ref", "--verify", "refs/heads/codex/fail"])).rejects.toThrow();
  // Existing branch checkouts remain local and usable without network access.
  expect((await prepareDirectCheckout(run, { kind: "default", branch: "trunk" })).branch).toBe("trunk");
});
