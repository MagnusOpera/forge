// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { GithubFocusApi } from "../shared/github";

let App: typeof import("./App").App;
let container: HTMLDivElement, root: Root;
const signIn = vi.fn();
const saveToken = vi.fn();
const cancel = vi.fn(async () => {});
const authStatus = vi.fn(async () => ({ configured: false, encryptionAvailable: true, viewerLogin: null }));
beforeAll(async () => {
  window.githubFocus = {
    platform: "browser", getAuthStatus: authStatus,
    saveToken, signInGithub: signIn, cancelGithubSignIn: cancel,
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

it.each(["light", "dark"])("offers browser sign-in and an optional token alternative in %s theme", async theme => {
  localStorage.setItem("github-focus:theme", JSON.stringify(theme));
  signIn.mockRejectedValue(new Error("GitHub sign-in was declined."));
  await act(async () => root.render(<App />));
  expect(container.querySelector(".app-shell")?.getAttribute("data-theme")).toBe(theme);
  expect(container.querySelector("details")!.open).toBe(false);
  expect(container.querySelector('input[type="password"]')).not.toBeNull();
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

it.each(["light", "dark"])("supports token login without OAuth configuration in %s theme", async theme => {
  localStorage.setItem("github-focus:theme", JSON.stringify(theme));
  saveToken.mockResolvedValue({ configured: true, encryptionAvailable: true, viewerLogin: "octocat" });
  await act(async () => root.render(<App />));
  await act(async () => container.querySelector("summary")!.click());
  const input = container.querySelector<HTMLInputElement>('input[type="password"]')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { setValue.call(input, " ghp_test "); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(saveToken).toHaveBeenCalledWith("ghp_test");
  expect(signIn).not.toHaveBeenCalled();
  expect(container.querySelector(".token-gate")).toBeNull();
});
it("keeps token validation errors visible and allows retry without opening a browser", async () => {
  saveToken.mockRejectedValue(new Error("This token is missing read:project permissions."));
  await act(async () => root.render(<App />));
  await act(async () => container.querySelector("summary")!.click());
  const input = container.querySelector<HTMLInputElement>('input[type="password"]')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { setValue.call(input, "ghp_test"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("read:project");
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  expect(signIn).not.toHaveBeenCalled();
});
