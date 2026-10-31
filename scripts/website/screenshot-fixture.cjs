// Synthetic data only. Loaded by the screenshot harness, never by the app.
const settings = { model: "", effort: "", speed: "normal", mode: "implement", followUp: "steer", permissions: "ask" };
const repo = {
  id: "forge-demo", owner: "MagnusOpera", name: "forge", fullName: "MagnusOpera/forge",
  description: "A focus-first desktop workspace for GitHub and Codex.",
  defaultBranch: "main", viewerPermission: "ADMIN", isPrivate: false, isArchived: false,
  isFork: false, url: "https://github.com/MagnusOpera/forge"
};
const repositories = [repo, { ...repo, id: "docs-demo", name: "docs", fullName: "MagnusOpera/docs" }, { ...repo, id: "tools-demo", name: "developer-tools", fullName: "MagnusOpera/developer-tools" }];
const thread = {
  id: "website-demo", repositoryId: repo.id, title: "Make workflow failures easier to investigate",
  archived: false, createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-01T10:02:00Z",
  settings, state: "idle", worktree: "/demo/forge/worktrees/workflow-details",
  repositoryPath: "/demo/forge", branch: "codex/forge-website-demo", baseCommit: "a12bc34",
  serverId: "demo", requests: [], queue: [], queuePaused: false, draft: "", draftAttachments: [],
  turns: { turn: { durationMs: 83000 } },
  items: [
    { id: "user", kind: "userMessage", turnId: "turn", text: "Make failed workflow runs easier to investigate. Show the failing job first and keep an Open in GitHub link." },
    { id: "work", kind: "commandExecution", turnId: "turn", text: "npm test -- workflowDetails", status: "completed" },
    { id: "files", kind: "fileChange", turnId: "turn", text: "", changes: [
      { path: "src/workflowDetails.ts", diff: "@@ -1,2 +1,5 @@\n export function sortJobs(jobs) {\n-  return jobs;\n+  return [...jobs].sort((a, b) =>\n+    Number(b.conclusion === 'failure') -\n+    Number(a.conclusion === 'failure'));\n }" },
      { path: "src/workflowDetails.test.ts", diff: "@@ -0,0 +1,4 @@\n+it('shows failing jobs first', () => {\n+  const result = sortJobs([passedJob, failedJob]);\n+  expect(result[0]).toEqual(failedJob);\n+});" }
    ] },
    { id: "answer", kind: "agentMessage", phase: "final_answer", turnId: "turn",
      text: "Failed jobs now appear first, so you can jump straight to the relevant logs.\n\n- Kept **Open in GitHub** available for every job.\n- Added a regression test for job ordering.\n- Left successful runs in their original order.\n\n**Checks:** workflow detail tests passed.\n\nReady for your review. No commit or push was made." }
  ]
};
const envelope = data => ({ data, fetchedAt: "2026-10-01T10:02:00Z", stale: false, source: "cache" });
window.githubFocus = {
  platform: "darwin",
  getAuthStatus: async () => ({ configured: true, encryptionAvailable: true, viewerLogin: "demo" }),
  getRepositories: async () => envelope(repositories),
  getStarredRepos: async () => envelope(repositories),
  getRecentRepos: async () => envelope(repositories),
  getOrganizations: async () => envelope([]),
  getRepo: async () => envelope(repo),
  ...Object.fromEntries(["getRepoLabels", "getPullRequests", "getIssues", "getWorkflows", "getWorkflowRuns"].map(key => [key, async () => envelope([])])),
  onNativeNotificationClicked: () => () => {},
  onCacheUpdated: () => () => {},
  setNativeThemeSource: async () => {},
  setSidebarAppearanceMode: async () => {},
  requestNotificationPermission: async () => "denied",
  showNativeNotification: async () => false
};
window.forgeCodex = {
  onChanged: () => () => {},
  request: async (method) => {
    switch (method) {
      case "configuration": return { editor: "Visual Studio Code", executable: "codex", defaults: settings, projects: { [repo.id]: { repositoryId: repo.id, path: "/demo/forge", overrides: {} } } };
      case "list": return [thread, { ...thread, id: "plan-demo", title: "Plan keyboard navigation improvements", settings: { ...settings, mode: "plan" } }, { ...thread, id: "docs-demo", title: "Document local development setup" }];
      case "thread": return { thread, before: null };
      case "threadWindows": return [];
      case "models": return [];
      default: throw new Error("Unsupported screenshot fixture request: " + method);
    }
  }
};
localStorage.clear();
for (const [key, value] of Object.entries({
  "favorites": repositories.map(item => item.fullName),
  "project-focus-view": "codex",
  "left-width": 240, "middle-width": 340,
  "theme": process.env.FORGE_SCREENSHOT_THEME || "dark",
  "sidebar-appearance:dark": "normal", "sidebar-appearance:light": "normal"
})) localStorage.setItem("github-focus:" + key, JSON.stringify(value));
