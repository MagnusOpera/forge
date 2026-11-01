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

it("reads unexpired OAuth sessions without refreshing", async () => {
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

it("requires browser sign-in for legacy personal tokens without using or refreshing them", async () => {
  for (const stored of ["ghp_existing", JSON.stringify({ accessToken: "ghp_saved" }), JSON.stringify({ accessToken: "legacy", method: "token" })]) {
    const { credentials, storage, value } = setup(stored);
    expect(await credentials.hasSession()).toBe(false);
    expect(await credentials.read()).toBeNull();
    expect(storage.refresh).not.toHaveBeenCalled();
    expect(value()).toBe(stored);
    await credentials.replace({ accessToken: "gho_signed_in" });
    expect(await credentials.hasSession()).toBe(true);
    expect(await credentials.read()).toBe("gho_signed_in");
  }
});
it("recognizes previous OAuth sessions, including those with method metadata, and clears session status on sign-out", async () => {
  for (const stored of [JSON.stringify({ accessToken: "gho_saved" }), JSON.stringify({ accessToken: "gho_saved", method: "oauth" })]) {
    const { credentials } = setup(stored);
    expect(await credentials.hasSession()).toBe(true);
    expect(await credentials.read()).toBe("gho_saved");
    await credentials.clear();
    expect(await credentials.hasSession()).toBe(false);
  }
  expect(await setup(null).credentials.hasSession()).toBe(false);
  expect(await setup('{broken').credentials.hasSession()).toBe(false);
});
