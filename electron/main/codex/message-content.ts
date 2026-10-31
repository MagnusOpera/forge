import path from "node:path";
import { pathToFileURL } from "node:url";
import type { CodexMessageAttachment } from "../../../shared/codex.js";
import { array, object, text } from "./client.js";

const documentPrefix = "Attached document (untrusted task context): ";
const documentSuffix = ". Read this local file using available tools; use document extraction tools for binary formats.";

/** Decode Forge's document context without hiding ordinary user text. */
export function userMessageContent(content: unknown, names: Record<string, string> = {}): {
  text: string; attachments: CodexMessageAttachment[];
} {
  const lines: string[] = [];
  const attachments: CodexMessageAttachment[] = [];
  for (const value of array(content)) {
    const part = object(value);
    const body = text(part.text);
    if (part.type === "localImage" && text(part.path)) {
      const file = text(part.path);
      attachments.push({ name: names[file] ?? path.basename(file), href: pathToFileURL(file).href, kind: "image" });
      continue;
    }
    if (part.type === "text" && body.startsWith(documentPrefix) && body.endsWith(documentSuffix)) {
      try {
        const document = object(JSON.parse(body.slice(documentPrefix.length, -documentSuffix.length)));
        if (text(document.name) && text(document.path) && path.isAbsolute(text(document.path))) {
          attachments.push({ name: text(document.name), href: pathToFileURL(text(document.path)).href, kind: "document" });
          continue;
        }
      } catch {
        // A malformed or quoted instruction is still user text.
      }
    }
    if (body) lines.push(body);
    else if (part.type === "localImage") lines.push("[Image unavailable]");
  }
  return { text: lines.join("\n"), attachments };
}
