// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ComposerEditor } from "./composer-editor";
it("does not treat busy-state changes or a send reset as edits to the draft", () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container),
    change = vi.fn();
  const render = (value: string, disabled: boolean) =>
    act(() =>
      root.render(
        <ComposerEditor
          value={value}
          disabled={disabled}
          onChange={change}
          onSend={() => {}}
          placeholder="Ask Codex…"
        />,
      ),
    );
  try {
    render("Sent message", false);
    render("Sent message", true);
    render("", false);
    expect(container.querySelector('[role="textbox"]')!.textContent).toBe("");
    expect(change).not.toHaveBeenCalled();
    render("Next message", false);
    expect(container.querySelector('[role="textbox"]')!.textContent).toBe(
      "Next message",
    );
    expect(change).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("handles Command/Ctrl+Enter on the mounted textbox and updates the shortcut without remounting", () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container),
    send = vi.fn();
  const render = (sendShortcut: "enter" | "command-enter") =>
    act(() =>
      root.render(
        <ComposerEditor
          value="Hello"
          disabled={false}
          onChange={() => {}}
          onSend={send}
          placeholder="Ask"
          sendShortcut={sendShortcut}
        />,
      ),
    );
  const press = (init: KeyboardEventInit) =>
    act(() =>
      container
        .querySelector('[role="textbox"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
            ...init,
          }),
        ),
    );
  try {
    render("enter");
    press({ metaKey: true });
    expect(send).toHaveBeenCalledTimes(1);
    press({ ctrlKey: true });
    expect(send).toHaveBeenCalledTimes(2);
    press({});
    expect(send).toHaveBeenCalledTimes(3);
    render("command-enter");
    press({});
    expect(send).toHaveBeenCalledTimes(3);
    expect(container.querySelectorAll('[role="textbox"] p').length).toBe(2);
    press({ metaKey: true });
    expect(send).toHaveBeenCalledTimes(4);
    press({ isComposing: true, metaKey: true });
    expect(send).toHaveBeenCalledTimes(4);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
