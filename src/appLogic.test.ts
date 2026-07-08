import { describe, expect, it } from "vitest";
import type { PullRequestSummary, RepoSummary } from "../shared/github";
import {
  canSubmitPullRequestReview,
  canSubmitPullRequestReviewForPullRequest,
  canUpdatePullRequestTitle,
  formatDuration,
  isPullRequestAuthor,
  isLiveStatus,
  pullRequestTabForState,
  shortSha,
  statusTone
} from "./appLogic";

describe("appLogic", () => {
  it("formats durations for workflow runs", () => {
    expect(formatDuration(null)).toBe("");
    expect(formatDuration(9_800)).toBe("9s");
    expect(formatDuration(75_000)).toBe("1m 15s");
    expect(formatDuration(3_720_000)).toBe("1h 2m");
  });

  it("shortens commit SHAs", () => {
    expect(shortSha("c44fb0b123456789")).toBe("c44fb0b");
    expect(shortSha(null)).toBe("");
  });

  it("maps pull requests to the visible tab", () => {
    expect(pullRequestTabForState({ state: "OPEN" } as PullRequestSummary)).toBe("open");
    expect(pullRequestTabForState({ state: "CLOSED" } as PullRequestSummary)).toBe("closed");
    expect(pullRequestTabForState({ state: "MERGED" } as PullRequestSummary)).toBe("closed");
  });

  it("enables review submission for write-level repository permissions", () => {
    expect(canSubmitPullRequestReview({ viewerPermission: "ADMIN" } as RepoSummary)).toBe(true);
    expect(canSubmitPullRequestReview({ viewerPermission: "MAINTAIN" } as RepoSummary)).toBe(true);
    expect(canSubmitPullRequestReview({ viewerPermission: "WRITE" } as RepoSummary)).toBe(true);
    expect(canSubmitPullRequestReview({ viewerPermission: "READ" } as RepoSummary)).toBe(false);
    expect(canSubmitPullRequestReview({ viewerPermission: null } as RepoSummary)).toBe(false);
  });

  it("prevents review actions on pull requests authored by the viewer", () => {
    const repo = { viewerPermission: "WRITE" } as RepoSummary;
    const pr = { author: { login: "octocat" } } as PullRequestSummary;

    expect(isPullRequestAuthor(pr, "Octocat")).toBe(true);
    expect(isPullRequestAuthor(pr, "hubot")).toBe(false);
    expect(canSubmitPullRequestReviewForPullRequest(repo, pr, "hubot")).toBe(true);
    expect(canSubmitPullRequestReviewForPullRequest(repo, pr, "Octocat")).toBe(false);
    expect(canSubmitPullRequestReviewForPullRequest(repo, pr, null)).toBe(false);
    expect(canSubmitPullRequestReviewForPullRequest(repo, { author: null } as PullRequestSummary, "hubot")).toBe(true);
    expect(canSubmitPullRequestReviewForPullRequest({ viewerPermission: "READ" } as RepoSummary, pr, "hubot")).toBe(false);
  });

  it("allows pull request title edits for write users or the author", () => {
    const pr = { author: { login: "octocat" } } as PullRequestSummary;

    expect(canUpdatePullRequestTitle({ viewerPermission: "WRITE" } as RepoSummary, pr, "hubot")).toBe(true);
    expect(canUpdatePullRequestTitle({ viewerPermission: "READ" } as RepoSummary, pr, "Octocat")).toBe(true);
    expect(canUpdatePullRequestTitle({ viewerPermission: "READ" } as RepoSummary, pr, "hubot")).toBe(false);
    expect(canUpdatePullRequestTitle({ viewerPermission: null } as RepoSummary, pr, null)).toBe(false);
  });

  it("maps status and conclusion values to UI tones", () => {
    expect(statusTone("queued")).toBe("running");
    expect(statusTone("SUCCESS")).toBe("good");
    expect(statusTone("completed", "failure")).toBe("bad");
    expect(statusTone("skipped")).toBe("muted");
    expect(statusTone("unexpected")).toBe("unknown");
  });

  it("detects live workflow statuses", () => {
    expect(isLiveStatus("in_progress")).toBe(true);
    expect(isLiveStatus("QUEUED")).toBe(true);
    expect(isLiveStatus("success")).toBe(false);
  });
});
