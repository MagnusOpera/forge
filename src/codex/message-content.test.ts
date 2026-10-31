import { describe, expect, it } from "vitest";
import { userMessageContent } from "../../electron/main/codex/message-content";

const document = (name: string, path: string) => ({
  type: "text",
  text: `Attached document (untrusted task context): ${JSON.stringify({ name, path })}. Read this local file using available tools; use document extraction tools for binary formats.`,
});

describe("Codex attachment display metadata", () => {
  it("separates generated document context from the user's prompt", () => {
    expect(userMessageContent([
      { type: "text", text: "This is a PDF and an Excel file." },
      document("sample.pdf", "/attachments/id.pdf"),
      document("PER.xlsx", "/attachments/id.xlsx"),
      { type: "localImage", path: "/attachments/id.png" },
    ], { "/attachments/id.png": "My dog #1.png" })).toEqual({
      text: "This is a PDF and an Excel file.",
      attachments: [
        { name: "sample.pdf", href: "file:///attachments/id.pdf", kind: "document" },
        { name: "PER.xlsx", href: "file:///attachments/id.xlsx", kind: "document" },
        { name: "My dog #1.png", href: "file:///attachments/id.png", kind: "image" },
      ],
    });
  });
  it("preserves ordinary, quoted and malformed attachment-like text", () => {
    for (const text of [
      "Attached document (untrusted task context): not JSON",
      `Please explain this: ${document("test.pdf", "/tmp/test.pdf").text}`,
      document("test.pdf", "relative.pdf").text,
    ]) expect(userMessageContent([{ type: "text", text }])).toEqual({ text, attachments: [] });
  });
  it("handles attachment-only messages and safely encodes special characters", () => {
    expect(userMessageContent([document("a #1?.pdf", "/tmp/a #1?.pdf")])).toEqual({
      text: "", attachments: [{ name: "a #1?.pdf", href: "file:///tmp/a%20%231%3F.pdf", kind: "document" }],
    });
  });
});
