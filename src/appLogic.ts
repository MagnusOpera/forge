import type {
  LabelSummary,
  PullRequestReview,
  PullRequestReviewEvent,
  PullRequestSummary,
  RepoSummary,
  WorkflowRunSummary
} from "../shared/github";

export type ProjectPullRequestTab = "open" | "closed";
export type PullRequestWorkflowState = "auto-ready" | "manual-ready" | "draft";
export type FavoriteRepoSnapshots = Record<string, RepoSummary>;
export type GithubUrlClickAction = "copy" | "open";

function repoSnapshotKey(repo: Pick<RepoSummary, "owner" | "name">): string {
  return `${repo.owner}/${repo.name}`;
}

const repositoryNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base"
});

export function groupRepositoriesByOwner(repos: RepoSummary[]): Array<[string, RepoSummary[]]> {
  const groups = new Map<string, RepoSummary[]>();
  for (const repo of repos) {
    const list = groups.get(repo.owner) ?? [];
    list.push(repo);
    groups.set(repo.owner, list);
  }

  return Array.from(groups.entries())
    .map(([owner, ownerRepos]) => [
      owner,
      [...ownerRepos].sort((left, right) => repositoryNameCollator.compare(left.name, right.name))
    ] as [string, RepoSummary[]])
    .sort(([leftOwner], [rightOwner]) => repositoryNameCollator.compare(leftOwner, rightOwner));
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

export function pullRequestWorkflowState(pr: PullRequestSummary): PullRequestWorkflowState | null {
  if (pr.isDraft && pr.autoMergeEnabled) {
    return null;
  }
  if (pr.isDraft) {
    return "draft";
  }
  return pr.autoMergeEnabled ? "auto-ready" : "manual-ready";
}

export function canSubmitPullRequestReview(repo: RepoSummary): boolean {
  return ["ADMIN", "MAINTAIN", "WRITE"].includes(repo.viewerPermission ?? "");
}

export function canManagePullRequest(repo: RepoSummary): boolean {
  return canSubmitPullRequestReview(repo);
}

export function repositoryAllowsPullRequestAutoMerge(repo: RepoSummary): boolean {
  return repo.autoMergeAllowed !== false;
}

export function canUpdatePullRequestLabels(repo: RepoSummary): boolean {
  return ["ADMIN", "MAINTAIN", "WRITE", "TRIAGE"].includes(repo.viewerPermission ?? "");
}

function normalizedLabelName(value: string): string {
  return value.trim().toLowerCase();
}

export function addPullRequestLabelOptimistically(
  currentLabels: LabelSummary[],
  repoLabels: LabelSummary[],
  labelNameValue: string
): LabelSummary[] {
  const labelName = labelNameValue.trim();
  if (!labelName) {
    return currentLabels;
  }

  const normalizedName = normalizedLabelName(labelName);
  if (currentLabels.some((label) => normalizedLabelName(label.name) === normalizedName)) {
    return currentLabels;
  }

  const repoLabel = repoLabels.find((label) => normalizedLabelName(label.name) === normalizedName);
  return [
    ...currentLabels,
    repoLabel ?? {
      id: `optimistic-label:${normalizedName}`,
      name: labelName,
      color: "d0d7de"
    }
  ];
}

export function removePullRequestLabelOptimistically(
  currentLabels: LabelSummary[],
  labelNameValue: string
): LabelSummary[] {
  const normalizedName = normalizedLabelName(labelNameValue);
  if (!normalizedName) {
    return currentLabels;
  }

  const nextLabels = currentLabels.filter((label) => normalizedLabelName(label.name) !== normalizedName);
  return nextLabels.length === currentLabels.length ? currentLabels : nextLabels;
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

export function canUpdatePullRequestDraftState(
  repo: RepoSummary,
  pr: PullRequestSummary,
  viewerLogin?: string | null
): boolean {
  if (pr.state !== "OPEN") {
    return false;
  }
  return canUpdatePullRequestTitle(repo, pr, viewerLogin);
}

export function reviewDecisionForReviewEvent(event: PullRequestReviewEvent): "APPROVED" | "CHANGES_REQUESTED" {
  if (event === "APPROVE") {
    return "APPROVED";
  }
  return "CHANGES_REQUESTED";
}

function reviewEventForState(state?: string | null): PullRequestReviewEvent | null {
  if (state === "APPROVED") {
    return "APPROVE";
  }
  if (state === "CHANGES_REQUESTED") {
    return "REQUEST_CHANGES";
  }
  return null;
}

function submittedAtMs(review: PullRequestReview): number | null {
  const value = review.submittedAt ? Date.parse(review.submittedAt) : Number.NaN;
  return Number.isNaN(value) ? null : value;
}

function isNewerReview(
  left: PullRequestReview,
  leftIndex: number,
  right: PullRequestReview,
  rightIndex: number
): boolean {
  const leftSubmittedAt = submittedAtMs(left);
  const rightSubmittedAt = submittedAtMs(right);

  if (leftSubmittedAt !== null && rightSubmittedAt !== null && leftSubmittedAt !== rightSubmittedAt) {
    return leftSubmittedAt > rightSubmittedAt;
  }
  if (leftSubmittedAt !== null && rightSubmittedAt === null) {
    return true;
  }
  if (leftSubmittedAt === null && rightSubmittedAt !== null) {
    return false;
  }
  return leftIndex > rightIndex;
}

export function latestViewerPullRequestReviewEvent(
  reviews: PullRequestReview[],
  viewerLogin?: string | null
): PullRequestReviewEvent | null {
  if (!viewerLogin) {
    return null;
  }

  const normalizedViewerLogin = viewerLogin.toLowerCase();
  let latest: { review: PullRequestReview; index: number; event: PullRequestReviewEvent } | null = null;

  for (const [index, review] of reviews.entries()) {
    if (review.author?.login?.toLowerCase() !== normalizedViewerLogin) {
      continue;
    }

    const event = reviewEventForState(review.state);
    if (!event) {
      continue;
    }

    if (!latest || isNewerReview(review, index, latest.review, latest.index)) {
      latest = { review, index, event };
    }
  }

  return latest?.event ?? null;
}

export function isLiveStatus(status?: string | null): boolean {
  return ["queued", "waiting", "pending", "requested", "in_progress"].includes((status ?? "").toLowerCase());
}

export function githubUrlClickActionForDetail(detail: number): GithubUrlClickAction {
  return detail >= 2 ? "open" : "copy";
}

function notificationKeySet(keys: ReadonlySet<string> | readonly string[] | null | undefined): Set<string> | null {
  if (!keys) {
    return null;
  }
  return keys instanceof Set ? new Set(keys) : new Set(keys);
}

function isOpenPullRequest(pr: PullRequestSummary): boolean {
  return pr.state !== "CLOSED" && pr.state !== "MERGED";
}

export function openPullRequestNotificationKey(pr: PullRequestSummary): string {
  return pr.id || `pull-request:${pr.number}`;
}

export function openPullRequestNotificationKeys(pullRequests: PullRequestSummary[]): string[] {
  return pullRequests.filter(isOpenPullRequest).map(openPullRequestNotificationKey);
}

export function findNewOpenPullRequests(
  previousKeys: ReadonlySet<string> | readonly string[] | null | undefined,
  pullRequests: PullRequestSummary[]
): PullRequestSummary[] {
  const previous = notificationKeySet(previousKeys);
  if (!previous) {
    return [];
  }

  return pullRequests.filter(
    (pr) => isOpenPullRequest(pr) && !previous.has(openPullRequestNotificationKey(pr))
  );
}

export function isFailedWorkflowRun(run: WorkflowRunSummary): boolean {
  return ["failure", "timed_out", "action_required", "startup_failure"].includes(
    (run.conclusion ?? "").toLowerCase()
  );
}

export function failedWorkflowRunNotificationKey(run: WorkflowRunSummary): string {
  return String(run.id);
}

export function failedWorkflowRunNotificationKeys(workflowRuns: WorkflowRunSummary[]): string[] {
  return workflowRuns.filter(isFailedWorkflowRun).map(failedWorkflowRunNotificationKey);
}

export function findNewFailedWorkflowRuns(
  previousKeys: ReadonlySet<string> | readonly string[] | null | undefined,
  workflowRuns: WorkflowRunSummary[]
): WorkflowRunSummary[] {
  const previous = notificationKeySet(previousKeys);
  if (!previous) {
    return [];
  }

  return workflowRuns.filter(
    (run) => isFailedWorkflowRun(run) && !previous.has(failedWorkflowRunNotificationKey(run))
  );
}
