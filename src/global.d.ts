import type { GithubFocusApi } from "../shared/github";

declare global {
  interface Window {
    githubFocus?: GithubFocusApi;
  }
}

export {};
