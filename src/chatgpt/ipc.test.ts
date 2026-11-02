import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const mock = vi.hoisted(() => ({
  root: "",
  handlers: new Map<string, (...args: any[]) => any>(),
  confirm: vi.fn(),
  save: vi.fn(),
  openPath: vi.fn(),
  catalog: vi.fn(),
  stream: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));
vi.mock("electron", () => ({
  app: {
    getPath: () => mock.root,
    getAppPath: () => "/forge",
    isPackaged: false,
    on: vi.fn(),
  },
  ipcMain: {
    handle: (name: string, handler: (...args: any[]) => any) =>
      mock.handlers.set(name, handler),
  },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: { showMessageBox: mock.confirm, showSaveDialog: mock.save },
  shell: { openExternal: vi.fn(), openPath: mock.openPath },
}));
vi.mock("../../electron/main/chatgpt/provider", () => ({
  ChatProvider: class {
    catalog = mock.catalog;
    stream = mock.stream;
  },
}));
import { registerChatGptIpc } from "../../electron/main/chatgpt/ipc";
let frame: { url: string },
  sender: { mainFrame: unknown; send: ReturnType<typeof vi.fn> };
function request(method: string, input?: unknown, overrides = {}) {
  return mock.handlers.get("chatgpt:request")!(
    { sender, senderFrame: frame, ...overrides },
    method,
    input,
  );
}
beforeEach(() => {
  mock.root = mkdtempSync(path.join(os.tmpdir(), "forge-chat-ipc-"));
  frame = { url: "http://127.0.0.1:5173/" };
  sender = { mainFrame: frame, send: vi.fn() };
  mock.confirm.mockReset().mockResolvedValue({ response: 0 });
  mock.catalog.mockReset().mockResolvedValue({
    connected: true,
    models: [{ slug: "shared", displayName: "Shared model" }],
  });
  mock.stream
    .mockReset()
    .mockImplementation(
      async (_model, _messages, _instructions, _signal, delta) =>
        delta("Hello"),
    );
  registerChatGptIpc(
    () => ({ webContents: sender, isDestroyed: () => false }) as never,
    () => ({ subscribe: mock.subscribe }) as never,
  );
});
afterEach(() => rmSync(mock.root, { recursive: true, force: true }));
async function thread() {
  const project = await request("project", {
    name: "Forge",
    instructions: "Be concise.",
  });
  return await request("create", { projectId: project.id, model: "shared" });
}
it("rejects untrusted pages and windows before using the shared runtime", async () => {
  await expect(request("state", undefined, { sender: {} })).rejects.toThrow(
    "Untrusted",
  );
  await expect(
    request("state", undefined, {
      senderFrame: { url: "https://evil.example" },
    }),
  ).rejects.toThrow("Untrusted");
});
it("fetches shared OpenAI models and routes messages and project instructions to that provider", async () => {
  await request("refreshModels");
  const chat = await thread();
  await request("send", { id: chat.id, text: "Hi", model: "shared" });
  expect(mock.stream).toHaveBeenCalledWith(
    "shared",
    [expect.objectContaining({ role: "user", text: "Hi" })],
    "Be concise.",
    expect.any(AbortSignal),
    expect.any(Function),
    expect.objectContaining({
      effort: "",
      speed: "normal",
      onActivity: expect.any(Function),
    }),
  );
  const state = await request("state");
  expect(state.connected).toBe(true);
  expect(state.models).toEqual([
    { slug: "shared", displayName: "Shared model" },
  ]);
  expect(state.threads[0].messages.at(-1)).toMatchObject({
    text: "Hello",
    status: "complete",
  });
  expect(state).not.toHaveProperty("accounts");
});
it("has no second sign-in or usage-management endpoint", async () => {
  for (const method of ["signIn", "signOut", "selectAccount", "usage"])
    await expect(request(method)).rejects.toThrow("Unknown");
});
it("keeps partial responses marked failed and rejects unavailable models", async () => {
  await request("refreshModels");
  const chat = await thread();
  await expect(
    request("send", { id: chat.id, text: "Hi", model: "other" }),
  ).rejects.toThrow("available");
  mock.stream.mockImplementationOnce(
    async (_model, _messages, _instructions, _signal, delta) => {
      delta("Partial");
      throw new Error("Disconnected");
    },
  );
  await request("send", { id: chat.id, text: "Hi", model: "shared" });
  expect((await request("state")).threads[0]).toMatchObject({
    error: "Disconnected",
    messages: [
      expect.anything(),
      expect.objectContaining({ text: "Partial", status: "failed" }),
    ],
  });
});
it("stops active responses and prevents deleting their project", async () => {
  await request("refreshModels");
  const chat = await thread();
  mock.stream.mockImplementationOnce(
    async (_model, _messages, _instructions, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("Stopped"))),
      ),
  );
  const sending = request("send", { id: chat.id, text: "Hi", model: "shared" });
  await expect(
    request("deleteProject", { id: chat.projectId }),
  ).rejects.toThrow("Stop this project's");
  expect(mock.confirm).not.toHaveBeenCalled();
  await request("stop", { id: chat.id });
  await sending;
  expect((await request("state")).threads[0].messages.at(-1).status).toBe(
    "stopped",
  );
});
it("confirms project deletion before removing its history", async () => {
  const chat = await thread();
  expect(await request("deleteProject", { id: chat.projectId })).toBe(false);
  expect((await request("state")).threads).toHaveLength(1);
  mock.confirm.mockResolvedValueOnce({ response: 1 });
  expect(await request("deleteProject", { id: chat.projectId })).toBe(true);
  expect((await request("state")).threads).toHaveLength(0);
});
it("disables Chat when the shared OpenAI connection is signed out", async () => {
  mock.catalog.mockResolvedValueOnce({
    connected: false,
    models: [],
    error: "Sign in under OpenAI",
  });
  await request("refreshModels");
  const chat = await thread();
  await expect(
    request("send", { id: chat.id, text: "Hi", model: "shared" }),
  ).rejects.toThrow("Global configuration → OpenAI");
});

it("imports files, permits attachment-only messages, and saves activity and timing with the reply", async () => {
  await request("refreshModels");
  const chat = await thread();
  const attachments = await request("attach", {
    id: chat.id,
    files: [{ name: "notes.txt", data: new TextEncoder().encode("Tuesday") }],
  });
  mock.stream.mockImplementationOnce(
    async (_model, _messages, _instructions, _signal, delta, options) => {
      options.onActivity([
        { id: "r", kind: "reasoning", text: "Reviewing notes." },
      ]);
      delta("Tuesday");
    },
  );
  await request("send", {
    id: chat.id,
    text: "",
    model: "shared",
    attachments,
  });
  const saved = (await request("state")).threads[0];
  expect(saved.title).toBe("notes.txt");
  expect(saved.messages[0]).toMatchObject({ text: "", attachments });
  expect(saved.messages[1]).toMatchObject({
    text: "Tuesday",
    activity: [{ id: "r", kind: "reasoning", text: "Reviewing notes." }],
    timing: { durationMs: expect.any(Number), completedAt: expect.any(Number) },
  });
  expect(mock.stream.mock.calls[0][1][0].attachments).toEqual(attachments);
});

it("rejects invalid attachments, unsupported model capabilities, and empty messages before creating a turn", async () => {
  mock.catalog.mockResolvedValueOnce({
    connected: true,
    models: [
      {
        slug: "shared",
        displayName: "Shared",
        images: false,
        efforts: ["low"],
        fast: false,
      },
    ],
  });
  await request("refreshModels");
  const chat = await thread();
  const send = (extra: Record<string, unknown>) =>
    request("send", { id: chat.id, text: "Hi", model: "shared", ...extra });
  await expect(send({ text: "" })).rejects.toThrow("Write a message");
  await expect(
    send({ attachments: [{ id: "../../secret", name: "x" }] }),
  ).rejects.toThrow("Invalid attachment");
  await expect(send({ effort: "high" })).rejects.toThrow("reasoning effort");
  await expect(send({ speed: "fast" })).rejects.toThrow("Fast speed");
  const attachments = await request("attach", {
    id: chat.id,
    files: [
      {
        name: "sample.png",
        data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      },
    ],
  });
  await expect(send({ attachments })).rejects.toThrow("image attachments");
  await expect(
    request("openAttachment", { id: chat.id, attachmentId: attachments[0].id }),
  ).rejects.toThrow("Unknown chat attachment");
  expect(mock.stream).not.toHaveBeenCalled();
  expect((await request("state")).threads[0].messages).toEqual([]);
});

it("stores generated images with their reply and serves only that chat's images for preview, open, and save", async () => {
  const { importAttachmentData } = await import(
    "../../electron/main/codex/files"
  );
  const { ChatStore } = await import("../../electron/main/chatgpt/store");
  const { readFileSync } = await import("node:fs");
  await request("refreshModels");
  const chat = await thread();
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const [image] = importAttachmentData(path.join(mock.root, "chatgpt"), [
    { name: "Generated image.png", data: bytes },
  ]);
  mock.stream.mockImplementationOnce(
    async (_model, _messages, _instructions, _signal, _delta, options) =>
      options.onImage(image),
  );
  await request("send", { id: chat.id, text: "A puppy", model: "shared" });
  const saved = new ChatStore(path.join(mock.root, "chatgpt"));
  expect(saved.get(chat.id).messages.at(-1)).toMatchObject({
    text: "",
    images: [image],
    status: "complete",
  });
  expect(
    await request("attachmentImage", { id: chat.id, attachmentId: image.id }),
  ).toBe(`data:image/png;base64,${Buffer.from(bytes).toString("base64")}`);
  const other = await thread();
  await expect(
    request("attachmentImage", { id: other.id, attachmentId: image.id }),
  ).rejects.toThrow("Unknown chat attachment");
  mock.openPath.mockResolvedValueOnce("");
  await request("openAttachment", { id: chat.id, attachmentId: image.id });
  expect(mock.openPath).toHaveBeenCalledWith(
    realpathSync(path.join(mock.root, "chatgpt/attachments", image.id)),
  );
  const destination = path.join(mock.root, "saved-image.png");
  mock.save.mockResolvedValueOnce({ canceled: false, filePath: destination });
  await request("saveAttachment", { id: chat.id, attachmentId: image.id });
  expect(readFileSync(destination)).toEqual(Buffer.from(bytes));
});
