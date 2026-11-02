import "./styles.css";
import "./chatgpt/workspace.css";

// Libraries with document-level listeners (notably the terminal) run in this
// window's realm. All application data and IPC remain owned by the main view.
window.forgeContentTerminalEngine = async () => {
  const { loadTerminalEngine } = await import("./codex/terminal-engine");
  return loadTerminalEngine();
};
window.opener?.postMessage("forge-content-ready", "*");
