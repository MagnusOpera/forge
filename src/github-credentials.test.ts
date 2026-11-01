import { expect, it, vi } from "vitest";
import { GitHubCredentials } from "../electron/main/github-credentials";
import type { OAuthCredential } from "../electron/main/github-oauth";

function setup(initial: string | null) {
  let value = initial;
  const storage = {
    read: vi.fn(async () => value),
    write: vi.fn(async (next: string) => { value = next; }),
    remove: vi.fn(async () => { value = null; }),
    configuration: () => ({ clientId: "client", clientSecret: "secret" }),
    refresh: vi.fn<() => Promise<OAuthCredential>>(async () => ({ accessToken: "new", refreshToken: "rotated", expiresAt: Date.now() + 3600_000 })),
  };
  return { storage, credentials: new GitHubCredentials(storage), value: () => value };
}
const expired = JSON.stringify({ accessToken: "old", refreshToken: "refresh", expiresAt: 1 });

it("reads both existing PATs and unexpired OAuth sessions without refreshing", async () => {
  expect(await setup("ghp_existing").credentials.read()).toBe("ghp_existing");
  const { credentials, storage } = setup(JSON.stringify({ accessToken: "gho_saved" }));
  expect(await credentials.read()).toBe("gho_saved");
  expect(storage.refresh).not.toHaveBeenCalled();
  expect(await setup(null).credentials.read()).toBeNull();
});
it("coalesces concurrent refreshes and persists rotated credentials", async () => {
  const { credentials, storage, value } = setup(expired);
  expect(await Promise.all([credentials.read(), credentials.read(), credentials.read()])).toEqual(["new", "new", "new"]);
  expect(storage.refresh).toHaveBeenCalledTimes(1);
  expect(JSON.parse(value()!).refreshToken).toBe("rotated");
});
it("does not restore credentials when a refresh completes after sign-out or account replacement", async () => {
  for (const replace of [false, true]) {
    const { credentials, storage, value } = setup(expired);
    let resolve!: (value: OAuthCredential) => void;
    const ready = Promise.withResolvers<void>();
    storage.refresh.mockImplementation(() => {
      ready.resolve();
      return new Promise<OAuthCredential>(done => { resolve = done; });
    });
    const read = credentials.read();
    await ready.promise;
    if (replace) await credentials.replace({ accessToken: "different-account" }); else await credentials.clear();
    resolve({ accessToken: "stale" });
    expect(await read).toBeNull();
    expect(value()).toBe(replace ? JSON.stringify({ accessToken: "different-account" }) : null);
  }
});
it("keeps stored credentials on transient refresh errors so a later request can retry", async () => {
  const { credentials, storage, value } = setup(expired);
  storage.refresh.mockRejectedValueOnce(new Error("network"));
  await expect(credentials.read()).rejects.toThrow("network");
  expect(value()).toBe(expired);
  expect(await credentials.read()).toBe("new");
});

it("reports an unreadable session without exposing its stored token", async () => {
  const { credentials } = setup('{"accessToken":"sensitive-value",broken-json');
  await expect(credentials.read()).rejects.toThrow("saved GitHub session could not be read");
});

it("reports the active method for both new records and previously saved credentials", async () => {
  expect(await setup(null).credentials.method()).toBeNull();
  expect(await setup("ghp_existing").credentials.method()).toBe("token");
  expect(await setup(JSON.stringify({ accessToken: "ghp_saved" })).credentials.method()).toBe("token");
  expect(await setup(JSON.stringify({ accessToken: "gho_saved" })).credentials.method()).toBe("oauth");
  expect(await setup('{broken').credentials.method()).toBeNull();
  const { credentials } = setup(null);
  await credentials.replace({ accessToken: "oauth-credential", method: "oauth" });
  expect(await credentials.method()).toBe("oauth");
  await credentials.replace({ accessToken: "personal-credential", method: "token" });
  expect(await credentials.method()).toBe("token");
  await credentials.clear();
  expect(await credentials.method()).toBeNull();
});
it("preserves the authentication method after refreshing an expiring session", async () => {
  const { credentials, value } = setup(JSON.stringify({ accessToken: "old", refreshToken: "refresh", expiresAt: 1, method: "oauth" }));
  await credentials.read();
  expect(JSON.parse(value()!).method).toBe("oauth");
  expect(await credentials.method()).toBe("oauth");
});
