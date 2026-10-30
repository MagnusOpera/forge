import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  editorOpenArguments,
  openInTextEditor,
  validateEditor,
} from "../../electron/main/codex/editor";
import { CodexStore } from "../../electron/main/codex/store";
import { defaultCodexPreferences } from "../../shared/codex";
const temporary: string[] = [];
afterEach(() =>
  temporary
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
describe("worktree text editor", () => {
  it("defaults fresh and existing installations to Visual Studio Code", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "forge-editor-"));
    temporary.push(root);
    expect(new CodexStore(root).configuration.editor).toBe(
      "Visual Studio Code",
    );
    writeFileSync(
      path.join(root, "configuration.json"),
      JSON.stringify({
        defaults: defaultCodexPreferences,
        executable: "",
        projects: {},
      }),
    );
    expect(new CodexStore(root).configuration.editor).toBe(
      "Visual Studio Code",
    );
    expect(validateEditor("  ")).toBe("Visual Studio Code");
  });
  it("passes app names and folder paths as literal arguments without executing a shell", async () => {
    const launch = vi.fn().mockResolvedValue(undefined);
    const folder = "/tmp/repo with spaces/$(touch should-not-run)";
    await openInTextEditor(
      folder,
      "/Applications/Visual Studio Code.app",
      launch,
    );
    expect(launch).toHaveBeenCalledWith(
      "/usr/bin/open",
      ["-a", "/Applications/Visual Studio Code.app", folder],
      { timeout: 10000 },
    );
    expect(editorOpenArguments("Cursor", "/tmp/repo")).toEqual([
      "-a",
      "Cursor",
      "/tmp/repo",
    ]);
  });
  it("rejects executable commands, invalid application paths, options, and relative folders", () => {
    for (const value of [
      undefined,
      7,
      "-a",
      "code\n--wait",
      "bad\0app",
      "/usr/bin/vim",
      "relative/editor.app",
    ])
      expect(() => validateEditor(value)).toThrow();
    expect(() => editorOpenArguments("Cursor", "relative-repo")).toThrow(
      "folder",
    );
  });
  it("provides actionable guidance if the configured application cannot launch", async () => {
    await expect(
      openInTextEditor(
        "/tmp/repo",
        "Missing Editor",
        vi.fn().mockRejectedValue(new Error("not installed")),
      ),
    ).rejects.toThrow("choose its application in global configuration");
  });
});
