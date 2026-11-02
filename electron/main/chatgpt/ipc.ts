import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import { readFileSync, copyFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type {
  ChatMessage,
  ChatRequests,
  ChatState,
} from "../../../shared/chatgpt.js";
import { trustedCodexSenderUrl } from "../codex/validation.js";
import { ChatStore } from "./store.js";
import { chatAttachmentPath, chatAttachments } from "./attachments.js";
import {
  imageExtension,
  importAttachmentData,
  importAttachments,
} from "../codex/files.js";
import { requiredText } from "./protocol.js";
import { ChatProvider, type ChatRuntime } from "./provider.js";

export function registerChatGptIpc(
  mainWindow: () => BrowserWindow | null,
  runtime: () => ChatRuntime,
) {
  let store: ChatStore | undefined, provider: ChatProvider | undefined;
  let models: ChatState["models"] = [],
    connected = false,
    error: string | undefined;
  let catalogVersion = 0;
  let unsubscribe: (() => void) | undefined;
  const running = new Map<string, AbortController>();
  const services = () => {
    const root = path.join(app.getPath("userData"), "chatgpt");
    store ??= new ChatStore(root);
    provider ??= new ChatProvider(runtime, path.join(root, "workspace"));
    return { store, provider };
  };
  const snapshot = (): ChatState => {
    const { store } = services();
    return {
      projects: store.projects,
      threads: store.threads,
      connected,
      models,
      error,
    };
  };
  function changed() {
    const window = mainWindow();
    if (window && !window.isDestroyed())
      window.webContents.send("chatgpt:changed", snapshot());
  }
  async function refreshModels() {
    const version = ++catalogVersion;
    if (!unsubscribe)
      unsubscribe = runtime().subscribe((event) => {
        if (
          event.method === "account/updated" ||
          event.method === "account/login/completed" ||
          event.method === "connection/failed"
        ) {
          models = [];
          connected = false;
          error = undefined;
          changed();
          if (event.method !== "connection/failed")
            void refreshModels().catch((e) => {
              error =
                e instanceof Error
                  ? e.message
                  : "Unable to refresh OpenAI models.";
              changed();
            });
        }
      });
    const catalog = await services().provider.catalog();
    if (version !== catalogVersion) return;
    models = catalog.models;
    connected = catalog.connected;
    error = catalog.error;
    changed();
  }
  async function send(input: ChatRequests["send"]["input"]) {
    const { store, provider } = services();
    const thread = store.get(input.id);
    if (running.has(thread.id))
      throw new Error("This thread is already responding.");
    const attachments = chatAttachments(store.root, input.attachments);
    const text = input.text.trim();
    if (!text && !attachments.length)
      throw new Error("Write a message or attach a file.");
    const model = requiredText(input.model, "model");
    if (!connected)
      throw new Error(
        "Sign in under Global configuration → OpenAI to use Chat.",
      );
    if (!models.some((m) => m.slug === model))
      throw new Error(
        "Choose an available OpenAI model. Reopen Chat to refresh the model catalog.",
      );
    const selectedModel = models.find((m) => m.slug === model)!;
    const effort = input.effort ?? "";
    if (effort && !selectedModel.efforts?.includes(effort))
      throw new Error("Choose an available reasoning effort.");
    if (input.speed === "fast" && !selectedModel.fast)
      throw new Error("Fast speed is unavailable for this model.");
    if (
      attachments.some((a) => a.kind === "image") &&
      selectedModel.images === false
    )
      throw new Error("This model does not support image attachments.");
    const controller = new AbortController();
    running.set(thread.id, controller);
    thread.model = model;
    thread.effort = effort;
    thread.speed = input.speed ?? "normal";
    if (!thread.messages.length)
      thread.title = (text || attachments[0].name).slice(0, 80);
    thread.messages.push({
      id: randomUUID(),
      role: "user",
      text,
      attachments,
      status: "complete",
    });
    const messages = [...thread.messages];
    const reply: ChatMessage = {
      id: randomUUID(),
      role: "assistant" as const,
      text: "",
      timing: { startedAt: Date.now() },
      status: "streaming" as "streaming" | "complete" | "stopped" | "failed",
    };
    thread.messages.push(reply);
    thread.updatedAt = Date.now();
    thread.error = undefined;
    try {
      store.save();
      changed();
      let published = 0;
      const publishProgress = () => {
        if (Date.now() - published > 50) {
          published = Date.now();
          changed();
        }
      };
      await provider.stream(
        model,
        messages,
        store.projects.find((p) => p.id === thread.projectId)?.instructions ??
          "",
        AbortSignal.any([controller.signal, AbortSignal.timeout(15 * 60_000)]),
        (delta) => {
          reply.text += delta;
          publishProgress();
        },
        {
          effort,
          speed: thread.speed,
          onImage: (image) => {
            (reply.images ??= []).push(image);
            store.save();
            changed();
          },
          onActivity: (items) => {
            reply.activity = items;
            publishProgress();
          },
        },
      );
      reply.status = "complete";
    } catch (e) {
      reply.status = controller.signal.aborted ? "stopped" : "failed";
      thread.error = controller.signal.aborted
        ? undefined
        : e instanceof Error
          ? e.message
          : "OpenAI request failed.";
    } finally {
      reply.timing!.completedAt = Date.now();
      reply.timing!.durationMs =
        reply.timing!.completedAt - reply.timing!.startedAt!;
      running.delete(thread.id);
      thread.updatedAt = Date.now();
      store.save();
      changed();
    }
  }
  ipcMain.handle(
    "chatgpt:request",
    async (event, method: keyof ChatRequests, raw: unknown) => {
      const window = mainWindow();
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== event.sender.mainFrame ||
        !trustedCodexSenderUrl(
          event.senderFrame.url,
          app.isPackaged,
          app.getAppPath(),
          process.env.VITE_DEV_SERVER_URL,
        )
      )
        throw new Error("Untrusted ChatGPT request.");
      if (typeof method !== "string")
        throw new Error("Invalid ChatGPT request.");
      const input = (
        raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}
      ) as Record<string, unknown>;
      const { store } = services();
      switch (method) {
        case "state":
          return snapshot();
        case "refreshModels":
          await refreshModels();
          return;
        case "openLink": {
          const url = new URL(requiredText(input.url, "link", 8192));
          if (!["https:", "http:"].includes(url.protocol))
            throw new Error("Unsupported link.");
          await shell.openExternal(url.href);
          return;
        }
        case "project": {
          const project = store.project({
            id:
              input.id === undefined
                ? undefined
                : requiredText(input.id, "project"),
            name: requiredText(input.name, "project name", 100),
            instructions:
              typeof input.instructions === "string" ? input.instructions : "",
          });
          changed();
          return project;
        }
        case "reorderProjects":
          store.reorderProjects(
            requiredText(input.sourceId, "source project"),
            requiredText(input.targetId, "target project"),
          );
          changed();
          return;
        case "deleteProject": {
          const id = requiredText(input.id, "project");
          const project = store.projects.find((p) => p.id === id);
          if (!project) throw new Error("Unknown ChatGPT project.");
          const assertIdle = () => {
            if (
              store.threads.some((t) => t.projectId === id && running.has(t.id))
            )
              throw new Error(
                "Stop this project's active responses before deleting it.",
              );
          };
          assertIdle();
          const count = store.threads.filter((t) => t.projectId === id).length;
          const result = await dialog.showMessageBox(window, {
            type: "warning",
            title: "Delete ChatGPT project",
            message: `Delete “${project.name}”?`,
            detail: `This permanently deletes the project and its ${count} ${count === 1 ? "thread" : "threads"} from this Mac. Detached conversations in this project will close.`,
            buttons: ["Cancel", "Delete project"],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          if (result.response !== 1) return false;
          assertIdle();
          store.deleteProject(id);
          changed();
          return true;
        }
        case "create": {
          const thread = store.create(
            requiredText(input.projectId, "project"),
            typeof input.model === "string" ? input.model.slice(0, 200) : "",
          );
          changed();
          return thread;
        }
        case "rename": {
          const thread = store.get(requiredText(input.id, "chat"));
          thread.title = requiredText(input.title, "title");
          store.save();
          changed();
          return;
        }
        case "delete": {
          const id = requiredText(input.id, "chat");
          if (running.has(id))
            throw new Error("Stop this response before deleting the chat.");
          store.get(id);
          store.threads = store.threads.filter((t) => t.id !== id);
          store.save();
          changed();
          return;
        }
        case "attach": {
          store.get(requiredText(input.id, "chat"));
          if (input.files !== undefined) {
            if (input.paths !== undefined)
              throw new Error("Invalid attachments.");
            return importAttachmentData(store.root, input.files);
          }
          if (input.paths !== undefined) {
            if (!Array.isArray(input.paths) || input.paths.length > 20)
              throw new Error("Invalid attachments.");
            return importAttachments(
              store.root,
              input.paths.map((file) =>
                requiredText(file, "attachment path", 8192),
              ),
            );
          }
          const result = await dialog.showOpenDialog(
            BrowserWindow.getFocusedWindow() ?? window,
            {
              title: "Attach documents or images",
              properties: ["openFile", "multiSelections"],
            },
          );
          return result.canceled
            ? []
            : importAttachments(store.root, result.filePaths);
        }
        case "attachmentImage":
        case "saveAttachment":
        case "openAttachment": {
          const thread = store.get(requiredText(input.id, "chat"));
          const id = requiredText(input.attachmentId, "attachment ID");
          if (
            !thread.messages.some((m) =>
              [...(m.attachments ?? []), ...(m.images ?? [])].some(
                (a) => a.id === id,
              ),
            )
          )
            throw new Error("Unknown chat attachment.");
          const file = chatAttachmentPath(store.root, id);
          if (method === "attachmentImage") {
            const data = readFileSync(file),
              extension = imageExtension(data);
            if (!extension) throw new Error("Unsupported image format.");
            return `data:image/${extension === ".jpg" ? "jpeg" : extension.slice(1)};base64,${data.toString("base64")}`;
          }
          if (method === "saveAttachment") {
            const name = thread.messages
              .flatMap((m) => [...(m.attachments ?? []), ...(m.images ?? [])])
              .find((a) => a.id === id)!.name;
            const result = await dialog.showSaveDialog(
              BrowserWindow.getFocusedWindow() ?? window,
              { title: "Save image", defaultPath: path.basename(name) },
            );
            if (!result.canceled && result.filePath)
              copyFileSync(file, result.filePath);
            return;
          }
          const error = await shell.openPath(file);
          if (error) throw new Error(error);
          return;
        }
        case "send":
          return send({
            id: requiredText(input.id, "chat"),
            text:
              typeof input.text === "string" &&
              input.text.length <= 100_000 &&
              !input.text.includes("\0")
                ? input.text
                : (() => {
                    throw new Error("Invalid message.");
                  })(),
            model: requiredText(input.model, "model"),
            attachments: chatAttachments(store.root, input.attachments),
            effort:
              input.effort === undefined || input.effort === ""
                ? ""
                : requiredText(input.effort, "reasoning effort"),
            speed:
              input.speed === undefined || input.speed === "normal"
                ? "normal"
                : input.speed === "fast"
                  ? "fast"
                  : (() => {
                      throw new Error("Invalid speed.");
                    })(),
          });
        case "stop":
          running.get(requiredText(input.id, "chat"))?.abort();
          return;
        default:
          throw new Error("Unknown ChatGPT request.");
      }
    },
  );
  app.on("before-quit", () => {
    for (const controller of running.values()) controller.abort();
    unsubscribe?.();
  });
}
