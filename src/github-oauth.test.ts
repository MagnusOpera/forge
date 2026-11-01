import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createAuthorizationRequest, requestOAuthToken, signInWithGitHub } from "../electron/main/github-oauth";

const configuration = { clientId: "forge-client", clientSecret: "test-secret" };
const tokenResponse = { access_token: "gho_test", scope: "repo,read:project", token_type: "bearer" };
const exchange = () => vi.fn<typeof fetch>(async () => Response.json(tokenResponse));

function callbackFor(url: string) {
  const authorization = new URL(url);
  const callback = new URL(authorization.searchParams.get("redirect_uri")!);
  callback.searchParams.set("state", authorization.searchParams.get("state")!);
  callback.searchParams.set("code", "authorization-code");
  return { authorization, callback };
}

describe("GitHub browser authorization", () => {
  it("uses fresh state, PKCE S256, and the required scopes without putting secrets in the URL", () => {
    const request = createAuthorizationRequest("forge-client", "http://127.0.0.1:1234/github/callback");
    const url = new URL(request.url);
    expect(url.searchParams.get("scope")).toBe("repo read:project");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(createHash("sha256").update(request.verifier).digest("base64url"));
    expect(url.searchParams.has("client_secret")).toBe(false);
    expect(request.state).not.toBe(createAuthorizationRequest("forge-client", "http://127.0.0.1").state);
  });

  it("ignores invalid callbacks, exchanges only a matching code, and closes its listener", async () => {
    const fetcher = exchange();
    let redirect = "";
    let challenge = "";
    const credential = await signInWithGitHub(configuration, async url => {
      const { authorization, callback } = callbackFor(url);
      redirect = authorization.searchParams.get("redirect_uri")!;
      challenge = authorization.searchParams.get("code_challenge")!;
      const invalid = new URL(callback);
      invalid.searchParams.set("state", "forged");
      expect((await fetch(invalid)).status).toBe(400);
      const unrelated = new URL("/favicon.ico", callback);
      expect((await fetch(unrelated)).status).toBe(404);
      expect(fetcher).not.toHaveBeenCalled();
      expect((await fetch(callback)).status).toBe(200);
    }, new AbortController().signal, fetcher);
    expect(credential).toEqual({ accessToken: "gho_test" });
    const body = fetcher.mock.calls[0][1]!.body as URLSearchParams;
    expect(body.get("code")).toBe("authorization-code");
    expect(body.get("client_secret")).toBe("test-secret");
    expect(createHash("sha256").update(body.get("code_verifier")!).digest("base64url")).toBe(challenge);
    expect(body.get("redirect_uri")).toBe(redirect);
    await expect(fetch(redirect)).rejects.toThrow();
  });

  it("handles denial without exchanging a token", async () => {
    const fetcher = exchange();
    await expect(signInWithGitHub(configuration, async url => {
      const { callback } = callbackFor(url);
      callback.searchParams.delete("code");
      callback.searchParams.set("error", "access_denied");
      await fetch(callback);
    }, new AbortController().signal, fetcher)).rejects.toThrow("declined");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("cancels and closes the listener", async () => {
    const controller = new AbortController();
    let redirect = "";
    const fetcher = exchange();
    await expect(signInWithGitHub(configuration, async url => {
      redirect = callbackFor(url).callback.toString();
      controller.abort();
    }, controller.signal, fetcher)).rejects.toThrow("cancelled");
    expect(fetcher).not.toHaveBeenCalled();
    await expect(fetch(redirect)).rejects.toThrow();
  });

  it("times out and allows retry, including a browser launch failure", async () => {
    await expect(signInWithGitHub(configuration, async () => {}, new AbortController().signal, exchange(), 20)).rejects.toThrow("timed out");
    await expect(signInWithGitHub(configuration, async () => { throw new Error("browser error"); }, new AbortController().signal, exchange())).rejects.toThrow("Unable to open your browser");
  });

  it("does not expose token response bodies in errors and rejects incomplete scopes", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ error: "bad_verification_code", error_description: "secret" }));
    await expect(requestOAuthToken(configuration, { code: "bad" }, undefined, fetcher)).rejects.toThrow("could not authorize");
    fetcher.mockResolvedValueOnce(Response.json({ ...tokenResponse, scope: "repo" }));
    await expect(requestOAuthToken(configuration, { code: "missing-permission" }, undefined, fetcher)).rejects.toThrow("permissions");
    fetcher.mockResolvedValueOnce(new Response('{"access_token":"sensitive-value",broken-json'));
    await expect(requestOAuthToken(configuration, { code: "malformed" }, undefined, fetcher)).rejects.toThrow("invalid sign-in response");
    fetcher.mockResolvedValueOnce(new Response("secret", { status: 500 }));
    await expect(requestOAuthToken(configuration, { code: "error" }, undefined, fetcher)).rejects.toThrow("(500)");
  });

  it("supports expiring credentials and refresh rotation", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ...tokenResponse, refresh_token: "refresh-new", expires_in: 3600 }));
    const now = Date.now();
    const result = await requestOAuthToken(configuration, { grant_type: "refresh_token", refresh_token: "refresh-old" }, undefined, fetcher);
    expect(result.refreshToken).toBe("refresh-new");
    expect(result.expiresAt).toBeGreaterThanOrEqual(now + 3600_000);
    expect((fetcher.mock.calls[0][1]!.body as URLSearchParams).get("refresh_token")).toBe("refresh-old");
  });
});
