import type { BrowserWindow, WebContents } from "electron";
import type { CodexChange, CodexThreadWindow } from "../../../shared/codex.js";

const key = (target: { repositoryId: string; id: string }) =>
  `${target.repositoryId}:${target.id}`;

export function isThreadWindowCloseShortcut(
  input: {
    type: string;
    key: string;
    meta?: boolean;
    shift?: boolean;
    alt?: boolean;
  },
  platform = process.platform,
): boolean {
  return (
    platform === "darwin" &&
    input.type === "keyDown" &&
    input.meta === true &&
    !input.shift &&
    !input.alt &&
    input.key.toLowerCase() === "w"
  );
}

/** Tracks window identity independently of renderer-supplied URLs and thread IDs. */
export class CodexThreadWindows {
  private entries = new Map<
    string,
    {
      window: BrowserWindow;
      target: CodexThreadWindow;
      closing: boolean;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();
  quitting = false;
  constructor(
    private main: () => BrowserWindow | null,
    private create: ((target: CodexThreadWindow) => BrowserWindow) | undefined,
    private changed: (change: CodexChange) => void,
  ) {}
  list(): CodexThreadWindow[] {
    return [...this.entries.values()].map((entry) => entry.target);
  }
  windowFor(sender: WebContents): BrowserWindow | undefined {
    const main = this.main();
    if (main?.webContents === sender) return main;
    return [...this.entries.values()].find(
      (entry) => entry.window.webContents === sender,
    )?.window;
  }
  context(sender: WebContents): CodexThreadWindow | null {
    return (
      [...this.entries.values()].find(
        (entry) => entry.window.webContents === sender,
      )?.target ?? null
    );
  }
  owner(target: {
    repositoryId: string;
    id: string;
  }): BrowserWindow | undefined {
    return this.entries.get(key(target))?.window;
  }
  open(target: CodexThreadWindow): void {
    const existing = this.owner(target);
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return;
    }
    if (!this.create) throw new Error("Thread windows are unavailable.");
    const window = this.create(target);
    const entry = {
      window,
      target,
      closing: false,
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
    };
    this.entries.set(key(target), entry);
    window.on("close", (event) => {
      if (entry.closing || this.quitting) return;
      event.preventDefault();
      if (entry.timer) return;
      window.webContents.send("codex:changed", { windowCloseRequested: true });
      // A crashed or unresponsive renderer must never trap a native window open.
      entry.timer = setTimeout(() => window.destroy(), 3000);
    });
    window.on("closed", () => {
      clearTimeout(entry.timer);
      if (this.entries.get(key(target)) !== entry) return;
      this.entries.delete(key(target));
      this.changed({
        repositoryId: target.repositoryId,
        threadId: target.id,
        windowChanged: true,
      });
    });
    window.webContents.on("render-process-gone", () => window.destroy());
    this.changed({
      repositoryId: target.repositoryId,
      threadId: target.id,
      windowChanged: true,
    });
  }
  cancelClose(sender: WebContents): void {
    const context = this.context(sender);
    if (!context) throw new Error("This is not a thread window.");
    const entry = this.entries.get(key(context))!;
    clearTimeout(entry.timer);
    entry.timer = undefined;
  }
  close(sender: WebContents): void {
    const context = this.context(sender);
    if (!context) throw new Error("This is not a thread window.");
    const entry = this.entries.get(key(context))!;
    entry.closing = true;
    entry.window.close();
  }
  broadcast(
    channel: string,
    payload: { repositoryId?: string; threadId?: string; id?: string },
  ): void {
    const main = this.main();
    if (main && !main.isDestroyed?.() && !main.webContents.isDestroyed?.())
      main.webContents.send(channel, payload);
    for (const { window, target } of this.entries.values()) {
      if (window.isDestroyed?.() || window.webContents.isDestroyed?.())
        continue;
      if (payload.repositoryId && payload.repositoryId !== target.repositoryId)
        continue;
      const threadId = payload.threadId ?? payload.id;
      if (threadId && threadId !== target.id) continue;
      window.webContents.send(channel, payload);
    }
  }
}
