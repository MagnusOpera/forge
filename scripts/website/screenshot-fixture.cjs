// Synthetic data only. Loaded by the screenshot harness, never by the app.
const settings = { model: "", effort: "", speed: "normal", mode: "implement", followUp: "steer", permissions: "ask" };
const repo = {
  id: "forge-demo", owner: "acme", name: "workspace", fullName: "acme/workspace",
  description: "A focus-first desktop workspace for GitHub and Codex.",
  defaultBranch: "main", viewerPermission: "ADMIN", isPrivate: false, isArchived: false,
  isFork: false, url: "https://github.com/acme/workspace"
};
const repositories = [repo, { ...repo, id: "docs-demo", name: "docs", fullName: "acme/docs" }, { ...repo, id: "tools-demo", name: "developer-tools", fullName: "acme/developer-tools" }];
const thread = {
  id: "website-demo", repositoryId: repo.id, title: "Make workflow failures easier to investigate",
  archived: false, createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-01T10:02:00Z",
  settings, state: "idle", worktree: "/demo/workspace/worktrees/workflow-details",
  repositoryPath: "/demo/workspace", branch: "codex/workspace-website-demo", baseCommit: "a12bc34",
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
const threads = [
  thread,
  { ...thread, id: "plan-demo", title: "Plan keyboard navigation improvements", settings: { ...settings, mode: "plan" }, items: [] },
  { ...thread, id: "docs-demo", title: "Document local development setup", items: [] }
];
const releases = [
  { id: "release-stable", databaseId: 1, name: "Workspace 1.4", tagName: "v1.4.0", isDraft: false, isPrerelease: false, isLatest: true, createdAt: "2026-10-24T10:00:00Z", publishedAt: "2026-10-24T12:00:00Z", description: "Improved workflow navigation and keyboard shortcuts.", url: "https://github.com/acme/workspace/releases/tag/v1.4.0" },
  { id: "release-preview", databaseId: 2, name: "Workspace 1.5 Preview", tagName: "v1.5.0-beta.1", isDraft: false, isPrerelease: true, isLatest: false, createdAt: "2026-10-28T10:00:00Z", publishedAt: "2026-10-28T12:00:00Z", description: "Try the next workspace improvements.", url: "https://github.com/acme/workspace/releases/tag/v1.5.0-beta.1" },
  { id: "release-draft", databaseId: 3, name: "Workspace 1.5", tagName: "v1.5.0", isDraft: true, isPrerelease: false, isLatest: false, createdAt: "2026-11-01T10:00:00Z", publishedAt: null, description: "## A faster path from draft to release\n\n- Keep stable releases, previews, and drafts in separate views.\n- Publish an existing draft without rewriting its release notes.\n- Preserve prerelease status and mark stable releases as Latest.\n\n## Workflow improvements\n\nReview failing jobs first and keep every change a click away on GitHub.\n\n**Full Changelog**: [v1.4.0...v1.5.0](https://github.com/acme/workspace/compare/v1.4.0...v1.5.0)", url: "https://github.com/acme/workspace/releases/3" }
];
const gitFile = "src/workflowDetails.ts";
const gitFileText = `import type { WorkflowJob } from "./workflowTypes";

const failureStates = new Set(["failure", "timed_out"]);

export function summarizeWorkflow(
  jobs: WorkflowJob[],
) {
  const failed = jobs.filter(({ conclusion }) =>
    failureStates.has(conclusion),
  );
  const completed = jobs.filter(
    ({ status }) => status === "completed",
  );

  return {
    totalJobs: jobs.length,
    completedJobs: completed.length,
    failedJobs: failed.map(job => ({
      name: job.name,
      url: job.htmlUrl,
      failedStep: job.steps.find(
        step => step.conclusion === "failure",
      )?.name,
    })),
  };
}

export function workflowHeadline(
  jobs: WorkflowJob[],
) {
  const { completedJobs, failedJobs } =
    summarizeWorkflow(jobs);
  if (failedJobs.length > 1) {
    return \`\${failedJobs.length} jobs failed\`;
  }
  return failedJobs[0]?.name ??
    \`\${completedJobs} jobs completed\`;
}
`;
const gitSnapshot = {
  kind: "ready",
  checkout: "/demo/workspace",
  revision: "demo-workflow-summary",
  branch: "feature/workflow-summary",
  pushDestination: "origin/feature/workflow-summary",
  branches: [
    { ref: "refs/heads/feature/workflow-summary", label: "feature/workflow-summary" },
    { ref: "refs/heads/main", label: "main" },
    { ref: "refs/remotes/origin/release/1.5", label: "release/1.5", remote: "origin" },
  ],
  files: [
    { path: ".github/workflows/ci.yml", status: "clean" },
    { path: ".gitignore", status: "clean" },
    { path: "docs/workflows.md", status: "clean" },
    { path: "package.json", status: "clean" },
    { path: "README.md", status: "clean" },
    { path: "src/index.ts", status: "clean" },
    { path: gitFile, status: "changed" },
    { path: "src/workflowDetails.test.ts", status: "changed" },
    { path: "src/workflowFilters.ts", status: "conflict" },
    { path: "src/workflowTypes.ts", status: "clean" },
    { path: "tsconfig.json", status: "clean" },
  ],
  blockers: {
    fetch: null,
    pull: "Finish the pending Git operation first.",
    push: "Finish the pending Git operation first.",
    switch: "Finish the pending Git operation first.",
  },
};
const gitFileCommits = [
  { commit: "a18bd0f".padEnd(40, "0"), date: "2026-10-02T14:15:00Z", subject: "Show the failing workflow step" },
  { commit: "70e9d2a".padEnd(40, "0"), date: "2026-10-01T10:30:00Z", subject: "Handle timed-out jobs" },
  { commit: "54f1b83".padEnd(40, "0"), date: "2026-09-28T09:00:00Z", subject: "Add workflow summaries" },
];
const envelope = data => ({ data, fetchedAt: "2026-10-01T10:02:00Z", stale: false, source: "cache" });
window.githubFocus = {
  platform: "darwin",
  getAuthStatus: async () => ({ configured: true, encryptionAvailable: true, viewerLogin: "demo" }),
  getRepositories: async () => envelope(repositories),
  getStarredRepos: async () => envelope(repositories),
  getRecentRepos: async () => envelope(repositories),
  getOrganizations: async () => envelope([]),
  getRepo: async () => envelope(repo),
  getReleases: async () => envelope(releases),
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
  request: async (method, input) => {
    switch (method) {
      case "configuration": return { editor: "Visual Studio Code", executable: "codex", defaults: settings, projects: { [repo.id]: { repositoryId: repo.id, path: "/demo/workspace", overrides: {} } } };
      case "list": return threads;
      case "search": return threads.filter(item => item.archived === input.archived).flatMap(item => {
        const messages = item.items.filter(message => ["userMessage", "agentMessage"].includes(message.kind));
        const text = [item.title, ...messages.map(message => message.text)].join("\n").toLowerCase();
        if (!input.query.toLowerCase().split(/\s+/).every(word => text.includes(word))) return [];
        return [{ id: item.id, snippet: messages[0]?.text || item.title }];
      });
      case "thread": return { thread, before: null };
      case "threadWindows": return [];
      case "models": return [];
      case "gitSnapshot": return gitSnapshot;
      case "gitFileHistory": return {
        commits: input.path === gitFile ? gitFileCommits
          .slice(Math.max(0, gitFileCommits.findIndex(({ commit }) => commit === input.commit)))
          .map((commit) => ({ ...commit, path: gitFile })) : [],
        hasOlder: false,
      };
      case "gitRepositoryHistory": return {
        commits: [
          { commit: "861b0fa".padEnd(40, "0"), date: "2026-10-03T16:20:00Z", subject: "Document workflow configuration" },
          ...gitFileCommits,
        ],
        hasOlder: false,
      };
      case "gitHistoricalTree": return {
        files: gitSnapshot.files.filter(({ path }) => path !== "src/workflowFilters.ts").map(({ path }) => ({ path, status: "clean" })),
      };
      case "gitHistoricalPreview": return { kind: "text", text: gitFileText.replace('"failure", "timed_out"', '"failure"') };
      case "gitPreview": {
        if (input.path !== gitFile) throw new Error("Unexpected screenshot file: " + input.path);
        return { kind: "text", text: gitFileText };
      }
      default: throw new Error("Unsupported screenshot fixture request: " + method);
    }
  }
};
localStorage.clear();
for (const [key, value] of Object.entries({
  "favorites": repositories.map(item => item.fullName),
  "project-focus-view": "codex",
  "left-width": 320, "middle-width": 320,
  "theme": process.env.FORGE_SCREENSHOT_THEME || "dark",
  "sidebar-appearance:dark": "normal", "sidebar-appearance:light": "normal"
})) localStorage.setItem("github-focus:" + key, JSON.stringify(value));
