import type { BrowserWindow } from "electron";

export type ContentPaneLayout = { detached: boolean; cssWidth: number };
type LayoutWindow = Pick<BrowserWindow, "getBounds" | "getNormalBounds" | "getContentBounds" | "getMinimumSize" | "setMinimumSize" | "setBounds" | "isMaximized" | "unmaximize" | "maximize" | "isFullScreen"> & {
  webContents: Pick<BrowserWindow["webContents"], "getZoomFactor">;
};

/** Owns the attached-size snapshot, independently of how many items are detached. */
export class MainContentLayout {
  private attached?: { width: number; height: number; minimum: number[]; maximized: boolean };
  private desired: ContentPaneLayout = { detached: false, cssWidth: 672 };

  constructor(private window: LayoutWindow) {}

  update(layout: ContentPaneLayout): void {
    if (typeof layout?.detached !== "boolean" || !Number.isFinite(layout.cssWidth) || layout.cssWidth < 300 || layout.cssWidth > 1000)
      throw new Error("Invalid content pane layout.");
    this.desired = layout;
    this.apply();
  }

  /** Full-screen windows adopt the requested size when returning to normal mode. */
  apply(): void {
    const win = this.window;
    if (win.isFullScreen()) return;
    const bounds = win.getBounds();
    if (this.desired.detached) {
      if (!this.attached) {
        const normal = win.getNormalBounds();
        this.attached = { width: normal.width, height: normal.height, minimum: win.getMinimumSize(), maximized: win.isMaximized() };
      }
      const chrome = bounds.width - win.getContentBounds().width;
      const width = Math.min(this.attached.width, Math.ceil(this.desired.cssWidth * win.webContents.getZoomFactor() + chrome));
      if (win.isMaximized()) win.unmaximize();
      win.setMinimumSize(Math.min(this.attached.minimum[0], width), this.attached.minimum[1]);
      win.setBounds({ ...bounds, width });
    } else if (this.attached) {
      const saved = this.attached;
      this.attached = undefined;
      win.setMinimumSize(saved.minimum[0], saved.minimum[1]);
      // Retain a deliberate move of the compact window; restore its former size.
      win.setBounds({ ...bounds, width: saved.width, height: saved.height });
      if (saved.maximized) win.maximize();
    }
  }
}
