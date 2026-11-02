import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { CodexAttachment } from "../../../shared/codex.js";
import { imageExtension, MAX_ATTACHMENT_BYTES } from "../codex/files.js";
import { requiredText } from "./protocol.js";

export function chatAttachmentPath(root: string, id: string): string {
  if (!/^[a-f0-9-]{36}(?:\.[a-z0-9.]{1,15})?$/.test(id))
    throw new Error("Invalid attachment ID.");
  const directory = realpathSync(path.join(root, "attachments"));
  const file = realpathSync(path.join(directory, id));
  if (
    path.dirname(file) !== directory ||
    !statSync(file).isFile() ||
    statSync(file).size > MAX_ATTACHMENT_BYTES
  )
    throw new Error("Invalid attachment file.");
  return file;
}

export function chatAttachments(
  root: string,
  value: unknown,
): CodexAttachment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20)
    throw new Error("Attach up to 20 files per message.");
  return value.map((entry) => {
    const id = requiredText(entry?.id, "attachment ID");
    const file = chatAttachmentPath(root, id);
    return {
      id,
      name: requiredText(entry?.name, "attachment name", 1024),
      kind: imageExtension(readFileSync(file)) ? "image" : "document",
    };
  });
}
