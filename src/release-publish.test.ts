import { describe, expect, it, vi } from "vitest";
import { publishDraftRelease } from "../electron/main/releases";

const repo = { owner: "test", name: "repo" };
function setup(prerelease = false, draft = true) {
  const data = { id: 42, node_id: "release", name: "Version 1", tag_name: "v1", body: "Keep notes", draft, prerelease,
    created_at: "2026-01-01T00:00:00Z", published_at: "2026-02-01T00:00:00Z", html_url: "https://github.com/test/repo/releases/tag/v1" };
  const getRelease = vi.fn().mockResolvedValue({ data });
  const updateRelease = vi.fn().mockResolvedValue({ data: { ...data, draft: false } });
  const client = { getRelease, updateRelease } as unknown as Parameters<typeof publishDraftRelease>[0];
  return { client, getRelease, updateRelease };
}

describe("publish draft release", () => {
  it.each([false, true])("publishes the existing draft using its authoritative prerelease flag: %s", async prerelease => {
    const { client, getRelease, updateRelease } = setup(prerelease);
    const result = await publishDraftRelease(client, repo, 42);
    expect(getRelease).toHaveBeenCalledWith({ owner: "test", repo: "repo", release_id: 42 });
    expect(updateRelease).toHaveBeenCalledExactlyOnceWith({ owner: "test", repo: "repo", release_id: 42,
      draft: false, prerelease, make_latest: prerelease ? "false" : "true" });
    expect(result).toMatchObject({ id: "release", databaseId: 42, isDraft: false, isPrerelease: prerelease,
      isLatest: !prerelease, description: "Keep notes", tagName: "v1" });
  });
  it("does not alter an already published release", async () => {
    const { client, updateRelease } = setup(false, false);
    await expect(publishDraftRelease(client, repo, 42)).rejects.toThrow("Only draft releases");
    expect(updateRelease).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, NaN, Infinity])("rejects an invalid release ID before calling GitHub: %s", async id => {
    const { client, getRelease, updateRelease } = setup();
    await expect(publishDraftRelease(client, repo, id)).rejects.toThrow("Release ID");
    expect(getRelease).not.toHaveBeenCalled(); expect(updateRelease).not.toHaveBeenCalled();
  });
  it("does not publish if reading the current draft fails", async () => {
    const { client, getRelease, updateRelease } = setup();
    getRelease.mockRejectedValue(new Error("Forbidden"));
    await expect(publishDraftRelease(client, repo, 42)).rejects.toThrow("Forbidden");
    expect(updateRelease).not.toHaveBeenCalled();
  });
  it("propagates publication errors", async () => {
    const { client, updateRelease } = setup();
    updateRelease.mockRejectedValue(new Error("Validation failed"));
    await expect(publishDraftRelease(client, repo, 42)).rejects.toThrow("Validation failed");
  });
});
