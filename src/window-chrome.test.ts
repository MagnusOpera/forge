import { expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { alignWindowButtons, trafficLightPosition, trackWindowButtonAlignment } from "../electron/main/window-chrome";

it.each([1, 1.1, 1.5, 2])("centers native controls on the rendered header at zoom %s", zoom => {
  const position = trafficLightPosition(zoom);
  expect(position.x).toBe(14);
  expect(Math.abs(position.y + 7 - 21 * zoom)).toBeLessThanOrEqual(0.5);
});

it("keeps native controls inside the window at very small zoom", () => {
  expect(trafficLightPosition(0.25).y).toBe(0);
});

it("refreshes alignment on page load and after gesture zoom, ignoring closed windows", async () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
  let zoom = 1.1, closed = false;
  const listeners = new Map<string, () => void>();
  const setWindowButtonPosition = vi.fn();
  const win = {
    isDestroyed: () => closed,
    setWindowButtonPosition,
    webContents: { getZoomFactor: () => zoom, on: (event: string, listener: () => void) => listeners.set(event, listener) },
  } as unknown as BrowserWindow;
  try {
    trackWindowButtonAlignment(win);
    listeners.get("did-finish-load")!();
    expect(setWindowButtonPosition).toHaveBeenLastCalledWith({ x: 14, y: 16 });
    listeners.get("zoom-changed")!();
    zoom = 1.5;
    await new Promise(resolve => setImmediate(resolve));
    expect(setWindowButtonPosition).toHaveBeenLastCalledWith({ x: 14, y: 25 });
    closed = true;
    setWindowButtonPosition.mockClear();
    alignWindowButtons(win);
    expect(setWindowButtonPosition).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
  }
});
