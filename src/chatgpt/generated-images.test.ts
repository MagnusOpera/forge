import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { importGeneratedImage } from "../../electron/main/chatgpt/generated-images";
it("copies saved runtime images into local Chat storage and rejects missing or non-image results", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-chat-images-"));
  try {
    const file = path.join(root, "runtime.png");
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    writeFileSync(file, bytes);
    const image = importGeneratedImage(root, {
      savedPath: file,
      fileId: "runtime-id",
    });
    expect(image.kind).toBe("image");
    expect(readFileSync(path.join(root, "attachments", image.id))).toEqual(
      bytes,
    );
    expect(() =>
      importGeneratedImage(root, {
        result: Buffer.from("not an image").toString("base64"),
      }),
    ).toThrow("unsupported image format");
    expect(() => importGeneratedImage(root, { fileId: "unreadable" })).toThrow(
      "without readable image data",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
