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
    getAuthStatus: async () => ({
      configured: true,
      encryptionAvailable: false,
      viewerLogin: "test",
    }),
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
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  localStorage.setItem("github-focus:theme", JSON.stringify("light"));
  localStorage.setItem(
    "github-focus:project-focus-view",
    JSON.stringify("codex"),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<App />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("keeps global controls in a permanent rail while only navigation collapses", async () => {
  const header = container.querySelector(".sidebar .pane-header")!;
  const rail = container.querySelector(
    '[role="toolbar"][aria-label="Global controls"]',
  )!;
  expect(
    header.querySelector(
      '[aria-label="Global configuration"], .theme-toggle-button, [aria-label="Collapse sidebar"]',
    ),
  ).toBeNull();
  expect(rail.querySelector('[aria-label="Workspace mode"]')).toBeNull();
  expect(
    rail.querySelector('[aria-label="Global configuration"]'),
  ).not.toBeNull();
  await act(async () =>
    rail.querySelector<HTMLButtonElement>(".theme-toggle-button")!.click(),
  );
  expect(
    container.querySelector(".app-shell")?.getAttribute("data-theme"),
  ).toBe("dark");
  await act(async () =>
    rail
      .querySelector<HTMLButtonElement>('[aria-label="Collapse sidebar"]')!
      .click(),
  );
  const navigation = container.querySelector(".sidebar-navigation")!;
  expect(navigation.getAttribute("aria-hidden")).toBe("true");
  expect(navigation.hasAttribute("inert")).toBe(true);
  expect(rail.closest("[inert], [aria-hidden=true]")).toBeNull();
  expect(
    rail.querySelector('[aria-label="Global configuration"]'),
  ).not.toBeNull();
  expect(rail.querySelector(".theme-toggle-button")).not.toBeNull();
  expect(
    container.querySelectorAll('[aria-label="Open sidebar"]'),
  ).toHaveLength(1);
  await act(async () =>
    rail
      .querySelector<HTMLButtonElement>('[aria-label="Global configuration"]')!
      .click(),
  );
  expect(
    container.querySelector('[role="dialog"][aria-label="Global settings"]'),
  ).not.toBeNull();
  await act(async () =>
    rail
      .querySelector<HTMLButtonElement>('[aria-label="Open sidebar"]')!
      .click(),
  );
  expect(navigation.getAttribute("aria-hidden")).toBe("false");
  expect(navigation.hasAttribute("inert")).toBe(false);
});

it("keeps icon-only Build and Chat modes in the sidebar toolbar with the shared active underline", async () => {
  const toolbar = container.querySelector(
    '[role="toolbar"][aria-label="Workspace mode"]',
  )!;
  expect(toolbar.closest(".pane-header")).not.toBeNull();
  expect(toolbar.textContent).toBe("");
  expect(toolbar.classList.contains("project-view-switcher")).toBe(true);
  expect(toolbar.querySelector(".sliding-tab-underline")).not.toBeNull();
  const build = toolbar.querySelector<HTMLButtonElement>(
    '[aria-label="Build"]',
  )!;
  const think = toolbar.querySelector<HTMLButtonElement>(
    '[aria-label="Chat"]',
  )!;
  expect(build.getAttribute("aria-pressed")).toBe("true");
  await act(async () => think.click());
  expect(think.getAttribute("aria-pressed")).toBe("true");
  expect(think.getAttribute("data-active-tab")).toBe("true");
  expect(build.getAttribute("data-active-tab")).toBeNull();
  expect(container.querySelector(".chatgpt-threads-pane")).not.toBeNull();
  await act(async () => build.click());
  expect(build.getAttribute("aria-pressed")).toBe("true");
  expect(build.getAttribute("data-active-tab")).toBe("true");
  expect(container.querySelector(".chatgpt-threads-pane")).toBeNull();
});

it("keeps the rounded body divider separate from the native titlebar and rail", () => {
  const shell = container.querySelector(".workspace-shell")!;
  expect(
    shell
      .querySelector(":scope > .workspace-body-divider")
      ?.getAttribute("aria-hidden"),
  ).toBe("true");
  expect(
    shell.querySelector(".sidebar-rail .workspace-body-divider"),
  ).toBeNull();
  expect(
    shell.querySelector('.sidebar .pane-header [aria-label="Workspace mode"]'),
  ).not.toBeNull();
});
