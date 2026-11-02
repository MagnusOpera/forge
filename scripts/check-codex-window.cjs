// Run after make build: npx electron scripts/check-codex-window.cjs
// Exercise the real renderer with synthetic data and an isolated profile.
const { app, BrowserWindow, ipcMain } = require("electron");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const profile = mkdtempSync(path.join(tmpdir(), "forge-codex-check-"));
app.setPath("userData", profile);
async function waitFor(win, expression) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Renderer did not become ready: " + expression);
}
async function checkCursor(win) {
  win.show();
  app.focus({ steal: true });
  win.focus();
  await waitFor(win, "document.hasFocus()");
  await win.webContents.executeJavaScript(`(() => {
    const editor = document.querySelector('.codex-input .tiptap');
    editor.focus();
    const text = editor.querySelector('p').firstChild;
    window.getSelection().collapse(text, 10);
  })()`);
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Left" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Left" });
  await waitFor(win, "window.getSelection().anchorOffset === 9");
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Right" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Right" });
  await waitFor(win, "window.getSelection().anchorOffset === 10");
}
app.whenReady().then(async () => {
  // Check pathless browser Files through the shipping, isolated preload bridge.
  ipcMain.handle("codex:request", (_event, method, input) => {
    assert.equal(method, "attach");
    assert.equal(input.paths, undefined);
    assert.equal(input.files[0].name, "clipboard.png");
    assert.deepEqual(Array.from(input.files[0].data), [137, 80, 78, 71]);
    return [{ id: "image.png", name: "clipboard.png", kind: "image" }];
  });
  const bridge = new BrowserWindow({ show: false, webPreferences: {
    preload: path.join(root, "dist-electron/electron/preload/preload.cjs"),
    contextIsolation: true, sandbox: true,
  } });
  await bridge.loadURL("data:text/html,<html></html>");
  const result = await bridge.webContents.executeJavaScript(`window.forgeCodex.attachFiles(
    { repositoryId: 'repo', id: 'thread' },
    [new File([new Uint8Array([137, 80, 78, 71])], 'clipboard.png', { type: 'image/png' })]
  )`);
  assert.equal(result[0].kind, "image");
  bridge.destroy();
  ipcMain.removeHandler("codex:request");
  console.log("Clipboard File bytes crossed the isolated preload bridge");
  for (const theme of ["light", "dark"]) {
    process.env.FORGE_SCREENSHOT_THEME = theme;
    const win = new BrowserWindow({
      width: 1600, height: 920, show: false,
      webPreferences: {
        preload: path.join(__dirname, "website/screenshot-fixture.cjs"),
        contextIsolation: false, sandbox: false, partition: "codex-check-" + theme,
      },
    });
    let child;
    win.webContents.setWindowOpenHandler(() => ({
      action: "allow",
      overrideBrowserWindowOptions: {
        width: 1400, height: 920, show: false,
        webPreferences: { contextIsolation: false, sandbox: false },
      },
    }));
    win.webContents.on("did-create-window", value => { child = value; });
    await win.loadFile(path.join(root, "dist/renderer/index.html"));
    await waitFor(win, "!!document.querySelector('.codex-thread-select')");
    await win.webContents.executeJavaScript("document.querySelector('.codex-thread-select').click()");
    await waitFor(win, "!!document.querySelector('.codex-input .tiptap')");
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('.content-title').textContent"), "Codex");
    await win.webContents.executeJavaScript("document.querySelector('[aria-label=\"Detach content pane\"]').click()");
    for (let attempt = 0; !child && attempt < 100; attempt++)
      await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(child, "Detached window opened");
    await waitFor(child, "!!document.querySelector('.codex-input .tiptap')");
    const expected = "Codex - Make workflow failures easier to investigate";
    assert.equal(await child.webContents.executeJavaScript("document.querySelector('.content-title').textContent"), expected);
    assert.equal(await child.webContents.executeJavaScript("document.title"), expected + " · Forge");
    for (const width of [1400, 640]) {
      child.setContentSize(width, 920);
      // Allow Chromium to lay out the resized window before measuring text blocks.
      await child.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      const metrics = await child.webContents.executeJavaScript(`(() => {
        const editor = document.querySelector('.codex-input .tiptap');
        editor.focus();
        document.execCommand('selectAll');
        document.execCommand('insertText', false, 'A long draft uses the available message editor width. '.repeat(30));
        const style = getComputedStyle(editor);
        return {
          available: editor.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
          paragraph: editor.querySelector('p').getBoundingClientRect().width,
          overflow: editor.scrollWidth > editor.clientWidth,
        };
      })()`);
      assert.ok(Math.abs(metrics.paragraph - metrics.available) < 2, JSON.stringify(metrics));
      assert.equal(metrics.overflow, false);
      await checkCursor(child);
    }
    await child.webContents.executeJavaScript("document.querySelector('[aria-label=\"Reattach content pane\"]').click()");
    await waitFor(win, "!!document.querySelector('.codex-input .tiptap')");
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('.content-title').textContent"), "Codex");
    assert.ok(await win.webContents.executeJavaScript("document.querySelector('.codex-input .tiptap').textContent.includes('A long draft')"));
    await checkCursor(win);
    win.destroy();
    console.log(`${theme}: detached title, full-width draft at 1400/640px, and reattachment passed`);
  }
}).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
app.on("window-all-closed", () => {});
app.on("quit", () => rmSync(profile, { recursive: true, force: true }));
