# Release

Forge follows the same two-step release model as FScript.

1. Push a version tag.
2. GitHub Actions creates a draft release with an unsigned macOS arm64 app ZIP.
3. Publish the draft release. In Forge, open Releases (`⌘⇧L`), choose Draft, review the notes, and choose **Release action → Publish release**. The existing prerelease flag is preserved: prerelease drafts stay Pre-release; other drafts become Latest. Published prereleases appear in Preview, and stable releases appear in Active.
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

## GitHub sign-in configuration

Register a GitHub **OAuth App** owned by MagnusOpera (once for Forge, not once per user):

- Homepage: `https://github.com/MagnusOpera/forge`
- Authorization callback URL: `http://127.0.0.1/github/callback`
- Leave callback wildcard matching and device flow disabled. Forge uses authorization code flow with PKCE S256, random state, and a temporary IPv4 loopback listener on an available port.

Generate a client secret, and add `FORGE_GITHUB_CLIENT_ID` and `FORGE_GITHUB_CLIENT_SECRET` as repository Actions secrets. The tag packaging workflow injects these into the main-process build and fails if either is missing. Do not commit credentials. GitHub currently requires a client secret even with PKCE. As with any native OAuth client, the distributed app credentials can be extracted from the package; they cannot be treated as a confidential server secret. PKCE protects the authorization code exchange. No hosted backend is used.

For local development or packaging, export both variables in the shell before running `npm run dev` or `make build`. Alternatively, put the variables in an ignored `.env` file and run `make dev`, which loads and exports them for the development processes. Direct `npm run dev` and build commands use the existing shell environment. The build script writes `dist-electron/github-oauth.json`, which is ignored by Git and included only with Electron's main-process artifacts. Development builds without credentials remain buildable and report a configuration error when sign-in is attempted. Never use a `VITE_` variable for OAuth credentials.

Users approve the existing `repo` and `read:project` permissions. Organizations with OAuth App restrictions must approve Forge before it can access their resources. An owner can review Forge under **Organization settings → Third-party Access → OAuth app policy** and grant access; see [GitHub’s approval instructions](https://docs.github.com/en/organizations/managing-oauth-access-to-your-organizations-data/approving-oauth-apps-for-your-organization). Users may also need to complete organization SAML SSO.

GitHub browser sign-in is the only supported login method. Forge supports non-expiring OAuth tokens and automatically refreshes expiring sessions when GitHub supplies a refresh token. Access and refresh tokens are encrypted using Electron safeStorage. Saved personal access tokens are no longer used: upgrades return those users to browser sign-in. Existing OAuth sessions, including records from before this change, remain usable. Sign out deletes local credentials and cached GitHub data; users can revoke authorization separately in GitHub’s application settings.

Before release, test a fresh sign-in, rejection, cancellation, restart, sign-out, and reauthentication against the registered app. Verify that a saved personal-token connection returns to sign-in after upgrading, and that a saved OAuth session remains connected. Confirm repository/project access and Actions operations with an organization that requires approval. Verify the first-run screen and global GitHub configuration in both themes. Automated tests cover local callbacks, PKCE/state, cancellation, timeout, token exchange, refresh, and credential write races; a real GitHub consent round trip needs the registered app.

## Codex runtime packaging

Forge uses an installed Codex CLI and does not bundle or download a runtime. Keep macOS packaging arm64-only. The packaged application must discover Codex from PATH and the common Homebrew/local installation paths, or honor the executable path saved in global configuration. Verify this from a Finder-launched build, whose PATH may differ from a terminal session.

Before release, verify the CLI capability check, browser-based ChatGPT sign-in, model discovery, questions, approvals, Stop, steer/queue, and restart/resume against a disposable Git repository. Check logs, Markdown, and worktree diffs in both themes. Forge's own Codex home, thread records, attachments, and retained worktrees live under its Electron user-data `codex` directory and must never be included in release archives. Existing app updates preserve that directory. Archive does not delete local worktrees or branches.

## Dependency upgrade checks

Forge now builds with Electron 45, React 19, Vite 8, and TypeScript 7. Packaging still targets unsigned macOS arm64 ZIPs before the release signing workflow. Use a supported Node.js version from `package.json` when installing or packaging, and run `make check` to verify types, tests, and the dependency audit.

Existing-thread smoke checks should use a disposable Codex home and Git repository. Verify listing, Git project matching, original-ID resumption, questions/approvals, and restart recovery alongside an isolated Forge thread. Existing threads use the app/CLI account and original working folder; verify that Forge does not copy credentials or create replacement worktrees.

## Embedded terminal packaging

The renderer uses Coder’s `ghostty-web` with its bundled Ghostty WASM; it loads locally without a CDN or a server. Microsoft’s `node-pty` runs only in Electron main and uses N-API prebuilds. `npm ci` runs `scripts/prepare-terminal.cjs` to mark the Unix spawn helper executable. Keep `node_modules/node-pty/prebuilds` in `asarUnpack` so the native addon and helper can load from the packaged app. No Electron ABI rebuild is needed for these N-API prebuilds.

Before a release, verify a terminal in the unsigned macOS arm64 package: shell startup in the selected chat checkout, input and output, Ctrl+C, paste, resize, both themes, hiding/reopening, chat switching, session termination, and app shutdown. Confirm a checkout change closes its prior terminal session and reopening starts in the new folder. Terminal buffers and shell processes are in memory only and must not become release artifacts.

## App icon assets

The selected artwork is `assets/icon-proposals/forge-ignition.png`. Earlier concepts,
including the diagonal GitHub/Codex design, remain in that directory.

On macOS, run `bash scripts/generate-app-icons.sh` from the repository root to
regenerate the transparent 1024px PNG, macOS ICNS, Windows ICO, SVG wrapper, and web-sized PNG assets.
This uses AppKit, `sips`, `iconutil`, and Python 3. The SVG embeds the PNG losslessly;
it is not vector artwork. Existing app and website paths remain unchanged.
The macOS bundle references `forge-ignition.icns` through `CFBundleIconFile` and
copies the current ICNS into Resources under that name. Keep these packaging
settings together. The distinct filename replaces the previous `icon.icns`
reference so macOS can refresh cached app artwork. Native macOS notifications
use that bundle icon and must omit a custom notification image to avoid a second
logo on the right. Verify a fresh notification after installing a packaged build;
if macOS still shows cached artwork, quit and reopen Forge after refreshing its
Launch Services registration with
`/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/Forge.app`.

The source includes a gray presentation backdrop and a baked-in shadow. Keep the
export mask aligned with the metallic tile edge so neither appears in the Dock.
