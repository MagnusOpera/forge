import { contextBridge, ipcRenderer } from "electron";
import type { DispatchWorkflowPayload, GithubFocusApi, RepoRef } from "../../shared/github.js";

const api: GithubFocusApi = {
  platform: process.platform,
  getAuthStatus: () => ipcRenderer.invoke("auth:get-status"),
  saveToken: (token: string) => ipcRenderer.invoke("auth:save-token", token),
  clearToken: () => ipcRenderer.invoke("auth:clear-token"),
  getRepositories: () => ipcRenderer.invoke("github:get-repositories"),
  getStarredRepos: () => ipcRenderer.invoke("github:get-starred-repos"),
  getRecentRepos: () => ipcRenderer.invoke("github:get-recent-repos"),
  getOrganizations: () => ipcRenderer.invoke("github:get-organizations"),
  getRepo: (repo: RepoRef) => ipcRenderer.invoke("github:get-repo", repo),
  getPullRequests: (repo: RepoRef) => ipcRenderer.invoke("github:get-pull-requests", repo),
  getIssues: (repo: RepoRef) => ipcRenderer.invoke("github:get-issues", repo),
  getWorkflows: (repo: RepoRef) => ipcRenderer.invoke("github:get-workflows", repo),
  getWorkflowRuns: (repo: RepoRef) => ipcRenderer.invoke("github:get-workflow-runs", repo),
  getPullRequest: (repo: RepoRef, number: number) =>
    ipcRenderer.invoke("github:get-pull-request", repo, number),
  getWorkflowRun: (repo: RepoRef, runId: number) =>
    ipcRenderer.invoke("github:get-workflow-run", repo, runId),
  dispatchWorkflow: (payload: DispatchWorkflowPayload) =>
    ipcRenderer.invoke("github:dispatch-workflow", payload),
  openInGitHub: (url: string) => ipcRenderer.invoke("github:open-in-github", url),
  onCacheUpdated: (callback: (key: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, key: string) => callback(key);
    ipcRenderer.on("github:cache-updated", listener);
    return () => ipcRenderer.removeListener("github:cache-updated", listener);
  }
};

contextBridge.exposeInMainWorld("githubFocus", api);
