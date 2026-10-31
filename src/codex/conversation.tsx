import { EnvironmentPicker } from "./environment-picker";
import codexLogo from "../../assets/codex-colored.svg";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ImagePlus, Loader2, Send, Square, X } from "lucide-react";
import { TranscriptView } from "./transcript-view";
import { ComposerEditor } from "./composer-editor";
import {
  codexIsActive,
  type CodexSendShortcut,
  type CodexAttachment,
  type CodexPendingRequest,
  type CodexThread,
  type CodexThreadPage,
} from "../../shared/codex";
import { codexApi, errorMessage } from "./api";
import { AccessPicker } from "./access-picker";
import { ModelPicker } from "./model-picker";
import { useCodexModels } from "./preferences";

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
  quickActions,
}: {
  repositoryId: string;
  id?: string;
  loading: boolean;
  onConfigure: () => void;
  quickActions?: ReactNode;
}) {
  const [page, setPage] = useState<CodexThreadPage | null>(null),
    [error, setError] = useState("");
  const [draft, setDraft] = useState(""),
    [attachments, setAttachments] = useState<CodexAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [sendShortcut, setSendShortcut] = useState<CodexSendShortcut>("enter");
  useEffect(() => {
    let mounted = true;
    const refresh = () =>
      void codexApi()
        .request("configuration", {})
        .then((configuration) => {
          if (mounted) setSendShortcut(configuration?.sendShortcut ?? "enter");
        })
        .catch((error) => {
          if (mounted) setError(errorMessage(error));
        });
    refresh();
    const unsubscribe = codexApi().onChanged((change) => {
      if (!change.repositoryId && !change.threadId) refresh();
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);
  const [editingMessage, setEditingMessage] = useState<{
    id: string;
    previous: { text: string; attachments: CodexAttachment[] };
  } | null>(null);
  const composer = useRef<HTMLDivElement>(null);
  const [editingQueue, setEditingQueue] = useState<string | null>(null),
    [queueText, setQueueText] = useState("");
  const { models } = useCodexModels(
    repositoryId,
    id,
    page?.thread.environment?.id,
    undefined,
    page?.thread.accountId,
  );
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const draftRef = useRef({ text: "", attachments: [] as CodexAttachment[] });
  const loaded = useRef(false),
    revision = useRef(0),
    alive = useRef(true);
  const scroll = useRef<HTMLDivElement>(null),
    follow = useRef(true);
  const thread = page?.thread;
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
    setEditingMessage(null);
    follow.current = true;
    if (!id) return;
    const refresh = async () => {
      const requestRevision = ++revision.current;
      try {
        const result = await codexApi().request("thread", { repositoryId, id });
        if (!alive.current || requestRevision !== revision.current) return;
        setPage((previous) => {
          if (
            !previous ||
            previous.thread.id !== id ||
            previous.thread.historyRevision !== result.thread.historyRevision
          )
            return result;
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
          if (result.thread.replacement)
            setEditingMessage({
              id: result.thread.replacement.itemId,
              previous: {
                text: result.thread.draft,
                attachments: result.thread.draftAttachments,
              },
            });
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
      if (editingMessage)
        await codexApi().request("replaceMessage", {
          ...args,
          messageId: editingMessage.id,
          text: draft,
          attachments,
        });
      else
        await codexApi().request("send", { ...args, text: draft, attachments });
      if (alive.current) {
        draftRef.current = { text: "", attachments: [] };
        setDraft("");
        setAttachments([]);
        setEditingMessage(null);
        follow.current = true;
      }
    });
  const canSend =
    !busy &&
    thread &&
    thread.state !== "starting" &&
    !thread.requests.length &&
    (!editingMessage || (!codexIsActive(thread) && !thread.queue.length)) &&
    Boolean(draft.trim() || attachments.length);
  const addFiles = (files: File[]) => {
    if (!files.length || busy || !id || thread?.archived) return;
    void run(async () => {
      if (thread?.environment)
        throw new Error("File transfer is unavailable for remote threads.");
      if (attachments.length + files.length > 20)
        throw new Error("Attach up to 20 files per message.");
      const api = codexApi();
      if (!api.attachFiles)
        throw new Error("File drop is unavailable. Use the attachment picker.");
      const added = await api.attachFiles(args, files);
      saveDraft(draftRef.current.text, [
        ...draftRef.current.attachments,
        ...added,
      ]);
    });
  };
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
      {thread.items.length > 0 && (
        <EnvironmentPicker
          thread={thread}
          onConfigure={onConfigure}
          onChange={async () =>
            setPage(await codexApi().request("thread", args))
          }
        />
      )}
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
        {thread.sourceHome && (
          <p className="codex-external-note">
            Continuing the original Codex thread in{" "}
            <code>{thread.worktree}</code>. Uses your Codex app/CLI account;
            Forge's selected model and permissions apply to new turns. This
            folder may be shared with other threads. Finish or stop work in
            Codex before sending here.
          </p>
        )}
        {thread.historyWarning && (
          <p className="codex-external-note">{thread.historyWarning}</p>
        )}
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
              {thread.sourceHome
                ? "Send a message to resume the original Codex thread in its existing working folder. Codex retains its stored conversation context."
                : thread.worktree
                  ? "Send a message to work with Codex in this chat’s checkout."
                  : "A separate worktree will be created from committed HEAD when you send the first message. Uncommitted changes in the configured checkout are excluded."}
            </p>
            <EnvironmentPicker
              thread={thread}
              onConfigure={onConfigure}
              onChange={async () =>
                setPage(await codexApi().request("thread", args))
              }
            />
          </div>
        )}
        <TranscriptView
          thread={thread}
          onError={setError}
          editable={
            !busy &&
            !thread.archived &&
            !codexIsActive(thread) &&
            !thread.queue.length
          }
          onEdit={(item) => {
            const previous = {
              text: draftRef.current.text,
              attachments: [...draftRef.current.attachments],
            };
            setEditingMessage(
              (current) => current ?? { id: item.id, previous },
            );
            saveDraft(item.text, []);
            requestAnimationFrame(() =>
              composer.current
                ?.querySelector<HTMLElement>('[contenteditable="true"]')
                ?.focus(),
            );
          }}
        />
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
                  <span>{message.text || "Attachments"}</span>
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
        <div
          className="codex-composer"
          ref={composer}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files")) {
              event.preventDefault();
              event.dataTransfer.dropEffect = busy ? "none" : "copy";
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            addFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <div className="codex-composer-tools">
            <div className="codex-composer-git">{quickActions}</div>
            <div
              className="codex-composer-preferences"
              aria-label="Model and access"
            >
              <ModelPicker
                key={thread.id}
                value={thread.settings}
                models={models}
                disabled={busy}
                onChange={(settings) =>
                  void run(async () => {
                    await codexApi().request("update", { ...args, settings });
                  })
                }
              />
              <AccessPicker
                value={
                  activeSettings?.permissions ?? thread.settings.permissions
                }
                readOnly={activeSettings?.mode === "plan"}
                disabled={
                  busy || codexIsActive(thread) || Boolean(thread.replacement)
                }
                onChange={(permissions) =>
                  void run(async () => {
                    await codexApi().request("update", {
                      ...args,
                      settings: { ...thread.settings, permissions },
                    });
                  })
                }
              />
            </div>
            <div className="codex-composer-status" aria-label="Thread status">
              <span className={`codex-state ${thread.state}`}>
                {thread.state === "waiting" ? "Needs input" : thread.state}
              </span>
            </div>
          </div>
          {editingMessage && thread.replacement && !busy && (
            <p className="codex-muted">Replacement pending · Retry to finish</p>
          )}
          <div className="codex-input">
            <button
              className="icon-button codex-attach-button"
              title={
                thread.environment
                  ? "File transfer is unavailable for remote threads"
                  : "Attach documents or images"
              }
              aria-label="Attach documents or images"
              disabled={
                busy ||
                Boolean(thread.environment) ||
                Boolean(thread.replacement) ||
                attachments.length >= 20
              }
              onClick={() =>
                void run(async () => {
                  const added = await codexApi().request("attach", args);
                  if (draftRef.current.attachments.length + added.length > 20)
                    throw new Error("Attach up to 20 files per message.");
                  saveDraft(draftRef.current.text, [
                    ...draftRef.current.attachments,
                    ...added,
                  ]);
                })
              }
            >
              <ImagePlus size={16} />
            </button>
            <ComposerEditor
              key={thread.id}
              value={draft}
              sendShortcut={sendShortcut}
              disabled={busy || Boolean(thread.replacement)}
              placeholder={
                thread.requests.length
                  ? "Answer Codex's request above to continue"
                  : thread.state === "running"
                    ? "Guide the active turn…"
                    : "Ask Codex…"
              }
              onChange={(value) => saveDraft(value, attachments)}
              onSend={() => {
                if (canSend) send();
              }}
            />
            <div className="codex-submit-actions">
              {editingMessage && (
                <button
                  className="ghost-button codex-cancel-edit"
                  disabled={busy || Boolean(thread.replacement)}
                  onClick={() => {
                    saveDraft(
                      editingMessage.previous.text,
                      editingMessage.previous.attachments,
                    );
                    setEditingMessage(null);
                  }}
                >
                  Cancel
                </button>
              )}
              <button
                className="icon-button codex-send-button"
                type="button"
                aria-label={
                  codexIsActive(thread)
                    ? "Stop"
                    : editingMessage
                      ? "Replace response"
                      : "Send"
                }
                title={
                  codexIsActive(thread)
                    ? "Stop the current turn and pause queued messages"
                    : editingMessage
                      ? "Replace response"
                      : "Send"
                }
                disabled={codexIsActive(thread) ? stopping : !canSend}
                onClick={() => {
                  if (!codexIsActive(thread)) {
                    send();
                    return;
                  }
                  setStopping(true);
                  setError("");
                  void codexApi()
                    .request("stop", args)
                    .catch((e) => {
                      if (alive.current) setError(errorMessage(e));
                    })
                    .finally(() => {
                      if (alive.current) setStopping(false);
                    });
                }}
              >
                {codexIsActive(thread) ? (
                  <Square size={14} fill="currentColor" />
                ) : busy ? (
                  <Loader2 className="spin" size={16} />
                ) : (
                  <Send size={16} />
                )}
              </button>
            </div>
          </div>
          {attachments.length > 0 && (
            <div className="codex-attachments">
              {attachments.map((a) => (
                <span key={a.id}>
                  {a.name}
                  <button
                    className="icon-button"
                    aria-label={`Remove ${a.name}`}
                    disabled={busy || Boolean(thread.replacement)}
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
        </div>
      )}
    </div>
  );
}
