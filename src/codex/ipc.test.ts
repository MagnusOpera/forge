import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
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
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
}));
import { shell } from "electron";
import { CodexClient } from "../../electron/main/codex/client";
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
