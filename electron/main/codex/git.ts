import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, realpath, readFile } from "node:fs/promises";
import path from "node:path";
import type { CodexGitInfo, CodexThread } from "../../../shared/codex.js";
const exec = promisify(execFile);
export async function git(cwd: string, args: string[]): Promise<string> {
  return (
    await exec("git", ["-c", "core.fsmonitor=false", ...args], {
      cwd,
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    })
  ).stdout;
}
export async function inspectRepository(
  folder: string,
  fullName: string,
): Promise<{ path: string; warning?: string; dirty: boolean }> {
  const root = (await git(folder, ["rev-parse", "--show-toplevel"])).trim();
  const canonical = await realpath(root);
  await git(canonical, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const remote = await git(canonical, ["remote", "get-url", "origin"]).catch(
    () => "",
  );
  const match = remote
    .trim()
    .match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/i);
  return {
    path: canonical,
    dirty: Boolean((await git(canonical, ["status", "--porcelain"])).trim()),
    ...(match?.[1].toLowerCase() === fullName.toLowerCase()
      ? {}
      : {
          warning:
            "The origin remote does not match this GitHub project. Confirm that this is the intended checkout or fork.",
        }),
  };
}
export async function createWorktree(
  repository: string,
  root: string,
  id: string,
): Promise<{ worktree: string; branch: string; baseCommit: string }> {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid thread ID.");
  const baseCommit = (
    await git(repository, ["rev-parse", "--verify", "HEAD^{commit}"])
  ).trim();
  const branch = `codex/forge-${id}`,
    worktree = path.join(root, id);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await git(repository, [
    "worktree",
    "add",
    "-b",
    branch,
    worktree,
    baseCommit,
  ]);
  return { worktree, branch, baseCommit };
}
export async function assertWorktree(thread: CodexThread): Promise<void> {
  if (!thread.worktree)
    throw new Error(
      "This thread has no worktree yet. Send its first message to create one.",
    );
  const root = (
    await git(thread.worktree, ["rev-parse", "--show-toplevel"])
  ).trim();
  if ((await realpath(root)) !== (await realpath(thread.worktree)))
    throw new Error(
      "The thread worktree has moved or is missing. Restore it before resuming.",
    );
  const common = (
    await git(thread.worktree, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ])
  ).trim();
  const expected = (
    await git(thread.repositoryPath, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ])
  ).trim();
  if ((await realpath(common)) !== (await realpath(expected)))
    throw new Error(
      "The worktree no longer belongs to this thread's repository.",
    );
  if (
    (await git(thread.worktree, ["branch", "--show-current"])).trim() !==
    thread.branch
  )
    throw new Error(
      "The worktree branch has changed. Restore the recorded thread branch before resuming.",
    );
}
export async function gitInfo(thread: CodexThread): Promise<CodexGitInfo> {
  await assertWorktree(thread);
  const [status, diff, untrackedNames] = await Promise.all([
    git(thread.worktree, ["status", "--short"]),
    git(thread.worktree, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      thread.baseCommit,
      "--",
    ]),
    git(thread.worktree, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  const untracked = await Promise.all(
    untrackedNames
      .split("\0")
      .filter(Boolean)
      .map(async (name) => {
        try {
          const file = await realpath(path.join(thread.worktree, name));
          if (!file.startsWith(`${await realpath(thread.worktree)}${path.sep}`))
            return { path: name, text: "Symlink outside the worktree." };
          const data = await readFile(file);
          return {
            path: name,
            text: data.includes(0) ? "Binary file" : data.toString("utf8"),
          };
        } catch {
          return { path: name, text: "File unavailable" };
        }
      }),
  );
  return { status, diff, untracked };
}
