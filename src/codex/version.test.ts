import { describe, expect, it, vi } from "vitest";
import { codexUpgradeCommand, codexVersion, createCodexVersionCheck, supportsCodexVersion } from "../../electron/main/codex/version";
import { MINIMUM_CODEX_VERSION } from "../../shared/codex";

describe("Codex minimum version", () => {
  it.each([
    ["codex-cli 0.164.0", true],
    ["0.164.0+build.1", true],
    ["codex-cli 0.165.0", true],
    ["codex-cli 1.0.0", true],
    ["codex-cli 0.99.0", false],
    ["codex-cli 0.163.99", false],
    ["codex-cli 0.164.0-alpha.1", false],
    ["codex-cli unknown", false],
    ["error: version 9.9.9", false],
  ])("checks %s numerically", (output, supported) => {
    expect(supportsCodexVersion(output)).toBe(supported);
  });
  it("parses version output without treating arbitrary diagnostics as a version", () => {
    expect(codexVersion("codex-cli 0.164.0\n")).toBe("0.164.0");
    expect(codexVersion("could not start 0.164.0")).toBeNull();
  });
});

describe("Codex package manager discovery", () => {
  it.each([
    ["/opt/homebrew/Caskroom/codex/0.100.0/bin/codex", "/opt/homebrew/bin/brew", ["upgrade", "--cask", "codex"]],
    ["/usr/local/Cellar/codex/0.100.0/bin/codex", "/usr/local/bin/brew", ["upgrade", "codex"]],
    ["/Users/alice/.nvm/versions/node/v24.1.0/lib/node_modules/@openai/codex/bin/codex.js", "/Users/alice/.nvm/versions/node/v24.1.0/bin/npm", ["install", "--global", "@openai/codex@latest"]],
  ])("uses the manager that owns %s", (executable, command, args) => {
    expect(codexUpgradeCommand(executable)).toEqual({ command, args });
  });
  it.each(["/Users/alice/bin/codex", "/project/node_modules/@openai/codex/bin/codex.js", "/opt/homebrew/Caskroom/other/1.0/bin/codex"])("leaves custom or project installations alone: %s", (file) => {
    expect(codexUpgradeCommand(file)).toBeNull();
  });
});

function fixture(versions = ["codex-cli 0.100.0", `codex-cli ${MINIMUM_CODEX_VERSION}`]) {
  const readVersion = vi.fn(async () => versions.shift() ?? "codex-cli 0.100.0");
  const upgrade = vi.fn(async (_command: unknown) => {});
  const realpath = vi.fn(() => "/opt/homebrew/Caskroom/codex/0.100.0/bin/codex");
  return { readVersion, upgrade, realpath };
}

describe("Codex startup upgrades", () => {
  it("checks a compatible installation without invoking a package manager", async () => {
    const options = fixture(["codex-cli 0.170.0"]);
    expect(await createCodexVersionCheck(options)("/bin/codex")).toBe("codex-cli 0.170.0");
    expect(options.upgrade).not.toHaveBeenCalled();
    expect(options.realpath).not.toHaveBeenCalled();
  });
  it("shares concurrent startup/account checks and verifies the installed version after upgrading", async () => {
    const options = fixture();
    const check = createCodexVersionCheck(options);
    const first = check("/bin/codex");
    const second = check("/bin/codex");
    expect(first).toBe(second);
    expect(await first).toBe(`codex-cli ${MINIMUM_CODEX_VERSION}`);
    expect(options.readVersion).toHaveBeenCalledTimes(2);
    expect(options.upgrade).toHaveBeenCalledExactlyOnceWith({ command: "/opt/homebrew/bin/brew", args: ["upgrade", "--cask", "codex"] });
  });
  it("reports custom installation instructions without attempting an unrelated package manager", async () => {
    const options = fixture();
    options.realpath.mockReturnValue("/custom/codex");
    await expect(createCodexVersionCheck(options)("/custom/codex")).rejects.toThrow("original installer");
    expect(options.upgrade).not.toHaveBeenCalled();
  });
  it("reports failures and permits retry after an external repair", async () => {
    const options = fixture();
    options.upgrade.mockRejectedValueOnce(new Error("Permission denied"));
    const check = createCodexVersionCheck(options);
    await expect(check("/bin/codex")).rejects.toThrow("Run /opt/homebrew/bin/brew upgrade --cask codex in Terminal");
    expect(await check("/bin/codex")).toBe(`codex-cli ${MINIMUM_CODEX_VERSION}`);
  });
  it("rejects an upgrade that leaves the old executable in use", async () => {
    const options = fixture(["codex-cli 0.100.0", "codex-cli 0.100.0"]);
    await expect(createCodexVersionCheck(options)("/bin/codex")).rejects.toThrow("upgrade still reports");
  });
  it("never upgrades an unrecognized version", async () => {
    const options = fixture(["codex-cli test"]);
    await expect(createCodexVersionCheck(options)("/bin/codex")).rejects.toThrow("Could not read");
    expect(options.upgrade).not.toHaveBeenCalled();
  });
});
