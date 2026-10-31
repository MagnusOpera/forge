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
import {
  checkEnvironment,
  remoteCheckoutPath,
  inferRemoteCheckoutPath,
  validateEnvironment,
} from "./remote.js";
import { CodexStore } from "./store.js";
import { terminalDimensions } from "../../../shared/terminal.js";
import { TerminalManager } from "./terminal.js";
import { ThreadManager } from "./threads.js";
import { assertWorktree, gitInfo, inspectRepository } from "./git.js";
import {
  validatePreferences,
  type CodexAttachment,
  type CodexChange,
  type CodexPreferences,
} from "../../../shared/codex.js";

import { CodexThreadWindows } from "./windows.js";
import type { CodexThreadWindow } from "../../../shared/codex.js";
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
export function registerCodexIpc(
  window: () => BrowserWindow | null,
  createThreadWindow?: (target: CodexThreadWindow) => BrowserWindow,
): { mainWindowClosed(): void } {
  let store: CodexStore | undefined,
    client: CodexClient | undefined,
    manager: ThreadManager | undefined,
    terminals: TerminalManager | undefined;
  let existing: ExistingThreads | undefined;
  const sourceHome = path.resolve(
    process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
  );
  const logins = new Map<string, string>();
  let loginStarting = false;
  const changed = (change: CodexChange) => {
    if (change.windowChanged && change.threadId)
      terminals?.detachThread(change.threadId);
    if (change.auth || (change.connectionError && !change.environmentId))
      logins.delete(change.accountId ?? "");
    windows.broadcast("codex:changed", change);
  };
  const windows = new CodexThreadWindows(window, createThreadWindow, changed);
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
        (repositoryId) => {
          const account = new CodexClient(
            path.join(store!.root, "accounts", repositoryId),
            () => store!.configuration.executable,
          );
          return { client: account, models: () => account.models() };
        },
      );
      existing = new ExistingThreads(manager, sourceHome);
      terminals = new TerminalManager(
        (event) => windows.broadcast("codex:terminal", event),
        undefined,
        (thread) => manager!.validateCheckout(thread),
      );
    }
    return { store, client: client!, manager: manager!, terminals: terminals! };
  };
  ipcMain.handle(
    "codex:request",
    async (event, method: unknown, raw: unknown) => {
      const target = windows.windowFor(event.sender);
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
        { store, client, manager, terminals } = services();
      const context = windows.context(event.sender);
      if (
        context &&
        ((input.repositoryId !== undefined &&
          input.repositoryId !== context.repositoryId) ||
          (input.id !== undefined && input.id !== context.id))
      )
        throw new Error("This thread window cannot access another thread.");
      if (method === "threadWindows") return windows.list();
      if (method === "threadWindowContext") return context;
      if (method === "cancelThreadWindowClose")
        return windows.cancelClose(event.sender);
      if (method === "closeThreadWindow") return windows.close(event.sender);
      if (method === "openThreadWindow") {
        const projectId = repositoryId(input.repositoryId);
        const thread = store.get(projectId, string(input.id, "thread ID"));
        const fullName =
          store.configuration.projects[projectId]?.name ||
          (input.fullName === undefined
            ? projectId
            : string(input.fullName, "repository name"));
        if (
          input.terminalOpen !== undefined &&
          typeof input.terminalOpen !== "boolean"
        )
          throw new Error("Invalid terminal visibility.");
        windows.open({
          repositoryId: projectId,
          id: thread.id,
          title: thread.title,
          fullName,
          defaultBranch:
            input.defaultBranch == null
              ? undefined
              : string(input.defaultBranch, "default branch"),
          terminalOpen: input.terminalOpen === true,
        });
        return;
      }
      if (input.id !== undefined) {
        const owner = windows.owner({
          repositoryId: repositoryId(input.repositoryId),
          id: string(input.id, "thread ID"),
        });
        const readOnly = [
          "thread",
          "models",
          "git",
          "outputFile",
          "terminalDetach",
          "terminalAck",
        ].includes(String(method));
        const metadataOnly =
          method === "update" &&
          input.draft === undefined &&
          input.draftAttachments === undefined &&
          input.settings === undefined;
        if (
          owner &&
          owner.webContents !== event.sender &&
          !readOnly &&
          !metadataOnly
        )
          throw new Error(
            "This thread is open in another window. Focus that window to continue.",
          );
      }
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
        const sendShortcut =
          input.sendShortcut ?? store.configuration.sendShortcut ?? "enter";
        if (sendShortcut !== "enter" && sendShortcut !== "command-enter")
          throw new Error("Invalid send shortcut.");
        const restart = executable !== store.configuration.executable;
        store.configuration.defaults = defaults;
        store.configuration.executable = executable;
        store.configuration.editor = editor;
        store.configuration.sendShortcut = sendShortcut;
        store.saveConfiguration();
        if (restart) {
          client.stop();
          manager.stopExternalRuntimes();
        }
        changed({});
        return store.configuration;
      }
      if (method === "checkEnvironment") {
        return checkEnvironment(
          validateEnvironment(input.environment),
          input.repositoryPath === undefined
            ? undefined
            : remoteCheckoutPath(input.repositoryPath),
        );
      }
      if (method === "saveEnvironments") {
        if (
          !Array.isArray(input.environments) ||
          input.environments.length > 100
        )
          throw new Error("Invalid environments.");
        const environments = input.environments.map(validateEnvironment);
        if (
          new Set(environments.map((entry) => entry.id)).size !==
          environments.length
        )
          throw new Error("Environment IDs must be unique.");
        store.configuration.environments = environments;
        for (const project of Object.values(store.configuration.projects)) {
          if (
            project.defaultEnvironment &&
            project.defaultEnvironment !== "local" &&
            !environments.some(
              (entry) => entry.id === project.defaultEnvironment,
            )
          )
            project.defaultEnvironment = "local";
          if (project.remotePaths)
            project.remotePaths = Object.fromEntries(
              Object.entries(project.remotePaths).filter(([id]) =>
                environments.some((entry) => entry.id === id),
              ),
            );
        }
        store.saveConfiguration();
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
      const accountMethods = ["status", "login", "logout", "cancelLogin"];
      const accountId =
        accountMethods.includes(String(method)) &&
        input.repositoryId !== undefined
          ? repositoryId(input.repositoryId)
          : undefined;
      const account = accountId
        ? (manager.accountRuntime(accountId).client as CodexClient)
        : client;
      const loginKey = accountId ?? "";
      if (method === "status")
        return {
          ...(await account.status()),
          loginPending: logins.has(loginKey),
        };
      if (method === "cancelLogin") {
        const loginId = logins.get(loginKey);
        if (loginId) await account.request("account/login/cancel", { loginId });
        logins.delete(loginKey);
        changed({ accountId });
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
        return input.repositoryId !== undefined &&
          (input.accountOverride === true ||
            (input.accountOverride === undefined &&
              store.configuration.projects[repositoryId(input.repositoryId)]
                ?.accountOverride))
          ? manager.accountRuntime(repositoryId(input.repositoryId)).models()
          : client.models();
      }
      if (method === "login") {
        if (manager.hasActiveAccount(accountId))
          throw new Error(
            "Stop threads using this Codex account before signing in.",
          );
        if (logins.size || loginStarting)
          throw new Error(
            "Complete or cancel the current Codex sign-in first.",
          );
        loginStarting = true;
        let loginId = "";
        try {
          await account.start();
          const result = object(
            await account.request("account/login/start", {
              type: "chatgpt",
              appBrand: "codex",
            }),
          );
          loginId = text(result.loginId);
          const url = new URL(text(result.authUrl));
          if (
            url.protocol !== "https:" ||
            url.username ||
            url.password ||
            !(
              url.hostname === "openai.com" ||
              url.hostname.endsWith(".openai.com") ||
              url.hostname === "chatgpt.com" ||
              url.hostname.endsWith(".chatgpt.com")
            )
          )
            throw new Error("Codex returned an invalid sign-in URL.");
          if (loginId) logins.set(loginKey, loginId);
          await shell.openExternal(url.toString());
        } catch (error) {
          logins.delete(loginKey);
          if (loginId)
            await account
              .request("account/login/cancel", { loginId })
              .catch(() => undefined);
          throw error;
        } finally {
          loginStarting = false;
        }
        return;
      }
      if (method === "logout") {
        if (manager.hasActiveAccount(accountId))
          throw new Error(
            "Stop threads using this Codex account before signing out.",
          );
        await account.start();
        await account.request("account/logout", {});
        logins.delete(loginKey);
        changed({ accountId });
        return;
      }
      const projectId = repositoryId(input.repositoryId);
      if (method === "checkProjectCheckout") {
        const project = store.configuration.projects[projectId];
        const environmentId = string(input.environmentId, "environment ID");
        try {
          if (environmentId === "local") {
            if (!project?.path)
              return {
                ready: false,
                message: "Choose a local checkout in project configuration.",
              };
            await inspectRepository(project.path, project.name ?? "");
            return { ready: true, message: "Local checkout is ready." };
          }
          const environment = store.configuration.environments?.find(
            (entry) => entry.id === environmentId,
          );
          const folder = project?.remotePaths?.[environmentId];
          if (!environment || !folder)
            return {
              ready: false,
              message:
                "Configure this environment's checkout in project configuration.",
            };
          return await checkEnvironment(environment, folder);
        } catch (error) {
          return {
            ready: false,
            message: error instanceof Error ? error.message : String(error),
          };
        }
      }
      if (method === "inferRemotePath")
        return inferRemoteCheckoutPath(
          store.configuration.projects[projectId]?.path,
          os.homedir(),
        );
      if (method === "saveProject") {
        const project = {
          ...(store.configuration.projects[projectId] ?? {
            repositoryId: projectId,
            path: "",
            overrides: {},
          }),
        };
        if (input.fullName !== undefined)
          project.name = string(input.fullName, "GitHub repository name");
        project.overrides = validatePreferences(input.overrides, true);
        if (input.accountOverride !== undefined) {
          if (typeof input.accountOverride !== "boolean")
            throw new Error("Invalid Codex account override.");
          project.accountOverride = input.accountOverride;
        }
        if (input.remotePaths !== undefined) {
          const placements: Record<string, string> = {};
          for (const [id, folder] of Object.entries(
            object(input.remotePaths),
          )) {
            if (
              !store.configuration.environments?.some(
                (entry) => entry.id === id,
              )
            )
              throw new Error("Unknown environment in project placement.");
            if (folder === "") continue;
            placements[id] = remoteCheckoutPath(folder);
          }
          project.remotePaths = placements;
        }
        if (input.defaultEnvironment !== undefined) {
          const id = string(input.defaultEnvironment, "default environment");
          if (
            id !== "local" &&
            (!store.configuration.environments?.some(
              (entry) => entry.id === id,
            ) ||
              !project.remotePaths?.[id])
          )
            throw new Error(
              "Configure a checkout for the default environment first.",
            );
          project.defaultEnvironment = id;
        }
        if (
          project.defaultEnvironment &&
          project.defaultEnvironment !== "local" &&
          !project.remotePaths?.[project.defaultEnvironment]
        )
          throw new Error(
            "Choose another default environment before removing its checkout.",
          );
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
          name: fullName,
          overrides: previous?.overrides ?? {},
          remotePaths: previous?.remotePaths,
          accountOverride: previous?.accountOverride,
          defaultEnvironment: previous?.defaultEnvironment,
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
      if (
        thread.environment &&
        [
          "git",
          "checkout",
          "resolveMergeConflicts",
          "quickAction",
          "openFolder",
          "openEditor",
          "outputFile",
          "attach",
        ].includes(String(method))
      ) {
        throw new Error(
          "This action is unavailable for remote threads. Use Codex or the remote terminal.",
        );
      }
      if (method === "setEnvironment")
        return manager.setEnvironment(
          thread,
          string(input.environmentId, "environment ID"),
        );
      if (method === "reconnect") return manager.reconnect(thread);
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
        if (thread.environment && Array.isArray(value) && value.length)
          throw new Error("Attachments are unavailable for remote threads.");
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
        if (update.archived === true) terminals.close(thread);
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
      if (method === "terminalOpen") {
        terminalDimensions(input.cols, input.rows);
        const attachmentId = string(
          input.attachmentId,
          "terminal attachment ID",
        );
        if (manager.isChangingCheckout(thread))
          throw new Error("Wait for the checkout change to finish.");
        if (!thread.worktree) await manager.prepareTerminalCheckout(thread);
        return terminals.open(thread, input.cols, input.rows, attachmentId);
      }
      if (
        [
          "terminalWrite",
          "terminalResize",
          "terminalAck",
          "terminalDetach",
          "terminalClose",
        ].includes(String(method))
      ) {
        const sessionId = string(input.sessionId, "terminal session ID");
        if (method === "terminalWrite") {
          if (manager.isChangingCheckout(thread))
            throw new Error("Wait for the checkout change to finish.");
          return terminals.write(thread, sessionId, input.data);
        }
        if (method === "terminalResize")
          return terminals.resize(thread, sessionId, input.cols, input.rows);
        if (method === "terminalAck")
          return terminals.acknowledge(
            thread,
            sessionId,
            input.sequence,
            string(input.attachmentId, "terminal attachment ID"),
          );
        if (method === "terminalDetach")
          return terminals.detach(
            thread,
            sessionId,
            string(input.attachmentId, "terminal attachment ID"),
          );
        return terminals.terminate(thread, sessionId);
      }
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
      if (method === "checkout") {
        if (input.action !== "merge" && input.action !== "worktree")
          throw new Error("Invalid checkout action.");
        return manager.checkout(thread, input.action, async (title, detail) => {
          const result = await dialog.showMessageBox(target, {
            type: "question",
            title,
            message: title,
            detail:
              detail +
              (terminals.has(thread.id)
                ? "\n\nThis will end this chat's terminal session and its running commands."
                : ""),
            buttons: [
              "Cancel",
              input.action === "merge"
                ? "Merge and continue"
                : "Start worktree",
            ],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          if (result.response === 1) terminals.close(thread);
          return result.response === 1;
        });
      }
      if (method === "resolveMergeConflicts") return manager.resolveMergeConflicts(thread);
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
        if (input.action === "open") {
          const error = await shell.openPath(file);
          if (error) throw new Error(error);
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
  app.on("before-quit", () => {
    windows.quitting = true;
    terminals?.dispose();
    manager?.flush();
  });
  return {
    mainWindowClosed: () =>
      terminals?.detachAll(windows.list().map((target) => target.id)),
  };
}
