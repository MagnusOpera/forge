// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CodexSettingsDialog } from "./settings";
import {
  defaultCodexPreferences,
  type CodexApi,
  type CodexConfiguration,
} from "../../shared/codex";
import type { RepoSummary } from "../../shared/github";
let container: HTMLDivElement, root: Root;
const request = vi.fn();
const configuration: CodexConfiguration = {
  defaults: defaultCodexPreferences,
  editor: "Code",
  executable: "",
  environments: [
    {
      id: "ghoulix",
      name: "Ghoulix",
      host: "pct@ghoulix",
      executable: "codex",
      tmux: false,
    },
  ],
  projects: {
    repo: {
      repositoryId: "repo",
      path: "/local/forge",
      overrides: {},
      remotePaths: { ghoulix: "/srv/forge" },
    },
  },
};
const project: RepoSummary = {
  id: "repo",
  owner: "owner",
  name: "forge",
  fullName: "owner/forge",
  isPrivate: false,
  isArchived: false,
  isFork: false,
  url: "https://github.com/owner/forge",
};
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
      method === "models"
        ? []
        : method === "status"
          ? { connected: false, authenticated: false }
          : configuration,
    );
  window.forgeCodex = {
    request,
    onChanged: () => () => {},
    onTerminalEvent: () => () => {},
  } as CodexApi;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.forgeCodex;
});
it("keeps environment definitions global and edits existing checkout mappings only in the selected project", async () => {
  const props = {
    auth: null,
    onClose: vi.fn(),
    onSaveGithub: vi.fn(async () => {}),
    onRemoveGithub: vi.fn(),
    onOpenUrl: vi.fn(),
  };
  await act(async () => root.render(<CodexSettingsDialog {...props} />));
  const labels = () =>
    [...container.querySelectorAll("nav button")].map(
      (button) => button.textContent,
    );
  expect(labels()).toEqual(["General", "Accounts", "Environments", "Codex"]);
  await act(async () =>
    root.render(<CodexSettingsDialog {...props} project={project} />),
  );
  expect(labels()).toEqual([
    "Local checkout",
    "Remote checkouts",
    "Codex overrides",
  ]);
  const remote = [
    ...container.querySelectorAll<HTMLButtonElement>("nav button"),
  ].find((button) => button.textContent === "Remote checkouts")!;
  await act(async () => remote.click());
  expect(
    container.querySelector<HTMLInputElement>(
      '[aria-label="Ghoulix checkout path"]',
    )?.value,
  ).toBe("/srv/forge");
  const save = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent === "Save configuration")!;
  await act(async () => save.click());
  expect(request).toHaveBeenCalledWith("saveProject", {
    repositoryId: "repo",
    fullName: "owner/forge",
    overrides: {},
    remotePaths: { ghoulix: "/srv/forge" },
  });
  expect(props.onClose).toHaveBeenCalledOnce();
});

it("suggests the local home-relative layout for unmapped environments and shows only their names", async () => {
  const config: CodexConfiguration = {
    ...configuration,
    projects: { repo: { ...configuration.projects.repo, remotePaths: {} } },
  };
  request.mockImplementation(async (method) =>
    method === "configuration"
      ? config
      : method === "inferRemotePath"
        ? "~/src/forge"
        : method === "models"
          ? []
          : config,
  );
  await act(async () =>
    root.render(
      <CodexSettingsDialog
        auth={null}
        project={project}
        onClose={() => {}}
        onSaveGithub={async () => {}}
        onRemoveGithub={() => {}}
        onOpenUrl={() => {}}
      />,
    ),
  );
  const remote = [
    ...container.querySelectorAll<HTMLButtonElement>("nav button"),
  ].find((button) => button.textContent === "Remote checkouts")!;
  await act(async () => remote.click());
  expect(
    container.querySelector<HTMLInputElement>(
      '[aria-label="Ghoulix checkout path"]',
    )?.value,
  ).toBe("~/src/forge");
  expect(container.textContent).not.toContain("pct@ghoulix");
  expect(request).toHaveBeenCalledWith("inferRemotePath", {
    repositoryId: "repo",
  });
});

it("requires a local checkout before suggesting a remote layout", async () => {
  const config: CodexConfiguration = {
    ...configuration,
    projects: {
      repo: { ...configuration.projects.repo, path: "", remotePaths: {} },
    },
  };
  request.mockImplementation(async (method) =>
    method === "configuration" ? config : method === "models" ? [] : config,
  );
  await act(async () =>
    root.render(
      <CodexSettingsDialog
        auth={null}
        project={project}
        onClose={() => {}}
        onSaveGithub={async () => {}}
        onRemoveGithub={() => {}}
        onOpenUrl={() => {}}
      />,
    ),
  );
  const remote = [
    ...container.querySelectorAll<HTMLButtonElement>("nav button"),
  ].find((button) => button.textContent === "Remote checkouts")!;
  await act(async () => remote.click());
  expect(
    container.querySelector<HTMLInputElement>(
      '[aria-label="Ghoulix checkout path"]',
    )?.value,
  ).toBe("");
  expect(
    request.mock.calls.some(([method]) => method === "inferRemotePath"),
  ).toBe(false);
});

it("displays the local checkout with ~ while retaining its absolute operational path", async () => {
  request.mockImplementation(async (method) =>
    method === "inferRemotePath"
      ? "~/src/forge"
      : method === "models"
        ? []
        : configuration,
  );
  await act(async () =>
    root.render(
      <CodexSettingsDialog
        auth={null}
        project={project}
        onClose={() => {}}
        onSaveGithub={async () => {}}
        onRemoveGithub={() => {}}
        onOpenUrl={() => {}}
      />,
    ),
  );
  const displayed = container.querySelector<HTMLElement>(".codex-path")!;
  expect(displayed.textContent).toBe("~/src/forge");
  expect(displayed.title).toBe("/local/forge");
  expect(configuration.projects.repo.path).toBe("/local/forge");
});
