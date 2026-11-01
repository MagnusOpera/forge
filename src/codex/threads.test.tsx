// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CodexThreadList } from "./threads";
import { defaultCodexPreferences, type CodexApi, type CodexConfiguration, type CodexThreadSummary } from "../../shared/codex";

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
  vi.useRealTimers();
  delete window.forgeCodex;
});
const render = async (configurationOpen = false, loadError = "", threads: CodexThreadSummary[] = [], repositoryId = "r") => act(async () => root.render(
  <CodexThreadList repositoryId={repositoryId} loading={false} threads={threads} error={loadError}
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
  expect(container.querySelector('[aria-label="Browse existing Codex threads"]')).toBeNull();
  expect(container.querySelectorAll(".codex-list-actions .codex-actions button")).toHaveLength(2);
  await create();
  expect(request).toHaveBeenCalledWith("create", { repositoryId: "r" });
  expect(select).toHaveBeenCalledWith("created");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

const searchThreads: CodexThreadSummary[] = [
  { id: "one", repositoryId: "r", title: "First thread", archived: false },
  { id: "two", repositoryId: "r", title: "Second thread", archived: false },
  { id: "old", repositoryId: "r", title: "Old thread", archived: true },
].map((thread) => ({ ...thread, settings: defaultCodexPreferences, state: "idle", createdAt: "", updatedAt: "", worktree: "", branch: "", baseCommit: "" }));
async function openSearch() {
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Search conversations"]')!.click());
  return container.querySelector<HTMLInputElement>('[aria-label="Search conversation text"]')!;
}
function typeSearch(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function settleSearch() {
  await act(async () => { await vi.advanceTimersByTimeAsync(180); });
}
it("searches conversation text, shows ranked matches with safe excerpts, and selects a result", async () => {
  vi.useFakeTimers();
  request.mockResolvedValue([
    { id: "two", snippet: "Matching <script>conversation</script> text" },
    { id: "one", snippet: "Another match" },
  ]);
  await render(false, "", searchThreads);
  const input = await openSearch();
  expect(document.activeElement).toBe(input);
  typeSearch(input, "conver");
  typeSearch(input, "conversation");
  expect(container.textContent).toContain("Searching…");
  await settleSearch();
  expect(request).toHaveBeenCalledExactlyOnceWith("search", { repositoryId: "r", query: "conversation", archived: false });
  expect(container.textContent).toContain("2 matching threads");
  expect([...container.querySelectorAll(".focus-title")].map((element) => element.textContent)).toEqual(["Second thread", "First thread"]);
  expect(container.querySelector(".codex-search-snippet")?.textContent).toContain("<script>conversation</script>");
  expect(container.querySelector("script")).toBeNull();
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  expect(document.activeElement).toBe(container.querySelector(".codex-thread-select"));
  act(() => container.querySelector<HTMLButtonElement>(".codex-thread-select")!.click());
  expect(select).toHaveBeenCalledWith("two");
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(container.querySelector('[aria-label="Search conversation text"]')).toBeNull();
  expect(document.activeElement).toBe(container.querySelector('[aria-label="Search conversations"]'));
  expect(container.querySelectorAll(".codex-thread-select")).toHaveLength(2);
});
it("searches archived threads and refreshes after conversation changes", async () => {
  vi.useFakeTimers();
  request.mockResolvedValue([{ id: "one", snippet: "Current text" }]);
  await render(false, "", searchThreads);
  typeSearch(await openSearch(), "text");
  await settleSearch();
  request.mockResolvedValue([{ id: "old", snippet: "Archived text" }]);
  act(() => container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1].click());
  await settleSearch();
  expect(request).toHaveBeenLastCalledWith("search", { repositoryId: "r", query: "text", archived: true });
  expect(container.querySelector(".focus-title")?.textContent).toBe("Old thread");
  await render(false, "", [...searchThreads]);
  await settleSearch();
  expect(request.mock.calls.filter(([method]) => method === "search")).toHaveLength(3);
});
it("ignores stale queries and results from another project, and distinguishes errors from no matches", async () => {
  vi.useFakeTimers();
  let finish!: (result: { id: string; snippet: string }[]) => void;
  request.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await render(false, "", searchThreads);
  const input = await openSearch();
  typeSearch(input, "old");
  await settleSearch();
  const finishOld = finish;
  request.mockResolvedValue([]);
  typeSearch(input, "new");
  await settleSearch();
  await act(async () => finishOld([{ id: "one", snippet: "Stale" }]));
  expect(container.textContent).toContain("0 matching threads");
  expect(container.querySelector(".codex-thread-select")).toBeNull();
  request.mockRejectedValue(new Error("Search unavailable"));
  typeSearch(input, "failure");
  await settleSearch();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Search unavailable");
  request.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  typeSearch(input, "pending");
  await settleSearch();
  await render(false, "", [], "another-project");
  await act(async () => finish([{ id: "one", snippet: "Wrong project" }]));
  expect(container.querySelector<HTMLInputElement>('[aria-label="Search conversation text"]')?.value).toBe("");
  expect(container.textContent).not.toContain("Wrong project");
});

it("does not postpone a typed search while a conversation is streaming", async () => {
  vi.useFakeTimers();
  request.mockResolvedValue([{ id: "one", snippet: "Streaming content" }]);
  await render(false, "", searchThreads);
  typeSearch(await openSearch(), "stream");
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  await render(false, "", [...searchThreads]);
  await act(async () => { await vi.advanceTimersByTimeAsync(80); });
  expect(request).toHaveBeenCalledWith("search", { repositoryId: "r", query: "stream", archived: false });
  expect(container.textContent).toContain("1 matching thread");
});
