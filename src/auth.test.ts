import { describe, expect, it } from "vitest";
import { missingRequiredScopes, parseTokenScopes } from "../shared/auth";

describe("GitHub OAuth scopes", () => {
  it("parses both response scopes and normalized scope headers", () => {
    expect(parseTokenScopes("repo, read:project, workflow")).toEqual(["repo", "read:project", "workflow"]);
    expect(parseTokenScopes("repo read:project")).toEqual(["repo", "read:project"]);
    expect(parseTokenScopes(null)).toEqual([]);
  });
  it("accepts broader project grants and reports missing permissions", () => {
    expect(missingRequiredScopes("repo, read:project")).toEqual([]);
    expect(missingRequiredScopes("repo, project")).toEqual([]);
    expect(missingRequiredScopes("repo")).toEqual(["read:project"]);
    expect(missingRequiredScopes("read:project")).toEqual(["repo"]);
    expect(missingRequiredScopes("")).toEqual(["repo", "read:project"]);
  });
});
