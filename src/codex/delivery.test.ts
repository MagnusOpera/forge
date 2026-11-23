import { expect, it } from "vitest";
import { defaultCodexPreferences, type CodexThreadSummary } from "../../shared/codex";
import type { RepoSummary } from "../../shared/github";
import { bundleThreads, deliveryThreadKey, resolveBundleRepositories, validateBundle } from "./delivery";

const repo = (id: string): RepoSummary => ({
  id, owner: "org", name: id, fullName: `org/${id}`, url: `https://github.com/org/${id}`,
  isPrivate: false, isArchived: false, isFork: false,
});

it("orders threads from bundle members by last update and retains archived threads", () => {
  const thread = (repositoryId: string, updatedAt: string, archived = false): CodexThreadSummary => ({
    id: "same-thread-id", repositoryId, title: "Task", createdAt: updatedAt, updatedAt, archived,
    state: "idle", settings: defaultCodexPreferences, worktree: "", branch: "", baseCommit: "",
  });
  const first = thread("alpha", "2026-11-21T10:00:00Z");
  const second = thread("beta", "2026-11-22T11:00:00Z", true);
  const entries = bundleThreads([repo("alpha"), repo("beta")], new Map([
    ["alpha", [first]],
    ["beta", [second]],
    ["outside-bundle", [thread("outside-bundle", "2026-11-23T10:00:00Z")]],
  ]));
  expect(entries.map(({ thread }) => thread)).toEqual([second, first]);
  expect(entries.map(deliveryThreadKey)).toEqual([
    '["beta","same-thread-id"]',
    '["alpha","same-thread-id"]',
  ]);
});

it("keeps bundled repositories by ID through renames and missing repository listings", () => {
  const original = repo("alpha");
  const renamed = { ...original, name: "renamed", fullName: "org/renamed" };
  const unlisted = repo("beta");
  const bundle = { id: "launch", name: "Launch", repositories: [original, unlisted] };
  expect(resolveBundleRepositories(bundle, [renamed, repo("outside-bundle")])).toEqual([renamed, unlisted]);
});

it("requires a name and repository membership and permits keeping a bundle's name when editing", () => {
  const members = [repo("alpha")];
  const bundle = { id: "launch", name: "Launch", repositories: members };
  expect(validateBundle("  ", members, [bundle])).toBe("Enter a bundle name.");
  expect(validateBundle("Beta", [], [bundle])).toBe("Select at least one repository.");
  expect(validateBundle(" launch ", members, [bundle])).toBe("A bundle with this name already exists.");
  expect(validateBundle(" Launch ", members, [bundle], bundle.id)).toBe("");
});
