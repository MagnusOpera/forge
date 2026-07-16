import { contextBridge, ipcRenderer } from "electron";
import type {
  AddPullRequestCommentPayload,
  CacheRequestOptions,
  DispatchWorkflowPayload,
  GithubFocusApi,
  NativeNotificationPermission,
  NativeNotificationPayload,
  NativeNotificationSource,
  PullRequestActionPayload,
  PullRequestAutoMergePayload,
  PullRequestLabelPayload,
  RepoRef,
  SubmitPullRequestReviewPayload,
  UpdatePullRequestDraftStatePayload,
  UpdatePullRequestTitlePayload
} from "../../shared/github.js";

function currentNotificationPermission(): NativeNotificationPermission {
  if (typeof Notification === "undefined") {
    return "unsupported";
  }

  return Notification.permission;
}

async function requestNotificationPermission(): Promise<NativeNotificationPermission> {
  if (typeof Notification === "undefined") {
    return "unsupported";
  }

  if (Notification.permission !== "default" || typeof Notification.requestPermission !== "function") {
    return Notification.permission;
  }

  return Notification.requestPermission();
}

const api: GithubFocusApi = {
  platform: process.platform,
  getAuthStatus: () => ipcRenderer.invoke("auth:get-status"),
  saveToken: (token: string) => ipcRenderer.invoke("auth:save-token", token),
  clearToken: () => ipcRenderer.invoke("auth:clear-token"),
  getRepositories: () => ipcRenderer.invoke("github:get-repositories"),
  getStarredRepos: () => ipcRenderer.invoke("github:get-starred-repos"),
  getRecentRepos: () => ipcRenderer.invoke("github:get-recent-repos"),
  getOrganizations: () => ipcRenderer.invoke("github:get-organizations"),
  getRepo: (repo: RepoRef, options?: CacheRequestOptions) => ipcRenderer.invoke("github:get-repo", repo, options),
  getRepoLabels: (repo: RepoRef, options?: CacheRequestOptions) =>
    ipcRenderer.invoke("github:get-repo-labels", repo, options),
  getPullRequests: (repo: RepoRef, options?: CacheRequestOptions) =>
    ipcRenderer.invoke("github:get-pull-requests", repo, options),
  getIssues: (repo: RepoRef, options?: CacheRequestOptions) =>
    ipcRenderer.invoke("github:get-issues", repo, options),
  getWorkflows: (repo: RepoRef, options?: CacheRequestOptions) =>
    ipcRenderer.invoke("github:get-workflows", repo, options),
  getWorkflowDispatchConfig: (repo: RepoRef, workflowId: number, ref: string) =>
    ipcRenderer.invoke("github:get-workflow-dispatch-config", repo, workflowId, ref),
  getWorkflowRuns: (repo: RepoRef, options?: CacheRequestOptions) =>
    ipcRenderer.invoke("github:get-workflow-runs", repo, options),
  getPullRequest: (repo: RepoRef, number: number, options?: CacheRequestOptions) =>
    ipcRenderer.invoke("github:get-pull-request", repo, number, options),
  getWorkflowRun: (repo: RepoRef, runId: number, options?: CacheRequestOptions) =>
    ipcRenderer.invoke("github:get-workflow-run", repo, runId, options),
  getWorkflowJob: (repo: RepoRef, jobId: number) =>
    ipcRenderer.invoke("github:get-workflow-job", repo, jobId),
  dispatchWorkflow: (payload: DispatchWorkflowPayload) =>
    ipcRenderer.invoke("github:dispatch-workflow", payload),
  confirmPullRequestApproval: (pullNumber: number) =>
    ipcRenderer.invoke("dialog:confirm-pull-request-approval", pullNumber),
  submitPullRequestReview: (payload: SubmitPullRequestReviewPayload) =>
    ipcRenderer.invoke("github:submit-pull-request-review", payload),
  addPullRequestComment: (payload: AddPullRequestCommentPayload) =>
    ipcRenderer.invoke("github:add-pull-request-comment", payload),
  updatePullRequestTitle: (payload: UpdatePullRequestTitlePayload) =>
    ipcRenderer.invoke("github:update-pull-request-title", payload),
  updatePullRequestDraftState: (payload: UpdatePullRequestDraftStatePayload) =>
    ipcRenderer.invoke("github:update-pull-request-draft-state", payload),
  addPullRequestLabel: (payload: PullRequestLabelPayload) =>
    ipcRenderer.invoke("github:add-pull-request-label", payload),
  removePullRequestLabel: (payload: PullRequestLabelPayload) =>
    ipcRenderer.invoke("github:remove-pull-request-label", payload),
  enablePullRequestAutoMerge: (payload: PullRequestAutoMergePayload) =>
    ipcRenderer.invoke("github:enable-pull-request-auto-merge", payload),
  disablePullRequestAutoMerge: (payload: PullRequestAutoMergePayload) =>
    ipcRenderer.invoke("github:disable-pull-request-auto-merge", payload),
  mergePullRequest: (payload: PullRequestActionPayload) =>
    ipcRenderer.invoke("github:merge-pull-request", payload),
  closePullRequest: (payload: PullRequestActionPayload) =>
    ipcRenderer.invoke("github:close-pull-request", payload),
  openInGitHub: (url: string) => ipcRenderer.invoke("github:open-in-github", url),
  requestNotificationPermission: async () => {
    const permission = await requestNotificationPermission();
    return permission === "unsupported" ? currentNotificationPermission() : permission;
  },
  showNativeNotification: (payload: NativeNotificationPayload) =>
    ipcRenderer.invoke("notifications:show", payload),
  onNativeNotificationClicked: (callback: (source: NativeNotificationSource) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, source: NativeNotificationSource) => callback(source);
    ipcRenderer.on("notifications:clicked", listener);
    return () => ipcRenderer.removeListener("notifications:clicked", listener);
  },
  onCacheUpdated: (callback: (key: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, key: string) => callback(key);
    ipcRenderer.on("github:cache-updated", listener);
    return () => ipcRenderer.removeListener("github:cache-updated", listener);
  },
  setNativeThemeSource: (source) => ipcRenderer.invoke("window:set-native-theme-source", source),
  setSidebarAppearanceMode: (mode) => ipcRenderer.invoke("window:set-sidebar-appearance-mode", mode)
};

contextBridge.exposeInMainWorld("githubFocus", api);
