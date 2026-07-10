# Forge

Forge is a focus-first desktop GitHub client for working through repositories, pull requests, issues, workflows, and review state from a dense three-pane workspace.

The app is built with Electron, React, TypeScript, and Vite. It stays local-only: GitHub API access is handled by the Electron main process, and the GitHub token is not exposed to the renderer.

## Features

- Repository navigation with search, favorites, and local monitoring.
- Project focus views for pull requests, workflow runs, issues, and workflows.
- Pull request details with title editing, labels, review actions, readiness, auto-merge, comments, markdown, and GitHub URL actions.
- Workflow and job views for inspecting GitHub Actions state.
- Keyboard-friendly navigation with persistent three-pane context.
- Light, dark, and system themes with accent colors and optional glass sidebar appearance.

## Development

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

Create an unsigned macOS arm64 package:

```sh
make package-mac-arm64 version=X.Y.Z
```

## License

Forge is released under the MIT License. See [LICENSE](LICENSE).
