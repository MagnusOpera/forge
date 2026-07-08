import { describe, expect, it } from "vitest";
import type { LabelSummary, PullRequestReview, PullRequestSummary, RepoSummary } from "../shared/github";
import {
  addPullRequestLabelOptimistically,
  canManagePullRequest,
  canSubmitPullRequestReview,
  canSubmitPullRequestReviewForPullRequest,
  canUpdatePullRequestLabels,
  canUpdatePullRequestDraftState,
  canUpdatePullRequestTitle,
  formatDuration,
  isPullRequestAuthor,
  isLiveStatus,
  latestViewerPullRequestReviewEvent,
  mergeFavoriteRepoSnapshots,
  pullRequestTabForState,
  removePullRequestLabelOptimistically,
  reviewDecisionForReviewEvent,
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

  it("enables pull request management for write-level repository permissions", () => {
    expect(canManagePullRequest({ viewerPermission: "ADMIN" } as RepoSummary)).toBe(true);
    expect(canManagePullRequest({ viewerPermission: "MAINTAIN" } as RepoSummary)).toBe(true);
    expect(canManagePullRequest({ viewerPermission: "WRITE" } as RepoSummary)).toBe(true);
    expect(canManagePullRequest({ viewerPermission: "TRIAGE" } as RepoSummary)).toBe(false);
    expect(canManagePullRequest({ viewerPermission: "READ" } as RepoSummary)).toBe(false);
    expect(canManagePullRequest({ viewerPermission: null } as RepoSummary)).toBe(false);
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

  it("allows draft state changes on open pull requests for write users or the author", () => {
    const pr = { author: { login: "octocat" }, state: "OPEN" } as PullRequestSummary;

    expect(canUpdatePullRequestDraftState({ viewerPermission: "WRITE" } as RepoSummary, pr, "hubot")).toBe(true);
    expect(canUpdatePullRequestDraftState({ viewerPermission: "READ" } as RepoSummary, pr, "Octocat")).toBe(true);
    expect(canUpdatePullRequestDraftState({ viewerPermission: "READ" } as RepoSummary, pr, "hubot")).toBe(false);
    expect(canUpdatePullRequestDraftState({ viewerPermission: "WRITE" } as RepoSummary, { ...pr, state: "CLOSED" }, "hubot")).toBe(false);
  });

  it("maps review events to pull request review decisions", () => {
    expect(reviewDecisionForReviewEvent("APPROVE")).toBe("APPROVED");
    expect(reviewDecisionForReviewEvent("REQUEST_CHANGES")).toBe("CHANGES_REQUESTED");
  });

  it("allows pull request label edits for triage and write users", () => {
    expect(canUpdatePullRequestLabels({ viewerPermission: "ADMIN" } as RepoSummary)).toBe(true);
    expect(canUpdatePullRequestLabels({ viewerPermission: "MAINTAIN" } as RepoSummary)).toBe(true);
    expect(canUpdatePullRequestLabels({ viewerPermission: "WRITE" } as RepoSummary)).toBe(true);
    expect(canUpdatePullRequestLabels({ viewerPermission: "TRIAGE" } as RepoSummary)).toBe(true);
    expect(canUpdatePullRequestLabels({ viewerPermission: "READ" } as RepoSummary)).toBe(false);
    expect(canUpdatePullRequestLabels({ viewerPermission: null } as RepoSummary)).toBe(false);
  });

  it("adds pull request labels optimistically from repository labels", () => {
    const bug = { id: "label-1", name: "bug", color: "d73a4a" } as LabelSummary;
    const current = [{ id: "label-2", name: "needs review", color: "0366d6" }] as LabelSummary[];
    const withBug = [...current, bug];

    expect(addPullRequestLabelOptimistically(current, [bug], "Bug")).toEqual([...current, bug]);
    expect(addPullRequestLabelOptimistically(withBug, [bug], "BUG")).toBe(withBug);
  });

  it("uses a stable temporary label when repository labels are missing", () => {
    expect(addPullRequestLabelOptimistically([], [], "release")).toEqual([
      { id: "optimistic-label:release", name: "release", color: "d0d7de" }
    ]);
  });

  it("removes pull request labels optimistically by name", () => {
    const current = [
      { id: "label-1", name: "bug", color: "d73a4a" },
      { id: "label-2", name: "needs review", color: "0366d6" }
    ] as LabelSummary[];

    expect(removePullRequestLabelOptimistically(current, "BUG")).toEqual([current[1]]);
    expect(removePullRequestLabelOptimistically(current, "missing")).toBe(current);
  });

  it("returns the viewer latest submitted approval or change request", () => {
    const reviews = [
      {
        state: "APPROVED",
        author: { login: "octocat" },
        submittedAt: "2026-01-01T00:00:00Z"
      },
      {
        state: "CHANGES_REQUESTED",
        author: { login: "hubot" },
        submittedAt: "2026-01-02T00:00:00Z"
      },
      {
        state: "CHANGES_REQUESTED",
        author: { login: "Octocat" },
        submittedAt: "2026-01-03T00:00:00Z"
      }
    ] as PullRequestReview[];

    expect(latestViewerPullRequestReviewEvent(reviews, "octocat")).toBe("REQUEST_CHANGES");
  });

  it("ignores viewer review comments when finding the active review action", () => {
    const reviews = [
      {
        state: "APPROVED",
        author: { login: "octocat" },
        submittedAt: "2026-01-01T00:00:00Z"
      },
      {
        state: "COMMENTED",
        author: { login: "octocat" },
        submittedAt: "2026-01-02T00:00:00Z"
      }
    ] as PullRequestReview[];

    expect(latestViewerPullRequestReviewEvent(reviews, "octocat")).toBe("APPROVE");
  });

  it("falls back to review order when submitted timestamps are unavailable", () => {
    const reviews = [
      { state: "APPROVED", author: { login: "octocat" } },
      { state: "CHANGES_REQUESTED", author: { login: "octocat" } }
    ] as PullRequestReview[];

    expect(latestViewerPullRequestReviewEvent(reviews, "octocat")).toBe("REQUEST_CHANGES");
  });

  it("keeps repository snapshots for current favorites only", () => {
    const favorite = {
      owner: "octo",
      name: "repo",
      fullName: "octo/repo",
      updatedAt: "2026-01-01T00:00:00Z"
    } as RepoSummary;
    const staleFavorite = {
      owner: "octo",
      name: "repo",
      fullName: "octo/repo",
      updatedAt: "2025-01-01T00:00:00Z"
    } as RepoSummary;
    const removedFavorite = {
      owner: "octo",
      name: "old",
      fullName: "octo/old"
    } as RepoSummary;

    expect(
      mergeFavoriteRepoSnapshots(
        {
          "octo/old": removedFavorite,
          "octo/repo": staleFavorite
        },
        ["octo/repo"],
        [favorite]
      )
    ).toEqual({
      "octo/repo": favorite
    });
  });

  it("preserves favorite snapshots when loaded repositories are cleared", () => {
    const favorite = {
      owner: "octo",
      name: "repo",
      fullName: "octo/repo"
    } as RepoSummary;
    const current = { "octo/repo": favorite };

    expect(mergeFavoriteRepoSnapshots(current, ["octo/repo"], [])).toBe(current);
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
