import { EventEmitter } from "node:events";
import type { BrowserWindow, WebContents } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import { CodexThreadWindows, isThreadWindowCloseShortcut } from "../../electron/main/codex/windows";
import type { CodexThreadWindow } from "../../shared/codex";
class Window extends EventEmitter {
  webContents = Object.assign(new EventEmitter(), { send: vi.fn() });
  show = vi.fn(); focus = vi.fn(); restore = vi.fn(); isMinimized = () => false;
  destroy = vi.fn(() => this.emit("closed"));
  close = vi.fn(() => {
    const event = { preventDefault: vi.fn() };
    this.emit("close", event);
    if (!event.preventDefault.mock.calls.length) this.emit("closed");
  });
}
const cast = (win: Window) => win as unknown as BrowserWindow;
const sender = (win: Window) => win.webContents as unknown as WebContents;
const target: CodexThreadWindow = { repositoryId: "repo", id: "thread", title: "Task", fullName: "owner/repo", terminalOpen: true };
function setup() {
  const main = new Window(), created: Window[] = [], changed = vi.fn();
  let current: BrowserWindow | null = cast(main);
  const factory = vi.fn(() => { const window = new Window(); created.push(window); return cast(window); });
  const registry = new CodexThreadWindows(() => current, factory, changed);
  return { main, created, factory, registry, changed, closeMain: () => { current = null; } };
}
afterEach(() => vi.useRealTimers());
it("creates one window per thread and focuses an existing window without recreating execution", () => {
  const { registry, factory, created, changed } = setup();
  registry.open(target);
  registry.open(target);
  expect(factory).toHaveBeenCalledExactlyOnceWith(target);
  expect(created[0].focus).toHaveBeenCalledOnce();
  expect(registry.list()).toEqual([target]);
  expect(registry.context(sender(created[0]))).toEqual(target);
  expect(registry.windowFor(sender(created[0]))).toBe(created[0]);
  expect(changed).toHaveBeenCalledExactlyOnceWith({ repositoryId: "repo", threadId: "thread", windowChanged: true });
});
it("routes thread and terminal events to their window and supports closing the main window independently", () => {
  const { registry, main, created, closeMain } = setup();
  registry.open(target);
  registry.open({ ...target, id: "other" });
  registry.broadcast("codex:terminal", { repositoryId: "repo", id: "thread" });
  expect(main.webContents.send).toHaveBeenCalledOnce();
  expect(created[0].webContents.send).toHaveBeenCalledOnce();
  expect(created[1].webContents.send).not.toHaveBeenCalled();
  registry.broadcast("codex:changed", {});
  expect(created[1].webContents.send).toHaveBeenCalledOnce();
  closeMain();
  registry.broadcast("codex:changed", { threadId: "thread" });
  expect(created[0].webContents.send).toHaveBeenCalledTimes(3);
  expect(registry.windowFor(sender(main))).toBeUndefined();
});
it("waits for draft flushing before closing and releasing editing ownership", () => {
  const { registry, created, changed } = setup();
  registry.open(target);
  created[0].close();
  expect(registry.owner(target)).toBe(created[0]);
  expect(created[0].webContents.send).toHaveBeenCalledWith("codex:changed", { windowCloseRequested: true });
  registry.close(sender(created[0]));
  expect(registry.owner(target)).toBeUndefined();
  expect(registry.windowFor(sender(created[0]))).toBeUndefined();
  expect(changed).toHaveBeenCalledTimes(2);
});
it("allows a failed draft save to cancel native closure and recovers if a renderer crashes", () => {
  vi.useFakeTimers();
  const { registry, created } = setup();
  registry.open(target);
  created[0].close();
  registry.cancelClose(sender(created[0]));
  vi.advanceTimersByTime(4000);
  expect(created[0].destroy).not.toHaveBeenCalled();
  created[0].webContents.emit("render-process-gone");
  expect(registry.list()).toEqual([]);
});
it("can close unresponsive windows and does not block app shutdown", () => {
  vi.useFakeTimers();
  const { registry, created } = setup();
  registry.open(target);
  created[0].close();
  vi.advanceTimersByTime(3000);
  expect(registry.list()).toEqual([]);
  registry.open(target);
  registry.quitting = true;
  created[1].close();
  expect(registry.list()).toEqual([]);
});

it("keeps the native Mac close shortcut available while the terminal owns keyboard focus", () => {
  expect(isThreadWindowCloseShortcut({ type: "keyDown", key: "w", meta: true }, "darwin")).toBe(true);
  expect(isThreadWindowCloseShortcut({ type: "keyDown", key: "W", meta: true, shift: true }, "darwin")).toBe(false);
  expect(isThreadWindowCloseShortcut({ type: "keyDown", key: "w" }, "linux")).toBe(false);
});
