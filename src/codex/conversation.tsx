import codexLogo from "../../assets/codex-colored.svg";
import { useEffect, useRef, useState } from "react";
import { Copy, ImagePlus, Loader2, Send, Square, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import {
  codexIsActive,
  type CodexAttachment,
  type CodexPendingRequest,
  type CodexThread,
  type CodexThreadPage,
} from "../../shared/codex";
import { codexApi, errorMessage } from "./api";
import { PreferencesEditor, useCodexModels } from "./preferences";

function RequestCard({
  request,
  disabled,
  answer,
  allowApproval,
  preview,
}: {
  request: CodexPendingRequest;
  disabled: boolean;
  allowApproval: boolean;
  preview?: string;
  answer: (answers?: Record<string, string>, approve?: boolean) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const permissionDetails = Object.fromEntries(
    [
      "cwd",
      "grantRoot",
      "additionalPermissions",
      "networkApprovalContext",
      "permissions",
    ]
      .filter(
        (key) =>
          request.params[key] !== undefined && request.params[key] !== null,
      )
      .map((key) => [key, request.params[key]]),
  );
  return (
    <section
      className="codex-request"
      aria-label={request.questions ? "Codex questions" : "Codex approval"}
    >
      {request.questions ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            answer(answers);
          }}
        >
          {request.questions.map((q) => (
            <fieldset key={q.id}>
              <legend>
                {q.header ? `${q.header}: ` : ""}
                {q.question}
              </legend>
              <div className="codex-answer-options">
                {q.options.map((o) => (
                  <button
                    type="button"
                    key={o.label}
                    className={`ghost-button ${answers[q.id] === o.label ? "active" : ""}`}
                    title={o.description}
                    disabled={disabled}
                    onClick={() => setAnswers({ ...answers, [q.id]: o.label })}
                  >
                    {o.label}
                    {o.description && <small>{o.description}</small>}
                  </button>
                ))}
              </div>
              {q.secret ? (
                <input
                  type="password"
                  aria-label={q.question}
                  value={answers[q.id] ?? ""}
                  onChange={(event) =>
                    setAnswers({ ...answers, [q.id]: event.target.value })
                  }
                />
              ) : (
                <textarea
                  aria-label={q.question}
                  placeholder="Your answer"
                  value={answers[q.id] ?? ""}
                  onChange={(event) =>
                    setAnswers({ ...answers, [q.id]: event.target.value })
                  }
                />
              )}
            </fieldset>
          ))}
          <button
            className="ghost-button"
            type="submit"
            disabled={
              disabled || request.questions.some((q) => !answers[q.id]?.trim())
            }
          >
            Answer and continue
          </button>
        </form>
      ) : (
        <>
          <h3>Approval required</h3>
          <p>
            {String(
              request.params.reason ?? "Codex needs permission to continue.",
            )}
          </p>
          <pre>
            {[
              typeof request.params.command === "string"
                ? request.params.command
                : preview || "Grant the requested access",
              Object.keys(permissionDetails).length
                ? JSON.stringify(permissionDetails, null, 2)
                : "",
            ]
              .filter(Boolean)
              .join("\n\n")}
          </pre>
          <div className="codex-actions">
            <button
              className="ghost-button"
              disabled={disabled}
              onClick={() => answer(undefined, false)}
            >
              Decline
            </button>
            <button
              className="ghost-button"
              disabled={disabled || !allowApproval}
              title={
                allowApproval
                  ? undefined
                  : "This thread's policy does not allow additional permissions"
              }
              onClick={() => answer(undefined, true)}
            >
              Approve once
            </button>
          </div>
        </>
      )}
    </section>
  );
}
export function CodexConversation({
  repositoryId,
  id,
  loading,
  onConfigure,
}: {
  repositoryId: string;
  id?: string;
  loading: boolean;
  onConfigure: () => void;
}) {
  const [page, setPage] = useState<CodexThreadPage | null>(null),
    [error, setError] = useState("");
  const [draft, setDraft] = useState(""),
    [attachments, setAttachments] = useState<CodexAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [editingQueue, setEditingQueue] = useState<string | null>(null),
    [queueText, setQueueText] = useState("");
  const { models } = useCodexModels();
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const draftRef = useRef({ text: "", attachments: [] as CodexAttachment[] });
  const loaded = useRef(false),
    revision = useRef(0),
    alive = useRef(true);
  const scroll = useRef<HTMLDivElement>(null),
    follow = useRef(true);
  const thread = page?.thread;
  const itemLabels: Record<string, string> = {
    commandExecution: "Command",
    fileChange: "File changes",
    mcpToolCall: "Tool call",
    dynamicToolCall: "Tool call",
    webSearch: "Web search",
  };
  const activeSettings =
    thread && codexIsActive(thread)
      ? (thread.activeSettings ?? thread.settings)
      : thread?.settings;
  const args = { repositoryId, id: id ?? "" };
  useEffect(() => {
    alive.current = true;
    loaded.current = false;
    setPage(null);
    setError("");
    setDraft("");
    setAttachments([]);
    follow.current = true;
    if (!id) return;
    const refresh = async () => {
      const requestRevision = ++revision.current;
      try {
        const result = await codexApi().request("thread", { repositoryId, id });
        if (!alive.current || requestRevision !== revision.current) return;
        setPage((previous) => {
          if (!previous || previous.thread.id !== id) return result;
          const older = previous.thread.items.filter(
            (item) =>
              !result.thread.items.some((entry) => entry.id === item.id),
          );
          return {
            thread: {
              ...result.thread,
              items: [...older, ...result.thread.items],
            },
            before:
              previous.before === null
                ? null
                : Math.min(previous.before, result.before ?? 0) || null,
          };
        });
        if (!loaded.current) {
          loaded.current = true;
          draftRef.current = {
            text: result.thread.draft,
            attachments: result.thread.draftAttachments,
          };
          setDraft(result.thread.draft);
          setAttachments(result.thread.draftAttachments);
        }
      } catch (e) {
        if (alive.current) setError(errorMessage(e));
      }
    };
    void refresh();
    const unsubscribe = codexApi().onChanged((change) => {
      if (change.threadId === id || !change.threadId) void refresh();
    });
    return () => {
      alive.current = false;
      ++revision.current;
      unsubscribe();
      if (draftTimer.current) {
        clearTimeout(draftTimer.current);
        draftTimer.current = undefined;
        const saved = draftRef.current;
        void codexApi()
          .request("update", {
            repositoryId,
            id,
            draft: saved.text,
            draftAttachments: saved.attachments,
          })
          .catch(() => undefined);
      }
    };
  }, [repositoryId, id]);
  useEffect(() => {
    if (follow.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [page?.thread.items, page?.thread.requests]);
  const saveDraft = (text: string, images: CodexAttachment[]) => {
    setDraft(text);
    setAttachments(images);
    draftRef.current = { text, attachments: images };
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      draftTimer.current = undefined;
      if (id)
        void codexApi()
          .request("update", {
            repositoryId,
            id,
            draft: text,
            draftAttachments: images,
          })
          .catch((e) => {
            if (alive.current) setError(errorMessage(e));
          });
    }, 250);
  };
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const send = () =>
    void run(async () => {
      if (draftTimer.current) {
        clearTimeout(draftTimer.current);
        draftTimer.current = undefined;
      }
      // Persist before transport calls so timeout/restart cannot lose the user's message.
      await codexApi().request("update", {
        ...args,
        draft,
        draftAttachments: attachments,
      });
      await codexApi().request("send", { ...args, text: draft, attachments });
      if (alive.current) {
        draftRef.current = { text: "", attachments: [] };
        setDraft("");
        setAttachments([]);
        follow.current = true;
      }
    });
  const markdown = (value: string) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={{
        a: ({ href, children }) => (
          <a
            href={href}
            onClick={(event) => {
              event.preventDefault();
              if (href && /^https?:\/\//.test(href))
                void codexApi()
                  .request("openLink", { url: href })
                  .catch((e) => setError(errorMessage(e)));
            }}
          >
            {children}
          </a>
        ),
        img: ({ alt }) => <span>[Image: {alt || "attachment"}]</span>,
      }}
    >
      {value}
    </ReactMarkdown>
  );
  if (!id)
    return (
      <div className="codex-empty">
        <p>Select a thread or create a new one.</p>
        <button
          className="ghost-button"
          onClick={onConfigure}
          disabled={loading}
        >
          Configure project
        </button>
      </div>
    );
  if (!thread)
    return (
      <div className="codex-empty">
        {error ? (
          <p role="alert">{error}</p>
        ) : (
          <Loader2 className="spin" size={20} />
        )}
      </div>
    );
  return (
    <div className="codex-conversation">
      <div className="codex-conversation-toolbar">
        <span className={`codex-state ${thread.state}`}>
          {thread.state === "waiting" ? "Needs input" : thread.state}
        </span>
        <span className="codex-muted">
          {activeSettings?.mode === "plan"
            ? "Read-only"
            : activeSettings?.permissions === "full"
              ? "Full access"
              : activeSettings?.permissions === "strict"
                ? "Strict sandbox"
                : "Ask when needed"}
        </span>
        <div className="codex-actions">
          {codexIsActive(thread) && (
            <button
              className="ghost-button"
              title="Stop the current turn and pause queued messages"
              onClick={() =>
                void run(async () => {
                  await codexApi().request("stop", args);
                })
              }
            >
              <Square size={12} />
              Stop
            </button>
          )}
        </div>
      </div>
      <div
        className="codex-transcript"
        ref={scroll}
        onScroll={() => {
          const element = scroll.current;
          if (element)
            follow.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              60;
        }}
      >
        {page.before !== null && (
          <button
            className="ghost-button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const older = await codexApi().request("thread", {
                  ...args,
                  before: page.before!,
                });
                follow.current = false;
                setPage((current) =>
                  current
                    ? {
                        thread: {
                          ...current.thread,
                          items: [
                            ...older.thread.items.filter(
                              (item) =>
                                !current.thread.items.some(
                                  (entry) => entry.id === item.id,
                                ),
                            ),
                            ...current.thread.items,
                          ],
                        },
                        before: older.before,
                      }
                    : older,
                );
              })
            }
          >
            Load earlier activity
          </button>
        )}
        {!thread.items.length && (
          <div className="codex-start-note">
            <img
              className="codex-start-logo"
              src={codexLogo}
              alt="Codex"
              width={96}
              height={96}
            />
            <p>
              A separate worktree will be created from committed HEAD when you
              send the first message. Uncommitted changes in the configured
              checkout are excluded.
            </p>
          </div>
        )}
        {thread.items.map((item) => (
          <article className={`codex-item ${item.kind}`} key={item.id}>
            <div className="codex-item-heading">
              <span>
                {item.kind === "userMessage"
                  ? "You"
                  : item.kind === "agentMessage"
                    ? "Codex"
                    : (itemLabels[item.kind] ?? item.kind)}
                {item.status ? ` · ${item.status}` : ""}
              </span>
              <button
                className="icon-button"
                aria-label="Copy message"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(item.text)
                    .catch((e) => setError(errorMessage(e)))
                }
              >
                <Copy size={12} />
              </button>
            </div>
            {["agentMessage", "userMessage", "plan"].includes(item.kind) ? (
              <div className="markdown-body">{markdown(item.text)}</div>
            ) : (
              <details>
                <summary>
                  {item.text.split("\n")[0]?.slice(0, 160) || "Tool activity"}
                </summary>
                <pre>{item.text}</pre>
              </details>
            )}
          </article>
        ))}
        {thread.requests.map((request) => (
          <RequestCard
            key={request.id}
            request={request}
            disabled={busy}
            allowApproval={
              activeSettings?.mode !== "plan" &&
              activeSettings?.permissions !== "strict"
            }
            preview={
              request.method === "item/fileChange/requestApproval"
                ? thread.items.find((item) => item.id === request.params.itemId)
                    ?.text
                : undefined
            }
            answer={(answers, approve) =>
              void run(async () => {
                await codexApi().request("answer", {
                  ...args,
                  requestId: request.id,
                  answers,
                  approve,
                });
              })
            }
          />
        ))}
        {(thread.error || error) && (
          <div className="inline-error" role="alert">
            {error || thread.error}
          </div>
        )}
      </div>
      {thread.queue.length > 0 && (
        <section className="codex-queue" aria-label="Queued messages">
          <div className="codex-item-heading">
            <span>Queued messages{thread.queuePaused ? " · Paused" : ""}</span>
            {thread.queuePaused && (
              <button
                className="ghost-button"
                disabled={busy || thread.archived}
                onClick={() =>
                  void run(async () => {
                    await codexApi().request("queue", {
                      ...args,
                      action: "resume",
                    });
                  })
                }
              >
                Resume queue
              </button>
            )}
          </div>
          {thread.queue.map((message) => (
            <div key={message.id}>
              {editingQueue === message.id ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () => {
                      await codexApi().request("queue", {
                        ...args,
                        action: "edit",
                        messageId: message.id,
                        text: queueText,
                      });
                      setEditingQueue(null);
                    });
                  }}
                >
                  <textarea
                    aria-label="Edit queued message"
                    value={queueText}
                    onChange={(event) => setQueueText(event.target.value)}
                  />
                  <button
                    className="ghost-button"
                    type="submit"
                    disabled={busy || thread.archived}
                  >
                    Save
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => setEditingQueue(null)}
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="codex-queued-message">
                  <span>{message.text || "Image attachments"}</span>
                  <button
                    className="ghost-button"
                    disabled={busy || thread.archived}
                    onClick={() => {
                      setEditingQueue(message.id);
                      setQueueText(message.text);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Remove queued message"
                    disabled={busy || thread.archived}
                    onClick={() =>
                      void run(async () => {
                        await codexApi().request("queue", {
                          ...args,
                          action: "remove",
                          messageId: message.id,
                        });
                      })
                    }
                  >
                    <X size={13} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}
      {thread.archived ? (
        <div className="codex-archived">
          This thread is archived. Restore it from the thread list to continue.
        </div>
      ) : (
        <div className="codex-composer">
          <details className="codex-thread-settings">
            <summary>
              {thread.settings.model} · {thread.settings.effort} ·{" "}
              {thread.settings.mode === "plan" ? "Plan" : "Implement"} ·{" "}
              {thread.settings.followUp === "steer" ? "Steer" : "Queue"}
            </summary>
            <PreferencesEditor
              compact
              value={thread.settings}
              models={models}
              onChange={(settings) =>
                void run(async () => {
                  await codexApi().request("update", {
                    ...args,
                    settings: settings as CodexThread["settings"],
                  });
                })
              }
            />
            <small>
              Changes apply to the next turn. Permissions:{" "}
              {thread.settings.permissions}.
            </small>
          </details>
          <textarea
            aria-label="Message Codex"
            placeholder={
              thread.requests.length
                ? "Answer Codex's request above to continue"
                : thread.state === "running"
                  ? thread.settings.followUp === "steer"
                    ? "Guide the active turn…"
                    : "Queue a follow-up…"
                  : "Ask Codex…"
            }
            value={draft}
            disabled={busy}
            onChange={(event) => saveDraft(event.target.value, attachments)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                if (
                  !busy &&
                  !thread.requests.length &&
                  (draft.trim() || attachments.length)
                )
                  send();
              }
            }}
          />
          {attachments.length > 0 && (
            <div className="codex-attachments">
              {attachments.map((a) => (
                <span key={a.id}>
                  {a.name}
                  <button
                    className="icon-button"
                    aria-label={`Remove ${a.name}`}
                    onClick={() =>
                      saveDraft(
                        draft,
                        attachments.filter((entry) => entry.id !== a.id),
                      )
                    }
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="codex-composer-actions">
            <button
              className="icon-button"
              title="Attach images"
              aria-label="Attach images"
              disabled={busy || attachments.length >= 20}
              onClick={() =>
                void run(async () => {
                  const added = await codexApi().request("attach", args);
                  saveDraft(draft, [...attachments, ...added].slice(0, 20));
                })
              }
            >
              <ImagePlus size={16} />
            </button>
            <small>Enter to send · Shift+Enter for a new line</small>
            <button
              className="ghost-button"
              disabled={
                busy ||
                thread.state === "starting" ||
                thread.requests.length > 0 ||
                (!draft.trim() && !attachments.length)
              }
              onClick={send}
            >
              {busy ? (
                <Loader2 className="spin" size={14} />
              ) : (
                <Send size={14} />
              )}
              {thread.state === "running"
                ? thread.settings.followUp === "queue"
                  ? "Queue"
                  : "Steer"
                : ["interrupted", "failed"].includes(thread.state)
                  ? "Resume"
                  : "Send"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
