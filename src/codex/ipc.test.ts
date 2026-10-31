import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BrowserWindow } from "electron";
import { defaultCodexPreferences } from "../../shared/codex";
const mock = vi.hoisted(() => ({
  root: "",
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  quitting: [] as (() => void)[],
}));
vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => mock.root,
    getAppPath: () => "/forge",
    on: (_name: string, callback: () => void) => mock.quitting.push(callback),
  },
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) =>
      mock.handlers.set(name, handler),
  },
  shell: {
    openExternal: vi.fn(),
    openPath: vi.fn(),
    showItemInFolder: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn(),
  },
}));
import { shell, dialog } from "electron";
import * as remoteChecks from "../../electron/main/codex/remote";
import * as editorLauncher from "../../electron/main/codex/editor";
import { CodexStore } from "../../electron/main/codex/store";
import { git } from "../../electron/main/codex/git";
import { randomUUID } from "node:crypto";
import type { CodexThread } from "../../shared/codex";
import { CodexClient } from "../../electron/main/codex/client";
import { TerminalManager } from "../../electron/main/codex/terminal";
import { ThreadManager } from "../../electron/main/codex/threads";
import { registerCodexIpc } from "../../electron/main/codex/ipc";
let frame: { url: string };
let contents: { mainFrame: { url: string }; send: ReturnType<typeof vi.fn> };
function request(
  method: string,
  input: unknown = {},
  sender: unknown = contents,
) {
  return Promise.resolve(
    mock.handlers.get("codex:request")!(
      { sender, senderFrame: frame },
      method,
      input,
    ),
  );
}
beforeEach(() => {
  mock.root = mkdtempSync(path.join(os.tmpdir(), "forge-ipc-"));
  frame = { url: "http://127.0.0.1:5173/" };
  contents = { mainFrame: frame, send: vi.fn() };
  registerCodexIpc(
    () => ({ webContents: contents }) as unknown as BrowserWindow,
  );
});
afterEach(() => {
  mock.quitting.splice(0).forEach((quit) => quit());
  mock.handlers.clear();
  vi.restoreAllMocks();
  rmSync(mock.root, { recursive: true, force: true });
});
describe("Codex preload IPC handlers", () => {
  it("rejects other windows and a renderer navigated away from Forge", async () => {
    await expect(request("configuration", {}, {})).rejects.toThrow("Untrusted");
    frame.url = "https://example.invalid/";
    await expect(request("configuration")).rejects.toThrow("Untrusted");
  });
  it("validates global settings and stores independent project overrides", async () => {
    await expect(
      request("saveConfiguration", {
        defaults: { ...defaultCodexPreferences, permissions: "invalid" },
        executable: "",
      }),
    ).rejects.toThrow("permissions");
    await request("saveConfiguration", {
      defaults: { ...defaultCodexPreferences, effort: "high" },
      executable: "",
    });
    const configuration = await request("saveProject", {
      repositoryId: "R_123",
      overrides: { effort: "low", followUp: "queue" },
    });
    expect(configuration).toMatchObject({
      defaults: { effort: "high" },
      projects: { R_123: { overrides: { effort: "low", followUp: "queue" } } },
    });
    const reset = await request("saveProject", {
      repositoryId: "R_123",
      overrides: {},
    });
    expect(reset).toMatchObject({ projects: { R_123: { overrides: {} } } });
  });
  it("blocks prototype keys and threads outside the requested project", async () => {
    await expect(
      request("saveProject", { repositoryId: "__proto__", overrides: {} }),
    ).rejects.toThrow("repository ID");
    await expect(
      request("thread", { repositoryId: "R_123", id: "not-owned" }),
    ).rejects.toThrow("does not belong");
    await expect(
      request("resolveMergeConflicts", { repositoryId: "R_123", id: "not-owned" }),
    ).rejects.toThrow("does not belong");
    await expect(
      request("quickAction", {
        repositoryId: "R_123",
        id: "not-owned",
        action: "commit",
      }),
    ).rejects.toThrow("does not belong");
    await expect(
      request("openFolder", {
        repositoryId: "R_123",
        id: "not-owned",
        path: "/arbitrary",
      }),
    ).rejects.toThrow("does not belong");
  });
  it("validates existing-thread requests and never accepts renderer-supplied folders or homes", async () => {
    const rpc = vi.spyOn(CodexClient.prototype, "request");
    await expect(
      request("existing", { repositoryId: "R_123", archived: "yes" }),
    ).rejects.toThrow("archive filter");
    await expect(
      request("existing", { repositoryId: "R_123", cursor: 7 }),
    ).rejects.toThrow("cursor");
    await expect(
      request("adopt", {
        repositoryId: "R_123",
        serverId: "../sessions/other",
        archived: false,
      }),
    ).rejects.toThrow("thread ID");
    await expect(
      request("adopt", {
        repositoryId: "R_123",
        serverId: "valid-id",
        archived: "yes",
      }),
    ).rejects.toThrow("archive state");
    await expect(
      request("adopt", {
        repositoryId: "R_123",
        serverId: "valid-id",
        archived: false,
        cwd: "/arbitrary",
        home: "/arbitrary",
      }),
    ).rejects.toThrow("local Git folder");
    await expect(
      request("models", { repositoryId: "R_123", id: "not-owned" }),
    ).rejects.toThrow("does not belong");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("opens only the owned worktree using the current global editor preference", async () => {
    const folder = path.join(mock.root, "repository");
    mkdirSync(folder);
    await git(folder, ["init", "-b", "main"]);
    await git(folder, [
      "-c",
      "user.name=Forge test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "Initial",
    ]);
    const store = new CodexStore(path.join(mock.root, "codex"));
    const id = randomUUID(),
      now = new Date().toISOString();
    const thread: CodexThread = {
      id,
      repositoryId: "R_123",
      title: "Editor test",
      archived: false,
      createdAt: now,
      updatedAt: now,
      settings: defaultCodexPreferences,
      state: "idle",
      worktree: folder,
      branch: "main",
      baseCommit: (await git(folder, ["rev-parse", "HEAD"])).trim(),
      serverId: "",
      repositoryPath: folder,
      items: [],
      requests: [],
      queue: [],
      queuePaused: true,
      draft: "",
      draftAttachments: [],
    };
    store.saveThread(thread);
    const launch = vi
      .spyOn(editorLauncher, "openInTextEditor")
      .mockResolvedValue();
    await request("openEditor", {
      repositoryId: "R_123",
      id,
      path: "/untrusted",
      editor: "Untrusted app",
    });
    expect(launch).toHaveBeenLastCalledWith(folder, "Visual Studio Code");
    await request("saveConfiguration", {
      defaults: defaultCodexPreferences,
      executable: "",
      editor: "Cursor",
    });
    await request("openEditor", { repositoryId: "R_123", id });
    expect(launch).toHaveBeenLastCalledWith(folder, "Cursor");
    expect(
      new CodexStore(path.join(mock.root, "codex")).configuration.editor,
    ).toBe("Cursor");
    await expect(
      request("openEditor", { repositoryId: "OTHER", id }),
    ).rejects.toThrow("does not belong");
    expect(launch).toHaveBeenCalledTimes(2);
  });
  it("validates editor configuration and uses a native application picker without saving prematurely", async () => {
    const appPath = path.join(mock.root, "My Editor.app");
    mkdirSync(appPath);
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: [appPath],
    });
    expect(await request("pickEditor")).toBe(appPath);
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        filters: [{ name: "Applications", extensions: ["app"] }],
      }),
    );
    expect(await request("configuration")).toMatchObject({
      editor: "Visual Studio Code",
    });
    await expect(
      request("saveConfiguration", {
        defaults: defaultCodexPreferences,
        executable: "",
        editor: "/bin/sh",
      }),
    ).rejects.toThrow(".app path");
    expect(await request("configuration")).toMatchObject({
      editor: "Visual Studio Code",
    });
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: true,
      filePaths: [],
    });
    expect(await request("pickEditor")).toBeNull();
  });
  it("reports a missing CLI without disabling configuration", async () => {
    await request("saveConfiguration", {
      defaults: defaultCodexPreferences,
      executable: "/missing/forge-test-codex",
    });
    await expect(request("status")).resolves.toMatchObject({
      connected: false,
      authenticated: false,
      error: expect.stringContaining("not found"),
    });
    await expect(request("configuration")).resolves.toMatchObject({
      executable: "/missing/forge-test-codex",
    });
  });
  it("opens only valid Codex sign-in URLs and can cancel an outstanding login", async () => {
    vi.spyOn(CodexClient.prototype, "start").mockResolvedValue();
    const rpc = vi.spyOn(CodexClient.prototype, "request").mockResolvedValue({
      loginId: "login-1",
      authUrl: "https://auth.openai.com/authorize?state=test",
    });
    await request("login");
    expect(shell.openExternal).toHaveBeenCalledWith(
      "https://auth.openai.com/authorize?state=test",
    );
    await request("cancelLogin");
    expect(rpc).toHaveBeenCalledWith("account/login/cancel", {
      loginId: "login-1",
    });
    rpc.mockResolvedValue({
      loginId: "login-2",
      authUrl: "https://auth.openai.com.evil.invalid/",
    });
    await expect(request("login")).rejects.toThrow("invalid sign-in URL");
  });
  it("does not expose credentials or accept non-web external links", async () => {
    expect(JSON.stringify(await request("configuration"))).not.toContain(
      "token",
    );
    await expect(
      request("openLink", { url: "file:///etc/passwd" }),
    ).rejects.toThrow("Only HTTP");
    await expect(
      request("openLink", { url: "https://secret@example.invalid/" }),
    ).rejects.toThrow("Only HTTP");
  });
});

describe("Codex attachment and output IPC", () => {
  it("imports dropped documents, persists their kind, saves output files and rejects escapes", async () => {
    const store = new CodexStore(path.join(mock.root, "codex"));
    const folder = path.join(mock.root, "work");
    mkdirSync(folder);
    const id = randomUUID(),
      now = new Date().toISOString();
    store.saveThread({
      id,
      repositoryId: "R_123",
      title: "Files",
      archived: false,
      createdAt: now,
      updatedAt: now,
      settings: defaultCodexPreferences,
      state: "idle",
      worktree: folder,
      branch: "main",
      baseCommit: "",
      serverId: "",
      repositoryPath: folder,
      items: [],
      requests: [],
      queue: [],
      queuePaused: false,
      draft: "",
      draftAttachments: [],
    });
    const args = { repositoryId: "R_123", id };
    const source = path.join(mock.root, "spec.pdf");
    writeFileSync(source, "%PDF-1.7 fixture");
    const attachments = (await request("attach", {
      ...args,
      paths: [source],
    })) as { id: string; name: string; kind: string }[];
    expect(attachments[0]).toMatchObject({
      name: "spec.pdf",
      kind: "document",
    });
    await request("update", { ...args, draftAttachments: attachments });
    expect(
      new CodexStore(path.join(mock.root, "codex")).get("R_123", id)
        .draftAttachments,
    ).toEqual(attachments);
    writeFileSync(path.join(folder, "result.pdf"), "result bytes");
    const destination = path.join(mock.root, "saved.pdf");
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({
      canceled: false,
      filePath: destination,
    });
    await request("outputFile", {
      ...args,
      href: "result.pdf",
      action: "save",
    });
    expect(readFileSync(destination, "utf8")).toBe("result bytes");
    await request("outputFile", {
      ...args,
      href: "result.pdf",
      action: "reveal",
    });
    expect(shell.showItemInFolder).toHaveBeenCalled();
    vi.mocked(shell.openPath).mockResolvedValueOnce("");
    await request("outputFile", { ...args, href: "result.pdf", action: "open" });
    expect(shell.openPath).toHaveBeenCalledWith(realpathSync(path.join(folder, "result.pdf")));
    vi.mocked(shell.openPath).mockResolvedValueOnce("No app can open this file");
    await expect(request("outputFile", { ...args, href: "result.pdf", action: "open" }))
      .rejects.toThrow("No app can open this file");
    await expect(request("outputFile", { ...args, href: source, action: "open" }))
      .rejects.toThrow("working folder");
    await expect(
      request("outputFile", { ...args, href: source, action: "save" }),
    ).rejects.toThrow("working folder");
    await expect(
      request("outputFile", { ...args, href: "result.pdf", action: "image" }),
    ).rejects.toThrow("image format");
    await expect(
      request("attach", { ...args, paths: [folder] }),
    ).rejects.toThrow("20 MB");
    await request("update", { ...args, archived: true });
    await expect(
      request("attach", { ...args, paths: [source] }),
    ).rejects.toThrow("Restore");
  });
});

it("requires a native, cancel-by-default confirmation for both checkout directions", async () => {
  const store = new CodexStore(path.join(mock.root, "codex"));
  const thread: CodexThread = {
    id: randomUUID(),
    repositoryId: "R_123",
    title: "Checkout",
    archived: false,
    createdAt: "",
    updatedAt: "",
    settings: defaultCodexPreferences,
    state: "idle",
    worktree: "/owned",
    branch: "main",
    baseCommit: "base",
    serverId: "server",
    repositoryPath: "/repo",
    items: [],
    requests: [],
    queue: [],
    queuePaused: false,
    draft: "",
    draftAttachments: [],
  };
  store.saveThread(thread);
  const decisions: boolean[] = [];
  vi.spyOn(TerminalManager.prototype, "has").mockReturnValue(true);
  const endTerminal = vi
    .spyOn(TerminalManager.prototype, "close")
    .mockImplementation(() => {});
  vi.spyOn(ThreadManager.prototype, "checkout").mockImplementation(
    async (_thread, _action, confirm) => {
      decisions.push(await confirm("Move checkout?", "Review destination"));
    },
  );
  for (const action of ["merge", "worktree"] as const) {
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({
      response: 0,
      checkboxChecked: false,
    });
    await request("checkout", {
      repositoryId: thread.repositoryId,
      id: thread.id,
      action,
    });
    expect(dialog.showMessageBox).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        defaultId: 0,
        cancelId: 0,
        buttons: [
          "Cancel",
          action === "merge" ? "Merge and continue" : "Start worktree",
        ],
      }),
    );
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({
      response: 1,
      checkboxChecked: false,
    });
    await request("checkout", {
      repositoryId: thread.repositoryId,
      id: thread.id,
      action,
    });
  }
  expect(decisions).toEqual([false, true, false, true]);
  expect(endTerminal).toHaveBeenCalledTimes(2);
  expect(dialog.showMessageBox).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({
      detail: expect.stringContaining("end this chat's terminal session"),
    }),
  );
  await expect(
    request("checkout", {
      repositoryId: "OTHER",
      id: thread.id,
      action: "merge",
    }),
  ).rejects.toThrow("does not belong");
});

it("persists the global send shortcut and validates renderer input", async () => {
  const current = (await request("configuration")) as { sendShortcut?: string };
  expect(current.sendShortcut).toBe("enter");
  await request("saveConfiguration", {
    defaults: defaultCodexPreferences,
    executable: "",
    sendShortcut: "command-enter",
  });
  expect(
    new CodexStore(path.join(mock.root, "codex")).configuration.sendShortcut,
  ).toBe("command-enter");
  await request("saveConfiguration", {
    defaults: defaultCodexPreferences,
    executable: "",
  });
  expect(
    ((await request("configuration")) as { sendShortcut?: string })
      .sendShortcut,
  ).toBe("command-enter");
  await expect(
    request("saveConfiguration", {
      defaults: defaultCodexPreferences,
      executable: "",
      sendShortcut: "invalid",
    }),
  ).rejects.toThrow("send shortcut");
});

it("scopes terminal requests to the owned chat without accepting a renderer-supplied cwd", async () => {
  const store = new CodexStore(path.join(mock.root, "codex"));
  const thread: CodexThread = {
    id: randomUUID(),
    repositoryId: "R_123",
    title: "Terminal",
    archived: false,
    createdAt: "",
    updatedAt: "",
    settings: defaultCodexPreferences,
    state: "idle",
    worktree: "/owned",
    branch: "main",
    baseCommit: "base",
    serverId: "server",
    repositoryPath: "/repo",
    items: [],
    requests: [],
    queue: [],
    queuePaused: false,
    draft: "",
    draftAttachments: [],
  };
  store.saveThread(thread);
  const open = vi.spyOn(TerminalManager.prototype, "open").mockResolvedValue({
    id: thread.id,
    repositoryId: thread.repositoryId,
    sessionId: "session",
    attachmentId: "view",
    cwd: "/owned",
    cols: 80,
    rows: 24,
    data: "",
    sequence: 0,
    exited: false,
  });
  const write = vi
    .spyOn(TerminalManager.prototype, "write")
    .mockImplementation(() => {});
  await request("terminalOpen", {
    repositoryId: thread.repositoryId,
    id: thread.id,
    attachmentId: "view",
    cols: 80,
    rows: 24,
    cwd: "/arbitrary",
  });
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({ worktree: "/owned" }),
    80,
    24,
    "view",
  );
  await request("terminalWrite", {
    repositoryId: thread.repositoryId,
    id: thread.id,
    sessionId: "session",
    data: "pwd\r",
  });
  expect(write).toHaveBeenCalledWith(
    expect.objectContaining({ id: thread.id }),
    "session",
    "pwd\r",
  );
  await expect(
    request("terminalOpen", {
      repositoryId: "OTHER",
      id: thread.id,
      attachmentId: "view",
      cols: 80,
      rows: 24,
    }),
  ).rejects.toThrow("does not belong");
  await expect(
    request("terminalWrite", {
      repositoryId: "OTHER",
      id: thread.id,
      sessionId: "session",
      data: "bad",
    }),
  ).rejects.toThrow("does not belong");
  expect(open).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledTimes(1);
});

it("ends the terminal only after archiving succeeds, and does not revive it on restore", async () => {
  const store = new CodexStore(path.join(mock.root, "codex"));
  const thread: CodexThread = {
    id: randomUUID(), repositoryId: "R_123", title: "Terminal", archived: false,
    createdAt: "", updatedAt: "", settings: defaultCodexPreferences,
    state: "idle", worktree: "/owned", branch: "main", baseCommit: "base",
    serverId: "server", repositoryPath: "/repo", items: [], requests: [],
    queue: [], queuePaused: false, draft: "", draftAttachments: [],
  };
  store.saveThread(thread);
  const close = vi.spyOn(TerminalManager.prototype, "close");
  const args = { repositoryId: thread.repositoryId, id: thread.id };
  await request("update", { ...args, title: "Renamed" });
  expect(close).not.toHaveBeenCalled();
  const update = vi.spyOn(ThreadManager.prototype, "update");
  update.mockImplementationOnce(() => { throw new Error("Stop this thread before archiving it."); });
  await expect(request("update", { ...args, archived: true })).rejects.toThrow("Stop this thread");
  expect(close).not.toHaveBeenCalled();
  await request("update", { ...args, archived: true });
  expect(close).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: thread.id, archived: true }));
  await request("update", { ...args, archived: false });
  expect(close).toHaveBeenCalledTimes(1);
});

it("stores remote environments and placements, snapshots targets, and rejects remote desktop operations at IPC", async () => {
  const environment = { id: "linux", name: "Linux", host: "build-box", executable: "codex", tmux: false };
  await request("saveEnvironments", { environments: [environment] });
  await request("saveProject", { repositoryId: "R_123", overrides: {}, remotePaths: { linux: "/srv/repo" } });
  const summary = await request("create", { repositoryId: "R_123" }) as { id: string };
  const args = { repositoryId: "R_123", id: summary.id };
  await request("setEnvironment", { ...args, environmentId: "linux" });
  for (const method of ["git", "checkout", "resolveMergeConflicts", "quickAction", "openFolder", "openEditor", "outputFile", "attach"]) {
    await expect(request(method, args)).rejects.toThrow("unavailable for remote");
  }
  await expect(request("send", { ...args, text: "hello", attachments: [{ id: "anything", name: "notes" }] })).rejects.toThrow("Attachments");
  await request("saveEnvironments", { environments: [] });
  const configuration = await request("configuration") as { projects: Record<string, { remotePaths: Record<string, string> }> };
  expect(configuration.projects.R_123.remotePaths).toEqual({});
  const page = await request("thread", args) as { thread: CodexThread };
  expect(page.thread.environment).toEqual(environment);
  expect(page.thread.repositoryPath).toBe("/srv/repo");
});

it("rejects injected environment hosts and invalid or unknown checkout placements", async () => {
  const environment = { id: "linux", name: "Linux", host: "-oProxyCommand=evil", executable: "codex", tmux: false };
  await expect(request("saveEnvironments", { environments: [environment] })).rejects.toThrow("SSH host alias");
  environment.host = "build-box";
  await expect(request("saveEnvironments", { environments: [environment, environment] })).rejects.toThrow("unique");
  await request("saveEnvironments", { environments: [environment] });
  await expect(request("saveProject", { repositoryId: "R_123", overrides: {}, remotePaths: { linux: "~other/repo" } })).rejects.toThrow("~/");
  await expect(request("saveProject", { repositoryId: "R_123", overrides: {}, remotePaths: { unknown: "/repo" } })).rejects.toThrow("Unknown environment");
});

it("infers a checkout from the local home and saves remote paths in home-relative form", async () => {
  const store = new CodexStore(path.join(mock.root, "codex"));
  store.configuration.projects.R_123 = { repositoryId: "R_123", path: path.join(os.homedir(), "src", "forge"), overrides: {} };
  store.saveConfiguration();
  expect(await request("inferRemotePath", { repositoryId: "R_123" })).toBe("~/src/forge");
  await request("saveEnvironments", { environments: [{ id: "linux", name: "Linux", host: "dev@host", executable: "codex", tmux: false }] });
  const configuration = await request("saveProject", { repositoryId: "R_123", overrides: {}, remotePaths: { linux: "src/forge" } }) as { projects: Record<string, { remotePaths: Record<string, string> }> };
  expect(configuration.projects.R_123.remotePaths.linux).toBe("~/src/forge");
  await expect(request("saveProject", { repositoryId: "R_123", overrides: {}, remotePaths: { linux: "~/../elsewhere" } })).rejects.toThrow("inside the remote home");
});

it("isolates project account homes, login state and completion events from the global account", async () => {
  vi.spyOn(CodexClient.prototype, "start").mockResolvedValue();
  const clients = new Map<string, CodexClient>();
  const rpc = vi.spyOn(CodexClient.prototype, "request").mockImplementation(async function (this: CodexClient, method) {
    const home = (this as unknown as { home: string }).home;
    clients.set(home, this);
    if (method === "account/read") return { account: { type: "chatgpt", email: home.endsWith("home") ? "global@example.invalid" : "project@example.invalid" } };
    if (method === "account/login/start") return { loginId: "project-login", authUrl: "https://auth.openai.com/authorize" };
    return {};
  });
  expect(await request("status")).toMatchObject({ email: "global@example.invalid", loginPending: false });
  expect(await request("status", { repositoryId: "R_123" })).toMatchObject({ email: "project@example.invalid", loginPending: false });
  expect([...clients.keys()]).toEqual([path.join(mock.root, "codex", "home"), path.join(mock.root, "codex", "accounts", "R_123")]);
  await request("login", { repositoryId: "R_123" });
  expect(await request("status")).toMatchObject({ loginPending: false });
  expect(await request("status", { repositoryId: "R_123" })).toMatchObject({ loginPending: true });
  await expect(request("login")).rejects.toThrow("Complete or cancel");
  const global = clients.get(path.join(mock.root, "codex", "home"))!;
  global.onEvent({ method: "account/login/completed", params: { success: true } });
  expect(await request("status", { repositoryId: "R_123" })).toMatchObject({ loginPending: true });
  const project = clients.get(path.join(mock.root, "codex", "accounts", "R_123"))!;
  project.onEvent({ method: "account/login/completed", params: { success: true } });
  expect(contents.send).toHaveBeenCalledWith("codex:changed", expect.objectContaining({ accountId: "R_123", auth: { success: true, error: undefined } }));
  expect(await request("status", { repositoryId: "R_123" })).toMatchObject({ loginPending: false });
  await request("login", { repositoryId: "R_123" });
  await request("cancelLogin", { repositoryId: "R_123" });
  expect(rpc).toHaveBeenLastCalledWith("account/login/cancel", { loginId: "project-login" });
  expect(rpc.mock.contexts.at(-1)).toBe(project);
  await request("logout", { repositoryId: "R_123" });
  expect(rpc.mock.contexts.at(-1)).toBe(project);
  expect(rpc).toHaveBeenLastCalledWith("account/logout", {});
  await expect(request("status", { repositoryId: "../../home" })).rejects.toThrow("repository ID");
});

it("persists and validates the account override when editing or replacing the local checkout", async () => {
  const saved = await request("saveProject", { repositoryId: "R_123", overrides: {}, accountOverride: true });
  expect(saved).toMatchObject({ projects: { R_123: { accountOverride: true } } });
  const reloaded = new CodexStore(path.join(mock.root, "codex"));
  expect(reloaded.configuration.projects.R_123.accountOverride).toBe(true);
  const repo = path.join(mock.root, "repo");
  mkdirSync(repo);
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["-c", "user.name=Forge test", "-c", "user.email=forge@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "initial"]);
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [repo] });
  expect(await request("pickFolder", { repositoryId: "R_123", fullName: "owner/repo" })).toMatchObject({ projects: { R_123: { accountOverride: true } } });
  await expect(request("saveProject", { repositoryId: "R_123", overrides: {}, accountOverride: "yes" })).rejects.toThrow("account override");
  expect(await request("saveProject", { repositoryId: "R_123", overrides: {}, accountOverride: false })).toMatchObject({ projects: { R_123: { accountOverride: false } } });
});

it("checks the selected account's active threads before sign-in and sign-out", async () => {
  const active = vi.spyOn(ThreadManager.prototype, "hasActiveAccount").mockImplementation(id => id === "R_123");
  vi.spyOn(CodexClient.prototype, "start").mockResolvedValue();
  vi.spyOn(CodexClient.prototype, "request").mockResolvedValue({});
  for (const method of ["login", "logout"]) {
    await expect(request(method, { repositoryId: "R_123" })).rejects.toThrow("Stop threads using this Codex account");
    expect(active).toHaveBeenLastCalledWith("R_123");
  }
  await request("logout");
  expect(active).toHaveBeenLastCalledWith(undefined);
});

it("checks configured local repositories before directing users to project configuration", async () => {
  const store = new CodexStore(path.join(mock.root, "codex"));
  const repo = path.join(mock.root, "checkout");
  mkdirSync(repo);
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["-c", "user.name=Forge test", "-c", "user.email=forge@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "initial"]);
  store.configuration.projects.R_123 = { repositoryId: "R_123", path: repo, overrides: {} };
  store.configuration.projects.missing = { repositoryId: "missing", path: path.join(mock.root, "moved"), overrides: {} };
  store.saveConfiguration();
  expect(await request("checkProjectCheckout", { repositoryId: "R_123", environmentId: "local" })).toMatchObject({ ready: true });
  expect(await request("checkProjectCheckout", { repositoryId: "missing", environmentId: "local" })).toMatchObject({ ready: false });
  expect(await request("checkProjectCheckout", { repositoryId: "unconfigured", environmentId: "local" })).toMatchObject({ ready: false, message: expect.stringContaining("project configuration") });
  expect(await request("checkProjectCheckout", { repositoryId: "R_123", environmentId: "unconfigured" })).toMatchObject({ ready: false, message: expect.stringContaining("project configuration") });
});


it("validates a remote project's configured checkout on its selected environment", async () => {
  const store = new CodexStore(path.join(mock.root, "codex"));
  const environment = { id: "linux", name: "Linux", host: "dev@host", executable: "codex", tmux: false };
  store.configuration.environments = [environment];
  store.configuration.projects.R_123 = { repositoryId: "R_123", path: "", overrides: {}, remotePaths: { linux: "~/src/repo" } };
  store.saveConfiguration();
  const check = vi.spyOn(remoteChecks, "checkEnvironment").mockResolvedValue({ ready: true, message: "Ready" });
  expect(await request("checkProjectCheckout", { repositoryId: "R_123", environmentId: "linux" })).toMatchObject({ ready: true });
  expect(check).toHaveBeenCalledExactlyOnceWith(environment, "~/src/repo");
  check.mockResolvedValue({ ready: false, message: "Checkout is missing" });
  expect(await request("checkProjectCheckout", { repositoryId: "R_123", environmentId: "linux" })).toMatchObject({ ready: false, message: "Checkout is missing" });
});

it("persists a project default, applies it only to new threads, and resets it when the environment is removed", async () => {
  const environment = { id: "linux", name: "Linux", host: "dev@host", executable: "codex", tmux: false };
  await request("saveEnvironments", { environments: [environment] });
  const store = new CodexStore(path.join(mock.root, "codex"));
  // Configure through IPC before services read the project settings.
  await request("saveProject", { repositoryId: "R_123", overrides: {}, remotePaths: { linux: "~/src/repo" } });
  const before = await request("create", { repositoryId: "R_123" }) as { id: string; environment?: unknown };
  expect(before.environment).toBeUndefined();
  expect(await request("saveProject", { repositoryId: "R_123", overrides: {}, defaultEnvironment: "linux" })).toMatchObject({ projects: { R_123: { defaultEnvironment: "linux" } } });
  expect(new CodexStore(store.root).configuration.projects.R_123.defaultEnvironment).toBe("linux");
  const after = await request("create", { repositoryId: "R_123" }) as { id: string; environment?: unknown };
  expect(after.environment).toEqual(environment);
  const original = await request("thread", { repositoryId: "R_123", id: before.id }) as { thread: CodexThread };
  expect(original.thread.environment).toBeUndefined();
  const created = await request("thread", { repositoryId: "R_123", id: after.id }) as { thread: CodexThread };
  expect(created.thread.repositoryPath).toBe("~/src/repo");
  await expect(request("saveProject", { repositoryId: "R_123", overrides: {}, defaultEnvironment: "unknown" })).rejects.toThrow("checkout for the default");
  await expect(request("saveProject", { repositoryId: "R_123", overrides: {}, remotePaths: {} })).rejects.toThrow("Choose another default");
  await request("saveEnvironments", { environments: [] });
  expect(await request("configuration")).toMatchObject({ projects: { R_123: { defaultEnvironment: "local" } } });
  expect((await request("thread", { repositoryId: "R_123", id: after.id }) as { thread: CodexThread }).thread.environment).toEqual(environment);
});


it("trusts registered thread windows, restricts their thread access, and grants one editing owner", async () => {
  const childFrame = { url: "http://127.0.0.1:5173/#thread-window" };
  const childContents = Object.assign(new EventEmitter(), { mainFrame: childFrame, send: vi.fn() });
  const child = Object.assign(new EventEmitter(), { webContents: childContents, show: vi.fn(), focus: vi.fn(), restore: vi.fn(), isMinimized: () => false, destroy: vi.fn(), close: vi.fn() });
  child.close.mockImplementation(() => { child.emit("closed"); });
  const factory = vi.fn(() => child as unknown as BrowserWindow);
  registerCodexIpc(() => ({ webContents: contents }) as unknown as BrowserWindow, factory);
  const invoke = (method: string, input: unknown = {}) => Promise.resolve(mock.handlers.get("codex:request")!({ sender: childContents, senderFrame: childFrame }, method, input));
  await expect(invoke("configuration")).rejects.toThrow("Untrusted");
  const environment = { id: "linux", name: "Linux", host: "dev@host", executable: "codex", tmux: false };
  await request("saveEnvironments", { environments: [environment] });
  await request("saveProject", { repositoryId: "R_123", fullName: "owner/repo", overrides: {}, remotePaths: { linux: "~/repo" } });
  const thread = await request("create", { repositoryId: "R_123" }) as { id: string };
  const args = { repositoryId: "R_123", id: thread.id };
  await request("openThreadWindow", args);
  await request("openThreadWindow", args);
  expect(factory).toHaveBeenCalledOnce();
  expect(await invoke("threadWindowContext")).toMatchObject(args);
  expect(await invoke("thread", args)).toMatchObject({ thread: args });
  await expect(invoke("thread", { ...args, id: "other" })).rejects.toThrow("another thread");
  await expect(invoke("saveProject", { repositoryId: "other", overrides: {} })).rejects.toThrow("another thread");
  await expect(request("update", { ...args, draft: "stale main draft" })).rejects.toThrow("another window");
  await invoke("update", { ...args, draft: "detached draft" });
  expect(contents.send).toHaveBeenCalledWith("codex:changed", expect.objectContaining({ threadId: thread.id }));
  expect(childContents.send).toHaveBeenCalledWith("codex:changed", expect.objectContaining({ threadId: thread.id }));
  childFrame.url = "https://example.invalid";
  await expect(invoke("thread", args)).rejects.toThrow("Untrusted");
  childFrame.url = "http://127.0.0.1:5173/#thread-window";
  await invoke("closeThreadWindow");
  await expect(invoke("configuration")).rejects.toThrow("Untrusted");
  await request("update", { ...args, draft: "main draft after closing" });
  expect(await request("thread", args)).toMatchObject({ thread: { draft: "main draft after closing" } });
});
