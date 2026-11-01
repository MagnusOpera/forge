import { afterEach, describe, expect, it, vi } from "vitest";
import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtempSync,
  mkdirSync,
  chmodSync,
  realpathSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import os from "node:os";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CodexStore } from "../../electron/main/codex/store";
import { ThreadManager } from "../../electron/main/codex/threads";
import {
  RemoteCodexClient,
  inferRemoteCheckoutPath,
  remoteCheckoutPath,
  resolveRemoteCheckoutPath,
  remoteExecutableSetup,
  connectProxyWebSocket,
  assertRemoteWorktree,
  prepareRemoteWorktree,
  remoteCommand,
  remotePath,
  remoteTerminalCommand,
  shellQuote,
  sshArgs,
  validateEnvironment,
  checkEnvironment,
} from "../../electron/main/codex/remote";
import {
  defaultCodexPreferences,
  type CodexEnvironment,
  type CodexThread,
  type JsonObject,
} from "../../shared/codex";
import { CodexClient } from "../../electron/main/codex/client";
import type {
  CodexTransport,
  RpcEvent,
} from "../../electron/main/codex/client";

const exec = promisify(execFile);
const directories: string[] = [];
const managers: ThreadManager[] = [];
const environment: CodexEnvironment = {
  id: "linux",
  name: "Linux",
  host: "dev@build-box",
  executable: "/usr/local/bin/codex",
  tmux: false,
};
function directory() {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "forge-remote-")),
  );
  directories.push(root);
  return root;
}
function thread(repositoryPath: string): CodexThread {
  return {
    id: randomUUID(),
    repositoryId: "repo",
    repositoryPath,
    environment: { ...environment },
    title: "New thread",
    archived: false,
    createdAt: "",
    updatedAt: "",
    settings: { ...defaultCodexPreferences },
    state: "idle",
    serverId: "",
    worktree: "",
    branch: "",
    baseCommit: "",
    items: [],
    requests: [],
    queue: [],
    queuePaused: true,
    draft: "",
    draftAttachments: [],
  };
}
class LocalCommandTransport implements CodexTransport {
  onEvent: (event: RpcEvent) => void = () => {};
  requests: { method: string; params: JsonObject }[] = [];
  async start() {}
  stop() {}
  respond() {}
  rejectRequest() {}
  async request(method: string, params: JsonObject) {
    this.requests.push({ method, params });
    if (method !== "command/exec") throw new Error("Unexpected RPC");
    const command = params.command as string[];
    try {
      const result = await exec(command[0], command.slice(1), {
        cwd: params.cwd as string | undefined,
      });
      return { ...result, exitCode: 0 };
    } catch (error) {
      const result = error as { stdout: string; stderr: string; code: number };
      return { ...result, exitCode: result.code };
    }
  }
}
afterEach(() => {
  managers.splice(0).forEach((manager) => manager.flush());
  vi.restoreAllMocks();
  directories
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true }));
});
describe("remote configuration and SSH boundaries", () => {
  it("accepts SSH aliases and absolute executable paths, rejects injected hosts and reserved IDs", () => {
    expect(validateEnvironment(environment)).toEqual(environment);
    for (const host of [
      "-oProxyCommand=evil",
      "host; touch /tmp/evil",
      "$(evil)",
      "host\nother",
      "ssh://host",
    ]) {
      expect(() => validateEnvironment({ ...environment, host })).toThrow();
    }
    for (const id of ["local", "__proto__", "constructor", "../escape"])
      expect(() => validateEnvironment({ ...environment, id })).toThrow();
    expect(() =>
      validateEnvironment({ ...environment, executable: "~/bin/codex" }),
    ).toThrow();
    expect(sshArgs(environment.host)).toContain("BatchMode=yes");
    expect(sshArgs(environment.host)).toContain("StrictHostKeyChecking=yes");
    expect(sshArgs(environment.host, true).slice(-2)).toEqual([
      "-tt",
      environment.host,
    ]);
  });
  it("quotes shell metacharacters literally and requires absolute remote paths", async () => {
    const value = "a ' quote; $(printf bad) `printf bad`\nend";
    expect(
      (await exec("/bin/sh", ["-c", `printf %s ${shellQuote(value)}`])).stdout,
    ).toBe(value);
    for (const value of ["~/repo", "relative", "/path\ncommand", ""])
      expect(() => remotePath(value)).toThrow();
    expect(remotePath("/home/user/a/../repo")).toBe("/home/user/repo");
  });
  it("keeps a thread target and placements across restart independently of later configuration changes", () => {
    const root = directory();
    const store = new CodexStore(root);
    store.configuration.environments = [{ ...environment }];
    store.configuration.projects.repo = {
      repositoryId: "repo",
      path: "",
      overrides: {},
      remotePaths: { linux: "/srv/repo" },
    };
    store.saveConfiguration();
    const item = thread("/srv/repo");
    store.saveThread(item);
    store.configuration.environments[0].host = "replacement";
    store.saveConfiguration();
    const restored = new CodexStore(root);
    expect(restored.configuration.environments?.[0].host).toBe("replacement");
    expect(restored.list("repo")[0].environment?.host).toBe(environment.host);
    expect(restored.configuration.projects.repo.remotePaths).toEqual({
      linux: "/srv/repo",
    });
  });
});
describe("remote worktree commands", () => {
  async function repository() {
    const root = directory();
    const repo = path.join(root, "repo with ' quotes");
    await exec("git", ["init", "-b", "main", repo]);
    await exec("git", ["-C", repo, "config", "user.name", "Forge"]);
    await exec("git", [
      "-C",
      repo,
      "config",
      "user.email",
      "forge@example.invalid",
    ]);
    writeFileSync(path.join(repo, "file"), "committed");
    await exec("git", ["-C", repo, "add", "."]);
    await exec("git", ["-C", repo, "commit", "-m", "initial"]);
    return repo;
  }
  it("starts a selected remote worktree from the default branch instead of the current branch", async () => {
    const repo = await repository();
    await exec("git", ["-C", repo, "switch", "-c", "feature"]);
    writeFileSync(path.join(repo, "file"), "feature");
    await exec("git", ["-C", repo, "commit", "-am", "Feature"]);
    const item = thread(repo);
    item.start = { kind: "worktree", branch: "main" };
    await prepareRemoteWorktree(new LocalCommandTransport(), item, () => {});
    expect(readFileSync(path.join(item.worktree, "file"), "utf8")).toBe("committed");
    expect(readFileSync(path.join(repo, "file"), "utf8")).toBe("feature");
  });
  it("creates isolated worktrees from committed HEAD and safely recovers an uncertain successful creation", async () => {
    const repo = await repository();
    writeFileSync(path.join(repo, "file"), "uncommitted original");
    const item = thread(repo);
    const client = new LocalCommandTransport();
    let savedBeforeMutation = false;
    await prepareRemoteWorktree(client, item, () => {
      savedBeforeMutation = Boolean(
        item.worktree && item.branch && item.baseCommit,
      );
    });
    expect(savedBeforeMutation).toBe(true);
    expect(readFileSync(path.join(item.worktree, "file"), "utf8")).toBe(
      "committed",
    );
    expect(readFileSync(path.join(repo, "file"), "utf8")).toBe(
      "uncommitted original",
    );
    expect(item.worktree.startsWith(repo + "/")).toBe(false);
    writeFileSync(path.join(item.worktree, "file"), "retained remote edit");
    await prepareRemoteWorktree(client, item, () => {
      throw new Error("must not replace persisted intent");
    });
    expect(readFileSync(path.join(item.worktree, "file"), "utf8")).toBe(
      "retained remote edit",
    );
    expect(
      client.requests.some(
        ({ params }) =>
          (params.sandboxPolicy as JsonObject).type === "dangerFullAccess",
      ),
    ).toBe(true);
    await exec("git", ["-C", item.worktree, "switch", "-c", "unexpected"]);
    await expect(assertRemoteWorktree(client, item)).rejects.toThrow();
  });
  it("fails closed on unsuccessful or unsupported execution without local fallback", async () => {
    const client = new LocalCommandTransport();
    vi.spyOn(client, "request").mockResolvedValue({
      exitCode: 1,
      stderr: "permission denied",
      stdout: "",
    });
    await expect(
      remoteCommand(client, ["git", "status"], "/remote"),
    ).rejects.toThrow("permission denied");
    vi.mocked(client.request).mockRejectedValue(new Error("Method not found"));
    await expect(
      remoteCommand(client, ["git", "status"], "/remote"),
    ).rejects.toThrow("Method not found");
  });
});
describe("target selection and remote reconnect", () => {
  it("uses a snapshotted project default without starting local Codex and rejects a broken default", async () => {
    const store = new CodexStore(directory());
    store.configuration.environments = [{ ...environment }];
    store.configuration.projects.repo = { repositoryId: "repo", path: "", overrides: {}, remotePaths: { linux: "~/src/repo" }, defaultEnvironment: "linux" };
    const models = vi.fn(async () => []);
    const manager = new ThreadManager(store, new LocalCommandTransport(), models, () => {}, () => "");
    managers.push(manager);
    const created = await manager.create("repo");
    expect(created.environment).toEqual(environment);
    expect(store.get("repo", created.id).repositoryPath).toBe("~/src/repo");
    expect(models).not.toHaveBeenCalled();
    store.configuration.environments[0].host = "changed-host";
    expect(created.environment?.host).toBe(environment.host);
    store.configuration.projects.repo.defaultEnvironment = "missing";
    await expect(manager.create("repo")).rejects.toThrow("default environment's checkout");
    expect(store.get("repo", created.id).environment?.host).toBe(environment.host);
  });
  it("rejects environment changes for an empty archived thread until it is restored", () => {
    const store = new CodexStore(directory());
    store.configuration.projects.repo = { repositoryId: "repo", path: "/local/repo", overrides: {} };
    const manager = new ThreadManager(store, new LocalCommandTransport(), async () => [], () => {}, () => "");
    managers.push(manager);
    const item = thread("/remote/repo");
    item.archived = true;
    expect(() => manager.setEnvironment(item, "local")).toThrow("Restore this thread");
    expect(item.environment).toEqual(environment);
    expect(item.repositoryPath).toBe("/remote/repo");
    item.archived = false;
    manager.setEnvironment(item, "local");
    expect(item.environment).toBeUndefined();
    expect(item.repositoryPath).toBe("/local/repo");
  });
  it("allows remote-only projects without starting local Codex, snapshots the target, and locks selection after setup", async () => {
    const store = new CodexStore(directory());
    store.configuration.environments = [{ ...environment }];
    store.configuration.projects.repo = {
      repositoryId: "repo",
      path: "",
      overrides: {},
      remotePaths: { linux: "/srv/repo" },
    };
    const models = vi.fn(async () => []);
    const manager = new ThreadManager(
      store,
      new LocalCommandTransport(),
      models,
      () => {},
      () => "",
    );
    managers.push(manager);
    const item = store.get("repo", (await manager.create("repo")).id);
    expect(models).not.toHaveBeenCalled();
    expect(item.environment).toBeUndefined();
    manager.setEnvironment(item, "linux");
    store.configuration.environments[0].host = "changed";
    expect(item.environment?.host).toBe(environment.host);
    item.worktree = "/srv/worktree";
    expect(() => manager.setEnvironment(item, "local")).toThrow("fixed");
    await expect(
      manager.send(item, {
        id: "m",
        text: "hello",
        attachments: [{ id: "x", name: "a" }],
      }),
    ).rejects.toThrow("Attachments");
  });
  it("reconciles a running remote turn without sending or replaying any message", async () => {
    const store = new CodexStore(directory());
    const item = thread("/srv/repo");
    item.worktree = "/srv/worktree";
    item.branch = "codex/forge-test";
    item.baseCommit = "a".repeat(40);
    item.serverId = "server";
    item.state = "interrupted";
    item.draft = "unsent";
    store.threads.set(item.id, item);
    vi.spyOn(RemoteCodexClient.prototype, "start").mockResolvedValue();
    vi.spyOn(RemoteCodexClient.prototype, "stop").mockImplementation(() => {});
    const requests = vi
      .spyOn(RemoteCodexClient.prototype, "request")
      .mockImplementation(async (method) =>
        method === "command/exec"
          ? { exitCode: 0, stdout: "", stderr: "" }
          : {
              thread: {
                id: "server",
                turns: [{ id: "running", status: "inProgress", items: [] }],
              },
            },
      );
    const manager = new ThreadManager(
      store,
      new LocalCommandTransport(),
      async () => [],
      () => {},
      () => "",
    );
    managers.push(manager);
    await manager.reconnect(item);
    expect(item.state).toBe("running");
    expect(item.turnId).toBe("running");
    expect(item.draft).toBe("unsent");
    expect(requests.mock.calls.map(([method]) => method)).toEqual([
      "command/exec",
      "thread/resume",
    ]);
  });
  it("reports failed validation without launching a daemon", async () => {
    vi.spyOn(RemoteCodexClient.prototype, "start").mockRejectedValue(
      new Error("No control socket"),
    );
    const stop = vi
      .spyOn(RemoteCodexClient.prototype, "stop")
      .mockImplementation(() => {});
    expect(await checkEnvironment(environment)).toEqual({
      ready: false,
      message: "No control socket",
    });
    expect(stop).toHaveBeenCalledOnce();
  });
  it("locks a recorded remote worktree while terminal setup reconciles an uncertain creation", async () => {
    const store = new CodexStore(directory());
    const item = thread("/srv/repo");
    item.worktree = "/srv/worktree";
    item.branch = `codex/forge-${item.id}`;
    item.baseCommit = "a".repeat(40);
    store.threads.set(item.id, item);
    vi.spyOn(RemoteCodexClient.prototype, "start").mockResolvedValue();
    vi.spyOn(RemoteCodexClient.prototype, "stop").mockImplementation(() => {});
    let release!: (value: unknown) => void;
    vi.spyOn(RemoteCodexClient.prototype, "request")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    const manager = new ThreadManager(
      store,
      new LocalCommandTransport(),
      async () => [],
      () => {},
      () => "",
    );
    managers.push(manager);
    const opening = manager.prepareTerminalCheckout(item);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await expect(
      manager.send(item, { id: "m", text: "hello", attachments: [] }),
    ).rejects.toThrow("Wait for Codex to start");
    release({ exitCode: 0, stdout: "", stderr: "" });
    await opening;
  });
  it("validates authenticated daemon capabilities and reports optional tmux readiness", async () => {
    vi.spyOn(RemoteCodexClient.prototype, "start").mockResolvedValue();
    vi.spyOn(RemoteCodexClient.prototype, "stop").mockImplementation(() => {});
    vi.spyOn(RemoteCodexClient.prototype, "status").mockResolvedValue({
      connected: true,
      authenticated: true,
      version: "codex-cli 0.166.0",
    });
    const models = vi
      .spyOn(RemoteCodexClient.prototype, "models")
      .mockResolvedValue([
        {
          id: "test",
          name: "Test",
          efforts: ["medium"],
          defaultEffort: "medium",
          isDefault: true,
          fast: false,
          images: false,
        },
      ]);
    const requests = vi
      .spyOn(RemoteCodexClient.prototype, "request")
      .mockImplementation(async (method) =>
        method === "command/exec"
          ? { exitCode: 0, stdout: "developer\ntmux=no\n", stderr: "" }
          : {},
      );
    expect(await checkEnvironment(environment, "/srv/repo")).toMatchObject({
      ready: true,
      tmux: false,
      message: expect.stringContaining("Connected as developer"),
    });
    expect(requests).toHaveBeenCalledWith("collaborationMode/list", {});
    expect(
      await checkEnvironment({ ...environment, tmux: true }),
    ).toMatchObject({
      ready: false,
      message: expect.stringContaining("not installed"),
    });
    models.mockResolvedValue([]);
    expect(await checkEnvironment(environment)).toMatchObject({
      ready: false,
      message: expect.stringContaining("no available models"),
    });
  });
  it("builds SSH terminal commands with optional remote tmux and literal paths", () => {
    const item = thread("/srv/repo");
    item.worktree = "/srv/repo ' $(touch nope)";
    expect(remoteTerminalCommand(item)).toContain(
      'exec "${SHELL:-/bin/sh}" -l',
    );
    item.environment!.tmux = true;
    expect(remoteTerminalCommand(item)).toContain(
      `tmux new-session -A -s 'forge-${item.id}'`,
    );
    expect(remoteTerminalCommand(item)).toContain(shellQuote(item.worktree));
  });
});

it("handles a broken SSH input pipe without crashing or replaying the pending request", async () => {
  class StreamClient extends CodexClient {
    attach(child: ChildProcessWithoutNullStreams) {
      return this.connect(child);
    }
  }
  const child = spawn(
    process.execPath,
    [
      "-e",
      `require('node:readline').createInterface({ input: process.stdin }).on('line', line => { const message = JSON.parse(line); if (message.method === 'initialize') process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + '\\n'); });`,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const client = new StreamClient("", () => "", 2000);
  const events: RpcEvent[] = [];
  client.onEvent = (event) => events.push(event);
  try {
    await client.attach(child);
    const pending = expect(client.request("turn/start", {})).rejects.toThrow(
      "broken SSH pipe",
    );
    child.stdin.emit("error", new Error("broken SSH pipe"));
    await pending;
    expect(
      events.filter((event) => event.method === "connection/failed"),
    ).toHaveLength(1);
    await expect(client.request("turn/start", {})).rejects.toThrow(
      "disconnected",
    );
  } finally {
    client.stop();
    child.kill();
  }
});

it("finds user-local Codex when non-interactive SSH omits it from PATH", async () => {
  const home = directory();
  const folder = path.join(home, ".local", "bin");
  mkdirSync(folder, { recursive: true });
  const executable = path.join(folder, "codex");
  writeFileSync(executable, "#!/bin/sh\nexit 0\n");
  chmodSync(executable, 0o755);
  const inspect = async (override: string, executablePath = "/usr/bin:/bin") =>
    (
      await exec(
        "/bin/sh",
        [
          "-c",
          remoteExecutableSetup(override) + '\nprintf "%s" "$codex_executable"',
        ],
        { env: { ...process.env, HOME: home, PATH: executablePath } },
      )
    ).stdout;
  expect(await inspect("codex")).toBe(executable);
  const otherFolder = path.join(home, "custom bin");
  mkdirSync(otherFolder);
  const preferred = path.join(otherFolder, "codex");
  writeFileSync(preferred, "#!/bin/sh\nexit 0\n");
  chmodSync(preferred, 0o755);
  expect(await inspect("codex", otherFolder + ":/usr/bin:/bin")).toBe(
    preferred,
  );
  expect(await inspect("/custom path/with ' quote/codex")).toBe(
    "/custom path/with ' quote/codex",
  );
});

it("uses WebSocket frames through a raw stdio proxy for RPC and approvals", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const address = server.address();
  if (typeof address === "string" || !address)
    throw new Error("No test listener");
  const port = address.port;
  const received: JsonObject[] = [];
  server.on("connection", (socket) => {
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString()) as JsonObject;
      received.push(message);
      if (message.method === "initialize")
        socket.send(JSON.stringify({ id: message.id, result: {} }));
      if (message.method === "turn/start") {
        socket.send(
          JSON.stringify({
            id: message.id,
            result: { turn: { id: "remote-turn" } },
          }),
        );
        socket.send(
          JSON.stringify({
            id: "approval",
            method: "item/commandExecution/requestApproval",
            params: { threadId: "remote-thread" },
          }),
        );
      }
    });
  });
  class ProxyClient extends RemoteCodexClient {
    protected override async launch() {
      const child = spawn(
        process.execPath,
        [
          "-e",
          `const socket=require('node:net').connect(${port},'127.0.0.1');process.stdin.pipe(socket);socket.pipe(process.stdout);socket.on('error',()=>process.exit(1));`,
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      await this.connectProxy(child);
    }
  }
  const client = new ProxyClient(environment);
  const events: RpcEvent[] = [];
  client.onEvent = (event) => events.push(event);
  try {
    await client.start();
    expect(
      await client.request("turn/start", { threadId: "remote-thread" }),
    ).toEqual({ turn: { id: "remote-turn" } });
    await vi.waitFor(() => expect(events[0]?.requestId).toBe("approval"));
    client.respond("approval", { decision: "accept" });
    await vi.waitFor(() =>
      expect(
        received.some(
          (message) =>
            message.id === "approval" &&
            (message.result as JsonObject)?.decision === "accept",
        ),
      ).toBe(true),
    );
    expect(received.map((message) => message.method).filter(Boolean)).toEqual([
      "initialize",
      "initialized",
      "turn/start",
    ]);
  } finally {
    client.stop();
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("reports an unavailable proxy before waiting for a JSON-RPC initialization timeout", async () => {
  const child = spawn(
    process.execPath,
    ["-e", 'process.stderr.write("No managed daemon socket");process.exit(1)'],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  await expect(connectProxyWebSocket(child)).rejects.toThrow(
    /No managed daemon socket|socket hang up/,
  );
});

it("infers remote home paths only from a configured checkout inside the local home", () => {
  expect(
    inferRemoteCheckoutPath("/Users/local/src/team/forge", "/Users/local"),
  ).toBe("~/src/team/forge");
  expect(inferRemoteCheckoutPath("/Users/local", "/Users/local")).toBe("~");
  expect(inferRemoteCheckoutPath(undefined, "/Users/local")).toBeNull();
  expect(inferRemoteCheckoutPath("relative/repo", "/Users/local")).toBeNull();
  expect(
    inferRemoteCheckoutPath("/Users/local-other/repo", "/Users/local"),
  ).toBeNull();
  expect(inferRemoteCheckoutPath("/srv/repo", "/Users/local")).toBeNull();
});
it("normalizes remote relative paths and rejects attempts to leave the home directory", () => {
  expect(remoteCheckoutPath("src/team/repo")).toBe("~/src/team/repo");
  expect(remoteCheckoutPath("~/src/../repo")).toBe("~/repo");
  expect(remoteCheckoutPath("~")).toBe("~");
  expect(remoteCheckoutPath("/srv/repo")).toBe("/srv/repo");
  for (const value of [
    "",
    "../repo",
    "~/../repo",
    "~other/repo",
    "~/repo\ncommand",
  ]) {
    expect(() => remoteCheckoutPath(value)).toThrow();
  }
});
it("resolves home-relative checkout paths on the execution host rather than this computer", async () => {
  const client = new LocalCommandTransport();
  const request = vi.spyOn(client, "request").mockResolvedValue({
    exitCode: 0,
    stdout: "/home/remote-user",
    stderr: "",
  });
  expect(
    await resolveRemoteCheckoutPath(client, "~/src/repo ' $(echo literal)"),
  ).toBe("/home/remote-user/src/repo ' $(echo literal)");
  expect(request).toHaveBeenCalledWith(
    "command/exec",
    expect.objectContaining({
      command: ["/bin/sh", "-c", 'printf "%s" "$HOME"'],
    }),
  );
  request.mockClear();
  expect(await resolveRemoteCheckoutPath(client, "/srv/repo")).toBe(
    "/srv/repo",
  );
  expect(request).not.toHaveBeenCalled();
});

it("reports a missing suggested checkout before attempting to spawn Git inside it", async () => {
  vi.spyOn(RemoteCodexClient.prototype, "start").mockResolvedValue();
  vi.spyOn(RemoteCodexClient.prototype, "stop").mockImplementation(() => {});
  vi.spyOn(RemoteCodexClient.prototype, "status").mockResolvedValue({
    connected: true,
    authenticated: true,
  });
  vi.spyOn(RemoteCodexClient.prototype, "models").mockResolvedValue([
    {
      id: "test",
      name: "Test",
      efforts: ["medium"],
      defaultEffort: "medium",
      isDefault: true,
      fast: false,
      images: false,
    },
  ]);
  const runner = new LocalCommandTransport();
  vi.spyOn(RemoteCodexClient.prototype, "request").mockImplementation(
    async (method, params) =>
      method === "command/exec" ? runner.request(method, params) : {},
  );
  const folder = path.join(directory(), "missing-repo");
  expect(await checkEnvironment(environment, folder)).toMatchObject({
    ready: false,
    message: expect.stringContaining(
      `Remote checkout does not exist: ${folder}`,
    ),
  });
  expect(
    runner.requests.some(
      ({ params }) => (params.command as string[])[0] === "git",
    ),
  ).toBe(false);
});

it.each([true, false])(
  "validates host write permissions independently of read-only sandbox mounts (host writable: %s)",
  async (writable) => {
    vi.spyOn(RemoteCodexClient.prototype, "start").mockResolvedValue();
    vi.spyOn(RemoteCodexClient.prototype, "stop").mockImplementation(() => {});
    vi.spyOn(RemoteCodexClient.prototype, "status").mockResolvedValue({
      connected: true,
      authenticated: true,
    });
    vi.spyOn(RemoteCodexClient.prototype, "models").mockResolvedValue([
      {
        id: "test",
        name: "Test",
        efforts: ["medium"],
        defaultEffort: "medium",
        isDefault: true,
        fast: false,
        images: false,
      },
    ]);
    const requests = vi
      .spyOn(RemoteCodexClient.prototype, "request")
      .mockImplementation(async (method, params) => {
        if (method !== "command/exec") return {};
        const permissionProbe = (params.command as string[])[2]?.includes(
          "test -w",
        );
        if (permissionProbe) {
          if ((params.sandboxPolicy as JsonObject).type === "readOnly")
            return { exitCode: 1, stdout: "", stderr: "" };
          return {
            exitCode: writable ? 0 : 1,
            stdout: "",
            stderr: writable
              ? ""
              : "Remote Git metadata is not writable by this user: .git",
          };
        }
        return { exitCode: 0, stdout: "developer\ntmux=no\n", stderr: "" };
      });
    const result = await checkEnvironment(environment, "/srv/repo");
    expect(result.ready).toBe(writable);
    if (!writable)
      expect(result.message).toContain("Git metadata is not writable");
    const commands = requests.mock.calls
      .filter(([method]) => method === "command/exec")
      .map(([, params]) => params);
    expect(
      commands.find((params) => (params.command as string[])[0] === "git")
        ?.sandboxPolicy,
    ).toEqual({ type: "readOnly", networkAccess: false });
    expect(
      commands.filter(
        (params) =>
          (params.sandboxPolicy as JsonObject).type === "dangerFullAccess",
      ),
    ).toHaveLength(1);
  },
);
