// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import {
  composerExtensions,
  handleComposerKeyDown,
  handleComposerPaste,
} from "./composer-editor";
const editors: Editor[] = [];
const create = (content: string) => {
  const editor = new Editor({
    extensions: composerExtensions(),
    content,
    contentType: "markdown",
  });
  editors.push(editor);
  return editor;
};
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));
describe("Codex visual Markdown editor", () => {
  it("round-trips headings, bold, italic, inline code and fenced code", () => {
    const source =
      "# Title\n\n**Bold** and *italic* with `inline`\n\n```ts\nconst value = 1;\n```";
    const editor = create(source);
    expect(editor.getHTML()).toContain("<h1>Title</h1>");
    expect(editor.getHTML()).toContain("<strong>Bold</strong>");
    expect(editor.getHTML()).toContain("<em>italic</em>");
    expect(editor.getHTML()).toContain("<code>inline</code>");
    const roundTrip = create(editor.getMarkdown());
    expect(roundTrip.getJSON()).toEqual(editor.getJSON());
    expect(editor.getMarkdown()).toContain("```ts\nconst value = 1;");
  });
  it("only enables the requested formatting, with no image or link nodes", () => {
    const editor = create("Text");
    expect(editor.schema.nodes.image).toBeUndefined();
    expect(editor.schema.nodes.bulletList).toBeUndefined();
    expect(Object.keys(editor.schema.marks).sort()).toEqual([
      "bold",
      "code",
      "italic",
    ]);
    editor.commands.selectAll();
    editor.commands.toggleBold();
    expect(editor.getMarkdown()).toBe("**Text**");
    editor.commands.toggleBold();
    editor.commands.toggleItalic();
    expect(editor.getMarkdown()).toBe("*Text*");
  });
  it("resets the document after send and preserves literal code", () => {
    const editor = create('```\n<a href="evil">**literal**</a>\n```');
    expect(editor.getMarkdown()).toContain('<a href="evil">**literal**</a>');
    editor.commands.setContent("", {
      contentType: "markdown",
      emitUpdate: false,
    });
    expect(editor.getMarkdown()).toBe("");
  });
  it("converts a typed fence on Enter before sending and keeps code Enter local", () => {
    const editor = create("");
    editor.commands.insertContent({ type: "text", text: "```ts" });
    const send = vi.fn();
    expect(
      handleComposerKeyDown(
        editor,
        new KeyboardEvent("keydown", { key: "Enter" }),
        send,
      ),
    ).toBe(true);
    expect(editor.isActive("codeBlock")).toBe(true);
    expect(editor.getHTML()).toContain('class="language-ts"');
    expect(
      handleComposerKeyDown(
        editor,
        new KeyboardEvent("keydown", { key: "Enter" }),
        send,
      ),
    ).toBe(false);
    expect(send).not.toHaveBeenCalled();
    handleComposerKeyDown(
      editor,
      new KeyboardEvent("keydown", { key: "Enter", metaKey: true }),
      send,
    );
    expect(send).toHaveBeenCalledOnce();
  });
  it("starts a plain paragraph with Shift+Enter after a heading, without sending during IME", () => {
    const editor = create("## Heading");
    editor.commands.setTextSelection(8);
    const send = vi.fn();
    handleComposerKeyDown(
      editor,
      new KeyboardEvent("keydown", { key: "Enter", shiftKey: true }),
      send,
    );
    expect(editor.isActive("heading")).toBe(false);
    expect(editor.isActive("paragraph")).toBe(true);
    handleComposerKeyDown(
      editor,
      new KeyboardEvent("keydown", { key: "Enter", isComposing: true }),
      send,
    );
    expect(send).not.toHaveBeenCalled();
  });
});

describe("Codex clipboard formatting", () => {
  const releaseNotes = [
    "# Release Notes",
    "",
    "**Context:** Timeline\\",
    "**Repository:** matisclub/matis-next\\",
    "**Environment:** prodfr-invest-prod\\",
    "**Applied Tag:** invest-prod-v2026.38.0\\",
    "**Entry Head:** 75e52f2",
  ].join("\n");
  const paste = (editor: Editor, text: string, html = "") => {
    const event = {
      clipboardData: {
        getData: (type: string) => (type === "text/html" ? html : text),
      },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;
    return { handled: handleComposerPaste(editor, event), event };
  };
  it("pastes the release notes as a heading, bold labels and hard line breaks", () => {
    const editor = create("");
    paste(editor, releaseNotes);
    expect(editor.getHTML()).toContain("<h1>Release Notes</h1>");
    for (const label of [
      "Context:",
      "Repository:",
      "Environment:",
      "Applied Tag:",
      "Entry Head:",
    ])
      expect(editor.getHTML()).toContain(`<strong>${label}</strong>`);
    expect(editor.getHTML().match(/<br>/g)).toHaveLength(4);
    expect(create(editor.getMarkdown()).getJSON()).toEqual(editor.getJSON());
  });
  it("keeps Google Docs HTML formatting when its plain text has no Markdown", () => {
    const editor = create("");
    paste(
      editor,
      "Release Notes\nContext: Timeline\nRepository: matisclub/matis-next",
      '<b id="docs-internal-guid-fixture" style="font-weight:normal"><h1><span>Release Notes</span></h1><p><span style="font-weight:700">Context:</span><span> Timeline</span><br><span style="font-weight:700">Repository:</span> matisclub/matis-next</p><p><span style="font-style:italic">Italic</span> <code>code</code></p></b>',
    );
    expect(editor.getHTML()).toContain("<h1>Release Notes</h1>");
    expect(editor.getHTML()).toContain(
      "<strong>Context:</strong> Timeline<br><strong>Repository:</strong>",
    );
    expect(editor.getHTML()).toContain("<em>Italic</em>");
    expect(editor.getHTML()).toContain("<code>code</code>");
    expect(editor.getMarkdown()).toContain("**Context:**");
  });
  it("parses Markdown from plain HTML wrappers and strips unsupported active content", () => {
    const editor = create("");
    paste(editor, releaseNotes, `<div>${releaseNotes}</div>`);
    expect(editor.getHTML()).toContain("<h1>Release Notes</h1>");
    const other = create("");
    paste(
      other,
      "Bold link",
      '<p onclick="alert(1)"><strong>Bold</strong> <a href="javascript:alert(1)">link</a><img src="https://example.com/pixel"><script>alert(1)</script></p>',
    );
    expect(other.getHTML()).toContain("<strong>Bold</strong> link");
    expect(other.getHTML()).not.toMatch(/<a|<img|<script|onclick/);
  });
  it("leaves code block paste literal and inserts into the existing selection", () => {
    const editor = create("```\ncode\n```");
    expect(paste(editor, "**literal**", "<b>literal</b>").handled).toBe(false);
    const other = create("Replace me");
    other.commands.selectAll();
    paste(other, releaseNotes);
    expect(other.getHTML()).not.toContain("Replace me");
    expect(other.getHTML()).toContain("<h1>Release Notes</h1>");
  });
});
