import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { expect, it } from "vitest";
import { chatAttachments } from "../../electron/main/chatgpt/attachments";
import { importAttachmentData } from "../../electron/main/codex/files";
it("derives attachment types from the copied file and rejects traversal and symlinks outside storage", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-chat-attachments-"));
  try {
    const [file] = importAttachmentData(root, [
      { name: "notes.txt", data: new TextEncoder().encode("hello") },
    ]);
    expect(chatAttachments(root, [{ ...file, kind: "image" }])[0].kind).toBe(
      "document",
    );
    expect(() =>
      chatAttachments(root, [{ id: "../../secret", name: "notes" }]),
    ).toThrow("Invalid attachment ID");
    const outside = path.join(root, "outside.txt");
    writeFileSync(outside, "not attached");
    const id = "00000000-0000-0000-0000-000000000000.txt";
    symlinkSync(outside, path.join(root, "attachments", id));
    expect(() => chatAttachments(root, [{ id, name: "outside.txt" }])).toThrow(
      "Invalid attachment file",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
