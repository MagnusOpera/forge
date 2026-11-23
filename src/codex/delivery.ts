import type { CodexThreadSummary } from "../../shared/codex";
import type { RepoSummary } from "../../shared/github";

export type DeliveryThread = { repo: RepoSummary; thread: CodexThreadSummary };
export const deliveryThreadKey = ({ repo, thread }: DeliveryThread): string =>
  JSON.stringify([repo.id, thread.id]);

export function bundleThreads(
  repos: RepoSummary[],
  threadsByRepo: ReadonlyMap<string, readonly CodexThreadSummary[]>,
): DeliveryThread[] {
  return repos
    .flatMap((repo) => (threadsByRepo.get(repo.id) ?? []).map((thread) => ({ repo, thread })))
    .sort((a, b) => Date.parse(b.thread.updatedAt) - Date.parse(a.thread.updatedAt));
}

export type ProjectBundle = {
  id: string;
  name: string;
  repositories: RepoSummary[];
};

export function resolveBundleRepositories(
  bundle: ProjectBundle | undefined,
  repositories: RepoSummary[],
): RepoSummary[] {
  if (!bundle) return [];
  const byId = new Map(repositories.map((repo) => [repo.id, repo]));
  return bundle.repositories.map((repo) => byId.get(repo.id) ?? repo);
}

export function validateBundle(
  name: string,
  repositories: RepoSummary[],
  bundles: ProjectBundle[],
  editingId?: string,
): string {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a bundle name.";
  if (bundles.some((bundle) => bundle.id !== editingId && bundle.name.toLowerCase() === trimmed.toLowerCase())) {
    return "A bundle with this name already exists.";
  }
  if (!repositories.length) return "Select at least one repository.";
  return "";
}
