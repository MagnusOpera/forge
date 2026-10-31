// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ThreadWorkspace } from "./thread-workspace";
import {
  defaultCodexPreferences,
  type CodexThreadSummary,
} from "../../shared/codex";
vi.mock("./conversation", () => ({
  CodexConversation: () => <div aria-label="Conversation" />,
}));
vi.mock("./terminal-panel", () => ({
  TerminalPanel: () => <div aria-label="Terminal" />,
}));
it("keeps a single conversation and terminal when handing a thread between windows and toggling its terminal", async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const error = vi.spyOn(console, "error");
  const thread: CodexThreadSummary = {
    id: "thread",
    repositoryId: "repo",
    title: "Task",
    archived: false,
    createdAt: "",
    updatedAt: "",
    settings: defaultCodexPreferences,
    state: "idle",
    worktree: "/repo",
    branch: "main",
    baseCommit: "",
  };
  try {
    for (const [terminalOpen, detached] of [
      [false, false],
      [true, false],
      [true, true],
      [true, false],
      [false, false],
      [true, false],
    ]) {
      await act(async () =>
        root.render(
          <ThreadWorkspace
            repositoryId="repo"
            id="thread"
            thread={thread}
            theme="light"
            terminalOpen={terminalOpen}
            detached={detached}
            onConfigure={() => {}}
            onHideTerminal={() => {}}
          />,
        ),
      );
      expect(
        container.querySelectorAll('[aria-label="Conversation"]'),
      ).toHaveLength(detached ? 0 : 1);
      expect(
        container.querySelectorAll('[aria-label="Terminal"]'),
      ).toHaveLength(terminalOpen && !detached ? 1 : 0);
    }
    expect(
      error.mock.calls.some((args) => args.join(" ").includes("same key")),
    ).toBe(false);
  } finally {
    act(() => root.unmount());
    container.remove();
    error.mockRestore();
  }
});
