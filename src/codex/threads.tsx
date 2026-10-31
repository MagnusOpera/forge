import { displayPathText } from "../paths";
import { createPortal } from "react-dom";
import { ThreadFilterTabs } from "./thread-filter-tabs";
import { ExistingCodexDialog } from "./existing-dialog";
import { useEffect, useState } from "react";
import {
  Archive,
  History,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
} from "lucide-react";
import { codexIsActive, type CodexThreadSummary } from "../../shared/codex";
import { codexApi, errorMessage } from "./api";
function checkoutSetupMessage(error: string): string | undefined {
  if (error.includes("Choose a local Git folder or configure a remote project placement first."))
    return "To start a thread, open project configuration and choose a local Git checkout or set up a remote checkout.";
  if (error.includes("Configure the default environment's checkout in project configuration before creating a thread."))
    return "To start a thread, open project configuration and set up a checkout for your default environment.";
}
export function CodexThreadList({
  repositoryId,
  loading,
  threads,
  selectedId,
  onSelect,
  onConfigure,
  configurationOpen = false,
  error: loadError,
}: {
  repositoryId: string;
  loading: boolean;
  threads: CodexThreadSummary[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onConfigure: () => void;
  configurationOpen?: boolean;
  error: string;
}) {
  const [archived, setArchived] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null),
    [title, setTitle] = useState("");
  const [existing, setExisting] = useState(false);
  useEffect(() => setExisting(false), [repositoryId]);
  useEffect(() => {
    if (configurationOpen || !checkoutSetupMessage(error)) return;
    let active = true;
    void (async () => {
      const configuration = await codexApi().request("configuration", {});
      const project = configuration.projects[repositoryId];
      if (!active || !project) return;
      const environmentId = project.defaultEnvironment ?? "local";
      // Creation also permits choosing a remote target later, when only remote
      // placements are configured and no default has been selected yet.
      const target = environmentId === "local" && !project.path
        ? Object.keys(project.remotePaths ?? {}).find((id) => project.remotePaths?.[id])
        : environmentId;
      if (!target) return;
      const result = await codexApi().request("checkProjectCheckout", {
        repositoryId, environmentId: target,
      });
      if (active && result.ready) setError("");
    })().catch(() => {
      // Keep the original error if the repaired checkout cannot be confirmed.
    });
    return () => { active = false; };
  }, [configurationOpen, error, repositoryId]);
  const setupMessage = checkoutSetupMessage(error || loadError);
  const visible = threads.filter((t) => t.archived === archived);
  const run = async (action: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="codex-thread-list"
      aria-label="Codex threads"
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).closest("input, textarea, select"))
          return;
        const delta =
          event.key === "ArrowDown" || event.key === "j"
            ? 1
            : event.key === "ArrowUp" || event.key === "k"
              ? -1
              : 0;
        if (delta && visible.length) {
          event.preventDefault();
          const current = visible.findIndex((t) => t.id === selectedId);
          onSelect(
            visible[(current + delta + visible.length) % visible.length].id,
          );
        }
      }}
    >
      <div className="codex-list-actions">
        <ThreadFilterTabs
          archived={archived}
          onChange={setArchived}
          activeCount={threads.filter((t) => !t.archived).length}
          archivedCount={threads.filter((t) => t.archived).length}
        />
        <div className="codex-actions">
          <button
            className="icon-button"
            title="Existing Codex threads"
            aria-label="Browse existing Codex threads"
            disabled={busy || loading}
            onClick={() => setExisting(true)}
          >
            <History size={16} />
          </button>
          <button
            className="icon-button"
            title="New thread"
            aria-label="New Codex thread"
            disabled={busy || loading}
            onClick={() =>
              void run(async () => {
                const thread = await codexApi().request("create", {
                  repositoryId,
                });
                setArchived(false);
                onSelect(thread.id);
              })
            }
          >
            <Plus size={16} />
          </button>
        </div>
      </div>
      {existing &&
        createPortal(
          <ExistingCodexDialog
            key={repositoryId}
            repositoryId={repositoryId}
            onSelect={(id) => {
              setArchived(false);
              onSelect(id);
            }}
            onClose={() => setExisting(false)}
          />,
          document.querySelector(".app-shell") ?? document.body,
        )}
      {(error || loadError) && (
        <div className={setupMessage ? "codex-setup-notice" : "inline-error"} role={setupMessage ? "status" : "alert"}>
          {setupMessage ?? (error || loadError)}
          <button className="ghost-button" onClick={onConfigure}>
            {setupMessage ? "Open configuration" : "Configure"}
          </button>
        </div>
      )}
      {visible.map((thread) => (
        <div
          className={`focus-row codex-thread-row ${thread.id === selectedId ? "active" : ""}`}
          key={thread.id}
        >
          {renaming === thread.id ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await codexApi().request("update", {
                    repositoryId,
                    id: thread.id,
                    title,
                  });
                  setRenaming(null);
                });
              }}
            >
              <input
                aria-label="Thread title"
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setRenaming(null);
                }}
              />
              <button className="ghost-button" type="submit">
                Save
              </button>
            </form>
          ) : (
            <>
              <button
                className="codex-thread-select"
                aria-current={thread.id === selectedId ? "true" : undefined}
                onClick={() => onSelect(thread.id)}
              >
                <MessageSquare size={14} />
                <span className="focus-main">
                  <span className="focus-title">{displayPathText(thread.title, Boolean(thread.environment))}</span>
                  <span className="focus-meta">
                    {thread.settings.mode === "plan" ? "Plan" : "Implement"} ·{" "}
                    {thread.settings.model || "Codex default"}
                    {thread.environment
                      ? ` · ${thread.environment.name}`
                      : thread.sourceHome
                        ? " · Codex app/CLI"
                        : ""}
                  </span>
                </span>
                <span
                  className={`state-chip ${thread.state === "failed" ? "bad" : codexIsActive(thread) ? "running" : "muted"}`}
                >
                  {thread.state === "waiting" ? "Needs input" : thread.state}
                </span>
              </button>
              <div className="codex-thread-actions">
                <button
                  className="icon-button"
                  aria-label={`Rename ${displayPathText(thread.title, Boolean(thread.environment))}`}
                  title="Rename thread"
                  onClick={() => {
                    setRenaming(thread.id);
                    setTitle(thread.title);
                  }}
                >
                  <Pencil size={12} />
                </button>
                <button
                  className="icon-button"
                  disabled={codexIsActive(thread) || busy}
                  aria-label={`${thread.archived ? "Restore" : "Archive"} ${displayPathText(thread.title, Boolean(thread.environment))}`}
                  title={thread.archived ? "Restore thread" : "Archive thread"}
                  onClick={() =>
                    void run(async () => {
                      await codexApi().request("update", {
                        repositoryId,
                        id: thread.id,
                        archived: !thread.archived,
                      });
                    })
                  }
                >
                  {thread.archived ? (
                    <RotateCcw size={13} />
                  ) : (
                    <Archive size={13} />
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      ))}
      {!visible.length && (
        <div className="codex-empty">
          <MessageSquare size={22} />
          <p>{archived ? "No archived threads" : "No Codex threads yet"}</p>
          {!archived && (
            <p>
              Configure a local or remote Git checkout in project configuration,
              then create a thread.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
