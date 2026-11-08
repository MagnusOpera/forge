import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { git } from "../../electron/main/codex/git";
import { gitFileDiff, gitFileHistory, gitHistoricalPreview, gitHistoricalTree, gitPreview, gitRepositoryHistory, gitSnapshot, resolveGitCheckout, runGitAction } from "../../electron/main/git-explorer";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "forge-git-explorer-")));
  roots.push(root);
  const checkout = path.join(root, "checkout");
  const remote = path.join(root, "remote.git");
  const peer = path.join(root, "peer");
  await git(root, ["init", "--bare", "-b", "main", remote]);
  await git(root, ["clone", remote, checkout]);
  const author = async (cwd: string) => {
    await git(cwd, ["config", "user.name", "Forge Test"]);
    await git(cwd, ["config", "user.email", "test@example.com"]);
    await git(cwd, ["config", "commit.gpgsign", "false"]);
  };
  await author(checkout);
  await writeFile(path.join(checkout, ".gitignore"), "ignored.txt\n");
  await writeFile(path.join(checkout, "base.txt"), "base\n");
  await git(checkout, ["add", "."]);
  await git(checkout, ["commit", "-m", "initial"]);
  await git(checkout, ["push", "-u", "origin", "main"]);
  await git(root, ["clone", remote, peer]);
  await author(peer);
  return { root, checkout, remote, peer };
}

async function snapshot(checkout: string) {
  const result = await gitSnapshot(checkout, null);
  if (result.kind !== "ready") throw new Error(result.message);
  return result;
}

async function commit(cwd: string, file: string, content: string) {
  await writeFile(path.join(cwd, file), content);
  await git(cwd, ["add", "--", file]);
  await git(cwd, ["commit", "-m", "edit " + file]);
  return (await git(cwd, ["rev-parse", "HEAD"])).trim();
}

it("follows file renames and safely reads committed versions without changing local edits", async () => {
  const { checkout } = await setup();
  const original = "base.txt";
  const renamed = "new\nname [1].txt";
  const initial = (await git(checkout, ["rev-parse", "HEAD"])).trim();
  const edited = await commit(checkout, original, "Révision ✓\n");
  await git(checkout, ["mv", "--", original, renamed]);
  await git(checkout, ["commit", "-m", "Rename the file"]);
  const rename = (await git(checkout, ["rev-parse", "HEAD"])).trim();
  await writeFile(path.join(checkout, renamed), "Local edits\n");
  await writeFile(path.join(checkout, "new.txt"), "Untracked\n");
  const { revision } = await snapshot(checkout);

  const history = await gitFileHistory(checkout, revision, renamed);
  expect(history).toEqual({ commits: [
    { commit: rename, date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), subject: "Rename the file", path: renamed },
    { commit: edited, date: expect.any(String), subject: "edit base.txt", path: original },
    { commit: initial, date: expect.any(String), subject: "initial", path: original },
  ], hasOlder: false });
  await expect(gitFileHistory(checkout, revision, "new.txt")).resolves.toEqual({ commits: [], hasOlder: false });
  await expect(gitHistoricalPreview(checkout, "", revision, original, edited)).resolves.toMatchObject({ kind: "text", text: "Révision ✓\n" });
  await expect(gitHistoricalPreview(checkout, "", revision, renamed, initial)).resolves.toEqual({ kind: "missing" });
  await expect(gitHistoricalPreview(checkout, "", revision, "../outside.txt", initial)).rejects.toThrow("Invalid checkout file path");
  await expect(gitHistoricalPreview(checkout, "", revision, original, "HEAD")).rejects.toThrow("Invalid commit ID");
  const unrelated = (await git(checkout, ["commit-tree", "HEAD^{tree}", "-m", "Unrelated"])).trim();
  await expect(gitHistoricalPreview(checkout, "", revision, renamed, unrelated)).rejects.toThrow("outside the current branch history");
  expect(await readFile(path.join(checkout, renamed), "utf8")).toBe("Local edits\n");
  expect((await git(checkout, ["rev-parse", "HEAD"])).trim()).toBe(rename);
});

it("bounds committed file previews and rejects binary content and symlinks", async () => {
  const { checkout } = await setup();
  await writeFile(path.join(checkout, "binary.txt"), Buffer.from([0xc3, 0x28]));
  await writeFile(path.join(checkout, "large.txt"), "x".repeat(512 * 1024 + 1));
  await symlink("base.txt", path.join(checkout, "link.txt"));
  await git(checkout, ["add", "."]);
  await git(checkout, ["commit", "-m", "Add preview fixtures"]);
  const head = (await git(checkout, ["rev-parse", "HEAD"])).trim();
  const { revision } = await snapshot(checkout);
  await expect(gitHistoricalPreview(checkout, "", revision, "binary.txt", head)).resolves.toMatchObject({ kind: "binary" });
  await expect(gitHistoricalPreview(checkout, "", revision, "large.txt", head)).resolves.toMatchObject({ kind: "too-large" });
  await expect(gitHistoricalPreview(checkout, "", revision, "link.txt", head)).resolves.toMatchObject({ kind: "unsupported" });
});

it("lists repository commits separately from file changes and reads a commit's full tree", async () => {
  const { checkout } = await setup();
  const initial = (await git(checkout, ["rev-parse", "HEAD"])).trim();
  const edit = await commit(checkout, "base.txt", "Updated file\n");
  const head = await commit(checkout, "other.txt", "An unrelated change\n");
  await writeFile(path.join(checkout, "base.txt"), "Working tree\n");
  await writeFile(path.join(checkout, "untracked.txt"), "Local file\n");
  const { revision } = await snapshot(checkout);

  expect((await gitRepositoryHistory(checkout, revision)).commits.map(({ commit }) => commit)).toEqual([head, edit, initial]);
  expect((await gitFileHistory(checkout, revision, "base.txt")).commits.map(({ commit }) => commit)).toEqual([edit, initial]);
  expect((await gitFileHistory(checkout, revision, "base.txt", initial)).commits.map(({ commit }) => commit)).toEqual([initial]);
  await expect(gitFileHistory(checkout, revision, "base.txt", "HEAD")).rejects.toThrow("Invalid commit ID");
  const oldTree = await gitHistoricalTree(checkout, "", revision, initial);
  expect(oldTree.files).toEqual([{ path: ".gitignore", status: "clean" }, { path: "base.txt", status: "clean" }]);
  expect((await gitHistoricalTree(checkout, "", revision, head)).files.map(({ path }) => path)).toEqual([".gitignore", "base.txt", "other.txt"]);
  await expect(gitHistoricalPreview(checkout, "", revision, "base.txt", initial)).resolves.toMatchObject({ kind: "text", text: "base\n" });
  await expect(gitHistoricalTree(checkout, "", "0".repeat(64), initial)).rejects.toThrow("checkout changed");
  expect(await readFile(path.join(checkout, "base.txt"), "utf8")).toBe("Working tree\n");
  expect((await git(checkout, ["rev-parse", "HEAD"])).trim()).toBe(head);
});

it("excludes old directory contents from the history of a same-named file", async () => {
  const { checkout } = await setup();
  await mkdir(path.join(checkout, "notes"));
  await commit(checkout, "notes/old.txt", "Old directory contents\n");
  await git(checkout, ["rm", "-r", "notes"]);
  const replaced = await commit(checkout, "notes", "A single file\n");
  const { revision } = await snapshot(checkout);
  expect((await gitFileHistory(checkout, revision, "notes")).commits).toMatchObject([{ commit: replaced, path: "notes" }]);
});

it("orders local and remote branches together by their tip commit date", async () => {
  const { checkout } = await setup();
  const fixtures = [
    ["refs/heads/alphabetically-first", "2025-01-01"],
    ["refs/heads/local", "2025-02-01"],
    ["refs/remotes/origin/tied", "2025-02-01"],
    ["refs/remotes/origin/newest", "2025-03-01"],
  ];
  for (const [ref, date] of fixtures) {
    const tip = (await git(checkout, ["commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", ref], {
      env: { ...process.env, GIT_AUTHOR_DATE: "2024-01-01T00:00:00Z", GIT_COMMITTER_DATE: date + "T00:00:00Z" },
    })).trim();
    await git(checkout, ["update-ref", ref, tip]);
  }
  const fixtureRefs = new Set(fixtures.map(([ref]) => ref));
  expect((await snapshot(checkout)).branches.map(({ ref }) => ref).filter((ref) => fixtureRefs.has(ref))).toEqual([
    "refs/remotes/origin/newest",
    "refs/heads/local",
    "refs/remotes/origin/tied",
    "refs/heads/alphabetically-first",
  ]);
});

it("fetches branches, reports failed remotes, switches to a tracking branch and protects other worktrees", async () => {
  const { root, checkout, peer } = await setup();
  await git(peer, ["switch", "-c", "topic/preview"]);
  const target = await commit(peer, "feature.txt", "remote");
  await git(peer, ["push", "origin", "topic/preview"]);
  await git(checkout, ["remote", "add", "broken", path.join(root, "missing.git")]);

  await expect(runGitAction(checkout, (await snapshot(checkout)).revision, { kind: "fetch" }))
    .rejects.toThrow(/Fetch failed for broken/);
  const fetched = await snapshot(checkout);
  expect(fetched.branches).toContainEqual({ ref: "refs/remotes/origin/topic/preview", label: "topic/preview", remote: "origin" });
  expect(fetched.branches.some((entry) => entry.ref === "refs/remotes/origin/HEAD")).toBe(false);
  expect((await git(checkout, ["rev-parse", "HEAD"])).trim()).not.toBe(target);
  await git(checkout, ["remote", "remove", "broken"]);
  await runGitAction(checkout, fetched.revision, { kind: "switch", ref: "refs/remotes/origin/topic/preview" });
  const switched = await snapshot(checkout);
  expect(switched.branch).toBe("topic/preview");
  expect(switched.pushDestination).toBe("origin/topic/preview");
  expect(switched.branches.filter(({ label }) => label === "topic/preview"))
    .toEqual([expect.objectContaining({ ref: "refs/heads/topic/preview" })]);
  expect((await git(checkout, ["rev-parse", "HEAD"])).trim()).toBe(target);

  await git(checkout, ["worktree", "add", path.join(root, "linked"), "main"]);
  const linked = await snapshot(checkout);
  expect(linked.branches.find((entry) => entry.ref === "refs/heads/main")?.worktree).toBe(path.join(root, "linked"));
  await expect(runGitAction(checkout, linked.revision, { kind: "switch", ref: "refs/heads/main" })).rejects.toThrow(/another worktree/);
  await expect(runGitAction(checkout, fetched.revision, { kind: "push" })).rejects.toThrow(/checkout changed/);
});

it("uses one entry per branch name, preferring local branches and then origin", async () => {
  const { checkout, remote } = await setup();
  await git(checkout, ["remote", "add", "fork", remote]);
  await git(checkout, ["branch", "release/0.176"]);
  for (const ref of [
    "refs/remotes/origin/release/0.176", "refs/remotes/fork/release/0.176",
    "refs/remotes/origin/remote-only", "refs/remotes/fork/remote-only",
    "refs/remotes/origin/aliased",
  ]) await git(checkout, ["update-ref", ref, "HEAD"]);
  await git(checkout, ["branch", "--track", "local-alias", "origin/aliased"]);

  const ready = await snapshot(checkout);
  expect(ready.branches.filter(({ label }) => label === "release/0.176")).toEqual([
    { ref: "refs/heads/release/0.176", label: "release/0.176" },
  ]);
  expect(ready.branches.filter(({ label }) => label === "remote-only")).toEqual([
    { ref: "refs/remotes/origin/remote-only", label: "remote-only", remote: "origin" },
  ]);
  expect(ready.branches.map(({ label }) => label).filter((label) => label.includes("alias"))).toEqual(["local-alias"]);
  await runGitAction(checkout, ready.revision, { kind: "switch", ref: "refs/heads/release/0.176" });
  const release = await snapshot(checkout);
  expect(release.branch).toBe("release/0.176");
  expect(release.pushDestination).toBeNull();

  await runGitAction(checkout, release.revision, { kind: "switch", ref: "refs/remotes/origin/remote-only" });
  expect((await snapshot(checkout)).pushDestination).toBe("origin/remote-only");
});

it("switches back to main with unrelated untracked files and protects files in the way", async () => {
  const { checkout } = await setup();
  await git(checkout, ["branch", "older"]);
  await commit(checkout, "added-on-main.txt", "tracked on main");
  await runGitAction(checkout, (await snapshot(checkout)).revision, { kind: "switch", ref: "refs/heads/older" });
  const generated = path.join(checkout, "generated.txt");
  await writeFile(generated, "untracked output");

  const older = await snapshot(checkout);
  expect(older.blockers.switch).toBeNull();
  await runGitAction(checkout, older.revision, { kind: "switch", ref: "refs/heads/main" });
  const main = await snapshot(checkout);
  expect(main.branch).toBe("main");
  expect(main.blockers.pull).toMatch(/local changes/);
  expect(main.blockers.push).toMatch(/local changes/);
  expect(await readFile(generated, "utf8")).toBe("untracked output");

  await runGitAction(checkout, main.revision, { kind: "switch", ref: "refs/heads/older" });
  const collision = path.join(checkout, "added-on-main.txt");
  await writeFile(collision, "local contents");
  await expect(runGitAction(checkout, (await snapshot(checkout)).revision, { kind: "switch", ref: "refs/heads/main" }))
    .rejects.toThrow(/would be overwritten by checkout/);
  expect((await snapshot(checkout)).branch).toBe("older");
  expect(await readFile(collision, "utf8")).toBe("local contents");

  await writeFile(path.join(checkout, "base.txt"), "tracked edits");
  expect((await snapshot(checkout)).blockers.switch).toMatch(/tracked changes/);
});

it("limits Fetch to remote-tracking refs even when configuration maps into local branches or tags", async () => {
  const { checkout, peer } = await setup();
  await git(checkout, ["config", "--add", "remote.origin.fetch", "+refs/heads/main:refs/heads/local-copy"]);
  await git(checkout, ["config", "fetch.pruneTags", "true"]);
  await git(checkout, ["tag", "local-only"]);
  const target = await commit(peer, "new.txt", "new remote content");
  await git(peer, ["push"]);
  await runGitAction(checkout, (await snapshot(checkout)).revision, { kind: "fetch" });
  expect((await git(checkout, ["rev-parse", "refs/remotes/origin/main"])).trim()).toBe(target);
  expect(await git(checkout, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/tags"]))
    .toBe("refs/heads/main\nrefs/tags/local-only\n");
});

it("fast-forwards a clean branch and leaves its tip and index alone after divergence", async () => {
  const { checkout, peer } = await setup();
  const next = await commit(peer, "base.txt", "remote edit");
  await git(peer, ["push"]);
  await git(checkout, ["config", "pull.rebase", "true"]);
  await git(checkout, ["config", "branch.main.mergeOptions", "--no-ff --autostash --squash"]);
  await runGitAction(checkout, (await snapshot(checkout)).revision, { kind: "pull" });
  expect((await git(checkout, ["rev-parse", "HEAD"])).trim()).toBe(next);
  const local = await commit(checkout, "local.txt", "local");
  await commit(peer, "remote.txt", "remote");
  await git(peer, ["push"]);

  await expect(runGitAction(checkout, (await snapshot(checkout)).revision, { kind: "pull" })).rejects.toThrow(/diverged/);
  expect((await git(checkout, ["rev-parse", "HEAD"])).trim()).toBe(local);
  expect(await git(checkout, ["status", "--porcelain"])).toBe("");
});

it("pushes only the clean branch to its explicit upstream and blocks dirty or unfinished work", async () => {
  const { checkout, remote } = await setup();
  await git(checkout, ["switch", "-c", "local-name"]);
  await git(checkout, ["branch", "--set-upstream-to=origin/main"]);
  await git(checkout, ["branch", "unrelated"]);
  await git(checkout, ["config", "remote.origin.push", "refs/heads/unrelated:refs/heads/unrelated"]);
  await git(checkout, ["config", "push.followTags", "true"]);
  const local = await commit(checkout, "pushed.txt", "local");
  await git(checkout, ["tag", "-a", "private-tag", "-m", "tag"]);
  const ready = await snapshot(checkout);
  await writeFile(path.join(checkout, "untracked.txt"), "new");
  await expect(runGitAction(checkout, ready.revision, { kind: "push" })).rejects.toThrow(/local changes/);
  await rm(path.join(checkout, "untracked.txt"));
  await writeFile(path.join(checkout, ".git", "CHERRY_PICK_HEAD"), local);
  await expect(runGitAction(checkout, ready.revision, { kind: "push" })).rejects.toThrow(/pending Git operation/);
  await rm(path.join(checkout, ".git", "CHERRY_PICK_HEAD"));

  await runGitAction(checkout, ready.revision, { kind: "push" });
  expect((await git(remote, ["rev-parse", "refs/heads/main"])).trim()).toBe(local);
  expect(await git(remote, ["for-each-ref", "--format=%(refname)"])).toBe("refs/heads/main\n");
  await git(checkout, ["branch", "--unset-upstream"]);
  expect((await snapshot(checkout)).blockers.push).toMatch(/upstream/);
  await git(checkout, ["switch", "--detach", "HEAD"]);
  const detached = await snapshot(checkout);
  expect(detached.branch).toBeNull();
  expect(detached.blockers.push).toMatch(/Check out a branch/);
});

it("diffs only the selected file and shows staged edits when the working copy matches HEAD", async () => {
  const { checkout } = await setup();
  await writeFile(path.join(checkout, "base.txt"), "staged line\n");
  await git(checkout, ["add", "base.txt"]);
  await writeFile(path.join(checkout, "base.txt"), "working line\n");
  await writeFile(path.join(checkout, "other.txt"), "unrelated file\n");
  const { revision } = await snapshot(checkout);

  const working = await gitFileDiff(checkout, revision, "base.txt");
  expect(working.diff).toContain("-base\n+working line");
  expect(working.diff).not.toContain("other.txt");
  expect(working.untracked).toEqual([]);

  await writeFile(path.join(checkout, "base.txt"), "base\n");
  const staged = await gitFileDiff(checkout, revision, "base.txt");
  expect(staged.diff).toContain("-base\n+staged line");
  expect(staged.status).toMatch(/Showing the staged changes/);
  await expect(gitFileDiff(checkout, revision, "other.txt"))
    .resolves.toMatchObject({ diff: "", untracked: [{ path: "other.txt", text: "unrelated file\n" }] });
  await expect(gitFileDiff(checkout, revision, "../outside.txt")).rejects.toThrow(/Invalid checkout file path/);
  await expect(gitFileDiff(checkout, "0".repeat(64), "base.txt")).rejects.toThrow(/checkout changed/);

  await git(checkout, ["rm", "--force", "base.txt"]);
  const deleted = await gitFileDiff(checkout, revision, "base.txt");
  expect(deleted.diff).toContain("deleted file mode");
  expect(deleted.diff).toContain("-base");
});

it("shows conflicts and local file changes and safely previews only files inside the checkout", async () => {
  const { root, checkout } = await setup();
  await git(checkout, ["switch", "-c", "conflicting"]);
  await commit(checkout, "base.txt", "other branch\n");
  await git(checkout, ["switch", "main"]);
  await commit(checkout, "base.txt", "main branch\n");
  await expect(git(checkout, ["merge", "conflicting"])).rejects.toThrow();

  const unusual = "space and\nnewline.txt";
  await writeFile(path.join(checkout, unusual), "<script>plain text</script>");
  await writeFile(path.join(checkout, "large.txt"), Buffer.alloc(512 * 1024 + 1, 97));
  await writeFile(path.join(checkout, "binary"), Buffer.from([0, 1, 2]));
  await writeFile(path.join(checkout, "ignored.txt"), "ignored");
  await writeFile(path.join(root, "outside.txt"), "outside");
  await symlink(path.join(root, "outside.txt"), path.join(checkout, "link"));
  const conflicted = await snapshot(checkout);
  expect(conflicted.files).toContainEqual({ path: "base.txt", status: "conflict" });
  expect(conflicted.files).toContainEqual({ path: unusual, status: "changed" });
  expect(conflicted.files.some((entry) => entry.path === "ignored.txt")).toBe(false);
  expect(conflicted.blockers.switch).toMatch(/pending Git operation/);

  const preview = (file: string) => gitPreview(checkout, "test/repo", conflicted.revision, file);
  await expect(preview("base.txt")).resolves.toMatchObject({ kind: "text", text: expect.stringContaining("<<<<<<< HEAD") });
  await expect(gitFileDiff(checkout, conflicted.revision, "base.txt"))
    .resolves.toMatchObject({ diff: expect.stringContaining("+<<<<<<< HEAD") });
  await expect(preview(unusual)).resolves.toMatchObject({ kind: "text", text: "<script>plain text</script>" });
  await expect(preview("link")).resolves.toMatchObject({ kind: "unsupported" });
  await expect(preview("large.txt")).resolves.toMatchObject({ kind: "too-large" });
  await expect(preview("binary")).resolves.toMatchObject({ kind: "binary" });
  await expect(preview("ignored.txt")).resolves.toMatchObject({ kind: "missing" });
  await expect(preview("../outside.txt")).rejects.toThrow(/Invalid checkout file path/);
  await expect(preview(".git/config")).rejects.toThrow(/Invalid checkout file path/);

  await git(checkout, ["merge", "--abort"]);
  await git(checkout, ["rm", "base.txt"]);
  const deleted = await snapshot(checkout);
  expect(deleted.files).toContainEqual({ path: "base.txt", status: "changed" });
  await expect(gitPreview(checkout, "test/repo", deleted.revision, "base.txt")).resolves.toMatchObject({ kind: "missing" });
  await mkdir(path.join(checkout, "nested"));
  await expect(resolveGitCheckout(path.join(checkout, "nested"))).rejects.toThrow(/root of a Git checkout/);
});

it("links an existing path to its last known published GitHub commit", async () => {
  const { checkout } = await setup();
  const published = (await git(checkout, ["rev-parse", "HEAD"])).trim();
  await git(checkout, ["remote", "set-url", "origin", "git@github.com:octo/project.git"]);
  await commit(checkout, "unpublished.txt", "local");
  const ready = await snapshot(checkout);
  await expect(gitPreview(checkout, "octo/project", ready.revision, "base.txt"))
    .resolves.toMatchObject({ kind: "text", publishedCommit: published });
  await expect(gitPreview(checkout, "octo/project", ready.revision, "unpublished.txt"))
    .resolves.toMatchObject({ kind: "text", publishedCommit: undefined });
  await expect(gitPreview(checkout, "other/repo", ready.revision, "base.txt"))
    .resolves.toMatchObject({ kind: "text", publishedCommit: undefined });
});
