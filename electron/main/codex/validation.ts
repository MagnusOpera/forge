import path from "node:path";
import { fileURLToPath } from "node:url";
export function trustedCodexSenderUrl(
  url: string,
  packaged: boolean,
  appPath: string,
  devUrl = "http://127.0.0.1:5173",
): boolean {
  try {
    const parsed = new URL(url);
    if (!packaged)
      return (
        parsed.origin === new URL(devUrl).origin &&
        parsed.pathname === new URL(devUrl).pathname
      );
    return (
      parsed.protocol === "file:" &&
      path.resolve(fileURLToPath(parsed)) ===
        path.join(appPath, "dist/renderer/index.html")
    );
  } catch {
    return false;
  }
}
