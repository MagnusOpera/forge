# Changelog

All notable changes to Forge are documented in this file.

## [Unreleased]

- Remove the gray strip beneath the app icon in the macOS Dock and website icons.

## [0.19.0]


- Update the website logo and browser icons to the new Forge spark design.

- Refresh Forge's app icon with a glowing spark on a dark macOS-style tile.
- Put Commit first in the Codex message toolbar.

- Show the thread name in detached Codex window titles.
- Let Codex message text use the full editor width in wide windows.
- Keep cursor arrow keys working in detached Codex message editors.
- Paste clipboard images and files into Codex messages as attachments.
- Confirm before quitting Forge while Codex threads or repository operations are running.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.18.1...0.19.0

## [0.18.1]


- Avoid compiler verification test timeouts on slower CI runners.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.18.0...0.18.1

## [0.18.0]


- Enable React Compiler to automatically memoize eligible components and hooks.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.17.1...0.18.0

## [0.17.1]


- Refresh website screenshots to show the streamlined project toolbar and sidebar refresh control.

- Smooth project refresh feedback so the selected view underline stays visible after the animation.

- Restart the refresh of all favorite repositories from the sidebar monitoring icon.

- Refresh the project by clicking its selected view icon, with animated feedback and a simpler toolbar.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.17.0...0.17.1

## [0.17.0]


- Use GitHub sign-in exclusively and explain organization OAuth approval.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.16.0...0.17.0

## [0.16.0]


- Show the active GitHub authentication method, clearer switching controls, and restart guidance after development updates.

- Load optional local development credentials from `.env` when running `make dev`.

- Connect to GitHub through browser sign-in or a classic personal access token.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.15.1...0.16.0

## [0.15.1]


- Set a global default thread starting point and project-specific choices under GitHub settings.

- Remove the Octocat and Forge titlebar label and refresh website screenshots.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.15.0...0.15.1

## [0.15.0]


- Refresh website screenshots and showcase draft release publishing in both themes.

- Match release publishing controls to the existing PR action menu.

- Publish draft releases while preserving prerelease status and marking stable releases as Latest.

- Browse active, preview, and draft GitHub releases with newest-first dates, release notes, and the ⌘⇧L shortcut.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.14.1...0.15.0

## [0.14.1]


- Check Codex at startup and automatically upgrade outdated Homebrew or global npm installations.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.14.0...0.14.1

## [0.14.0]


- Simplify shortcut documentation into tables and remove basic typing and Tab-navigation explanations.

- Keep keyboard shortcuts working when the model picker is closed.

- Detach and reattach the current content pane with ⌘⇧D, including while editing a message.

- Remove tmux terminal persistence; remote terminals now use SSH login shells.

- Expand installation instructions for Codex ChatGPT sign-in, project checkouts, and remote SSH environments.

- Update documentation with current keyboard shortcuts, detachable-window behavior, and checkout options.

- Frame the main website screenshot with the same inset background and shadow as detached-window previews.

- Remove the website screenshot title bar and decorative controls, keeping native controls inside app screenshots.

- Introduce Forge as an AI Development Environment and refresh website highlights for its complete coding workflow.

- Showcase detachable conversation windows on the website with anonymous previews in both themes.

- Search conversation titles and messages from the thread list, with ranked matches and excerpts.

- Remove the existing Codex thread import browser and button.

- Refresh website screenshots with conversation search, native macOS window controls, and anonymous demo repositories.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.13.2...0.14.0

## [0.13.2]


- Align macOS window controls with the header title and icons, including when changing zoom.

- Move global settings and theme controls to the expanded repository pane and simplify content and detached window toolbars.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.13.1...0.13.2

## [0.13.1]


- Preserve the main window’s selection when closing an external window; select its item only when using Reattach.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.13.0...0.13.1

## [0.13.0]


- Choose a default-branch worktree, the default branch, a new named branch, or the current repository branch below the environment selection before a Codex thread starts, with automatic branch-name availability checks.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.12.0...0.13.0

## [0.12.0]


- Keep detached windows aligned with Forge when its bottom edge extends offscreen.

- Remove secure token storage deprecation warnings when signing in and loading saved credentials.

- Refine Codex conversations with rounded message bubbles, balanced spacing, and a jump-to-latest control that preserves your reading position.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.11.0...0.12.0

## [0.11.0]


- Use distinct picture-in-picture and app-window icons for detaching and reattaching content.

- Open detached items at the exact screen position and size of their original content pane.

- Shrink Forge to its two navigation panes for detached items and restore its previous size when the third pane returns.

- Detach individual items into independent windows while keeping other content in the main window’s third pane.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.10.4...0.11.0

## [0.10.4]


- Shorten home-directory paths to ~ throughout macOS and Linux displays while retaining absolute file-operation paths.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.10.3...0.10.4

## [0.10.3]


- Review worktree integration in an in-app dialog with squash merge selected by default and changes staged before updating the default branch.
- Automatically finish merged worktree cleanup and continue on the default branch without cleanup popups or extra user actions.
- Wait for the terminal shell and its child jobs to stop before merging or changing checkout.
- Introduce Codex on the homepage and refresh the light and dark app previews.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.10.2...0.10.3

## [0.10.2]


- Offer Codex-assisted merge conflict resolution in the worktree, including unpushed changes on the local default branch.
- Show only one live Codex activity timer when follow-up messages split the same turn into multiple groups.
- Show Codex progress updates directly in the chat while keeping commands and tool output in expandable activity sections.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.10.1...0.10.2

## [0.10.1]


- Recheck Codex checkout errors after closing configuration and clear them once the checkout is ready.
- Guide users to configure missing Codex checkouts with a calm setup prompt and hide technical IPC error prefixes.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.10.0...0.10.1

## [0.10.0]


- Reduce the space before Codex activity summaries while keeping message actions accessible.
- Restore timed Codex activity separators and show edited-file summaries with clickable diffs.
- Show Codex attachments as filename chips with file-type icons and open them in the default app when clicked.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.9.2...0.10.0

## [0.9.2]


- Keep Codex composer tools on one row when narrowing a thread window.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.9.1...0.9.2

## [0.9.1]


- Simplify remote terminal headings by showing persistence only when tmux is selected.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.9.0...0.9.1

## [0.9.0]


- Open individual Codex threads in separate windows with shared sessions, preserved drafts, terminal handoff, and a compact toolbar.
- Keep editable environment selection below the description and fixed targets beside composer status.
- Hide remote reconnection controls unless a thread is interrupted or failed.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.8.0...0.9.0

## [0.8.0]


- Group project checkouts together and choose a default environment for new threads.
- Keep archived thread environments read-only, including threads without messages.
- Show environment names below the new-thread description and link missing or invalid checkouts to project configuration.
- Choose None or tmux for terminal persistence beside the remote Codex executable.
- Automatically save and check environment edits, with inline connection status and deletion beside the selector.
- Organize GitHub and Codex account settings by service and optionally use a separate Codex account for each project.
- Run Codex threads on remote SSH environments with isolated worktrees and optional persistent terminals.
- Configure environments and project checkout paths locally, with home-relative path suggestions and automatic validation.
- Navigate global and project configuration with sidebars, repository-style selection highlights, and stable window-relative sizing.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.7.0...0.8.0

## [0.7.0]


- Prevent terminal memory corruption from carrying over when a terminal is destroyed and recreated.

- Keep the terminal header compact by removing the repeated branch and checkout path.

- End a chat’s terminal session and discard its retained output when the chat is archived.

- Avoid a terminal startup error when a new shell has not produced its first output yet.

- Open a resizable Ghostty terminal below the Codex input, with persistent shell sessions per chat in its worktree or default-branch checkout.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.6.0...0.7.0

## [0.6.0]


- Center the access dropdown over its button while keeping it inside the window.

- Center model and access controls above the input, with Git actions on the left and chat status on the right.

- Return the checkout path, Finder, editor, and diff actions to the third-pane header toolbar.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.5.0...0.6.0

## [0.5.0]


- Unify configuration, access, and workflow dropdowns with a shared styled combobox and keyboard navigation.

- Configure Enter or Command/Ctrl+Enter to send messages globally, with reliable shortcuts in the Markdown input.

- Choose the chat access level from a styled dropdown above the Codex input.

- Copy checkout paths from the main/worktree label and open Finder immediately from the folder button.

- Float attachment and Send buttons inside the input, with Send changing to Stop while Codex is processing.

- Center the model and effort popup above its selector while keeping it within the window.

- Place the borderless model selector beside the Git actions above the Codex input, with a matching hover background.

- Remove the keyboard and document-drop helper text below the Codex input.

- Show Codex status and access on the right above the message input.

- Fade the Codex input accent border smoothly on hover and focus.

- Move Codex checkout and Git actions above the message input to free space in the top toolbar.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.4.0...0.5.0

## [0.4.0]


- Keep back and forward navigation aligned with the content toolbar title.

- Match Codex chat scrollbars to the slim, theme-aware scrollbars in PR descriptions.

- Keep the same chat while merging into the default branch and starting fresh worktrees, with confirmation and matching Finder/editor locations.

- Show the default branch name in the merge action and shorten the Git action tooltips.

- Clear the Codex input after sending without restoring the previous message when the editor becomes available again.

- Show message timestamps and copy controls on hover, with editing limited to your latest prompt and regenerating its response.

- Align your Codex messages on the right with an accent border and keep replies on the left, with progress and tool activity collapsed under a timed work summary.

- Preserve headings, bold, italic, code, and line breaks when pasting Markdown or formatted documents into Codex messages.

- Use a compact model and effort popover in Codex messages, with a styled model menu, reliable effort changes, and mode and follow-up settings kept in project configuration.

- Compose Codex messages with visual Markdown formatting, attach documents by drag and drop, and view Mermaid diagrams, images, and downloadable files in replies.

- Added a worktree editor shortcut beside Finder, with a global editor preference defaulting to VS Code.

- Moved global configuration beside the theme/color picker in the content toolbar, keeping its position consistent when the sidebar is collapsed.

- Added a chat toolbar action to discover and merge the repository default branch into the current worktree with Codex.

- Removed the duplicate bottom separator in global and project configuration.

- Matched Active and Archived thread tabs to pull request tabs, with icons, counts, and a sliding underline.

- Inset configuration dropdown chevrons and replaced override controls with compact icons.

- Added project browsing and resumption of existing Codex app and CLI threads, with recent history when available.

- Aligned diff toolbar icons vertically with the modal title.

- Replaced Unified and Split labels in worktree diffs with compact toolbar icons.

- Updated app and build dependencies, including Electron 45 and React 19, and resolved the dependency audit findings.

- Added a centered, full-color Codex logo to empty thread conversations.

- Matched Codex thread selection, titles, metadata, and status badges to the existing project list style.

- Added thread toolbar shortcuts to copy or open worktrees, review diffs, and ask Codex to commit, push, or create a pull request.

- Added local Codex threads with planning, implementation, questions, approvals, steering, queued follow-ups, and isolated Git worktrees.
- Added global and per-project Codex configuration, including model, effort, speed, permissions, and local repository folders.
- Made Codex the default view when selecting favorite repositories and moved GitHub token management into global configuration.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.3.0...0.4.0

## [0.3.0]


- Made repository updates near real time with adaptive polling for visible projects and live workflows.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.2.0...0.3.0

## [0.2.0]


- Added keyboard shortcuts to refresh repositories, cycle favorites, switch or cycle project views, and move the middle-pane selection.
- Prevented mouse hover from resembling a second selection during middle-pane keyboard navigation.
- Disabled Tab and Shift-Tab focus traversal throughout the app.
- Added a dedicated website documentation page for Forge's keyboard shortcuts.
- Simplified the homepage feature cards by removing their numeric labels.
- Enabled independent website deployments from the main branch.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.1.0...0.2.0

## [0.1.0]


- Refreshed the website homepage and added Magnus Opera branding to its footer.

**Full Changelog**: https://github.com/MagnusOpera/forge/compare/0.0.33...0.1.0

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
- Built the initial Forge desktop app for a focus-first GitHub workflow.
- Added repository, pull request, workflow run, issue, workflow, markdown, diff, theme, accent color, and review flows.
- Added the Forge app icon and macOS application branding.

**Full Changelog**: https://github.com/MagnusOpera/forge/commits/0.1.0
