import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  ChatProvider,
  type ChatRuntime,
} from "../../electron/main/chatgpt/provider";
import type { RpcEvent } from "../../electron/main/codex/client";
let root: string,
  provider: ChatProvider,
  listeners: Set<(event: RpcEvent) => void>;
let runtime: ChatRuntime;
const rpc = vi.fn(),
  status = vi.fn(),
  models = vi.fn();
const emit = (method: string, params: any) => {
  for (const listener of listeners) listener({ method, params });
};
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "forge-chat-provider-"));
  listeners = new Set();
  status
    .mockReset()
    .mockResolvedValue({ connected: true, authenticated: true });
  models
    .mockReset()
    .mockResolvedValue([{ id: "account-model", name: "Account model" }]);
  rpc.mockReset().mockImplementation(async (method) => {
    if (method === "config/read")
      return { config: { mcp_servers: { example: { enabled: true } } } };
    if (method === "thread/start") return { thread: { id: "server-thread" } };
    if (method === "turn/start") {
      emit("turn/started", { threadId: "server-thread", turn: { id: "turn" } });
      emit("item/agentMessage/delta", {
        threadId: "unrelated-build-thread",
        itemId: "other",
        delta: "Wrong",
      });
      emit("item/agentMessage/delta", {
        threadId: "server-thread",
        itemId: "answer",
        delta: "Hello",
      });
      emit("turn/completed", {
        threadId: "server-thread",
        turn: { id: "turn", status: "completed" },
      });
      return { turn: { id: "turn" } };
    }
    return {};
  });
  runtime = {
    start: vi.fn(async () => {}),
    request: rpc,
    status,
    models,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onEvent: vi.fn(),
    respond: vi.fn(),
    rejectRequest: vi.fn(),
    stop: vi.fn(),
  };
  provider = new ChatProvider(() => runtime, root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
it("fetches the model catalog from the existing authenticated runtime", async () => {
  expect(await provider.catalog()).toEqual({
    connected: true,
    models: [{ slug: "account-model", displayName: "Account model" }],
  });
  expect(status).toHaveBeenCalledOnce();
  expect(models).toHaveBeenCalledOnce();
  status.mockResolvedValueOnce({ connected: true, authenticated: false });
  expect(await provider.catalog()).toMatchObject({
    connected: false,
    models: [],
  });
});
it("streams only its own thread and handles completion arriving before turn/start returns", async () => {
  let output = "";
  await provider.stream(
    "account-model",
    [
      {
        id: "old-user",
        role: "user",
        text: "Earlier question",
        status: "complete",
      },
      {
        id: "old-answer",
        role: "assistant",
        text: "Earlier answer",
        status: "complete",
      },
      {
        id: "partial",
        role: "assistant",
        text: "Incomplete",
        status: "failed",
      },
      { id: "new", role: "user", text: "Now explain", status: "complete" },
    ],
    "Project instructions",
    new AbortController().signal,
    (delta) => (output += delta),
  );
  expect(output).toBe("Hello");
  expect(rpc).toHaveBeenCalledWith(
    "thread/start",
    expect.objectContaining({
      model: "account-model",
      ephemeral: true,
      sandbox: "read-only",
      approvalPolicy: "never",
      developerInstructions: "Project instructions",
      config: expect.objectContaining({
        "features.shell_tool": false,
        "features.apps": false,
        "mcp_servers.example.enabled": false,
      }),
    }),
  );
  expect(rpc).toHaveBeenCalledWith("thread/inject_items", {
    threadId: "server-thread",
    items: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Earlier question" }],
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Earlier answer" }],
      },
    ],
  });
  expect(rpc).toHaveBeenCalledWith("thread/unsubscribe", {
    threadId: "server-thread",
  });
  expect(listeners.size).toBe(0);
});
it("cancels only the Chat turn while leaving the shared runtime alive", async () => {
  const controller = new AbortController();
  rpc.mockImplementation(async (method) => {
    if (method === "thread/start") return { thread: { id: "server-thread" } };
    if (method === "turn/start") {
      emit("turn/started", { threadId: "server-thread", turn: { id: "turn" } });
      return { turn: { id: "turn" } };
    }
    return {};
  });
  const pending = provider.stream(
    "account-model",
    [{ id: "new", role: "user", text: "Hello", status: "complete" }],
    "",
    controller.signal,
    () => {},
  );
  await vi.waitFor(() =>
    expect(rpc).toHaveBeenCalledWith("turn/start", expect.anything()),
  );
  controller.abort();
  await expect(pending).rejects.toThrow("stopped");
  expect(rpc).toHaveBeenCalledWith("turn/interrupt", {
    threadId: "server-thread",
    turnId: "turn",
  });
  expect(runtime.stop).not.toHaveBeenCalled();
});
it("rejects failed completions and releases its event listener", async () => {
  rpc.mockImplementation(async (method) => {
    if (method === "thread/start") return { thread: { id: "server-thread" } };
    if (method === "turn/start") {
      emit("turn/completed", {
        threadId: "server-thread",
        turn: {
          id: "turn",
          status: "failed",
          error: { message: "Unavailable model" },
        },
      });
      return { turn: { id: "turn" } };
    }
    return {};
  });
  await expect(
    provider.stream(
      "account-model",
      [{ id: "u", role: "user", text: "Hi", status: "complete" }],
      "",
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow("Unavailable model");
  expect(listeners.size).toBe(0);
});

it("subscribes without replacing Build's event handler or allowing another subscriber to break transport", async () => {
  const { CodexClient } = await import("../../electron/main/codex/client");
  const client = new CodexClient("/unused", () => "unused");
  const build = vi.fn(),
    think = vi.fn();
  client.onEvent = build;
  client.subscribe(() => {
    throw new Error("Unrelated listener failure");
  });
  const unsubscribe = client.subscribe(think);
  client.onLine(
    JSON.stringify({ method: "turn/completed", params: { threadId: "build" } }),
  );
  expect(build).toHaveBeenCalledOnce();
  expect(think).toHaveBeenCalledOnce();
  unsubscribe();
  client.onLine(
    JSON.stringify({ method: "turn/completed", params: { threadId: "build" } }),
  );
  expect(build).toHaveBeenCalledTimes(2);
  expect(think).toHaveBeenCalledOnce();
});

it("sends attached images and documents again with later conversation history and applies reasoning controls", async () => {
  const { importAttachmentData } = await import(
    "../../electron/main/codex/files"
  );
  const files = importAttachmentData(root, [
    {
      name: "notes.txt",
      data: new TextEncoder().encode("The release is Tuesday."),
    },
    {
      name: "sample.png",
      data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    },
  ]);
  provider = new ChatProvider(() => runtime, path.join(root, "workspace"));
  await provider.stream(
    "account-model",
    [
      {
        id: "old",
        role: "user",
        text: "Remember these",
        attachments: files,
        status: "complete",
      },
      { id: "a", role: "assistant", text: "Understood", status: "complete" },
      {
        id: "now",
        role: "user",
        text: "",
        attachments: files,
        status: "complete",
      },
    ],
    "",
    new AbortController().signal,
    () => {},
    { effort: "high", speed: "fast" },
  );
  expect(
    rpc.mock.calls.find(([method]) => method === "thread/start")![1],
  ).not.toHaveProperty("environments");
  const turn = rpc.mock.calls.find(([method]) => method === "turn/start")![1];
  expect(turn).toMatchObject({
    effort: "high",
    serviceTier: "fast",
    summary: "concise",
    sandboxPolicy: { type: "readOnly", networkAccess: false },
  });
  expect(turn.input).toEqual([
    expect.objectContaining({
      type: "text",
      text: expect.stringContaining("notes.txt"),
    }),
    {
      type: "localImage",
      path: realpathSync(path.join(root, "attachments", files[1].id)),
    },
  ]);
  const history = rpc.mock.calls.find(
    ([method]) => method === "thread/inject_items",
  )![1];
  expect(history.items[0].content).toEqual([
    { type: "input_text", text: "Remember these" },
    expect.objectContaining({
      type: "input_text",
      text: expect.stringContaining("notes.txt"),
    }),
    expect.objectContaining({
      type: "input_image",
      image_url: expect.stringMatching(/^data:image\/png;base64,/),
    }),
  ]);
  expect(rpc).toHaveBeenCalledWith(
    "thread/start",
    expect.objectContaining({
      config: expect.objectContaining({
        "features.shell_tool": true,
        "features.unified_exec": true,
        "features.apps": false,
      }),
    }),
  );
});

it("streams displayable thinking summaries without exposing raw reasoning or another thread's activity", async () => {
  const activity = vi.fn();
  const original = rpc.getMockImplementation()!;
  rpc.mockImplementation(async (method, params) => {
    if (method === "turn/start") {
      emit("item/reasoning/summaryTextDelta", {
        threadId: "wrong",
        itemId: "r",
        delta: "Wrong thread",
      });
      emit("item/reasoning/textDelta", {
        threadId: "server-thread",
        itemId: "r",
        delta: "Private reasoning",
      });
      emit("item/reasoning/summaryTextDelta", {
        threadId: "server-thread",
        itemId: "r",
        summaryIndex: 0,
        delta: "Checking the document.",
      });
    }
    return original(method, params);
  });
  await provider.stream(
    "account-model",
    [{ id: "u", role: "user", text: "Hi", status: "complete" }],
    "",
    new AbortController().signal,
    () => {},
    { onActivity: activity },
  );
  expect(activity).toHaveBeenCalledExactlyOnceWith([
    { id: "r", kind: "reasoning", text: "Checking the document." },
  ]);
});

it("keeps an execution environment for image loading while leaving shell tools disabled", async () => {
  const { importAttachmentData } = await import(
    "../../electron/main/codex/files"
  );
  const attachments = importAttachmentData(root, [
    {
      name: "image.png",
      data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    },
  ]);
  provider = new ChatProvider(() => runtime, path.join(root, "workspace"));
  await provider.stream(
    "account-model",
    [
      {
        id: "u",
        role: "user",
        text: "Describe this",
        attachments,
        status: "complete",
      },
    ],
    "",
    new AbortController().signal,
    () => {},
  );
  const start = rpc.mock.calls.find(
    ([method]) => method === "thread/start",
  )![1];
  expect(start).not.toHaveProperty("environments");
  expect(start.config["features.shell_tool"]).toBe(false);
  expect(start.config["features.unified_exec"]).toBe(false);
});

it("persists image-only replies from generation events and deduplicates repeated completions", async () => {
  const onImage = vi.fn();
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  provider = new ChatProvider(() => runtime, path.join(root, "workspace"));
  rpc.mockImplementation(async (method) => {
    if (method === "thread/start") return { thread: { id: "server-thread" } };
    if (method === "turn/start") {
      const item = {
        id: "generated",
        type: "imageGeneration",
        status: "completed",
        result: bytes.toString("base64"),
      };
      emit("item/completed", { threadId: "other-thread", item });
      emit("item/completed", { threadId: "server-thread", item });
      emit("item/completed", { threadId: "server-thread", item });
      emit("turn/completed", {
        threadId: "server-thread",
        turn: { id: "turn", status: "completed" },
      });
      return { turn: { id: "turn" } };
    }
    return {};
  });
  const delta = vi.fn();
  await provider.stream(
    "account-model",
    [{ id: "u", role: "user", text: "A puppy", status: "complete" }],
    "",
    new AbortController().signal,
    delta,
    { onImage },
  );
  expect(delta).not.toHaveBeenCalled();
  expect(onImage).toHaveBeenCalledOnce();
  expect(onImage.mock.calls[0][0]).toMatchObject({
    name: "Generated image.png",
    kind: "image",
  });
  const { readFileSync } = await import("node:fs");
  expect(
    readFileSync(path.join(root, "attachments", onImage.mock.calls[0][0].id)),
  ).toEqual(bytes);
  const image = onImage.mock.calls[0][0];
  await provider.stream(
    "account-model",
    [
      {
        id: "a",
        role: "assistant",
        text: "",
        images: [image],
        status: "complete",
      },
      { id: "u", role: "user", text: "Make it blue", status: "complete" },
    ],
    "",
    new AbortController().signal,
    () => {},
  );
  const history = rpc.mock.calls.find(
    ([method]) => method === "thread/inject_items",
  )![1];
  expect(history.items[0]).toMatchObject({
    role: "assistant",
    content: [{ type: "output_text", text: "Generated an image." }],
  });
  expect(history.items[1].content[1]).toEqual({
    type: "input_image",
    image_url: `data:image/png;base64,${bytes.toString("base64")}`,
  });
});

it("reports image-generation failures even when the text turn completes successfully", async () => {
  const original = rpc.getMockImplementation()!;
  rpc.mockImplementation(async (method, params) => {
    if (method === "turn/start")
      emit("item/completed", {
        threadId: "server-thread",
        item: {
          id: "image",
          type: "imageGeneration",
          status: "failed",
          failure: { type: "usageLimitExceeded" },
        },
      });
    return original(method, params);
  });
  await expect(
    provider.stream(
      "account-model",
      [{ id: "u", role: "user", text: "An image", status: "complete" }],
      "",
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow("Image generation usage limit reached");
});
