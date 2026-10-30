import { useEffect, useState } from "react";
import { ChevronRight, Copy, Pencil } from "lucide-react";
import {
  codexIsActive,
  latestCodexUserMessage,
  type CodexItem,
  type CodexThread,
  type CodexTurnTiming,
} from "../../shared/codex";
import { CodexMarkdown } from "./markdown";
import { errorMessage } from "./api";
import { groupTranscript, workedDuration } from "./transcript";
const labels: Record<string, string> = {
  agentMessage: "Update",
  reasoning: "Thinking summary",
  plan: "Plan",
  commandExecution: "Command",
  fileChange: "File changes",
  mcpToolCall: "Tool call",
  dynamicToolCall: "Tool call",
  webSearch: "Web search",
};

function WorkActivity({
  items,
  timing,
  active,
  markdown,
}: {
  items: CodexItem[];
  timing?: CodexTurnTiming;
  active: boolean;
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
          {active ? "Working" : "Worked"}
          {elapsed !== undefined
            ? ` for ${workedDuration(elapsed)}`
            : active
              ? "…"
              : ""}
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
            {["agentMessage", "plan", "reasoning"].includes(item.kind) ? (
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
}: {
  thread: Pick<
    CodexThread,
    "id" | "repositoryId" | "state" | "turnId" | "turns" | "items"
  >;
  onError: (message: string) => void;
  onEdit?: (item: CodexItem) => void;
  editable?: boolean;
}) {
  const entries = groupTranscript(thread.items);
  const latestUser = latestCodexUserMessage(thread.items);
  const lastActivity = entries
    .filter((entry) => entry.type === "activity")
    .at(-1);
  const markdown = (text: string) => (
    <CodexMarkdown
      text={text}
      repositoryId={thread.repositoryId}
      id={thread.id}
      onError={onError}
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
              active={
                codexIsActive(thread) &&
                (entry.turnId
                  ? entry.turnId === thread.turnId
                  : entry === lastActivity)
              }
              markdown={markdown}
            />
          );
        const item = entry.item;
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
            </div>
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
    </div>
  );
}
