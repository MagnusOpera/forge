import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  existsSync,
  copyFileSync,
  statSync,
  chmodSync,
} from "node:fs";
import path from "node:path";
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
  let loginId: string | null = null;
  const changed = (change: CodexChange) => {
    if (change.auth) loginId = null;
    window()?.webContents.send("codex:changed", change);
  };
  const attachmentPath = (attachment: CodexAttachment): string => {
    if (!/^[a-f0-9-]{36}(?:\.(?:png|jpg|webp|gif))?$/.test(attachment.id))
      throw new Error("Invalid attachment ID.");
    const file = path.join(store!.root, "attachments", attachment.id);
    if (!existsSync(file))
      throw new Error(
        `Image attachment ${attachment.name} is missing. Attach it again.`,
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
      );
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
        const restart = executable !== store.configuration.executable;
        store.configuration.defaults = defaults;
        store.configuration.executable = executable;
        store.saveConfiguration();
        if (restart) client.stop();
        changed({});
        return store.configuration;
      }
      if (method === "status")
        return { ...(await client.status()), loginPending: Boolean(loginId) };
      if (method === "cancelLogin") {
        if (loginId) await client.request("account/login/cancel", { loginId });
        loginId = null;
        changed({});
        return;
      }
      if (method === "models") return client.models();
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
        return manager.page(thread, input.before as number | undefined);
      }
      const attachments = (value: unknown): CodexAttachment[] => {
        if (!Array.isArray(value) || value.length > 20)
          throw new Error("Invalid image attachments.");
        return value.map((entry) => {
          const a = object(entry);
          const attachment = {
            id: string(a.id, "attachment ID"),
            name: string(a.name, "attachment name", 1024),
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
      if (method === "quickAction") {
        if (
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
      if (method === "openFolder") {
        await assertWorktree(thread);
        const error = await shell.openPath(thread.worktree);
        if (error) throw new Error(error);
        return;
      }
      if (method === "attach") {
        if (thread.archived)
          throw new Error("Restore the thread before attaching images.");
        const result = await dialog.showOpenDialog(target, {
          title: "Attach images",
          properties: ["openFile", "multiSelections"],
          filters: [
            {
              name: "Images",
              extensions: ["png", "jpg", "jpeg", "webp", "gif"],
            },
          ],
        });
        if (result.canceled) return [];
        const directory = path.join(store.root, "attachments");
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const selected: CodexAttachment[] = [];
        for (const file of result.filePaths.slice(0, 20)) {
          if (statSync(file).size > 20 * 1024 * 1024)
            throw new Error("Images must be 20 MB or smaller.");
          const data = readFileSync(file),
            header = data.subarray(0, 12);
          if (
            !(
              header
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
              header.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ||
              header.toString("ascii", 0, 3) === "GIF" ||
              (header.toString("ascii", 0, 4) === "RIFF" &&
                header.toString("ascii", 8, 12) === "WEBP")
            )
          )
            throw new Error("Unsupported image format.");
          const extension =
            header[0] === 137
              ? ".png"
              : header[0] === 255
                ? ".jpg"
                : header.toString("ascii", 0, 3) === "GIF"
                  ? ".gif"
                  : ".webp";
          const attachment = {
            id: `${randomUUID()}${extension}`,
            name: path.basename(file),
          };
          const destination = path.join(directory, attachment.id);
          copyFileSync(file, destination);
          chmodSync(destination, 0o600);
          selected.push(attachment);
        }
        return selected;
      }
      throw new Error("Unsupported Codex operation.");
    },
  );
  app.on("before-quit", () => manager?.flush());
}
