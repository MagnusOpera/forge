import { requestOAuthToken, type OAuthConfiguration, type OAuthCredential } from "./github-oauth.js";

function decodeCredential(stored: string | null): OAuthCredential | null {
  // Legacy raw personal tokens must return users to browser sign-in.
  if (!stored || !stored.startsWith("{")) return null;
  try {
    const credential = JSON.parse(stored) as OAuthCredential & { method?: unknown };
    if (!credential || typeof credential.accessToken !== "string" || !credential.accessToken) throw new Error();
    if (credential.method === "token" || /^(ghp_|github_pat_)/.test(credential.accessToken)) return null;
    return { accessToken: credential.accessToken, refreshToken: credential.refreshToken, expiresAt: credential.expiresAt };
  } catch { throw new Error("Your saved GitHub session could not be read. Sign in with GitHub again."); }
}

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
      let credential = decodeCredential(stored);
      if (!credential) return null;
      if (credential.expiresAt && credential.expiresAt <= Date.now() + 60_000) {
        if (!credential.refreshToken) throw new Error("Your GitHub session has expired. Sign in with GitHub again.");
        const refreshed = await (this.storage.refresh ?? requestOAuthToken)(this.storage.configuration(), {
          grant_type: "refresh_token", refresh_token: credential.refreshToken,
        });
        credential = refreshed;
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

  async hasSession(): Promise<boolean> {
    await this.writes;
    try { return decodeCredential(await this.storage.read()) !== null; }
    catch { return false; }
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
