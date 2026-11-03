// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChatApi, ChatState } from "../../shared/chatgpt";
import { ChatWorkspace } from "./workspace";
let root: Root, container: HTMLDivElement, frame: HTMLIFrameElement;
let sidebarHost: HTMLDivElement;
let changed: (state: ChatState) => void;
const request = vi.fn(),
  layout = vi.fn(),
  activate = vi.fn();
const initial = (): ChatState => ({
  projects: [{ id: "project", name: "Forge", instructions: "Be concise." }],
  threads: ["First", "Second"].map((title, i) => ({
    id: `chat-${i}`,
    title,
    model: "model",
    projectId: "project",
    updatedAt: 2 - i,
    messages: [],
  })),
  connected: true,
  models: [{ slug: "model", displayName: "Available model" }],
});
const render = (active = true, theme = "dark") =>
  root.render(
    <ChatWorkspace
      sidebarHost={sidebarHost}
      active={active}
      theme={theme}
      accent="#123456"
      appearance="normal"
      onActivate={activate}
      onDetachedLayout={layout}
      onResize={() => {}}
      sidebarCollapsed={false}
    />,
  );
function button(label: string, doc: ParentNode = container): HTMLButtonElement {
  const result = [...doc.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label || b.textContent === label,
  );
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
async function click(label: string, doc: ParentNode = container) {
  await act(async () => button(label, doc).click());
}
async function type(editor: HTMLElement, value: string) {
  await act(async () => {
    (
      editor as HTMLElement & { editor: import("@tiptap/core").Editor }
    ).editor.commands.setContent(value, { contentType: "markdown" });
  });
}
beforeEach(async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  request.mockReset();
  layout.mockClear();
  activate.mockClear();
  request.mockImplementation(async (method: string) =>
    method === "state" ? initial() : undefined,
  );
  window.forgeChatGpt = {
    request,
    onChanged: (callback) => {
      changed = callback;
      return () => {};
    },
  } as ChatApi;
  container = document.createElement("div");
  frame = document.createElement("iframe");
  document.body.append(container, frame);
  vi.spyOn(window, "open").mockReturnValue(frame.contentWindow);
  vi.spyOn(frame.contentWindow!, "focus").mockImplementation(() => {});
  vi.spyOn(frame.contentWindow!, "close").mockImplementation(() => {});
  sidebarHost = document.createElement("div");
  const workspace = document.createElement("div");
  container.append(sidebarHost, workspace);
  root = createRoot(workspace);
  await act(async () => render());
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  frame.remove();
  delete window.forgeChatGpt;
  vi.restoreAllMocks();
});
it("keeps drafts while navigating chats and switching back to GitHub", async () => {
  await click("First");
  const editor = container.querySelector<HTMLElement>(
    '[aria-label="Message OpenAI"]',
  )!;
  await type(editor, "Unsent draft");
  await click("Second");
  await click("First");
  expect(
    container.querySelector('[aria-label="Chat: First"] [role="textbox"]'),
  ).toBe(editor);
  expect(editor.textContent).toBe("Unsent draft");
  await act(async () => render(false));
  await act(async () => render(true));
  expect(editor.textContent).toBe("Unsent draft");
});
it("streams updates into a detached live conversation and reattaches with the same draft and theme", async () => {
  await click("First");
  expect(container.querySelector('.chatgpt-content-header [aria-label="Delete chat"]')).toBeNull();
  expect(container.querySelector('[aria-label="Delete thread First"]')).not.toBeNull();
  const editor = container.querySelector<HTMLElement>(
    '[aria-label="Message OpenAI"]',
  )!;
  await type(editor, "Draft survives");
  await click("Detach chat");
  await act(async () =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: "forge-content-ready",
      }),
    ),
  );
  expect(frame.contentDocument!.querySelector('[role="textbox"]')).toBe(editor);
  expect(frame.contentDocument!.querySelector('.chatgpt-content-header [aria-label="Delete chat"]')).toBeNull();
  await click("Rename chat", frame.contentDocument!);
  expect(frame.contentDocument!.querySelector('[aria-label="Chat title"]')).not.toBeNull();
  expect(frame.contentDocument!.querySelector('[aria-label="Save chat title"] .lucide-save')).not.toBeNull();
  await click("Cancel rename", frame.contentDocument!);
  expect(frame.contentDocument!.querySelector('[aria-label="Chat title"]')).toBeNull();
  expect(layout).toHaveBeenLastCalledWith(true);
  const next = initial();
  next.threads[0].messages.push({
    id: "reply",
    role: "assistant",
    text: "Streamed reply",
    status: "streaming",
  });
  await act(async () => changed(next));
  expect(frame.contentDocument!.body.textContent).toContain("Streamed reply");
  await act(async () => render(true, "light"));
  expect(
    frame.contentDocument!.querySelector('[data-theme="light"]'),
  ).not.toBeNull();
  await click("Reattach chat", frame.contentDocument!);
  expect(activate).toHaveBeenCalled();
  expect(editor.textContent).toBe("Draft survives");
  expect(layout).toHaveBeenLastCalledWith(false);
});
it("sends the selected model on Enter while preserving Shift+Enter and restores failed drafts", async () => {
  await click("First");
  const editor = container.querySelector<HTMLElement>(
    '[aria-label="Message OpenAI"]',
  )!;
  await type(editor, "Hello");
  await act(async () =>
    editor.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        shiftKey: true,
        bubbles: true,
      }),
    ),
  );
  expect(request).not.toHaveBeenCalledWith("send", expect.anything());
  request.mockImplementation(async (method) => {
    if (method === "send") throw new Error("Session expired");
  });
  await act(async () =>
    editor.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  expect(request).toHaveBeenCalledWith("send", {
    id: "chat-0",
    text: "Hello",
    model: "model",
    attachments: [],
    effort: "",
    speed: "normal",
  });
  expect(editor.textContent).toBe("Hello");
  expect(container.textContent).toContain("Session expired");
});
it("uses arrow keys to navigate native chats", async () => {
  await click("First");
  await act(async () =>
    button("First").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  expect(button("Second").getAttribute("aria-pressed")).toBe("true");
});

it("renders projects in pane one and only the selected project's threads in pane two", async () => {
  const next = initial();
  next.projects.push({ id: "other", name: "Other", instructions: "" });
  next.threads.push({
    id: "other-thread",
    title: "Other thread",
    projectId: "other",
    model: "model",
    updatedAt: 3,
    messages: [],
  });
  await act(async () => changed(next));
  expect(sidebarHost.querySelector(".chatgpt-project-select")).not.toBeNull();
  expect(sidebarHost.querySelector(".chatgpt-thread-list")).toBeNull();
  expect(
    container.querySelector(".chatgpt-threads-pane .chatgpt-project-select"),
  ).toBeNull();
  await click("First");
  await click("Select project Other");
  expect(
    container.querySelector(".chatgpt-threads-pane")!.textContent,
  ).toContain("Other thread");
  expect(
    container.querySelector(".chatgpt-threads-pane")!.textContent,
  ).not.toContain("First");
  expect(
    container
      .querySelector('[aria-label="Chat: First"]')!
      .closest<HTMLElement>(".content-pane-slot")!.parentElement!.style.display,
  ).toBe("none");
});
it("uses the shared model picker and searches project names and thread messages behind a search button", async () => {
  expect(
    sidebarHost.querySelector(
      'input[aria-label="Search ChatGPT projects and threads"]',
    ),
  ).toBeNull();
  await click("First");
  expect(container.querySelector("select")).toBeNull();
  expect(
    container.querySelector('button[aria-label="Model and reasoning effort"]'),
  ).not.toBeNull();
  expect(
    sidebarHost.querySelector('[aria-label="ChatGPT account"]'),
  ).toBeNull();
  expect(
    sidebarHost.querySelector(".chatgpt-account-details, .chatgpt-local-note"),
  ).toBeNull();
  const next = initial();
  next.threads[0].messages.push({
    id: "match",
    role: "assistant",
    text: "Needle in a message",
    status: "complete",
  });
  await act(async () => changed(next));
  await click("Search ChatGPT projects and threads");
  const input = sidebarHost.querySelector<HTMLInputElement>("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "needle");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(sidebarHost.querySelectorAll(".chatgpt-project-select")).toHaveLength(
    1,
  );
  expect(container.querySelectorAll(".chatgpt-thread-select")).toHaveLength(1);
  expect(
    container.querySelector(".chatgpt-thread-select")!.textContent,
  ).toContain("First");
  await click("Close ChatGPT search");
  expect(container.querySelectorAll(".chatgpt-thread-select")).toHaveLength(2);
});
it("reorders projects from the keyboard and exposes project and thread deletion in their respective panes", async () => {
  const next = initial();
  next.projects.push({ id: "other", name: "Other", instructions: "" });
  await act(async () => changed(next));
  await act(async () =>
    button("Select project Forge").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    ),
  );
  expect(request).toHaveBeenCalledWith("reorderProjects", {
    sourceId: "project",
    targetId: "other",
  });
  await click("Delete project Forge");
  expect(request).toHaveBeenCalledWith("deleteProject", { id: "project" });
  await click("Delete thread First");
  expect(request).toHaveBeenCalledWith("delete", { id: "chat-0" });
});

it("uses the Codex Markdown editor, sends Markdown, and clears the editor on success", async () => {
  await click("First");
  const editor = container.querySelector<HTMLElement>(
    '[aria-label="Message OpenAI"]',
  )!;
  expect(editor.classList.contains("tiptap")).toBe(true);
  expect(editor.getAttribute("contenteditable")).toBe("true");
  await type(editor, "**Bold** and `inline code`");
  expect(editor.querySelector("strong")?.textContent).toBe("Bold");
  expect(editor.querySelector("code")?.textContent).toBe("inline code");
  await click("Send message");
  expect(request).toHaveBeenCalledWith(
    "send",
    expect.objectContaining({ text: "**Bold** and `inline code`" }),
  );
  expect(editor.textContent).toBe("");
});

it("accepts dropped and pasted files, removes attachments, and preserves them across detachment and send failures", async () => {
  const attachFiles = vi.fn(async (_input, files: File[]) =>
    files.map((file) => ({
      id: file.name,
      name: file.name,
      kind: "document" as const,
    })),
  );
  window.forgeChatGpt!.attachFiles = attachFiles;
  await click("First");
  const composer = container.querySelector(".chatgpt-composer")!;
  const dropped = new File(["notes"], "notes.txt");
  const drop = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(drop, "dataTransfer", { value: { files: [dropped] } });
  await act(async () => composer.dispatchEvent(drop));
  expect(attachFiles).toHaveBeenCalledWith({ id: "chat-0" }, [dropped]);
  const pasted = new File(["image"], "image.png");
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", { value: { files: [pasted] } });
  await act(async () =>
    container
      .querySelector('[aria-label="Message OpenAI"]')!
      .dispatchEvent(paste),
  );
  expect(paste.defaultPrevented).toBe(true);
  expect(container.querySelector(".codex-attachments")?.textContent).toContain(
    "notes.txt",
  );
  expect(container.querySelector(".codex-attachments")?.textContent).toContain(
    "image.png",
  );
  await click("Remove image.png");
  await click("Detach chat");
  await act(async () =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: "forge-content-ready",
      }),
    ),
  );
  expect(
    frame.contentDocument!.querySelector(".codex-attachments")?.textContent,
  ).toContain("notes.txt");
  request.mockImplementation(async (method) => {
    if (method === "send") throw new Error("Try again");
  });
  await click("Send message", frame.contentDocument!);
  expect(request).toHaveBeenCalledWith(
    "send",
    expect.objectContaining({
      text: "",
      attachments: [{ id: "notes.txt", name: "notes.txt", kind: "document" }],
    }),
  );
  expect(
    frame.contentDocument!.querySelector(".codex-attachments")?.textContent,
  ).toContain("notes.txt");
  await click("Reattach chat", frame.contentDocument!);
  expect(container.querySelector(".codex-attachments")?.textContent).toContain(
    "notes.txt",
  );
});

it("displays expandable thinking summaries and saved attachment actions beside the answer", async () => {
  const next = initial();
  next.threads[0].messages.push(
    {
      id: "u",
      role: "user",
      text: "Read this",
      status: "complete",
      attachments: [{ id: "doc", name: "notes.pdf", kind: "document" }],
    },
    {
      id: "a",
      role: "assistant",
      text: "The answer",
      status: "complete",
      activity: [
        { id: "r", kind: "reasoning", text: "Checking the attached notes." },
      ],
      timing: { durationMs: 1500 },
    },
  );
  await act(async () => changed(next));
  await click("First");
  const activity = container.querySelector<HTMLDetailsElement>(
    ".codex-work-activity",
  )!;
  expect(activity.open).toBe(false);
  expect(activity.textContent).toContain("Thinking summary");
  expect(activity.textContent).toContain("Checking the attached notes.");
  expect(container.textContent).toContain("The answer");
  await click("Open notes.pdf");
  expect(request).toHaveBeenCalledWith("openAttachment", {
    id: "chat-0",
    attachmentId: "doc",
  });
});

it("uploads dropped and pasted file bytes through the existing request bridge when the native drop helper is absent", async () => {
  expect(window.forgeChatGpt!.attachFiles).toBeUndefined();
  request.mockImplementation(async (method, input) =>
    method === "attach"
      ? input.files.map((file: { name: string }) => ({
          id: file.name,
          name: file.name,
          kind: "document",
        }))
      : undefined,
  );
  await click("First");
  const editor = container.querySelector<HTMLElement>(
    '[aria-label="Message OpenAI"]',
  )!;
  await type(editor, "Keep this draft");
  const drop = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(drop, "dataTransfer", {
    value: { files: [new File(["notes"], "notes.txt")] },
  });
  await act(async () => {
    container.querySelector(".chatgpt-composer")!.dispatchEvent(drop);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  const droppedUpload = request.mock.calls.find(
    ([method]) => method === "attach",
  )![1];
  expect(droppedUpload).toMatchObject({
    id: "chat-0",
    files: [{ name: "notes.txt" }],
  });
  expect(Array.from(droppedUpload.files[0].data)).toEqual(
    Array.from(new TextEncoder().encode("notes")),
  );
  expect(container.querySelector(".codex-attachments")?.textContent).toContain(
    "notes.txt",
  );
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", {
    value: { files: [new File(["image"], "image.png")] },
  });
  await act(async () => {
    editor.dispatchEvent(paste);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  const pastedUpload = request.mock.calls
    .filter(([method]) => method === "attach")
    .at(-1)![1];
  expect(pastedUpload).toMatchObject({
    id: "chat-0",
    files: [{ name: "image.png" }],
  });
  expect(Array.from(pastedUpload.files[0].data)).toEqual(
    Array.from(new TextEncoder().encode("image")),
  );
  expect(editor.textContent).toBe("Keep this draft");
  expect(container.querySelector(".codex-attachments")?.textContent).toContain(
    "image.png",
  );
  expect(container.textContent).not.toContain("File drop is unavailable");
});

it("renders image-only replies inline, keeps previews while detaching, and supports Open and Save", async () => {
  const next = initial();
  next.threads[0].messages.push({
    id: "image-reply",
    role: "assistant",
    text: "",
    status: "complete",
    images: [{ id: "generated", name: "Generated image.png", kind: "image" }],
  });
  request.mockImplementation(async (method) =>
    method === "attachmentImage" ? "data:image/png;base64,fixture" : undefined,
  );
  await act(async () => changed(next));
  await click("First");
  const image = container.querySelector(".chatgpt-generated-image img")!;
  expect(image.getAttribute("src")).toBe("data:image/png;base64,fixture");
  await click("Open image");
  expect(request).toHaveBeenCalledWith("openAttachment", {
    id: "chat-0",
    attachmentId: "generated",
  });
  await click("Save image");
  expect(request).toHaveBeenCalledWith("saveAttachment", {
    id: "chat-0",
    attachmentId: "generated",
  });
  await click("Detach chat");
  await act(async () =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: "forge-content-ready",
      }),
    ),
  );
  expect(
    frame.contentDocument!.querySelector(".chatgpt-generated-image img"),
  ).toBe(image);
});

it("shows image-generation progress and an explicit error when a saved preview cannot be loaded", async () => {
  const next = initial();
  next.threads[0].messages.push({
    id: "image-reply",
    role: "assistant",
    text: "",
    status: "streaming",
    activity: [
      {
        id: "generation",
        kind: "imageGeneration",
        text: "Generating an image…",
        status: "in_progress",
      },
    ],
  });
  await act(async () => changed(next));
  await click("First");
  expect(container.textContent).toContain("Generating image…");
  request.mockImplementation(async (method) => {
    if (method === "attachmentImage") throw new Error("Image file missing");
  });
  next.threads[0].messages[0] = {
    id: "image-reply",
    role: "assistant",
    text: "",
    status: "complete",
    images: [{ id: "missing", name: "Generated image.png", kind: "image" }],
  };
  await act(async () => changed(structuredClone(next)));
  expect(container.textContent).toContain("Image unavailable");
  expect(container.textContent).toContain("Image file missing");
});
