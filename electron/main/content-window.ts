import type { BrowserWindow } from "electron";
import type { PaneRectangle } from "../../shared/content-window.js";

/** macOS fits newly shown windows to the screen, even with explicit initial bounds. */
export function showContentWindow(
  win: Pick<BrowserWindow, "show" | "setContentBounds" | "focus">,
  bounds: PaneRectangle | null,
): void {
  win.show();
  if (bounds) win.setContentBounds(bounds);
  win.focus();
}
