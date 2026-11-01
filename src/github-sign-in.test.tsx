// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { GithubFocusApi } from "../shared/github";

let App: typeof import("./App").App;
let container: HTMLDivElement, root: Root;
const signIn = vi.fn();
const cancel = vi.fn(async () => {});
const authStatus = vi.fn(async () => ({ configured: false, encryptionAvailable: true, viewerLogin: null }));
beforeAll(async () => {
  window.githubFocus = {
    platform: "browser", getAuthStatus: authStatus,
    signInGithub: signIn, cancelGithubSignIn: cancel,
    onCacheUpdated: () => () => {}, onNativeNotificationClicked: () => () => {},
    setNativeThemeSource: async () => {}, setSidebarAppearanceMode: async () => {},
    getRepositories: async () => ({ data: [] }), getStarredRepos: async () => ({ data: [] }),
    getRecentRepos: async () => ({ data: [] }), getOrganizations: async () => ({ data: [] }),
  } as unknown as GithubFocusApi;
  ({ App } = await import("./App"));
});
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.clearAllMocks();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it.each(["light", "dark"])("offers browser sign-in without token entry in %s theme", async theme => {
  localStorage.setItem("github-focus:theme", JSON.stringify(theme));
  signIn.mockRejectedValue(new Error("GitHub sign-in was declined."));
  await act(async () => root.render(<App />));
  expect(container.querySelector(".app-shell")?.getAttribute("data-theme")).toBe(theme);
  expect(container.querySelector("input")).toBeNull();
  expect(container.querySelector("details")).toBeNull();
  const button = container.querySelector<HTMLButtonElement>(".primary-button")!;
  expect(button.textContent).toBe("Sign in with GitHub");
  await act(async () => button.click());
  expect(signIn).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("declined");
  expect(button.disabled).toBe(false);
});
it("shows a waiting state, prevents duplicate sign-ins, and offers cancellation", async () => {
  let reject!: (error: Error) => void;
  signIn.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  await act(async () => root.render(<App />));
  await act(async () => container.querySelector<HTMLButtonElement>(".primary-button")!.click());
  expect(container.querySelector<HTMLButtonElement>(".primary-button")!.disabled).toBe(true);
  expect(container.textContent).toContain("Waiting for GitHub");
  await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "Cancel sign-in")!.click());
  expect(cancel).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("GitHub sign-in cancelled.")));
  expect(container.textContent).toContain("cancelled");
});
it("disables sign-in when secure storage is unavailable", async () => {
  authStatus.mockResolvedValueOnce({ configured: false, encryptionAvailable: false, viewerLogin: null });
  await act(async () => root.render(<App />));
  expect(container.querySelector<HTMLButtonElement>(".primary-button")!.disabled).toBe(true);
  expect(container.textContent).toContain("Secure storage is unavailable");
});

it("opens the workspace after successful browser sign-in", async () => {
  signIn.mockResolvedValue({ configured: true, encryptionAvailable: true, viewerLogin: "octocat" });
  await act(async () => root.render(<App />));
  await act(async () => container.querySelector<HTMLButtonElement>(".primary-button")!.click());
  expect(container.querySelector(".token-gate")).toBeNull();
  expect(container.querySelector(".sidebar")).not.toBeNull();
});
