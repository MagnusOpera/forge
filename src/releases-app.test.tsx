// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { GithubFocusApi, ReleaseSummary, RepoSummary } from "../shared/github";

vi.mock("./codex/api", () => ({ useCodexThreads: () => ({ threads: [], loading: false, error: null }) }));
vi.mock("./codex/settings", () => ({ CodexSettingsDialog: () => null }));
vi.mock("./codex/conversation", () => ({ CodexConversation: () => <div>Codex conversation</div> }));
vi.mock("./codex/threads", () => ({ CodexThreadList: () => <div>Codex threads</div> }));
const repo = { id: "repo", owner: "test", name: "repo", fullName: "test/repo", url: "https://github.com/test/repo", labels: [], viewerPermission: "ADMIN" } as unknown as RepoSummary;
let currentRepo = repo;
let currentRepos = [repo];
const releases: ReleaseSummary[] = [
  { id: "published", name: "Version one", tagName: "v1", description: "## Changes\n\nPublished **notes**.", isDraft: false, isPrerelease: false, createdAt: "2026-01-01T00:00:00Z", publishedAt: "2026-02-01T00:00:00Z", url: "https://github.com/test/repo/releases/tag/v1" },
  { id: "draft", databaseId: 42, name: "Next version", tagName: "v2", description: "Draft notes.", isDraft: true, isPrerelease: false, createdAt: "2026-03-01T00:00:00Z", publishedAt: null, url: "https://github.com/test/repo/releases/2" }
];
let currentReleases = releases;
const cacheListeners = new Set<(key: string) => void>();
const publishRelease = vi.fn();
const openInGitHub = vi.fn(async () => {});
const getPullRequests = vi.fn(async () => ({ data: [] }));
const getWorkflowRuns = vi.fn(async () => ({ data: [] }));
const getReleases = vi.fn(async () => ({ data: currentReleases }));
let App: typeof import("./App").App;
let root: Root, container: HTMLDivElement;
beforeAll(async () => {
  window.githubFocus = {
    platform: "browser", openInGitHub, publishRelease,
    getAuthStatus: async () => ({ configured: true, encryptionAvailable: false, viewerLogin: "test" }),
    getRepositories: async () => ({ data: currentRepos }), getStarredRepos: async () => ({ data: [] }),
    getRecentRepos: async () => ({ data: [] }), getOrganizations: async () => ({ data: [] }),
    getRepo: async () => ({ data: currentRepo }), getRepoLabels: async () => ({ data: [] }),
    getPullRequests, getIssues: async () => ({ data: [] }),
    getWorkflows: async () => ({ data: [] }), getWorkflowRuns, getReleases,
    onCacheUpdated: (listener: (key: string) => void) => { cacheListeners.add(listener); return () => cacheListeners.delete(listener); }, onNativeNotificationClicked: () => () => {},
    setNativeThemeSource: async () => {}, setSidebarAppearanceMode: async () => {},
  } as unknown as GithubFocusApi;
  ({ App } = await import("./App"));
});
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); getReleases.mockClear(); openInGitHub.mockClear();
  currentRepo = repo;
  currentRepos = [repo];
  getPullRequests.mockReset().mockResolvedValue({ data: [] });
  getWorkflowRuns.mockReset().mockResolvedValue({ data: [] });
  currentReleases = releases.map(release => ({ ...release }));
  publishRelease.mockReset().mockImplementation(async () => {
    const published = { ...currentReleases[1], isDraft: false, isLatest: !currentReleases[1].isPrerelease, publishedAt: "2026-04-01T00:00:00Z" };
    currentReleases = [currentReleases[0], published];
    cacheListeners.forEach(listener => listener("repo:test/repo:releases"));
    return published;
  });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it.each(["light", "dark"])("opens Releases by shortcut, reads notes with keyboard selection, switches drafts, and refreshes in %s", async theme => {
  localStorage.setItem("github-focus:theme", JSON.stringify(theme));
  await act(async () => root.render(<App />));
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "L", metaKey: true, shiftKey: true, bubbles: true, cancelable: true })));
  expect(container.querySelector('[aria-label="Release view"]')).not.toBeNull();
  expect(container.querySelector('.project-pane .focus-title')?.textContent).toBe("Version one");
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true, cancelable: true })));
  expect(container.querySelector(".content-pane h1")?.textContent).toBe("Version one");
  expect(container.querySelector(".content-pane .markdown-block strong")?.textContent).toBe("notes");
  await act(async () => container.querySelector<HTMLButtonElement>('.content-header [aria-label="Copy content GitHub URL. Double-click to open in GitHub"]')!.dispatchEvent(new MouseEvent("click", { detail: 2, bubbles: true })));
  expect(openInGitHub).toHaveBeenCalledWith(releases[0].url);
  await act(async () => container.querySelectorAll<HTMLButtonElement>('[aria-label="Release view"] [role="tab"]')[2].click());
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true, cancelable: true })));
  expect(container.querySelector(".content-pane h1")?.textContent).toBe("Next version");
  expect(container.querySelector(".content-pane .markdown-block")?.textContent).toBe("Draft notes.");
  await act(async () => container.querySelector<HTMLButtonElement>('.project-view-button[aria-pressed="true"]')!.click());
  expect(getReleases).toHaveBeenCalledWith(expect.objectContaining({ owner: "test", name: "repo" }), { force: true });
});

it.each(["light", "dark"])("refreshes only when reselecting a project icon and replays feedback in %s", async theme => {
  localStorage.setItem("github-focus:theme", JSON.stringify(theme));
  await act(async () => root.render(<App />));
  const header = container.querySelector(".project-pane .pane-header")!;
  expect(header.querySelector('[aria-label="Refresh repository"]')).toBeNull();
  expect(header.querySelector(".toolbar-divider")).toBeNull();
  const buttons = [...header.querySelectorAll<HTMLButtonElement>(".project-view-button")];
  // Start with a different view, then visit every icon, including Codex.
  if (buttons[1].getAttribute("aria-pressed") !== "true") {
    await act(async () => buttons[1].click());
  }
  for (const button of [buttons[0], ...buttons.slice(1)]) {
    getReleases.mockClear();
    const previousUnderline = header.querySelector(".sliding-tab-underline");
    await act(async () => button.click());
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(getReleases).not.toHaveBeenCalledWith(repo, { force: true });
    // Changing views moves the existing underline without restarting feedback.
    expect(header.querySelector(".sliding-tab-underline")).toBe(previousUnderline);
    for (let attempt = 0; attempt < 2; attempt++) {
      getReleases.mockClear();
      const underline = header.querySelector(".sliding-tab-underline");
      await act(async () => button.click());
      expect(getReleases).toHaveBeenCalledExactlyOnceWith(repo, { force: true });
      const feedback = header.querySelector(".sliding-tab-underline");
      expect(feedback).not.toBe(underline);
      expect(feedback?.classList.contains("project-refresh-underline")).toBe(true);
      expect(button.classList.contains("underline-action")).toBe(false);
      expect(header.querySelectorAll(".sliding-tab-underline")).toHaveLength(1);
    }
  }
});

it("restarts the global favorites refresh from Checked now and prevents overlapping checks", async () => {
  const otherRepo = { ...repo, id: "other", name: "other", fullName: "test/other" };
  currentRepos = [repo, otherRepo];
  localStorage.setItem("github-focus:favorites", JSON.stringify(["test/repo", "test/other"]));
  await act(async () => root.render(<App />));
  // Let the initial scheduled monitor complete.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  const status = container.querySelector(".sidebar-monitor-status")!;
  expect(status.textContent).toBe("Checked now");
  const button = status.querySelector<HTMLButtonElement>('button[aria-label="Refresh favorite repositories"]')!;
  getPullRequests.mockClear();
  getWorkflowRuns.mockClear();
  let finish!: (value: { data: [] }) => void;
  getPullRequests.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => button.click());
  expect(status.textContent).toBe("Checking favorites");
  expect(button.disabled).toBe(true);
  expect(button.querySelector(".spin")).not.toBeNull();
  await act(async () => button.click());
  expect(getPullRequests).toHaveBeenCalledTimes(1);
  await act(async () => finish({ data: [] }));
  for (const favorite of currentRepos) {
    expect(getPullRequests).toHaveBeenCalledWith(favorite, { force: true });
    expect(getWorkflowRuns).toHaveBeenCalledWith(favorite, { force: true });
  }
  expect(getPullRequests).toHaveBeenCalledTimes(2);
  expect(getWorkflowRuns).toHaveBeenCalledTimes(2);
  expect(status.textContent).toBe("Checked now");
  expect(button.disabled).toBe(false);
});

async function openDraft() {
  await act(async () => root.render(<App />));
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "L", metaKey: true, shiftKey: true, bubbles: true })));
  await act(async () => container.querySelectorAll<HTMLButtonElement>('[aria-label="Release view"] [role="tab"]')[2].click());
  await act(async () => container.querySelector<HTMLButtonElement>(".project-pane .focus-row")!.click());
}

it.each(["light", "dark"])("publishes a stable draft as latest and moves it from Draft to Active in %s", async theme => {
  localStorage.setItem("github-focus:theme", JSON.stringify(theme));
  await openDraft();
  expect(container.textContent).toContain("Publishes as the latest release.");
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Release actions"]')!;
  expect(trigger.classList.contains("pr-management-trigger")).toBe(true);
  await act(async () => { trigger.focus(); trigger.click(); });
  expect(publishRelease).not.toHaveBeenCalled();
  expect(container.querySelector('[role="group"][aria-label="Release actions"] .pr-management-option')?.textContent).toBe("Publish release");
  await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent?.trim() === "Publish release")!.click());
  expect(publishRelease).toHaveBeenCalledExactlyOnceWith({ repo, releaseId: 42 });
  expect(container.querySelector(".content-pane .eyebrow")?.textContent).toContain("Latest");
  expect(container.querySelector(".project-pane")?.textContent).toContain("No draft releases");
  await act(async () => container.querySelectorAll<HTMLButtonElement>('[aria-label="Release view"] [role="tab"]')[0].click());
  expect(container.querySelector(".project-pane .focus-title")?.textContent).toBe("Next version");
});
it("retains prerelease status and does not label it Latest", async () => {
  currentReleases[1].isPrerelease = true;
  await openDraft();
  expect(container.textContent).toContain("Publishes as a pre-release.");
  await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent?.trim() === "Publish release")!.click());
  expect(container.querySelector(".content-pane .eyebrow")?.textContent).toContain("Pre-release");
  expect(container.querySelector(".content-pane .eyebrow")?.textContent).not.toContain("Latest");
  await act(async () => container.querySelectorAll<HTMLButtonElement>('[aria-label="Release view"] [role="tab"]')[0].click());
  expect(container.querySelector(".project-pane")?.textContent).not.toContain("Next version");
  await act(async () => container.querySelectorAll<HTMLButtonElement>('[aria-label="Release view"] [role="tab"]')[1].click());
  expect(container.querySelector(".project-pane .focus-title")?.textContent).toBe("Next version");
});
it("keeps the draft and shows errors when publication fails, allowing retry", async () => {
  publishRelease.mockRejectedValueOnce(new Error("GitHub denied publication"));
  await openDraft();
  const publish = [...container.querySelectorAll("button")].find(button => button.textContent?.trim() === "Publish release")!;
  await act(async () => publish.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("GitHub denied publication");
  expect(container.querySelector(".content-pane .eyebrow")?.textContent).toContain("Draft");
  expect(publish.disabled).toBe(false);
  await act(async () => publish.click());
  expect(publishRelease).toHaveBeenCalledTimes(2);
  expect(container.querySelector(".content-pane .eyebrow")?.textContent).toContain("Published");
});
it("blocks duplicate publishing while a request is in progress", async () => {
  let resolve!: (release: ReleaseSummary) => void;
  publishRelease.mockImplementationOnce(() => new Promise<ReleaseSummary>(done => { resolve = done; }));
  await openDraft();
  const publish = [...container.querySelectorAll("button")].find(button => button.textContent?.trim() === "Publish release")!;
  await act(async () => { publish.click(); publish.click(); });
  expect(publishRelease).toHaveBeenCalledTimes(1);
  expect(publish.disabled).toBe(true);
  await act(async () => resolve({ ...releases[1], isDraft: false, isLatest: true }));
});

it("shows draft notes without a publish action for read-only repositories", async () => {
  currentRepo = { ...repo, viewerPermission: "READ" };
  await openDraft();
  expect(container.querySelector(".content-pane h1")?.textContent).toBe("Next version");
  expect([...container.querySelectorAll("button")].some(button => button.textContent?.trim() === "Publish release")).toBe(false);
  expect(publishRelease).not.toHaveBeenCalled();
});
