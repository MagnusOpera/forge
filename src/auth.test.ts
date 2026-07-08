import { describe, expect, it } from "vitest";
import {
  isClassicPersonalAccessToken,
  missingRequiredClassicTokenScopes,
  parseTokenScopes
} from "../shared/auth";

describe("auth token helpers", () => {
  it("accepts only classic personal access token prefixes", () => {
    expect(isClassicPersonalAccessToken(" ghp_1234567890 ")).toBe(true);
    expect(isClassicPersonalAccessToken("github_pat_1234567890")).toBe(false);
    expect(isClassicPersonalAccessToken("gho_1234567890")).toBe(false);
  });

  it("parses GitHub OAuth scope headers", () => {
    expect(parseTokenScopes("repo, read:project, workflow")).toEqual(["repo", "read:project", "workflow"]);
    expect(parseTokenScopes("")).toEqual([]);
    expect(parseTokenScopes(null)).toEqual([]);
  });

  it("reports missing required classic token scopes", () => {
    expect(missingRequiredClassicTokenScopes("repo, read:project, workflow")).toEqual([]);
    expect(missingRequiredClassicTokenScopes("repo")).toEqual(["read:project"]);
    expect(missingRequiredClassicTokenScopes("read:project")).toEqual(["repo"]);
    expect(missingRequiredClassicTokenScopes("")).toEqual(["repo", "read:project"]);
  });
});
