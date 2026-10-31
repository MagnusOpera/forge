import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import { loadTerminalEngine } from "./terminal-engine";

afterEach(() => vi.unstubAllGlobals());

it("recreates a terminal safely after disposing output with multi-codepoint graphemes", async () => {
  const bytes = readFileSync(createRequire(import.meta.url).resolve("ghostty-web/ghostty-vt.wasm"));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes)));
  let previous: unknown;
  for (const cols of [120, 195, 288, 120]) {
    const { ghostty } = await loadTerminalEngine();
    expect(ghostty).not.toBe(previous);
    previous = ghostty;
    const terminal = ghostty.createTerminal(cols, 12);
    try {
      terminal.write("👋🏽 🇫🇷 👨‍👩‍👧\r\n");
      terminal.write("fresh terminal");
      terminal.update();
      const line = terminal.getViewport().slice(cols, cols + 14);
      expect(line.map((cell) => String.fromCodePoint(cell.codepoint)).join("")).toBe("fresh terminal");
    } finally {
      terminal.free();
    }
  }
});
