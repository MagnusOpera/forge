import { isClassicPersonalAccessToken, missingRequiredScopes } from "../../shared/auth.js";

/** Validate before replacing a working credential. Never return GitHub's response body. */
export async function validatePersonalToken(
  token: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!isClassicPersonalAccessToken(token)) {
    throw new Error("Use a classic GitHub personal access token starting with ghp_.");
  }
  const response = await fetcher("https://api.github.com/user", {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
    signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]),
  });
  if (response.status === 401) throw new Error("GitHub rejected this token. Check that it is active and copied correctly.");
  if (!response.ok) throw new Error(`GitHub could not check this token (${response.status}). Try again.`);
  const missing = missingRequiredScopes(response.headers.get("x-oauth-scopes"));
  if (missing.length) throw new Error(`This token is missing the required ${missing.join(" and ")} permissions. Enable them in classic token settings.`);
}
