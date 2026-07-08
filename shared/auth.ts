export const CLASSIC_TOKEN_SETTINGS_URL = "https://github.com/settings/tokens";
export const REQUIRED_CLASSIC_TOKEN_SCOPES = ["repo", "read:project"] as const;

export function isClassicPersonalAccessToken(token: string): boolean {
  return token.trim().startsWith("ghp_");
}

export function parseTokenScopes(scopeHeader?: string | null): string[] {
  return (scopeHeader ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

export function missingRequiredClassicTokenScopes(
  scopeHeader?: string | null,
  requiredScopes: readonly string[] = REQUIRED_CLASSIC_TOKEN_SCOPES
): string[] {
  const grantedScopes = new Set(parseTokenScopes(scopeHeader).map((scope) => scope.toLowerCase()));
  return requiredScopes.filter((scope) => !grantedScopes.has(scope.toLowerCase()));
}
