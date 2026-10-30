import { codexIsActive, type CodexThreadSummary } from "./codex.js";
export type CodexQuickAction = "sync" | "commit" | "push" | "create-pr";
export function codexQuickActionUnavailable(
  thread?: CodexThreadSummary,
): string | undefined {
  if (!thread?.worktree) return "Send the first message to create a worktree.";
  if (thread.archived) return "Restore this thread before running Git actions.";
  if (codexIsActive(thread))
    return "Wait for the current turn to finish or stop it first.";
  if (thread.settings.mode === "plan")
    return "Switch this thread to Implement mode to run Git actions.";
  return undefined;
}
export function codexQuickActionPrompt(action: CodexQuickAction): string {
  switch (action) {
    case "sync":
      return "Merge the repository's current default branch into this thread's current worktree branch. Inspect the worktree, current branch, origin remote, and repository instructions first. Determine the default branch from the origin remote's advertised HEAD using git ls-remote --symref origin HEAD, or authoritative GitHub repository metadata for that same remote. Do not assume the branch is named main or master, and do not use a stale local origin/HEAD without verifying it. If the remote or its default branch cannot be determined unambiguously, stop and report the blocker instead of guessing. Fetch origin, then merge the fetched origin/<default-branch> into the current worktree branch without switching branches. Preserve existing commits and files. If there are uncommitted changes or an existing merge/rebase in progress, stop and explain the blocker; do not automatically stash, commit, discard changes, or abort another operation. Do not rebase, reset, force-push, push, or create a pull request. A merge commit is allowed when required by the merge, but do not create unrelated commits. If merge conflicts occur, report the conflicting files and ask how to proceed before resolving or aborting the merge. Run relevant checks after a successful merge and report the resolved default branch and result.";
    case "commit":
      return "Commit the pending changes in this thread's worktree on its current branch. Inspect the changes, follow the repository's AGENTS.md and changelog requirements, and run the relevant checks. Stage only the changes belonging to this task and use a concise, descriptive commit message. If there is nothing to commit, say so. Do not amend existing commits, push, create a pull request, or change branches. Report the commit and verification results.";
    case "push":
      return "Push the existing commits on this thread's current branch to its intended GitHub remote, setting upstream if necessary. Inspect the branch and remote first. Report any uncommitted changes; do not silently commit them. Do not force-push, change branches, merge, or create a pull request. Report the pushed branch and result.";
    case "create-pr":
      return "Create a GitHub pull request for this thread's current branch against the repository's default branch. Inspect the changes and repository instructions, and include a concise description and actual verification results. If there are uncommitted changes, ask me to commit them before publishing. Push the branch normally if necessary, using the repository's available GitHub tooling and authentication. Reuse an existing pull request for this branch instead of creating a duplicate. Do not force-push, merge, or change branches. Return the pull request URL. If authentication or tooling is unavailable, report the blocker without requesting or exposing tokens.";
    default:
      throw new Error("Unsupported Codex Git action.");
  }
}
