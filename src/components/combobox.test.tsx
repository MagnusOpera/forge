// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Combobox } from "./combobox";
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
  vi.restoreAllMocks();
});
it("opens on the selected option, skips disabled choices, supports search and restores focus on selection", () => {
  const change = vi.fn();
  act(() =>
    root.render(
      <Combobox
        label="Example"
        value="gamma"
        options={[
          { value: "alpha", label: "Alpha" },
          { value: "beta", label: "Beta", disabled: true },
          { value: "gamma", label: "Gamma" },
        ]}
        onChange={change}
      />,
    ),
  );
  const trigger =
    container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
  const menu = container.querySelector<HTMLDivElement>('[role="listbox"]')!;
  menu.removeAttribute("popover");
  const close = vi.fn();
  Object.assign(menu, {
    hidePopover: close,
    showPopover: () => {
      const event = new Event("toggle");
      Object.defineProperty(event, "newState", { value: "open" });
      menu.dispatchEvent(event);
    },
  });
  act(() =>
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  const options = menu.querySelectorAll<HTMLButtonElement>('[role="option"]');
  expect(document.activeElement).toBe(options[2]);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  act(() =>
    options[2].dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  expect(document.activeElement).toBe(options[0]);
  act(() =>
    options[0].dispatchEvent(
      new KeyboardEvent("keydown", { key: "g", bubbles: true }),
    ),
  );
  expect(document.activeElement).toBe(options[2]);
  act(() =>
    options[2].dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    ),
  );
  expect(document.activeElement).toBe(options[0]);
  act(() => options[0].click());
  expect(change).toHaveBeenCalledWith("alpha");
  expect(close).toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger);
  act(() =>
    options[0].dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(change).toHaveBeenCalledTimes(1);
});
it("keeps menus inside the viewport and respects disabled controls", () => {
  const change = vi.fn();
  const render = (disabled: boolean) =>
    act(() =>
      root.render(
        <Combobox
          label="Shortcut"
          value="enter"
          options={[{ value: "enter", label: "Enter" }]}
          onChange={change}
          disabled={disabled}
        />,
      ),
    );
  render(false);
  const trigger =
    container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
  vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
    left: window.innerWidth - 50,
    right: window.innerWidth,
    width: 300,
    top: window.innerHeight - 30,
    bottom: window.innerHeight,
  } as DOMRect);
  act(() => trigger.click());
  const menu = container.querySelector<HTMLElement>('[role="listbox"]')!;
  expect(
    Number.parseFloat(menu.style.left) + Number.parseFloat(menu.style.width),
  ).toBeLessThanOrEqual(window.innerWidth - 8);
  expect(menu.style.top).toBe("auto");
  render(true);
  act(() => trigger.click());
  expect(change).not.toHaveBeenCalled();
  expect(trigger.disabled).toBe(true);
});
