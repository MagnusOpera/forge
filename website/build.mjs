#!/usr/bin/env node

import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const outDir = path.join(rootDir, ".out/site");

const passthroughFiles = [
  ["styles.css", "styles.css"],
  ["site.js", "site.js"],
  ["screenshots/forge-light.png", "screenshots/forge-light.png"],
  ["screenshots/forge-dark.png", "screenshots/forge-dark.png"]
];

const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
const releaseTag = process.env.RELEASE_TAG || packageJson.version;

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function renderGitHubIcon() {
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.58 2 12.24c0 4.52 2.87 8.35 6.84 9.71.5.1.68-.22.68-.49v-1.9c-2.78.62-3.37-1.22-3.37-1.22-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.56 2.35 1.11 2.92.85.09-.67.35-1.11.63-1.37-2.22-.26-4.55-1.14-4.55-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.31.1-2.71 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 6.95c.85 0 1.69.12 2.48.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.4.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.56 5.07.36.32.68.95.68 1.91v2.83c0 .27.18.59.69.49A10.1 10.1 0 0 0 22 12.24C22 6.58 17.52 2 12 2Z" />
              </svg>`;
}

function renderFullChangelogIcon() {
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 5h18" />
                <path d="M3 12h18" />
                <path d="M3 19h18" />
              </svg>`;
}

function parseChangelog(markdown) {
  const sections = [];
  let current = null;

  function pushCurrent() {
    if (current && current.items.length > 0) {
      sections.push(current);
    }
  }

  for (const line of markdown.split(/\r?\n/)) {
    const sectionMatch = line.match(/^## \[([^\]]+)\]/);
    if (sectionMatch) {
      pushCurrent();
      current = {
        title: sectionMatch[1],
        items: [],
        fullChangelogUrl: null
      };
      continue;
    }

    if (!current) {
      continue;
    }

    const bulletMatch = line.match(/^- (.+)$/);
    if (bulletMatch) {
      current.items.push(bulletMatch[1]);
      continue;
    }

    const fullChangelogMatch = line.match(/^\*\*Full Changelog\*\*: (https?:\/\/\S+)$/);
    if (fullChangelogMatch) {
      current.fullChangelogUrl = fullChangelogMatch[1];
    }
  }

  pushCurrent();
  return sections;
}

function renderChangelogEntries(markdown) {
  const sections = parseChangelog(markdown).filter((section) => section.title !== "Unreleased");

  if (sections.length === 0) {
    return '<p class="lead">No changelog entries yet.</p>';
  }

  return sections
    .map((section) => {
      const fullChangelogLink = section.fullChangelogUrl
        ? `\n              <a class="changelog-entry-link" href="${escapeHtml(section.fullChangelogUrl)}">${renderFullChangelogIcon()}<span>Full changelog</span></a>`
        : "";
      const githubReleaseLink = section.title === "Unreleased"
        ? ""
        : `\n              <a class="changelog-entry-link" href="https://github.com/MagnusOpera/forge/releases/tag/${encodeURIComponent(section.title)}">${renderGitHubIcon()}<span>GitHub release</span></a>`;
      const changelogActions = fullChangelogLink || githubReleaseLink
        ? `\n            <div class="changelog-entry-actions">${fullChangelogLink}${githubReleaseLink}
            </div>`
        : "";
      const items = section.items
        .map((item) => `              <li>${renderInlineMarkdown(item)}</li>`)
        .join("\n");

      return `          <article class="changelog-entry">
            <div class="changelog-entry-header">
              <h3>${escapeHtml(section.title)}</h3>
            </div>
            <ul>
${items}
            </ul>${changelogActions}
          </article>`;
    })
    .join("\n");
}

function releaseAssetUrl(assetName) {
  return `https://github.com/MagnusOpera/forge/releases/download/${encodeURIComponent(releaseTag)}/${encodeURIComponent(assetName)}`;
}

function applyReleaseReplacements(html) {
  const replacements = {
    __FORGE_RELEASE_VERSION__: `v${releaseTag}`,
    __FORGE_RELEASE_URL__: `https://github.com/MagnusOpera/forge/releases/tag/${encodeURIComponent(releaseTag)}`,
    __FORGE_RELEASES_URL__: "https://github.com/MagnusOpera/forge/releases",
    __FORGE_MAC_ARM64_ARTIFACT__: releaseAssetUrl(`forge-${releaseTag}-mac-arm64.zip`),
    __FORGE_WINDOWS_X64_ARTIFACT__: releaseAssetUrl(`forge-${releaseTag}-windows-x64.zip`),
    __FORGE_WINDOWS_ARM64_ARTIFACT__: releaseAssetUrl(`forge-${releaseTag}-windows-arm64.zip`),
    __FORGE_LINUX_X64_ARTIFACT__: releaseAssetUrl(`forge-${releaseTag}-linux-x64.tar.gz`),
    __FORGE_LINUX_ARM64_ARTIFACT__: releaseAssetUrl(`forge-${releaseTag}-linux-arm64.tar.gz`)
  };

  let output = html;
  for (const [placeholder, value] of Object.entries(replacements)) {
    output = output.replaceAll(placeholder, value);
  }
  return output;
}

await rm(outDir, { recursive: true, force: true });
await mkdir(path.join(outDir, "assets"), { recursive: true });
await mkdir(path.join(outDir, "screenshots"), { recursive: true });

const changelog = await readFile(path.join(rootDir, "CHANGELOG.md"), "utf8");
const indexHtml = await readFile(path.join(__dirname, "index.html"), "utf8");
const installHtml = await readFile(path.join(__dirname, "install.html"), "utf8");
const changelogHtml = await readFile(path.join(__dirname, "changelog.html"), "utf8");

await writeFile(path.join(outDir, "index.html"), indexHtml);
await writeFile(path.join(outDir, "install.html"), applyReleaseReplacements(installHtml));
await writeFile(
  path.join(outDir, "changelog.html"),
  changelogHtml.replace("<!-- CHANGELOG_ENTRIES -->", renderChangelogEntries(changelog))
);

for (const [source, target] of passthroughFiles) {
  await copyFile(path.join(__dirname, source), path.join(outDir, target));
}

await copyFile(path.join(rootDir, "assets/forge-icon.svg"), path.join(outDir, "assets/forge-icon.svg"));
await copyFile(path.join(rootDir, "assets/forge-icon.png"), path.join(outDir, "assets/forge-icon.png"));
await copyFile(path.join(rootDir, "LICENSE"), path.join(outDir, "LICENSE.txt"));
await copyFile(path.join(rootDir, "README.md"), path.join(outDir, "README.md"));

await copyFile(path.join(__dirname, ".nojekyll"), path.join(outDir, ".nojekyll"));

console.log(`Built Forge website in ${path.relative(rootDir, outDir)}`);
