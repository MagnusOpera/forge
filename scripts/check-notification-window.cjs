// Run after make build: npx electron scripts/check-notification-window.cjs
// Real renderer, synthetic GitHub data, isolated profile.
const { app, BrowserWindow } = require("electron");
const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const profile = mkdtempSync(path.join(tmpdir(), "forge-notification-check-"));
app.setPath("userData", profile);
const preload = path.join(profile, "fixture.cjs");
writeFileSync(preload, `
require(${JSON.stringify(path.join(__dirname, "website/screenshot-fixture.cjs"))});
window.githubFocus.getRepo = async (target) => ({ data: (await window.githubFocus.getRepositories()).data.find(repo => repo.owner === target.owner && repo.name === target.name) });
window.notificationPullRequests = [];
window.notificationRuns = [];
window.nativeAttempts = 0;
window.githubFocus.onNativeNotificationClicked = listener => { window.clickNativeNotification = listener; return () => {}; };
window.githubFocus.getPullRequests = async () => ({ data: window.notificationPullRequests });
window.githubFocus.getWorkflowRuns = async () => ({ data: window.notificationRuns });
window.githubFocus.getPullRequest = async () => ({ data: { ...window.notificationPullRequests[0], body: 'Ready for review', comments: [], reviews: [], commits: [], files: [], labels: [], assignees: [], requestedReviewers: [] } });
window.githubFocus.getWorkflowRun = async () => ({ data: { ...window.notificationRuns[0], jobs: [] } });
window.githubFocus.showNativeNotification = async () => { window.nativeAttempts++; return false; };
`);
async function waitFor(win, expression) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  console.error(await win.webContents.executeJavaScript("document.body.innerText"));
  throw new Error("Renderer did not become ready: " + expression);
}
app.whenReady().then(async () => {
  mkdirSync(path.join(root, ".out/notifications"), { recursive: true });
  for (const theme of ["light", "dark"]) {
    process.env.FORGE_SCREENSHOT_THEME = theme;
    const win = new BrowserWindow({ width: 1200, height: 800, show: false,
      webPreferences: { preload, contextIsolation: false, sandbox: false, partition: "notification-check-" + theme } });
    const children = [];
    win.webContents.setWindowOpenHandler(() => ({ action: "allow", overrideBrowserWindowOptions: {
      show: false, webPreferences: { contextIsolation: false, sandbox: false },
    } }));
    win.webContents.on("did-create-window", child => children.push(child));
    await win.loadFile(path.join(root, "dist/renderer/index.html"));
    await waitFor(win, "!!document.querySelector('[aria-label=\"Refresh favorite repositories\"]:not(:disabled)')");
    const refresh = async () => {
      await win.webContents.executeJavaScript("document.querySelector('[aria-label=\"Refresh favorite repositories\"]').click()");
      await waitFor(win, "!!document.querySelector('[aria-label=\"Refresh favorite repositories\"]:not(:disabled)')");
    };
    await refresh(); // Seed existing items without generating notifications.
    await win.webContents.executeJavaScript(`window.notificationPullRequests = [{ id: 'pr-demo', number: 42, title: 'Keep alerts visible', state: 'OPEN', isDraft: false, author: { login: 'demo' }, labels: [], url: 'https://github.com/acme/workspace/pull/42', updatedAt: new Date().toISOString() }];`);
    await refresh();
    await waitFor(win, "!!document.querySelector('.notification-dot')");
    assert.equal(await win.webContents.executeJavaScript("window.nativeAttempts"), 0, "Denied OS notifications do not hide in-app alerts");
    await win.webContents.executeJavaScript("document.querySelector('[aria-label=\"Collapse sidebar\"]').click(); document.querySelector('.notification-bell').click()");
    await waitFor(win, "!!document.querySelector('.notification-row')");
    assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('.notification-dot')"), false);
    assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('.notification-row').length"), 3); // One per favorite repository.
    assert.ok(await win.webContents.executeJavaScript(`(() => {
      const panel = document.querySelector('.notification-panel').getBoundingClientRect();
      const row = document.querySelector('.notification-row').getBoundingClientRect();
      return panel.x >= 48 && panel.right <= innerWidth && row.width >= panel.width - 48;
    })()`), "List is visible with the sidebar collapsed and uses the full row width");
    assert.ok(await win.webContents.executeJavaScript(`(() => {
      const item = document.querySelector('.notification-item.unread');
      const bounds = item.getBoundingClientRect();
      const icon = item.querySelector('.notification-row > svg').getBoundingClientRect();
      const button = item.querySelector('.notification-mark-read').getBoundingClientRect();
      return Math.abs((icon.left - bounds.left) - (bounds.right - button.right)) < 1 && bounds.right - button.right >= 8;
    })()`), "Read button has the same edge inset as the leading notification icon");
    assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('.notification-item.unread').length"), 3, "Viewing the list keeps individual notifications unread");
    const weights = await win.webContents.executeJavaScript(`(() => {
      const first = document.querySelector('.notification-item');
      const unread = getComputedStyle(first.querySelector('.notification-title')).fontWeight;
      first.querySelector('.notification-mark-read').click();
      return unread;
    })()`);
    await waitFor(win, "document.querySelectorAll('.notification-item.unread').length === 2");
    assert.ok(await win.webContents.executeJavaScript(`Number(${JSON.stringify(weights)}) > Number(getComputedStyle(document.querySelector('.notification-item:not(.unread) .notification-title')).fontWeight)`), "Unread titles are bolder than read titles");
    assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('.notification-panel')"), true, "Marking read keeps the list open");
    assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('.notification-item:not(.unread) .notification-mark-read')"), false, "Read notifications hide the read action");
    await win.webContents.executeJavaScript("document.querySelector('.notification-bell').click()");
    await waitFor(win, "!document.querySelector('.notification-panel')");
    await win.webContents.executeJavaScript("document.querySelector('.notification-bell').click()");
    await waitFor(win, "!!document.querySelector('.notification-panel')");
    assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('.notification-row').length"), 3, "Viewing retains history");
    await refresh();
    assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('.notification-dot')"), false, "Refresh does not duplicate seen events");
    // A later failure must restore the dot, even with the list open.
    await win.webContents.executeJavaScript(`window.notificationRuns = [{ id: 123, name: 'Build', displayTitle: 'Build failed', status: 'completed', conclusion: 'failure', branch: 'main', url: 'https://github.com/acme/workspace/actions/runs/123', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];`);
    await refresh();
    await waitFor(win, "!!document.querySelector('.notification-dot')");
    await waitFor(win, "document.querySelectorAll('.notification-item.unread').length === 5");
    const screenshot = await win.webContents.capturePage();
    writeFileSync(path.join(root, '.out/notifications', theme + '.png'), screenshot.toPNG());
    for (const kind of ["pull-request", "workflow-run"]) {
      await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.notification-row')).find(row => row.textContent.includes(${JSON.stringify(kind === "pull-request" ? "New pull request" : "Workflow failed")})).click()`);
      const title = kind === "pull-request" ? "Keep alerts visible" : "Build failed";
      await waitFor(win, `document.querySelector('.content-pane')?.innerText.includes(${JSON.stringify(title)})`);
      assert.equal(children.length, 0, "Notification selects the third pane without opening a window");
      assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('.notification-panel')"), false, "Selection closes the popup");
      await win.webContents.executeJavaScript("document.querySelector('.notification-bell').click()");
      await waitFor(win, "!!document.querySelector('.notification-panel')");
      assert.equal(await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.notification-row')).find(row => row.textContent.includes(${JSON.stringify(kind === "pull-request" ? "New pull request" : "Workflow failed")})).parentElement.classList.contains('unread')`), false, "Opening a notification marks it read");
      await win.webContents.executeJavaScript("document.querySelector('.notification-bell').click()");
      // Existing detached content must return to the third pane as well.
      await win.webContents.executeJavaScript("document.querySelector('[aria-label=\"Detach content pane\"]').click()");
      for (let attempt = 0; !children.length && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
      const child = children.at(-1);
      assert.ok(child, "Manual detach opens a content window");
      await waitFor(child, `document.title === ${JSON.stringify(title + ' · Forge')}`);
      await win.webContents.executeJavaScript("document.querySelector('.notification-bell').click()");
      await waitFor(win, "!!document.querySelector('.notification-panel')");
      await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.notification-row')).find(row => row.textContent.includes(${JSON.stringify(kind === "pull-request" ? "New pull request" : "Workflow failed")})).click()`);
      await waitFor(win, `document.querySelector('.content-pane')?.innerText.includes(${JSON.stringify(title)})`);
      assert.ok(child.isDestroyed(), "Notification reattaches the existing content window");
      children.length = 0;
      await win.webContents.executeJavaScript("document.querySelector('.notification-bell').click()");
      await waitFor(win, "!!document.querySelector('.notification-panel')");
    }

    await win.webContents.executeJavaScript(`(async () => { const row = Array.from(document.querySelectorAll('.notification-item.unread')).find(row => row.textContent.includes('Workflow failed')); const repo = (await window.githubFocus.getRepositories()).data.find(repo => row.textContent.includes(repo.fullName)); window.clickNativeNotification({ kind: 'workflow-run', repo, run: window.notificationRuns[0] }); })()`);
    await waitFor(win, "document.querySelectorAll('.notification-item.unread').length === 3");
    await win.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('.notification-panel')"), false);
    assert.equal(await win.webContents.executeJavaScript("document.activeElement === document.querySelector('.notification-bell')"), true);
    win.destroy();
    console.log(theme + ": denied native alerts, per-item read actions, native click read state, retained list, collapsed rail, PR/run selection in the third pane, reattachment, and Escape passed");
  }
}).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
app.on("window-all-closed", () => {});
app.on("quit", () => rmSync(profile, { recursive: true, force: true }));
