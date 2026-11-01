import type { GitHubAuthMethod } from "../../shared/github.js";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { GITHUB_OAUTH_SCOPES, missingRequiredScopes } from "../../shared/auth.js";

export interface OAuthConfiguration {
  clientId: string;
  clientSecret: string;
}

export interface OAuthCredential {
  method?: GitHubAuthMethod;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export const OAUTH_CALLBACK_PATH = "/github/callback";

export function createAuthorizationRequest(clientId: string, redirectUri: string) {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const url = new URL("https://github.com/login/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: GITHUB_OAUTH_SCOPES.join(" "),
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { url: url.toString(), state, verifier };
}

export async function requestOAuthToken(
  configuration: OAuthConfiguration,
  parameters: Record<string, string>,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<OAuthCredential> {
  const response = await fetcher("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: configuration.clientId, client_secret: configuration.clientSecret, ...parameters }),
    signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]),
  });
  // Never include GitHub's response body in errors: it may contain credentials.
  if (!response.ok) throw new Error(`GitHub sign-in failed (${response.status}). Try again.`);
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new Error("GitHub returned an invalid sign-in response. Try again."); }
  if (!payload || typeof payload !== "object") throw new Error("GitHub returned an invalid sign-in response. Try again.");
  const data = payload as Record<string, unknown>;
  if (data.error || typeof data.access_token !== "string" || !data.access_token) {
    if (data.error === "bad_refresh_token") throw new Error("Your GitHub session has expired. Sign in with GitHub again.");
    throw new Error("GitHub could not authorize Forge. Try signing in again.");
  }
  if ((parameters.grant_type !== "refresh_token" || typeof data.scope === "string") && missingRequiredScopes(typeof data.scope === "string" ? data.scope : "").length) {
    throw new Error("GitHub did not grant the repository and project permissions Forge needs. Sign in again and approve access.");
  }
  const expiresIn = data.expires_in;
  if (expiresIn !== undefined && (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0)) {
    throw new Error("GitHub returned an invalid session expiration. Sign in again.");
  }
  return {
    accessToken: data.access_token,
    ...(typeof data.refresh_token === "string" ? { refreshToken: data.refresh_token } : {}),
    ...(typeof expiresIn === "number" ? { expiresAt: Date.now() + expiresIn * 1000 } : {}),
  };
}

/** The listener accepts only the callback for this sign-in and is always closed. */
export async function signInWithGitHub(
  configuration: OAuthConfiguration,
  openBrowser: (url: string) => Promise<unknown>,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  timeoutMs = 5 * 60_000,
): Promise<OAuthCredential> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  const server = createServer();
  let settled = false;
  const abortError = () => new Error(signal.aborted ? "GitHub sign-in cancelled." : "GitHub sign-in timed out. Try again.");
  try {
    deadline.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Unable to start GitHub sign-in.");
    const redirectUri = `http://127.0.0.1:${address.port}${OAUTH_CALLBACK_PATH}`;
    const request = createAuthorizationRequest(configuration.clientId, redirectUri);
    const code = await new Promise<string>((resolve, reject) => {
      const finish = (error?: Error, value?: string) => {
        if (settled) return;
        settled = true;
        deadline.removeEventListener("abort", abort);
        if (error) reject(error); else resolve(value!);
      };
      const abort = () => finish(abortError());
      deadline.addEventListener("abort", abort, { once: true });
      server.once("error", error => finish(error));
      server.on("request", (incoming, response) => {
        response.setHeader("content-type", "text/plain; charset=utf-8");
        response.setHeader("cache-control", "no-store");
        response.setHeader("content-security-policy", "default-src 'none'");
        let callback: URL;
        try { callback = new URL(incoming.url ?? "/", redirectUri); }
        catch { response.writeHead(400).end("Invalid request."); return; }
        if (callback.origin !== new URL(redirectUri).origin || incoming.method !== "GET" || incoming.headers.host !== `127.0.0.1:${address.port}` || callback.pathname !== OAUTH_CALLBACK_PATH) {
          response.writeHead(404).end("Not found.");
          return;
        }
        if (settled || callback.searchParams.get("state") !== request.state) {
          response.writeHead(400).end("Invalid sign-in request. Return to Forge and try again.");
          return;
        }
        const value = callback.searchParams.get("code");
        if (callback.searchParams.has("error") || !value) {
          response.end("GitHub sign-in was declined. Return to Forge to try again.");
          finish(new Error("GitHub sign-in was declined. Try again when ready."));
          return;
        }
        response.end("Authorization received. Return to Forge to finish signing in.");
        finish(undefined, value);
      });
      if (deadline.aborted) abort();
      else void Promise.resolve().then(() => openBrowser(request.url)).catch(() => finish(new Error("Unable to open your browser for GitHub sign-in.")));
    });
    deadline.throwIfAborted();
    return await requestOAuthToken(configuration, { code, redirect_uri: redirectUri, code_verifier: request.verifier }, deadline, fetcher);
  } catch (error) {
    if (deadline.aborted) throw abortError();
    throw error;
  } finally {
    server.close();
    server.closeAllConnections();
  }
}
