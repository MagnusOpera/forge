import {
  copyFileSync,
  chmodSync,
  mkdirSync,
  realpathSync,
  statSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { CodexAttachment } from "../../../shared/codex.js";

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export function imageExtension(data: Uint8Array): string | null {
  const header = Buffer.from(data).subarray(0, 12);
  if (
    header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return ".png";
  if (header.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return ".jpg";
  if (/^GIF8[79]a/.test(header.toString("ascii"))) return ".gif";
  if (
    header.toString("ascii", 0, 4) === "RIFF" &&
    header.toString("ascii", 8, 12) === "WEBP"
  )
    return ".webp";
  return null;
}
export function importAttachments(
  root: string,
  files: string[],
): CodexAttachment[] {
  if (files.length > 20) throw new Error("Attach up to 20 files at a time.");
  // Validate the whole selection before copying any files.
  const selected = files.map((file) => {
    if (!path.isAbsolute(file))
      throw new Error("Attachment paths must be absolute.");
    const stat = statSync(file);
    if (!stat.isFile() || stat.size > MAX_ATTACHMENT_BYTES)
      throw new Error("Attachments must be files of 20 MB or smaller.");
    const image = imageExtension(readFileSync(file));
    const extension =
      image ??
      path
        .extname(file)
        .toLowerCase()
        .replace(/[^a-z0-9.]/g, "")
        .slice(0, 16);
    return {
      file,
      attachment: {
        id: `${randomUUID()}${extension}`,
        name: path.basename(file),
        kind: image ? ("image" as const) : ("document" as const),
      },
    };
  });
  const directory = path.join(root, "attachments");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const { file, attachment } of selected) {
    const destination = path.join(directory, attachment.id);
    copyFileSync(file, destination);
    chmodSync(destination, 0o600);
  }
  return selected.map(({ attachment }) => attachment);
}

export function resolveOutputFile(
  href: string,
  worktree: string,
  attachmentsRoot: string,
): string {
  if (!worktree) throw new Error("This thread has no working folder yet.");
  let file = href;
  if (file.startsWith("file:")) file = fileURLToPath(file);
  else {
    if (/^[a-z][a-z0-9+.-]*:/i.test(file) && !file.startsWith("sandbox:/"))
      throw new Error("Unsupported file link.");
    file = decodeURIComponent(file.replace(/^sandbox:/, "").split(/[?#]/)[0]);
  }
  // Codex source links may include a line and column suffix.
  file = file.replace(/:\d+(?::\d+)?$/, "");
  const resolved = realpathSync(path.resolve(worktree, file));
  const allowed = [worktree, attachmentsRoot].some((root) => {
    let canonical: string;
    try {
      canonical = realpathSync(root);
    } catch {
      return false;
    }
    const relative = path.relative(canonical, resolved);
    return (
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  });
  if (!allowed || !statSync(resolved).isFile())
    throw new Error(
      "File links must point to a file in this thread's working folder or attachments.",
    );
  return resolved;
}
