import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const [zipPath, rawVersion] = process.argv.slice(2);

if (!zipPath || !rawVersion) {
  console.error("Usage: node .github/scripts/generate-latest-mac-update.mjs <zip-path> <version>");
  process.exit(1);
}

const version = rawVersion.replace(/^v/, "");
const zipBuffer = await readFile(zipPath);
const zipStats = await stat(zipPath);
const fileName = path.basename(zipPath);
const sha512 = createHash("sha512").update(zipBuffer).digest("base64");
const releaseDate = new Date().toISOString();
const updateFilePath = path.join(path.dirname(zipPath), "latest-mac.yml");

const yaml = [
  `version: ${version}`,
  "files:",
  `  - url: ${fileName}`,
  `    sha512: ${sha512}`,
  `    size: ${zipStats.size}`,
  `path: ${fileName}`,
  `sha512: ${sha512}`,
  `releaseDate: '${releaseDate}'`,
  ""
].join("\n");

await writeFile(updateFilePath, yaml, "utf8");
console.log(`Wrote ${updateFilePath}`);
