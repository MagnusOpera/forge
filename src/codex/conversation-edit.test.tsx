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
  window.forgeCodex = { request, onChanged: () => () => {}, onTerminalEvent: () => () => {} } as CodexApi;
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
  expect(cancel.nextElementSibling?.getAttribute("aria-label")).toBe(
    "Replace response",
  );
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
  const send = container.querySelector<HTMLButtonElement>(
    '[aria-label="Send"]',
  )!;
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
  const send = container.querySelector<HTMLButtonElement>(
    '[aria-label="Send"]',
  )!;
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

it.each(["starting", "running", "waiting"])(
  "uses the floating button to stop a %s turn without sending a message",
  async (state) => {
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (method, input) => {
      const result = await original(method, input);
      if (method === "thread")
        return {
          ...result,
          thread: { ...result.thread, state, draft: "", draftAttachments: [] },
        };
      return result;
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
    const stop = container.querySelector<HTMLButtonElement>(
      '.codex-input [aria-label="Stop"]',
    )!;
    expect(stop).not.toBeNull();
    expect(stop.textContent).toBe("");
    expect(stop.disabled).toBe(false);
    expect(container.querySelectorAll('[aria-label="Stop"]')).toHaveLength(1);
    expect(
      container.querySelector('.codex-composer-status [aria-label="Stop"]'),
    ).toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="Access type"]')!
        .disabled,
    ).toBe(true);
    await act(async () => stop.click());
    expect(request).toHaveBeenCalledWith("stop", {
      repositoryId: "r",
      id: "t",
    });
    expect(request.mock.calls.some(([method]) => method === "send")).toBe(
      false,
    );
  },
);

it("updates access from the composer dropdown while preserving the other chat settings", async () => {
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
  const trigger = container.querySelector<HTMLButtonElement>(
    '[aria-label="Access type"]',
  )!;
  expect(trigger.disabled).toBe(false);
  expect(trigger.textContent).toBe("Ask when needed");
  const menu = container.querySelector<HTMLElement>(
    '[role="listbox"][aria-label="Access type"]',
  )!;
  menu.removeAttribute("popover");
  const options = menu.querySelectorAll<HTMLButtonElement>('[role="option"]');
  expect(Array.from(options, (option) => option.textContent)).toEqual([
    "Ask when needed",
    "Strict sandbox",
    "Full access",
  ]);
  act(() => options[0].focus());
  act(() =>
    options[0].dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true }),
    ),
  );
  expect(document.activeElement).toBe(options[2]);
  await act(async () => options[2].click());
  expect(request).toHaveBeenCalledWith("update", {
    repositoryId: "r",
    id: "t",
    settings: { ...defaultCodexPreferences, permissions: "full" },
  });
  expect(document.activeElement).toBe(trigger);
  expect(request.mock.calls.some(([method]) => method === "send")).toBe(false);
});
it("keeps Plan mode read-only in the access picker", async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (method, input) => {
    const result = await original(method, input);
    if (method === "thread")
      return {
        ...result,
        thread: {
          ...result.thread,
          settings: { ...result.thread.settings, mode: "plan" },
        },
      };
    return result;
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
  const trigger = container.querySelector<HTMLButtonElement>(
    '[aria-label="Access type"]',
  )!;
  expect(trigger.disabled).toBe(true);
  expect(trigger.textContent).toBe("Read-only");
});

it("keeps an editable new-thread environment selector below the description", async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (method, input) => {
    const result = await original(method, input);
    if (method === "thread") return { ...result, thread: { ...result.thread, items: [], serverId: "", repositoryPath: "/Users/developer/src/repo" } };
    return result;
  });
  await act(async () => root.render(<CodexConversation repositoryId="r" id="t" loading={false} onConfigure={() => {}} />));
  const note = container.querySelector('.codex-start-note')!;
  expect(note.querySelector('p')?.textContent).toContain("A separate worktree");
  expect(note.querySelector('p + .codex-environment-header [role="combobox"]')).not.toBeNull();
  expect(container.querySelector('.codex-composer-status .codex-environment-header')).toBeNull();
  expect(note.querySelector("code")).toBeNull();
  expect(container.querySelector('.codex-conversation > .codex-environment-header')).toBeNull();
});

it("places established thread environment controls immediately before the composer status", async () => {
  await act(async () => root.render(<CodexConversation repositoryId="r" id="t" loading={false} onConfigure={() => {}} />));
  expect(container.querySelector('.codex-conversation > .codex-environment-header')).toBeNull();
  expect(container.querySelector('.codex-composer-status .codex-environment-header + .codex-state')?.textContent).toBe('idle');
});

it("moves the settled environment beside status once a worktree exists, even before any messages", async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (method, input) => {
    const result = await original(method, input);
    if (method === "thread") return { ...result, thread: { ...result.thread, items: [], serverId: "", worktree: "/repo/worktree" } };
    return result;
  });
  await act(async () => root.render(<CodexConversation repositoryId="r" id="t" loading={false} onConfigure={() => {}} />));
  expect(container.querySelector('.codex-start-note .codex-environment-header')).toBeNull();
  expect(container.querySelector('.codex-composer-status .codex-environment-header + .codex-state')?.textContent).toBe("idle");
  expect(container.querySelector('.codex-composer-status [role="combobox"]')).toBeNull();
});
