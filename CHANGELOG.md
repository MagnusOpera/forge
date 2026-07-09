# Changelog

All notable changes to Forge are documented in this file.

## [Unreleased]

- Defaulted first-run sidebar appearance to glass mode.
- Moved animated titlebar toolbar underlines inside the active icon button.

## [0.0.14]


- Prevented the GitHub token prompt from flashing during startup authentication checks.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.13...0.0.14

## [0.0.13]


- Animated theme changes when switching between system, light, and dark appearances.
- Made pane splitters thinner with animated non-accent hover colors.
- Moved glass appearance into the theme picker with per-theme settings and smoother transitions.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.12...0.0.13

## [0.0.12]


- Restored the first pane splitter hover highlight.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.11...0.0.12

## [0.0.11]


- Prevented pointer-clicked controls from leaving focus rings in screenshots.
- Kept the repository splitter body and borders independent from the glass sidebar.
- Matched native macOS glass appearance to the selected Forge theme.
- Improved the dark sidebar glass transparency and search-field contrast.
- Let the sidebar Octocat switch between glass and normal sidebar appearances.
- Gave the repository sidebar a more macOS-like translucent material treatment.
- Added a system theme option that follows the current macOS appearance.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.10...0.0.11

## [0.0.10]


- Added a sidebar status for favorite project background checks.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.9...0.0.10

## [0.0.9]


- Kept pull request title controls attached to the title text without resizing the edit field.
- Animated the project sync control when refresh is invoked.
- Changed project and content GitHub URL buttons to copy first and open on double-click.
- Added native notifications for new pull requests and workflow failures in favorite repositories.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.8...0.0.9

## [0.0.8]


- Started Forge at the same scale as one Electron zoom-in step.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.7...0.0.8

## [0.0.7]

- Merged pull request ready and auto-merge controls when their state maps cleanly to Forge workflows.
- Hid pull request auto-merge actions when the repository does not allow auto-merge.
- Clarified GitHub API auto-merge failures and recovered stale pull request auto-merge state.
- Fixed pull request auto-merge on repositories that only allow squash or rebase merging.
- Split pull request titlebar controls into ready/draft and auto-merge menus.
- Added contributor-only pull request controls for auto-merge state, merge, and close.
- Used clearer icons for pull request readiness and auto-merge state controls.
- Removed hover tooltips from Forge controls to reduce interface clutter.
- Kept rapid pull request label removals from reappearing during background sync.
- Closed pull request state and review pickers after leaving them with the pointer.
- Made pull request draft, review, and label actions update immediately with toast rollbacks on failure.
- Changed pull request draft and ready actions to use the titlebar hover selector.
- Collapsed pull request review actions into a vertical hover selector with a single current-state icon.
- Matched selected pull request review actions to the titlebar underline style.
- Moved the content GitHub link next to the third pane title.
- Added a pull request titlebar action to switch open pull requests between draft and ready.
- Highlighted the current pull request review action after approving or requesting changes.
- Preserved favorite repositories after clearing the stored GitHub token.
- Validated saved GitHub tokens as classic tokens with the required repo and read:project permissions.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.6...0.0.7

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
