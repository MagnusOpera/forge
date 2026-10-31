# Forge

Forge is a focus-first desktop GitHub client for working through repositories, pull requests, issues, workflows, and review state from a dense three-pane workspace.

The app is built with Electron, React, TypeScript, and Vite. It stays local-only: GitHub API access is handled by the Electron main process, and the GitHub token is not exposed to the renderer.

## Features

- Repository navigation with search, favorites, and local monitoring.
- Project focus views for Codex threads, pull requests, workflow runs, issues, and workflows.
- Pull request details with title editing, labels, review actions, readiness, auto-merge, comments, markdown, and GitHub URL actions.
- Workflow and job views for inspecting GitHub Actions state.
- Keyboard-friendly navigation with persistent three-pane context.
- Light, dark, and system themes with accent colors and optional glass sidebar appearance.

## Installation

Forge is available for macOS.

Install macOS builds with Homebrew from the Magnus Opera tap:

```sh
brew tap magnusopera/tap
brew install forge
```

The tap is `magnusopera/tap`, and the formula is `forge`. You can also download the latest signed macOS build from [GitHub Releases](https://github.com/MagnusOpera/forge/releases/latest).

## Development

Use Node.js 22.12+ on the 22 LTS line, or Node.js 24 LTS. CI uses Node.js 22. Node type definitions follow Electron's embedded Node.js 24 runtime.

Install dependencies:

```sh
npm install
```

Run the Electron app in development:

```sh
npm run dev
```

Build the app:

```sh
make build
```

Run tests:

```sh
make test
```

Run the changelog gate:

```sh
make verify-changelog
```

Preview the GitHub Pages website:

```sh
make website
```

Build the GitHub Pages website artifact:

```sh
make website-build
```

Deploy the website independently from releases by running the Publish Website workflow from `main`.

Create release artifacts:

```sh
make package-release-archives version=X.Y.Z
```

## License

Forge is released under the MIT License. See [LICENSE](LICENSE).

## Codex workspace

Install the official Codex CLI locally before using Codex in Forge. Forge finds `codex` on PATH or in common macOS installation directories. Global configuration also accepts an absolute executable path. Forge checks the installed app-server protocol before enabling conversations; an incompatible CLI needs updating. The CLI is not included in the Forge download.

Open the gear immediately left of the theme/color picker in the third pane's toolbar for global configuration. It contains GitHub token management, ChatGPT sign-in, the Codex executable path, and defaults for model, reasoning effort, speed, Plan/Implement, Steer/Queue, and permissions. The model catalog and supported efforts come from the installed Codex runtime. Blank model and effort choices use the server's defaults.

Open the gear beside a project's name to choose its local Git folder and override any Codex default independently. “Use global” restores inheritance for that setting. New threads snapshot the effective settings; changes to global or project configuration do not rewrite existing threads. Model, effort, speed, mode, and follow-up controls are also available in each thread. Model, effort, speed, and mode changes apply to its next turn. Steer/Queue changes affect the next submitted follow-up.

Selecting a favorite repository opens Codex. Its middle pane lists active and archived threads; the right pane contains the conversation, questions, approval requests, command output, and file changes. `⌘⇧C` opens Codex. Global configuration → Message input chooses Enter or ⌘Enter/Ctrl+Enter to send across all chats. With ⌘Enter/Ctrl+Enter selected, plain Enter inserts a line break. Shift+Enter always inserts a line break; inside code blocks, Enter inserts a line break and ⌘Enter/Ctrl+Enter sends. Tab navigation is enabled in Codex and configuration dialogs.

Each new Forge thread creates a branch named `codex/forge-<id>` and a separate worktree beneath Forge's local user-data directory when its first prompt is sent. The base is the configured checkout's committed HEAD. Uncommitted checkout changes are excluded. Changing a project's configured folder affects future threads only. Archive retains the branch, worktree, and conversation. Forge never automatically deletes worktrees; remove retained worktrees with Git after preserving any changes you need.

Plan mode uses a read-only sandbox. Implement mode supports three permission presets, configured globally or overridden per project:

- Ask when needed permits worktree writes and displays Codex requests for additional access. Network access starts disabled.
- Strict sandbox permits worktree writes, disables network access, and declines escalation.
- Full access permits unrestricted local commands and network access. Plan mode remains read-only even with this preset.

Steer sends guidance to a running turn. Queue waits for successful completion and sends pending messages in order. Stop, failure, questions, and approvals prevent queued work from advancing. Queues remain paused after restart until explicitly resumed. A failed steering request retains the composer text; Forge never automatically resends it as a new turn.

Threads, transcripts, drafts, queued messages, and project folder bindings stay on this computer. New Forge threads use Forge's own Codex home and ChatGPT login, separate from `~/.codex` and FeatStudio2. Credentials and Git operations stay in Electron main, behind preload IPC. Codex uses OpenAI for inference; this does not introduce a Forge backend. There is no Insights integration.

The third-pane toolbar has worktree quick actions. Click the main/worktree label to copy the current checkout path, or click the folder icon to open Finder immediately. The editor icon beside it opens the current checkout in your configured text editor. Choose an application name or use the native application picker in global configuration; Visual Studio Code is the default and does not require the `code` command on PATH. The diff icon opens a refreshable review of tracked and untracked changes since the thread base, with unified and split views. Merge <default branch>, Commit, Push, and Create PR send normal messages to Codex and preserve your composer draft. Merge <default branch> discovers the origin remote's current default branch, fetches origin, and merges that branch into the current worktree branch. It does not assume a main or master branch. It stops for uncommitted changes, an ongoing merge/rebase, or conflicts instead of automatically stashing or discarding work, and does not push. These actions require an idle, unarchived thread in Implement mode with no queued messages, and use its existing permissions and available GitHub tooling. On a crash or app shutdown, unfinished threads become interrupted and pending question/approval IDs are cleared. Resume explicitly to reconnect. Missing threads or worktrees show an error and are never silently replaced.

Forge chats start in an isolated worktree. **Merge into <default branch>** confirms a local merge, removes the clean merged worktree, and continues the same chat on the default branch checkout. **Start worktree** confirms a fresh worktree from that local branch and continues the same chat there. Commit changes before either move; merges do not push. Finder, the configured editor, and subsequent Codex turns follow the chat’s current checkout. The worktree branch and conversation history are retained.

The terminal button in the Codex header opens a Ghostty terminal below the input, inside the third pane. Drag the horizontal splitter or use its arrow keys to resize it. Opening it in a new chat creates its worktree without sending a Codex message. Each chat has its own local login shell, initially in that chat’s worktree (or its current default-branch checkout). Hiding the terminal or navigating away keeps the session and commands running; reopening reconnects with recent output. The trash button ends the session. Archiving a chat also ends its terminal and discards its retained output; restoring the chat lets you open a fresh terminal. Sessions end when Forge quits; they are not restored after restart. A confirmed checkout change also ends that chat’s terminal before removing or replacing its working folder. Terminal commands run as you, independently of Codex’s permission preset.

### Existing Codex app and CLI threads

Use the history icon beside New thread to browse existing local Codex conversations for the project's configured Git repository. Forge asks app-server to list threads from `CODEX_HOME`, or `~/.codex` when unset, and matches folders by Git repository identity, including linked worktrees and subfolders. Active and archived conversations can be browsed separately; Scan more threads continues through older history. Restore and add also restores an archived thread in Codex.

Add to Forge records the original thread ID and working folder. Sending its next message resumes that same conversation, using the existing Codex app/CLI account and configuration. Forge's selected model, mode, effort, speed, follow-up behavior, and permission preset apply to new turns. New Forge threads continue using Forge's isolated Codex home and login. External credentials are never copied into Forge or exposed to the renderer.

Finish or stop a thread in Codex before continuing it in Forge. Its existing folder may be shared with other threads. No worktree or branch is created and existing uncommitted changes are retained. The diff baseline is the folder's committed HEAD when added to Forge. Forge displays the most recent 50 turns when the runtime supports history retrieval; earlier context stays with Codex even when it cannot be displayed. Removing or moving that folder prevents resumption. Archiving or renaming an attached thread in Forge affects its Forge listing only.
