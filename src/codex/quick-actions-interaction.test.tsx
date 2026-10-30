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
  window.forgeCodex = { request, onChanged: () => () => {} } as CodexApi;
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
