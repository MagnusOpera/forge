# Changelog

All notable changes to Forge are documented in this file.

## [Unreleased]

- Matched selected pull request review actions to the titlebar underline style.
- Moved the content GitHub link next to the third pane title.
- Added a pull request titlebar action to switch open pull requests between draft and ready.
- Highlighted the current pull request review action after approving or requesting changes.
- Preserved favorite repositories after clearing the stored GitHub token.
- Validated saved GitHub tokens as classic tokens with the required repo and read:project permissions.

## [0.0.6]


- Added pull request label editing from the pull request detail header.
- Showed the pull request author in the pull request detail header.
- Refreshed the active pull request, issue, workflow, or run when using the repository refresh action.
- Added inline pull request commenting and title editing actions.
- Hid pull request review actions when the current GitHub user authored the pull request.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.5...0.0.6

## [0.0.5]


- Added Homebrew tap cask publishing for signed Forge releases.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.4...0.0.5

## [0.0.4]


- Added an expand and collapse animation for the accent color picker.
- Fixed packaged macOS builds loading a blank window by using relative renderer asset paths.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.3...0.0.4

## [0.0.3]


- Switched release signing to Electron-aware macOS signing and made notarization failures print Apple's rejection log without stapling.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.2...0.0.3

## [0.0.2]


- Disabled electron-builder's implicit tag publishing so release builds use the GitHub release workflow without a `GH_TOKEN` secret.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.1...0.0.2

## [0.0.1]

- Added Forge contributor guidance and CI changelog enforcement for branch builds.
- Added a release preparation target that materializes changelog entries, commits them, and creates the release tag.
- Added branch-push CI for typechecking, building, unit tests, and GitHub test summaries.
- Added GitHub Actions release packaging for unsigned macOS arm64 draft artifacts and signed/notarized macOS arm64 release artifacts.

**Full Changelog**: https://github.com/MagnusOpera/forge/commits/0.0.1

## [0.1.0]

- Built the initial Forge desktop app for a focus-first GitHub workflow.
- Added repository, pull request, workflow run, issue, workflow, markdown, diff, theme, accent color, and review flows.
- Added the Forge app icon and macOS application branding.

**Full Changelog**: https://github.com/MagnusOpera/forge/commits/0.1.0
