import { expect, it, vi } from "vitest";
import { MainContentLayout } from "../electron/main/content-layout";

function fixture({ maximized = false, fullScreen = false, width = 1440, platform = "darwin" as NodeJS.Platform } = {}) {
  let bounds = { x: 50, y: 60, width, height: 920 };
  let minimum = [980, 640];
  const normal = { ...bounds };
  const win = {
    getBounds: () => ({ ...bounds }), getNormalBounds: vi.fn(() => ({ ...normal })),
    getContentBounds: () => ({ ...bounds, width: bounds.width - 4 }),
    getMinimumSize: () => [...minimum],
    setMinimumSize: vi.fn((width: number, height: number) => { minimum = [width, height]; }),
    setBounds: vi.fn((next: typeof bounds) => { bounds = { ...next }; }),
    isMaximized: () => maximized,
    unmaximize: vi.fn(() => { maximized = false; bounds = { ...normal }; }), maximize: vi.fn(() => { maximized = true; }),
    isFullScreen: () => fullScreen,
    webContents: { getZoomFactor: () => 1.1 },
  };
  return {
    win,
    layout: new MainContentLayout(win, platform),
    setExternalBounds: (next: typeof bounds, zoomed = false) => { bounds = { ...next }; maximized = zoomed; },
    setFullScreen: (value: boolean) => { fullScreen = value; },
  };
}
it("shrinks to the two panes, accounting for zoom and chrome, then restores the original size and minimum", () => {
  const { win, layout } = fixture();
  layout.update({ detached: true, cssWidth: 673 });
  expect(win.getBounds()).toEqual({ x: 50, y: 60, width: 745, height: 920 });
  expect(win.getMinimumSize()).toEqual([745, 640]);
  layout.update({ detached: false, cssWidth: 673 });
  expect(win.getBounds()).toEqual({ x: 50, y: 60, width: 1440, height: 920 });
  expect(win.getMinimumSize()).toEqual([980, 640]);
});
it("keeps one original snapshot across multiple detached items and sidebar width changes", () => {
  const { win, layout } = fixture();
  layout.update({ detached: true, cssWidth: 673 });
  layout.update({ detached: true, cssWidth: 392 });
  expect(win.getBounds().width).toBe(436);
  win.setBounds({ x: 120, y: 90, width: 500, height: 800 });
  layout.update({ detached: false, cssWidth: 392 });
  expect(win.getBounds()).toEqual({ x: 120, y: 90, width: 1440, height: 920 });
  layout.update({ detached: false, cssWidth: 392 });
  expect(win.setBounds).toHaveBeenCalledTimes(4);
});
it("does not enlarge a small attached window when collapsing wide pane preferences", () => {
  const { win, layout } = fixture({ width: 980 });
  layout.update({ detached: true, cssWidth: 1000 });
  expect(win.getBounds().width).toBe(980);
  layout.update({ detached: false, cssWidth: 1000 });
  expect(win.getBounds().width).toBe(980);
});
it("restores a maximized window after compact mode", () => {
  const { win, layout } = fixture({ maximized: true, platform: "win32" });
  layout.update({ detached: true, cssWidth: 673 });
  expect(win.unmaximize).toHaveBeenCalledOnce();
  layout.update({ detached: false, cssWidth: 673 });
  expect(win.maximize).toHaveBeenCalledOnce();
});
it("defers sizing in full screen and applies the current layout when leaving it", () => {
  const { win, layout, setFullScreen } = fixture({ fullScreen: true });
  layout.update({ detached: true, cssWidth: 673 });
  expect(win.setBounds).not.toHaveBeenCalled();
  setFullScreen(false);layout.apply();
  expect(win.getBounds().width).toBe(745);
  setFullScreen(true);layout.update({ detached: false, cssWidth: 673 });
  expect(win.getBounds().width).toBe(745);
  setFullScreen(false);layout.apply();expect(win.getBounds().width).toBe(1440);
});
it("rejects malformed layout requests without touching native bounds", () => {
  const { win, layout } = fixture();
  for (const cssWidth of [NaN, Infinity, -1, 0, 299, 1001])
    expect(() => layout.update({ detached: true, cssWidth })).toThrow("Invalid content pane layout");
  expect(win.setBounds).not.toHaveBeenCalled();
});

it.each([false, true])("uses live macOS bounds after an external move and resize (zoomed: %s)", zoomed => {
  const { win, layout, setExternalBounds } = fixture();
  const external = { x: -1600, y: 40, width: 1800, height: 1100 };
  setExternalBounds(external, zoomed);
  layout.update({ detached: true, cssWidth: 673 });
  expect(win.getBounds()).toEqual({ ...external, width: 745 });
  expect(win.unmaximize).not.toHaveBeenCalled();
  expect(win.getNormalBounds).not.toHaveBeenCalled();
  layout.update({ detached: false, cssWidth: 673 });
  expect(win.getBounds()).toEqual(external);
  expect(win.maximize).not.toHaveBeenCalled();
  expect(win.getMinimumSize()).toEqual([980, 640]);
  expect(win.setBounds.mock.calls.map(([bounds]) => bounds)).toEqual([{ ...external, width: 745 }, external]);
});
it("queries fresh bounds for each detach cycle and retains moves made while compact", () => {
  const { win, layout, setExternalBounds } = fixture();
  layout.update({ detached: true, cssWidth: 673 });
  layout.update({ detached: false, cssWidth: 673 });
  const external = { x: 180, y: 70, width: 1600, height: 1050 };
  setExternalBounds(external, true);
  layout.update({ detached: true, cssWidth: 673 });
  expect(win.getBounds()).toEqual({ ...external, width: 745 });
  setExternalBounds({ x: 300, y: 100, width: 745, height: 1050 });
  layout.update({ detached: false, cssWidth: 673 });
  expect(win.getBounds()).toEqual({ ...external, x: 300, y: 100 });
});
