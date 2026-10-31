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
  request.mockReset().mockImplementation(async (method) =>
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
    root.render(
      <EnvironmentPicker
        onConfigure={() => {}}
        thread={item()}
        onChange={changed}
      />,
    ),
  );
  const trigger = container.querySelector('[role="combobox"]')!;
  expect(trigger.textContent).toContain("Local");
  expect(container.textContent).not.toContain("Unbound");
  expect(container.textContent).not.toContain("dev@host");
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
    root.render(
      <EnvironmentPicker
        onConfigure={() => {}}
        thread={thread}
        onChange={changed}
      />,
    ),
  );
  expect(container.querySelector('[role="combobox"]')).toBeNull();
  expect(container.textContent).toContain("Linux");
  expect(container.textContent).not.toContain("dev@host");
  expect(container.querySelector("code")).toBeNull();
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

it("hides checkout paths and opens project configuration when the selected environment has no checkout", async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (method, input) => {
    const result = await original(method, input);
    return method === "configuration" ? { ...result, projects: {} } : result;
  });
  const configure = vi.fn();
  await act(async () =>
    root.render(
      <EnvironmentPicker
        thread={item()}
        onChange={async () => {}}
        onConfigure={configure}
      />,
    ),
  );
  expect(container.querySelector("code")).toBeNull();
  expect(container.textContent).not.toContain("/local/repo");
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find(
        (button) =>
          button.getAttribute("aria-label") === "Open project configuration",
      )!
      .click(),
  );
  expect(configure).toHaveBeenCalledOnce();
});

it("checks Local before suggesting configuration and keeps the button hidden when validation succeeds", async () => {
  const original = request.getMockImplementation()!;
  let finish!: (result: { ready: boolean; message: string }) => void;
  request.mockImplementation(async (method, input) =>
    method === "checkProjectCheckout"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : original(method, input),
  );
  await act(async () =>
    root.render(
      <EnvironmentPicker
        thread={item()}
        onChange={async () => {}}
        onConfigure={() => {}}
      />,
    ),
  );
  expect(request).toHaveBeenCalledWith("checkProjectCheckout", {
    repositoryId: "repo",
    environmentId: "local",
  });
  expect(
    container.querySelector('[aria-label="Open project configuration"]'),
  ).toBeNull();
  await act(async () => finish({ ready: true, message: "Ready" }));
  expect(
    container.querySelector('[aria-label="Open project configuration"]'),
  ).toBeNull();
});
it("opens configuration only after a local checkout check fails", async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (method, input) =>
    method === "checkProjectCheckout"
      ? { ready: false, message: "Repository was moved" }
      : original(method, input),
  );
  const configure = vi.fn();
  await act(async () =>
    root.render(
      <EnvironmentPicker
        thread={item()}
        onChange={async () => {}}
        onConfigure={configure}
      />,
    ),
  );
  const button = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find(
    (button) =>
      button.getAttribute("aria-label") === "Open project configuration",
  )!;
  expect(button.title).toContain("Repository was moved");
  await act(async () => button.click());
  expect(configure).toHaveBeenCalledOnce();
});
it("validates the remote checkout and ignores a late response after switching targets", async () => {
  const original = request.getMockImplementation()!;
  let finish!: (result: { ready: boolean; message: string }) => void;
  request.mockImplementation(async (method, input) =>
    method !== "checkProjectCheckout"
      ? original(method, input)
      : input.environmentId === "linux"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : { ready: false, message: "Local checkout missing" },
  );
  await act(async () =>
    root.render(
      <EnvironmentPicker
        thread={{ ...item(), environment }}
        onChange={async () => {}}
        onConfigure={() => {}}
      />,
    ),
  );
  expect(request).toHaveBeenCalledWith("checkProjectCheckout", {
    repositoryId: "repo",
    environmentId: "linux",
  });
  expect(
    container.querySelector('[aria-label="Open project configuration"]'),
  ).toBeNull();
  await act(async () =>
    root.render(
      <EnvironmentPicker
        thread={item()}
        onChange={async () => {}}
        onConfigure={() => {}}
      />,
    ),
  );
  expect(
    container.querySelector('[aria-label="Open project configuration"]'),
  ).not.toBeNull();
  await act(async () =>
    finish({ ready: true, message: "Remote checkout ready" }),
  );
  expect(
    container.querySelector('[aria-label="Open project configuration"]'),
  ).not.toBeNull();
});

it.each([undefined, environment])(
  "keeps empty archived threads read-only for target %s",
  async (target) => {
    await act(async () =>
      root.render(
        <EnvironmentPicker
          thread={{ ...item(), archived: true, environment: target }}
          onChange={async () => {}}
          onConfigure={() => {}}
        />,
      ),
    );
    expect(container.querySelector('[role="combobox"]')).toBeNull();
    expect(
      container.querySelector('[aria-label="Open project configuration"]'),
    ).toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe(
      target?.name ?? "Local",
    );
    expect(
      request.mock.calls.some(
        ([method]) =>
          method === "checkProjectCheckout" || method === "setEnvironment",
      ),
    ).toBe(false);
  },
);

it.each(["idle", "running", "waiting"] as const)(
  "does not offer reconnect for an established %s remote thread",
  async (state) => {
    await act(async () =>
      root.render(
        <EnvironmentPicker
          compact
          thread={{
            ...item(),
            environment,
            serverId: "server",
            worktree: "/srv/worktree",
            state,
          }}
          onChange={async () => {}}
          onConfigure={() => {}}
        />,
      ),
    );
    expect(container.textContent).not.toContain("Reconnect");
    expect(container.textContent).not.toContain("Environment");
    expect(container.textContent).toContain("Linux");
  },
);
