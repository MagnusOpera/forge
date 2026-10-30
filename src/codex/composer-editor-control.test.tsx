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
