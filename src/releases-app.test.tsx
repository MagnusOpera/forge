// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { GithubFocusApi, ReleaseSummary, RepoSummary } from "../shared/github";

vi.mock("./codex/api", () => ({ useCodexThreads: () => ({ threads: [], loading: false, error: null }) }));
vi.mock("./codex/settings", () => ({ CodexSettingsDialog: () => null }));
const repo = { id: "repo", owner: "test", name: "repo", fullName: "test/repo", url: "https://github.com/test/repo", labels: [], viewerPermission: "ADMIN" } as unknown as RepoSummary;
let currentRepo = repo;
const releases: ReleaseSummary[] = [
  { id: "published", name: "Version one", tagName: "v1", description: "## Changes\n\nPublished **notes**.", isDraft: false, isPrerelease: false, createdAt: "2026-01-01T00:00:00Z", publishedAt: "2026-02-01T00:00:00Z", url: "https://github.com/test/repo/releases/tag/v1" },
  { id: "draft", databaseId: 42, name: "Next version", tagName: "v2", description: "Draft notes.", isDraft: true, isPrerelease: false, createdAt: "2026-03-01T00:00:00Z", publishedAt: null, url: "https://github.com/test/repo/releases/2" }
];
let currentReleases = releases;
const cacheListeners = new Set<(key: string) => void>();
const publishRelease = vi.fn();
const openInGitHub = vi.fn(async () => {});
const getReleases = vi.fn(async () => ({ data: currentReleases }));
let App: typeof import("./App").App;
let root: Root, container: HTMLDivElement;
beforeAll(async () => {
  window.githubFocus = {
    platform: "browser", openInGitHub, publishRelease,
    getAuthStatus: async () => ({ configured: true, encryptionAvailable: false, viewerLogin: "test" }),
    getRepositories: async () => ({ data: [repo] }), getStarredRepos: async () => ({ data: [] }),
    getRecentRepos: async () => ({ data: [] }), getOrganizations: async () => ({ data: [] }),
    getRepo: async () => ({ data: currentRepo }), getRepoLabels: async () => ({ data: [] }),
    getPullRequests: async () => ({ data: [] }), getIssues: async () => ({ data: [] }),
    getWorkflows: async () => ({ data: [] }), getWorkflowRuns: async () => ({ data: [] }), getReleases,
    onCacheUpdated: (listener: (key: string) => void) => { cacheListeners.add(listener); return () => cacheListeners.delete(listener); }, onNativeNotificationClicked: () => () => {},
    setNativeThemeSource: async () => {}, setSidebarAppearanceMode: async () => {},
  } as unknown as GithubFocusApi;
  ({ App } = await import("./App"));
});
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); getReleases.mockClear(); openInGitHub.mockClear();
  currentRepo = repo;
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
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Refresh repository"]')!.click());
  expect(getReleases).toHaveBeenCalledWith(expect.objectContaining({ owner: "test", name: "repo" }), { force: true });
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
