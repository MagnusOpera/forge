import {
  spawn,
  execFile,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { promisify } from "node:util";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import type {
  CodexModel,
  CodexStatus,
  JsonObject,
} from "../../../shared/codex.js";

export const object = (v: unknown): JsonObject =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as JsonObject)
    : {};
export const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const text = (v: unknown): string => (typeof v === "string" ? v : "");
export type RpcEvent = {
  method: string;
  params: JsonObject;
  requestId?: string | number;
};
export interface CodexTransport {
  start(): Promise<void>;
  request(method: string, params: JsonObject): Promise<unknown>;
  respond(id: string | number, result: JsonObject): void;
  rejectRequest(id: string | number): void;
  stop(): void;
  onEvent: (event: RpcEvent) => void;
}
const exec = promisify(execFile);
export function resolveCodexExecutable(override = ""): string {
  const candidates = override
    ? [override]
    : [
        ...(process.env.PATH ?? "")
          .split(path.delimiter)
          .filter(Boolean)
          .map((dir) => path.join(dir, "codex")),
        "/opt/homebrew/bin/codex",
        "/usr/local/bin/codex",
        path.join(os.homedir(), ".local/bin/codex"),
      ];
  for (const file of candidates) {
    if (!path.isAbsolute(file)) continue;
    try {
      accessSync(file, constants.X_OK);
      return file;
    } catch {
      /* Try the next executable. */
    }
  }
  throw new Error(
    "Codex CLI was not found. Install Codex CLI, restart Forge, or select its executable in global configuration.",
  );
}
export function assertCapabilities(schema: string): void {
  for (const method of [
    "thread/start",
    "thread/resume",
    "turn/start",
    "turn/steer",
    "turn/interrupt",
    "model/list",
    "collaborationMode/list",
    "account/login/start",
  ]) {
    if (!schema.includes(`\"${method}\"`))
      throw new Error(
        `Installed Codex CLI does not support ${method}. Update Codex CLI or choose a compatible executable in global configuration.`,
      );
  }
}
export function mapModels(value: unknown): CodexModel[] {
  return array(object(value).data)
    .map(object)
    .filter((m) => typeof m.model === "string" && m.hidden !== true)
    .map((m) => ({
      id: text(m.model),
      name: text(m.displayName) || text(m.model),
      efforts: array(m.supportedReasoningEfforts).map((e) =>
        text(object(e).reasoningEffort),
      ),
      defaultEffort: text(m.defaultReasoningEffort),
      isDefault: m.isDefault === true,
      fast:
        array(m.serviceTiers).some((t) =>
          ["fast", "priority"].includes(text(object(t).id)),
        ) ||
        array(m.additionalSpeedTiers).some(
          (t) => t === "fast" || t === "priority",
        ),
      images:
        !Array.isArray(m.inputModalities) ||
        m.inputModalities.includes("image"),
    }));
}
export class CodexRpcError extends Error {}
export class CodexClient implements CodexTransport {
  private child: ChildProcessWithoutNullStreams | null = null;
  private sendMessage: ((message: JsonObject) => void) | null = null;
  private starting: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private serverRequests = new Set<string | number>();
  protected version = "";
  onEvent: (event: RpcEvent) => void = () => undefined;
  constructor(
    private home: string,
    private executable: () => string,
    private timeoutMs = 30_000,
    private sharedHome = false,
  ) {}
  async start(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.child) return;
    this.starting = this.launch()
      .catch((error) => {
        this.stop();
        throw error;
      })
      .finally(() => {
        this.starting = null;
      });
    return this.starting;
  }
  protected async launch(): Promise<void> {
    const executable = resolveCodexExecutable(this.executable());
    const schemaDir = mkdtempSync(path.join(os.tmpdir(), "forge-codex-"));
    try {
      const version = await exec(executable, ["--version"], {
        timeout: 10_000,
      });
      this.version = version.stdout.trim();
      await exec(
        executable,
        [
          "app-server",
          "generate-json-schema",
          "--out",
          schemaDir,
          "--experimental",
        ],
        { timeout: 30_000 },
      );
      if (!existsSync(path.join(schemaDir, "ClientRequest.json")))
        throw new Error(
          "Codex CLI could not describe its app-server capabilities. Update Codex CLI.",
        );
      assertCapabilities(
        readFileSync(path.join(schemaDir, "ClientRequest.json"), "utf8"),
      );
      if (this.sharedHome) {
        const schema = readFileSync(
          path.join(schemaDir, "ClientRequest.json"),
          "utf8",
        );
        for (const method of ["thread/list", "thread/read"])
          if (!schema.includes(`"${method}"`))
            throw new Error(
              `Installed Codex CLI does not support ${method}. Update Codex CLI to browse existing threads.`,
            );
      }
    } finally {
      rmSync(schemaDir, { recursive: true, force: true });
    }
    mkdirSync(this.home, { recursive: true, mode: 0o700 });
    const child = spawn(
      executable,
      [
        "app-server",
        "--listen",
        "stdio://",
        ...(this.sharedHome ? [] : ["-c", 'cli_auth_credentials_store="file"']),
        "-c",
        "features.default_mode_request_user_input=true",
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          CODEX_HOME: this.home,
          CODEX_SQLITE_HOME: this.sharedHome
            ? process.env.CODEX_SQLITE_HOME || this.home
            : this.home,
        },
      },
    );
    await this.connect(child);
  }
  protected async connect(
    child: ChildProcessWithoutNullStreams,
    label = "Codex app-server",
    wire?: {
      send: (message: JsonObject) => void;
      subscribe: (listener: (line: string) => void) => void;
    },
  ): Promise<void> {
    this.child = child;
    this.sendMessage =
      wire?.send ??
      ((message) => {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      });
    const receive = (line: string) => {
      if (this.child === child) this.onLine(line);
    };
    if (wire) wire.subscribe(receive);
    else readline.createInterface({ input: child.stdout }).on("line", receive);
    child.stdin.on("error", (error: Error) => {
      if (this.child !== child) return;
      this.child = null;
      child.kill();
      this.fail(error);
    });
    let diagnostic = "";
    child.stderr.on("data", (data: Buffer) => {
      diagnostic = (diagnostic + data.toString()).slice(-4096);
    });
    child.once("error", (error) => {
      if (this.child === child) {
        this.child = null;
        this.fail(error);
      }
    });
    child.once("exit", (code) => {
      if (this.child === child) {
        this.child = null;
        this.fail(
          new Error(
            `${label} exited (${code ?? "signal"}). ${diagnostic.trim() || "Resume the thread to reconnect."}`,
          ),
        );
      }
    });
    await this.request("initialize", {
      clientInfo: { name: "forge", title: "Forge", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    this.write({ method: "initialized", params: {} });
  }
  private write(message: JsonObject): void {
    if (!this.child) throw new Error("Codex is disconnected.");
    this.sendMessage!(message);
  }
  // Public for focused protocol tests; input is always decoded as untrusted JSON.
  onLine(line: string): void {
    let message: JsonObject;
    try {
      message = object(JSON.parse(line));
    } catch {
      return;
    }
    if (typeof message.method === "string") {
      const id = message.id;
      if (id !== undefined && typeof id !== "string" && typeof id !== "number")
        return;
      if (id !== undefined) this.serverRequests.add(id);
      if (message.method === "serverRequest/resolved") {
        const resolved = object(message.params).requestId;
        if (typeof resolved === "string" || typeof resolved === "number")
          this.serverRequests.delete(resolved);
      }
      this.onEvent({
        method: message.method,
        params: object(message.params),
        ...(id === undefined ? {} : { requestId: id }),
      });
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error)
      pending.reject(
        new CodexRpcError(
          text(object(message.error).message) || "Codex request failed.",
        ),
      );
    else pending.resolve(message.result);
  }
  request(method: string, params: JsonObject): Promise<unknown> {
    if (!this.child) return Promise.reject(new Error("Codex is disconnected."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `Codex request timed out: ${method}. Its outcome may be unknown; do not automatically retry.`,
          ),
        );
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  respond(id: string | number, result: JsonObject): void {
    if (!this.serverRequests.has(id))
      throw new Error("This Codex request is no longer pending.");
    this.write({ id, result });
    this.serverRequests.delete(id);
  }
  rejectRequest(id: string | number): void {
    this.write({
      id,
      error: {
        code: -32601,
        message:
          "Forge does not support this request. Do not bypass its restrictions.",
      },
    });
    this.serverRequests.delete(id);
  }
  private fail(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.serverRequests.clear();
    this.onEvent({
      method: "connection/failed",
      params: { message: error.message },
    });
  }
  stop(): void {
    const child = this.child;
    this.child = null;
    child?.kill();
    if (!child && !this.pending.size) {
      this.serverRequests.clear();
      return;
    }
    this.fail(new Error("Codex stopped. Resume the thread to reconnect."));
  }
  async status(): Promise<CodexStatus> {
    try {
      await this.start();
      const account = object(
        object(await this.request("account/read", { refreshToken: false }))
          .account,
      );
      return {
        connected: true,
        authenticated: Object.keys(account).length > 0,
        email: text(account.email),
        plan: text(account.planType),
        version: this.version,
      };
    } catch (error) {
      return {
        connected: false,
        authenticated: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  async models(): Promise<CodexModel[]> {
    await this.start();
    const all: CodexModel[] = [];
    let cursor: string | undefined;
    do {
      const result = object(
        await this.request("model/list", {
          limit: 100,
          includeHidden: false,
          ...(cursor ? { cursor } : {}),
        }),
      );
      all.push(...mapModels(result));
      cursor = text(result.nextCursor) || undefined;
    } while (cursor);
    return all;
  }
}
