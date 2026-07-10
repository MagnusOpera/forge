#!/usr/bin/env node

import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const outDir = path.join(rootDir, ".out/site");

const files = [
  ["index.html", "index.html"],
  ["install.html", "install.html"],
  ["styles.css", "styles.css"],
  ["site.js", "site.js"],
  ["screenshots/forge-light.png", "screenshots/forge-light.png"],
  ["screenshots/forge-dark.png", "screenshots/forge-dark.png"]
];

await rm(outDir, { recursive: true, force: true });
await mkdir(path.join(outDir, "assets"), { recursive: true });
await mkdir(path.join(outDir, "screenshots"), { recursive: true });

for (const [source, target] of files) {
  await copyFile(path.join(__dirname, source), path.join(outDir, target));
}

await copyFile(path.join(rootDir, "assets/forge-icon.svg"), path.join(outDir, "assets/forge-icon.svg"));
await copyFile(path.join(rootDir, "assets/forge-icon.png"), path.join(outDir, "assets/forge-icon.png"));
await copyFile(path.join(rootDir, "LICENSE"), path.join(outDir, "LICENSE.txt"));
await copyFile(path.join(rootDir, "README.md"), path.join(outDir, "README.md"));

await copyFile(path.join(__dirname, ".nojekyll"), path.join(outDir, ".nojekyll"));

console.log(`Built Forge website in ${path.relative(rootDir, outDir)}`);
