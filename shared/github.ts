export type CacheSource = "network" | "cache";

export interface CacheEnvelope<T> {
  data: T;
  fetchedAt: string;
  stale: boolean;
  source: CacheSource;
}

export interface CacheRequestOptions {
  force?: boolean;
}

export interface AuthStatus {
  configured: boolean;
  encryptionAvailable: boolean;
  viewerLogin: string | null;
}

export interface RepoRef {
  owner: string;
  name: string;
}

export type RepositoryPermission = "ADMIN" | "MAINTAIN" | "WRITE" | "TRIAGE" | "READ" | "NONE" | null;

export interface ActorSummary {
  login: string;
  avatarUrl?: string | null;
  url?: string | null;
}

export interface LabelSummary {
  id: string;
  name: string;
  color: string;
}

export interface RepoSummary extends RepoRef {
  id: string;
  fullName: string;
  description?: string | null;
  defaultBranch?: string | null;
  viewerPermission?: RepositoryPermission;
  isPrivate: boolean;
  isArchived: boolean;
  isFork: boolean;
  ownerAvatarUrl?: string | null;
  updatedAt?: string | null;
  pushedAt?: string | null;
  url: string;
}

export interface OrganizationSummary {
  id: string;
  login: string;
  name?: string | null;
  avatarUrl?: string | null;
  url: string;
}

export type PullRequestReviewDecision =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "REVIEW_REQUIRED"
  | null;

export type PullRequestMergeable = "MERGEABLE" | "CONFLICTING" | "UNKNOWN" | null;

export type CheckState =
  | "SUCCESS"
  | "FAILURE"
  | "ERROR"
  | "PENDING"
  | "EXPECTED"
  | "NEUTRAL"
  | "CANCELLED"
  | "SKIPPED"
  | "TIMED_OUT"
  | "ACTION_REQUIRED"
  | "UNKNOWN"
  | null;

export interface PullRequestSummary {
  id: string;
  number: number;
  title: string;
  author?: ActorSummary | null;
  labels: LabelSummary[];
  state: string;
  isDraft: boolean;
  reviewDecision: PullRequestReviewDecision;
  mergeable: PullRequestMergeable;
  ciState: CheckState;
  headRefName: string;
  baseRefName: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface IssueSummary {
  id: string;
  number: number;
  title: string;
  author?: ActorSummary | null;
  labels: LabelSummary[];
  state: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface WorkflowSummary {
  id: number;
  nodeId?: string;
  name: string;
  path: string;
  state: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  url: string;
  htmlUrl?: string | null;
  badgeUrl?: string | null;
}

export interface WorkflowRunSummary {
  id: number;
  workflowId: number;
  name?: string | null;
  displayTitle?: string | null;
  status?: string | null;
  conclusion?: string | null;
  event?: string | null;
  branch?: string | null;
  commitSha?: string | null;
  commitMessage?: string | null;
  actor?: ActorSummary | null;
  runStartedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  durationMs?: number | null;
  url: string;
}

export interface TimelineComment {
  id: string;
  author?: ActorSummary | null;
  body: string;
  createdAt: string;
  updatedAt?: string | null;
  url?: string | null;
}

export interface PullRequestReview {
  id: string;
  state: string;
  author?: ActorSummary | null;
  body?: string | null;
  submittedAt?: string | null;
  url?: string | null;
}

export interface CommitSummary {
  oid: string;
  messageHeadline: string;
  authoredDate?: string | null;
  authorName?: string | null;
  url: string;
}

export interface ChangedFileSummary {
  path: string;
  previousPath?: string | null;
  additions: number;
  deletions: number;
  changes: number;
  changeType: string;
  patch?: string | null;
  url?: string | null;
}

export interface CheckSummary {
  name: string;
  status?: string | null;
  conclusion?: string | null;
  url?: string | null;
  checkRunId?: number | null;
  jobId?: number | null;
  workflowRunId?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface PullRequestDetail extends PullRequestSummary {
  body: string;
  comments: TimelineComment[];
  reviews: PullRequestReview[];
  commits: CommitSummary[];
  files: ChangedFileSummary[];
  checks: CheckSummary[];
}

export interface WorkflowJobStepSummary {
  name: string;
  status?: string | null;
  conclusion?: string | null;
  number?: number;
  startedAt?: string | null;
  completedAt?: string | null;
  log?: string | null;
}

export interface WorkflowJobSummary {
  id: number;
  name: string;
  status?: string | null;
  conclusion?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  url?: string | null;
  steps: WorkflowJobStepSummary[];
}

export interface ArtifactSummary {
  id: number;
  name: string;
  sizeInBytes?: number | null;
  expired?: boolean | null;
  createdAt?: string | null;
  expiresAt?: string | null;
  url?: string | null;
}

export interface WorkflowRunDetail extends WorkflowRunSummary {
  jobs: WorkflowJobSummary[];
  artifacts: ArtifactSummary[];
}

export interface WorkflowJobLogDetail {
  id: number;
  name: string;
  status?: string | null;
  conclusion?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  url?: string | null;
  steps: WorkflowJobStepSummary[];
  rawLog?: string | null;
  logUnavailableReason?: string | null;
}

export interface DispatchWorkflowPayload {
  repo: RepoRef;
  workflowId: number | string;
  ref: string;
  inputs?: Record<string, string>;
}

export type PullRequestReviewEvent = "APPROVE" | "REQUEST_CHANGES";

export interface SubmitPullRequestReviewPayload {
  repo: RepoRef;
  pullNumber: number;
  event: PullRequestReviewEvent;
  body?: string;
}

export interface AddPullRequestCommentPayload {
  repo: RepoRef;
  pullNumber: number;
  body: string;
}

export interface UpdatePullRequestTitlePayload {
  repo: RepoRef;
  pullNumber: number;
  title: string;
}

export interface PullRequestLabelPayload {
  repo: RepoRef;
  pullNumber: number;
  labelName: string;
}

export interface GithubFocusApi {
  getAuthStatus(): Promise<AuthStatus>;
  saveToken(token: string): Promise<AuthStatus>;
  clearToken(): Promise<AuthStatus>;
  getRepositories(): Promise<CacheEnvelope<RepoSummary[]>>;
  getStarredRepos(): Promise<CacheEnvelope<RepoSummary[]>>;
  getRecentRepos(): Promise<CacheEnvelope<RepoSummary[]>>;
  getOrganizations(): Promise<CacheEnvelope<OrganizationSummary[]>>;
  getRepo(repo: RepoRef, options?: CacheRequestOptions): Promise<CacheEnvelope<RepoSummary>>;
  getRepoLabels(repo: RepoRef, options?: CacheRequestOptions): Promise<CacheEnvelope<LabelSummary[]>>;
  getPullRequests(repo: RepoRef, options?: CacheRequestOptions): Promise<CacheEnvelope<PullRequestSummary[]>>;
  getIssues(repo: RepoRef, options?: CacheRequestOptions): Promise<CacheEnvelope<IssueSummary[]>>;
  getWorkflows(repo: RepoRef, options?: CacheRequestOptions): Promise<CacheEnvelope<WorkflowSummary[]>>;
  getWorkflowRuns(repo: RepoRef, options?: CacheRequestOptions): Promise<CacheEnvelope<WorkflowRunSummary[]>>;
  getPullRequest(repo: RepoRef, number: number, options?: CacheRequestOptions): Promise<CacheEnvelope<PullRequestDetail>>;
  getWorkflowRun(repo: RepoRef, runId: number, options?: CacheRequestOptions): Promise<CacheEnvelope<WorkflowRunDetail>>;
  getWorkflowJob(repo: RepoRef, jobId: number): Promise<CacheEnvelope<WorkflowJobLogDetail>>;
  dispatchWorkflow(payload: DispatchWorkflowPayload): Promise<void>;
  submitPullRequestReview(payload: SubmitPullRequestReviewPayload): Promise<void>;
  addPullRequestComment(payload: AddPullRequestCommentPayload): Promise<void>;
  updatePullRequestTitle(payload: UpdatePullRequestTitlePayload): Promise<void>;
  addPullRequestLabel(payload: PullRequestLabelPayload): Promise<void>;
  removePullRequestLabel(payload: PullRequestLabelPayload): Promise<void>;
  openInGitHub(url: string): Promise<void>;
  onCacheUpdated(callback: (key: string) => void): () => void;
  platform: string;
}
