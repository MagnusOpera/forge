// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { composerExtensions, handleComposerKeyDown } from "./composer-editor";
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
