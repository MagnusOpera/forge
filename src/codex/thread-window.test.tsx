// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ThreadWindow } from "./thread-window";
import type { CodexApi, CodexChange } from "../../shared/codex";
import { defaultCodexPreferences } from "../../shared/codex";
const mocks = vi.hoisted(() => ({ flush: vi.fn(async () => {}) }));
vi.mock("./thread-drafts", () => ({ flushThreadDraft: mocks.flush }));
vi.mock("./conversation", () => ({
  CodexConversation: () => <div aria-label="Conversation" />,
}));
vi.mock("./terminal-panel", () => ({
  TerminalPanel: () => <div aria-label="Terminal" />,
}));
vi.mock("./quick-actions", () => ({ CodexQuickActions: () => null }));
vi.mock("./settings", () => ({ CodexSettingsDialog: () => null }));
let root: Root, container: HTMLDivElement;
const request = vi.fn();
const listeners = new Set<(change: CodexChange) => void>();
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  localStorage.clear();
  mocks.flush.mockReset().mockResolvedValue();
  listeners.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  request.mockReset().mockImplementation(async (method) =>
    method === "threadWindowContext"
      ? {
          repositoryId: "repo",
          id: "thread",
          title: "Task",
          fullName: "owner/repo",
          terminalOpen: true,
        }
      : method === "list"
        ? [
            {
              id: "thread",
              repositoryId: "repo",
              title: "Task",
              settings: defaultCodexPreferences,
              worktree: "/repo",
              state: "idle",
              archived: false,
            },
          ]
        : undefined,
  );
  window.forgeCodex = {
    request,
    onTerminalEvent: () => () => {},
    onChanged: (callback) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
  } as CodexApi;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.forgeCodex;
  vi.unstubAllGlobals();
});
it("renders only thread content, toolbar and the existing terminal, without repository navigation", async () => {
  await act(async () => root.render(<ThreadWindow />));
  expect(container.querySelector('[aria-label="Conversation"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Terminal"]')).not.toBeNull();
  expect(container.querySelector(".sidebar")).toBeNull();
  expect(
    container.querySelector('[aria-label="Open project in GitHub"]'),
  ).toBeNull();
  expect(
    container.querySelector('[aria-label="Project configuration"]'),
  ).toBeNull();
  expect(
    container.querySelector('[aria-label="Global configuration"]'),
  ).toBeNull();
  expect(container.querySelector('[aria-label="Toggle theme"]')).toBeNull();
  expect(
    container
      .querySelector('[aria-label="Toggle terminal"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("true");
  expect(document.title).toContain("Task · owner/repo");
  const title = container.querySelector(".content-header-left strong")!;
  expect(
    title.parentElement?.nextElementSibling?.classList.contains(
      "header-actions",
    ),
  ).toBe(true);
  expect(
    title.parentElement?.nextElementSibling?.querySelector(
      '[aria-label="Toggle terminal"]',
    ),
  ).not.toBeNull();
  expect(
    container.querySelector('[aria-label="Close thread window"]'),
  ).toBeNull();
});
it("flushes the draft before closing the window", async () => {
  await act(async () => root.render(<ThreadWindow />));
  await act(async () => {
    listeners.forEach((listener) => listener({ windowCloseRequested: true }));
  });
  expect(mocks.flush).toHaveBeenCalledExactlyOnceWith("repo", "thread");
  expect(request).toHaveBeenCalledWith("closeThreadWindow", {});
});
it("keeps the window open if the draft cannot be saved", async () => {
  mocks.flush.mockRejectedValue(new Error("Disk full"));
  await act(async () => root.render(<ThreadWindow />));
  await act(async () => {
    listeners.forEach((listener) => listener({ windowCloseRequested: true }));
  });
  expect(request).toHaveBeenCalledWith("cancelThreadWindowClose", {});
  expect(
    request.mock.calls.some(([method]) => method === "closeThreadWindow"),
  ).toBe(false);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Disk full",
  );
});

it("follows shared theme changes without exposing a theme selector", async () => {
  await act(async () => root.render(<ThreadWindow />));
  expect(
    container.querySelector(".thread-window-shell")?.getAttribute("data-theme"),
  ).toBe("light");
  await act(async () => {
    localStorage.setItem("github-focus:theme", JSON.stringify("dark"));
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "github-focus:theme",
        newValue: JSON.stringify("dark"),
      }),
    );
  });
  expect(
    container.querySelector(".thread-window-shell")?.getAttribute("data-theme"),
  ).toBe("dark");
});
