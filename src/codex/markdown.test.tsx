import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CodexMarkdown, markdownUrl } from "./markdown";
describe("Codex Markdown output", () => {
  it("preserves local artifact URLs and rejects executable protocols", () => {
    for (const href of [
      "/tmp/report.pdf",
      "sandbox:/tmp/report.pdf",
      "file:///tmp/report.pdf",
      "docs/report.pdf",
      "https://example.com",
    ])
      expect(markdownUrl(href)).toBe(href);
    expect(markdownUrl("javascript:alert(1)")).toBe("");
    expect(markdownUrl("data:text/html,evil")).toBe("");
  });
  it("renders GFM, file download actions, Mermaid and safe remote images without raw HTML", () => {
    const html = renderToStaticMarkup(
      <CodexMarkdown
        repositoryId="repo"
        id="thread"
        onError={() => {}}
        text={
          "**Bold**\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n[Report](/tmp/report.pdf)\n\n```mermaid\ngraph TD; A-->B\n```\n\n![Preview](https://example.com/image.png)\n\n<script>alert(1)</script>"
        }
      />,
    );
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("<table>");
    expect(html).toContain("Save a copy");
    expect(html).toContain("codex-mermaid");
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).not.toContain("<script>");
  });
});
