import type { BrowserWindow } from "electron";

export function trafficLightPosition(zoomFactor: number): { x: number; y: number } {
  // Match styles.css: 44px header, with its contents shifted up by 1px.
  // Native macOS buttons are 14pt high and do not scale with renderer zoom.
  return { x: 14, y: Math.max(0, Math.round((44 / 2 - 1) * zoomFactor - 14 / 2)) };
}

export function alignWindowButtons(win: BrowserWindow): void {
  if (process.platform === "darwin" && !win.isDestroyed()) {
    win.setWindowButtonPosition(trafficLightPosition(win.webContents.getZoomFactor()));
  }
}

export function trackWindowButtonAlignment(win: BrowserWindow): void {
  win.webContents.on("did-finish-load", () => alignWindowButtons(win));
  win.webContents.on("zoom-changed", () => {
    // Chromium applies gesture zoom after delivering this event.
    setImmediate(() => alignWindowButtons(win));
  });
}
