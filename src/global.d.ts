import type { GithubFocusApi } from "../shared/github";

declare global {
  interface Window {
    forgeContentTerminalEngine?: typeof import("./codex/terminal-engine").loadTerminalEngine;
    githubFocus?: GithubFocusApi;
    forgeCodex?: import("../shared/codex").CodexApi;
  }
}

export {};
