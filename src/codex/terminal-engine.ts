import { Ghostty, Terminal, FitAddon } from "ghostty-web";
import wasmUrl from "ghostty-web/ghostty-vt.wasm?url";

export async function loadTerminalEngine() {
  // Ghostty 0.4 can corrupt its allocator when a terminal containing grapheme
  // clusters is freed. Never reuse that terminal's WASM memory in another view.
  // The browser caches the local WASM asset; each view owns a fresh instance.
  const ghostty = await Ghostty.load(wasmUrl);
  return { Terminal, FitAddon, ghostty };
}
