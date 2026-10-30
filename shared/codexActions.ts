import { codexIsActive, type CodexThreadSummary } from "./codex.js";
export type CodexQuickAction = "commit" | "push" | "create-pr";
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
