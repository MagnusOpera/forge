// Run on macOS with Screen Recording permission: make build && npx electron scripts/website/capture-screenshots.cjs
// Uses the real built renderer with an isolated session and synthetic IPC data.
// No real credentials, Codex runtime, repositories, or conversations are read.
const { app, BrowserWindow } = require("electron");
const { mkdtempSync, rmSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const { tmpdir } = require("node:os");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const profile = mkdtempSync(path.join(tmpdir(), "forge-screenshots-"));
app.setPath("userData", profile);
// Match the shipping macOS window: native controls are not part of capturePage().
const zoomFactor = 1.1;
async function waitFor(win, expression) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Screenshot UI did not become ready: " + expression);
}
app.whenReady().then(async () => {
  if (process.platform !== "darwin") throw new Error("Website screenshots require macOS native window controls.");
  const { trafficLightPosition } = await import(path.join(root, "dist-electron/electron/main/window-chrome.js"));
  for (const theme of ["dark", "light"]) {
    process.env.FORGE_SCREENSHOT_THEME = theme;
    const win = new BrowserWindow({
      width: 1440, height: 920, useContentSize: true, show: false,
      title: "Forge screenshot",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: trafficLightPosition(zoomFactor),
      webPreferences: {
        zoomFactor,
        preload: path.join(__dirname, "screenshot-fixture.cjs"),
        contextIsolation: false, sandbox: false,
        partition: "screenshot-" + theme
      }
    });
    let detached;
    win.webContents.setWindowOpenHandler(({ url }) => ({
      action: url === new URL("content-window.html", win.webContents.getURL()).href ? "allow" : "deny",
      overrideBrowserWindowOptions: {
        width: 980, height: 920, useContentSize: true, show: false,
        titleBarStyle: "hiddenInset", trafficLightPosition: trafficLightPosition(zoomFactor),
        webPreferences: { zoomFactor, contextIsolation: false, sandbox: false }
      }
    }));
    win.webContents.on("did-create-window", child => { detached = child; });
    await win.loadFile(path.join(root, "dist/renderer/index.html"));
    await waitFor(win, "!!document.querySelector('.codex-thread-select')");
    await win.webContents.executeJavaScript("document.querySelector('[aria-label=\"Search conversations\"]').click()");
    await waitFor(win, "!!document.querySelector('[aria-label=\"Search conversation text\"]')");
    await win.webContents.executeJavaScript(`{
      const input = document.querySelector('[aria-label="Search conversation text"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "workflow");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }`);
    await waitFor(win, "document.querySelector('.codex-search-status')?.textContent === '1 matching thread'");
    await win.webContents.executeJavaScript("document.querySelector('.codex-thread-select').click()");
    await waitFor(win, "!!document.querySelector('.codex-edited-files')");
    await win.webContents.executeJavaScript("document.fonts.ready");
    await new Promise(resolve => setTimeout(resolve, 400));
    const errors = await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('.error-banner, .codex-error')).map(el => el.textContent)");
    if (errors.some(Boolean)) throw new Error(errors.join("\n"));
    win.setWindowButtonPosition(trafficLightPosition(zoomFactor));
    win.show();
    app.focus({ steal: true });
    win.focus();
    await new Promise(resolve => setTimeout(resolve, 600));
    const windowId = win.getMediaSourceId().split(":")[1];
    // Capture the actual window, including native traffic lights, without its shadow.
    execFileSync("/usr/sbin/screencapture", ["-x", "-o", "-l", windowId,
      path.join(root, "website/screenshots/forge-" + theme + ".png")]);
    await win.webContents.executeJavaScript("document.querySelector('[aria-label=\"Detach content pane\"]').click()");
    for (let attempt = 0; !detached && attempt < 100; attempt++)
      await new Promise(resolve => setTimeout(resolve, 100));
    if (!detached) throw new Error("Detached window did not open");
    await waitFor(detached, "!!document.querySelector('[aria-label=\"Reattach content pane\"]') && !!document.querySelector('.codex-edited-files')");
    // Match the two navigation panes retained by the shipping main window.
    win.setContentSize(Math.round(641 * zoomFactor), 920);
    await new Promise(resolve => setTimeout(resolve, 400));
    for (const [target, name] of [[win, "navigation"], [detached, "detached"]]) {
      target.setWindowButtonPosition(trafficLightPosition(zoomFactor));
      target.show();
      target.focus();
      await new Promise(resolve => setTimeout(resolve, 400));
      const id = target.getMediaSourceId().split(":")[1];
      execFileSync("/usr/sbin/screencapture", ["-x", "-o", "-l", id,
        path.join(root, "website/screenshots/forge-" + name + "-" + theme + ".png")]);
    }
    detached.destroy();
    win.destroy();
    console.log("Captured " + theme + " workspace and detached window previews");
  }
}).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
app.on("window-all-closed", () => {});
app.on("quit", () => rmSync(profile, { recursive: true, force: true }));
