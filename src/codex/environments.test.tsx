// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EnvironmentsEditor, ProjectEnvironments } from "./environments";
import {
  defaultCodexPreferences,
  type CodexApi,
  type CodexConfiguration,
} from "../../shared/codex";
let container: HTMLDivElement, root: Root;
const request = vi.fn();
const configuration: CodexConfiguration = {
  defaults: defaultCodexPreferences,
  editor: "Code",
  executable: "",
  projects: {},
  environments: [
    {
      id: "linux",
      name: "Linux",
      host: "dev@host",
      executable: "codex",
      tmux: false,
    },
  ],
};
beforeEach(() => {
  vi.useFakeTimers();
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  request.mockReset().mockImplementation(async (_method, input) => ({
    ...configuration,
    environments: input.environments,
  }));
  window.forgeCodex = { request } as unknown as CodexApi;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.forgeCodex;
  vi.useRealTimers();
});
function addOption() {
  return [
    ...container.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ].find((option) => option.textContent === "Add environment…")!;
}
it("creates and selects a new draft from the selector without replacing an existing environment or saving the action item", async () => {
  const changed = vi.fn();
  await act(async () =>
    root.render(
      <EnvironmentsEditor configuration={configuration} onChange={changed} />,
    ),
  );
  expect(container.querySelector('[role="combobox"]')?.textContent).toContain(
    "Linux",
  );
  await act(async () => addOption().click());
  expect(container.querySelector('[role="combobox"]')?.textContent).toContain(
    "New environment",
  );
  expect(container.querySelector<HTMLInputElement>("input")?.value).toBe(
    "New environment",
  );
  expect(request).not.toHaveBeenCalled();
  const save = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent === "Save environments")!;
  await act(async () => save.click());
  expect(request).toHaveBeenCalledWith("saveEnvironments", {
    environments: [
      configuration.environments![0],
      expect.objectContaining({
        id: expect.any(String),
        name: "New environment",
        host: "",
        executable: "codex",
        tmux: false,
      }),
    ],
  });
  const saved = request.mock.calls[0][1].environments;
  expect(saved[1].id).not.toBe("__create_environment__");
  expect(changed).toHaveBeenCalledOnce();
});
it("keeps creation available when no environments exist or the last draft is removed", async () => {
  await act(async () =>
    root.render(
      <EnvironmentsEditor
        configuration={{ ...configuration, environments: [] }}
        onChange={() => {}}
      />,
    ),
  );
  expect(container.querySelector('[role="combobox"]')?.textContent).toContain(
    "Add environment…",
  );
  await act(async () => addOption().click());
  const remove = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent?.trim() === "Remove")!;
  await act(async () => remove.click());
  expect(container.querySelector('[role="combobox"]')?.textContent).toContain(
    "Add environment…",
  );
  expect(container.querySelector("input")).toBeNull();
  await act(async () => addOption().click());
  expect(container.querySelector<HTMLInputElement>("input")?.value).toBe(
    "New environment",
  );
});

function checkButton(name = "Linux") {
  return container.querySelector<HTMLButtonElement>(
    `button[aria-label="Check ${name} checkout"]`,
  )!;
}
it("checks from the inline icon, shows green or red feedback, and clears it when the path changes", async () => {
  const render = async (path: string) =>
    act(async () =>
      root.render(
        <ProjectEnvironments
          configuration={configuration}
          paths={{ linux: path }}
          onChange={() => {}}
        />,
      ),
    );
  await render("");
  expect(checkButton().disabled).toBe(true);
  expect(checkButton().classList.contains("unchecked")).toBe(true);
  await render("~/src/repo");
  request.mockResolvedValueOnce({ ready: true, message: "Ready" });
  await act(async () => checkButton().click());
  expect(request).toHaveBeenLastCalledWith("checkEnvironment", {
    environment: configuration.environments![0],
    repositoryPath: "~/src/repo",
  });
  expect(checkButton().classList.contains("good")).toBe(true);
  await render("~/src/other");
  expect(checkButton().classList.contains("unchecked")).toBe(true);
  expect(container.querySelector('[role="status"]')).toBeNull();
  request.mockResolvedValueOnce({
    ready: false,
    message: "Checkout does not exist",
  });
  await act(async () => checkButton().click());
  expect(checkButton().classList.contains("bad")).toBe(true);
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    "Checkout does not exist",
  );
  request.mockRejectedValueOnce(new Error("SSH connection lost"));
  await act(async () => checkButton().click());
  expect(checkButton().classList.contains("bad")).toBe(true);
  expect(container.textContent).toContain("SSH connection lost");
});

it("ignores a stale check after the path is edited and a newer check succeeds", async () => {
  let finish!: (result: { ready: boolean; message: string }) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const render = async (path: string) =>
    act(async () =>
      root.render(
        <ProjectEnvironments
          configuration={configuration}
          paths={{ linux: path }}
          onChange={() => {}}
        />,
      ),
    );
  await render("~/old");
  await act(async () => checkButton().click());
  expect(checkButton().getAttribute("aria-busy")).toBe("true");
  await render("~/new");
  expect(checkButton().disabled).toBe(false);
  request.mockResolvedValueOnce({ ready: true, message: "New checkout ready" });
  await act(async () => checkButton().click());
  expect(checkButton().classList.contains("good")).toBe(true);
  await act(async () =>
    finish({ ready: false, message: "Old checkout missing" }),
  );
  expect(checkButton().classList.contains("good")).toBe(true);
  expect(container.textContent).not.toContain("Old checkout missing");
});

it("keeps validation feedback independent for each environment", async () => {
  const config = {
    ...configuration,
    environments: [
      ...configuration.environments!,
      { ...configuration.environments![0], id: "other", name: "Other" },
    ],
  };
  await act(async () =>
    root.render(
      <ProjectEnvironments
        configuration={config}
        paths={{ linux: "~/repo", other: "~/other" }}
        onChange={() => {}}
      />,
    ),
  );
  request.mockResolvedValueOnce({ ready: true, message: "Ready" });
  await act(async () => checkButton().click());
  request.mockResolvedValueOnce({ ready: false, message: "Missing" });
  await act(async () => checkButton("Other").click());
  expect(checkButton().classList.contains("good")).toBe(true);
  expect(checkButton("Other").classList.contains("bad")).toBe(true);
});

it("debounces path checks, validates only the latest input, and keeps success feedback in the icon", async () => {
  request.mockResolvedValue({ ready: true, message: "Checkout is ready." });
  const render = async (path: string) =>
    act(async () =>
      root.render(
        <ProjectEnvironments
          configuration={configuration}
          paths={{ linux: path }}
          onChange={() => {}}
        />,
      ),
    );
  await render("~/src/first");
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(request).not.toHaveBeenCalled();
  await render("~/src/final");
  await act(async () => vi.advanceTimersByTimeAsync(599));
  expect(request).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(request).toHaveBeenCalledExactlyOnceWith("checkEnvironment", {
    environment: configuration.environments![0],
    repositoryPath: "~/src/final",
  });
  expect(checkButton().classList.contains("good")).toBe(true);
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(container.textContent).not.toContain("Checkout is ready.");
});

it("checks immediately on an icon click without repeating the pending debounce, and cancels checks for empty input", async () => {
  request.mockResolvedValue({ ready: true, message: "Ready" });
  const render = async (path: string) =>
    act(async () =>
      root.render(
        <ProjectEnvironments
          configuration={configuration}
          paths={{ linux: path }}
          onChange={() => {}}
        />,
      ),
    );
  await render("~/repo");
  await act(async () => checkButton().click());
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(request).toHaveBeenCalledTimes(1);
  await render("~/changed");
  await act(async () => vi.advanceTimersByTimeAsync(300));
  await render("");
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(request).toHaveBeenCalledTimes(1);
});
