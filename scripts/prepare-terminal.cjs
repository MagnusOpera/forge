// node-pty's N-API prebuilds work in Node and Electron. Its Unix spawn helper
// must remain executable both in development and in app.asar.unpacked.
const { chmodSync, existsSync, readdirSync } = require('node:fs');
const path = require('node:path');
const root = path.join(path.dirname(require.resolve('node-pty/package.json')), 'prebuilds');
if (existsSync(root)) for (const platform of readdirSync(root)) {
  const helper = path.join(root, platform, 'spawn-helper');
  if (existsSync(helper)) chmodSync(helper, 0o755);
}
