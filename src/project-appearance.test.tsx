// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { GithubFocusApi, RepoSummary } from "../shared/github";

vi.mock("./codex/api", () => ({ useCodexThreads: () => ({ threads: [], loading: false, error: null }) }));
vi.mock("./codex/threads", () => ({ CodexThreadList: () => null }));
vi.mock("./codex/settings", () => ({
  CodexSettingsDialog: ({ onSaveProjectAccent, onClose }: { onSaveProjectAccent(color: string | undefined): void; onClose(): void }) => <div>
    <button onClick={() => { onSaveProjectAccent("#d2a8ff"); onClose(); }}>Save purple</button>
    <button onClick={() => { onSaveProjectAccent(undefined); onClose(); }}>Use global</button>
  </div>,
}));
const repos = ["one", "two"].map(name => ({ id: name, owner: "test", name, fullName: `test/${name}`, url: `https://github.com/test/${name}`, labels: [] } as unknown as RepoSummary));
let App: typeof import("./App").App;
let root: Root | undefined;
let container: HTMLDivElement;
beforeAll(async () => {
  window.githubFocus = {
    platform: "browser",
    getAuthStatus: async () => ({ configured: true, encryptionAvailable: false, viewerLogin: "test" }),
    getRepositories: async () => ({ data: repos }), getStarredRepos: async () => ({ data: [] }),
    getRecentRepos: async () => ({ data: [] }), getOrganizations: async () => ({ data: [] }),
    getRepo: async (owner: string, name: string) => ({ data: repos.find(repo => repo.name === name) ?? repos[0] }),
    getRepoLabels: async () => ({ data: [] }), getPullRequests: async () => ({ data: [] }),
    getIssues: async () => ({ data: [] }), getWorkflows: async () => ({ data: [] }),
    getWorkflowRuns: async () => ({ data: [] }),
    onCacheUpdated: () => () => {}, onNativeNotificationClicked: () => () => {},
    setNativeThemeSource: async () => {}, setSidebarAppearanceMode: async () => {},
  } as unknown as GithubFocusApi;
  ({ App } = await import("./App"));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); container?.remove(); localStorage.clear(); });

it.each(["light", "dark"])("persists project overrides, isolates projects and keeps the global picker independent in %s", async theme => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  localStorage.setItem("github-focus:theme", JSON.stringify(theme));
  localStorage.setItem("github-focus:sidebar-repo-tab", JSON.stringify("all"));
  localStorage.setItem(`github-focus:accent-color:${theme}`, JSON.stringify("#79c0ff"));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<App />));
  const accent = () => container.querySelector<HTMLElement>(".app-shell")!.style.getPropertyValue("--accent");
  const clickText = async (text: string) => {
    const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === text || button.querySelector(".repo-short-name")?.textContent === text)!;
    expect(button).toBeTruthy();
    await act(async () => button.click());
  };
  expect(accent()).toBe("#79c0ff");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Project configuration"]')!.click());
  await clickText("Save purple");
  expect(accent()).toBe("#d2a8ff");
  expect(JSON.parse(localStorage.getItem("github-focus:project-accent-colors")!)).toEqual({ one: "#d2a8ff" });
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Accent 7"]')!.click());
  expect(accent()).toBe("#d2a8ff");
  expect(JSON.parse(localStorage.getItem(`github-focus:accent-color:${theme}`)!)).toBe("#f2cc60");
  await clickText("two");
  expect(accent()).toBe("#f2cc60");
  await clickText("one");
  expect(accent()).toBe("#d2a8ff");
  await act(async () => root!.unmount());
  root = createRoot(container);
  await act(async () => root!.render(<App />));
  expect(accent()).toBe("#d2a8ff");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Project configuration"]')!.click());
  await clickText("Use global");
  expect(accent()).toBe("#f2cc60");
  expect(JSON.parse(localStorage.getItem("github-focus:project-accent-colors")!)).toEqual({});
});
