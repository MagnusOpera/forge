// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CodexConversation } from "./conversation";
import {
  defaultCodexPreferences,
  type CodexThread,
  type CodexApi,
} from "../../shared/codex";
let container: HTMLDivElement, root: Root;
const request = vi.fn();
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const thread: CodexThread = {
    id: "t",
    repositoryId: "r",
    title: "Test",
    archived: false,
    createdAt: "",
    updatedAt: "",
    settings: defaultCodexPreferences,
    state: "idle",
    worktree: "",
    branch: "",
    baseCommit: "",
    serverId: "server",
    repositoryPath: "",
    items: [
      {
        id: "user",
        kind: "userMessage",
        text: "**Earlier** message",
        createdAt: 1000,
      },
    ],
    requests: [],
    queue: [],
    queuePaused: false,
    draft: "Unsent draft",
    draftAttachments: [
      { id: "attachment", name: "notes.pdf", kind: "document" },
    ],
  };
  request
    .mockReset()
    .mockImplementation(async (method) =>
      method === "thread"
        ? { thread, before: null }
        : method === "models"
          ? []
          : undefined,
    );
  window.forgeCodex = { request, onChanged: () => () => {} } as CodexApi;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.forgeCodex;
  vi.unstubAllGlobals();
});
it("loads a user message for revision without sending and restores the previous draft on cancel", async () => {
  await act(async () =>
    root.render(
      <CodexConversation
        repositoryId="r"
        id="t"
        loading={false}
        onConfigure={() => {}}
      />,
    ),
  );
  expect(container.querySelector('[role="textbox"]')!.textContent).toBe(
    "Unsent draft",
  );
  act(() =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Edit message"]')!
      .click(),
  );
  expect(container.querySelector('[role="textbox"]')!.textContent).toBe(
    "Earlier message",
  );
  expect(container.querySelector('[role="textbox"] strong')!.textContent).toBe(
    "Earlier",
  );
  expect(container.textContent).not.toContain("Editing your latest message");
  expect(container.querySelector(".codex-cancel-edit")).not.toBeNull();
  expect(container.querySelector('[aria-label="Remove notes.pdf"]')).toBeNull();
  expect(request.mock.calls.some(([method]) => method === "send")).toBe(false);
  act(() =>
    container.querySelector<HTMLButtonElement>(".codex-cancel-edit")!.click(),
  );
  expect(container.querySelector('[role="textbox"]')!.textContent).toBe(
    "Unsent draft",
  );
  expect(
    container.querySelector('[aria-label="Remove notes.pdf"]'),
  ).not.toBeNull();
  expect(container.querySelector(".codex-editing-message")).toBeNull();
});

it("submits revisions through replacement and keeps Cancel immediately before Replace response", async () => {
  await act(async () =>
    root.render(
      <CodexConversation
        repositoryId="r"
        id="t"
        loading={false}
        onConfigure={() => {}}
      />,
    ),
  );
  act(() =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Edit message"]')!
      .click(),
  );
  const cancel =
    container.querySelector<HTMLButtonElement>(".codex-cancel-edit")!;
  expect(cancel.nextElementSibling?.textContent).toContain("Replace response");
  await act(async () =>
    (cancel.nextElementSibling as HTMLButtonElement).click(),
  );
  expect(request).toHaveBeenCalledWith("replaceMessage", {
    repositoryId: "r",
    id: "t",
    messageId: "user",
    text: "**Earlier** message",
    attachments: [],
  });
  expect(request.mock.calls.some(([method]) => method === "send")).toBe(false);
  expect(container.querySelector('[role="textbox"]')!.textContent).toBe("");
});

it("clears the visible editor and attachments after a successful send", async () => {
  let acknowledge!: () => void;
  const accepted = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (method, input) =>
    method === "send" ? accepted : original(method, input),
  );
  await act(async () =>
    root.render(
      <CodexConversation
        repositoryId="r"
        id="t"
        loading={false}
        onConfigure={() => {}}
      />,
    ),
  );
  const send = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).find((button) => button.textContent === "Send")!;
  await act(async () => send.click());
  expect(request).toHaveBeenCalledWith(
    "send",
    expect.objectContaining({ text: "Unsent draft" }),
  );
  await act(async () => acknowledge());
  expect(container.querySelector('[role="textbox"]')!.textContent).toBe("");
  expect(container.querySelector('[aria-label="Remove notes.pdf"]')).toBeNull();
  expect(send.disabled).toBe(true);
});
it("preserves the visible message and attachments if sending fails", async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (method, input) => {
    if (method === "send") throw new Error("Send failed");
    return original(method, input);
  });
  await act(async () =>
    root.render(
      <CodexConversation
        repositoryId="r"
        id="t"
        loading={false}
        onConfigure={() => {}}
      />,
    ),
  );
  const send = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).find((button) => button.textContent === "Send")!;
  await act(async () => send.click());
  expect(container.querySelector('[role="textbox"]')!.textContent).toBe(
    "Unsent draft",
  );
  expect(
    container.querySelector('[aria-label="Remove notes.pdf"]'),
  ).not.toBeNull();
  expect(container.querySelector('[role="alert"]')!.textContent).toContain(
    "Send failed",
  );
});
