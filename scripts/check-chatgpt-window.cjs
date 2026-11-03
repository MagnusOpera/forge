// Run after make build: npx electron scripts/check-chatgpt-window.cjs
// Exercise the built renderer in isolated profiles with synthetic ChatGPT data.
const { app, BrowserWindow, nativeImage } = require("electron");
const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const profile = mkdtempSync(path.join(tmpdir(), "forge-chatgpt-check-"));
app.setPath("userData", profile);
const preload = path.join(profile, "fixture.cjs");
const imagePreview = nativeImage
  .createFromBitmap(Buffer.alloc(240 * 180 * 4, 210), {
    width: 240,
    height: 180,
  })
  .toDataURL();
writeFileSync(
  preload,
  `
require(${JSON.stringify(path.join(__dirname, "website/screenshot-fixture.cjs"))});
for (const theme of ["light", "dark"]) localStorage.setItem("github-focus:sidebar-appearance:" + theme, JSON.stringify(${JSON.stringify(process.env.FORGE_CHECK_APPEARANCE === "glass" ? "glass" : "normal")}));
const state = {
  projects: [{id:'project',name:'Forge',instructions:'Give concise answers.'}],
  threads: [{id:'chat',projectId:'project',title:'Explain the three-pane layout',model:'model',updatedAt:1,messages:[
    {id:'user',role:'user',text:'How should we organize the ChatGPT experience?',status:'complete'},
    {id:'assistant',role:'assistant',text:'Keep the familiar three-pane layout:\\n\\n- **Projects** live in Chat mode on the left.\\n- **Threads** for the selected project live in the middle.\\n- The **conversation** opens on the right.\\n\\n\`\`\`ts\\nconst history = { storage: "local", detachable: true };\\n\`\`\`\\n\\nChats can detach into their own windows while keeping drafts and streamed replies.',status:'complete',images:[{id:'generated-image',name:'Generated image.png',kind:'image'}],activity:[{id:'thinking',kind:'reasoning',text:'Compare the three navigation layers.'}],timing:{durationMs:1200}}
  ]}],
  connected:true,models:[{slug:'model',displayName:'Available ChatGPT model',efforts:['low','medium','high'],defaultEffort:'medium',fast:true,images:true,isDefault:true}]
};
window.forgeChatGpt = { attachFiles:async (_input,files) => files.map(file => ({id:'fixture-'+file.name,name:file.name,kind:'document'})), request:async method => method === 'state' ? structuredClone(state) : method === 'attachmentImage' ? ${JSON.stringify(imagePreview)} : undefined, onChanged:() => () => {} };
`,
);
async function waitFor(win, expression) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Renderer did not become ready: " + expression);
}
async function checkComposer(win) {
  const layout = await win.webContents.executeJavaScript(`(() => {
    const composer = document.querySelector('.chatgpt-composer');
    const input = composer.querySelector('.codex-input').getBoundingClientRect();
    const attach = composer.querySelector('.codex-attach-button');
    const send = composer.querySelector('.codex-send-button');
    const a = attach.getBoundingClientRect(), s = send.getBoundingClientRect();
    const model = composer.querySelector('.codex-model-picker').getBoundingClientRect();
    return { modelAbove: model.bottom <= input.top, modelCentered: Math.abs(model.left + model.width / 2 - input.left - input.width / 2) < 1, attachTop: a.top - input.top, sendBottom: input.bottom - s.bottom, rightAligned: Math.abs(a.right - s.right) < 1, widths: [a.width, s.width], circular: getComputedStyle(attach).borderRadius === getComputedStyle(send).borderRadius };
  })()`);
  assert.equal(
    layout.modelAbove,
    true,
    "Model selection stays above the textbox",
  );
  assert.equal(
    layout.modelCentered,
    true,
    "Model selection is horizontally centered",
  );
  assert.equal(layout.attachTop, 8);
  assert.equal(layout.sendBottom, 8);
  assert.equal(layout.rightAligned, true);
  assert.deepEqual(layout.widths, [32, 32]);
  assert.equal(layout.circular, true);
}
async function checkBuild(win, theme) {
  await waitFor(win, "!!document.querySelector('.sidebar .repo-button')");
  const chrome = await win.webContents.executeJavaScript(`(() => {
    const shell = document.querySelector('.workspace-shell');
    const divider = shell.querySelector('.workspace-body-divider');
    const rect = divider.getBoundingClientRect();
    return { top: rect.top, left: rect.left, radius: getComputedStyle(divider).borderTopLeftRadius, railBorder: getComputedStyle(shell.querySelector('.sidebar-rail')).borderRightWidth, railColor: getComputedStyle(shell.querySelector('.sidebar-rail')).backgroundColor, titlebarColor: getComputedStyle(shell, '::before').backgroundColor, resizeTop: shell.querySelector('.resize-handle').getBoundingClientRect().top };
  })()`);
  assert.equal(
    chrome.railColor,
    "rgba(0, 0, 0, 0)",
    "Transparent rail reveals the shared titlebar material",
  );
  assert.equal(chrome.top, 44);
  assert.equal(chrome.left, 48);
  assert.equal(chrome.radius, "16px");
  assert.equal(chrome.railBorder, "0px");
  assert.equal(chrome.resizeTop, 44);

  await win.webContents.executeJavaScript(
    "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
  for (const selector of [
    '.workspace-mode-selector [aria-label="Build"]',
    '.workspace-mode-selector [aria-label="Chat"]',
    '[aria-label="Repository view"] button',
    ".sidebar .repo-button",
  ]) {
    const bounds = await win.webContents.executeJavaScript(`(() => {
      const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return { x: Math.ceil(rect.x + 8), y: Math.ceil(rect.y + 3), width: Math.floor(rect.width - 16), height: Math.floor(rect.height - 6) };
    })()`);
    assert.ok(
      bounds.width > 0 && bounds.height > 0,
      `${selector} has visible space`,
    );
    const pixels = (await win.webContents.capturePage(bounds)).toBitmap();
    let ink = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const luminance =
        (pixels[offset] + pixels[offset + 1] + pixels[offset + 2]) / 3;
      const darkInkThreshold = selector.startsWith(".workspace-mode-selector")
        ? 95
        : 140;
      if (theme === "light" ? luminance < 160 : luminance > darkInkThreshold)
        ink++;
    }
    assert.ok(
      ink > 20,
      `${theme}: ${selector} text is actually painted above the sidebar background (${ink} foreground pixels)`,
    );
  }
  await win.webContents.executeJavaScript(
    "new Promise(resolve => setTimeout(resolve, 220))",
  );
  writeFileSync(
    path.join(root, ".out/chatgpt/" + theme + "-build.png"),
    (await win.webContents.capturePage()).toPNG(),
  );
}
async function checkRail(win, theme) {
  await win.webContents.executeJavaScript(
    "document.querySelector('.sidebar-rail [aria-label=\"Collapse sidebar\"]').click()",
  );
  await waitFor(
    win,
    "Math.abs(document.querySelector('.sidebar').getBoundingClientRect().width - 48) < 1",
  );
  const metrics = await win.webContents.executeJavaScript(`(async () => {
    const rail = document.querySelector('.sidebar-rail');
    const navigation = document.querySelector('.sidebar-navigation');
    const theme = rail.querySelector('.theme-toggle-button');
    theme.focus();
    await new Promise(resolve => setTimeout(resolve, 220));
    const picker = rail.querySelector('.accent-picker');
    const swatch = picker.querySelector('.accent-swatch');
    const rect = swatch.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { width: rail.getBoundingClientRect().width, navigationHidden: navigation.getAttribute('aria-hidden'), inert: navigation.hasAttribute('inert'), controls: rail.querySelectorAll('[aria-label="Global configuration"], .theme-toggle-button, [aria-label="Open sidebar"]').length, pickerVisible: getComputedStyle(picker).visibility, pickerHit: hit === swatch };
  })()`);
  assert.equal(metrics.width, 48);
  assert.equal(metrics.navigationHidden, "true");
  assert.equal(metrics.inert, true);
  assert.equal(metrics.controls, 3);
  assert.equal(metrics.pickerVisible, "visible");
  assert.equal(
    metrics.pickerHit,
    true,
    "Accent flyout remains accessible beyond the collapsed rail",
  );
  const popupSample = await win.webContents.executeJavaScript(`(() => {
    const popup = document.querySelector('.sidebar-rail .accent-picker').getBoundingClientRect();
    const rail = document.querySelector('.sidebar-rail').getBoundingClientRect();
    return { x: Math.round(rail.right), y: Math.ceil(popup.top + 6) };
  })()`);
  const dividerPixel = await win.webContents.capturePage({
    ...popupSample,
    width: 1,
    height: 1,
  });
  const adjacentPixel = await win.webContents.capturePage({
    x: popupSample.x + 1,
    y: popupSample.y,
    width: 1,
    height: 1,
  });
  assert.deepEqual(
    dividerPixel.toBitmap(),
    adjacentPixel.toBitmap(),
    "The body divider must not paint through the color popup",
  );
  writeFileSync(
    path.join(root, ".out/chatgpt/" + theme + "-rail-collapsed.png"),
    (await win.webContents.capturePage()).toPNG(),
  );
  await win.webContents.executeJavaScript(
    "document.activeElement.blur(); document.querySelector('.sidebar-rail [aria-label=\"Open sidebar\"]').click()",
  );
  await waitFor(
    win,
    "document.querySelector('.sidebar').getBoundingClientRect().width > 48",
  );
}
async function checkChatTitle(win, theme, suffix, expectedFont) {
  assert.equal(await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('.chatgpt-content-header > strong')).font"), expectedFont, "Chat titles match the second pane’s typography");
  assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('.chatgpt-content-header .lucide-trash-2')"), false, "Chat headers omit the delete action");
  await win.webContents.executeJavaScript("document.querySelector('[aria-label=\"Rename chat\"]').click()");
  await waitFor(win, "!!document.querySelector('[aria-label=\"Cancel rename\"]')");
  assert.ok(await win.webContents.executeJavaScript(`(() => {
    const header = document.querySelector('.chatgpt-content-header');
    const controls = [...header.querySelectorAll('form input, form button, .chatgpt-actions button')];
    const centers = controls.map(control => { const r = control.getBoundingClientRect(); return r.top + r.height / 2; });
    return Math.max(...centers) - Math.min(...centers) < 1;
  })()`), "Chat title input, Save, Cancel, and detach controls share a vertical center");
  await new Promise(resolve => setTimeout(resolve, 100));
  writeFileSync(path.join(root, '.out/chatgpt/', theme + '-rename-' + suffix + '.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript("document.querySelector('[aria-label=\"Cancel rename\"]').click()");
  await waitFor(win, "!!document.querySelector('[aria-label=\"Rename chat\"]')");
}
app
  .whenReady()
  .then(async () => {
    mkdirSync(path.join(root, ".out/chatgpt"), { recursive: true });
    for (const theme of ["light", "dark"]) {
      process.env.FORGE_SCREENSHOT_THEME = theme;
      const win = new BrowserWindow({
        width: 1440,
        height: 920,
        show: false,
        webPreferences: {
          preload,
          contextIsolation: false,
          sandbox: false,
          partition: "chatgpt-check-" + theme,
        },
      });
      win.webContents.on("render-process-gone", (_event, details) =>
        console.error("Renderer exited", details),
      );
      win.webContents.on("console-message", (details) => {
        if (details.level === "error")
          console.error("Renderer:", details.message);
      });
      let child;
      win.webContents.setWindowOpenHandler(() => ({
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 1000,
          height: 900,
          show: false,
          webPreferences: { contextIsolation: false, sandbox: false },
        },
      }));
      win.webContents.on("did-create-window", (value) => {
        child = value;
      });
      console.log(theme + ": loading renderer");
      await win.loadFile(path.join(root, "dist/renderer/index.html"));
      console.log(theme + ": waiting for navigation");
      await waitFor(win, "!!document.querySelector('.chatgpt-nav-button')");
      assert.equal(
        await win.webContents.executeJavaScript(
          "document.querySelector('.workspace-mode-selector button').getAttribute('aria-label')",
        ),
        "Build",
      );
      assert.equal(
        await win.webContents.executeJavaScript(
          "document.querySelector('.workspace-mode-selector button').getAttribute('aria-pressed')",
        ),
        "true",
      );
      assert.equal(
        await win.webContents.executeJavaScript(
          "!!document.querySelector('.sidebar .pane-header [role=toolbar][aria-label=\"Workspace mode\"]')",
        ),
        true,
      );
      assert.equal(
        await win.webContents.executeJavaScript(
          "document.querySelector('.workspace-mode-selector').textContent.trim()",
        ),
        "",
      );
      const narrowToolbar = await win.webContents
        .executeJavaScript(`(async () => {
        const sidebar = document.querySelector('.sidebar');
        sidebar.style.width = '220px';
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const bounds = sidebar.getBoundingClientRect();
        const buttons = [...sidebar.querySelectorAll('.pane-header button')].map(button => button.getBoundingClientRect());
        const fits = buttons.every(rect => rect.left >= bounds.left + 76 && rect.right <= bounds.right - 12);
        sidebar.style.removeProperty('width');
        return fits;
      })()`);
      assert.equal(
        narrowToolbar,
        true,
        "Toolbar fits beside macOS controls at the minimum sidebar width",
      );
      await checkRail(win, theme);
      await checkBuild(win, theme);
      console.log(theme + ": opening ChatGPT");
      await win.webContents.executeJavaScript(
        "document.querySelector('.chatgpt-nav-button').click()",
      );
      await waitFor(
        win,
        "!!document.querySelector('.chatgpt-thread-list button')",
      );
      assert.equal(
        await win.webContents.executeJavaScript(
          "!!document.querySelector('.sidebar .chatgpt-project-list .chatgpt-project-select')",
        ),
        true,
      );
      assert.equal(
        await win.webContents.executeJavaScript(
          "!!document.querySelector('.chatgpt-threads-pane .chatgpt-project-select')",
        ),
        false,
      );
      assert.equal(
        await win.webContents.executeJavaScript(
          "document.querySelector('.chatgpt-nav-button').getAttribute('aria-label')",
        ),
        "Chat",
      );
      console.log(theme + ": opening chat");
      await win.webContents.executeJavaScript(
        "document.querySelector('.chatgpt-thread-list button').click()",
      );
      await waitFor(
        win,
        "!!document.querySelector('[aria-label=\"Message OpenAI\"]')",
      );
      await win.webContents.executeJavaScript(`{
      const input = document.querySelector('[aria-label="Message OpenAI"]');
      input.editor.commands.setContent('**This draft** survives detaching.', { contentType: 'markdown' });
    }`);
      assert.equal(
        await win.webContents.executeJavaScript(
          "document.querySelector('.chatgpt-nav-button').getAttribute('aria-pressed')",
        ),
        "true",
      );
      assert.equal(
        await win.webContents.executeJavaScript(
          "getComputedStyle(document.querySelector('.chatgpt-project-row')).gridTemplateColumns.split(' ').length",
        ),
        3,
      );
      assert.equal(
        await win.webContents.executeJavaScript(
          "document.querySelector('.chatgpt-composer .tiptap strong').textContent",
        ),
        "This draft",
      );
      await win.webContents.executeJavaScript(`{
        const transfer = new DataTransfer();
        transfer.items.add(new File(['Release notes'], 'notes.txt', {type:'text/plain'}));
        document.querySelector('.chatgpt-composer').dispatchEvent(new DragEvent('drop', { bubbles:true, cancelable:true, dataTransfer:transfer }));
      }`);
      await waitFor(
        win,
        "document.querySelector('.codex-attachments')?.textContent.includes('notes.txt')",
      );
      assert.equal(
        await win.webContents.executeJavaScript(
          "document.querySelector('.codex-work-activity').textContent.includes('Compare the three navigation layers.')",
        ),
        true,
      );
      await waitFor(
        win,
        "document.querySelector('.chatgpt-generated-image img')?.naturalWidth === 240",
      );
      assert.equal(
        await win.webContents.executeJavaScript(
          "document.querySelector('.chatgpt-generated-image img').naturalHeight",
        ),
        180,
      );
      const chatTitleFont = await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('.chatgpt-threads-pane .pane-header strong')).font");
      await checkChatTitle(win, theme, "attached", chatTitleFont);
      console.log(theme + ": fonts and screenshot");
      await checkComposer(win);
      await win.webContents.executeJavaScript("document.fonts.ready");
      await win.webContents.executeJavaScript(
        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      );
      await win.webContents.executeJavaScript(
        "new Promise(resolve => setTimeout(resolve, 220))",
      );
      assert.equal(
        await win.webContents.executeJavaScript(
          "document.querySelector('.chatgpt-nav-button').classList.contains('active')",
        ),
        true,
      );
      writeFileSync(
        path.join(root, ".out/chatgpt/" + theme + ".png"),
        (await win.webContents.capturePage()).toPNG(),
      );
      console.log(theme + ": detaching");
      await win.webContents.executeJavaScript(
        "document.querySelector('[aria-label=\"Detach chat\"]').click()",
      );
      for (let attempt = 0; !child && attempt < 100; attempt++)
        await new Promise((resolve) => setTimeout(resolve, 100));
      assert.ok(child, "Detached ChatGPT window opened");
      await waitFor(
        child,
        "!!document.querySelector('[aria-label=\"Reattach chat\"]')",
      );
      assert.equal(
        await child.webContents.executeJavaScript(
          "document.querySelector('[role=\"textbox\"]').textContent",
        ),
        "This draft survives detaching.",
      );
      assert.equal(
        await child.webContents.executeJavaScript(
          "document.querySelector('[data-theme]').dataset.theme",
        ),
        theme,
      );
      assert.equal(
        await child.webContents.executeJavaScript(
          "getComputedStyle(document.querySelector('.chatgpt-message')).marginBottom",
        ),
        "28px",
      );
      assert.equal(
        await child.webContents.executeJavaScript("document.title"),
        "Chat - Explain the three-pane layout · Forge",
      );
      await waitFor(
        child,
        `parseFloat(getComputedStyle(document.querySelector('.chatgpt-content-header')).paddingLeft) >= 92`,
      );
      assert.ok(
        await child.webContents.executeJavaScript(`{
          const header = document.querySelector('.chatgpt-content-header');
          const title = header.querySelector('strong');
          parseFloat(getComputedStyle(header).paddingLeft) >= 92 &&
            title.getBoundingClientRect().left >= 92;
        }`),
        "Detached chat title must clear the macOS traffic lights",
      );
      await checkChatTitle(child, theme, "detached", chatTitleFont);
      writeFileSync(
        path.join(root, ".out/chatgpt/" + theme + "-detached.png"),
        (await child.webContents.capturePage()).toPNG(),
      );
      assert.equal(
        await child.webContents.executeJavaScript(
          "document.querySelector('.codex-attachments').textContent.includes('notes.txt')",
        ),
        true,
      );
      await child.webContents.executeJavaScript(
        "document.querySelector('button[aria-label=\"Model and reasoning effort\"]').click()",
      );
      await waitFor(
        child,
        "!!document.querySelector('.codex-model-popover:popover-open')",
      );
      assert.equal(
        await child.webContents.executeJavaScript(
          "document.querySelector('[aria-label=\"Reasoning effort\"]').getAttribute('aria-valuetext')",
        ),
        "Medium",
      );
      await child.webContents.executeJavaScript(
        "document.querySelector('.codex-model-popover').hidePopover()",
      );
      assert.equal(
        await child.webContents.executeJavaScript(
          "document.querySelector('.chatgpt-generated-image img').naturalWidth",
        ),
        240,
      );
      child.setContentSize(640, 900);
      const overflow = await child.webContents.executeJavaScript(
        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(document.documentElement.scrollWidth > innerWidth))))",
      );
      assert.equal(overflow, false);
      await checkComposer(child);
      console.log(theme + ": reattaching");
      await child.webContents
        .executeJavaScript(
          "document.querySelector('[aria-label=\"Reattach chat\"]').click()",
        )
        .catch((error) => {
          if (!/Render frame was disposed/.test(error.message)) throw error;
        });
      await waitFor(
        win,
        "!!document.querySelector('.chatgpt-content [role=\"textbox\"]')",
      );
      assert.equal(
        await win.webContents.executeJavaScript(
          "document.querySelector('.chatgpt-content [role=\"textbox\"]').textContent",
        ),
        "This draft survives detaching.",
      );
      await win.webContents.executeJavaScript(
        "new Promise(resolve => setTimeout(resolve, 200))",
      );
      await win.webContents.executeJavaScript(
        "document.querySelector('.workspace-mode-selector button').click()",
      );
      await checkRail(win, theme);
      await checkBuild(win, theme);
      win.destroy();
      console.log(
        `${theme}: Build default, Chat projects in pane one, threads in pane two, markdown, draft, detached CSS, 640px width, and reattachment passed`,
      );
    }
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on("window-all-closed", () => {});
app.on("quit", () => rmSync(profile, { recursive: true, force: true }));
