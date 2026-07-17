# Changelog

All notable changes to Forge are documented in this file.

## [Unreleased]

- Refreshed the website homepage and added Magnus Opera branding to its footer.

## [0.0.33]


- Bolded repository names in favorites and removed pane header divider lines.
- Removed the repository name from the project titlebar and unified the sidebar surface across its titlebar.
- Unified vertical splitter rendering across glass and matte sidebar modes.
- Reduced pane dividers to a true 1px line.
- Kept the theme accent picker open more reliably while moving into its popup.
- Moved repository search so it appears only in the All repositories view.
- Added workflow run controls for default dispatches and prompted arguments when workflows require inputs.
- Darkened token and workflow confirmation screens to match other modal overlays.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.32...0.0.33

## [0.0.32]


- Kept the all repositories list alphabetically ordered when selecting a repository.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.31...0.0.32

## [0.0.31]


- Darkened the non-glass light sidebar background slightly.
- Made all repositories easier to scan by visually grouping repositories under each owner.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.30...0.0.31

## [0.0.30]


- Fixed the accent color picker appearing behind pull request action controls.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.29...0.0.30

## [0.0.29]


- Made workflow run branch or tag names copyable from the run header.
- Reduced workflow run header metadata and moved run timing into the Jobs tab.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.28...0.0.29

## [0.0.28]


- Fixed macOS startup after adding automatic update checks.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.27...0.0.28

## [0.0.27]


- Hid the website Home navigation link on mobile.
- Added automatic macOS update checks from GitHub Releases.
- Added a GitHub releases link to the About window.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.26...0.0.27

## [0.0.26]


- Removed Windows and Linux release builds and downloads.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.25...0.0.26

## [0.0.25]


- Disabled glass sidebar mode on Linux.
- Matched Windows glass mode to the native acrylic window backdrop.
- Switched Windows and Linux release downloads to single-file app artifacts.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.24...0.0.25

## [0.0.24]


- Hid auto-merge actions for approved pull requests.
- Matched the pull request action button hover state to the token save button.
- Made the Forge website use the light theme by default.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.23...0.0.24

## [0.0.23]


- Parallelized Windows and Linux release artifact builds by architecture.
- Moved workflow and workflow run metadata into the header, made run lists the default view, and made workflow paths, run ids, and commit SHAs copyable.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.22...0.0.23

## [0.0.22]


- Fixed release artifact packaging on GitHub Actions.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.21...0.0.22

## [0.0.21]


- Updated the Forge website.
- Moved token entry to a dedicated full-window screen with the key icon inline, a right-aligned settings link, and a neutral save icon button beside the token input.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.20...0.0.21

## [0.0.20]


- Added the GitHub Pages website.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.19...0.0.20

## [0.0.19]


- Tightened the titlebar height and aligned its controls with the macOS traffic lights.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.18...0.0.19

## [0.0.18]


- Animated focused textbox borders with the active accent color.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.17...0.0.18

## [0.0.17]


- Normalized titlebar icon underline size, alignment, and animated copy rendering without accenting clicked icons.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.16...0.0.17

## [0.0.16]


- Removed the selected background from titlebar view icons while widening their animated underline.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.15...0.0.16

## [0.0.15]


- Defaulted first-run sidebar appearance to glass mode.
- Moved animated titlebar toolbar underlines inside the active icon button.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.14...0.0.15

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
