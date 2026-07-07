# AGENTS

This file defines contributor expectations for building, testing, regression safety, release-note hygiene, and Electron-specific work in Forge.

## Build, Test, and Non-Regression

Use these commands before opening or updating a PR:

- Build: `make build`
- Unit tests: `make test`
- Full local check: `make check`
- Changelog gate: `make verify-changelog`

Equivalent direct commands:

- `npm run build`
- `npm test`
- `npm run typecheck`
- `npm audit --audit-level=high`

For release packaging checks:

- Unsigned macOS arm64 package: `make package-mac-arm64 version=X.Y.Z`

## Test Quality Policy

- Every new feature should include automated test coverage when the behavior can be isolated.
- Every bug fix should include a regression test reproducing the prior failure mode when practical.
- Prefer tests around pure logic in `src/appLogic.ts` or focused helper modules rather than broad renderer tests.
- Keep Electron main-process behavior testable by extracting pure parsing, mapping, and cache-key logic out of IPC handlers when changing it.
- If UI behavior changes without a practical unit seam, verify with the running app and document the manual check in the PR.

## Electron and App Architecture

- The GitHub token must stay in the Electron main process. Do not expose it to the renderer.
- Renderer code must call GitHub through the preload IPC API only.
- Prefer Octokit GraphQL for rich GitHub entities and REST for Actions/workflow endpoints.
- Keep GitHub as the source of truth: every repository, PR, issue, workflow, run, commit, and file should retain an Open in GitHub path.
- Keep the app local-only. Do not add a backend service.
- Preserve the three-pane model:
  - left pane: repository navigation
  - middle pane: project focus
  - right pane: content
- Preserve keyboard-first behavior and permanent navigation.
- macOS app packaging is arm64-only for now.

## UI Expectations

- The app should feel like a developer tool, not a social feed.
- Keep chrome minimal, dense, and fast.
- Avoid marketing pages, profile/feed concepts, discovery surfaces, and notification-center behavior.
- Use the existing theme, accent, tab, and pane patterns instead of introducing new visual systems.
- When changing markdown, diffs, logs, or terminal-like output, verify both light and dark themes.

## Release Notes (Unreleased)

- `CHANGELOG.md` must keep a top `## [Unreleased]` section.
- Each new feature/fix entry must be a short, single-line bullet.
- Write entries in user-facing terms, not implementation detail.
- At release time, move unreleased entries to the versioned section and reset `Unreleased`.
- Each released version section should end with a link:
  - first release: `**Full Changelog**: https://github.com/MagnusOpera/forge/commits/<tag>`
  - later releases: `**Full Changelog**: https://github.com/MagnusOpera/forge/compare/<previous-tag>...<new-tag>`
- When publishing the GitHub release, include that same link in the release notes body.

## Commit Gate

- Every commit that targets `main` must update `CHANGELOG.md`.
- Required format for regular commits:
  - add at least one short, single-line bullet under `## [Unreleased]`.
- Exception: release commits (`chore(release): X.Y.Z`) may leave `## [Unreleased]` empty.
- Local preflight command:
  - `make verify-changelog`
- CI runs the changelog gate on branch pushes.

## Release Process (Tags and GitHub Draft)

Follow this sequence for every release:

1. Run `make release-prepare version=X.Y.Z`.
   - Optional preview mode: `make release-prepare version=X.Y.Z dryrun=true`
2. Push commit and tag together: `git push origin main --follow-tags`.
3. Wait for CI to create the GitHub Release as a draft from the tag workflow.
4. Confirm the draft notes are sourced from `CHANGELOG.md` `## [X.Y.Z]`.
5. Publish that existing draft release.

Rules:

- Tag-triggered CI is the source of truth for release artifacts and draft release creation.
- Do not bypass the draft step.
- Tag workflow must fail if `CHANGELOG.md` has no non-empty `## [X.Y.Z]` section with bullets and a changelog link.
- Release notes must match the `CHANGELOG.md` version section.
- `make release-prepare` supports `X.Y.Z` only.

## PR Checklist

- Build passes.
- Relevant tests pass.
- New behavior is test covered or manually verified where unit coverage is impractical.
- Electron token boundaries are preserved.
- GitHub API access remains behind IPC.
- `CHANGELOG.md` `## [Unreleased]` has a concise one-line entry for the change.
- Release or packaging changes update `RELEASE.md` when relevant.

## Direct To Main Policy

- Committing directly to `main` follows the same quality bar as a PR.
- Build, test, changelog, and relevant documentation updates must be in the same change set.
- Direct-to-main commits are blocked by the changelog gate if `CHANGELOG.md` is not updated.
