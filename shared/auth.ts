export const GITHUB_OAUTH_SCOPES = ["repo", "read:project"] as const;

export function parseTokenScopes(scopeHeader?: string | null): string[] {
  return (scopeHeader ?? "").split(/[ ,]+/).map(scope => scope.trim()).filter(Boolean);
}

export function missingRequiredScopes(scopeHeader?: string | null): string[] {
  const granted = new Set(parseTokenScopes(scopeHeader));
  // GitHub normalizes narrower scopes into their broader parent scope.
  if (granted.has("project")) granted.add("read:project");
  return GITHUB_OAUTH_SCOPES.filter(scope => !granted.has(scope));
}
