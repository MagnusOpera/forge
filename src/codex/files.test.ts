import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  importAttachments,
  resolveOutputFile,
} from "../../electron/main/codex/files";
import { isImageAttachment } from "../../shared/codex";
const roots: string[] = [];
function temp() {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-files-"));
  roots.push(root);
  return root;
}
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
describe("Codex files", () => {
  it("imports documents and detects images by content, retaining original names", () => {
    const source = temp(),
      store = temp();
    const document = path.join(source, "design.pdf");
    const image = path.join(source, "picture.dat");
    writeFileSync(document, "%PDF-1.7\nfixture");
    writeFileSync(image, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const [doc, pic] = importAttachments(store, [document, image]);
    expect(doc).toMatchObject({ name: "design.pdf", kind: "document" });
    expect(pic).toMatchObject({ name: "picture.dat", kind: "image" });
    expect(isImageAttachment(doc)).toBe(false);
    expect(isImageAttachment(pic)).toBe(true);
    expect(isImageAttachment({ id: "legacy.png", name: "legacy" })).toBe(true);
    expect(
      readFileSync(path.join(store, "attachments", doc.id), "utf8"),
    ).toContain("%PDF");
  });
  it("rejects directories, relative paths and oversized selections", () => {
    const root = temp();
    expect(() => importAttachments(root, [root])).toThrow("20 MB");
    expect(() => importAttachments(root, ["relative.pdf"])).toThrow("absolute");
    expect(() => importAttachments(root, Array(21).fill(root))).toThrow(
      "20 files",
    );
  });
  it("resolves relative, absolute, sandbox and file links but blocks traversal and symlink escapes", () => {
    const root = temp(),
      outside = temp();
    mkdirSync(path.join(root, "work"));
    const work = path.join(root, "work"),
      file = path.join(work, "my report.pdf");
    writeFileSync(file, "report");
    writeFileSync(path.join(outside, "secret"), "secret");
    for (const href of [
      "my%20report.pdf",
      file,
      `sandbox:${file}`,
      `file://${file.replaceAll(" ", "%20")}`,
      `${file}:12:3`,
    ])
      expect(resolveOutputFile(href, work, path.join(root, "missing"))).toBe(
        realpathSync(file),
      );
    symlinkSync(outside, path.join(work, "escape"));
    expect(() =>
      resolveOutputFile("escape/secret", work, outside + "-missing"),
    ).toThrow("working folder");
    expect(() =>
      resolveOutputFile(path.join(outside, "secret"), work, work),
    ).toThrow("working folder");
    expect(() =>
      resolveOutputFile("https://example.com/file", work, root),
    ).toThrow("Unsupported");
  });
});
