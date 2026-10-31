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
  expect(container.textContent).not.toContain("Save environments");
  // An incomplete new environment stays a draft until its host is supplied.
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(request).not.toHaveBeenCalled();
  await fillHost("new-host");
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(request).toHaveBeenCalledWith("saveEnvironments", {
    environments: [
      configuration.environments![0],
      expect.objectContaining({
        id: expect.any(String),
        name: "New environment",
        host: "new-host",
        executable: "codex",
        tmux: false,
      }),
    ],
  });
  const saved = request.mock.calls.find(
    ([method]) => method === "saveEnvironments",
  )![1].environments;
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
  const remove = container.querySelector<HTMLButtonElement>(
    '[aria-label="Delete New environment environment"]',
  )!;
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

function connectionButton(name = "Linux") {
  return container.querySelector<HTMLButtonElement>(
    `[aria-label="Check ${name} connection"]`,
  )!;
}
async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function fillHost(value: string) {
  await fill(
    container.querySelector<HTMLInputElement>(
      'input[placeholder="linux-dev"]',
    )!,
    value,
  );
}
function mockEnvironmentRequests() {
  request.mockImplementation(async (method, input) =>
    method === "checkEnvironment"
      ? { ready: true, message: "Ready" }
      : { ...configuration, environments: input.environments },
  );
}
it("debounces environment edits, saves automatically and shows readiness beside the SSH host", async () => {
  mockEnvironmentRequests();
  const changed = vi.fn();
  await act(async () =>
    root.render(
      <EnvironmentsEditor configuration={configuration} onChange={changed} />,
    ),
  );
  expect(container.textContent).not.toContain("Check connection");
  expect(container.textContent).not.toContain("Save environments");
  await fillHost("first-host");
  await act(async () => vi.advanceTimersByTimeAsync(300));
  await fillHost("final-host");
  await act(async () => vi.advanceTimersByTimeAsync(599));
  expect(request).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  const environment = { ...configuration.environments![0], host: "final-host" };
  expect(request).toHaveBeenCalledWith("checkEnvironment", { environment });
  expect(request).toHaveBeenCalledWith("saveEnvironments", {
    environments: [environment],
  });
  expect(request).toHaveBeenCalledTimes(2);
  expect(connectionButton().classList.contains("good")).toBe(true);
  expect(changed).toHaveBeenCalledOnce();
  expect(container.querySelector('[role="status"]')).toBeNull();
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find((option) => option.textContent === "tmux")!
      .click(),
  );
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(request).toHaveBeenLastCalledWith("saveEnvironments", {
    environments: [{ ...environment, tmux: true }],
  });
  await fill(
    container.querySelector<HTMLInputElement>(
      'input[placeholder="/home/user/.local/bin/codex"]',
    )!,
    "/opt/codex",
  );
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(request).toHaveBeenCalledWith("checkEnvironment", {
    environment: { ...environment, tmux: true, executable: "/opt/codex" },
  });
});
it("allows immediate checks, clears stale results on edits and ignores responses from another environment", async () => {
  mockEnvironmentRequests();
  let finish!: (result: { ready: boolean; message: string }) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () =>
    root.render(
      <EnvironmentsEditor configuration={configuration} onChange={() => {}} />,
    ),
  );
  await act(async () => connectionButton().click());
  expect(connectionButton().getAttribute("aria-busy")).toBe("true");
  expect(
    container.querySelector<HTMLInputElement>('input[placeholder="linux-dev"]')!
      .disabled,
  ).toBe(false);
  await fillHost("new-host");
  expect(connectionButton().classList.contains("unchecked")).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(connectionButton().classList.contains("good")).toBe(true);
  await act(async () => finish({ ready: false, message: "Old host failed" }));
  expect(connectionButton().classList.contains("good")).toBe(true);
  expect(container.textContent).not.toContain("Old host failed");
  request.mockRejectedValueOnce(new Error("Host unreachable"));
  await act(async () => connectionButton().click());
  expect(connectionButton().classList.contains("bad")).toBe(true);
  expect(container.textContent).toContain("Host unreachable");
  await act(async () => addOption().click());
  expect(
    connectionButton("New environment").classList.contains("unchecked"),
  ).toBe(true);
  expect(connectionButton("New environment").disabled).toBe(true);
});
it("cancels the delayed check after a manual check or empty host and hides trash when there is no selection", async () => {
  mockEnvironmentRequests();
  await act(async () =>
    root.render(
      <EnvironmentsEditor configuration={configuration} onChange={() => {}} />,
    ),
  );
  const selector = container.querySelector(".codex-environment-selector")!;
  expect(
    selector.querySelector('[aria-label="Delete Linux environment"]'),
  ).not.toBeNull();
  await act(async () => connectionButton().click());
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(request).toHaveBeenCalledTimes(1);
  await fillHost("");
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        '[aria-label="Delete Linux environment"]',
      )!
      .click(),
  );
  expect(selector.querySelector('[title="Delete environment"]')).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(request).toHaveBeenLastCalledWith("saveEnvironments", {
    environments: [],
  });
});
it("serializes saves and persists a revert even if the previous save has not finished", async () => {
  mockEnvironmentRequests();
  let finish!: (result: CodexConfiguration) => void;
  request.mockImplementation(async (method, input) =>
    method === "checkEnvironment"
      ? { ready: true, message: "Ready" }
      : input.environments[0]?.host === "new-host"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : { ...configuration, environments: input.environments },
  );
  const changed = vi.fn();
  await act(async () =>
    root.render(
      <EnvironmentsEditor configuration={configuration} onChange={changed} />,
    ),
  );
  await fillHost("new-host");
  await act(async () => vi.advanceTimersByTimeAsync(600));
  await fillHost("dev@host");
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(
    request.mock.calls.filter(([method]) => method === "saveEnvironments"),
  ).toHaveLength(1);
  await act(async () =>
    finish({
      ...configuration,
      environments: [{ ...configuration.environments![0], host: "new-host" }],
    }),
  );
  expect(request).toHaveBeenLastCalledWith("saveEnvironments", {
    environments: configuration.environments,
  });
  expect(changed).toHaveBeenCalledExactlyOnceWith(configuration);
});
it("flushes pending valid edits when leaving settings and reports failed automatic saves", async () => {
  mockEnvironmentRequests();
  await act(async () =>
    root.render(
      <EnvironmentsEditor configuration={configuration} onChange={() => {}} />,
    ),
  );
  await fillHost("new-host");
  await act(async () => root.render(null));
  expect(request).toHaveBeenCalledExactlyOnceWith("saveEnvironments", {
    environments: [{ ...configuration.environments![0], host: "new-host" }],
  });
  await act(async () =>
    root.render(
      <EnvironmentsEditor configuration={configuration} onChange={() => {}} />,
    ),
  );
  request.mockImplementation(async (method) => {
    if (method === "saveEnvironments") throw new Error("Disk full");
    return { ready: true, message: "Ready" };
  });
  await fillHost("other-host");
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Disk full",
  );
});

it("places terminal persistence beside the executable and preserves None as a valid saved choice", async () => {
  mockEnvironmentRequests();
  await act(async () =>
    root.render(
      <EnvironmentsEditor
        configuration={{
          ...configuration,
          environments: [{ ...configuration.environments![0], tmux: true }],
        }}
        onChange={() => {}}
      />,
    ),
  );
  const row = container.querySelector(".codex-environment-runtime")!;
  expect(
    row.querySelector('input[placeholder="/home/user/.local/bin/codex"]'),
  ).not.toBeNull();
  expect(
    row.querySelector('[aria-label="Terminal persistence"]')?.textContent,
  ).toBe("tmux");
  expect(row.querySelector('input[type="checkbox"]')).toBeNull();
  await act(async () =>
    [...row.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find((option) => option.textContent === "None")!
      .click(),
  );
  expect(
    row.querySelector('[aria-label="Terminal persistence"]')?.textContent,
  ).toBe("None");
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(request).toHaveBeenCalledWith("saveEnvironments", {
    environments: configuration.environments,
  });
  expect(request).toHaveBeenCalledWith("checkEnvironment", {
    environment: configuration.environments![0],
  });
});
