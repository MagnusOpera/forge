// Run after make build: npx electron scripts/check-content-layout.cjs
// Exercise live macOS window geometry independently of renderer resize events.
const { app, BrowserWindow, screen } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const pause = () => new Promise(resolve => setTimeout(resolve, 150));
app.whenReady().then(async () => {
  if (process.platform !== 'darwin') throw new Error('This check covers macOS window-manager sizing.');
  const { MainContentLayout } = await import(pathToFileURL(path.resolve(__dirname, '../dist-electron/electron/main/content-layout.js')).href);
  const area = screen.getPrimaryDisplay().workArea;
  const initial = { x: area.x + 40, y: area.y + 40, width: Math.min(900, area.width - 80), height: Math.min(700, area.height - 80) };
  const win = new BrowserWindow({ ...initial, show: false, minWidth: 320, minHeight: 240, titleBarStyle: 'hiddenInset' });
  await win.loadURL('data:text/html,<title>Forge window layout check</title>');
  win.show();
  const layout = new MainContentLayout(win);
  // Explicit unmaximize would restore an obsolete frame before the actual resize.
  win.unmaximize = () => { throw new Error('Detaching must not unmaximize a macOS window first.'); };
  for (const mode of ['window-manager frame', 'native maximize']) {
    win.setBounds(initial);
    if (mode === 'window-manager frame') win.setBounds(area);
    else win.maximize();
    await pause();
    const live = win.getBounds();
    const chrome = live.width - win.getContentBounds().width;
    const compactWidth = Math.min(live.width, Math.ceil(420 * win.webContents.getZoomFactor() + chrome));
    const frames = [];
    const record = () => frames.push(win.getBounds());
    win.on('move', record);
    win.on('resize', record);
    layout.update({ detached: true, cssWidth: 420 });
    await pause();
    assert.deepEqual(win.getBounds(), { ...live, width: compactWidth }, mode + ': compact frame uses current position and height');
    assert.ok(frames.every(frame => frame.x === live.x && frame.y === live.y && frame.height === live.height), mode + ': no intermediate old frame');
    layout.update({ detached: false, cssWidth: 420 });
    await pause();
    assert.deepEqual(win.getBounds(), live, mode + ': reattachment restores the current attached size');
    win.removeListener('move', record);
    win.removeListener('resize', record);
    console.log(mode + ': live geometry, direct compact resize, and restoration passed');
  }
  win.destroy();
}).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
app.on('window-all-closed', () => {});
