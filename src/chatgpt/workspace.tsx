import { createPortal } from "react-dom";
import { ComposerEditor } from "../codex/composer-editor";
import { ModelPicker } from "../codex/model-picker";
import { WorkActivity } from "../codex/transcript-view";
import { codexApi } from "../codex/api";
import {
  defaultCodexPreferences,
  type CodexAttachment,
  type CodexSendShortcut,
} from "../../shared/codex";
import { ChatAttachmentList } from "./attachments";
import { chatAttachmentData } from "./attachment-data";
import { ChatGeneratedImage } from "./generated-images";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Send,
  Copy,
  ImagePlus,
  Folder,
  Search,
  Loader2,
  MessageSquare,
  Pencil,
  PictureInPicture2,
  Plus,
  Square,
  Trash2,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import type {
  ChatApi,
  ChatProject,
  ChatState,
  ChatThread,
} from "../../shared/chatgpt";
import { DetachablePane, useDetachablePane } from "../detachable-pane";
import { useContentAttachmentShortcut } from "../content-attachment-shortcut";
import "./workspace.css";

const empty: ChatState = {
  projects: [],
  threads: [],
  connected: false,
  models: [],
};
function api(): ChatApi {
  if (!window.forgeChatGpt)
    throw new Error("Chat is available in the Forge desktop app.");
  return window.forgeChatGpt;
}
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Unable to complete the ChatGPT request.";

export function ChatWorkspace({
  active,
  sidebarHost,
  theme,
  accent,
  appearance,
  onActivate,
  onDetachedLayout,
  onResize,
  sidebarCollapsed,
}: {
  active: boolean;
  sidebarHost: HTMLElement | null;
  theme: string;
  accent: string;
  appearance: string;
  onActivate(): void;
  onDetachedLayout(detached: boolean): void;
  onResize(event: React.PointerEvent): void;
  sidebarCollapsed: boolean;
}) {
  "use no memo"; // Preserve live pane refs and async request cleanup.
  const [state, setState] = useState<ChatState>(empty);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [focusRequest, setFocusRequest] = useState(0);
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [detached, setDetached] = useState<Set<string>>(new Set());
  const [projectForm, setProjectForm] = useState<Partial<ChatProject> | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const selectedProject =
    state.projects.find((p) => p.id === projectId) ?? state.projects[0];
  const selected = state.threads.find((t) => t.id === selectedId);
  const selectedDetached = active && detached.has(selectedId);
  const reportDetached = useCallback(
    (id: string, value: boolean) =>
      setDetached((current) => {
        if (current.has(id) === value) return current;
        const next = new Set(current);
        if (value) next.add(id);
        else next.delete(id);
        return next;
      }),
    [],
  );
  useEffect(() => {
    if (selectedId)
      setVisited((current) =>
        current.has(selectedId) ? current : new Set(current).add(selectedId),
      );
  }, [selectedId]);
  useEffect(() => {
    onDetachedLayout(Boolean(selectedDetached));
  }, [selectedDetached, onDetachedLayout]);
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);
  useEffect(() => {
    let live = true;
    const update = (value: ChatState) => {
      if (live) {
        setState(value);
        setLoaded(true);
      }
    };
    let unsubscribe = () => {};
    try {
      unsubscribe = api().onChanged(update);
      void api()
        .request("state", undefined)
        .then(update)

        .catch((e) => {
          if (live) {
            setError(errorText(e));
            setLoaded(true);
          }
        });
    } catch (e) {
      setError(errorText(e));
      setLoaded(true);
    }
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (active)
      void Promise.resolve()
        .then(() => api().request("refreshModels", undefined))
        .catch((e) => setError(errorText(e)));
  }, [active]);
  async function run(work: () => Promise<unknown>) {
    setError("");
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = (text: string) =>
    words.every((word) => text.toLowerCase().includes(word));
  const threadMatches = (thread: ChatThread) =>
    matches([thread.title, ...thread.messages.map((m) => m.text)].join("\n"));
  const projects = state.projects.filter(
    (p) =>
      matches(p.name) ||
      state.threads.some((t) => t.projectId === p.id && threadMatches(t)),
  );
  const threads = state.threads
    .filter(
      (t) =>
        t.projectId === selectedProject?.id &&
        (!words.length ||
          matches(selectedProject?.name ?? "") ||
          threadMatches(t)),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const clearDrag = () => {
    setDragging(null);
    setDragOver(null);
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
    searchButton.current?.focus();
  };
  function selectProject(id: string) {
    setProjectId(id);
    setSelectedId("");
  }
  function removeThread(id: string) {
    void run(async () => {
      await api().request("delete", { id });
      if (selectedId === id) setSelectedId("");
    });
  }
  const displayedError = error || state.error;
  const sidebar = (
    <section className="chatgpt-projects" aria-label="ChatGPT projects">
      <div className="section-title chatgpt-project-heading">
        <Folder size={15} />
        <span>Projects</span>
        <span className="count">{state.projects.length}</span>
        <button
          ref={searchButton}
          className="icon-button"
          title="Search projects and threads"
          aria-label="Search ChatGPT projects and threads"
          aria-expanded={searchOpen}
          aria-controls="chatgpt-project-search"
          onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
        >
          <Search size={16} />
        </button>
        <button
          className="icon-button"
          title="New project"
          aria-label="New ChatGPT project"
          onClick={() => setProjectForm({ name: "", instructions: "" })}
        >
          <Plus size={16} />
        </button>
      </div>
      {searchOpen && (
        <div className="search-box" id="chatgpt-project-search">
          <Search size={15} />
          <input
            ref={searchInput}
            aria-label="Search ChatGPT projects and threads"
            placeholder="Search projects and threads…"
            maxLength={1000}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                closeSearch();
              }
            }}
          />
          <button
            className="icon-button"
            aria-label="Close ChatGPT search"
            onClick={closeSearch}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {displayedError && (
        <div className="chatgpt-error" role="alert">
          {displayedError}
          <button
            className="icon-button"
            aria-label="Dismiss ChatGPT error"
            onClick={() => {
              setError("");
              setState((current) => ({ ...current, error: undefined }));
            }}
          >
            <X size={13} />
          </button>
        </div>
      )}
      {projectForm && (
        <form
          className="chatgpt-project-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const project = await api().request("project", {
                id: projectForm.id,
                name: projectForm.name ?? "",
                instructions: projectForm.instructions ?? "",
              });
              setProjectId(project.id);
              setSelectedId("");
              setProjectForm(null);
            });
          }}
        >
          <label>
            Project name
            <input
              autoFocus
              required
              maxLength={100}
              value={projectForm.name ?? ""}
              onChange={(e) =>
                setProjectForm({ ...projectForm, name: e.target.value })
              }
            />
          </label>
          <label>
            Instructions
            <textarea
              rows={5}
              maxLength={32000}
              value={projectForm.instructions ?? ""}
              onChange={(e) =>
                setProjectForm({
                  ...projectForm,
                  instructions: e.target.value,
                })
              }
              placeholder="Context and instructions for chats in this project"
            />
          </label>
          <div className="chatgpt-actions">
            <button className="text-button" disabled={busy} type="submit">
              Save project
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => setProjectForm(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      <nav
        className="sidebar-scroll chatgpt-project-list"
        aria-label="ChatGPT projects"
        onKeyDown={(e) => {
          if (
            e.target !==
            (e.target as HTMLElement).closest(".chatgpt-project-select")
          )
            return;
          const index = projects.findIndex((p) => p.id === selectedProject?.id);
          if (
            (e.metaKey || e.ctrlKey) &&
            e.shiftKey &&
            ["ArrowUp", "ArrowDown"].includes(e.key)
          ) {
            const next = index + (e.key === "ArrowUp" ? -1 : 1);
            if (next >= 0 && next < projects.length && selectedProject) {
              e.preventDefault();
              void run(() =>
                api().request("reorderProjects", {
                  sourceId: selectedProject.id,
                  targetId: projects[next].id,
                }),
              );
            }
          } else if (["ArrowUp", "ArrowDown"].includes(e.key)) {
            const next = Math.max(
              0,
              Math.min(
                projects.length - 1,
                index + (e.key === "ArrowUp" ? -1 : 1),
              ),
            );
            if (projects[next]) {
              e.preventDefault();
              selectProject(projects[next].id);
              e.currentTarget
                .querySelectorAll<HTMLButtonElement>(".chatgpt-project-select")
                [next]?.focus();
            }
          }
        }}
      >
        <div className="repo-section">
          {projects.map((project) => (
            <div
              key={project.id}
              className={`repo-button-wrap chatgpt-project-row draggable${selectedProject?.id === project.id ? " selected" : ""}${dragging === project.id ? " dragging" : ""}${dragOver === project.id && dragging !== project.id ? " drag-over" : ""}`}
              draggable={!busy && !query.trim()}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", project.id);
                setDragging(project.id);
              }}
              onDragOver={(e) => {
                if (dragging && dragging !== project.id) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOver(project.id);
                }
              }}
              onDragLeave={() => setDragOver(null)}
              onDragEnd={clearDrag}
              onDrop={(e) => {
                e.preventDefault();
                const sourceId = dragging;
                clearDrag();
                if (sourceId && sourceId !== project.id)
                  void run(() =>
                    api().request("reorderProjects", {
                      sourceId,
                      targetId: project.id,
                    }),
                  );
              }}
            >
              <button
                className="repo-button chatgpt-project-select"
                aria-label={`Select project ${project.name}`}
                aria-pressed={selectedProject?.id === project.id}
                title="Drag to reorder; ⌘⇧↑/↓ moves the selected project"
                onClick={() => selectProject(project.id)}
              >
                <span className="repo-name">
                  <span className="repo-short-name">{project.name}</span>
                </span>
                <span className="repo-meta">
                  {
                    state.threads.filter((t) => t.projectId === project.id)
                      .length
                  }
                </span>
              </button>
              <button
                className="star-button"
                aria-label={`Edit project ${project.name}`}
                title="Edit project"
                onClick={() => setProjectForm({ ...project })}
              >
                <Pencil size={13} />
              </button>
              <button
                className="star-button"
                aria-label={`Delete project ${project.name}`}
                title="Delete project"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const deleted = await api().request("deleteProject", {
                      id: project.id,
                    });
                    if (deleted && selectedProject?.id === project.id) {
                      setProjectId("");
                      setSelectedId("");
                    }
                    if (deleted && projectForm?.id === project.id)
                      setProjectForm(null);
                  })
                }
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {!projects.length && (
            <p className="chatgpt-hint">
              {!loaded
                ? "Loading projects…"
                : query
                  ? "No matching projects or threads."
                  : "Create your first project."}
            </p>
          )}
        </div>
      </nav>
    </section>
  );
  return (
    <>
      {active && sidebarHost && createPortal(sidebar, sidebarHost)}
      {active && (
        <section
          className="project-pane chatgpt-threads-pane"
          aria-label="ChatGPT threads"
        >
          <header
            className={`pane-header app-drag${sidebarCollapsed ? " collapsed-project-header" : ""}`}
          >
            <Folder size={16} />
            <strong>{selectedProject?.name ?? "ChatGPT"}</strong>
          </header>
          <div className="chatgpt-threads-toolbar">
            <span>
              Threads <span className="count">{threads.length}</span>
            </span>
            <button
              className="icon-button"
              title="New thread"
              aria-label="New ChatGPT thread"
              disabled={!selectedProject || busy}
              onClick={() =>
                void run(async () => {
                  const thread = await api().request("create", {
                    projectId: selectedProject!.id,
                    model: state.models[0]?.slug ?? "",
                  });
                  setQuery("");
                  setSelectedId(thread.id);
                })
              }
            >
              <Plus size={16} />
            </button>
          </div>
          <nav
            className="chatgpt-thread-list"
            aria-label="ChatGPT threads"
            onKeyDown={(e) => {
              if (
                e.target !==
                (e.target as HTMLElement).closest(".chatgpt-thread-select")
              )
                return;
              const index = threads.findIndex((t) => t.id === selectedId);
              const next =
                e.key === "ArrowDown"
                  ? Math.min(index + 1, threads.length - 1)
                  : e.key === "ArrowUp"
                    ? Math.max(0, index - 1)
                    : -1;
              if (next >= 0) {
                e.preventDefault();
                setSelectedId(threads[next].id);
                e.currentTarget
                  .querySelectorAll<HTMLButtonElement>(".chatgpt-thread-select")
                  [next]?.focus();
              }
            }}
          >
            {threads.map((t) => (
              <div
                className={`repo-button-wrap chatgpt-thread-row${t.id === selectedId ? " selected" : ""}`}
                key={t.id}
              >
                <button
                  className="repo-button chatgpt-thread-select"
                  aria-pressed={t.id === selectedId}
                  onClick={() => {
                    setSelectedId(t.id);
                    setFocusRequest((current) => current + 1);
                  }}
                >
                  <MessageSquare size={14} />
                  <span className="repo-name">
                    <span className="repo-short-name">{t.title}</span>
                  </span>
                  {t.messages.some((m) => m.status === "streaming") ? (
                    <Loader2 className="spin" size={13} />
                  ) : detached.has(t.id) ? (
                    <PictureInPicture2 size={13} />
                  ) : null}
                </button>
                <button
                  className="star-button chatgpt-thread-delete"
                  aria-label={`Delete thread ${t.title}`}
                  title="Delete thread"
                  disabled={
                    busy || t.messages.some((m) => m.status === "streaming")
                  }
                  onClick={() => removeThread(t.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {!threads.length && (
              <p className="chatgpt-hint">
                {!selectedProject
                  ? "Select or create a project in Chat mode."
                  : query
                    ? "No matching threads in this project."
                    : "Create your first thread in this project."}
              </p>
            )}
          </nav>
        </section>
      )}
      {active && !selectedDetached && (
        <div className="resize-handle" onPointerDown={onResize} />
      )}
      {active && !selected && (
        <section className="content-pane chatgpt-empty">
          <MessageSquare size={28} />
          <h2>Chat</h2>
          <p>Select a thread, or create a new one.</p>
          <p className="chatgpt-hint">Your conversations stay in Forge.</p>
        </section>
      )}
      {state.threads
        .filter(
          (t) => t.id === selectedId || visited.has(t.id) || detached.has(t.id),
        )
        .map((thread) => (
          <ChatContent
            key={thread.id}
            thread={thread}
            active={active && selectedId === thread.id}
            focusRequest={focusRequest}
            theme={theme}
            accent={accent}
            appearance={appearance}
            models={state.models}
            connected={state.connected}
            reportDetached={reportDetached}
            onError={setError}
            onSelect={() => {
              onActivate();
              setProjectId(thread.projectId);
              setSelectedId(thread.id);
            }}
            onDelete={() => removeThread(thread.id)}
          />
        ))}
    </>
  );
}

function ChatContent({
  thread,
  focusRequest,
  active,
  theme,
  accent,
  appearance,
  models,
  connected,
  reportDetached,
  onSelect,
  onDelete,
  onError,
}: {
  thread: ChatThread;
  focusRequest: number;
  active: boolean;
  theme: string;
  accent: string;
  appearance: string;
  models: ChatState["models"];
  connected: boolean;
  reportDetached(id: string, detached: boolean): void;
  onSelect(): void;
  onDelete(): void;
  onError(error: string): void;
}) {
  "use no memo"; // Preserve live pane refs and async request cleanup.
  const pane = useDetachablePane({ onReattach: onSelect });
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState("");
  const notify = (message: string) => {
    setLocalError(message);
    onError(message);
  };
  const [preferences, setPreferences] = useState({
    ...defaultCodexPreferences,
    model: thread.model,
    effort: thread.effort ?? "",
    speed: thread.speed ?? "normal",
  });
  const [attachments, setAttachments] = useState<CodexAttachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const importing = useRef(false);
  const [sendShortcut, setSendShortcut] = useState<CodexSendShortcut>("enter");
  useEffect(() => {
    if (!window.forgeCodex) return;
    let mounted = true;
    const refresh = () =>
      void codexApi()
        .request("configuration", {})
        .then((config) => {
          if (mounted) setSendShortcut(config?.sendShortcut ?? "enter");
        })
        .catch(() => {});
    refresh();
    const unsubscribe = codexApi().onChanged((change) => {
      if (!change.repositoryId && !change.threadId) refresh();
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(thread.title);
  const [deletePending, setDeletePending] = useState(false);
  const running =
    sending || thread.messages.some((m) => m.status === "streaming");
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    reportDetached(thread.id, pane.detached);
  }, [thread.id, pane.detached, reportDetached]);
  useEffect(() => {
    if (active && pane.detached) pane.focus();
  }, [active, pane.detached, focusRequest]);
  useEffect(() => {
    if (follow.current)
      scroll.current?.scrollTo?.({ top: scroll.current.scrollHeight });
  }, [thread.messages]);
  useEffect(() => {
    if (pane.error) onError(pane.error);
  }, [pane.error, onError]);
  const chosenModel = models.some((m) => m.slug === preferences.model)
    ? preferences.model
    : (models[0]?.slug ?? "");
  const toggle = () => {
    try {
      if (pane.detached) pane.reattach();
      else pane.detach();
    } catch (e) {
      notify(errorText(e));
    }
  };
  const modelChoices = models.map((m) => ({
    id: m.slug,
    name: m.displayName,
    efforts: m.efforts ?? [],
    defaultEffort: m.defaultEffort ?? "",
    fast: m.fast ?? false,
    images: m.images ?? true,
    isDefault: m.isDefault ?? false,
  }));
  const selectedModel = modelChoices.find((m) => m.id === chosenModel);
  const effort = selectedModel?.efforts.includes(preferences.effort)
    ? preferences.effort
    : "";
  const speed = selectedModel?.fast ? preferences.speed : "normal";
  async function attach(files?: File[]) {
    if (importing.current || running) return;
    importing.current = true;
    setAttaching(true);
    setLocalError("");
    try {
      if (files && attachments.length + files.length > 20)
        throw new Error("Attach up to 20 files per message.");
      const added = files
        ? api().attachFiles
          ? await api().attachFiles!({ id: thread.id }, files)
          : await api().request("attach", {
              id: thread.id,
              files: await chatAttachmentData(files),
            })
        : await api().request("attach", { id: thread.id });
      if (attachments.length + added.length > 20)
        throw new Error("Attach up to 20 files per message.");
      setAttachments((current) => [...current, ...added]);
    } catch (e) {
      notify(errorText(e));
    } finally {
      importing.current = false;
      setAttaching(false);
    }
  }
  async function send() {
    const text = draft.trim();
    if (
      (!text && !attachments.length) ||
      running ||
      importing.current ||
      !connected ||
      !chosenModel
    )
      return;
    setLocalError("");
    setSending(true);
    follow.current = true;
    try {
      await api().request("send", {
        id: thread.id,
        text,
        model: chosenModel,
        attachments,
        effort,
        speed,
      });
      setDraft("");
      setAttachments([]);
    } catch (e) {
      notify(errorText(e));
    } finally {
      setSending(false);
    }
  }
  return (
    <div style={{ display: active && !pane.detached ? "contents" : "none" }}>
      <DetachablePane
        pane={pane}
        theme={theme}
        accent={accent}
        appearance={appearance}
        title={`Chat - ${thread.title}`}
      >
        <ChatAttachmentShortcut
          toggle={toggle}
          enabled={active || pane.detached}
        />
        <section
          className="content-pane chatgpt-content"
          aria-label={`Chat: ${thread.title}`}
        >
          <header className="pane-header app-drag chatgpt-content-header">
            {editing ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void api()
                    .request("rename", { id: thread.id, title })
                    .then(() => setEditing(false))
                    .catch((e) => notify(errorText(e)));
                }}
              >
                <input
                  aria-label="Chat title"
                  autoFocus
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setEditing(false);
                  }}
                />
                <button className="text-button" type="submit">
                  Save
                </button>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Cancel rename"
                  onClick={() => setEditing(false)}
                >
                  <X size={14} />
                </button>
              </form>
            ) : (
              <>
                <strong>{thread.title}</strong>
                <button
                  className="icon-button"
                  aria-label="Rename chat"
                  onClick={() => {
                    setTitle(thread.title);
                    setEditing(true);
                  }}
                >
                  <Pencil size={14} />
                </button>
              </>
            )}
            <div className="chatgpt-actions">
              {deletePending ? (
                <>
                  <button className="text-button" onClick={onDelete}>
                    Delete chat
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setDeletePending(false)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  className="icon-button"
                  aria-label="Delete chat"
                  disabled={running || pane.detached}
                  onClick={() => setDeletePending(true)}
                >
                  <Trash2 size={14} />
                </button>
              )}
              <button
                className="icon-button"
                aria-label={pane.detached ? "Reattach chat" : "Detach chat"}
                title="Detach / reattach (⌘⇧D)"
                disabled={pane.opening}
                onClick={toggle}
              >
                <PictureInPicture2 size={16} />
              </button>
            </div>
          </header>
          <div
            className="chatgpt-transcript"
            ref={scroll}
            onScroll={(e) => {
              const el = e.currentTarget;
              follow.current =
                el.scrollHeight - el.clientHeight - el.scrollTop < 80;
            }}
            aria-live="polite"
            aria-relevant="additions text"
          >
            {!thread.messages.length && (
              <div className="chatgpt-empty">
                <MessageSquare size={25} />
                <h2>Start a conversation</h2>
                <p>Project instructions apply to every message.</p>
              </div>
            )}
            {thread.messages.map((message) => (
              <article
                className={`codex-message chatgpt-message ${message.role}`}
                key={message.id}
              >
                <div className="chatgpt-message-label">
                  {message.role === "user" ? "You" : "OpenAI"}
                  {message.status === "streaming" && (
                    <Loader2 size={12} className="spin" />
                  )}
                  {["stopped", "failed"].includes(message.status) && (
                    <span>
                      {" "}
                      ·{" "}
                      {message.status === "stopped" ? "Stopped" : "Incomplete"}
                    </span>
                  )}
                </div>
                {message.role === "assistant" &&
                (message.activity?.length || message.status === "streaming") ? (
                  <WorkActivity
                    items={message.activity ?? []}
                    timing={message.timing}
                    active={message.status === "streaming"}
                    showTiming
                    markdown={(text) => (
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                        {text}
                      </ReactMarkdown>
                    )}
                  />
                ) : null}
                <ChatAttachmentList
                  attachments={message.attachments ?? []}
                  onOpen={(attachmentId) =>
                    void api()
                      .request("openAttachment", {
                        id: thread.id,
                        attachmentId,
                      })
                      .catch((e) => notify(errorText(e)))
                  }
                />
                {message.images?.map((image) => (
                  <ChatGeneratedImage
                    key={image.id}
                    api={api()}
                    threadId={thread.id}
                    image={image}
                    onError={notify}
                  />
                ))}
                <div className="markdown-body markdown-block compact">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkBreaks]}
                    components={{
                      a: ({ href, children }) => (
                        <a
                          href={href}
                          onClick={(e) => {
                            e.preventDefault();
                            if (href && /^https?:\/\//i.test(href))
                              void api()
                                .request("openLink", { url: href })
                                .catch((e) => notify(errorText(e)));
                          }}
                        >
                          {children}
                        </a>
                      ),
                      img: ({ alt }) => <span>{alt || "Image"}</span>,
                    }}
                  >
                    {message.text ||
                      (message.status === "streaming" && !message.images?.length
                        ? message.activity?.some(
                            (item) =>
                              item.kind === "imageGeneration" &&
                              item.status !== "completed",
                          )
                          ? "Generating image…"
                          : "Thinking…"
                        : "")}
                  </ReactMarkdown>
                </div>
                {message.text && message.status !== "streaming" && (
                  <div className="codex-message-actions">
                    <button
                      className="icon-button"
                      type="button"
                      aria-label="Copy message"
                      title="Copy message"
                      onClick={() =>
                        void pane.surface.navigator.clipboard
                          .writeText(message.text)
                          .catch((e) => notify(errorText(e)))
                      }
                    >
                      <Copy size={13} />
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
          {(localError || thread.error) && (
            <div className="chatgpt-error" role="alert">
              {localError || thread.error}
            </div>
          )}
          <form
            className="codex-composer chatgpt-composer"
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("Files")) {
                e.preventDefault();
                e.dataTransfer.dropEffect =
                  running || attaching ? "none" : "copy";
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              const files = Array.from(e.dataTransfer.files);
              if (files.length) void attach(files);
            }}
            onPasteCapture={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length) {
                e.preventDefault();
                e.stopPropagation();
                void attach(files);
              }
            }}
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <div className="codex-composer-tools chatgpt-composer-tools">
              <div className="codex-composer-preferences">
                <ModelPicker
                  defaultLabel="Model default"
                  value={{ ...preferences, model: chosenModel, effort, speed }}
                  models={modelChoices}
                  disabled={running || !models.length}
                  onChange={(value) =>
                    setPreferences({
                      ...value,
                      model:
                        value.model ||
                        models.find((m) => m.isDefault)?.slug ||
                        models[0]?.slug ||
                        "",
                    })
                  }
                />
              </div>
            </div>
            <div className="codex-input">
              <button
                className="icon-button codex-attach-button"
                type="button"
                aria-label="Attach documents or images"
                title="Attach documents or images"
                disabled={running || attaching || attachments.length >= 20}
                onClick={() => void attach()}
              >
                <ImagePlus size={16} />
              </button>
              <ComposerEditor
                label="Message OpenAI"
                value={draft}
                onChange={setDraft}
                onSend={() => void send()}
                disabled={running || attaching}
                sendShortcut={sendShortcut}
                placeholder={
                  connected
                    ? "Message OpenAI"
                    : "Sign in under Global configuration → OpenAI to send messages"
                }
              />
              <div className="codex-submit-actions">
                {running ? (
                  <button
                    className="icon-button codex-send-button"
                    type="button"
                    aria-label="Stop response"
                    title="Stop the current turn"
                    onClick={() =>
                      void api()
                        .request("stop", { id: thread.id })
                        .catch((e) => notify(errorText(e)))
                    }
                  >
                    <Square size={14} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    className="icon-button codex-send-button"
                    type="submit"
                    aria-label="Send message"
                    title="Send"
                    disabled={
                      (!draft.trim() && !attachments.length) ||
                      attaching ||
                      !connected ||
                      !chosenModel
                    }
                  >
                    <Send size={16} />
                  </button>
                )}
              </div>
            </div>
            {attachments.length > 0 && (
              <div className="codex-attachments">
                {attachments.map((a) => (
                  <span key={a.id}>
                    {a.name}
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Remove ${a.name}`}
                      disabled={running || attaching}
                      onClick={() =>
                        setAttachments((current) =>
                          current.filter((entry) => entry.id !== a.id),
                        )
                      }
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </form>
        </section>
      </DetachablePane>
    </div>
  );
}
function ChatAttachmentShortcut({
  toggle,
  enabled,
}: {
  toggle(): void;
  enabled: boolean;
}) {
  useContentAttachmentShortcut(toggle, enabled);
  return null;
}
