// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { AppUpdateStatus, GithubFocusApi } from "../shared/github";

vi.mock("./codex/settings", () => ({
  CodexSettingsDialog: () => <div role="dialog" aria-label="Global settings" />,
}));
let updateStatusChanged: ((status: AppUpdateStatus) => void) | undefined;
const installUpdate = vi.fn(async () => {});
let App: typeof import("./App").App;
let root: Root, container: HTMLDivElement;
beforeAll(async () => {
  window.githubFocus = {
    platform: "browser",
    getUpdateStatus: async () => ({ checking: false, availableVersion: null, downloaded: false }),
    onUpdateStatusChanged: (callback: (status: AppUpdateStatus) => void) => {
      updateStatusChanged = callback;
      return () => { updateStatusChanged = undefined; };
    },
    installUpdate,
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


it("shows update activity and a persistent upgrade button immediately above global configuration", async () => {
  const rail = container.querySelector('[role="toolbar"][aria-label="Global controls"]')!;
  const configuration = rail.querySelector('[aria-label="Global configuration"]')!;
  expect(rail.querySelector('[aria-label="Checking for updates"]')).toBeNull();
  await act(async () => updateStatusChanged!({ checking: true, availableVersion: null, downloaded: false }));
  const spinner = rail.querySelector('[aria-label="Checking for updates"]')!;
  expect(spinner.nextElementSibling).toBe(configuration);
  expect(spinner.querySelector(".spin")).not.toBeNull();
  await act(async () => rail.querySelector<HTMLButtonElement>('[aria-label="Collapse sidebar"]')!.click());
  expect(spinner.closest('[aria-hidden="true"], [inert]')).toBeNull();
  await act(async () => updateStatusChanged!({ checking: false, availableVersion: "1.2.3", downloaded: false }));
  expect(rail.querySelector('[aria-label="Checking for updates"]')).toBeNull();
  const upgrade = rail.querySelector<HTMLButtonElement>('[aria-label="Upgrade to Forge 1.2.3"]')!;
  expect(upgrade.nextElementSibling).toBe(configuration);
  await act(async () => upgrade.click());
  expect(installUpdate).toHaveBeenCalledOnce();
  await act(async () => updateStatusChanged!({ checking: false, availableVersion: "1.2.3", downloaded: true }));
  expect(upgrade.title).toContain("ready to install");
  await act(async () => updateStatusChanged!({ checking: true, availableVersion: "1.2.3", downloaded: true }));
  expect(rail.querySelector('[aria-label="Checking for updates"]')).not.toBeNull();
  await act(async () => updateStatusChanged!({ checking: false, availableVersion: "1.2.3", downloaded: true }));
  expect(rail.querySelector('[aria-label="Upgrade to Forge 1.2.3"]')).not.toBeNull();
});
