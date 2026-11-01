// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { GithubFocusApi } from "../shared/github";

vi.mock("./codex/settings", () => ({
  CodexSettingsDialog: () => <div role="dialog" aria-label="Global settings" />,
}));
let App: typeof import("./App").App;
let root: Root, container: HTMLDivElement;
beforeAll(async () => {
  window.githubFocus = {
    platform: "browser",
    getAuthStatus: async () => ({ configured: true, encryptionAvailable: false, viewerLogin: "test" }),
    getRepositories: async () => ({ data: [] }),
    getStarredRepos: async () => ({ data: [] }),
    getRecentRepos: async () => ({ data: [] }),
    getOrganizations: async () => ({ data: [] }),
    onCacheUpdated: () => () => {},
    onNativeNotificationClicked: () => () => {},
    setNativeThemeSource: async () => {},
    setSidebarAppearanceMode: async () => {},
  } as unknown as GithubFocusApi;
  ({ App } = await import("./App"));
});
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  localStorage.setItem("github-focus:theme", JSON.stringify("light"));
  localStorage.setItem("github-focus:project-focus-view", JSON.stringify("codex"));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<App />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("places working global controls before collapse and hides them while collapsed", async () => {
  const header = container.querySelector(".sidebar .pane-header")!;
  expect(header.querySelector(".brand-mark, .brand-logo")).toBeNull();
  expect(header.textContent).not.toContain("Forge");
  const actions = header.querySelector(".header-actions")!;
  expect([...actions.children].map(node => node.getAttribute("aria-label") ?? node.className)).toEqual([
    "Global configuration", "theme-accent-control", "Collapse sidebar",
  ]);
  expect(container.querySelector(".content-header .theme-toggle-button")).toBeNull();
  expect(container.querySelector('.content-header [aria-label="Global configuration"]')).toBeNull();
  expect(container.querySelector(".content-header .toolbar-divider")).toBeNull();
  await act(async () => (actions.querySelector(".theme-toggle-button") as HTMLButtonElement).click());
  expect(container.querySelector(".app-shell")?.getAttribute("data-theme")).toBe("dark");
  await act(async () => (actions.querySelector('[aria-label="Global configuration"]') as HTMLButtonElement).click());
  expect(container.querySelector('[role="dialog"][aria-label="Global settings"]')).not.toBeNull();
  await act(async () => (actions.querySelector('[aria-label="Collapse sidebar"]') as HTMLButtonElement).click());
  expect(container.querySelector('[aria-label="Global configuration"]')).toBeNull();
  expect(container.querySelector(".theme-toggle-button")).toBeNull();
  await act(async () => (container.querySelector('[aria-label="Open sidebar"]') as HTMLButtonElement).click());
  expect(container.querySelector('.sidebar [aria-label="Global configuration"]')).not.toBeNull();
});
