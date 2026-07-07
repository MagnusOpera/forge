#!/usr/bin/env node

import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { signAsync } = require("@electron/osx-sign");

const app = process.env.APP_PATH;
const teamId = process.env.MAC_DEV_TEAM_ID;

if (!app) {
  console.error("APP_PATH is required.");
  process.exit(1);
}

if (!teamId) {
  console.error("MAC_DEV_TEAM_ID is required.");
  process.exit(1);
}

await signAsync({
  app,
  platform: "darwin",
  type: "distribution",
  identity: `Developer ID Application: Magnus Opera (${teamId})`,
  hardenedRuntime: true,
  preEmbedProvisioningProfile: false,
  optionsForFile(filePath) {
    if (path.resolve(filePath) === path.resolve(app)) {
      return { entitlements: "build/entitlements.mac.plist" };
    }

    return null;
  },
});
