// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CodexSettingsDialog } from "./settings";
import { initializeDisplayPaths } from "../paths";
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
afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  delete window.forgeCodex;
  await initializeDisplayPaths();
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
  expect(labels()).toEqual(["General", "Environments", "GitHub", "Codex"]);
  await act(async () =>
    root.render(<CodexSettingsDialog {...props} project={project} />),
  );
  expect(labels()).toEqual(["GitHub", "Codex"]);
  const remote = [
    ...container.querySelectorAll<HTMLButtonElement>("nav button"),
  ].find((button) => button.textContent === "GitHub")!;
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
    accountOverride: false,
    defaultEnvironment: "local",
    defaultThreadStart: null,
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
  ].find((button) => button.textContent === "GitHub")!;
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
  ].find((button) => button.textContent === "GitHub")!;
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

const props = {
  auth: null,
  onClose: vi.fn(),
  onSaveGithub: vi.fn(async () => {}),
  onRemoveGithub: vi.fn(),
  onOpenUrl: vi.fn(),
};
async function navigate(label: string) {
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>("nav button")]
      .find((b) => b.textContent === label)!
      .click(),
  );
}
it("shows tildified local executable and editor fields but saves absolute paths", async () => {
  const config = { ...configuration, editor: "/Users/alice/Applications/Editor.app", executable: "/Users/alice/bin/codex" };
  request.mockImplementation(async (method) => method === "displayContext"
    ? { homeDirectory: "/Users/alice", platform: "darwin" }
    : method === "models" ? [] : method === "status" ? { connected: false, authenticated: false } : config);
  await initializeDisplayPaths();
  await act(async () => root.render(<CodexSettingsDialog {...props} />));
  await navigate("General");
  const editor = container.querySelector<HTMLInputElement>('[aria-label="Text editor application"]')!;
  expect(editor.value).toBe("~/Applications/Editor.app");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setValue.call(editor, "~/Applications/Other.app"); editor.dispatchEvent(new Event("input", { bubbles: true })); });
  await navigate("Codex");
  expect([...container.querySelectorAll("input")].some(input => input.value === "~/bin/codex")).toBe(true);
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Save configuration")!.click());
  expect(request).toHaveBeenCalledWith("saveConfiguration", expect.objectContaining({ editor: "/Users/alice/Applications/Other.app", executable: "/Users/alice/bin/codex" }));
});
it("places GitHub token controls in GitHub and account controls in Codex", async () => {
  await act(async () => root.render(<CodexSettingsDialog {...props} />));
  await navigate("GitHub");
  expect(container.querySelector('input[type="password"]')).not.toBeNull();
  expect(container.textContent).not.toContain("Codex account");
  await navigate("Codex");
  expect(container.querySelector('input[type="password"]')).toBeNull();
  expect(container.textContent).toContain("Codex account");
  expect(container.textContent).toContain("Codex defaults");
});
it("signs in to a project account separately and saves its override", async () => {
  request.mockImplementation(async (method, input) =>
    method === "models"
      ? []
      : method === "status"
        ? {
            connected: true,
            authenticated: false,
            email: input.repositoryId
              ? "project@example.invalid"
              : "global@example.invalid",
          }
        : configuration,
  );
  await act(async () =>
    root.render(<CodexSettingsDialog {...props} project={project} />),
  );
  await navigate("Codex");
  expect(container.textContent).toContain("the global account");
  expect(container.textContent).not.toContain("Sign in with ChatGPT");
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .click(),
  );
  expect(request).toHaveBeenCalledWith("status", { repositoryId: "repo" });
  expect(request).toHaveBeenCalledWith("models", {
    repositoryId: "repo",
    accountOverride: true,
  });
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent === "Sign in with ChatGPT")!
      .click(),
  );
  expect(request).toHaveBeenCalledWith("login", { repositoryId: "repo" });
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent === "Cancel sign-in")!
      .click(),
  );
  expect(request).toHaveBeenCalledWith("cancelLogin", { repositoryId: "repo" });
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent === "Save configuration")!
      .click(),
  );
  expect(request).toHaveBeenCalledWith(
    "saveProject",
    expect.objectContaining({ repositoryId: "repo", accountOverride: true }),
  );
});
it("restores a saved account override and routes project sign-out correctly", async () => {
  const config = {
    ...configuration,
    projects: {
      repo: { ...configuration.projects.repo, accountOverride: true },
    },
  };
  request.mockImplementation(async (method) =>
    method === "models"
      ? []
      : method === "status"
        ? {
            connected: true,
            authenticated: true,
            email: "project@example.invalid",
          }
        : config,
  );
  await act(async () =>
    root.render(<CodexSettingsDialog {...props} project={project} />),
  );
  await navigate("Codex");
  expect(
    container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .checked,
  ).toBe(true);
  expect(container.textContent).toContain("project@example.invalid");
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent === "Sign out")!
      .click(),
  );
  expect(request).toHaveBeenCalledWith("logout", { repositoryId: "repo" });
});

it("groups local and remote checkouts and saves the project's selected default environment", async () => {
  const config = {
    ...configuration,
    projects: {
      repo: { ...configuration.projects.repo, defaultEnvironment: "ghoulix" },
    },
  };
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (method, input) =>
    method === "configuration" ? config : original(method, input),
  );
  await act(async () =>
    root.render(<CodexSettingsDialog {...props} project={project} />),
  );
  expect(
    [...container.querySelectorAll("nav button")].map(
      (button) => button.textContent,
    ),
  ).toEqual(["GitHub", "Codex"]);
  expect(container.textContent).toContain("Local Git folder");
  expect(
    container.querySelector('[aria-label="Ghoulix checkout path"]'),
  ).not.toBeNull();
  const selector = container
    .querySelector('[aria-label="Default environment"]')!
    .closest(".combobox")!;
  expect(selector.querySelector('[role="combobox"]')?.textContent).toBe(
    "Ghoulix",
  );
  await act(async () =>
    [...selector.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find((option) => option.textContent === "Local")!
      .click(),
  );
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Save configuration")!
      .click(),
  );
  expect(request).toHaveBeenCalledWith(
    "saveProject",
    expect.objectContaining({
      repositoryId: "repo",
      defaultEnvironment: "local",
    }),
  );
});

const settingsProps = { auth: null, onClose: () => {}, onSaveGithub: async () => {}, onRemoveGithub: () => {}, onOpenUrl: () => {} };
async function selectStart(label: string) {
  const field = container.querySelector('[aria-label="Default thread starting point"]')!.closest(".combobox")!;
  await act(async () => [...field.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(option => option.textContent === label)!.click());
}
async function saveSettings() {
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Save configuration")!.click());
}
it("keeps Worktree as the global default and saves the starting point from GitHub settings", async () => {
  await act(async () => root.render(<CodexSettingsDialog {...settingsProps} />));
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("nav button")].find(button => button.textContent === "GitHub")!.click());
  expect(container.querySelector('[aria-label="Default thread starting point"]')?.textContent).toContain("Worktree from default branch HEAD");
  await selectStart("Current repository branch");
  await saveSettings();
  expect(request).toHaveBeenCalledWith("saveConfiguration", expect.objectContaining({ defaultThreadStart: "current" }));
});
it("shows the inherited global default, saves a project choice, and can reset it to inheritance", async () => {
  const config = { ...configuration, defaultThreadStart: "current" };
  request.mockImplementation(async method => method === "models" ? [] : config);
  await act(async () => root.render(<CodexSettingsDialog {...settingsProps} project={project} />));
  expect(container.querySelector('[aria-label="Default thread starting point"]')?.textContent).toContain("Use global default (Current repository branch)");
  await selectStart("New branch from default branch");
  await saveSettings();
  expect(request).toHaveBeenCalledWith("saveProject", expect.objectContaining({ defaultThreadStart: "new" }));
  await selectStart("Use global default (Current repository branch)");
  await saveSettings();
  expect(request).toHaveBeenCalledWith("saveProject", expect.objectContaining({ defaultThreadStart: null }));
});
it("restores a saved project starting point", async () => {
  const config = { ...configuration, defaultThreadStart: "current", projects: { repo: { ...configuration.projects.repo, defaultThreadStart: "default" } } };
  request.mockImplementation(async method => method === "models" ? [] : config);
  await act(async () => root.render(<CodexSettingsDialog {...settingsProps} project={project} />));
  expect(container.querySelector('[aria-label="Default thread starting point"]')?.textContent).toBe("Default branch checkout");
});
