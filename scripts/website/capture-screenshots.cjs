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
    await win.loadFile(path.join(root, "dist/renderer/index.html"));
    await waitFor(win, "!!document.querySelector('.codex-thread-select')");
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
    win.destroy();
    console.log("Captured " + theme + " preview");
  }
}).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
app.on("window-all-closed", () => {});
app.on("quit", () => rmSync(profile, { recursive: true, force: true }));
