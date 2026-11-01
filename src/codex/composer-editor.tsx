import { usePaneSurface } from "../pane-surface";
import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import DOMPurify from "dompurify";
import type { CodexSendShortcut } from "../../shared/codex";

export const composerExtensions = () => [
  StarterKit.configure({
    blockquote: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    listKeymap: false,
    horizontalRule: false,
    strike: false,
    underline: false,
    link: false,
    heading: { levels: [1, 2, 3] },
  }),
  Markdown,
];

export function handleComposerKeyDown(
  editor: Editor,
  event: KeyboardEvent,
  onSend: () => void,
  sendShortcut: CodexSendShortcut = "enter",
): boolean {
  if (event.key !== "Enter" || event.isComposing || editor.view.composing)
    return false;
  const { $from, empty } = editor.view.state.selection;
  const fence =
    empty &&
    $from.parent.type.name === "paragraph" &&
    $from.parentOffset === $from.parent.content.size
      ? /^\s*(?:```|~~~)([\w+-]*)\s*$/.exec($from.parent.textContent)
      : null;
  if (fence && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    editor.view.dispatch(
      editor.view.state.tr
        .delete($from.start(), $from.end())
        .setBlockType(
          $from.before(),
          $from.before() + 1,
          editor.view.state.schema.nodes.codeBlock,
          { language: fence[1] || null },
        ),
    );
    return true;
  }
  if (event.shiftKey && $from.parent.type.name !== "codeBlock") {
    event.preventDefault();
    return editor.commands.splitBlock();
  }
  if (event.shiftKey) return false;
  if (sendShortcut === "command-enter" && !event.metaKey && !event.ctrlKey)
    return false;
  // Enter within code inserts a line; Cmd/Ctrl+Enter sends the message.
  if (
    $from.parent.type.name === "codeBlock" &&
    !event.metaKey &&
    !event.ctrlKey
  )
    return false;
  event.preventDefault();
  onSend();
  return true;
}

export function handleComposerPaste(
  editor: Editor,
  event: ClipboardEvent,
): boolean {
  const text = event.clipboardData?.getData("text/plain") ?? "";
  const html = event.clipboardData?.getData("text/html") ?? "";
  if ((!text && !html) || editor.isActive("codeBlock")) return false;
  // Google Docs supplies formatted HTML and an unformatted plain-text fallback.
  // Keep only the editor's supported formatting; links and images stay disabled.
  const safe = html
    ? DOMPurify.sanitize(html, {
        ALLOWED_TAGS: [
          "p",
          "div",
          "br",
          "h1",
          "h2",
          "h3",
          "strong",
          "b",
          "em",
          "i",
          "pre",
          "code",
          "span",
        ],
        ALLOWED_ATTR: ["style"],
      })
    : "";
  const document = new DOMParser().parseFromString(safe, "text/html");
  const formatted =
    Boolean(document.querySelector("h1, h2, h3, strong, em, i, pre, code")) ||
    Array.from(document.querySelectorAll<HTMLElement>("b, [style]")).some(
      (element) =>
        (element.tagName === "B" && element.style.fontWeight !== "normal") ||
        /^(bold|bolder|[6-9]00)$/.test(element.style.fontWeight) ||
        element.style.fontStyle === "italic",
    );
  event.preventDefault();
  if (formatted || !text)
    editor.commands.insertContent(safe, { contentType: "html" });
  else editor.commands.insertContent(text, { contentType: "markdown" });
  return true;
}

export function ComposerEditor({
  value,
  onChange,
  onSend,
  disabled,
  placeholder,
  sendShortcut = "enter",
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
  placeholder: string;
  sendShortcut?: CodexSendShortcut;
}) {
  const { document } = usePaneSurface();
  const callbacks = useRef({ onChange, onSend, sendShortcut });
  callbacks.current = { onChange, onSend, sendShortcut };
  const editorRef = useRef<Editor | null>(null);
  const lastEmitted = useRef(value);
  const editor = useEditor({
    extensions: composerExtensions(),
    content: value,
    contentType: "markdown",
    editable: !disabled,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Message Codex",
        "aria-multiline": "true",
        "data-placeholder": placeholder,
      },
      handleKeyDown: (view, event): boolean => {
        const current = editorRef.current;
        return current
          ? handleComposerKeyDown(
              current,
              event,
              callbacks.current.onSend,
              callbacks.current.sendShortcut,
            )
          : false;
      },
      // File drops belong to the surrounding attachment intake, never the document.
      handleDrop: (_view, event) => Boolean(event.dataTransfer?.files.length),
      handlePaste: (_view, event): boolean =>
        editorRef.current
          ? handleComposerPaste(editorRef.current, event)
          : false,
    },
    onUpdate: ({ editor }) => {
      const markdown = editor.getMarkdown();
      lastEmitted.current = markdown;
      callbacks.current.onChange(markdown);
    },
  });
  editorRef.current = editor;
  useEffect(() => {
    // ProseMirror caches its document root; the live editor moves with the pane.
    editor?.view.updateRoot();
  }, [editor, document]);
  useEffect(() => {
    // A busy-state change must not emit the previous document as a new draft.
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);
  useEffect(() => {
    if (editor && value !== lastEmitted.current) {
      editor.commands.setContent(value, {
        contentType: "markdown",
        emitUpdate: false,
      });
      lastEmitted.current = value;
    }
  }, [editor, value]);
  useEffect(() => {
    editor?.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        attributes: {
          role: "textbox",
          "aria-label": "Message Codex",
          "aria-multiline": "true",
          "data-placeholder": placeholder,
        },
      },
    });
  }, [editor, placeholder]);
  return (
    <div className="codex-markdown-editor">
      <EditorContent editor={editor} />
    </div>
  );
}
