import type { Octokit } from "@octokit/rest";
import type { ReleaseSummary, RepoRef } from "../../shared/github.js";

type ReleaseClient = Pick<Octokit["repos"], "getRelease" | "updateRelease">;

/** Read the authoritative draft flag; never infer prerelease status from a tag name. */
export async function publishDraftRelease(client: ReleaseClient, repo: RepoRef, releaseId: number): Promise<ReleaseSummary> {
  if (!Number.isSafeInteger(releaseId) || releaseId <= 0) throw new Error("Release ID is required.");
  const target = { owner: repo.owner, repo: repo.name, release_id: releaseId };
  const { data: draft } = await client.getRelease(target);
  if (!draft.draft) throw new Error("Only draft releases can be published.");
  const { data: published } = await client.updateRelease({
    ...target,
    draft: false,
    prerelease: draft.prerelease,
    make_latest: draft.prerelease ? "false" : "true"
  });
  return {
    id: published.node_id,
    databaseId: published.id,
    name: published.name,
    tagName: published.tag_name,
    description: published.body ?? null,
    isDraft: published.draft,
    isPrerelease: published.prerelease,
    isLatest: !published.prerelease,
    createdAt: published.created_at,
    publishedAt: published.published_at,
    url: published.html_url
  };
}
