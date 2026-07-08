import type { PullRequestSummary, RepoSummary } from "../shared/github";

export type ProjectPullRequestTab = "open" | "closed";

export function formatDuration(value?: number | null): string {
  if (!value) {
    return "";
  }

  const seconds = Math.floor(value / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${remainder}s`;
  }

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function shortSha(value?: string | null): string {
  return value ? value.slice(0, 7) : "";
}

export function statusTone(status?: string | null, conclusion?: string | null): string {
  const value = (conclusion || status || "").toLowerCase();
  if (["success", "completed", "approved", "mergeable", "merged"].includes(value)) {
    return "good";
  }
  if (["failure", "error", "timed_out", "cancelled", "changes_requested", "conflicting"].includes(value)) {
    return "bad";
  }
  if (["in_progress", "queued", "pending", "requested", "waiting"].includes(value)) {
    return "running";
  }
  if (["neutral", "skipped", "closed", "draft"].includes(value)) {
    return "muted";
  }
  return "unknown";
}

export function pullRequestTabForState(pr: PullRequestSummary): ProjectPullRequestTab {
  return pr.state === "CLOSED" || pr.state === "MERGED" ? "closed" : "open";
}

export function canSubmitPullRequestReview(repo: RepoSummary): boolean {
  return ["ADMIN", "MAINTAIN", "WRITE"].includes(repo.viewerPermission ?? "");
}

export function canSubmitPullRequestReviewForPullRequest(
  repo: RepoSummary,
  pr: PullRequestSummary,
  viewerLogin?: string | null
): boolean {
  if (!canSubmitPullRequestReview(repo) || !viewerLogin) {
    return false;
  }
  if (!pr.author?.login) {
    return true;
  }

  return pr.author.login.toLowerCase() !== viewerLogin.toLowerCase();
}

export function isLiveStatus(status?: string | null): boolean {
  return ["queued", "waiting", "pending", "requested", "in_progress"].includes((status ?? "").toLowerCase());
}
