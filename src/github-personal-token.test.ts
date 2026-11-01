import { expect, it, vi } from "vitest";
import { validatePersonalToken } from "../electron/main/github-personal-token";

it("accepts classic tokens with the required scopes, including normalized project grants", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response("", { headers: { "x-oauth-scopes": "repo, project" } }));
  await validatePersonalToken("ghp_test", undefined, fetcher);
  expect(fetcher).toHaveBeenCalledWith("https://api.github.com/user", expect.objectContaining({
    headers: expect.objectContaining({ authorization: "Bearer ghp_test" }),
  }));
});
it("rejects unsupported token types before making a request", async () => {
  const fetcher = vi.fn<typeof fetch>();
  for (const token of ["", "gho_oauth", "github_pat_fine_grained"]) {
    await expect(validatePersonalToken(token, undefined, fetcher)).rejects.toThrow("classic GitHub personal access token");
  }
  expect(fetcher).not.toHaveBeenCalled();
});
it("rejects invalid tokens and missing scopes without exposing response bodies", async () => {
  const fetcher = vi.fn<typeof fetch>();
  fetcher.mockResolvedValueOnce(new Response("secret-body", { status: 401 }));
  await expect(validatePersonalToken("ghp_test", undefined, fetcher)).rejects.toThrow("GitHub rejected this token");
  fetcher.mockResolvedValueOnce(new Response("secret-body", { status: 403 }));
  await expect(validatePersonalToken("ghp_test", undefined, fetcher)).rejects.toThrow("could not check this token (403)");
  fetcher.mockResolvedValueOnce(new Response("", { headers: { "x-oauth-scopes": "repo" } }));
  await expect(validatePersonalToken("ghp_test", undefined, fetcher)).rejects.toThrow("read:project");
  fetcher.mockResolvedValueOnce(new Response(""));
  await expect(validatePersonalToken("ghp_test", undefined, fetcher)).rejects.toThrow("repo and read:project");
});
