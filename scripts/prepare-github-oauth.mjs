import fs from "node:fs/promises";

const clientId = process.env.FORGE_GITHUB_CLIENT_ID?.trim() ?? "";
const clientSecret = process.env.FORGE_GITHUB_CLIENT_SECRET?.trim() ?? "";
if (Boolean(clientId) !== Boolean(clientSecret)) {
  throw new Error("Set both FORGE_GITHUB_CLIENT_ID and FORGE_GITHUB_CLIENT_SECRET.");
}
if (process.env.FORGE_REQUIRE_GITHUB_OAUTH === "true" && !clientId) {
  throw new Error("Release builds require the Forge GitHub OAuth App credentials.");
}
await fs.mkdir("dist-electron", { recursive: true });
await fs.writeFile("dist-electron/github-oauth.json", JSON.stringify({ clientId, clientSecret }), { mode: 0o600 });
