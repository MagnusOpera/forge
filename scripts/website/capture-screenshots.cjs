// Run: make build && npx electron scripts/website/capture-screenshots.cjs
// Uses the real built renderer with an isolated session and synthetic IPC data.
// No real credentials, Codex runtime, repositories, or conversations are read.
const { app, BrowserWindow } = require("electron");
const { writeFileSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const profile = mkdtempSync(path.join(tmpdir(), "forge-screenshots-"));
app.setPath("userData", profile);
app.commandLine.appendSwitch("force-device-scale-factor", "2");
async function waitFor(win, expression) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Screenshot UI did not become ready: " + expression);
}
app.whenReady().then(async () => {
  for (const theme of ["dark", "light"]) {
    process.env.FORGE_SCREENSHOT_THEME = theme;
    const win = new BrowserWindow({
      width: 1512, height: 800, useContentSize: true, show: false,
      webPreferences: {
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
    const screenshot = await win.webContents.capturePage();
    writeFileSync(path.join(root, "website/screenshots/forge-" + theme + ".png"), screenshot.toPNG());
    win.destroy();
    console.log("Captured " + theme + " preview");
  }
}).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
app.on("window-all-closed", () => {});
app.on("quit", () => rmSync(profile, { recursive: true, force: true }));
