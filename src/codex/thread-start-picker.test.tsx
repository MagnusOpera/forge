// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ThreadStartPicker } from "./thread-start-picker";
import { defaultCodexPreferences, type CodexApi, type CodexThread } from "../../shared/codex";
let container: HTMLDivElement, root: Root;
const request = vi.fn(), changed = vi.fn(), pending = vi.fn();
const thread = { id: "t", repositoryId: "r", repositoryPath: "/repo", settings: defaultCodexPreferences, state: "idle", start: { kind: "worktree", branch: "" } } as CodexThread;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  request.mockReset().mockImplementation(async (method) => method === "startOptions" ? { defaultBranch: "trunk", currentBranch: "feature" } : undefined);
  changed.mockReset().mockResolvedValue(undefined);
  pending.mockReset();
  window.forgeCodex = { request } as unknown as CodexApi;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.forgeCodex;
  vi.useRealTimers();
});
const render = async () => act(async () => root.render(<ThreadStartPicker thread={thread} onChange={changed} onPendingChange={pending} />));
const choose = async (kind: string) => act(async () => {
  const index = ["worktree", "default", "new", "current"].indexOf(kind);
  container.querySelectorAll<HTMLButtonElement>('[role="option"]')[index].click();
});
it("shows named branches inline without descriptions", async () => {
  await render();
  expect(request).toHaveBeenCalledWith("startOptions", { repositoryId: "r", id: "t" });
  expect(container.querySelector('[role="combobox"]')?.textContent).toContain("Worktree from trunk HEAD");
  expect(container.textContent).toContain("Worktree from trunk HEAD");
  expect(container.textContent).toContain("Default branch (trunk)");
  expect(container.textContent).toContain("Current repository branch (feature)");
  expect(container.querySelector("p")).toBeNull();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
it.each(["worktree", "default", "current"])("saves the %s choice directly", async (kind) => {
  await render();
  await choose(kind);
  expect(request).toHaveBeenCalledWith("setStart", { repositoryId: "r", id: "t", start: { kind, branch: kind === "current" ? "feature" : "trunk" } });
  expect(changed).toHaveBeenCalledOnce();
  expect(pending).toHaveBeenLastCalledWith(false);
});
async function typeBranch(value: string) {
  await act(async () => {
    const input = container.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const validate = async () => act(async () => { await vi.advanceTimersByTimeAsync(300); });
it("automatically validates and saves an available branch with a checkmark", async () => {
  vi.useFakeTimers();
  await render();
  await choose("new");
  expect(pending).toHaveBeenLastCalledWith(true);
  expect(container.textContent).not.toContain("Use branch");
  expect(container.textContent).not.toContain("Enter an available branch name");
  await typeBranch("codex/task");
  expect(container.querySelector('[aria-label="Checking branch name"]')).not.toBeNull();
  await validate();
  expect(request).toHaveBeenCalledWith("setStart", { repositoryId: "r", id: "t", start: { kind: "new", branch: "codex/task" } });
  expect(container.querySelector('[aria-label="Branch name available"] .lucide-check')).not.toBeNull();
  expect(pending).toHaveBeenLastCalledWith(false);
});
it("shows a cross for an existing branch and blocks starting", async () => {
  vi.useFakeTimers();
  await render();
  await choose("new");
  request.mockRejectedValueOnce(new Error("That branch already exists. Choose a new branch name."));
  await typeBranch("feature");
  await validate();
  expect(container.querySelector('[aria-label="Branch name unavailable"] .lucide-x')).not.toBeNull();
  expect(container.querySelector("input")?.getAttribute("aria-invalid")).toBe("true");
  expect(container.textContent).toContain("That branch already exists");
  expect(pending).toHaveBeenLastCalledWith(true);
});
it("ignores an outdated validation response when the branch name changes", async () => {
  vi.useFakeTimers();
  await render();
  await choose("new");
  let finish!: () => void;
  request.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  await typeBranch("codex/old");
  await validate();
  await typeBranch("codex/latest");
  await act(async () => finish());
  expect(container.querySelector('[aria-label="Branch name available"]')).toBeNull();
  expect(pending).toHaveBeenLastCalledWith(true);
  await validate();
  expect(container.querySelector('[aria-label="Branch name available"]')).not.toBeNull();
  expect(request).toHaveBeenLastCalledWith("setStart", { repositoryId: "r", id: "t", start: { kind: "new", branch: "codex/latest" } });
});
it("shows a save error and retains the last applied starting point", async () => {
  await render();
  request.mockRejectedValueOnce(new Error("Checkout missing"));
  await choose("current");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Checkout missing");
  expect(container.querySelector('[role="combobox"]')?.textContent).toContain("Worktree from trunk HEAD");
});

it("requires a branch name when a new thread defaults to New branch", async () => {
  await act(async () => root.render(<ThreadStartPicker thread={{ ...thread, start: { kind: "new", branch: "" } }} onChange={changed} onPendingChange={pending} />));
  expect(container.querySelector<HTMLInputElement>('[aria-label="Branch name"]')?.value).toBe("");
  expect(pending).toHaveBeenLastCalledWith(true);
  expect(request.mock.calls.some(([method]) => method === "setStart")).toBe(false);
});
