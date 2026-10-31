import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { IPty, IPtyForkOptions } from "node-pty";
import type { CodexThread } from "../../../shared/codex.js";
import {
  terminalDimensions,
  type TerminalEvent,
  type TerminalSnapshot,
} from "../../../shared/terminal.js";
import { assertWorktree } from "./git.js";
export type PtyFactory = (
  shell: string,
  args: string[],
  options: IPtyForkOptions,
) => IPty | Promise<IPty>;
const MAX_BUFFER = 1024 * 1024;
const WINDOW = 128 * 1024;
type Session = TerminalSnapshot & {
  pty: IPty;
  attached: boolean;
  acknowledged: number;
  paused: boolean;
  pending: string;
  timer?: NodeJS.Timeout;
  subscriptions: { dispose(): void }[];
};
export function terminalEnvironment(
  source: NodeJS.ProcessEnv,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source))
    if (
      value !== undefined &&
      (/^(HOME|USER|LOGNAME|SHELL|PATH|TMPDIR|LANG|SSH_AUTH_SOCK|XDG_CONFIG_HOME|XDG_DATA_HOME)$/.test(
        key,
      ) ||
        key.startsWith("LC_"))
    )
      result[key] = value;
  return {
    ...result,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "Forge",
  };
}
export class TerminalManager {
  private sessions = new Map<string, Session>();
  private opening = new Set<string>();
  private pendingOpen = new Map<string, Promise<TerminalSnapshot>>();
  private shuttingDown = false;
  private cancelledOpening = new Set<string>();
  constructor(
    private emit: (event: TerminalEvent) => void,
    private spawn: PtyFactory = async (...args) =>
      (await import("node-pty")).spawn(...args),
  ) {}
  has(id: string): boolean {
    return this.sessions.has(id) || this.opening.has(id);
  }
  private target(session: Session) {
    return {
      id: session.id,
      repositoryId: session.repositoryId,
      sessionId: session.sessionId,
      attachmentId: session.attachmentId,
    };
  }
  private snapshot(session: Session): TerminalSnapshot {
    const {
      id,
      repositoryId,
      sessionId,
      attachmentId,
      cwd,
      cols,
      rows,
      data,
      sequence,
      exited,
      exitCode,
    } = session;
    return {
      id,
      repositoryId,
      sessionId,
      attachmentId,
      cwd,
      cols,
      rows,
      data,
      sequence,
      exited,
      exitCode,
    };
  }
  private get(thread: CodexThread, sessionId: string): Session {
    const session = this.sessions.get(thread.id);
    if (
      !session ||
      session.sessionId !== sessionId ||
      session.repositoryId !== thread.repositoryId
    )
      throw new Error("This terminal session is no longer available.");
    return session;
  }
  private flush(session: Session) {
    clearTimeout(session.timer);
    session.timer = undefined;
    const data = session.pending;
    session.pending = "";
    if (session.attached && data)
      this.emit({ ...this.target(session), sequence: session.sequence, data });
  }
  private flow(session: Session) {
    const pause =
      session.attached && session.sequence - session.acknowledged >= WINDOW;
    if (pause !== session.paused && !session.exited) {
      session.paused = pause;
      if (pause) session.pty.pause();
      else session.pty.resume();
    }
  }
  async open(
    thread: CodexThread,
    cols: unknown,
    rows: unknown,
    attachmentId: string = randomUUID(),
  ): Promise<TerminalSnapshot> {
    terminalDimensions(cols, rows);
    while (this.pendingOpen.has(thread.id))
      await this.pendingOpen.get(thread.id)!.catch(() => undefined);
    const pending = this.attach(thread, cols, rows, attachmentId);
    this.pendingOpen.set(thread.id, pending);
    try {
      return await pending;
    } finally {
      if (this.pendingOpen.get(thread.id) === pending)
        this.pendingOpen.delete(thread.id);
    }
  }
  private async attach(
    thread: CodexThread,
    cols: unknown,
    rows: unknown,
    attachmentId: string = randomUUID(),
  ): Promise<TerminalSnapshot> {
    const size = terminalDimensions(cols, rows);
    if (this.shuttingDown) throw new Error("Forge is quitting.");
    if (thread.archived || thread.mergedInto)
      throw new Error(
        "Restore the chat and finish checkout changes before opening its terminal.",
      );
    if (this.opening.has(thread.id))
      throw new Error("This terminal is already starting. Try again.");
    if (
      !this.sessions.has(thread.id) &&
      this.sessions.size + this.opening.size >= 32
    )
      throw new Error(
        "Close an existing terminal before opening another (32 sessions maximum).",
      );
    this.opening.add(thread.id);
    this.cancelledOpening.delete(thread.id);
    try {
      await assertWorktree(thread);
      if (this.cancelledOpening.has(thread.id) || this.shuttingDown)
        throw new Error("Terminal start cancelled.");
      let session = this.sessions.get(thread.id);
      if (session && session.cwd !== thread.worktree) {
        this.close(thread, session.sessionId);
        session = undefined;
      }
      if (session) {
        this.flush(session);
        session.attached = true;
        session.attachmentId = attachmentId;
        session.acknowledged = session.sequence;
        if (!session.exited) {
          session.pty.resize(size.cols, size.rows);
          session.cols = size.cols;
          session.rows = size.rows;
        }
        this.flow(session);
        return this.snapshot(session);
      }
      if (this.sessions.size >= 32)
        throw new Error(
          "Close an existing terminal before opening another (32 sessions maximum).",
        );
      const cwd = thread.worktree;
      const preferred = os.userInfo().shell || process.env.SHELL || "/bin/zsh";
      const shell = path.isAbsolute(preferred) ? preferred : "/bin/zsh";
      const pty = await this.spawn(shell, ["-l"], {
        cwd,
        cols: size.cols,
        rows: size.rows,
        name: "xterm-256color",
        env: terminalEnvironment(process.env),
      });
      if (
        this.cancelledOpening.has(thread.id) ||
        this.shuttingDown ||
        thread.worktree !== cwd ||
        thread.archived
      ) {
        pty.kill();
        throw new Error(
          "The chat checkout changed while the terminal was starting.",
        );
      }
      session = {
        id: thread.id,
        repositoryId: thread.repositoryId,
        sessionId: randomUUID(),
        attachmentId,
        cwd,
        ...size,
        data: "",
        sequence: 0,
        exited: false,
        pty,
        attached: true,
        acknowledged: 0,
        paused: false,
        pending: "",
        subscriptions: [],
      };
      const current = session;
      this.sessions.set(thread.id, current);
      current.subscriptions.push(
        pty.onData((data) => {
          if (this.sessions.get(thread.id) !== current) return;
          current.data = (current.data + data).slice(-MAX_BUFFER);
          current.sequence += data.length;
          if (current.attached) {
            current.pending += data;
            if (!current.timer)
              current.timer = setTimeout(() => this.flush(current), 16);
            this.flow(current);
          }
        }),
        pty.onExit(({ exitCode }) => {
          if (this.sessions.get(thread.id) !== current) return;
          this.flush(current);
          current.exited = true;
          current.exitCode = exitCode;
          if (current.attached)
            this.emit({
              ...this.target(current),
              sequence: current.sequence,
              exited: true,
              exitCode,
            });
        }),
      );
      return this.snapshot(current);
    } finally {
      this.opening.delete(thread.id);
      this.cancelledOpening.delete(thread.id);
    }
  }
  write(thread: CodexThread, sessionId: string, data: unknown) {
    if (typeof data !== "string" || data.length > 64 * 1024)
      throw new Error("Invalid terminal input.");
    const session = this.get(thread, sessionId);
    if (thread.archived || session.cwd !== thread.worktree || session.exited)
      throw new Error(
        "This terminal is no longer connected to the chat checkout.",
      );
    session.pty.write(data);
  }
  resize(thread: CodexThread, sessionId: string, cols: unknown, rows: unknown) {
    const size = terminalDimensions(cols, rows),
      session = this.get(thread, sessionId);
    if (!session.exited) session.pty.resize(size.cols, size.rows);
    session.cols = size.cols;
    session.rows = size.rows;
  }
  acknowledge(
    thread: CodexThread,
    sessionId: string,
    sequence: unknown,
    attachmentId?: string,
  ) {
    const session = this.get(thread, sessionId);
    if (attachmentId && attachmentId !== session.attachmentId) return;
    if (
      !Number.isSafeInteger(sequence) ||
      Number(sequence) < 0 ||
      Number(sequence) > session.sequence
    )
      throw new Error("Invalid terminal output acknowledgement.");
    session.acknowledged = Math.max(session.acknowledged, Number(sequence));
    this.flow(session);
  }
  detach(thread: CodexThread, sessionId: string, attachmentId?: string) {
    const session = this.sessions.get(thread.id);
    if (
      !session ||
      session.sessionId !== sessionId ||
      (attachmentId && attachmentId !== session.attachmentId)
    )
      return;
    session.attached = false;
    this.flush(session);
    this.flow(session);
  }
  close(thread: CodexThread, sessionId?: string) {
    if (!sessionId && this.opening.has(thread.id))
      this.cancelledOpening.add(thread.id);
    const session = this.sessions.get(thread.id);
    if (!session || (sessionId && session.sessionId !== sessionId)) return;
    this.sessions.delete(thread.id);
    clearTimeout(session.timer);
    session.subscriptions.forEach((subscription) => subscription.dispose());
    if (!session.exited) {
      try {
        session.pty.kill();
      } catch {
        /* Already exited. */
      }
    }
    this.emit({
      ...this.target(session),
      sequence: session.sequence,
      exited: true,
    });
  }
  dispose() {
    this.shuttingDown = true;
    for (const session of this.sessions.values())
      this.close({ id: session.id } as CodexThread);
  }
}
