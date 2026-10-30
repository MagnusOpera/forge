import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";

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

export function ComposerEditor({
  value,
  onChange,
  onSend,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
  placeholder: string;
}) {
  const callbacks = useRef({ onChange, onSend });
  callbacks.current = { onChange, onSend };
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
        return editor
          ? handleComposerKeyDown(editor, event, callbacks.current.onSend)
          : false;
      },
      // File drops belong to the surrounding attachment intake, never the document.
      handleDrop: (_view, event) => Boolean(event.dataTransfer?.files.length),
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (
          !text ||
          view.state.selection.$from.parent.type.name === "codeBlock"
        )
          return false;
        event.preventDefault();
        // Parse plain Markdown pastes, just like typing Markdown input rules.
        editor?.commands.insertContent(text, { contentType: "markdown" });
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      const markdown = editor.getMarkdown();
      lastEmitted.current = markdown;
      callbacks.current.onChange(markdown);
    },
  });
  useEffect(() => {
    editor?.setEditable(!disabled);
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
