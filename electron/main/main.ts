import { app, BrowserWindow, ipcMain, safeStorage, shell } from "electron";
import { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ActorSummary,
  ArtifactSummary,
  AuthStatus,
  CacheEnvelope,
  ChangedFileSummary,
  CheckSummary,
  CommitSummary,
  DispatchWorkflowPayload,
  IssueSummary,
  LabelSummary,
  OrganizationSummary,
  PullRequestDetail,
  PullRequestReview,
  PullRequestSummary,
  RepoRef,
  RepoSummary,
  TimelineComment,
  WorkflowJobSummary,
  WorkflowRunDetail,
  WorkflowRunSummary,
  WorkflowSummary
} from "../../shared/github.js";

type GraphqlClient = typeof graphql;

interface CacheRecord<T> {
  data: T;
  fetchedAtMs: number;
  fetchedAt: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
const defaultTtlMs = 5 * 60 * 1000;

let mainWindow: BrowserWindow | null = null;
let octokitClient: Octokit | null = null;
let graphqlClient: GraphqlClient | null = null;
let activeTokenHash: string | null = null;

function tokenPath(): string {
  return path.join(app.getPath("userData"), "github-token.bin");
}

function cacheDir(): string {
  return path.join(app.getPath("userData"), "cache");
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function cachePath(key: string): string {
  return path.join(cacheDir(), `${hash(key)}.json`);
}

function broadcastCacheUpdate(key: string): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("github:cache-updated", key);
  }
}

async function clearCache(): Promise<void> {
  cacheMemory.clear();
  await fs.rm(cacheDir(), { recursive: true, force: true });
}

async function readToken(): Promise<string | null> {
  try {
    const encrypted = await fs.readFile(tokenPath());
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure storage is not available on this machine.");
    }
    return safeStorage.decryptString(encrypted);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeToken(token: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure token storage is not available.");
  }

  await fs.mkdir(path.dirname(tokenPath()), { recursive: true });
  await fs.writeFile(tokenPath(), safeStorage.encryptString(token), { mode: 0o600 });
  octokitClient = null;
  graphqlClient = null;
  activeTokenHash = null;
  await clearCache();
}

async function clearToken(): Promise<void> {
  try {
    await fs.unlink(tokenPath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  octokitClient = null;
  graphqlClient = null;
  activeTokenHash = null;
  await clearCache();
}

async function getAuthStatus(): Promise<AuthStatus> {
  let configured = false;
  try {
    await fs.access(tokenPath());
    configured = true;
  } catch {
    configured = false;
  }

  return {
    configured,
    encryptionAvailable: safeStorage.isEncryptionAvailable()
  };
}

async function getClients(): Promise<{ octokit: Octokit; gql: GraphqlClient }> {
  const token = await readToken();
  if (!token) {
    throw new Error("GitHub token is not configured.");
  }

  const tokenHash = hash(token);
  if (!octokitClient || !graphqlClient || activeTokenHash !== tokenHash) {
    octokitClient = new Octokit({ auth: token });
    graphqlClient = graphql.defaults({
      headers: {
        authorization: `token ${token}`
      }
    });
    activeTokenHash = tokenHash;
  }

  return {
    octokit: octokitClient,
    gql: graphqlClient
  };
}

async function readCache<T>(key: string): Promise<CacheRecord<T> | null> {
  const memory = cacheMemory.get(key) as CacheRecord<T> | undefined;
  if (memory) {
    return memory;
  }

  try {
    const raw = await fs.readFile(cachePath(key), "utf8");
    const record = JSON.parse(raw) as CacheRecord<T>;
    cacheMemory.set(key, record);
    return record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeCache<T>(key: string, data: T): Promise<CacheRecord<T>> {
  const record: CacheRecord<T> = {
    data,
    fetchedAtMs: Date.now(),
    fetchedAt: new Date().toISOString()
  };
  cacheMemory.set(key, record);
  await fs.mkdir(cacheDir(), { recursive: true });
  await fs.writeFile(cachePath(key), JSON.stringify(record), "utf8");
  return record;
}

async function cached<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = defaultTtlMs
): Promise<CacheEnvelope<T>> {
  const record = await readCache<T>(key);
  const now = Date.now();

  if (record && now - record.fetchedAtMs < ttlMs) {
    return {
      data: record.data,
      fetchedAt: record.fetchedAt,
      stale: false,
      source: "cache"
    };
  }

  if (record) {
    void fetcher()
      .then((data) => writeCache(key, data))
      .then(() => broadcastCacheUpdate(key))
      .catch((error) => console.error(`Failed to refresh cache ${key}`, error));

    return {
      data: record.data,
      fetchedAt: record.fetchedAt,
      stale: true,
      source: "cache"
    };
  }

  const data = await fetcher();
  const fresh = await writeCache(key, data);
  return {
    data: fresh.data,
    fetchedAt: fresh.fetchedAt,
    stale: false,
    source: "network"
  };
}

const cacheMemory = new Map<string, CacheRecord<unknown>>();

function nodeList<T>(connection: { nodes?: Array<T | null> | null } | null | undefined): T[] {
  return (connection?.nodes ?? []).filter(Boolean) as T[];
}

function toActor(actor: any): ActorSummary | null {
  if (!actor) {
    return null;
  }

  return {
    login: actor.login,
    avatarUrl: actor.avatarUrl ?? actor.avatar_url ?? null,
    url: actor.url ?? actor.html_url ?? null
  };
}

function toLabels(labels: any): LabelSummary[] {
  return nodeList<any>(labels).map((label) => ({
    id: label.id,
    name: label.name,
    color: label.color
  }));
}

function toRepo(repo: any): RepoSummary {
  return {
    id: String(repo.id),
    owner: repo.owner.login,
    name: repo.name,
    fullName: repo.nameWithOwner ?? `${repo.owner.login}/${repo.name}`,
    description: repo.description ?? null,
    defaultBranch: repo.defaultBranchRef?.name ?? repo.default_branch ?? null,
    isPrivate: Boolean(repo.isPrivate ?? repo.private),
    isArchived: Boolean(repo.isArchived ?? repo.archived),
    isFork: Boolean(repo.isFork ?? repo.fork),
    ownerAvatarUrl: repo.owner.avatarUrl ?? repo.owner.avatar_url ?? null,
    updatedAt: repo.updatedAt ?? repo.updated_at ?? null,
    pushedAt: repo.pushedAt ?? repo.pushed_at ?? null,
    url: repo.html_url ?? repo.url
  };
}

function uniqueRepoSummaries(repositories: RepoSummary[]): RepoSummary[] {
  const seen = new Set<string>();
  return repositories.filter((repo) => {
    const key = `${repo.owner}/${repo.name}`.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function toPullRequest(pr: any): PullRequestSummary {
  const latestCommit = nodeList<any>(pr.commits).at(-1);

  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    author: toActor(pr.author),
    labels: toLabels(pr.labels),
    state: pr.state,
    isDraft: Boolean(pr.isDraft),
    reviewDecision: pr.reviewDecision ?? null,
    mergeable: pr.mergeable ?? null,
    ciState: latestCommit?.commit?.statusCheckRollup?.state ?? null,
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    url: pr.url
  };
}

function toIssue(issue: any): IssueSummary {
  return {
    id: issue.id,
    number: issue.number,
    title: issue.title,
    author: toActor(issue.author),
    labels: toLabels(issue.labels),
    state: issue.state,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    url: issue.url
  };
}

function durationMs(start?: string | null, end?: string | null): number | null {
  if (!start || !end) {
    return null;
  }

  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return null;
  }

  return Math.max(0, endMs - startMs);
}

function toWorkflowRun(run: any): WorkflowRunSummary {
  return {
    id: run.id,
    workflowId: run.workflow_id,
    name: run.name,
    displayTitle: run.display_title,
    status: run.status,
    conclusion: run.conclusion,
    event: run.event,
    branch: run.head_branch,
    commitSha: run.head_sha,
    commitMessage: run.head_commit?.message ?? null,
    actor: toActor(run.actor),
    runStartedAt: run.run_started_at,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    durationMs: durationMs(run.run_started_at ?? run.created_at, run.updated_at),
    url: run.html_url
  };
}

function ensureRepo(repo: RepoRef): RepoRef {
  if (!repo?.owner || !repo?.name) {
    throw new Error("Repository owner and name are required.");
  }

  return {
    owner: repo.owner,
    name: repo.name
  };
}

async function getStarredRepos(): Promise<CacheEnvelope<RepoSummary[]>> {
  return cached("viewer:starred-repos", async () => {
    const { gql } = await getClients();
    const result: any = await gql(`
      query StarredRepos {
        viewer {
          starredRepositories(first: 100, orderBy: { field: STARRED_AT, direction: DESC }) {
            nodes {
              id
              name
              nameWithOwner
              description
              isPrivate
              isArchived
              isFork
              updatedAt
              pushedAt
              url
              owner { login avatarUrl }
              defaultBranchRef { name }
            }
          }
        }
      }
    `);
    return nodeList<any>(result.viewer.starredRepositories).map(toRepo);
  });
}

async function getRepositories(): Promise<CacheEnvelope<RepoSummary[]>> {
  return cached("viewer:repositories:v2", async () => {
    const { octokit } = await getClients();
    const [viewerRepositories, organizations] = await Promise.all([
      octokit.paginate(octokit.repos.listForAuthenticatedUser, {
        visibility: "all",
        affiliation: "owner,collaborator,organization_member",
        sort: "updated",
        direction: "desc",
        per_page: 100
      }),
      octokit.paginate(octokit.orgs.listForAuthenticatedUser, {
        per_page: 100
      })
    ]);

    const organizationRepositories = [];
    for (const organization of organizations) {
      try {
        const repositories = await octokit.paginate(octokit.repos.listForOrg, {
          org: organization.login,
          type: "all",
          sort: "updated",
          direction: "desc",
          per_page: 100
        });
        organizationRepositories.push(...repositories);
      } catch (error) {
        console.warn(`Unable to list repositories for organization ${organization.login}`, error);
      }
    }

    return uniqueRepoSummaries([...viewerRepositories, ...organizationRepositories].map(toRepo));
  }, 15 * 60 * 1000);
}

async function getRecentRepos(): Promise<CacheEnvelope<RepoSummary[]>> {
  return cached("viewer:recent-repos", async () => {
    const { gql } = await getClients();
    const result: any = await gql(`
      query RecentRepos {
        viewer {
          repositories(
            first: 100,
            affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER],
            orderBy: { field: UPDATED_AT, direction: DESC }
          ) {
            nodes {
              id
              name
              nameWithOwner
              description
              isPrivate
              isArchived
              isFork
              updatedAt
              pushedAt
              url
              owner { login avatarUrl }
              defaultBranchRef { name }
            }
          }
        }
      }
    `);
    return nodeList<any>(result.viewer.repositories).map(toRepo);
  });
}

async function getOrganizations(): Promise<CacheEnvelope<OrganizationSummary[]>> {
  return cached("viewer:organizations:v2", async () => {
    const { octokit } = await getClients();
    try {
      const organizations = await octokit.paginate(octokit.orgs.listForAuthenticatedUser, {
        per_page: 100
      });
      return organizations.map((org) => ({
        id: String(org.id),
        login: org.login,
        name: null,
        avatarUrl: org.avatar_url ?? null,
        url: `https://github.com/${org.login}`
      }));
    } catch (error) {
      console.warn("Unable to list organizations with current token scopes", error);
      return [];
    }
  });
}

async function getRepo(repoRef: RepoRef): Promise<CacheEnvelope<RepoSummary>> {
  const repo = ensureRepo(repoRef);
  return cached(`repo:${repo.owner}/${repo.name}`, async () => {
    const { gql } = await getClients();
    const result: any = await gql(
      `
        query Repository($owner: String!, $name: String!) {
          repository(owner: $owner, name: $name) {
            id
            name
            nameWithOwner
            description
            isPrivate
            isArchived
            isFork
            updatedAt
            pushedAt
            url
            owner { login avatarUrl }
            defaultBranchRef { name }
          }
        }
      `,
      { owner: repo.owner, name: repo.name }
    );
    return toRepo(result.repository);
  });
}

async function getPullRequests(repoRef: RepoRef): Promise<CacheEnvelope<PullRequestSummary[]>> {
  const repo = ensureRepo(repoRef);
  return cached(`repo:${repo.owner}/${repo.name}:pulls`, async () => {
    const { gql } = await getClients();
    const result: any = await gql(
      `
        query PullRequests($owner: String!, $name: String!) {
          repository(owner: $owner, name: $name) {
            pullRequests(first: 50, states: OPEN, orderBy: { field: UPDATED_AT, direction: DESC }) {
              nodes {
                id
                number
                title
                state
                isDraft
                reviewDecision
                mergeable
                headRefName
                baseRefName
                createdAt
                updatedAt
                url
                author { login avatarUrl url }
                labels(first: 10) { nodes { id name color } }
                commits(last: 1) {
                  nodes {
                    commit {
                      statusCheckRollup { state }
                    }
                  }
                }
              }
            }
          }
        }
      `,
      { owner: repo.owner, name: repo.name }
    );
    return nodeList<any>(result.repository.pullRequests).map(toPullRequest);
  });
}

async function getIssues(repoRef: RepoRef): Promise<CacheEnvelope<IssueSummary[]>> {
  const repo = ensureRepo(repoRef);
  return cached(`repo:${repo.owner}/${repo.name}:issues`, async () => {
    const { gql } = await getClients();
    const result: any = await gql(
      `
        query Issues($owner: String!, $name: String!) {
          repository(owner: $owner, name: $name) {
            issues(first: 50, states: OPEN, orderBy: { field: UPDATED_AT, direction: DESC }) {
              nodes {
                id
                number
                title
                state
                createdAt
                updatedAt
                url
                author { login avatarUrl url }
                labels(first: 10) { nodes { id name color } }
              }
            }
          }
        }
      `,
      { owner: repo.owner, name: repo.name }
    );
    return nodeList<any>(result.repository.issues).map(toIssue);
  });
}

async function getWorkflows(repoRef: RepoRef): Promise<CacheEnvelope<WorkflowSummary[]>> {
  const repo = ensureRepo(repoRef);
  return cached(`repo:${repo.owner}/${repo.name}:workflows`, async () => {
    const { octokit } = await getClients();
    const response = await octokit.actions.listRepoWorkflows({
      owner: repo.owner,
      repo: repo.name,
      per_page: 100
    });
    return response.data.workflows.map((workflow) => ({
      id: workflow.id,
      nodeId: workflow.node_id,
      name: workflow.name,
      path: workflow.path,
      state: workflow.state,
      createdAt: workflow.created_at,
      updatedAt: workflow.updated_at,
      url: workflow.url,
      htmlUrl: workflow.html_url,
      badgeUrl: workflow.badge_url
    }));
  });
}

async function getWorkflowRuns(repoRef: RepoRef): Promise<CacheEnvelope<WorkflowRunSummary[]>> {
  const repo = ensureRepo(repoRef);
  return cached(`repo:${repo.owner}/${repo.name}:workflow-runs`, async () => {
    const { octokit } = await getClients();
    const response = await octokit.actions.listWorkflowRunsForRepo({
      owner: repo.owner,
      repo: repo.name,
      per_page: 50
    });
    return response.data.workflow_runs.map(toWorkflowRun);
  }, 60 * 1000);
}

async function getPullRequest(repoRef: RepoRef, number: number): Promise<CacheEnvelope<PullRequestDetail>> {
  const repo = ensureRepo(repoRef);
  return cached(`repo:${repo.owner}/${repo.name}:pull:${number}`, async () => {
    const { gql } = await getClients();
    const result: any = await gql(
      `
        query PullRequest($owner: String!, $name: String!, $number: Int!) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              id
              number
              title
              body
              state
              isDraft
              reviewDecision
              mergeable
              headRefName
              baseRefName
              createdAt
              updatedAt
              url
              author { login avatarUrl url }
              labels(first: 20) { nodes { id name color } }
              comments(first: 100) {
                nodes {
                  id
                  body
                  createdAt
                  updatedAt
                  url
                  author { login avatarUrl url }
                }
              }
              reviews(first: 50) {
                nodes {
                  id
                  state
                  body
                  submittedAt
                  url
                  author { login avatarUrl url }
                }
              }
              commits(first: 50) {
                nodes {
                  commit {
                    oid
                    messageHeadline
                    authoredDate
                    url
                    author { name }
                    statusCheckRollup {
                      state
                      contexts(first: 50) {
                        nodes {
                          __typename
                          ... on CheckRun {
                            name
                            status
                            conclusion
                            detailsUrl
                          }
                          ... on StatusContext {
                            context
                            state
                            targetUrl
                          }
                        }
                      }
                    }
                  }
                }
              }
              files(first: 100) {
                nodes {
                  path
                  additions
                  deletions
                  changeType
                }
              }
            }
          }
        }
      `,
      { ...repo, number }
    );

    const pr = result.repository.pullRequest;
    const summary = toPullRequest(pr);
    const latestCommit = nodeList<any>(pr.commits).at(-1)?.commit;
    const checks: CheckSummary[] = nodeList<any>(latestCommit?.statusCheckRollup?.contexts).map((check) => ({
      name: check.name ?? check.context,
      status: check.status ?? check.state ?? null,
      conclusion: check.conclusion ?? null,
      url: check.detailsUrl ?? check.targetUrl ?? null
    }));

    return {
      ...summary,
      body: pr.body ?? "",
      comments: nodeList<any>(pr.comments).map<TimelineComment>((comment) => ({
        id: comment.id,
        author: toActor(comment.author),
        body: comment.body,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
        url: comment.url
      })),
      reviews: nodeList<any>(pr.reviews).map<PullRequestReview>((review) => ({
        id: review.id,
        state: review.state,
        author: toActor(review.author),
        body: review.body,
        submittedAt: review.submittedAt,
        url: review.url
      })),
      commits: nodeList<any>(pr.commits).map<CommitSummary>((commitNode) => ({
        oid: commitNode.commit.oid,
        messageHeadline: commitNode.commit.messageHeadline,
        authoredDate: commitNode.commit.authoredDate,
        authorName: commitNode.commit.author?.name ?? null,
        url: commitNode.commit.url
      })),
      files: nodeList<any>(pr.files).map<ChangedFileSummary>((file) => ({
        path: file.path,
        additions: file.additions,
        deletions: file.deletions,
        changeType: file.changeType
      })),
      checks
    };
  });
}

async function getWorkflowRun(repoRef: RepoRef, runId: number): Promise<CacheEnvelope<WorkflowRunDetail>> {
  const repo = ensureRepo(repoRef);
  return cached(`repo:${repo.owner}/${repo.name}:workflow-run:${runId}`, async () => {
    const { octokit } = await getClients();
    const [run, jobs, artifacts] = await Promise.all([
      octokit.actions.getWorkflowRun({
        owner: repo.owner,
        repo: repo.name,
        run_id: runId
      }),
      octokit.actions.listJobsForWorkflowRun({
        owner: repo.owner,
        repo: repo.name,
        run_id: runId,
        per_page: 100
      }),
      octokit.actions.listWorkflowRunArtifacts({
        owner: repo.owner,
        repo: repo.name,
        run_id: runId,
        per_page: 100
      })
    ]);

    return {
      ...toWorkflowRun(run.data),
      jobs: jobs.data.jobs.map<WorkflowJobSummary>((job) => ({
        id: job.id,
        name: job.name,
        status: job.status,
        conclusion: job.conclusion,
        startedAt: job.started_at,
        completedAt: job.completed_at,
        url: job.html_url,
        steps: (job.steps ?? []).map((step) => ({
          name: step.name,
          status: step.status,
          conclusion: step.conclusion,
          number: step.number
        }))
      })),
      artifacts: artifacts.data.artifacts.map<ArtifactSummary>((artifact) => ({
        id: artifact.id,
        name: artifact.name,
        sizeInBytes: artifact.size_in_bytes,
        expired: artifact.expired,
        createdAt: artifact.created_at,
        expiresAt: artifact.expires_at,
        url: artifact.archive_download_url
      }))
    };
  }, 60 * 1000);
}

async function dispatchWorkflow(payload: DispatchWorkflowPayload): Promise<void> {
  const repo = ensureRepo(payload.repo);
  const ref = payload.ref?.trim();
  if (!ref) {
    throw new Error("Workflow ref is required.");
  }

  const { octokit } = await getClients();
  await octokit.actions.createWorkflowDispatch({
    owner: repo.owner,
    repo: repo.name,
    workflow_id: payload.workflowId,
    ref,
    inputs: payload.inputs ?? {}
  });
}

async function openInGitHub(rawUrl: string): Promise<void> {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || (host !== "github.com" && host !== "www.github.com")) {
    throw new Error("Only github.com URLs can be opened from this action.");
  }

  await shell.openExternal(url.toString());
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    title: "GitHub Focus",
    backgroundColor: "#0c0e12",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (isDev) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(app.getAppPath(), "dist/renderer/index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsedUrl = new URL(url);
      if (["https:", "http:", "mailto:"].includes(parsedUrl.protocol)) {
        void shell.openExternal(parsedUrl.toString());
      }
    } catch {
      // Ignore malformed window-open targets.
    }
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpc(): void {
  ipcMain.handle("auth:get-status", () => getAuthStatus());
  ipcMain.handle("auth:save-token", async (_event, token: string) => {
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      throw new Error("Token cannot be empty.");
    }
    await writeToken(trimmedToken);
    return getAuthStatus();
  });
  ipcMain.handle("auth:clear-token", async () => {
    await clearToken();
    return getAuthStatus();
  });

  ipcMain.handle("github:get-repositories", () => getRepositories());
  ipcMain.handle("github:get-starred-repos", () => getStarredRepos());
  ipcMain.handle("github:get-recent-repos", () => getRecentRepos());
  ipcMain.handle("github:get-organizations", () => getOrganizations());
  ipcMain.handle("github:get-repo", (_event, repo: RepoRef) => getRepo(repo));
  ipcMain.handle("github:get-pull-requests", (_event, repo: RepoRef) => getPullRequests(repo));
  ipcMain.handle("github:get-issues", (_event, repo: RepoRef) => getIssues(repo));
  ipcMain.handle("github:get-workflows", (_event, repo: RepoRef) => getWorkflows(repo));
  ipcMain.handle("github:get-workflow-runs", (_event, repo: RepoRef) => getWorkflowRuns(repo));
  ipcMain.handle("github:get-pull-request", (_event, repo: RepoRef, number: number) =>
    getPullRequest(repo, number)
  );
  ipcMain.handle("github:get-workflow-run", (_event, repo: RepoRef, runId: number) =>
    getWorkflowRun(repo, runId)
  );
  ipcMain.handle("github:dispatch-workflow", (_event, payload: DispatchWorkflowPayload) =>
    dispatchWorkflow(payload)
  );
  ipcMain.handle("github:open-in-github", (_event, url: string) => openInGitHub(url));
}

registerIpc();

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
