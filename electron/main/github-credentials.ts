import type { GitHubAuthMethod } from "../../shared/github.js";
import { requestOAuthToken, type OAuthConfiguration, type OAuthCredential } from "./github-oauth.js";

/** Serializes credential writes so sign-out cannot be undone by a late refresh. */
export class GitHubCredentials {
  private generation = 0;
  private pendingRead: Promise<string | null> | null = null;
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly storage: {
    read(): Promise<string | null>;
    write(value: string): Promise<void>;
    remove(): Promise<void>;
    configuration(): OAuthConfiguration;
    refresh?: typeof requestOAuthToken;
  }) {}

  private mutate(run: () => Promise<void>): Promise<void> {
    const next = this.writes.then(run);
    this.writes = next.catch(() => undefined);
    return next;
  }

  async read(): Promise<string | null> {
    if (this.pendingRead) return this.pendingRead;
    const generation = this.generation;
    const pending = (async () => {
      await this.writes;
      const stored = await this.storage.read();
      if (!stored || generation !== this.generation) return null;
      if (!stored.startsWith("{")) return stored; // Existing classic PATs remain usable.
      let credential: OAuthCredential;
      try {
        credential = JSON.parse(stored) as OAuthCredential;
        if (!credential || typeof credential.accessToken !== "string" || !credential.accessToken) throw new Error();
      } catch { throw new Error("Your saved GitHub session could not be read. Sign in with GitHub again."); }
      if (credential.expiresAt && credential.expiresAt <= Date.now() + 60_000) {
        if (!credential.refreshToken) throw new Error("Your GitHub session has expired. Sign in with GitHub again.");
        const refreshed = await (this.storage.refresh ?? requestOAuthToken)(this.storage.configuration(), {
          grant_type: "refresh_token", refresh_token: credential.refreshToken,
        });
        credential = { ...refreshed, ...(credential.method ? { method: credential.method } : {}) };
        await this.mutate(async () => {
          if (generation === this.generation) await this.storage.write(JSON.stringify(credential));
        });
      }
      return generation === this.generation ? credential.accessToken : null;
    })();
    this.pendingRead = pending;
    try { return await pending; }
    finally { if (this.pendingRead === pending) this.pendingRead = null; }
  }

  async method(): Promise<GitHubAuthMethod | null> {
    await this.writes;
    const stored = await this.storage.read();
    if (!stored) return null;
    let token = stored;
    if (stored.startsWith("{")) {
      try {
        const credential = JSON.parse(stored) as OAuthCredential;
        if (credential.method === "oauth" || credential.method === "token") return credential.method;
        token = credential.accessToken;
      } catch { return null; }
    }
    // Infer the method for credentials saved before the method was recorded.
    if (typeof token !== "string") return null;
    if (token.startsWith("ghp_")) return "token";
    if (token.startsWith("gho_")) return "oauth";
    return null;
  }

  replace(credential: OAuthCredential): Promise<void> {
    this.generation++;
    this.pendingRead = null;
    return this.mutate(() => this.storage.write(JSON.stringify(credential)));
  }

  clear(): Promise<void> {
    this.generation++;
    this.pendingRead = null;
    return this.mutate(() => this.storage.remove());
  }
}
