// Run after make build. Exercise real sandboxed preload and attachment IPC without inference.
const { app, BrowserWindow, nativeImage } = require("electron");
const { createServer } = require("node:http");
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const profile = mkdtempSync(path.join(tmpdir(), "forge-chat-bridge-"));
app.setPath("userData", profile);
let win;
const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end(
    "<!doctype html><html><body>Attachment bridge check</body></html>",
  );
});
app
  .whenReady()
  .then(async () => {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;
    process.env.VITE_DEV_SERVER_URL = url;
    const { registerChatGptIpc } = await import(
      pathToFileURL(
        path.join(root, "dist-electron/electron/main/chatgpt/ipc.js"),
      ).href
    );
    const listeners = new Set();
    const image = nativeImage
      .createFromBitmap(Buffer.alloc(32 * 32 * 4, 210), {
        width: 32,
        height: 32,
      })
      .toPNG();
    const runtime = {
      start: async () => {},
      status: async () => ({ authenticated: true }),
      models: async () => [
        {
          id: "fixture",
          name: "Fixture",
          efforts: [],
          fast: false,
          images: true,
        },
      ],
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      request: async (method) => {
        if (method === "thread/start")
          return { thread: { id: "native-image-thread" } };
        if (method === "turn/start") {
          for (const listener of listeners)
            listener({
              method: "item/completed",
              params: {
                threadId: "native-image-thread",
                item: {
                  id: "image",
                  type: "imageGeneration",
                  status: "completed",
                  result: image.toString("base64"),
                },
              },
            });
          for (const listener of listeners)
            listener({
              method: "turn/completed",
              params: {
                threadId: "native-image-thread",
                turn: { id: "turn", status: "completed" },
              },
            });
          return { turn: { id: "turn" } };
        }
        return {};
      },
    };
    registerChatGptIpc(
      () => win,
      () => runtime,
    );
    const preload = path.join(
      root,
      "dist-electron/electron/preload/preload.cjs",
    );
    const original = readFileSync(preload, "utf8");
    const chat = original.indexOf("const chatGptApi = {");
    const attach = original.indexOf("attachFiles:", chat);
    const request = original.indexOf("request:", attach);
    assert.ok(chat >= 0 && attach > chat && request > attach);
    const legacy = path.join(profile, "legacy-preload.cjs");
    writeFileSync(legacy, original.slice(0, attach) + original.slice(request));
    try {
      for (const [name, bridge] of [
        ["current", preload],
        ["legacy", legacy],
      ]) {
        win = new BrowserWindow({
          show: false,
          webPreferences: {
            preload: bridge,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        });
        await win.loadURL(url);
        const result = await win.webContents.executeJavaScript(`(async () => {
        const api = window.forgeChatGpt;
        const project = await api.request('project', { name: 'Bridge check', instructions: '' });
        const thread = await api.request('create', { projectId: project.id, model: '' });
        const frame = document.createElement('iframe'); document.body.append(frame);
        const file = new frame.contentWindow.File(['dropped file bytes'], 'notes.txt', {type:'text/plain'});
        const added = api.attachFiles
          ? await api.attachFiles({ id: thread.id }, [file])
          : await api.request('attach', { id: thread.id, files: [{ name: file.name, data: new Uint8Array(await file.arrayBuffer()) }] });
        frame.remove();
        await api.request('refreshModels');
        await api.request('send', {id:thread.id,text:'Generate an image',model:'fixture'});
        const reply = (await api.request('state')).threads.find(t => t.id === thread.id).messages.at(-1);
        const source = await api.request('attachmentImage', {id:thread.id,attachmentId:reply.images[0].id});
        const preview = new Image(); preview.src = source; await preview.decode();
        return { nativeHelper: typeof api.attachFiles === 'function', added, images:reply.images, imageWidth:preview.naturalWidth };
      })()`);
        assert.equal(result.nativeHelper, name === "current");
        assert.equal(result.added.length, 1);
        assert.equal(result.added[0].name, "notes.txt");
        assert.equal(result.imageWidth, 32);
        assert.deepEqual(
          readFileSync(
            path.join(profile, "chatgpt/attachments", result.images[0].id),
          ),
          image,
        );
        assert.equal(
          readFileSync(
            path.join(profile, "chatgpt/attachments", result.added[0].id),
            "utf8",
          ),
          "dropped file bytes",
        );
        win.destroy();
        win = undefined;
        console.log(
          `PASS: ${name} sandboxed preload imports a dropped file from another renderer realm and previews an image-generation reply through real Chat IPC.`,
        );
      }
    } finally {
      if (win && !win.isDestroyed()) win.destroy();
      await new Promise((resolve) => server.close(resolve));
      rmSync(profile, { recursive: true, force: true });
    }
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    server.close();
    rmSync(profile, { recursive: true, force: true });
    app.exit(1);
  });
app.on("window-all-closed", () => {});
