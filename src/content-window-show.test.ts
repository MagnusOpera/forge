import { expect, it, vi } from "vitest";
import { showContentWindow } from "../electron/main/content-window";
import { contentPaneWindowBounds, contentPaneWindowFeatures } from "../shared/content-window";

it("restores pane alignment after showing moves an offscreen window upward", () => {
  const owner = { x: 80, y: 193, width: 1400, height: 843 };
  const intended = contentPaneWindowBounds(
    contentPaneWindowFeatures({ x: 700, y: 0, width: 700, height: 843 }), owner, 1,
  )!;
  let actual = { ...intended };
  const win = {
    show: () => { actual.y = 113; },
    setContentBounds: (bounds: typeof intended) => { actual = { ...bounds }; },
    focus: vi.fn(() => { expect(actual).toEqual(intended); }),
  };
  showContentWindow(win, intended);
  expect(actual).toEqual({ x: 780, y: 193, width: 700, height: 843 });
  expect(win.focus).toHaveBeenCalledOnce();
});

it("keeps native placement when the pane geometry is unavailable", () => {
  const win = { show: vi.fn(), setContentBounds: vi.fn(), focus: vi.fn() };
  showContentWindow(win, null);
  expect(win.show).toHaveBeenCalledOnce();
  expect(win.setContentBounds).not.toHaveBeenCalled();
  expect(win.focus).toHaveBeenCalledOnce();
});
