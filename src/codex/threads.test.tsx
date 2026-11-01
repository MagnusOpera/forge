// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CodexThreadList } from "./threads";
import { defaultCodexPreferences, type CodexApi, type CodexConfiguration } from "../../shared/codex";

let container: HTMLDivElement, root: Root;
let configuration: CodexConfiguration, ready: boolean;
const request = vi.fn(), configure = vi.fn(), select = vi.fn();
const setupPrompt = "To start a thread, open project configuration and choose a local Git checkout or set up a remote checkout.";
const setupError = "Error invoking remote method 'codex:request': Error: Choose a local Git folder or configure a remote project placement first.";
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  configuration = { editor: "", executable: "", defaults: defaultCodexPreferences, projects: {} };
  ready = false;
  configure.mockReset();
  select.mockReset();
  request.mockReset().mockImplementation(async (method) => {
    if (method === "create") throw new Error(setupError);
    if (method === "configuration") return configuration;
    if (method === "checkProjectCheckout") return { ready, message: ready ? "Checkout ready" : "Checkout missing" };
  });
  window.forgeCodex = { request } as unknown as CodexApi;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.forgeCodex;
});
const render = async (configurationOpen = false, loadError = "") => act(async () => root.render(
  <CodexThreadList repositoryId="r" loading={false} threads={[]} error={loadError}
    onSelect={select} onConfigure={configure} configurationOpen={configurationOpen} />,
));
const create = async () => act(async () => container.querySelector<HTMLButtonElement>('[aria-label="New Codex thread"]')!.click());

it.each(["local", "remote"])("clears the stale setup error after configuration confirms a valid %s checkout", async (target) => {
  await render();
  await create();
  expect(container.querySelector('.codex-setup-notice, [role="alert"]')?.textContent).toContain(setupPrompt);
  expect(container.querySelector('.codex-setup-notice')?.getAttribute("role")).toBe("status");
  expect(container.textContent).not.toContain("Error invoking remote method");
  expect(container.textContent).not.toContain("codex:request");
  expect(container.querySelector('.codex-setup-notice button')?.textContent).toBe("Open configuration");
  act(() => container.querySelector<HTMLButtonElement>('.codex-setup-notice button')!.click());
  expect(configure).toHaveBeenCalledOnce();
  await render(true);
  configuration.projects.r = {
    repositoryId: "r", path: target === "local" ? "/repo" : "", overrides: {},
    ...(target === "remote" ? { defaultEnvironment: "remote", remotePaths: { remote: "~/repo" } } : {}),
  };
  ready = true;
  expect(container.querySelector('.codex-setup-notice, [role="alert"]')).not.toBeNull();
  await render(false);
  expect(request).toHaveBeenCalledWith("checkProjectCheckout", { repositoryId: "r", environmentId: target });
  expect(container.querySelector('.codex-setup-notice, [role="alert"]')).toBeNull();
  expect(request.mock.calls.filter(([method]) => method === "create")).toHaveLength(1);
  expect(select).not.toHaveBeenCalled();
});

it("retains the error when configuration is cancelled or the chosen checkout is invalid", async () => {
  await render();
  await create();
  await render(true);
  await render(false);
  expect(container.querySelector('.codex-setup-notice, [role="alert"]')?.textContent).toContain(setupPrompt);
  await render(true);
  configuration.projects.r = { repositoryId: "r", path: "/missing", overrides: {} };
  await render(false);
  expect(request).toHaveBeenCalledWith("checkProjectCheckout", { repositoryId: "r", environmentId: "local" });
  expect(container.querySelector('.codex-setup-notice, [role="alert"]')?.textContent).toContain(setupPrompt);
});

it("does not dismiss unrelated operation or loading errors when configuration closes", async () => {
  request.mockImplementation(async () => { throw new Error("Codex executable missing"); });
  await render();
  await create();
  await render(true);
  await render(false);
  expect(container.querySelector('.codex-setup-notice, [role="alert"]')?.textContent).toContain("Codex executable missing");
  expect(request.mock.calls.every(([method]) => method === "create")).toBe(true);
});

it("ignores a validation result after configuration has been reopened", async () => {
  await render();
  await create();
  await render(true);
  configuration.projects.r = { repositoryId: "r", path: "/repo", overrides: {} };
  let finish!: (result: { ready: boolean; message: string }) => void;
  request.mockImplementation(async (method) => method === "configuration" ? configuration
    : new Promise((resolve) => { finish = resolve; }));
  await render(false);
  await render(true);
  await act(async () => finish({ ready: true, message: "Ready" }));
  expect(container.querySelector('.codex-setup-notice, [role="alert"]')?.textContent).toContain(setupPrompt);
});

it("creates and selects a thread immediately without opening a dialog", async () => {
  request.mockResolvedValue({ id: "created" });
  await render();
  await create();
  expect(request).toHaveBeenCalledWith("create", { repositoryId: "r" });
  expect(select).toHaveBeenCalledWith("created");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
