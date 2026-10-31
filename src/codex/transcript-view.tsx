import { useEffect, useMemo, useState } from "react";
import { displayPath } from "../paths";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Copy, FileDiff, Pencil } from "lucide-react";
import {
  codexIsActive,
  latestCodexUserMessage,
  type CodexItem,
  type CodexThread,
  type CodexTurnTiming,
  type CodexFileChange,
} from "../../shared/codex";
import { CodexMarkdown } from "./markdown";
import { MessageAttachments } from "./message-attachments";
import { errorMessage } from "./api";
import { editedFiles, groupTranscript, workedDuration } from "./transcript";
import { CodexDiffDialog } from "./diff-dialog";
const labels: Record<string, string> = {
  reasoning: "Thinking summary",
  plan: "Plan",
  commandExecution: "Command",
  fileChange: "File changes",
  mcpToolCall: "Tool call",
  dynamicToolCall: "Tool call",
  webSearch: "Web search",
};

function EditedFiles({ files, onOpen, remote }: {
  files: ReturnType<typeof editedFiles>;
  onOpen: (filePath?: string) => void;
  remote: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!files.length) return null;
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return (
    <section className="codex-edited-files" aria-label="Edited files">
      <header>
        <FileDiff size={20} aria-hidden="true" />
        <div>
          <strong>Edited {files.length} {files.length === 1 ? "file" : "files"}</strong>
          <div><span className="diff-stat positive">+{additions}</span>{" "}<span className="diff-stat negative">-{deletions}</span></div>
        </div>
        <button className="ghost-button" onClick={() => onOpen()}>View changes</button>
      </header>
      {(expanded ? files : files.slice(0, 3)).map((file) => (
        <button className="codex-edited-file" key={file.path} onClick={() => onOpen(file.path)}>
          <span>{displayPath(file.path, remote)}</span>
          <span><span className="diff-stat positive">+{file.additions}</span>{" "}<span className="diff-stat negative">-{file.deletions}</span></span>
        </button>
      ))}
      {files.length > 3 && (
        <button className="codex-edited-file codex-edited-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show fewer files" : `Show ${files.length - 3} more files`}<ChevronDown size={14} />
        </button>
      )}
    </section>
  );
}

function WorkActivity({
  items,
  timing,
  active,
  showTiming,
  markdown,
}: {
  items: CodexItem[];
  timing?: CodexTurnTiming;
  active: boolean;
  showTiming: boolean;
  markdown: (text: string) => React.ReactNode;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const elapsed =
    active && timing?.startedAt !== undefined
      ? Math.max(0, now - timing.startedAt)
      : timing?.durationMs;
  return (
    <details className="codex-work-activity">
      <summary>
        <span>
          {showTiming ? active ? "Working" : "Worked" : "Activity"}
          {showTiming && (elapsed !== undefined
            ? ` for ${workedDuration(elapsed)}`
            : active
              ? "…"
              : "")}
        </span>
        <ChevronRight size={14} aria-hidden="true" />
      </summary>
      <div className="codex-work-content">
        {items.map((item) => (
          <section className="codex-work-item" key={item.id}>
            <div className="codex-work-label">
              {labels[item.kind] ?? item.kind}
              {item.status ? ` · ${item.status}` : ""}
            </div>
            {["plan", "reasoning"].includes(item.kind) ? (
              <div className="markdown-body markdown-block compact">
                {markdown(item.text || "No thinking summary was provided.")}
              </div>
            ) : (
              <details>
                <summary>
                  {item.text.split("\n")[0]?.slice(0, 160) || "Tool activity"}
                </summary>
                <pre>{item.text}</pre>
              </details>
            )}
          </section>
        ))}
      </div>
    </details>
  );
}
export function TranscriptView({
  thread,
  onError,
  onEdit,
  editable = true,
  theme = "dark",
}: {
  thread: Pick<
    CodexThread,
    "id" | "repositoryId" | "state" | "turnId" | "turns" | "items" | "environment"
  >;
  onError: (message: string) => void;
  onEdit?: (item: CodexItem) => void;
  editable?: boolean;
  theme?: "light" | "dark";
}) {
  const entries = groupTranscript(thread.items, thread.turns);
  const trailing = entries.at(-1);
  const finalReply = trailing?.type === "message" &&
    trailing.item.turnId === thread.turnId && trailing.item.phase === "final_answer";
  if (codexIsActive(thread) && thread.turnId && !finalReply &&
      !(trailing?.type === "activity" && trailing.turnId === thread.turnId)) {
    entries.push({ type: "activity", id: `active:${thread.turnId}`, turnId: thread.turnId, items: [] });
  }
  const [diff, setDiff] = useState<{ changes: CodexFileChange[]; filePath?: string } | null>(null);
  useEffect(() => setDiff(null), [thread.repositoryId, thread.id]);
  const filesByTurn = useMemo(() => new Map(
    [...new Set(thread.items.map((item) => item.turnId).filter((id): id is string => Boolean(id)))].map((turnId) => [turnId, editedFiles(thread.items, turnId)]),
  ), [thread.items]);
  const lastAnswerByTurn = new Map<string, string>();
  for (const entry of entries)
    if (entry.type === "message" && entry.item.kind === "agentMessage" &&
        entry.item.phase !== "commentary" && entry.item.turnId)
      lastAnswerByTurn.set(entry.item.turnId, entry.item.id);
  const latestUser = latestCodexUserMessage(thread.items);
  const lastActivity = entries
    .filter((entry) => entry.type === "activity")
    .at(-1);
  // Chat messages split tool activity into chronological groups within one turn.
  // Only the latest group owns that turn's duration and live interval.
  const latestActivityByTurn = new Map<string | undefined, typeof lastActivity>();
  for (const entry of entries)
    if (entry.type === "activity") latestActivityByTurn.set(entry.turnId, entry);
  const activeActivity = codexIsActive(thread)
    ? latestActivityByTurn.get(thread.turnId)
    : undefined;
  const markdown = (text: string) => (
    <CodexMarkdown
      text={text}
      repositoryId={thread.repositoryId}
      id={thread.id}
      onError={onError}
      remote={Boolean(thread.environment)}
    />
  );
  return (
    <div className="codex-messages">
      {entries.map((entry) => {
        if (entry.type === "activity")
          return (
            <WorkActivity
              key={entry.id}
              items={entry.items}
              timing={entry.turnId ? thread.turns?.[entry.turnId] : undefined}
              showTiming={entry === latestActivityByTurn.get(entry.turnId)}
              active={entry === activeActivity}
              markdown={markdown}
            />
          );
        const item = entry.item;
        const files = item.kind === "agentMessage" && item.phase !== "commentary" && item.turnId &&
          lastAnswerByTurn.get(item.turnId) === item.id
          ? filesByTurn.get(item.turnId) ?? [] : [];
        const timing = item.turnId ? thread.turns?.[item.turnId] : undefined;
        const timestamp =
          item.createdAt ??
          (item.kind === "userMessage"
            ? timing?.startedAt
            : timing?.completedAt);
        const date =
          timestamp !== undefined && Number.isFinite(timestamp)
            ? new Date(timestamp)
            : undefined;
        return (
          <article
            key={item.id}
            className={`codex-item codex-message ${item.kind}`}
            aria-label={
              item.kind === "userMessage" ? "Your message" : "Codex reply"
            }
          >
            <div className="markdown-body markdown-block compact">
              {markdown(item.text)}
              <MessageAttachments item={item} repositoryId={thread.repositoryId} id={thread.id} onError={onError} />
            </div>
            <EditedFiles files={files} remote={Boolean(thread.environment)} onOpen={(filePath) => setDiff({ changes: files, filePath })} />
            <div className="codex-message-actions">
              {date && Number.isFinite(date.getTime()) && (
                <time
                  dateTime={date.toISOString()}
                  title={date.toLocaleString()}
                >
                  {date.toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </time>
              )}
              <button
                className="icon-button"
                aria-label="Copy message"
                title="Copy message"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(item.text)
                    .catch((error) => onError(errorMessage(error)))
                }
              >
                <Copy size={12} />
              </button>
              {item.id === latestUser?.id && onEdit && (
                <button
                  className="icon-button"
                  aria-label="Edit message"
                  title="Edit message"
                  disabled={!editable}
                  onClick={() => onEdit(item)}
                >
                  <Pencil size={12} />
                </button>
              )}
            </div>
          </article>
        );
      })}
      {diff && createPortal(
        <CodexDiffDialog thread={thread} theme={theme} changes={diff.changes} filePath={diff.filePath} onClose={() => setDiff(null)} />,
        document.querySelector(".app-shell") ?? document.body,
      )}
    </div>
  );
}
