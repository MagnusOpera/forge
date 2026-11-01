import type { ReleaseSummary, RepoRef } from "./github.js";

export type ReleaseTab = "active" | "preview" | "draft";

export function releaseDate(release: ReleaseSummary): string {
  return release.isDraft ? release.createdAt : release.publishedAt ?? release.createdAt;
}

export function releasesForTab(releases: ReleaseSummary[], tab: ReleaseTab): ReleaseSummary[] {
  return releases.filter(release => tab === "draft"
    ? release.isDraft
    : !release.isDraft && release.isPrerelease === (tab === "preview"))
    .sort((a, b) => Date.parse(releaseDate(b)) - Date.parse(releaseDate(a)) || a.id.localeCompare(b.id));
}

interface ReleasePage {
  repository: { releases: {
    nodes: (ReleaseSummary | null)[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  } };
}

type ReleaseQuery = (query: string, variables: Record<string, unknown>) => Promise<ReleasePage>;

/** Fetch every page so older-created drafts and newly published releases remain visible. */
export async function fetchRepositoryReleases(query: ReleaseQuery, repo: RepoRef): Promise<ReleaseSummary[]> {
  const releases: ReleaseSummary[] = [];
  let cursor: string | null = null;
  do {
    const result = await query(`
      query Releases($owner: String!, $name: String!, $cursor: String) {
        repository(owner: $owner, name: $name) {
          releases(first: 100, after: $cursor, orderBy: { field: CREATED_AT, direction: DESC }) {
            nodes { id databaseId name tagName description isDraft isPrerelease isLatest createdAt publishedAt url }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    `, { owner: repo.owner, name: repo.name, cursor });
    const page = result.repository.releases;
    releases.push(...page.nodes.filter((release): release is ReleaseSummary => release !== null));
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
  return releases;
}
