// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CodexQuickActions } from "./quick-actions";
import {
  defaultCodexPreferences,
  type CodexApi,
  type CodexThreadSummary,
} from "../../shared/codex";
it("copies from the checkout label with temporary feedback and opens Finder with one click", async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  const copy = vi.fn().mockResolvedValue(undefined);
  const request = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
  window.forgeCodex = { request, onChanged: () => () => {}, onTerminalEvent: () => () => {} } as CodexApi;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const thread: CodexThreadSummary = {
    id: "t",
    repositoryId: "r",
    title: "Test",
    archived: false,
    createdAt: "",
    updatedAt: "",
    settings: defaultCodexPreferences,
    state: "idle",
    worktree: "/repo/current",
    branch: "main",
    baseCommit: "base",
    checkout: "default",
  };
  try {
    act(() =>
      root.render(
        <CodexQuickActions
          thread={thread}
          theme="light"
          defaultBranch="main"
        />,
      ),
    );
    const label = container.querySelector<HTMLButtonElement>(
      '[aria-label="Copy checkout location"]',
    )!;
    await act(async () => label.click());
    expect(copy).toHaveBeenCalledWith("/repo/current");
    expect(request).not.toHaveBeenCalled();
    expect(label.classList.contains("invoked")).toBe(true);
    act(() => vi.advanceTimersByTime(900));
    expect(label.classList.contains("invoked")).toBe(false);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Open checkout in Finder"]',
        )!
        .click(),
    );
    expect(request).toHaveBeenCalledWith("openFolder", {
      repositoryId: "r",
      id: "t",
    });
    expect(copy).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    container.remove();
    delete window.forgeCodex;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

it("offers Codex resolution for verified merge conflicts and submits only the owned thread identity", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const conflict = { defaultBranch: "main", targetCommit: "local-main", sourceCommit: "feature-head", sourceBranch: "codex/task", files: ["CHANGELOG.md"] };
  const request = vi.fn().mockImplementation(async (method) => method === "checkout" ? { conflict } : undefined);
  window.forgeCodex = { request } as unknown as CodexApi;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const thread: CodexThreadSummary = { id: "t", repositoryId: "r", title: "Test", archived: false, createdAt: "", updatedAt: "", settings: defaultCodexPreferences, state: "idle", worktree: "/repo/current", branch: "codex/task", baseCommit: "base", checkout: "worktree" };
  try {
    await act(async () => root.render(<CodexQuickActions thread={thread} theme="light" defaultBranch="main" group="git" />));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Merge into main"]')!.click());
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("CHANGELOG.md");
    expect(alert.textContent).toContain("Changes conflict with main");
    const resolve = [...alert.querySelectorAll("button")].find(button => button.textContent === "Resolve with Codex")!;
    expect(resolve).not.toBeUndefined();
    await act(async () => resolve.click());
    expect(request).toHaveBeenLastCalledWith("resolveMergeConflicts", { repositoryId: "r", id: "t" });
    expect(request.mock.calls.filter(([method]) => method === "checkout")).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')).toBeNull();

    request.mockRejectedValueOnce(new Error("Commit or remove uncommitted changes first."));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Merge into main"]')!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("uncommitted changes");
    expect(container.textContent).not.toContain("Resolve with Codex");
  } finally {
    act(() => root.unmount());
    container.remove();
    delete window.forgeCodex;
  }
});

it("completes a successful merge without any cleanup popup", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const request = vi.fn().mockResolvedValue(undefined);
  window.forgeCodex = { request } as unknown as CodexApi;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const thread: CodexThreadSummary = { id: "t", repositoryId: "r", title: "Test", archived: false, createdAt: "", updatedAt: "", settings: defaultCodexPreferences, state: "idle", worktree: "/repo/old-worktree", branch: "codex/task", baseCommit: "base", checkout: "worktree" };
  try {
    await act(async () => root.render(<CodexQuickActions thread={thread} theme="light" defaultBranch="main" group="git" />));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Merge into main"]')!.click());
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => root.render(<CodexQuickActions thread={{ ...thread, checkout: "default", branch: "main", worktree: "/repo" }} theme="light" defaultBranch="main" group="git" />));
    expect(container.querySelector('[aria-label="Start worktree"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
    delete window.forgeCodex;
  }
});
