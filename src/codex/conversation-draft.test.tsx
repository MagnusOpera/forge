// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CodexConversation } from "./conversation";
import { flushThreadDraft } from "./thread-drafts";
import { defaultCodexPreferences, type CodexApi } from "../../shared/codex";
vi.mock("./composer-editor", () => ({
  ComposerEditor: ({
    value,
    onChange,
    disabled,
  }: {
    value: string;
    onChange: (value: string) => void;
    disabled: boolean;
  }) => (
    <textarea
      aria-label="Message Codex"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
let root: Root, container: HTMLDivElement;
const request = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  request
    .mockReset()
    .mockImplementation(async (method) =>
      method === "models"
        ? []
        : method === "thread"
          ? {
              before: null,
              thread: {
                id: "thread",
                repositoryId: "repo",
                title: "Task",
                archived: false,
                settings: defaultCodexPreferences,
                state: "idle",
                serverId: "",
                worktree: "",
                items: [],
                requests: [],
                queue: [],
                draft: "",
                draftAttachments: [],
              },
            }
          : undefined,
    );
  window.forgeCodex = {
    request,
    onChanged: () => () => {},
    onTerminalEvent: () => () => {},
  } as CodexApi;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.forgeCodex;
  vi.useRealTimers();
});
async function edit(value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLTextAreaElement>(
      '[aria-label="Message Codex"]',
    )!;
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("flushes edits before the debounce expires and does not later overwrite the detached draft", async () => {
  await act(async () =>
    root.render(
      <CodexConversation
        repositoryId="repo"
        id="thread"
        loading={false}
        onConfigure={() => {}}
      />,
    ),
  );
  await edit("Draft moved between windows");
  expect(request.mock.calls.some(([method]) => method === "update")).toBe(
    false,
  );
  await act(async () => flushThreadDraft("repo", "thread"));
  expect(request).toHaveBeenCalledWith("update", {
    repositoryId: "repo",
    id: "thread",
    draft: "Draft moved between windows",
    draftAttachments: [],
  });
  const calls = request.mock.calls.filter(
    ([method]) => method === "update",
  ).length;
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  await act(async () => root.render(null));
  expect(
    request.mock.calls.filter(([method]) => method === "update"),
  ).toHaveLength(calls);
});
it("reports save failure to the window handoff and can retry the same draft", async () => {
  await act(async () =>
    root.render(
      <CodexConversation
        repositoryId="repo"
        id="thread"
        loading={false}
        onConfigure={() => {}}
      />,
    ),
  );
  await edit("Keep this draft");
  request.mockRejectedValueOnce(new Error("Disk full"));
  await expect(flushThreadDraft("repo", "thread")).rejects.toThrow("Disk full");
  request.mockResolvedValue(undefined);
  await expect(flushThreadDraft("repo", "thread")).resolves.toBeUndefined();
  expect(request).toHaveBeenLastCalledWith(
    "update",
    expect.objectContaining({ draft: "Keep this draft" }),
  );
});
