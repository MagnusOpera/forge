import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  safeStorage,
  shell,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions
} from "electron";
import { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ActorSummary,
  AddPullRequestCommentPayload,
  ArtifactSummary,
  AuthStatus,
  CacheEnvelope,
  CacheRequestOptions,
  ChangedFileSummary,
  CheckSummary,
  CommitSummary,
  DispatchWorkflowPayload,
  IssueSummary,
  LabelSummary,
  NativeNotificationPayload,
  NativeNotificationSource,
  NativeThemeSource,
  OrganizationSummary,
  PullRequestActionPayload,
  PullRequestAutoMergePayload,
  PullRequestLabelPayload,
  PullRequestDetail,
  PullRequestReview,
  PullRequestSummary,
  RepoRef,
  RepoSummary,
  SidebarAppearanceMode,
  SubmitPullRequestReviewPayload,
  TimelineComment,
  UpdatePullRequestDraftStatePayload,
  UpdatePullRequestTitlePayload,
  WorkflowJobLogDetail,
  WorkflowJobSummary,
  WorkflowJobStepSummary,
  WorkflowRunDetail,
  WorkflowRunSummary,
  WorkflowSummary
} from "../../shared/github.js";
import { DEFAULT_SIDEBAR_APPEARANCE_MODE } from "../../shared/github.js";
import {
  isClassicPersonalAccessToken,
  missingRequiredClassicTokenScopes,
  REQUIRED_CLASSIC_TOKEN_SCOPES
} from "../../shared/auth.js";
import { AUTO_MERGE_API_UNAVAILABLE_MESSAGE, isAutoMergeNotAllowedMessage } from "../../shared/errors.js";

type GraphqlClient = typeof graphql;

interface CacheRecord<T> {
  data: T;
  fetchedAtMs: number;
  fetchedAt: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDisplayName = "Forge";
const appCopyright = "Copyright (c) 2026 Magnus Opera SAS";
const legacyAppName = "github-focus";
const isDev = !app.isPackaged;
const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
const defaultTtlMs = 5 * 60 * 1000;
const appDefaultZoomFactor = 1.1;
const glassWindowBackground = "#00000000";
const normalWindowBackground = "#0c0e12";
const supportsNativeGlassBackground = process.platform === "darwin";

app.setName(appDisplayName);
app.setAppUserModelId("com.magnusopera.forge");

let mainWindow: BrowserWindow | null = null;
let aboutWindow: BrowserWindow | null = null;
let octokitClient: Octokit | null = null;
let graphqlClient: GraphqlClient | null = null;
let activeTokenHash: string | null = null;
const activeNotifications = new Set<Notification>();
let sidebarAppearanceMode: SidebarAppearanceMode = DEFAULT_SIDEBAR_APPEARANCE_MODE;

function windowBackgroundColorForSidebarAppearance(mode: SidebarAppearanceMode): string {
  return supportsNativeGlassBackground && mode === "glass" ? glassWindowBackground : normalWindowBackground;
}

function appIconPath(extension: "png" | "icns" = "png"): string {
  return path.join(app.getAppPath(), "assets", `forge-icon.${extension}`);
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await fs.access(candidatePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function copyPathIfMissing(sourcePath: string, targetPath: string): Promise<void> {
  if (await pathExists(targetPath)) {
    return;
  }
  if (!(await pathExists(sourcePath))) {
    return;
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.cp(sourcePath, targetPath, { recursive: true, errorOnExist: false, force: false });
}

async function migrateLegacyUserData(): Promise<void> {
  const currentUserDataDir = app.getPath("userData");
  const legacyUserDataDir = path.join(app.getPath("appData"), legacyAppName);

  if (legacyUserDataDir === currentUserDataDir || !(await pathExists(legacyUserDataDir))) {
    return;
  }

  if (!(await pathExists(currentUserDataDir))) {
    await fs.cp(legacyUserDataDir, currentUserDataDir, { recursive: true, errorOnExist: false, force: false });
    return;
  }

  await Promise.all([
    copyPathIfMissing(path.join(legacyUserDataDir, "github-token.bin"), path.join(currentUserDataDir, "github-token.bin")),
    copyPathIfMissing(path.join(legacyUserDataDir, "cache"), path.join(currentUserDataDir, "cache")),
    copyPathIfMissing(path.join(legacyUserDataDir, "Local Storage"), path.join(currentUserDataDir, "Local Storage"))
  ]);
}

function configureAppPresentation(): void {
  const iconPath = appIconPath("png");
  const icon = nativeImage.createFromPath(iconPath);

  app.setAboutPanelOptions({
    applicationName: appDisplayName,
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: appCopyright,
    iconPath
  });

  if (process.platform === "darwin" && app.dock && !icon.isEmpty()) {
    app.dock.setIcon(icon);
  }
}

function loadAppIconDataUrl(): string {
  try {
    return `data:image/png;base64,${readFileSync(appIconPath("png")).toString("base64")}`;
  } catch {
    return "";
  }
}

async function confirmPullRequestApproval(event: IpcMainInvokeEvent, rawPullNumber: number): Promise<boolean> {
  if (!Number.isSafeInteger(rawPullNumber) || rawPullNumber <= 0) {
    throw new Error("Pull request number is required.");
  }

  const icon = nativeImage.createFromPath(appIconPath("png"));
  const parent = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
  const options = {
    type: "question" as const,
    buttons: ["Cancel", "OK"],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
    message: `Approve PR #${rawPullNumber}?`,
    icon: icon.isEmpty() ? undefined : icon
  };
  const result = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  return result.response === 1;
}

function showAboutWindow(): void {
  if (aboutWindow) {
    aboutWindow.show();
    aboutWindow.focus();
    return;
  }

  const iconDataUrl = loadAppIconDataUrl();

  aboutWindow = new BrowserWindow({
    width: 440,
    height: 270,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: `About ${appDisplayName}`,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: "#eef0f3",
    parent: mainWindow ?? undefined,
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  aboutWindow.once("ready-to-show", () => {
    aboutWindow?.show();
  });
  aboutWindow.on("closed", () => {
    aboutWindow = null;
  });

  const version = app.getVersion();
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
      }

      body {
        display: flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        padding-top: 20px;
        background: #eef0f3;
        color: #202124;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        user-select: none;
      }

      main {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
      }

      img {
        width: 96px;
        height: 96px;
        margin-bottom: 4px;
        object-fit: contain;
      }

      h1 {
        margin: 0;
        font-size: 26px;
        font-weight: 700;
        line-height: 1.2;
      }

      p {
        margin: 0;
        font-size: 18px;
        line-height: 1.3;
      }

      .copyright {
        color: #5f6368;
        font-size: 13px;
      }
    </style>
  </head>
  <body>
    <main>
      <img src="${iconDataUrl}" alt="" />
      <h1>${appDisplayName}</h1>
      <p>Version ${version} (${version})</p>
      <p class="copyright">${appCopyright}</p>
    </main>
  </body>
</html>`;

  void aboutWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function createApplicationMenu(): void {
  if (process.platform !== "darwin") {
    return;
  }

  const resetZoomToAppDefault = (): void => {
    const focusedWindow = BrowserWindow.getFocusedWindow() ?? mainWindow;
    focusedWindow?.webContents.setZoomFactor(appDefaultZoomFactor);
  };

  const viewMenu: MenuItemConstructorOptions[] = [
    ...(isDev
      ? ([
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" }
        ] satisfies MenuItemConstructorOptions[])
      : []),
    { label: "Reset Zoom", accelerator: "CommandOrControl+0", click: resetZoomToAppDefault },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" }
  ];

  const template: MenuItemConstructorOptions[] = [
    {
      label: appDisplayName,
      submenu: [
        { label: `About ${appDisplayName}`, click: () => showAboutWindow() },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" }
      ]
    },
    { label: "View", submenu: viewMenu },
    {
      label: "Window",
      submenu: [{ role: "close" }, { role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

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

async function invalidateCacheKey(key: string): Promise<void> {
  cacheMemory.delete(key);
  try {
    await fs.unlink(cachePath(key));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  broadcastCacheUpdate(key);
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

async function validateTokenBeforeSave(token: string): Promise<void> {
  if (!isClassicPersonalAccessToken(token)) {
    throw new Error("This is not a classic GitHub personal access token. Create a classic token and paste the value that starts with ghp_.");
  }

  const response = await fetchWithTimeout("https://api.github.com/user", {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28"
    }
  });

  if (response.status === 401) {
    throw new Error("GitHub rejected this token. Check that it is active and copied correctly.");
  }
  if (!response.ok) {
    throw new GitHubHttpStatusError(`GitHub could not check this token right now (${response.status}). Try again.`, response.status);
  }

  const scopesHeader = response.headers.get("x-oauth-scopes");
  const missingScopes = missingRequiredClassicTokenScopes(scopesHeader);
  if (missingScopes.length) {
    throw new Error(
      `This classic token is missing the required ${missingScopes.join(" and ")} permission${missingScopes.length > 1 ? "s" : ""}. ` +
        `Open classic token settings and enable ${REQUIRED_CLASSIC_TOKEN_SCOPES.join(" and ")}.`
    );
  }
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
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    viewerLogin: await getViewerLogin(configured)
  };
}

async function getViewerLogin(configured: boolean): Promise<string | null> {
  if (!configured || !safeStorage.isEncryptionAvailable()) {
    return null;
  }

  try {
    const { octokit } = await getClients();
    const { data } = await octokit.users.getAuthenticated();
    return data.login ?? null;
  } catch (error) {
    console.warn("Unable to resolve authenticated GitHub user", error);
    return null;
  }
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
  ttlMs = defaultTtlMs,
  options: CacheRequestOptions = {}
): Promise<CacheEnvelope<T>> {
  if (options.force) {
    const data = await fetcher();
    const fresh = await writeCache(key, data);
    return {
      data: fresh.data,
      fetchedAt: fresh.fetchedAt,
      stale: false,
      source: "network"
    };
  }

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

function repoCacheKey(repo: RepoRef): string {
  return `repo:${repo.owner}/${repo.name}:v3`;
}

function repoLabelsCacheKey(repo: RepoRef): string {
  return `repo:${repo.owner}/${repo.name}:labels:v1`;
}

function pullRequestsCacheKey(repo: RepoRef): string {
  return `repo:${repo.owner}/${repo.name}:pulls:v2`;
}

function pullRequestCacheKey(repo: RepoRef, number: number): string {
  return `repo:${repo.owner}/${repo.name}:pull:${number}:v5`;
}

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

function toLabel(label: any): LabelSummary {
  return {
    id: String(label.id ?? label.node_id ?? label.name),
    name: label.name,
    color: label.color ?? "d0d7de"
  };
}

function toLabels(labels: any): LabelSummary[] {
  const values = Array.isArray(labels) ? labels : nodeList<any>(labels);
  return values.filter((label) => label?.name).map(toLabel);
}

function toRepositoryPermission(repo: any): RepoSummary["viewerPermission"] {
  if (typeof repo.viewerPermission === "string") {
    return repo.viewerPermission as RepoSummary["viewerPermission"];
  }

  const permissions = repo.permissions;
  if (permissions?.admin) {
    return "ADMIN";
  }
  if (permissions?.maintain) {
    return "MAINTAIN";
  }
  if (permissions?.push) {
    return "WRITE";
  }
  if (permissions?.triage) {
    return "TRIAGE";
  }
  if (permissions?.pull) {
    return "READ";
  }

  switch (String(repo.role_name ?? "").toLowerCase()) {
    case "admin":
      return "ADMIN";
    case "maintain":
      return "MAINTAIN";
    case "write":
      return "WRITE";
    case "triage":
      return "TRIAGE";
    case "read":
      return "READ";
    default:
      return null;
  }
}

function toRepo(repo: any): RepoSummary {
  const autoMergeAllowed =
    typeof repo.autoMergeAllowed === "boolean"
      ? repo.autoMergeAllowed
      : typeof repo.allow_auto_merge === "boolean"
        ? repo.allow_auto_merge
        : undefined;

  return {
    id: String(repo.id),
    owner: repo.owner.login,
    name: repo.name,
    fullName: repo.nameWithOwner ?? `${repo.owner.login}/${repo.name}`,
    description: repo.description ?? null,
    defaultBranch: repo.defaultBranchRef?.name ?? repo.default_branch ?? null,
    viewerPermission: toRepositoryPermission(repo),
    autoMergeAllowed,
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
    autoMergeEnabled: Boolean(pr.autoMergeRequest),
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
  return cached("viewer:starred-repos:v3", async () => {
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
              viewerPermission
              autoMergeAllowed
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
  return cached("viewer:repositories:v4", async () => {
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
  return cached("viewer:recent-repos:v3", async () => {
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
              viewerPermission
              autoMergeAllowed
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

async function getRepo(repoRef: RepoRef, options?: CacheRequestOptions): Promise<CacheEnvelope<RepoSummary>> {
  const repo = ensureRepo(repoRef);
  return cached(repoCacheKey(repo), async () => {
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
            viewerPermission
            autoMergeAllowed
            url
            owner { login avatarUrl }
            defaultBranchRef { name }
          }
        }
      `,
      { owner: repo.owner, name: repo.name }
    );
    return toRepo(result.repository);
  }, defaultTtlMs, options);
}

async function getRepoLabels(repoRef: RepoRef, options?: CacheRequestOptions): Promise<CacheEnvelope<LabelSummary[]>> {
  const repo = ensureRepo(repoRef);
  return cached(repoLabelsCacheKey(repo), async () => {
    const { octokit } = await getClients();
    const labels = await octokit.paginate(octokit.issues.listLabelsForRepo, {
      owner: repo.owner,
      repo: repo.name,
      per_page: 100
    });
    return labels.map(toLabel).sort((left, right) => left.name.localeCompare(right.name));
  }, defaultTtlMs, options);
}

async function getPullRequests(
  repoRef: RepoRef,
  options?: CacheRequestOptions
): Promise<CacheEnvelope<PullRequestSummary[]>> {
  const repo = ensureRepo(repoRef);
  return cached(pullRequestsCacheKey(repo), async () => {
    const { gql } = await getClients();
    const result: any = await gql(
      `
        query PullRequests($owner: String!, $name: String!) {
          repository(owner: $owner, name: $name) {
            openPullRequests: pullRequests(first: 50, states: OPEN, orderBy: { field: UPDATED_AT, direction: DESC }) {
              nodes {
                id
                number
                title
                state
                isDraft
                autoMergeRequest { enabledAt }
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
            closedPullRequests: pullRequests(first: 50, states: [CLOSED, MERGED], orderBy: { field: UPDATED_AT, direction: DESC }) {
              nodes {
                id
                number
                title
                state
                isDraft
                autoMergeRequest { enabledAt }
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
    return [
      ...nodeList<any>(result.repository.openPullRequests),
      ...nodeList<any>(result.repository.closedPullRequests)
    ]
      .map(toPullRequest)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }, defaultTtlMs, options);
}

async function getIssues(repoRef: RepoRef, options?: CacheRequestOptions): Promise<CacheEnvelope<IssueSummary[]>> {
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
  }, defaultTtlMs, options);
}

async function getWorkflows(repoRef: RepoRef, options?: CacheRequestOptions): Promise<CacheEnvelope<WorkflowSummary[]>> {
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
  }, defaultTtlMs, options);
}

async function getWorkflowRuns(
  repoRef: RepoRef,
  options?: CacheRequestOptions
): Promise<CacheEnvelope<WorkflowRunSummary[]>> {
  const repo = ensureRepo(repoRef);
  return cached(`repo:${repo.owner}/${repo.name}:workflow-runs`, async () => {
    const { octokit } = await getClients();
    const response = await octokit.actions.listWorkflowRunsForRepo({
      owner: repo.owner,
      repo: repo.name,
      per_page: 50
    });
    return response.data.workflow_runs.map(toWorkflowRun);
  }, 60 * 1000, options);
}

async function getPullRequest(
  repoRef: RepoRef,
  number: number,
  options?: CacheRequestOptions
): Promise<CacheEnvelope<PullRequestDetail>> {
  const repo = ensureRepo(repoRef);
  return cached(pullRequestCacheKey(repo, number), async () => {
    const { gql, octokit } = await getClients();
    const [result, files] = await Promise.all([
      gql(
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
                autoMergeRequest { enabledAt }
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
                              databaseId
                              name
                              status
                              conclusion
                              detailsUrl
                              startedAt
                              completedAt
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
              }
            }
          }
        `,
        { ...repo, number }
      ),
      octokit.paginate(octokit.pulls.listFiles, {
        owner: repo.owner,
        repo: repo.name,
        pull_number: number,
        per_page: 100
      })
    ]);

    const pr = (result as any).repository.pullRequest;
    const summary = toPullRequest(pr);
    const latestCommit = nodeList<any>(pr.commits).at(-1)?.commit;
    const checks = await Promise.all(nodeList<any>(latestCommit?.statusCheckRollup?.contexts).map(async (check) => {
      const url = check.detailsUrl ?? check.targetUrl ?? null;
      const jobId = parseActionsJobId(url);
      const workflowRunId = parseActionsRunId(url) ?? (jobId ? await getWorkflowRunIdForJob(octokit, repo, jobId) : null);
      return {
        name: check.name ?? check.context,
        status: check.status ?? check.state ?? null,
        conclusion: check.conclusion ?? null,
        url,
        checkRunId: check.databaseId ?? null,
        jobId,
        workflowRunId,
        startedAt: check.startedAt ?? null,
        completedAt: check.completedAt ?? null
      };
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
      files: files.map<ChangedFileSummary>((file) => ({
        path: file.filename,
        previousPath: file.previous_filename ?? null,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        changeType: file.status,
        patch: buildPullRequestFilePatch(file),
        url: file.blob_url ?? null
      })),
      checks
    };
  }, defaultTtlMs, options);
}

function parseActionsJobId(rawUrl?: string | null): number | null {
  if (!rawUrl) {
    return null;
  }

  try {
    const url = new URL(rawUrl);
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
      return null;
    }

    const match =
      url.pathname.match(/\/actions\/runs\/\d+\/job\/(\d+)/)
      ?? url.pathname.match(/\/runs\/(\d+)$/);
    if (!match) {
      return null;
    }

    const jobId = Number(match[1]);
    return Number.isSafeInteger(jobId) ? jobId : null;
  } catch {
    return null;
  }
}

function parseActionsRunId(rawUrl?: string | null): number | null {
  if (!rawUrl) {
    return null;
  }

  try {
    const url = new URL(rawUrl);
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
      return null;
    }

    const match = url.pathname.match(/\/actions\/runs\/(\d+)/);
    if (!match) {
      return null;
    }

    const runId = Number(match[1]);
    return Number.isSafeInteger(runId) ? runId : null;
  } catch {
    return null;
  }
}

async function getWorkflowRunIdForJob(octokit: Octokit, repo: RepoRef, jobId: number): Promise<number | null> {
  try {
    const job = await octokit.actions.getJobForWorkflowRun({
      owner: repo.owner,
      repo: repo.name,
      job_id: jobId
    });
    return job.data.run_id ?? null;
  } catch {
    return null;
  }
}

function buildPullRequestFilePatch(file: {
  filename: string;
  previous_filename?: string | null;
  status: string;
  patch?: string | null;
}): string | null {
  if (!file.patch) {
    return null;
  }

  const oldPath = file.previous_filename ?? file.filename;
  const newPath = file.filename;
  const oldTarget = file.status === "added" ? "/dev/null" : `a/${oldPath}`;
  const newTarget = file.status === "removed" ? "/dev/null" : `b/${newPath}`;
  const header = [`diff --git a/${oldPath} b/${newPath}`];

  if (file.status === "added") {
    header.push("new file mode 100644");
  }
  if (file.status === "removed") {
    header.push("deleted file mode 100644");
  }

  return [...header, `--- ${oldTarget}`, `+++ ${newTarget}`, file.patch].join("\n");
}

async function getWorkflowRun(
  repoRef: RepoRef,
  runId: number,
  options?: CacheRequestOptions
): Promise<CacheEnvelope<WorkflowRunDetail>> {
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
          number: step.number,
          startedAt: step.started_at,
          completedAt: step.completed_at
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
  }, 60 * 1000, options);
}

async function getWorkflowJob(repoRef: RepoRef, jobId: number): Promise<CacheEnvelope<WorkflowJobLogDetail>> {
  const repo = ensureRepo(repoRef);
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    throw new Error("A valid GitHub Actions job id is required.");
  }

  return cached(`repo:${repo.owner}/${repo.name}:workflow-job:${jobId}:v2`, async () => {
    const { octokit } = await getClients();
    const job = await octokit.actions.getJobForWorkflowRun({
      owner: repo.owner,
      repo: repo.name,
      job_id: jobId
    });
    let rawLog: string | null = null;
    let logUnavailableReason: string | null = null;

    try {
      rawLog = await downloadActionsJobLog(repo, jobId);
    } catch (error) {
      if (error instanceof GitHubHttpStatusError && error.status === 404) {
        logUnavailableReason = isLiveWorkflowJobStatus(job.data.status)
          ? "GitHub does not expose live logs for running jobs through the public API. This will refresh automatically after the job completes."
          : "GitHub did not return logs for this job.";
      } else {
        throw error;
      }
    }

    const stepLogs = splitActionsLogByStep(job.data.steps ?? [], rawLog);

    return {
      id: job.data.id,
      name: job.data.name,
      status: job.data.status,
      conclusion: job.data.conclusion,
      startedAt: job.data.started_at,
      completedAt: job.data.completed_at,
      url: job.data.html_url,
      steps: (job.data.steps ?? []).map<WorkflowJobStepSummary>((step, index) => ({
        name: step.name,
        status: step.status,
        conclusion: step.conclusion,
        number: step.number,
        startedAt: step.started_at,
        completedAt: step.completed_at,
        log: stepLogs.get(step.number ?? index) ?? null
      })),
      rawLog,
      logUnavailableReason
    };
  }, 5 * 1000);
}

function isLiveWorkflowJobStatus(status?: string | null): boolean {
  return ["queued", "waiting", "pending", "requested", "in_progress"].includes((status ?? "").toLowerCase());
}

async function downloadActionsJobLog(repo: RepoRef, jobId: number): Promise<string | null> {
  const token = await readToken();
  if (!token) {
    throw new Error("GitHub token is not configured.");
  }

  const response = await fetchWithTimeout(
    `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/actions/jobs/${jobId}/logs`,
    {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28"
      },
      redirect: "manual"
    }
  );

  if (response.ok) {
    return response.text();
  }

  const location = response.headers.get("location");
  if (!location) {
    throw new GitHubHttpStatusError(`Unable to download job logs (${response.status}).`, response.status);
  }

  const logResponse = await fetchWithTimeout(location, {
    headers: {}
  });
  if (!logResponse.ok) {
    throw new GitHubHttpStatusError(`Unable to download job logs (${logResponse.status}).`, logResponse.status);
  }

  return logResponse.text();
}

class GitHubHttpStatusError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "GitHubHttpStatusError";
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Timed out while downloading job logs.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function splitActionsLogByStep(steps: any[], rawLog: string | null): Map<number, string> {
  const stepLogs = new Map<number, string[]>();
  if (!rawLog) {
    return new Map();
  }

  const windows = steps.map((step, index) => ({
    key: step.number ?? index,
    start: parseDateMs(step.started_at),
    end: parseDateMs(step.completed_at)
  }));

  for (const line of rawLog.split(/\r?\n/)) {
    const parsed = parseActionsLogLine(line);
    const text = cleanActionsLogText(parsed.text);
    if (!text) {
      continue;
    }

    const window = parsed.timestampMs === null ? null : findStepWindow(windows, parsed.timestampMs);
    if (!window) {
      continue;
    }

    const bucket = stepLogs.get(window.key) ?? [];
    bucket.push(text);
    stepLogs.set(window.key, bucket);
  }

  return new Map([...stepLogs.entries()].map(([key, lines]) => [key, lines.join("\n").trim()]));
}

function parseDateMs(value?: string | null): number | null {
  if (!value) {
    return null;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function parseActionsLogLine(line: string): { timestampMs: number | null; text: string } {
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s?(.*)$/);
  if (!match) {
    return { timestampMs: null, text: line };
  }

  const timestampMs = parseDateMs(match[1]);
  return {
    timestampMs,
    text: match[2] ?? ""
  };
}

function findStepWindow<T extends { start: number | null; end: number | null }>(
  windows: T[],
  timestampMs: number
): T | null {
  const paddingMs = 1000;
  const matches = windows.filter((window) => {
    if (window.start === null && window.end === null) {
      return false;
    }

    const afterStart = window.start === null || timestampMs >= window.start - paddingMs;
    const beforeEnd = window.end === null || timestampMs <= window.end + paddingMs;
    return afterStart && beforeEnd;
  });
  if (!matches.length) {
    return null;
  }

  return matches[matches.length - 1];
}

function cleanActionsLogText(text: string): string {
  const withoutAnsi = text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  const withoutGroups = withoutAnsi
    .replace(/^##\[group\](.*)$/u, "$1")
    .replace(/^##\[command\](.*)$/u, "$ $1")
    .replace(/^##\[(error|warning|notice)\](.*)$/u, "$1: $2")
    .replace(/^##\[endgroup\]$/u, "");

  return withoutGroups.trimEnd();
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

async function submitPullRequestReview(payload: SubmitPullRequestReviewPayload): Promise<void> {
  const repo = ensureRepo(payload.repo);
  if (payload.event !== "APPROVE" && payload.event !== "REQUEST_CHANGES") {
    throw new Error("Unsupported pull request review event.");
  }

  const body = payload.body?.trim();
  if (payload.event === "REQUEST_CHANGES" && !body) {
    throw new Error("Requesting changes requires a review message.");
  }

  const { octokit } = await getClients();
  await octokit.pulls.createReview({
    owner: repo.owner,
    repo: repo.name,
    pull_number: payload.pullNumber,
    event: payload.event,
    body: body || undefined
  });

  await Promise.all([
    invalidateCacheKey(pullRequestsCacheKey(repo)),
    invalidateCacheKey(pullRequestCacheKey(repo, payload.pullNumber))
  ]);
}

async function addPullRequestComment(payload: AddPullRequestCommentPayload): Promise<void> {
  const repo = ensureRepo(payload.repo);
  const body = payload.body?.trim();
  if (!body) {
    throw new Error("Pull request comment cannot be empty.");
  }

  const { octokit } = await getClients();
  await octokit.issues.createComment({
    owner: repo.owner,
    repo: repo.name,
    issue_number: payload.pullNumber,
    body
  });

  await Promise.all([
    invalidateCacheKey(pullRequestsCacheKey(repo)),
    invalidateCacheKey(pullRequestCacheKey(repo, payload.pullNumber))
  ]);
}

async function updatePullRequestTitle(payload: UpdatePullRequestTitlePayload): Promise<void> {
  const repo = ensureRepo(payload.repo);
  const title = payload.title?.trim();
  if (!title) {
    throw new Error("Pull request title cannot be empty.");
  }

  const { octokit } = await getClients();
  await octokit.pulls.update({
    owner: repo.owner,
    repo: repo.name,
    pull_number: payload.pullNumber,
    title
  });

  await Promise.all([
    invalidateCacheKey(pullRequestsCacheKey(repo)),
    invalidateCacheKey(pullRequestCacheKey(repo, payload.pullNumber))
  ]);
}

async function updatePullRequestDraftState(payload: UpdatePullRequestDraftStatePayload): Promise<void> {
  const repo = ensureRepo(payload.repo);
  const pullRequestId = payload.pullRequestId?.trim();
  if (!pullRequestId) {
    throw new Error("Pull request id is required.");
  }

  const { gql } = await getClients();
  const mutation = payload.draft
    ? `
      mutation ConvertPullRequestToDraft($pullRequestId: ID!) {
        convertPullRequestToDraft(input: { pullRequestId: $pullRequestId }) {
          pullRequest { id isDraft }
        }
      }
    `
    : `
      mutation MarkPullRequestReadyForReview($pullRequestId: ID!) {
        markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
          pullRequest { id isDraft }
        }
      }
    `;

  await gql(mutation, { pullRequestId });

  await Promise.all([
    invalidateCacheKey(pullRequestsCacheKey(repo)),
    invalidateCacheKey(pullRequestCacheKey(repo, payload.pullNumber))
  ]);
}

function ensureLabelName(payload: PullRequestLabelPayload): string {
  const labelName = payload.labelName?.trim();
  if (!labelName) {
    throw new Error("Pull request label cannot be empty.");
  }
  return labelName;
}

function ensurePullNumber(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Pull request number is required.");
  }
  return value;
}

function ensurePullRequestId(value: string): string {
  const pullRequestId = value?.trim();
  if (!pullRequestId) {
    throw new Error("Pull request id is required.");
  }
  return pullRequestId;
}

type GraphqlMergeMethod = "SQUASH" | "MERGE" | "REBASE";
type RestMergeMethod = "squash" | "merge" | "rebase";
interface PullRequestAutoMergeInfo {
  enabled: boolean;
  commitBody: string | null;
  commitHeadline: string | null;
}

function preferredMergeMethods(repo: any): GraphqlMergeMethod[] {
  const methods: GraphqlMergeMethod[] = [];
  if (repo.mergeCommitAllowed ?? repo.allow_merge_commit) {
    methods.push("MERGE");
  }
  if (repo.squashMergeAllowed ?? repo.allow_squash_merge) {
    methods.push("SQUASH");
  }
  if (repo.rebaseMergeAllowed ?? repo.allow_rebase_merge) {
    methods.push("REBASE");
  }
  return methods.length > 0 ? methods : ["MERGE"];
}

function toRestMergeMethod(method: GraphqlMergeMethod): RestMergeMethod {
  return method.toLowerCase() as RestMergeMethod;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function getPullRequestAutoMergeInfo(
  gql: GraphqlClient,
  repo: RepoRef,
  pullNumber: number
): Promise<PullRequestAutoMergeInfo> {
  const result: any = await gql(
    `
      query PullRequestAutoMergeInfo($owner: String!, $name: String!, $pullNumber: Int!) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $pullNumber) {
            autoMergeRequest { enabledAt mergeMethod }
            viewerMergeBodyText
            viewerMergeHeadlineText
          }
        }
      }
    `,
    { owner: repo.owner, name: repo.name, pullNumber }
  );
  const pullRequest = result.repository?.pullRequest;

  return {
    enabled: Boolean(pullRequest?.autoMergeRequest),
    commitBody: pullRequest?.viewerMergeBodyText ?? null,
    commitHeadline: pullRequest?.viewerMergeHeadlineText ?? null
  };
}

function canTryAlternateMergeMethod(error: unknown): boolean {
  return /merge method|merge commits? (is|are) not allowed|squash (is|merges are) not allowed|rebase (is|merges are) not allowed/i.test(
    errorMessage(error)
  );
}

async function addPullRequestLabel(payload: PullRequestLabelPayload): Promise<void> {
  const repo = ensureRepo(payload.repo);
  const labelName = ensureLabelName(payload);
  const { octokit } = await getClients();
  await octokit.issues.addLabels({
    owner: repo.owner,
    repo: repo.name,
    issue_number: payload.pullNumber,
    labels: [labelName]
  });

  await Promise.all([
    invalidateCacheKey(pullRequestsCacheKey(repo)),
    invalidateCacheKey(pullRequestCacheKey(repo, payload.pullNumber))
  ]);
}

async function removePullRequestLabel(payload: PullRequestLabelPayload): Promise<void> {
  const repo = ensureRepo(payload.repo);
  const labelName = ensureLabelName(payload);
  const { octokit } = await getClients();
  await octokit.issues.removeLabel({
    owner: repo.owner,
    repo: repo.name,
    issue_number: payload.pullNumber,
    name: labelName
  });

  await Promise.all([
    invalidateCacheKey(pullRequestsCacheKey(repo)),
    invalidateCacheKey(pullRequestCacheKey(repo, payload.pullNumber))
  ]);
}

async function enablePullRequestAutoMerge(payload: PullRequestAutoMergePayload): Promise<void> {
  const repo = ensureRepo(payload.repo);
  const pullNumber = ensurePullNumber(payload.pullNumber);
  const pullRequestId = ensurePullRequestId(payload.pullRequestId);
  const { gql, octokit } = await getClients();
  const repoResponse = await octokit.repos.get({
    owner: repo.owner,
    repo: repo.name
  });
  const mergeInfo = await getPullRequestAutoMergeInfo(gql, repo, pullNumber);
  if (mergeInfo.enabled) {
    await Promise.all([
      invalidateCacheKey(pullRequestsCacheKey(repo)),
      invalidateCacheKey(pullRequestCacheKey(repo, pullNumber))
    ]);
    return;
  }
  let lastError: unknown = null;

  for (const mergeMethod of preferredMergeMethods(repoResponse.data)) {
    try {
      await gql(
        `
          mutation EnablePullRequestAutoMerge(
            $pullRequestId: ID!
            $mergeMethod: PullRequestMergeMethod!
            $commitHeadline: String
            $commitBody: String
          ) {
            enablePullRequestAutoMerge(
              input: {
                pullRequestId: $pullRequestId
                mergeMethod: $mergeMethod
                commitHeadline: $commitHeadline
                commitBody: $commitBody
              }
            ) {
              pullRequest {
                id
                autoMergeRequest { enabledAt mergeMethod }
              }
            }
          }
        `,
        {
          pullRequestId,
          mergeMethod,
          commitHeadline: mergeInfo.commitHeadline,
          commitBody: mergeInfo.commitBody
        }
      );
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (isAutoMergeNotAllowedMessage(errorMessage(error))) {
        try {
          const latestMergeInfo = await getPullRequestAutoMergeInfo(gql, repo, pullNumber);
          if (latestMergeInfo.enabled) {
            lastError = null;
            break;
          }
        } catch {
          // Keep the original GitHub API limitation as the user-facing failure.
        }
        throw new Error(AUTO_MERGE_API_UNAVAILABLE_MESSAGE);
      }
      if (!canTryAlternateMergeMethod(error)) {
        throw error;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  await Promise.all([
    invalidateCacheKey(pullRequestsCacheKey(repo)),
    invalidateCacheKey(pullRequestCacheKey(repo, pullNumber))
  ]);
}

async function disablePullRequestAutoMerge(payload: PullRequestAutoMergePayload): Promise<void> {
  const repo = ensureRepo(payload.repo);
  const pullNumber = ensurePullNumber(payload.pullNumber);
  const pullRequestId = ensurePullRequestId(payload.pullRequestId);
  const { gql } = await getClients();
  await gql(
    `
      mutation DisablePullRequestAutoMerge($pullRequestId: ID!) {
        disablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId }) {
          pullRequest {
            id
            autoMergeRequest { enabledAt }
          }
        }
      }
    `,
    { pullRequestId }
  );

  await Promise.all([
    invalidateCacheKey(pullRequestsCacheKey(repo)),
    invalidateCacheKey(pullRequestCacheKey(repo, pullNumber))
  ]);
}

async function mergePullRequest(payload: PullRequestActionPayload): Promise<void> {
  const repo = ensureRepo(payload.repo);
  const pullNumber = ensurePullNumber(payload.pullNumber);
  const { octokit } = await getClients();
  const repoResponse = await octokit.repos.get({
    owner: repo.owner,
    repo: repo.name
  });
  let lastError: unknown = null;

  for (const mergeMethod of preferredMergeMethods(repoResponse.data)) {
    try {
      await octokit.pulls.merge({
        owner: repo.owner,
        repo: repo.name,
        pull_number: pullNumber,
        merge_method: toRestMergeMethod(mergeMethod)
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (!canTryAlternateMergeMethod(error)) {
        throw error;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  await Promise.all([
    invalidateCacheKey(pullRequestsCacheKey(repo)),
    invalidateCacheKey(pullRequestCacheKey(repo, pullNumber))
  ]);
}

async function closePullRequest(payload: PullRequestActionPayload): Promise<void> {
  const repo = ensureRepo(payload.repo);
  const pullNumber = ensurePullNumber(payload.pullNumber);
  const { octokit } = await getClients();
  await octokit.pulls.update({
    owner: repo.owner,
    repo: repo.name,
    pull_number: pullNumber,
    state: "closed"
  });

  await Promise.all([
    invalidateCacheKey(pullRequestsCacheKey(repo)),
    invalidateCacheKey(pullRequestCacheKey(repo, pullNumber))
  ]);
}

async function openInGitHub(rawUrl: string): Promise<void> {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || (host !== "github.com" && host !== "www.github.com")) {
    throw new Error("Only github.com URLs can be opened from this action.");
  }

  await shell.openExternal(url.toString());
}

function notificationText(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, 240);
}

function focusMainWindow(): BrowserWindow {
  if (!mainWindow) {
    createWindow();
  }

  const targetWindow = mainWindow as BrowserWindow;
  if (targetWindow.isMinimized()) {
    targetWindow.restore();
  }
  targetWindow.show();
  targetWindow.focus();
  if (process.platform === "darwin") {
    app.focus({ steal: true });
  }
  return targetWindow;
}

function sendNotificationClick(source: NativeNotificationSource): void {
  const targetWindow = focusMainWindow();
  const send = (): void => {
    targetWindow.webContents.send("notifications:clicked", source);
  };

  if (targetWindow.webContents.isLoading()) {
    targetWindow.webContents.once("did-finish-load", send);
    return;
  }

  send();
}

function showNativeNotification(payload: NativeNotificationPayload): boolean {
  if (!Notification.isSupported()) {
    return false;
  }

  const icon = nativeImage.createFromPath(appIconPath("png"));
  const notification = new Notification({
    title: notificationText(payload.title, appDisplayName),
    body: notificationText(payload.body, "New Forge notification"),
    icon: icon.isEmpty() ? undefined : icon
  });

  activeNotifications.add(notification);
  notification.once("click", () => {
    activeNotifications.delete(notification);
    sendNotificationClick(payload.source);
  });
  notification.once("close", () => activeNotifications.delete(notification));
  notification.show();
  return true;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    title: appDisplayName,
    icon: appIconPath("png"),
    backgroundColor: windowBackgroundColorForSidebarAppearance(sidebarAppearanceMode),
    transparent: process.platform === "darwin",
    vibrancy: process.platform === "darwin" ? "sidebar" : undefined,
    visualEffectState: process.platform === "darwin" ? "followWindow" : undefined,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      zoomFactor: appDefaultZoomFactor,
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

function normalizeSidebarAppearanceMode(mode: unknown): SidebarAppearanceMode {
  return mode === "normal" ? "normal" : DEFAULT_SIDEBAR_APPEARANCE_MODE;
}

function normalizeNativeThemeSource(source: unknown): NativeThemeSource {
  return source === "light" || source === "dark" ? source : "system";
}

function setSidebarAppearanceMode(mode: SidebarAppearanceMode): void {
  sidebarAppearanceMode = mode;

  if (!mainWindow) {
    return;
  }

  if (process.platform === "darwin") {
    mainWindow.setVibrancy(mode === "glass" ? "sidebar" : null);
    mainWindow.setBackgroundColor(windowBackgroundColorForSidebarAppearance(mode));
    return;
  }

  mainWindow.setBackgroundColor(normalWindowBackground);
}

function setNativeThemeSource(source: NativeThemeSource): void {
  nativeTheme.themeSource = source;

  if (process.platform === "darwin" && mainWindow && sidebarAppearanceMode === "glass") {
    mainWindow.setVibrancy("sidebar");
  }
}

function registerIpc(): void {
  ipcMain.handle("auth:get-status", () => getAuthStatus());
  ipcMain.handle("auth:save-token", async (_event, token: string) => {
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      throw new Error("Token cannot be empty.");
    }
    await validateTokenBeforeSave(trimmedToken);
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
  ipcMain.handle("github:get-repo", (_event, repo: RepoRef, options?: CacheRequestOptions) =>
    getRepo(repo, options)
  );
  ipcMain.handle("github:get-repo-labels", (_event, repo: RepoRef, options?: CacheRequestOptions) =>
    getRepoLabels(repo, options)
  );
  ipcMain.handle("github:get-pull-requests", (_event, repo: RepoRef, options?: CacheRequestOptions) =>
    getPullRequests(repo, options)
  );
  ipcMain.handle("github:get-issues", (_event, repo: RepoRef, options?: CacheRequestOptions) =>
    getIssues(repo, options)
  );
  ipcMain.handle("github:get-workflows", (_event, repo: RepoRef, options?: CacheRequestOptions) =>
    getWorkflows(repo, options)
  );
  ipcMain.handle("github:get-workflow-runs", (_event, repo: RepoRef, options?: CacheRequestOptions) =>
    getWorkflowRuns(repo, options)
  );
  ipcMain.handle("github:get-pull-request", (_event, repo: RepoRef, number: number, options?: CacheRequestOptions) =>
    getPullRequest(repo, number, options)
  );
  ipcMain.handle("github:get-workflow-run", (_event, repo: RepoRef, runId: number, options?: CacheRequestOptions) =>
    getWorkflowRun(repo, runId, options)
  );
  ipcMain.handle("github:get-workflow-job", (_event, repo: RepoRef, jobId: number) =>
    getWorkflowJob(repo, jobId)
  );
  ipcMain.handle("github:dispatch-workflow", (_event, payload: DispatchWorkflowPayload) =>
    dispatchWorkflow(payload)
  );
  ipcMain.handle("dialog:confirm-pull-request-approval", (event, pullNumber: number) =>
    confirmPullRequestApproval(event, pullNumber)
  );
  ipcMain.handle("github:submit-pull-request-review", (_event, payload: SubmitPullRequestReviewPayload) =>
    submitPullRequestReview(payload)
  );
  ipcMain.handle("github:add-pull-request-comment", (_event, payload: AddPullRequestCommentPayload) =>
    addPullRequestComment(payload)
  );
  ipcMain.handle("github:update-pull-request-title", (_event, payload: UpdatePullRequestTitlePayload) =>
    updatePullRequestTitle(payload)
  );
  ipcMain.handle("github:update-pull-request-draft-state", (_event, payload: UpdatePullRequestDraftStatePayload) =>
    updatePullRequestDraftState(payload)
  );
  ipcMain.handle("github:add-pull-request-label", (_event, payload: PullRequestLabelPayload) =>
    addPullRequestLabel(payload)
  );
  ipcMain.handle("github:remove-pull-request-label", (_event, payload: PullRequestLabelPayload) =>
    removePullRequestLabel(payload)
  );
  ipcMain.handle("github:enable-pull-request-auto-merge", (_event, payload: PullRequestAutoMergePayload) =>
    enablePullRequestAutoMerge(payload)
  );
  ipcMain.handle("github:disable-pull-request-auto-merge", (_event, payload: PullRequestAutoMergePayload) =>
    disablePullRequestAutoMerge(payload)
  );
  ipcMain.handle("github:merge-pull-request", (_event, payload: PullRequestActionPayload) =>
    mergePullRequest(payload)
  );
  ipcMain.handle("github:close-pull-request", (_event, payload: PullRequestActionPayload) =>
    closePullRequest(payload)
  );
  ipcMain.handle("github:open-in-github", (_event, url: string) => openInGitHub(url));
  ipcMain.handle("notifications:show", (_event, payload: NativeNotificationPayload) =>
    showNativeNotification(payload)
  );
  ipcMain.handle("window:set-native-theme-source", (_event, source: NativeThemeSource) => {
    setNativeThemeSource(normalizeNativeThemeSource(source));
  });
  ipcMain.handle("window:set-sidebar-appearance-mode", (_event, mode: SidebarAppearanceMode) => {
    setSidebarAppearanceMode(normalizeSidebarAppearanceMode(mode));
  });
}

registerIpc();

app.whenReady().then(async () => {
  await migrateLegacyUserData();
  configureAppPresentation();
  createApplicationMenu();
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
