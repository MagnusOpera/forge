import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

let directory: string;
const script = path.resolve("scripts/prepare-github-oauth.mjs");
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), "forge-oauth-build-")); });
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });
function build(environment: Record<string, string> = {}) {
  return execFileSync(process.execPath, [script], {
    cwd: directory,
    env: { ...process.env, FORGE_GITHUB_CLIENT_ID: "", FORGE_GITHUB_CLIENT_SECRET: "", FORGE_REQUIRE_GITHUB_OAUTH: "", ...environment },
    stdio: "pipe",
  });
}
it("requires complete OAuth configuration for releases", () => {
  expect(() => build({ FORGE_REQUIRE_GITHUB_OAUTH: "true" })).toThrow();
  expect(() => build({ FORGE_GITHUB_CLIENT_ID: "client" })).toThrow();
});
it("writes main-process credentials and removes stale credentials on an unconfigured development rebuild", async () => {
  build({ FORGE_GITHUB_CLIENT_ID: "client", FORGE_GITHUB_CLIENT_SECRET: "secret", FORGE_REQUIRE_GITHUB_OAUTH: "true" });
  const output = path.join(directory, "dist-electron/github-oauth.json");
  expect(JSON.parse(await fs.readFile(output, "utf8"))).toEqual({ clientId: "client", clientSecret: "secret" });
  build();
  expect(JSON.parse(await fs.readFile(output, "utf8"))).toEqual({ clientId: "", clientSecret: "" });
});
