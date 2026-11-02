import { File, FileSpreadsheet, FileText, Image } from "lucide-react";
import type { CodexAttachment } from "../../shared/codex";

export function ChatAttachmentList({
  attachments,
  onOpen,
}: {
  attachments: CodexAttachment[];
  onOpen(id: string): void;
}) {
  if (!attachments.length) return null;
  return (
    <div
      className="codex-message-attachments"
      role="group"
      aria-label="Attachments"
    >
      {attachments.map((attachment) => {
        const Icon =
          attachment.kind === "image"
            ? Image
            : /\.(xlsx?|xlsm|xlsb|csv|tsv|ods)$/i.test(attachment.name)
              ? FileSpreadsheet
              : /\.(pdf|docx?|txt|md|rtf|odt)$/i.test(attachment.name)
                ? FileText
                : File;
        return (
          <button
            className="codex-message-attachment"
            type="button"
            key={attachment.id}
            title={`Open ${attachment.name} in the default app`}
            aria-label={`Open ${attachment.name}`}
            onClick={() => onOpen(attachment.id)}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{attachment.name}</span>
          </button>
        );
      })}
    </div>
  );
}
