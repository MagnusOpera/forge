const flushers = new Map<string, () => Promise<void>>();
const key = (repositoryId: string, id: string) => `${repositoryId}:${id}`;
export function registerThreadDraft(
  repositoryId: string,
  id: string,
  flush: () => Promise<void>,
): () => void {
  const target = key(repositoryId, id);
  flushers.set(target, flush);
  return () => {
    if (flushers.get(target) === flush) flushers.delete(target);
  };
}
export async function flushThreadDraft(
  repositoryId: string,
  id: string,
): Promise<void> {
  await flushers.get(key(repositoryId, id))?.();
}
