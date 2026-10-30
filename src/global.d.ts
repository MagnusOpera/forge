import type { GithubFocusApi } from "../shared/github";

declare global {
  interface Window {
    githubFocus?: GithubFocusApi;
    forgeCodex?: import("../shared/codex").CodexApi;
  }
}

export {};
