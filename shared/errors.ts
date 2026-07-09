export const AUTO_MERGE_API_UNAVAILABLE_MESSAGE =
  "GitHub's public API requires repository auto-merge to be allowed. Open the pull request in GitHub to enable it there.";

export function isAutoMergeNotAllowedMessage(message: string): boolean {
  return /Auto merge is not allowed for this repository/i.test(message);
}

export function userFacingError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const message = error.message
    .replace(/^Error invoking remote method '[^']+':\s*/u, "")
    .replace(/^GraphqlResponseError:\s*/u, "")
    .replace(/^Error:\s*/u, "")
    .trim();

  if (isAutoMergeNotAllowedMessage(message)) {
    return AUTO_MERGE_API_UNAVAILABLE_MESSAGE;
  }

  return message || fallback;
}
