import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
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
import * as editorLauncher from "../../electron/main/codex/editor";
import { CodexStore } from "../../electron/main/codex/store";
import { git } from "../../electron/main/codex/git";
import { randomUUID } from "node:crypto";
import type { CodexThread } from "../../shared/codex";
import { CodexClient } from "../../electron/main/codex/client";
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
