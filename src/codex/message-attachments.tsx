import { File, FileSpreadsheet, FileText, Image } from "lucide-react";
import type { CodexItem, CodexMessageAttachment } from "../../shared/codex";
import { codexApi, errorMessage } from "./api";

function attachmentsFor(item: CodexItem): CodexMessageAttachment[] {
  if (item.attachments) return item.attachments;
  // Older caches may still have image paths without structured attachment metadata.
  return (item.images ?? []).map((href) => {
    let name = "Attached image";
    try { name = decodeURIComponent(new URL(href).pathname.split("/").at(-1)!) || name; } catch {}
    return { name, href, kind: "image" };
  });
}

export function MessageAttachments({ item, repositoryId, id, onError }: {
  item: CodexItem;
  repositoryId: string;
  id: string;
  onError: (message: string) => void;
}) {
  const attachments = attachmentsFor(item);
  if (!attachments.length) return null;
  return (
    <div className="codex-message-attachments" role="group" aria-label="Attachments">
      {attachments.map((attachment, index) => {
        const Icon = attachment.kind === "image" ? Image
          : /\.(xlsx?|xlsm|xlsb|csv|tsv|ods)$/i.test(attachment.name) ? FileSpreadsheet
          : /\.(pdf|docx?|txt|md|rtf|odt)$/i.test(attachment.name) ? FileText : File;
        return (
          <button
            type="button"
            className="codex-message-attachment"
            key={`${index}:${attachment.href}`}
            title={`Open ${attachment.name} in the default app`}
            aria-label={`Open ${attachment.name}`}
            onClick={() => void codexApi().request("outputFile", {
              repositoryId, id, href: attachment.href, action: "open",
            }).catch((error) => onError(errorMessage(error)))}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{attachment.name}</span>
          </button>
        );
      })}
    </div>
  );
}
