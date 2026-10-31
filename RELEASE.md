# Release

Forge follows the same two-step release model as FScript.

1. Push a version tag.
2. GitHub Actions creates a draft release with an unsigned macOS arm64 app ZIP.
3. Publish the draft release.
4. GitHub Actions signs and notarizes the app, uploads the signed ZIP and `latest-mac.yml` update metadata, and removes the unsigned ZIP.
5. Stable releases update `MagnusOpera/homebrew-tap` with the signed Forge cask.

## Version Tags

Both `0.1.0` and `v0.1.0` style tags are supported.

The recommended local release preparation command is:

```sh
make release-prepare version=0.1.0
```

It moves the `## [Unreleased]` notes into `## [0.1.0]`, commits `CHANGELOG.md`, and creates an annotated tag.

To preview the changelog/tag operation without writing files:

```sh
make release-prepare version=0.1.0 dryrun=true
```

```sh
git push origin main --follow-tags
```

Each release tag must have a matching `## [x.y.z]` section in `CHANGELOG.md`.

## Required Secrets

Configure these repository secrets before publishing a release:

- `MAC_CERT_BASE64`: base64-encoded Developer ID Application `.p12` certificate.
- `MAC_CERT_PASSWORD`: password for the `.p12` certificate.
- `MAC_DEV_TEAM_ID`: Apple Developer Team ID.
- `MAC_DEV_LOGIN`: Apple ID used for notarization.
- `MAC_DEV_PASSWORD`: app-specific password for Apple notarization.
- `PAT_HOMEBREW_TAP`: token with write access to `MagnusOpera/homebrew-tap`.

The app is only signed after the GitHub release is published.

## Codex runtime packaging

Forge uses an installed Codex CLI and does not bundle or download a runtime. Keep macOS packaging arm64-only. The packaged application must discover Codex from PATH and the common Homebrew/local installation paths, or honor the executable path saved in global configuration. Verify this from a Finder-launched build, whose PATH may differ from a terminal session.

Before release, verify the CLI capability check, browser-based ChatGPT sign-in, model discovery, questions, approvals, Stop, steer/queue, and restart/resume against a disposable Git repository. Check logs, Markdown, and worktree diffs in both themes. Forge's own Codex home, thread records, attachments, and retained worktrees live under its Electron user-data `codex` directory and must never be included in release archives. Existing app updates preserve that directory. Archive does not delete local worktrees or branches.

## Dependency upgrade checks

Forge now builds with Electron 45, React 19, Vite 8, and TypeScript 7. Packaging still targets unsigned macOS arm64 ZIPs before the release signing workflow. Use a supported Node.js version from `package.json` when installing or packaging, and run `make check` to verify types, tests, and the dependency audit.

Existing-thread smoke checks should use a disposable Codex home and Git repository. Verify listing, Git project matching, original-ID resumption, questions/approvals, and restart recovery alongside an isolated Forge thread. Existing threads use the app/CLI account and original working folder; verify that Forge does not copy credentials or create replacement worktrees.

## Embedded terminal packaging

The renderer uses Coder’s `ghostty-web` with its bundled Ghostty WASM; it loads locally without a CDN or a server. Microsoft’s `node-pty` runs only in Electron main and uses N-API prebuilds. `npm ci` runs `scripts/prepare-terminal.cjs` to mark the Unix spawn helper executable. Keep `node_modules/node-pty/prebuilds` in `asarUnpack` so the native addon and helper can load from the packaged app. No Electron ABI rebuild is needed for these N-API prebuilds.

Before a release, verify a terminal in the unsigned macOS arm64 package: shell startup in the selected chat checkout, input and output, Ctrl+C, paste, resize, both themes, hiding/reopening, chat switching, session termination, and app shutdown. Confirm a checkout change closes its prior terminal session and reopening starts in the new folder. Terminal buffers and shell processes are in memory only and must not become release artifacts.
