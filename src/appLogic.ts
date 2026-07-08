import type { PullRequestSummary, RepoSummary } from "../shared/github";

export type ProjectPullRequestTab = "open" | "closed";
export type FavoriteRepoSnapshots = Record<string, RepoSummary>;

function repoSnapshotKey(repo: Pick<RepoSummary, "owner" | "name">): string {
  return `${repo.owner}/${repo.name}`;
}

export function mergeFavoriteRepoSnapshots(
  current: FavoriteRepoSnapshots,
  favoriteKeys: string[],
  repos: RepoSummary[]
): FavoriteRepoSnapshots {
  const favoriteKeySet = new Set(favoriteKeys);
  const next: FavoriteRepoSnapshots = {};
  let changed = false;

  for (const key of favoriteKeys) {
    if (current[key]) {
      next[key] = current[key];
    }
  }

  for (const key of Object.keys(current)) {
    if (!favoriteKeySet.has(key)) {
      changed = true;
    }
  }

  for (const repo of repos) {
    const key = repoSnapshotKey(repo);
    if (!favoriteKeySet.has(key)) {
      continue;
    }
    if (next[key] !== repo) {
      next[key] = repo;
      changed = true;
    }
  }

  for (const key of favoriteKeys) {
    if (next[key] !== current[key]) {
      changed = true;
    }
  }

  return changed ? next : current;
}

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

export function canUpdatePullRequestLabels(repo: RepoSummary): boolean {
  return ["ADMIN", "MAINTAIN", "WRITE", "TRIAGE"].includes(repo.viewerPermission ?? "");
}

export function isPullRequestAuthor(pr: PullRequestSummary, viewerLogin?: string | null): boolean {
  return Boolean(viewerLogin && pr.author?.login && pr.author.login.toLowerCase() === viewerLogin.toLowerCase());
}

export function canSubmitPullRequestReviewForPullRequest(
  repo: RepoSummary,
  pr: PullRequestSummary,
  viewerLogin?: string | null
): boolean {
  if (!canSubmitPullRequestReview(repo) || !viewerLogin) {
    return false;
  }
  return !isPullRequestAuthor(pr, viewerLogin);
}

export function canUpdatePullRequestTitle(
  repo: RepoSummary,
  pr: PullRequestSummary,
  viewerLogin?: string | null
): boolean {
  return canSubmitPullRequestReview(repo) || isPullRequestAuthor(pr, viewerLogin);
}

export function isLiveStatus(status?: string | null): boolean {
  return ["queued", "waiting", "pending", "requested", "in_progress"].includes((status ?? "").toLowerCase());
}
