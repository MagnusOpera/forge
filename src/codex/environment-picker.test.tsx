// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EnvironmentPicker } from "./environment-picker";
import {
  defaultCodexPreferences,
  type CodexApi,
  type CodexThread,
} from "../../shared/codex";
let container: HTMLDivElement;
let root: Root;
const request = vi.fn();
const environment = {
  id: "linux",
  name: "Linux",
  host: "dev@host",
  executable: "codex",
  tmux: true,
};
const item = (): CodexThread => ({
  id: "thread",
  repositoryId: "repo",
  title: "New thread",
  archived: false,
  createdAt: "",
  updatedAt: "",
  settings: defaultCodexPreferences,
  state: "idle",
  worktree: "",
  branch: "",
  baseCommit: "",
  serverId: "",
  repositoryPath: "/local/repo",
  items: [],
  requests: [],
  queue: [],
  queuePaused: false,
  draft: "",
  draftAttachments: [],
});
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  request
    .mockReset()
    .mockImplementation(async (method) =>
      method === "configuration"
        ? {
            environments: [
              environment,
              { ...environment, id: "unbound", name: "Unbound" },
            ],
            projects: {
              repo: {
                path: "/local/repo",
                remotePaths: { linux: "/srv/repo" },
              },
            },
          }
        : undefined,
    );
  window.forgeCodex = {
    request,
    onChanged: () => () => {},
  } as unknown as CodexApi;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.forgeCodex;
});
it("defaults new threads to Local and only offers remote environments with a project placement", async () => {
  const changed = vi.fn(async () => {});
  await act(async () =>
    root.render(<EnvironmentPicker thread={item()} onChange={changed} />),
  );
  const trigger = container.querySelector('[role="combobox"]')!;
  expect(trigger.textContent).toContain("Local");
  expect(container.textContent).not.toContain("Unbound");
  const option = [
    ...container.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ].find((entry) => entry.textContent?.includes("Linux"))!;
  await act(async () => option.click());
  expect(request).toHaveBeenCalledWith("setEnvironment", {
    repositoryId: "repo",
    id: "thread",
    environmentId: "linux",
  });
  expect(changed).toHaveBeenCalledOnce();
});
it("keeps an established remote target visible and reconciles without changing it", async () => {
  const thread = {
    ...item(),
    environment,
    worktree: "/srv/worktree",
    serverId: "server",
    state: "interrupted" as const,
  };
  const changed = vi.fn(async () => {});
  await act(async () =>
    root.render(<EnvironmentPicker thread={thread} onChange={changed} />),
  );
  expect(container.querySelector('[role="combobox"]')).toBeNull();
  expect(container.textContent).toContain("Linux · dev@host");
  expect(container.textContent).toContain("/srv/worktree");
  const reconnect = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((entry) => entry.textContent === "Reconnect")!;
  await act(async () => reconnect.click());
  expect(request).toHaveBeenCalledWith("reconnect", {
    repositoryId: "repo",
    id: "thread",
  });
  expect(
    request.mock.calls.some(
      ([method]) => method === "send" || method === "setEnvironment",
    ),
  ).toBe(false);
});
