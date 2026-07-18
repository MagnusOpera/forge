import { describe, expect, it } from "vitest";
import type {
  LabelSummary,
  PullRequestReview,
  PullRequestSummary,
  RepoSummary,
  WorkflowDispatchConfig,
  WorkflowRunSummary
} from "../shared/github";
import {
  addPullRequestLabelOptimistically,
  adjacentFavoriteRepositoryKey,
  adjacentProjectFocusView,
  appKeyboardShortcut,
  canManagePullRequest,
  canSubmitPullRequestReview,
  canSubmitPullRequestReviewForPullRequest,
  canUpdatePullRequestLabels,
  canUpdatePullRequestDraftState,
  canUpdatePullRequestTitle,
  failedWorkflowRunNotificationKeys,
  findNewFailedWorkflowRuns,
  findNewOpenPullRequests,
  formatDuration,
  githubUrlClickActionForDetail,
  groupRepositoriesByOwner,
  isFailedWorkflowRun,
  isPullRequestAuthor,
  isLiveStatus,
  isTabNavigation,
  latestViewerPullRequestReviewEvent,
  mergeFavoriteRepoSnapshots,
  middlePaneSelectionDelta,
  missingWorkflowDispatchInputs,
  openPullRequestNotificationKeys,
  pullRequestTabForState,
  pullRequestWorkflowState,
  projectViewNavigationDirection,
  repositoryAllowsPullRequestAutoMerge,
  removePullRequestLabelOptimistically,
  reviewDecisionForReviewEvent,
  shortSha,
  statusTone,
  workflowDispatchDefaultInputs,
  workflowDispatchRequiresPrompt
} from "./appLogic";

describe("appLogic", () => {
  it("maps repository keyboard shortcuts only for the intended modifiers", () => {
    const event = (key: string, overrides: Partial<KeyboardEvent> = {}) => ({
      altKey: false,
      code: key === " " ? "Space" : `Key${key.toUpperCase()}`,
      ctrlKey: false,
      key,
      metaKey: true,
      shiftKey: false,
      ...overrides
    }) as KeyboardEvent;

    expect(appKeyboardShortcut(event("r"))).toBe("refresh-repository");
    expect(appKeyboardShortcut(event("ArrowUp"))).toBe("previous-favorite-repository");
    expect(appKeyboardShortcut(event("ArrowDown"))).toBe("next-favorite-repository");
    expect(appKeyboardShortcut(event("ArrowLeft"))).toBeNull();
    expect(appKeyboardShortcut(event("ArrowRight"))).toBeNull();
    expect(appKeyboardShortcut(event(" "))).toBeNull();
    expect(appKeyboardShortcut(event(" ", { shiftKey: true }))).toBeNull();
    expect(appKeyboardShortcut(event("p", { shiftKey: true }))).toBe("open-pull-requests");
    expect(appKeyboardShortcut(event("r", { shiftKey: true }))).toBe("workflow-runs");
    expect(appKeyboardShortcut(event("i", { shiftKey: true }))).toBe("issues");
    expect(appKeyboardShortcut(event("w", { shiftKey: true }))).toBe("workflows");
    expect(appKeyboardShortcut(event("p"))).toBeNull();
    expect(appKeyboardShortcut(event("p", { altKey: true, shiftKey: true }))).toBeNull();
    expect(appKeyboardShortcut(event("p", { metaKey: false, shiftKey: true }))).toBeNull();
    expect(appKeyboardShortcut(event("p", { ctrlKey: true, shiftKey: true }))).toBeNull();
  });

  it("cycles favorite repositories in both directions and wraps", () => {
    const favorites = ["octo/one", "octo/two", "octo/three"];

    expect(adjacentFavoriteRepositoryKey(favorites, "octo/one", 1)).toBe("octo/two");
    expect(adjacentFavoriteRepositoryKey(favorites, "octo/one", -1)).toBe("octo/three");
    expect(adjacentFavoriteRepositoryKey(favorites, "octo/three", 1)).toBe("octo/one");
    expect(adjacentFavoriteRepositoryKey(favorites, "octo/other", 1)).toBe("octo/one");
    expect(adjacentFavoriteRepositoryKey(favorites, "octo/other", -1)).toBe("octo/three");
    expect(adjacentFavoriteRepositoryKey([], "octo/one", 1)).toBeNull();
  });

  it("cycles project views in both directions and wraps", () => {
    expect(adjacentProjectFocusView("pull-requests", 1)).toBe("workflows");
    expect(adjacentProjectFocusView("workflows", 1)).toBe("issues");
    expect(adjacentProjectFocusView("issues", 1)).toBe("workflow-runs");
    expect(adjacentProjectFocusView("workflow-runs", 1)).toBe("pull-requests");
    expect(adjacentProjectFocusView("pull-requests", -1)).toBe("workflow-runs");
  });

  it("maps unmodified horizontal arrows to project-view cycling", () => {
    const event = (key: string, overrides: Partial<KeyboardEvent> = {}) => ({
      altKey: false,
      ctrlKey: false,
      key,
      metaKey: false,
      shiftKey: false,
      ...overrides
    }) as KeyboardEvent;

    expect(projectViewNavigationDirection(event("ArrowLeft"))).toBe(1);
    expect(projectViewNavigationDirection(event("ArrowRight"))).toBe(-1);
    expect(projectViewNavigationDirection(event("ArrowLeft", { metaKey: true }))).toBeNull();
    expect(projectViewNavigationDirection(event("ArrowRight", { shiftKey: true }))).toBeNull();
    expect(projectViewNavigationDirection(event("ArrowUp"))).toBeNull();
  });

  it("maps unmodified arrows and vim keys to middle-pane selection movement", () => {
    const event = (key: string, overrides: Partial<KeyboardEvent> = {}) => ({
      altKey: false,
      ctrlKey: false,
      key,
      metaKey: false,
      shiftKey: false,
      ...overrides
    }) as KeyboardEvent;

    expect(middlePaneSelectionDelta(event("ArrowUp"))).toBe(-1);
    expect(middlePaneSelectionDelta(event("k"))).toBe(-1);
    expect(middlePaneSelectionDelta(event("ArrowDown"))).toBe(1);
    expect(middlePaneSelectionDelta(event("j"))).toBe(1);
    expect(middlePaneSelectionDelta(event("ArrowDown", { metaKey: true }))).toBeNull();
    expect(middlePaneSelectionDelta(event("ArrowUp", { shiftKey: true }))).toBeNull();
    expect(middlePaneSelectionDelta(event("Enter"))).toBeNull();
  });

  it("identifies tab focus navigation for complete suppression", () => {
    expect(isTabNavigation({ key: "Tab" })).toBe(true);
    expect(isTabNavigation({ key: "Enter" })).toBe(false);
  });

  it("groups repositories alphabetically by owner and repository name", () => {
    const repos = [
      { owner: "zeta", name: "selected", fullName: "zeta/selected", updatedAt: "2026-01-01T00:00:00Z" },
      { owner: "alpha", name: "zebra", fullName: "alpha/zebra", updatedAt: "2026-01-03T00:00:00Z" },
      { owner: "alpha", name: "aardvark", fullName: "alpha/aardvark", updatedAt: "2026-01-02T00:00:00Z" },
      { owner: "beta", name: "repo-10", fullName: "beta/repo-10", updatedAt: "2026-01-04T00:00:00Z" },
      { owner: "beta", name: "repo-2", fullName: "beta/repo-2", updatedAt: "2026-01-05T00:00:00Z" }
    ] as RepoSummary[];

    expect(
      groupRepositoriesByOwner(repos).map(([owner, ownerRepos]) => [owner, ownerRepos.map((repo) => repo.name)])
    ).toEqual([
      ["alpha", ["aardvark", "zebra"]],
      ["beta", ["repo-2", "repo-10"]],
      ["zeta", ["selected"]]
    ]);
  });

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

  it("maps pull requests to the merged titlebar workflow state", () => {
    expect(pullRequestWorkflowState({ isDraft: false, autoMergeEnabled: true } as PullRequestSummary)).toBe("auto-ready");
    expect(pullRequestWorkflowState({ isDraft: false, autoMergeEnabled: false } as PullRequestSummary)).toBe("manual-ready");
    expect(pullRequestWorkflowState({ isDraft: true, autoMergeEnabled: false } as PullRequestSummary)).toBe("draft");
    expect(pullRequestWorkflowState({ isDraft: true, autoMergeEnabled: true } as PullRequestSummary)).toBe(null);
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

  it("treats missing repository auto-merge settings as unknown but allowed", () => {
    expect(repositoryAllowsPullRequestAutoMerge({ autoMergeAllowed: true } as RepoSummary)).toBe(true);
    expect(repositoryAllowsPullRequestAutoMerge({ autoMergeAllowed: false } as RepoSummary)).toBe(false);
    expect(repositoryAllowsPullRequestAutoMerge({} as RepoSummary)).toBe(true);
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

  it("derives workflow dispatch defaults and prompt requirements", () => {
    const config = {
      workflowId: 1,
      workflowName: "Deploy",
      ref: "main",
      inputs: [
        { key: "environment", label: "environment", required: true, defaultValue: null, type: "choice", options: ["prod"] },
        { key: "dry_run", label: "dry_run", required: false, defaultValue: "true", type: "boolean", options: [] }
      ]
    } satisfies WorkflowDispatchConfig;

    expect(workflowDispatchDefaultInputs(config)).toEqual({ dry_run: "true" });
    expect(workflowDispatchRequiresPrompt(config)).toBe(true);
    expect(missingWorkflowDispatchInputs(config, { dry_run: "true" })).toEqual([config.inputs[0]]);
    expect(missingWorkflowDispatchInputs(config, { environment: "prod", dry_run: "true" })).toEqual([]);
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

  it("maps GitHub URL clicks to copy first and open on double-click", () => {
    expect(githubUrlClickActionForDetail(0)).toBe("copy");
    expect(githubUrlClickActionForDetail(1)).toBe("copy");
    expect(githubUrlClickActionForDetail(2)).toBe("open");
  });

  it("seeds pull request notifications without reporting existing open pull requests", () => {
    const pullRequests = [
      { id: "pr-1", number: 1, state: "OPEN" },
      { id: "pr-2", number: 2, state: "CLOSED" }
    ] as PullRequestSummary[];

    expect(findNewOpenPullRequests(null, pullRequests)).toEqual([]);
    expect(openPullRequestNotificationKeys(pullRequests)).toEqual(["pr-1"]);
  });

  it("detects new open pull requests after the favorite project baseline", () => {
    const pullRequests = [
      { id: "pr-2", number: 2, state: "OPEN" },
      { id: "pr-1", number: 1, state: "OPEN" },
      { id: "pr-3", number: 3, state: "MERGED" }
    ] as PullRequestSummary[];

    expect(findNewOpenPullRequests(["pr-1"], pullRequests)).toEqual([pullRequests[0]]);
  });

  it("detects newly failed workflow runs after a previous running sample", () => {
    const running = [
      { id: 101, status: "in_progress", conclusion: null },
      { id: 100, status: "completed", conclusion: "success" }
    ] as WorkflowRunSummary[];
    const refreshed = [
      { id: 101, status: "completed", conclusion: "failure" },
      { id: 100, status: "completed", conclusion: "success" }
    ] as WorkflowRunSummary[];

    expect(failedWorkflowRunNotificationKeys(running)).toEqual([]);
    expect(findNewFailedWorkflowRuns(failedWorkflowRunNotificationKeys(running), refreshed)).toEqual([refreshed[0]]);
  });

  it("does not repeat notifications for workflow runs that were already failed", () => {
    const failed = [
      { id: 101, status: "completed", conclusion: "failure" },
      { id: 100, status: "completed", conclusion: "timed_out" }
    ] as WorkflowRunSummary[];

    expect(isFailedWorkflowRun(failed[0])).toBe(true);
    expect(findNewFailedWorkflowRuns(failedWorkflowRunNotificationKeys(failed), failed)).toEqual([]);
  });
});
