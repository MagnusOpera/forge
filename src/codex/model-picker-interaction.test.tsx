// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ModelPicker } from "./model-picker";
import { defaultCodexPreferences, type CodexModel } from "../../shared/codex";
const models: CodexModel[] = [
  {
    id: "sol",
    name: "Sol",
    efforts: ["low", "medium", "high"],
    defaultEffort: "medium",
    isDefault: true,
    fast: true,
    images: true,
  },
];
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});
it("renders a keyboard-navigable HTML model list and preserves effort capabilities", async () => {
  const change = vi.fn();
  act(() =>
    root.render(
      <ModelPicker
        value={{ ...defaultCodexPreferences, model: "sol" }}
        models={models}
        disabled={false}
        onChange={change}
      />,
    ),
  );
  // jsdom does not implement opening a native popover; reveal its contents for focus tests.
  container.querySelector("[popover]")!.removeAttribute("popover");
  act(() =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Choose model"]')!
      .click(),
  );
  const options =
    container.querySelectorAll<HTMLButtonElement>('[role="option"]');
  expect(options).toHaveLength(2);
  expect(document.activeElement).toBe(options[1]);
  act(() =>
    options[1].dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    ),
  );
  expect(document.activeElement).toBe(options[0]);
  act(() => options[0].click());
  expect(change).toHaveBeenCalledWith(expect.objectContaining({ model: "" }));
  expect(container.querySelector("select")).toBeNull();
});
it("saves accessibility/native range changes even when no pointerup event arrives", () => {
  vi.useFakeTimers();
  const change = vi.fn();
  act(() =>
    root.render(
      <ModelPicker
        value={{ ...defaultCodexPreferences, model: "sol" }}
        models={models}
        disabled={false}
        onChange={change}
      />,
    ),
  );
  const range = container.querySelector<HTMLInputElement>(
    'input[type="range"]',
  )!;
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(range, "2");
    range.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(range.getAttribute("aria-valuetext")).toBe("High");
  act(() => vi.advanceTimersByTime(200));
  expect(change).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ effort: "high" }),
  );
});

it("centers the popover above its trigger while keeping it inside the viewport", () => {
  act(() =>
    root.render(
      <ModelPicker
        value={defaultCodexPreferences}
        models={models}
        disabled={false}
        onChange={() => {}}
      />,
    ),
  );
  const trigger = container.querySelector<HTMLButtonElement>(
    ".codex-model-trigger",
  )!;
  const panel = container.querySelector<HTMLElement>(".codex-model-popover")!;
  const bounds = vi.spyOn(trigger, "getBoundingClientRect");
  try {
    for (const [viewport, left, width, expected] of [
      [800, 300, 120, 226],
      [800, 0, 120, 8],
      [800, 740, 60, 524],
      [200, 40, 120, 8],
    ]) {
      vi.stubGlobal("innerWidth", viewport);
      bounds.mockReturnValue({ left, width, top: 500 } as DOMRect);
      act(() => trigger.click());
      expect(panel.style.left).toBe(`${expected}px`);
    }
  } finally {
    vi.unstubAllGlobals();
    bounds.mockRestore();
  }
});
