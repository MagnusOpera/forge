# Forge

Forge is an AI Development Environment for macOS that brings Codex, GitHub, worktrees, terminals, and code review together in a three-pane desktop workspace.

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

Install the official Codex CLI locally before using Codex in Forge. Forge finds `codex` on PATH or in common macOS installation directories. Global configuration also accepts an absolute executable path. On startup, Forge checks for Codex CLI 0.164.0 or newer and automatically upgrades older Homebrew or global npm installations through their original package manager. Compatible versions are left alone. Custom installations require updating with their original installer; upgrade failures and retry instructions appear in Global configuration → Codex. Forge also checks the app-server protocol before enabling conversations. The CLI is not included in the Forge download, and Forge does not keep its own installation. Remote hosts remain separately managed.

Open the gear in the expanded repository sidebar for global configuration. It contains GitHub token management, ChatGPT sign-in, the Codex executable path, and defaults for model, reasoning effort, speed, Plan/Implement, Steer/Queue, and permissions. The model catalog and supported efforts come from the installed Codex runtime. Blank model and effort choices use the server's defaults.

Open the gear beside a project's name to choose its local Git folder and override any Codex default independently. “Use global” restores inheritance for that setting. New threads snapshot the effective settings; changes to global or project configuration do not rewrite existing threads. Model, effort, speed, mode, and follow-up controls are also available in each thread. Model, effort, speed, and mode changes apply to its next turn. Steer/Queue changes affect the next submitted follow-up.

Selecting a favorite repository opens Codex. Its middle pane lists active and archived threads; the right pane contains the conversation, questions, approval requests, command output, and file changes. `⌘⇧C` opens Codex.

Before a thread starts, choose its environment and starting point: an isolated worktree from the local default branch HEAD (the default), the default branch checkout, a new named branch from the default branch, or the current branch. Set the default in **Global configuration → GitHub → Default starting point**. Worktree remains the built-in default. **Project configuration → GitHub** can override it or inherit the global choice. New branch defaults still require a branch name in each thread. New branch availability is checked before starting. Sending the first prompt or opening Terminal prepares the selected checkout. Isolated worktrees exclude uncommitted changes in the original checkout. Changing project configuration affects future threads only. Archiving retains the conversation and checkout; successful local worktree integration removes the clean merged worktree and continues the same chat on the default checkout.

Plan mode uses a read-only sandbox. Implement mode supports three permission presets, configured globally or overridden per project:

- Ask when needed permits worktree writes and displays Codex requests for additional access. Network access starts disabled.
- Strict sandbox permits worktree writes, disables network access, and declines escalation.
- Full access permits unrestricted local commands and network access. Plan mode remains read-only even with this preset.

Steer sends guidance to a running turn. Queue waits for successful completion and sends pending messages in order. Stop, failure, questions, and approvals prevent queued work from advancing. Queues remain paused after restart until explicitly resumed. A failed steering request retains the composer text; Forge never automatically resends it as a new turn.

Threads, transcripts, drafts, queued messages, and project folder bindings stay on this computer. New local Forge threads use Forge's own Codex home and ChatGPT login, separate from `~/.codex` and FeatStudio2. Credentials and Git operations stay in Electron main, behind preload IPC. Codex uses OpenAI for inference; this does not introduce a Forge backend. There is no Insights integration.

The third-pane toolbar has worktree quick actions. Click the main/worktree label to copy the current checkout path, or click the folder icon to open Finder immediately. The editor icon beside it opens the current checkout in your configured text editor. Choose an application name or use the native application picker in global configuration; Visual Studio Code is the default and does not require the `code` command on PATH. The diff icon opens a refreshable review of tracked and untracked changes since the thread base, with unified and split views. Merge <default branch>, Commit, Push, and Create PR send normal messages to Codex and preserve your composer draft. Merge <default branch> discovers the origin remote's current default branch, fetches origin, and merges that branch into the current worktree branch. It does not assume a main or master branch. It stops for uncommitted changes, an ongoing merge/rebase, or conflicts instead of automatically stashing or discarding work, and does not push. These actions require an idle, unarchived thread in Implement mode with no queued messages, and use its existing permissions and available GitHub tooling. On a crash or app shutdown, unfinished threads become interrupted and pending question/approval IDs are cleared. Resume explicitly to reconnect. Missing threads or worktrees show an error and are never silently replaced.

By default, Forge chats start in an isolated worktree. **Merge into <default branch>** opens an in-app review with **Squash merge** selected by default. Squash combines the feature changes into one commit with an editable message; **Merge** preserves the individual commits. Forge prepares the chosen result separately and rechecks the reviewed source and target before updating the default branch. If the repository changes while the review is open, review it again. Conflicts offer **Resolve with Codex** in the existing chat before retrying integration.

After successful integration, Forge removes the clean merged worktree and continues the same chat on the default branch checkout. **Start worktree** opens an in-app review for a fresh worktree from that local branch. Both operations stop the chat’s terminal and its child jobs before changing checkout. Commit changes before either move; integrations stay local. Finder, the configured editor, and subsequent Codex turns follow the chat’s current checkout. The source branch and conversation history are retained, including after a squash merge.

The terminal button in the Codex header opens a Ghostty terminal below the input, inside the third pane. Drag the horizontal splitter or use its arrow keys to resize it. Opening it in a new chat creates its worktree without sending a Codex message. Each chat has its own local login shell, initially in that chat’s worktree (or its current default-branch checkout). Hiding the terminal or navigating away keeps the session and commands running; reopening reconnects with recent output. The trash button ends the session. Archiving a chat also ends its terminal and discards its retained output; restoring the chat lets you open a fresh terminal. Sessions end when Forge quits; they are not restored after restart. A confirmed checkout change also ends that chat’s terminal before removing or replacing its working folder. Terminal commands run as you, independently of Codex’s permission preset.

GitHub token controls live in **Global configuration → GitHub**, and Forge's ChatGPT sign-in lives in **Global configuration → Codex**. In **Project configuration → Codex**, enable **Use a separate Codex account for this project** to sign in with a project account, then save configuration. Forge stores that sign-in in a separate Codex home. The override applies to new local threads; existing threads retain their account selection. Turning the override off does not delete the project sign-in. Remote threads use the remote host's account, and imported conversations keep their original Codex account.

### Detachable content windows

Use **Detach content pane** in the content toolbar to move a conversation, pull request, issue, workflow run, or workflow into its own native window. In narrow toolbars, look in the overflow menu. Each item can have its own window while you keep using other items in the main workspace. The live view moves between windows, preserving drafts, view state, and terminal sessions.

Use **Reattach content pane** to return an item and select it in the main workspace. Closing a detached window, including with `⌘W`, also returns its content but keeps the main window's current selection. Closing a detached window does not stop a Codex turn or its terminal session. Quitting Forge ends local processes; detached windows are not reopened automatically.

Press `⌘⇧D` to detach the current content pane, or press it in a detached window to reattach that item. The shortcut also works while editing a message and is suspended while a dialog or the command palette is open.

### GitHub releases

Open **Releases** in the project toolbar or press `⌘⇧L`. The **Active** tab lists published stable releases, and **Preview** lists published prereleases, both by publication date descending. The **Draft** tab lists unpublished drafts by creation date descending; GitHub only returns drafts your token can access. Select a release to read its notes in the content pane, and use the GitHub URL control to copy its link or double-click to open it in GitHub. Repository refresh also updates releases. With repository write access, select a draft and choose **Release action → Publish release**. Forge keeps the draft’s current prerelease flag: prereleases publish as Pre-release; other drafts publish as Latest. The hint below the release title shows the publication type; the published release appears in Active or Preview accordingly.

### Keyboard shortcuts (macOS)

| Action | Shortcut |
| --- | --- |
| Command palette | `⌘K` |
| Toggle repository sidebar | `⌘B` |
| Back / forward | `⌘[` / `⌘]` |
| Refresh current content (the item in a detached window) | `⌘R` |
| Previous / next favorite repository | `⌘↑` / `⌘↓` |
| Codex | `⌘⇧C` |
| Open pull requests | `⌘⇧P` |
| Workflow runs | `⌘⇧R` |
| Issues | `⌘⇧I` |
| Workflows | `⌘⇧W` |
| Releases (Active / Preview / Draft) | `⌘⇧L` |
| Next / previous project view | `←` / `→` |
| Previous / next list item | `↑` or `K` / `↓` or `J` |
| Open current item in GitHub | `G`, then `G` |
| Clear current selection outside fields | `Esc` |
| Detach / reattach current content pane | `⌘⇧D` |
| Close focused window | `⌘W` |
| Zoom in / out / reset to app default | `⌘+` / `⌘−` / `⌘0` |

Plain navigation keys apply outside text fields; dialogs take precedence and the terminal handles its own keys. In Codex, focus the thread list to navigate threads. Project views cycle through Codex, Pull Requests, Workflows, Issues, Workflow Runs, and Releases; the current arrow bindings intentionally map Left to next and Right to previous. In the command palette, use `↑`/`↓` to choose, Enter to open, and Escape to close. The conversation search input uses `↓` to focus the first match and Escape to close. Message sending and newlines follow the preference described above.

### Remote Codex environments

Global configuration has a navigation sidebar for General, Environments, GitHub, and Codex. Project configuration groups local and remote paths under **GitHub**, where **Default environment** chooses the target for new threads. Local remains the default until changed; existing threads keep their target. New threads check the selected environment's project checkout, including Local, before offering a project configuration button for missing or invalid paths. Environments and project placements are stored locally in Forge's configuration; no Insights account is required. Add an SSH host alias or `user@hostname` and a remote Codex executable. Configure keys, ports and other SSH options in `~/.ssh/config`. Forge requires non-interactive key/agent authentication and a known host key. Connect once from a terminal before using Forge; Forge never accepts unknown keys automatically.

Prepare the remote machine as the development user:

```sh
codex login --device-auth
codex app-server daemon bootstrap
codex app-server daemon start
```

Install a compatible Codex CLI with daemon/proxy and `command/exec` support, Git, and the project's development dependencies. The implementation was checked against CLI 0.166.0. Automatic remote discovery checks PATH, common user-local/Homebrew locations, and the login shell. You can also set an absolute Codex executable path. Keep the machine awake and reachable over LAN or Tailscale. Confirm that the managed daemon survives logout; headless Linux hosts may require administrator-enabled user lingering. A daemon already running through `codex remote-control start` can also be reused; enabling OpenAI-managed remote control is not required for this SSH connection. Forge uses WebSocket framing through `ssh → codex app-server proxy → managed daemon`; it does not install, start, or stop the daemon. The managed server's credentials, configuration and thread history stay on the host under that user's identity.

Environment edits save automatically after a short pause. Connection checks also run after edits; click the status icon beside the SSH host to check immediately. A green check or red cross reports SSH, CLI protocol, daemon, Codex authentication, model discovery and command execution readiness. Use the trash icon beside the environment selector to remove the selected environment. Its setup procedure remains available when a check fails. In each project's configuration under **GitHub**, enter an existing remote checkout path. Forge checks it after a short typing pause; click the status icon to check immediately. A green check confirms readiness, and a red cross includes the failure reason. Paths use remote POSIX conventions. `~/...` and relative paths resolve under the remote user's home. Opening GitHub suggests the configured local checkout's path relative to your local home, when available; existing explicit mappings are preserved. Remote Linux and macOS hosts are supported by this connection method.

Editable environment selection stays below the new-thread description. Once the target is fixed, its name appears beside thread status above the message box. A new thread's Environment selector uses the project's default environment, or Local when no override is set, and offers the project's configured remote placements. The target can change until a worktree is created or execution starts. Started threads retain a target snapshot; editing or removing an environment cannot redirect them. With the default isolated-worktree starting point, first sending a message or opening Terminal creates `codex/forge-<thread-id>` from the repository's default branch's committed HEAD in a sibling `.forge-worktrees/<checkout-name>/<thread-id>` folder on the remote host. Other starting points use their selected branch or checkout. Worktree setup uses explicit Git commands through app-server, independently of the agent turn's selected permission policy. Remote worktrees and branches are retained; the local integration and cleanup workflow is unavailable for remote threads. Remote checkout paths, like local bindings, are user-selected; verify that they refer to the intended repository.

Remote conversations support streaming, approvals, questions, steering, queues and explicit reconnection. A dropped connection does not mean remote execution stopped. For interrupted or failed remote threads, **Reconnect** resumes and reconciles the existing thread without sending a message or dispatching queued work. Forge does not automatically retry uncertain turns or switch targets. Network transport, remote process lifetime and available Codex capabilities still need checking on each host.

The remote Terminal opens a login shell over an SSH PTY in the thread's worktree under the SSH user, outside Codex's sandbox. Hiding the panel retains the connection and recent output while Forge runs. Ending a terminal, archiving its thread, or quitting Forge closes the SSH session. Reopening after a disconnect starts a fresh shell; previous commands and shell state are not restored. Finder, local text editors, diff/merge and Git quick actions, attachments, and remote file preview/download are unavailable for remote threads. Codex and the terminal can still run Git commands when authorized by the user.

Use the search button beside **New thread** to search the current project’s conversation titles and user/assistant messages. Matching threads appear below with excerpts, ordered by relevance. Words match prefixes (for example, `config` finds `configuration`); multiple words must all match. The **Active** and **Archived** tabs filter the results. Search stays local and covers conversation history stored in Forge.
