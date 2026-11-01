// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetachablePane, contentWindowUrl, useDetachablePane } from "./detachable-pane";
import { usePaneSurface } from "./pane-surface";
import { isContentWindowRequest } from "../shared/content-window";
let container: HTMLDivElement, frame: HTMLIFrameElement, root: Root, pane: ReturnType<typeof useDetachablePane>;
let mounts = 0;
const onReattach = vi.fn();
function StatefulContent() {
  const [draft, setDraft] = useState("unsent draft");
  const { document: current, portalRoot } = usePaneSurface();
  useEffect(() => { mounts++; }, []);
  return <main><textarea value={draft} onChange={e => setDraft(e.target.value)} /><span data-surface={current === document ? "main" : "external"} data-root={Boolean(portalRoot)} /></main>;
}
function Harness() {
  pane = useDetachablePane({ onReattach });
  return <DetachablePane pane={pane} theme="dark" accent="#123456" title="Issue #12"><StatefulContent /></DetachablePane>;
}
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mounts = 0;
  onReattach.mockClear();
  container = document.createElement("div");frame = document.createElement("iframe");document.body.append(container, frame);
  vi.spyOn(window, "open").mockReturnValue(frame.contentWindow);
  vi.spyOn(frame.contentWindow!, "focus").mockImplementation(() => {});
  vi.spyOn(frame.contentWindow!, "close").mockImplementation(() => { frame.contentWindow!.dispatchEvent(new Event("beforeunload")); });
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => { pane.reattach(); root.unmount(); });
  container.remove();frame.remove();vi.restoreAllMocks();vi.useRealTimers();
});
async function detach() {
  await act(async () => pane.detach());
  await act(async () => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data: "forge-content-ready" })));
}
it("moves one live tree, retaining editor/scroll state and routing surface and theme", async () => {
  const original = container.querySelector("main")!, editor = container.querySelector("textarea")!;
  original.scrollTop = 73;editor.setSelectionRange(2, 8);
  await detach();
  expect(container.querySelector("main")).toBeNull();
  expect(container.querySelector("[hidden]")).not.toBeNull();
  expect(frame.contentDocument!.querySelector("main")).toBe(original);
  expect(frame.contentDocument!.querySelector("textarea")).toBe(editor);
  expect(editor.value).toBe("unsent draft");expect(editor.selectionStart).toBe(2);expect(original.scrollTop).toBe(73);
  expect(frame.contentDocument!.querySelector('[data-surface="external"]')).not.toBeNull();
  expect(frame.contentDocument!.title).toBe("Issue #12 · Forge");
  expect(pane.host.dataset.theme).toBe("dark");expect(mounts).toBe(1);
  await act(async () => pane.reattach());
  expect(container.querySelector("main")).toBe(original);expect(pane.detached).toBe(false);expect(mounts).toBe(1);
  expect(onReattach).toHaveBeenCalledTimes(1);
  await act(async () => pane.reattach());
  expect(onReattach).toHaveBeenCalledTimes(1);
});
it("reattaches on native close and reuses one external window when focused again", async () => {
  await detach();await act(async () => pane.detach());
  expect(window.open).toHaveBeenCalledTimes(1);
  await act(async () => frame.contentWindow!.dispatchEvent(new Event("beforeunload")));
  expect(pane.detached).toBe(false);expect(container.querySelector("main")).not.toBeNull();
  expect(onReattach).not.toHaveBeenCalled();
});
it("preserves the main selection when a closed window is detected by polling", async () => {
  vi.useFakeTimers();
  await detach();
  Object.defineProperty(frame.contentWindow!, "closed", { configurable: true, value: true });
  await act(async () => vi.advanceTimersByTime(250));
  expect(pane.detached).toBe(false);
  expect(container.querySelector("main")).not.toBeNull();
  expect(onReattach).not.toHaveBeenCalled();
});
it("ignores readiness from unrelated windows and keeps content attached when opening is denied", async () => {
  await act(async () => pane.detach());
  await act(async () => window.dispatchEvent(new MessageEvent("message", { source: window, data: "forge-content-ready" })));
  expect(pane.detached).toBe(false);expect(container.querySelector("main")).not.toBeNull();
  await act(async () => pane.reattach());vi.mocked(window.open).mockReturnValue(null);
  expect(() => pane.detach()).toThrow("could not be opened");expect(container.querySelector("main")).not.toBeNull();
});
it("recovers from a child shell that never loads", async () => {
  vi.useFakeTimers();await act(async () => pane.detach());
  await act(async () => vi.advanceTimersByTime(10000));
  expect(pane.opening).toBe(false);expect(pane.detached).toBe(false);expect(pane.error).toContain("remains attached");
  expect(container.querySelector("main")).not.toBeNull();
});
it("only permits the dedicated local content shell to open as a pane window", () => {
  const owner = "file:///Applications/Forge.app/Contents/Resources/app/dist/renderer/index.html";
  const target = contentWindowUrl(owner);
  expect(isContentWindowRequest(target, pane.windowName, owner)).toBe(true);
  expect(isContentWindowRequest("https://evil.test/content-window.html", pane.windowName, owner)).toBe(false);
  expect(isContentWindowRequest(target, "_blank", owner)).toBe(false);
  expect(isContentWindowRequest(`${target}?next=evil`, pane.windowName, owner)).toBe(false);
  expect(contentWindowUrl("http://127.0.0.1:5173/#test")).toBe("http://127.0.0.1:5173/content-window.html");
});

it("attaches correctly when content first appears after authentication", async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
  function Delayed({ ready }: { ready: boolean }) {
    pane = useDetachablePane();
    return ready ? <DetachablePane pane={pane} theme="light" accent="#123456" title="PR"><StatefulContent /></DetachablePane> : <p>Loading</p>;
  }
  await act(async () => root.render(<Delayed ready={false} />));
  await act(async () => root.render(<Delayed ready />));
  expect(container.querySelector("textarea")?.value).toBe("unsent draft");
});
it("gives each item its own window and reattaches one without disturbing the other", async () => {
  await act(async () => root.render(null));
  const secondFrame = document.createElement("iframe");document.body.append(secondFrame);
  const closed = vi.fn();
  vi.spyOn(secondFrame.contentWindow!, "focus").mockImplementation(() => {});
  vi.spyOn(secondFrame.contentWindow!, "close").mockImplementation(() => {});
  vi.mocked(window.open).mockReset().mockReturnValueOnce(frame.contentWindow).mockReturnValueOnce(secondFrame.contentWindow);
  const items = new Map<string, ReturnType<typeof useDetachablePane>>();
  function Item({ id }: { id: string }) {
    const controller = useDetachablePane({ onReattach: () => closed(id) });items.set(id, controller);
    return <DetachablePane pane={controller} theme="dark" accent="#123456" title={id}><p>{id}</p></DetachablePane>;
  }
  try {
    await act(async () => root.render(<><Item id="chat" /><Item id="issue" /></>));
    for (const [id, source] of [["chat", frame.contentWindow], ["issue", secondFrame.contentWindow]] as const) {
      await act(async () => items.get(id)!.detach());
      await act(async () => window.dispatchEvent(new MessageEvent("message", { source, data: "forge-content-ready" })));
    }
    expect(items.get("chat")!.windowName).not.toBe(items.get("issue")!.windowName);
    expect(frame.contentDocument!.body.textContent).toBe("chat");
    expect(secondFrame.contentDocument!.body.textContent).toBe("issue");
    await act(async () => items.get("chat")!.reattach());
    expect(closed).toHaveBeenCalledExactlyOnceWith("chat");
    expect(items.get("issue")!.detached).toBe(true);
    expect(secondFrame.contentDocument!.body.textContent).toBe("issue");
  } finally { await act(async () => root.render(null));secondFrame.remove(); }
});
it("captures the attached pane rectangle before opening its item window", async () => {
  vi.spyOn(pane.host, "getBoundingClientRect").mockReturnValue({ x: 675, y: 0, width: 600, height: 800 } as DOMRect);
  await act(async () => pane.detach());
  expect(window.open).toHaveBeenCalledWith(contentWindowUrl(window.location.href), pane.windowName,
    "popup,forgepanex=675,forgepaney=0,forgepanewidth=600,forgepaneheight=800");
  expect(container.querySelector("main")).not.toBeNull();
});
