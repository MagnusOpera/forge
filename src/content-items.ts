/** Repository and content kind are part of identity: issue #1 is not PR #1. */
export const contentItemKey = (repositoryId: string | undefined, route: string): string => JSON.stringify([repositoryId ?? null, route]);

export function retainedContentItems<T extends { key: string }>(active: T, detached: Iterable<T>): T[] {
  return [...[...detached].filter(item => item.key !== active.key), active];
}
