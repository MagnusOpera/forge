import { describe, expect, it, vi } from "vitest";
import type { ReleaseSummary } from "../shared/github";
import { fetchRepositoryReleases, releaseDate, releasesForTab } from "../shared/releases";

const release = (id: string, overrides: Partial<ReleaseSummary> = {}): ReleaseSummary => ({
  id, name: null, tagName: id, description: null, isDraft: false, isPrerelease: false,
  createdAt: "2026-01-01T00:00:00Z", publishedAt: "2026-02-01T00:00:00Z",
  url: `https://github.com/test/repo/releases/tag/${id}`, ...overrides
});

describe("repository releases", () => {
  it("separates stable releases, previews, and drafts, sorting each by the relevant date", () => {
    const old = release("old", { createdAt: "2026-04-01T00:00:00Z" });
    const recent = release("recent", { publishedAt: "2026-05-01T00:00:00Z", isPrerelease: true });
    const draft = release("draft", { isDraft: true, isPrerelease: true, publishedAt: null });
    const stable = release("stable", { publishedAt: "2026-06-01T00:00:00Z" });
    const olderPreview = release("preview", { isPrerelease: true });
    const releases = [old, draft, recent, stable, olderPreview];
    expect(releasesForTab(releases, "active")).toEqual([stable, old]);
    expect(releasesForTab(releases, "preview")).toEqual([recent, olderPreview]);
    expect(releasesForTab(releases, "draft")).toEqual([draft]);
    expect(releases).toEqual([old, draft, recent, stable, olderPreview]);
  });
  it("sorts drafts by creation date and falls back when publication is missing", () => {
    const old = release("old", { isDraft: true });
    const recent = release("recent", { isDraft: true, createdAt: "2026-03-01T00:00:00Z" });
    expect(releasesForTab([old, recent], "draft")).toEqual([recent, old]);
    expect(releaseDate(release("missing", { publishedAt: null }))).toBe("2026-01-01T00:00:00Z");
    expect(releasesForTab([], "active")).toEqual([]);
  });
  it("loads every GraphQL page, preserving drafts, nullable notes, names and dates", async () => {
    const active = release("v1");
    const draft = release("v2", { isDraft: true, publishedAt: null });
    const query = vi.fn()
      .mockResolvedValueOnce({ repository: { releases: { nodes: [active, null], pageInfo: { hasNextPage: true, endCursor: "next" } } } })
      .mockResolvedValueOnce({ repository: { releases: { nodes: [draft], pageInfo: { hasNextPage: false, endCursor: "end" } } } });
    expect(await fetchRepositoryReleases(query, { owner: "test", name: "repo" })).toEqual([active, draft]);
    expect(query.mock.calls.map(call => call[1])).toEqual([
      { owner: "test", name: "repo", cursor: null }, { owner: "test", name: "repo", cursor: "next" }
    ]);
  });
  it("propagates API errors instead of silently showing an empty list", async () => {
    await expect(fetchRepositoryReleases(vi.fn().mockRejectedValue(new Error("Forbidden")), { owner: "test", name: "repo" })).rejects.toThrow("Forbidden");
  });
});
