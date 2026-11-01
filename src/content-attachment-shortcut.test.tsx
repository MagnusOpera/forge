// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isContentAttachmentShortcut, useContentAttachmentShortcut } from "./content-attachment-shortcut";
import { DetachablePane, useDetachablePane } from "./detachable-pane";

let root: Root, container: HTMLDivElement, frame: HTMLIFrameElement;
let pane: ReturnType<typeof useDetachablePane>;
const onReattach = vi.fn();
function Content({ enabled }: { enabled: boolean }) {
  useContentAttachmentShortcut(() => pane.detached ? pane.reattach() : pane.detach(), enabled && !pane.opening);
  return <textarea defaultValue="Unsent draft" />;
}
function Harness({ enabled = true }: { enabled?: boolean }) {
  pane = useDetachablePane({ onReattach });
  return <DetachablePane pane={pane} theme="dark" accent="#123456" title="Task"><Content enabled={enabled} /></DetachablePane>;
}
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  onReattach.mockReset();
  container = document.createElement("div");
  frame = document.createElement("iframe");
  document.body.append(container, frame);
  vi.spyOn(window, "open").mockReturnValue(frame.contentWindow);
  vi.spyOn(frame.contentWindow!, "focus").mockImplementation(() => {});
  vi.spyOn(frame.contentWindow!, "close").mockImplementation(() => {});
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => { pane.reattach(); root.unmount(); });
  container.remove();
  frame.remove();
  vi.restoreAllMocks();
});
async function press(target: EventTarget, overrides: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: "D", metaKey: true, shiftKey: true, bubbles: true, cancelable: true, ...overrides });
  await act(async () => { target.dispatchEvent(event); });
  return event;
}
it("detaches from the editor and reattaches from the detached window without remounting the draft", async () => {
  const editor = container.querySelector("textarea")!;
  editor.setSelectionRange(2, 6);
  expect((await press(editor)).defaultPrevented).toBe(true);
  expect(window.open).toHaveBeenCalledOnce();
  await act(async () => { window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data: "forge-content-ready" })); });
  expect(pane.detached).toBe(true);
  expect(frame.contentDocument!.querySelector("textarea")).toBe(editor);
  await press(window);
  expect(pane.detached).toBe(true);
  await press(editor);
  expect(pane.detached).toBe(false);
  expect(container.querySelector("textarea")).toBe(editor);
  expect(editor.value).toBe("Unsent draft");
  expect(editor.selectionStart).toBe(2);
  expect(onReattach).toHaveBeenCalledOnce();
  expect(frame.contentWindow!.close).toHaveBeenCalledOnce();
  await press(frame.contentWindow!);
  expect(window.open).toHaveBeenCalledOnce();
});
it.each([{ shiftKey: false }, { metaKey: false }, { altKey: true }, { ctrlKey: true }, { key: "e" }, { repeat: true }, { isComposing: true }])("ignores unrelated or repeated key combinations: %j", async (overrides) => {
  expect((await press(window, overrides)).defaultPrevented).toBe(false);
  expect(window.open).not.toHaveBeenCalled();
});
it("accepts Ctrl+Shift+D as the alternative primary modifier", () => {
  expect(isContentAttachmentShortcut({ key: "d", metaKey: false, ctrlKey: true, shiftKey: true, altKey: false })).toBe(true);
});
it("ignores the shortcut while attachment is unavailable or a window is still opening", async () => {
  await act(async () => root.render(<Harness enabled={false} />));
  await press(window);
  expect(window.open).not.toHaveBeenCalled();
  await act(async () => root.render(<Harness />));
  await press(window);
  await press(window);
  expect(window.open).toHaveBeenCalledOnce();
});
it.each(['[role="dialog"]', '[role="alertdialog"]', '.palette-backdrop'])("gives overlays precedence: %s", async (selector) => {
  const overlay = document.createElement("div");
  if (selector.startsWith(".")) overlay.className = selector.slice(1);
  else overlay.setAttribute("role", selector.includes("alertdialog") ? "alertdialog" : "dialog");
  document.body.append(overlay);
  try {
    expect((await press(window)).defaultPrevented).toBe(false);
    expect(window.open).not.toHaveBeenCalled();
  } finally { overlay.remove(); }
});

it("detaches when the composer has a closed model-picker dialog in the DOM", async () => {
  const popover = document.createElement("div");
  popover.setAttribute("popover", "auto");
  popover.setAttribute("role", "dialog");
  container.append(popover);
  expect((await press(container.querySelector("textarea")!)).defaultPrevented).toBe(true);
  expect(window.open).toHaveBeenCalledOnce();
});
