import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("electron main packaging", () => {
  it("uses the CommonJS-compatible electron-updater import shape", () => {
    const updaterModuleShape = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          [
            "const mod = await import('electron-updater');",
            "console.log(JSON.stringify({",
            "  hasNamedAutoUpdater: 'autoUpdater' in mod,",
            "  hasDefaultAutoUpdater: 'autoUpdater' in mod.default",
            "}));"
          ].join("\n")
        ],
        { cwd: repoRoot, encoding: "utf8" }
      )
    ) as { hasNamedAutoUpdater: boolean; hasDefaultAutoUpdater: boolean };
    const mainSource = readFileSync(path.join(repoRoot, "electron/main/main.ts"), "utf8");

    expect(updaterModuleShape.hasNamedAutoUpdater).toBe(false);
    expect(updaterModuleShape.hasDefaultAutoUpdater).toBe(true);
    expect(mainSource).toMatch(/import\s+\w+\s+from\s+"electron-updater";/);
    expect(mainSource).not.toMatch(/import\s*\{[^}]*\bautoUpdater\b[^}]*\}\s*from\s+"electron-updater";/s);
  });
});
