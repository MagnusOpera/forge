import { startBaseCommit } from "./thread-start.js";
import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { Duplex } from "node:stream";
import WebSocket from "ws";
import type {
  CodexEnvironment,
  CodexEnvironmentCheck,
  CodexThread,
  JsonObject,
} from "../../../shared/codex.js";
import {
  CodexClient,
  assertCapabilities,
  object,
  text,
  type CodexTransport,
} from "./client.js";

const exec = promisify(execFile);
export function shellQuote(value: string): string {
  if (value.includes("\0")) throw new Error("Invalid remote command argument.");
  return "'" + value.replace(/'/g, "'\\''") + "'";
}
export function validateEnvironment(value: unknown): CodexEnvironment {
  const input = object(value);
  const field = (key: string, max: number) => {
    const value = input[key];
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > max ||
      /[\x00-\x1f\x7f]/.test(value)
    ) {
      throw new Error(`Invalid environment ${key}.`);
    }
    return value.trim();
  };
  const id = field("id", 80);
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id) ||
    ["local", "__proto__", "constructor", "prototype"].includes(id)
  ) {
    throw new Error("Invalid environment ID.");
  }
  const host = field("host", 255);
  if (
    !/^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*@)?[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(host)
  ) {
    throw new Error(
      "Use an SSH host alias or user@hostname. Configure ports and keys in ~/.ssh/config.",
    );
  }
  const executable = field("executable", 4096);
  if (executable !== "codex" && !path.posix.isAbsolute(executable)) {
    throw new Error(
      "Remote Codex executable must be codex or an absolute POSIX path.",
    );
  }
  return { id, name: field("name", 100), host, executable };
}
export function remotePath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.length > 4096 ||
    /[\x00-\x1f\x7f]/.test(value)
  ) {
    throw new Error(
      "Remote checkout must be an absolute POSIX path, without ~ expansion.",
    );
  }
  return path.posix.normalize(value);
}
export function remoteCheckoutPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 4096 ||
    /[\x00-\x1f\x7f]/.test(value)
  ) {
    throw new Error("Invalid remote checkout path.");
  }
  if (value.startsWith("/")) return remotePath(value);
  if (value.startsWith("~") && value !== "~" && !value.startsWith("~/"))
    throw new Error("Use ~/ for the remote user's home.");
  const relative = path.posix.normalize(
    value === "~" ? "." : value.replace(/^~\//, ""),
  );
  if (
    relative === ".." ||
    relative.startsWith("../") ||
    relative.startsWith("/")
  )
    throw new Error("A relative checkout must stay inside the remote home.");
  return relative === "." ? "~" : `~/${relative}`;
}
export function inferRemoteCheckoutPath(
  localPath: string | undefined,
  localHome: string,
): string | null {
  if (!localPath || !path.isAbsolute(localPath)) return null;
  const relative = path.relative(localHome, localPath);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    return null;
  return relative ? `~/${relative.split(path.sep).join("/")}` : "~";
}
export async function resolveRemoteCheckoutPath(
  client: CodexTransport,
  value: string,
): Promise<string> {
  const checkout = remoteCheckoutPath(value);
  if (checkout.startsWith("/")) return checkout;
  const home = remotePath(
    await remoteCommand(client, ["/bin/sh", "-c", 'printf "%s" "$HOME"']),
  );
  return path.posix.join(home, checkout === "~" ? "" : checkout.slice(2));
}
export function sshArgs(host: string, tty = false): string[] {
  // Never accept new host keys or prompt for passwords inside a hidden IPC process.
  return [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
    tty ? "-tt" : "-T",
    host,
  ];
}
export function remoteExecutableSetup(executable: string): string {
  if (executable !== "codex")
    return `codex_executable=${shellQuote(executable)}`;
  return [
    'codex_executable="$(command -v codex || true)"',
    'if test -z "$codex_executable"; then',
    '  for candidate in "$HOME/.local/bin/codex" /opt/homebrew/bin/codex /usr/local/bin/codex; do',
    '    if test -x "$candidate"; then codex_executable="$candidate"; break; fi',
    "  done",
    "fi",
    'if test -z "$codex_executable"; then',
    `  codex_executable="$("\${SHELL:-/bin/sh}" -lc 'command -v codex' 2>/dev/null | tail -n 1)"`,
    "fi",
    'if ! test -x "$codex_executable"; then',
    `  printf '%s\n' 'SSH connected, but Codex CLI was not found. Install it on the host or set its absolute executable path in Forge.' >&2`,
    "  exit 127",
    "fi",
  ].join("\n");
}

export async function connectProxyWebSocket(
  child: ChildProcessWithoutNullStreams,
): Promise<WebSocket> {
  // The proxy copies raw control-socket bytes. It does not translate JSONL.
  const stream = Duplex.from({ readable: child.stdout, writable: child.stdin });
  const socket = new WebSocket("ws://localhost/", {
    createConnection: () => stream,
    handshakeTimeout: 15_000,
    maxPayload: 16 * 1024 * 1024,
    perMessageDeflate: false,
  });
  let diagnostic = "";
  child.stderr.on("data", (data: Buffer) => {
    diagnostic = (diagnostic + data.toString()).slice(-4096);
  });
  socket.on("close", () => child.kill());
  socket.on("error", () => child.kill());
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
      child.once("error", reject);
      child.once("exit", (code) =>
        reject(
          new Error(
            `Remote Codex proxy exited (${code ?? "signal"}). ${diagnostic.trim() || "Check the managed daemon and its control socket on the host."}`,
          ),
        ),
      );
    });
    return socket;
  } catch (error) {
    socket.terminate();
    child.kill();
    throw new Error(
      diagnostic.trim() ||
        (error instanceof Error ? error.message : String(error)),
    );
  }
}

export class RemoteCodexClient extends CodexClient {
  constructor(readonly environment: CodexEnvironment) {
    super("", () => "", 90_000, true);
  }
  protected override async launch(): Promise<void> {
    const environment = validateEnvironment(this.environment);
    const { stdout } = await exec(
      "/usr/bin/ssh",
      [
        ...sshArgs(environment.host),
        [
          "set -eu",
          remoteExecutableSetup(environment.executable),
          `printf '%s\n' "$codex_executable"`,
          '"$codex_executable" --version',
          'schema_dir="$(mktemp -d)"',
          `trap 'rm -rf "$schema_dir"' EXIT`,
          '"$codex_executable" app-server generate-json-schema --experimental --out "$schema_dir"',
          'cat "$schema_dir/ClientRequest.json"',
        ].join("\n"),
      ],
      { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
    ).catch((error: unknown) => {
      const diagnostic = text(object(error).stderr).trim();
      throw new Error(
        diagnostic || (error instanceof Error ? error.message : String(error)),
      );
    });
    const separator = stdout.indexOf("\n");
    const executable = remotePath(stdout.slice(0, separator).trim());
    const versionEnd = stdout.indexOf("\n", separator + 1);
    this.version = stdout.slice(separator + 1, versionEnd).trim();
    const schema = stdout.slice(versionEnd + 1);
    assertCapabilities(schema);
    for (const method of ["command/exec", "thread/turns/list"]) {
      if (!schema.includes(JSON.stringify(method)))
        throw new Error(
          `Remote Codex CLI does not support ${method}. Update Codex CLI and its managed daemon.`,
        );
    }
    const child = spawn(
      "/usr/bin/ssh",
      [
        ...sshArgs(environment.host),
        `exec ${shellQuote(executable)} app-server proxy`,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    await this.connectProxy(child);
  }
  protected async connectProxy(
    child: ChildProcessWithoutNullStreams,
  ): Promise<void> {
    const socket = await connectProxyWebSocket(child);
    await this.connect(
      child,
      `Remote Codex proxy on ${this.environment.host}`,
      {
        send: (message) => socket.send(JSON.stringify(message)),
        subscribe: (listener) =>
          socket.on("message", (data, binary) => {
            if (binary) socket.close(1003, "Expected JSON text frames");
            else listener(data.toString());
          }),
      },
    );
  }
}
export async function remoteCommand(
  client: CodexTransport,
  command: string[],
  cwd?: string,
  hostAccess = false,
): Promise<string> {
  await client.start();
  const result = object(
    await client.request("command/exec", {
      command,
      ...(cwd ? { cwd } : {}),
      timeoutMs: 30_000,
      outputBytesCap: 256 * 1024,
      // Host permission probes must see real filesystem permissions, rather than
      // the sandbox's read-only mounts. Git setup also needs repository metadata access.
      // Only fixed Forge operations use host access; agent turn policies are separate.
      sandboxPolicy: hostAccess
        ? { type: "dangerFullAccess" }
        : { type: "readOnly", networkAccess: false },
    }),
  );
  if (result.exitCode !== 0) {
    throw new Error(
      text(result.stderr) ||
        `Remote command failed (${String(result.exitCode)}).`,
    );
  }
  return text(result.stdout).trim();
}
export async function checkEnvironment(
  environment: CodexEnvironment,
  repositoryPath?: string,
): Promise<CodexEnvironmentCheck> {
  const client = new RemoteCodexClient(validateEnvironment(environment));
  client.onEvent = (event) => {
    if (event.requestId !== undefined) client.rejectRequest(event.requestId);
  };
  try {
    await client.start();
    const status = await client.status();
    if (!status.connected)
      throw new Error(status.error || "Remote Codex is disconnected.");
    if (!status.authenticated)
      throw new Error(
        "Codex is not authenticated on the remote host. Run codex login --device-auth there.",
      );
    if (!(await client.models()).length)
      throw new Error("Remote Codex returned no available models.");
    await client.request("collaborationMode/list", {});
    const user = await remoteCommand(client, ["id", "-un"]);
    if (repositoryPath) {
      const folder = await resolveRemoteCheckoutPath(client, repositoryPath);
      await remoteCommand(client, [
        "/bin/sh",
        "-c",
        `test -d "$1" || { printf 'Remote checkout does not exist: %s\n' "$1" >&2; exit 1; }`,
        "forge-checkout",
        folder,
      ]);
      await remoteCommand(
        client,
        ["git", "rev-parse", "--verify", "HEAD^{commit}"],
        folder,
      );
      await remoteCommand(
        client,
        [
          "/bin/sh",
          "-c",
          [
            "set -eu",
            `test -w . || { printf 'Remote checkout is not writable by this user: %s\n' "$PWD" >&2; exit 1; }`,
            'common_dir="$(git rev-parse --git-common-dir)"',
            `test -w "$common_dir" || { printf 'Remote Git metadata is not writable by this user: %s\n' "$common_dir" >&2; exit 1; }`,
          ].join("\n"),
        ],
        folder,
        true,
      );
    }
    return {
      ready: true,
      version: status.version,
      message: `Connected as ${user.trim()}. Daemon, authentication, model catalog and command execution are available.${repositoryPath ? " Checkout is writable." : " Validate each project checkout in project configuration."}`,
    };
  } catch (error) {
    return {
      ready: false,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    client.stop();
  }
}
export async function assertRemoteWorktree(
  client: CodexTransport,
  thread: CodexThread,
): Promise<void> {
  if (!thread.worktree || !thread.branch || !thread.baseCommit)
    throw new Error("Remote worktree setup is incomplete.");
  const q = shellQuote;
  await remoteCommand(
    client,
    [
      "/bin/sh",
      "-c",
      [
        "set -eu",
        `test "$(git rev-parse --show-toplevel)" = "$(pwd -P)"`,
        `test "$(git branch --show-current)" = ${q(thread.branch)}`,
        `test "$(git rev-parse --path-format=absolute --git-common-dir)" = "$(git -C ${q(thread.repositoryPath)} rev-parse --path-format=absolute --git-common-dir)"`,
        `git cat-file -e ${q(thread.baseCommit + "^{commit}")}`,
      ].join("\n"),
    ],
    thread.worktree,
  );
}
export async function prepareRemoteWorktree(
  client: CodexTransport,
  thread: CodexThread,
  persist: () => void,
): Promise<void> {
  const q = shellQuote;
  if (!thread.worktree) {
    const root = await remoteCommand(
      client,
      ["git", "rev-parse", "--show-toplevel"],
      await resolveRemoteCheckoutPath(client, thread.repositoryPath),
    );
    thread.repositoryPath = remotePath(root);
    thread.baseCommit = thread.start
      ? await startBaseCommit((args) => remoteCommand(client, ["git", ...args], thread.repositoryPath), thread.start, true)
      : await remoteCommand(client, ["git", "rev-parse", "--verify", "HEAD^{commit}"], thread.repositoryPath);
    thread.branch = `codex/forge-${thread.id}`;
    if (
      !/^[a-f0-9-]{36}$/.test(thread.id) ||
      !/^[a-f0-9]{40,64}$/.test(thread.baseCommit)
    )
      throw new Error("Invalid remote worktree identity.");
    thread.worktree = path.posix.join(
      path.posix.dirname(thread.repositoryPath),
      ".forge-worktrees",
      path.posix.basename(thread.repositoryPath),
      thread.id,
    );
    persist(); // Record the intended path/branch/base before a command with an uncertain outcome.
  }
  const script = [
    "set -eu",
    `if ! test -e ${q(thread.worktree)}; then`,
    `  mkdir -p ${q(path.posix.dirname(thread.worktree))}`,
    `  if git show-ref --verify --quiet ${q("refs/heads/" + thread.branch)}; then`,
    `    test "$(git rev-parse ${q(thread.branch)})" = ${q(thread.baseCommit)}`,
    `    git worktree add ${q(thread.worktree)} ${q(thread.branch)}`,
    "  else",
    `    git worktree add -b ${q(thread.branch)} ${q(thread.worktree)} ${q(thread.baseCommit)}`,
    "  fi",
    "fi",
  ].join("\n");
  await remoteCommand(
    client,
    ["/bin/sh", "-c", script],
    thread.repositoryPath,
    true,
  );
  await assertRemoteWorktree(client, thread);
}
export function remoteTerminalCommand(thread: CodexThread): string {
  if (!thread.environment || !thread.worktree)
    throw new Error("Remote terminal has no working folder.");
  return `cd ${shellQuote(remotePath(thread.worktree))} && exec "\${SHELL:-/bin/sh}" -l`;
}
