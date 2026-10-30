import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { randomUUID } from "node:crypto";
import {
  importAttachments,
  resolveOutputFile,
  imageExtension,
  MAX_ATTACHMENT_BYTES,
} from "./files.js";
import { readFileSync, existsSync, copyFileSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { openInTextEditor, validateEditor } from "./editor.js";
import { ExistingThreads } from "./existing.js";
import { CodexClient, object, text } from "./client.js";
import { CodexStore } from "./store.js";
import { ThreadManager } from "./threads.js";
import { assertWorktree, gitInfo, inspectRepository } from "./git.js";
import {
  validatePreferences,
  type CodexAttachment,
  type CodexChange,
  type CodexPreferences,
} from "../../../shared/codex.js";

import { trustedCodexSenderUrl } from "./validation.js";

function string(value: unknown, name: string, max = 200): string {
  if (typeof value !== "string" || value.length > max || value.includes("\0"))
    throw new Error(`Invalid ${name}.`);
  return value;
}
function repositoryId(value: unknown): string {
  const id = string(value, "repository ID");
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9_=-]*$/.test(id) ||
    ["constructor", "prototype", "__proto__"].includes(id)
  )
    throw new Error("Invalid repository ID.");
  return id;
}
export function registerCodexIpc(window: () => BrowserWindow | null): void {
  let store: CodexStore | undefined,
    client: CodexClient | undefined,
    manager: ThreadManager | undefined;
  let existing: ExistingThreads | undefined;
  const sourceHome = path.resolve(
    process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
  );
  let loginId: string | null = null;
  const changed = (change: CodexChange) => {
    if (change.auth) loginId = null;
    window()?.webContents.send("codex:changed", change);
  };
  const attachmentPath = (attachment: CodexAttachment): string => {
    if (!/^[a-f0-9-]{36}(?:\.[a-z0-9.]{1,15})?$/.test(attachment.id))
      throw new Error("Invalid attachment ID.");
    const file = path.join(store!.root, "attachments", attachment.id);
    if (!existsSync(file))
      throw new Error(
        `Attachment ${attachment.name} is missing. Attach it again.`,
      );
    return file;
  };
  const services = () => {
    if (!store) {
      store = new CodexStore(path.join(app.getPath("userData"), "codex"));
      client = new CodexClient(
        path.join(store.root, "home"),
        () => store!.configuration.executable,
      );
      manager = new ThreadManager(
        store,
        client,
        () => client!.models(),
        changed,
        attachmentPath,
        (home) => {
          const external = new CodexClient(
            home,
            () => store!.configuration.executable,
            30_000,
            true,
          );
          return { client: external, models: () => external.models() };
        },
      );
      existing = new ExistingThreads(manager, sourceHome);
    }
    return { store, client: client!, manager: manager! };
  };
  ipcMain.handle(
    "codex:request",
    async (event, method: unknown, raw: unknown) => {
      const target = window();
      if (
        !target ||
        event.sender !== target.webContents ||
        event.senderFrame !== target.webContents.mainFrame ||
        !trustedCodexSenderUrl(
          event.senderFrame.url,
          app.isPackaged,
          app.getAppPath(),
          process.env.VITE_DEV_SERVER_URL,
        )
      )
        throw new Error("Untrusted Codex caller.");
      const input = object(raw),
        { store, client, manager } = services();
      if (method === "openLink") {
        const url = new URL(string(input.url, "link", 8192));
        if (
          !["https:", "http:"].includes(url.protocol) ||
          url.username ||
          url.password
        )
          throw new Error("Only HTTP and HTTPS links can be opened.");
        await shell.openExternal(url.toString());
        return;
      }
      if (method === "configuration") return store.configuration;
      if (method === "saveConfiguration") {
        const defaults = validatePreferences(
          input.defaults,
        ) as CodexPreferences;
        const executable = string(
          input.executable,
          "Codex executable",
          4096,
        ).trim();
        if (executable && !path.isAbsolute(executable))
          throw new Error("Codex executable must be an absolute path.");
        if (
          executable !== store.configuration.executable &&
          manager.hasActive()
        )
          throw new Error(
            "Stop active threads before changing the Codex executable.",
          );
        const editor =
          input.editor === undefined
            ? store.configuration.editor
            : validateEditor(input.editor);
        const restart = executable !== store.configuration.executable;
        store.configuration.defaults = defaults;
        store.configuration.executable = executable;
        store.configuration.editor = editor;
        store.saveConfiguration();
        if (restart) {
          client.stop();
          manager.stopExternalRuntimes();
        }
        changed({});
        return store.configuration;
      }
      if (method === "pickEditor") {
        const result = await dialog.showOpenDialog(target, {
          title: "Choose text editor application",
          defaultPath: "/Applications",
          properties: ["openFile"],
          filters: [{ name: "Applications", extensions: ["app"] }],
        });
        if (result.canceled || !result.filePaths[0]) return null;
        const selected = result.filePaths[0];
        if (
          !path.isAbsolute(selected) ||
          !selected.endsWith(".app") ||
          !statSync(selected).isDirectory()
        )
          throw new Error("Choose a macOS text editor application (.app).");
        return validateEditor(selected);
      }
      if (method === "status")
        return { ...(await client.status()), loginPending: Boolean(loginId) };
      if (method === "cancelLogin") {
        if (loginId) await client.request("account/login/cancel", { loginId });
        loginId = null;
        changed({});
        return;
      }
      if (method === "models") {
        if (input.id !== undefined)
          return manager.threadModels(
            store.get(
              repositoryId(input.repositoryId),
              string(input.id, "thread ID"),
            ),
          );
        return client.models();
      }
      if (method === "login") {
        await client.start();
        const result = object(
          await client.request("account/login/start", {
            type: "chatgpt",
            appBrand: "codex",
          }),
        );
        loginId = text(result.loginId) || null;
        const url = new URL(text(result.authUrl));
        if (
          url.protocol !== "https:" ||
          !(
            url.hostname === "openai.com" ||
            url.hostname.endsWith(".openai.com") ||
            url.hostname === "chatgpt.com" ||
            url.hostname.endsWith(".chatgpt.com")
          )
        )
          throw new Error("Codex returned an invalid sign-in URL.");
        await shell.openExternal(url.toString());
        return;
      }
      if (method === "logout") {
        if (manager.hasActive())
          throw new Error("Stop active Codex threads before signing out.");
        await client.start();
        await client.request("account/logout", {});
        changed({});
        return;
      }
      const projectId = repositoryId(input.repositoryId);
      if (method === "saveProject") {
        const project = store.configuration.projects[projectId] ?? {
          repositoryId: projectId,
          path: "",
          overrides: {},
        };
        project.overrides = validatePreferences(input.overrides, true);
        store.configuration.projects[projectId] = project;
        store.saveConfiguration();
        changed({ repositoryId: projectId });
        return store.configuration;
      }
      if (method === "pickFolder") {
        const fullName = string(input.fullName, "GitHub repository name");
        const result = await dialog.showOpenDialog(target, {
          title: "Select local Git folder",
          properties: ["openDirectory"],
        });
        if (result.canceled || !result.filePaths[0]) return store.configuration;
        const inspected = await inspectRepository(
          result.filePaths[0],
          fullName,
        );
        const previous = store.configuration.projects[projectId];
        store.configuration.projects[projectId] = {
          repositoryId: projectId,
          overrides: previous?.overrides ?? {},
          ...inspected,
        };
        store.saveConfiguration();
        changed({ repositoryId: projectId });
        return store.configuration;
      }
      if (method === "existing") {
        if (input.archived !== undefined && typeof input.archived !== "boolean")
          throw new Error("Invalid archive filter.");
        return existing!.list(
          projectId,
          input.cursor === undefined
            ? undefined
            : string(input.cursor, "thread cursor", 4096),
          input.archived === true,
        );
      }
      if (method === "adopt") {
        const serverId = string(input.serverId, "Codex thread ID");
        if (!/^[a-zA-Z0-9_-]+$/.test(serverId))
          throw new Error("Invalid Codex thread ID.");
        if (typeof input.archived !== "boolean")
          throw new Error("Invalid archive state.");
        return existing!.adopt(projectId, serverId, input.archived);
      }
      if (method === "list") return store.list(projectId);
      if (method === "create") return manager.create(projectId);
      const id = string(input.id, "thread ID");
      const thread = store.get(projectId, id);
      if (method === "thread") {
        if (
          input.before !== undefined &&
          (!Number.isInteger(input.before) || Number(input.before) < 0)
        )
          throw new Error("Invalid history cursor.");
        void manager.refreshMessageMetadata(thread);
        return manager.page(thread, input.before as number | undefined);
      }
      const attachments = (value: unknown): CodexAttachment[] => {
        if (!Array.isArray(value) || value.length > 20)
          throw new Error("Invalid attachments.");
        return value.map((entry) => {
          const a = object(entry);
          const attachment: CodexAttachment = {
            id: string(a.id, "attachment ID"),
            name: string(a.name, "attachment name", 1024),
            ...(a.kind === "image" || a.kind === "document"
              ? { kind: a.kind }
              : {}),
          };
          attachmentPath(attachment);
          return attachment;
        });
      };
      if (method === "update") {
        const update: Parameters<ThreadManager["update"]>[1] = {};
        if (input.title !== undefined)
          update.title = string(input.title, "thread title");
        if (input.archived !== undefined) {
          if (typeof input.archived !== "boolean")
            throw new Error("Invalid archive state.");
          update.archived = input.archived;
        }
        if (input.settings !== undefined)
          update.settings = validatePreferences(
            input.settings,
          ) as CodexPreferences;
        if (input.draft !== undefined)
          update.draft = string(input.draft, "draft", 1_000_000);
        if (input.draftAttachments !== undefined)
          update.draftAttachments = attachments(input.draftAttachments);
        manager.update(thread, update);
        return;
      }
      if (method === "send")
        return manager.send(thread, {
          id: randomUUID(),
          text: string(input.text, "message", 1_000_000),
          attachments: attachments(input.attachments),
        });
      if (method === "replaceMessage")
        return manager.replaceMessage(
          thread,
          string(input.messageId, "message ID"),
          {
            id: randomUUID(),
            text: string(input.text, "message", 1_000_000),
            attachments: attachments(input.attachments),
          },
        );
      if (method === "quickAction") {
        if (
          input.action !== "sync" &&
          input.action !== "commit" &&
          input.action !== "push" &&
          input.action !== "create-pr"
        )
          throw new Error("Unsupported Codex Git action.");
        return manager.quickAction(thread, input.action);
      }
      if (method === "stop") return manager.stop(thread);
      if (method === "answer") {
        if (
          typeof input.requestId !== "string" &&
          typeof input.requestId !== "number"
        )
          throw new Error("Invalid request ID.");
        if (input.approve !== undefined && typeof input.approve !== "boolean")
          throw new Error("Invalid approval decision.");
        const answers =
          input.answers === undefined
            ? undefined
            : Object.fromEntries(
                Object.entries(object(input.answers)).map(([key, value]) => [
                  key,
                  string(value, "answer", 100_000),
                ]),
              );
        return manager.answer(
          thread,
          input.requestId,
          answers,
          input.approve as boolean | undefined,
        );
      }
      if (method === "queue")
        return manager.queue(
          thread,
          string(input.action, "queue action"),
          input.messageId === undefined
            ? undefined
            : string(input.messageId, "message ID"),
          input.text === undefined
            ? undefined
            : string(input.text, "queued message", 1_000_000),
        );
      if (method === "git") return gitInfo(thread);
      if (method === "openEditor") {
        await assertWorktree(thread);
        await openInTextEditor(thread.worktree, store.configuration.editor);
        return;
      }
      if (method === "openFolder") {
        await assertWorktree(thread);
        const error = await shell.openPath(thread.worktree);
        if (error) throw new Error(error);
        return;
      }
      if (method === "outputFile") {
        const file = resolveOutputFile(
          string(input.href, "file link", 8192),
          thread.worktree,
          path.join(store.root, "attachments"),
        );
        if (input.action === "reveal") {
          shell.showItemInFolder(file);
          return null;
        }
        if (input.action === "save") {
          const result = await dialog.showSaveDialog(target, {
            title: "Save document",
            defaultPath: path.basename(file),
          });
          if (!result.canceled && result.filePath)
            copyFileSync(file, result.filePath);
          return null;
        }
        if (input.action === "image") {
          if (statSync(file).size > MAX_ATTACHMENT_BYTES)
            throw new Error("Image is too large to preview.");
          const data = readFileSync(file),
            extension = imageExtension(data);
          if (!extension) throw new Error("Unsupported image format.");
          return `data:image/${extension === ".jpg" ? "jpeg" : extension.slice(1)};base64,${data.toString("base64")}`;
        }
        throw new Error("Unsupported file action.");
      }
      if (method === "attach") {
        if (thread.archived)
          throw new Error("Restore the thread before attaching files.");
        let files: string[];
        if (input.paths !== undefined) {
          if (!Array.isArray(input.paths) || input.paths.length > 20)
            throw new Error("Invalid attachments.");
          files = input.paths.map((file) =>
            string(file, "attachment path", 8192),
          );
        } else {
          const result = await dialog.showOpenDialog(target, {
            title: "Attach documents or images",
            properties: ["openFile", "multiSelections"],
          });
          if (result.canceled) return [];
          files = result.filePaths;
        }
        return importAttachments(store.root, files);
      }
      throw new Error("Unsupported Codex operation.");
    },
  );
  app.on("before-quit", () => manager?.flush());
}
