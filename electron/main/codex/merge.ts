import { access, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { CodexMergeConflict, CodexThread } from "../../../shared/codex.js";
import { assertWorktree, git } from "./git.js";

export type WorktreeMergePlan = {
  sourceBranch: string;
  sourceCommit: string;
  worktree: string;
  defaultBranch: string;
  remote: string;
  remoteCommit: string;
  localCommit: string | null;
  targetCommit: string;
  targetPath: string;
  createTarget: boolean;
  commits: number;
  summary: string;
};
export type WorktreeMergeResult = {
  branch: string;
  commit: string;
  worktreeRemoved: boolean;
  warning?: string;
};
export class WorktreeMergeConflict extends Error {
  constructor(readonly conflict: CodexMergeConflict) {
    super(`The worktree conflicts with ${conflict.defaultBranch}. Resolve the conflicting files with Codex, then retry the merge. Nothing was merged or discarded.`);
  }
}

export function mergeConflictFiles(output: string): string[] {
  // With --name-only -z: tree ID, conflict paths, an empty field, diagnostics.
  return output.split("\0\0", 1)[0].split("\0").slice(1).filter(Boolean);
}
const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );
async function isAncestor(
  cwd: string,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  return git(cwd, ["merge-base", "--is-ancestor", ancestor, descendant]).then(
    () => true,
    () => false,
  );
}
export async function cleanCheckout(cwd: string): Promise<void> {
  if (
    (await git(cwd, ["status", "--porcelain", "--untracked-files=all"])).trim()
  )
    throw new Error(
      `Commit or remove uncommitted changes before changing checkout: ${cwd}`,
    );
  for (const name of [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
    "BISECT_LOG",
  ]) {
    const file = (
      await git(cwd, [
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        name,
      ])
    ).trim();
    if (await exists(file))
      throw new Error(
        `Finish the existing Git operation before changing checkout: ${cwd}`,
      );
  }
}
export async function assertManagedWorktree(
  thread: CodexThread,
  storeRoot: string,
): Promise<void> {
  if (
    thread.sourceHome ||
    !/^[a-f0-9-]{36}$/.test(thread.id) ||
    thread.branch !==
      `codex/forge-${thread.id}${thread.worktreeGeneration ? `-${thread.worktreeGeneration}` : ""}`
  )
    throw new Error(
      "Only worktrees created by Forge can be merged and discarded here.",
    );
  await assertWorktree(thread);
  const root = await realpath(path.join(storeRoot, "worktrees"));
  if ((await realpath(thread.worktree)) !== path.join(root, thread.id))
    throw new Error("This is not the thread's managed Forge worktree.");
}
export function parseWorktreeBranches(
  output: string,
): { path: string; branch: string; locked: boolean }[] {
  return output
    .split("\0\0")
    .filter(Boolean)
    .map((record) => {
      const fields = record.split("\0");
      return {
        path:
          fields.find((field) => field.startsWith("worktree "))?.slice(9) ?? "",
        branch:
          fields
            .find((field) => field.startsWith("branch refs/heads/"))
            ?.slice(18) ?? "",
        locked: fields.some(
          (field) => field === "locked" || field.startsWith("locked "),
        ),
      };
    });
}
export async function prepareWorktreeMerge(
  thread: CodexThread,
  storeRoot: string,
): Promise<WorktreeMergePlan> {
  await assertManagedWorktree(thread, storeRoot);
  await cleanCheckout(thread.worktree);
  const repository = thread.repositoryPath;
  const remote = (
    await git(repository, ["remote", "get-url", "origin"])
  ).trim();
  const advertised = await git(repository, [
    "ls-remote",
    "--symref",
    "origin",
    "HEAD",
  ]);
  const defaultBranch = advertised.match(
    /^ref: refs\/heads\/(.+)\tHEAD$/m,
  )?.[1];
  if (!defaultBranch)
    throw new Error("The origin remote did not advertise a default branch.");
  await git(repository, ["check-ref-format", "--branch", defaultBranch]);
  await git(repository, [
    "fetch",
    "--no-tags",
    "origin",
    `refs/heads/${defaultBranch}`,
  ]);
  const remoteCommit = (
    await git(repository, ["rev-parse", "--verify", "FETCH_HEAD^{commit}"])
  ).trim();
  const sourceCommit = (
    await git(thread.worktree, ["rev-parse", "HEAD^{commit}"])
  ).trim();
  const localCommit = await git(repository, [
    "rev-parse",
    "--verify",
    `refs/heads/${defaultBranch}^{commit}`,
  ]).then(
    (value) => value.trim(),
    () => null,
  );
  let targetCommit = remoteCommit;
  if (
    localCommit &&
    !(await isAncestor(repository, localCommit, remoteCommit))
  ) {
    if (!(await isAncestor(repository, remoteCommit, localCommit)))
      throw new Error(
        `Local ${defaultBranch} has diverged from origin. Synchronize it before merging this worktree.`,
      );
    targetCommit = localCommit;
  }
  const checkouts = parseWorktreeBranches(
    await git(repository, ["worktree", "list", "--porcelain", "-z"]),
  ).filter((entry) => entry.branch === defaultBranch);
  if (checkouts.length > 1 || checkouts[0]?.locked)
    throw new Error(`The ${defaultBranch} checkout is locked or ambiguous.`);
  const temporary = path.join(storeRoot, "integrations", thread.id);
  const targetPath = checkouts[0]?.path || temporary;
  if (checkouts.length) {
    if ((await realpath(targetPath)) === (await realpath(thread.worktree)))
      throw new Error("The source and target worktrees must be different.");
    await cleanCheckout(targetPath);
    if (
      (await git(targetPath, ["branch", "--show-current"])).trim() !==
      defaultBranch
    )
      throw new Error("The default branch checkout changed. Try again.");
  } else if (await exists(temporary))
    throw new Error(`The integration folder already exists: ${temporary}`);
  try {
    await git(repository, [
      "merge-tree",
      "--write-tree",
      "--name-only",
      "-z",
      targetCommit,
      sourceCommit,
    ]);
  } catch (error) {
    const failure = error as { code?: number; stdout?: string };
    if (failure.code !== 1 || !failure.stdout) throw error;
    const files = mergeConflictFiles(failure.stdout);
    if (!files.length) throw error;
    throw new WorktreeMergeConflict({
      defaultBranch, targetCommit, sourceCommit, sourceBranch: thread.branch, files,
    });
  }
  const commits = Number(
    (
      await git(repository, [
        "rev-list",
        "--count",
        `${targetCommit}..${sourceCommit}`,
      ])
    ).trim(),
  );
  const summary = await git(repository, [
    "log",
    "--max-count=10",
    "--format=%h %s",
    `${targetCommit}..${sourceCommit}`,
  ]);
  return {
    sourceBranch: thread.branch,
    sourceCommit,
    worktree: thread.worktree,
    defaultBranch,
    remote,
    remoteCommit,
    localCommit,
    targetCommit,
    targetPath,
    createTarget: !checkouts.length,
    commits,
    summary: summary.trim(),
  };
}
export function sameMergePlan(
  first: WorktreeMergePlan,
  second: WorktreeMergePlan,
): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

export async function discardMergedWorktree(
  thread: CodexThread,
  storeRoot: string,
): Promise<void> {
  await assertManagedWorktree(thread, storeRoot);
  const merged = thread.mergedInto;
  if (!merged) throw new Error("The worktree has not been merged.");
  await cleanCheckout(thread.worktree);
  const head = (
    await git(thread.worktree, ["rev-parse", "HEAD^{commit}"])
  ).trim();
  if (
    head !== merged.sourceCommit ||
    !(await isAncestor(
      thread.repositoryPath,
      head,
      `refs/heads/${merged.branch}`,
    ))
  )
    throw new Error(
      "The worktree contains commits that are not in the merged default branch. It was kept.",
    );
  await git(thread.repositoryPath, [
    "worktree",
    "remove",
    "--",
    thread.worktree,
  ]);
}
export async function executeWorktreeMerge(
  thread: CodexThread,
  storeRoot: string,
  plan: WorktreeMergePlan,
  recordMerge: (result: WorktreeMergeResult) => void,
): Promise<WorktreeMergeResult> {
  const fresh = await prepareWorktreeMerge(thread, storeRoot);
  if (!sameMergePlan(plan, fresh))
    throw new Error(
      "The repository changed while confirmation was open. Review the merge again.",
    );
  if (plan.createTarget) {
    await mkdir(path.dirname(plan.targetPath), {
      recursive: true,
      mode: 0o700,
    });
    await git(
      thread.repositoryPath,
      plan.localCommit
        ? ["worktree", "add", "--", plan.targetPath, plan.defaultBranch]
        : [
            "worktree",
            "add",
            "-b",
            plan.defaultBranch,
            "--",
            plan.targetPath,
            plan.remoteCommit,
          ],
    );
  }
  try {
    if (plan.localCommit !== plan.targetCommit)
      await git(plan.targetPath, ["merge", "--ff-only", plan.targetCommit]);
    if (
      (await git(plan.targetPath, ["branch", "--show-current"])).trim() !==
      plan.defaultBranch
    )
      throw new Error("The target branch changed.");
    await git(plan.targetPath, ["merge", "--no-edit", plan.sourceCommit]);
    if (!(await isAncestor(plan.targetPath, plan.sourceCommit, "HEAD")))
      throw new Error("The source commits were not included.");
    if (
      (await git(plan.targetPath, ["branch", "--show-current"])).trim() !==
      plan.defaultBranch
    )
      throw new Error("The target branch changed during merging.");
    await cleanCheckout(plan.targetPath);
  } catch (error) {
    throw new Error(
      `Merge could not finish in ${plan.targetPath}. The source worktree was kept. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const commit = (
    await git(plan.targetPath, ["rev-parse", "HEAD^{commit}"])
  ).trim();
  const result: WorktreeMergeResult = {
    branch: plan.defaultBranch,
    commit,
    worktreeRemoved: false,
  };
  // Persist the successful merge before deleting anything, so cleanup can be retried.
  recordMerge(result);
  try {
    await discardMergedWorktree(thread, storeRoot);
    result.worktreeRemoved = true;
  } catch (error) {
    result.warning = `Merged into ${plan.defaultBranch}, but the worktree was kept: ${error instanceof Error ? error.message : String(error)}`;
  }

  return result;
}
