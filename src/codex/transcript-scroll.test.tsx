// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTranscriptScroll } from "./transcript-scroll";

let container: HTMLDivElement, root: Root;
let controls: ReturnType<typeof useTranscriptScroll>;
let height = 1000;
let resize: () => void;
const disconnect = vi.fn();
const observe = vi.fn();
function Harness({ revision, thread = "one", loaded = true }: { revision: number; thread?: string; loaded?: boolean }) {
  controls = useTranscriptScroll(thread, loaded ? revision : undefined, undefined);
  return loaded ? <div ref={controls.scroll} onScroll={controls.onScroll}>
    <div ref={controls.content}>Messages</div>
    {controls.away && <button onClick={controls.jumpToLatest}>Jump to latest</button>}
  </div> : null;
}
const render = (revision: number, thread?: string, loaded = true) => act(() => root.render(<Harness revision={revision} thread={thread} loaded={loaded} />));
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  height = 1000;
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => height);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function readEarlier(top = 200) {
  controls.scroll.current!.scrollTop = top;
  act(() => controls.onScroll());
}
it("follows streaming output until the reader scrolls up, then resumes on jump", () => {
  render(1);
  expect(controls.scroll.current!.scrollTop).toBe(1000);
  height = 1100;
  render(2);
  expect(controls.scroll.current!.scrollTop).toBe(1100);
  readEarlier();
  expect(container.textContent).toContain("Jump to latest");
  height = 1200;
  render(3);
  expect(controls.scroll.current!.scrollTop).toBe(200);
  act(() => container.querySelector("button")!.click());
  expect(controls.scroll.current!.scrollTop).toBe(1200);
  expect(container.querySelector("button")).toBeNull();
  height = 1300;
  render(4);
  expect(controls.scroll.current!.scrollTop).toBe(1300);
});
it("preserves the visible position when older messages are prepended", () => {
  render(1);
  readEarlier(40);
  act(() => controls.preserveHistory());
  height = 1500;
  render(2);
  expect(controls.scroll.current!.scrollTop).toBe(540);
  height = 1600;
  render(3);
  expect(controls.scroll.current!.scrollTop).toBe(540);
});
it("follows late image/diagram layout and viewport changes only at the bottom", () => {
  render(1);
  height = 1400;
  act(() => resize());
  expect(controls.scroll.current!.scrollTop).toBe(1400);
  readEarlier();
  height = 1700;
  act(() => resize());
  expect(controls.scroll.current!.scrollTop).toBe(200);
});
it("attaches after loading and resets following when switching conversations", () => {
  render(0, "one", false);
  expect(observe).not.toHaveBeenCalled();
  render(1);
  expect(observe).toHaveBeenCalledTimes(2);
  readEarlier();
  render(2, "two");
  expect(controls.scroll.current!.scrollTop).toBe(1000);
  expect(container.querySelector("button")).toBeNull();
  expect(disconnect).toHaveBeenCalledTimes(1);
});
