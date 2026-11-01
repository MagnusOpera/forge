import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { MINIMUM_CODEX_VERSION } from "../../../shared/codex.js";

const exec = promisify(execFile);

export function codexVersion(output: string): string | null {
  return /^(?:codex-cli\s+)?v?(\d+\.\d+\.\d+(?:-[\w.-]+)?)(?:\+[\w.-]+)?$/.exec(output.trim())?.[1] ?? null;
}

export function supportsCodexVersion(output: string, minimum = MINIMUM_CODEX_VERSION): boolean {
  const version = codexVersion(output);
  if (!version) return false;
  const installed = version.split("-")[0].split(".").map(Number);
  const required = minimum.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if (installed[index] !== required[index]) return installed[index] > required[index];
  }
  return !version.includes("-");
}

export type CodexUpgradeCommand = { command: string; args: string[] };

/** Identify the owner of this executable, rather than an unrelated manager on PATH. */
export function codexUpgradeCommand(realExecutable: string): CodexUpgradeCommand | null {
  const cask = /^(.*)\/Caskroom\/codex\//.exec(realExecutable);
  if (cask) return { command: path.join(cask[1], "bin/brew"), args: ["upgrade", "--cask", "codex"] };
  const formula = /^(.*)\/Cellar\/codex\//.exec(realExecutable);
  if (formula) return { command: path.join(formula[1], "bin/brew"), args: ["upgrade", "codex"] };
  const npm = /^(.*)\/lib\/node_modules\/@openai\/codex\//.exec(realExecutable);
  if (npm) return { command: path.join(npm[1], "bin/npm"), args: ["install", "--global", "@openai/codex@latest"] };
  return null;
}

type VersionCheckOptions = {
  readVersion(executable: string): Promise<string>;
  realpath(executable: string): string;
  upgrade(command: CodexUpgradeCommand): Promise<void>;
};

/** Share an in-flight check across global, project, and restored account runtimes. */
export function createCodexVersionCheck(options: VersionCheckOptions) {
  const pending = new Map<string, Promise<string>>();
  return (executable: string): Promise<string> => {
    const existing = pending.get(executable);
    if (existing) return existing;
    const check = (async () => {
      const output = (await options.readVersion(executable)).trim();
      if (!codexVersion(output)) throw new Error(`Could not read the Codex CLI version (${output.slice(0, 120) || "empty output"}). Forge requires ${MINIMUM_CODEX_VERSION} or newer. Update Codex CLI or choose another executable in global configuration.`);
      if (supportsCodexVersion(output)) return output;
      const requirement = `Codex ${codexVersion(output)} is too old. Forge requires ${MINIMUM_CODEX_VERSION} or newer.`;
      const command = codexUpgradeCommand(options.realpath(executable));
      if (!command) throw new Error(`${requirement} Update this installation using its original installer, then refresh Codex status in global configuration.`);
      const manualCommand = [command.command, ...command.args].join(" ");
      try {
        await options.upgrade(command);
      } catch {
        throw new Error(`${requirement} Automatic upgrade failed. Run ${manualCommand} in Terminal, then refresh Codex status in global configuration.`);
      }
      const updated = (await options.readVersion(executable)).trim();
      if (!supportsCodexVersion(updated)) throw new Error(`${requirement} The upgrade still reports ${updated.slice(0, 120) || "no version"}. Run ${manualCommand} in Terminal or choose a compatible executable in global configuration.`);
      return updated;
    })().finally(() => pending.delete(executable));
    pending.set(executable, check);
    return check;
  };
}

export const ensureCodexVersion = createCodexVersionCheck({
  readVersion: async (executable) => (await exec(executable, ["--version"], { timeout: 10_000, maxBuffer: 64 * 1024 })).stdout,
  realpath: realpathSync,
  upgrade: async ({ command, args }) => {
    await exec(command, args, {
      cwd: os.homedir(),
      timeout: 5 * 60_000,
      maxBuffer: 1024 * 1024,
      // npm's launcher needs its sibling Node even when Forge starts from Finder.
      env: { ...process.env, PATH: [path.dirname(command), process.env.PATH, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].filter(Boolean).join(path.delimiter) },
    });
  },
});
