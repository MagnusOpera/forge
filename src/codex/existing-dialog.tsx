import { displayPath, displayPathText } from "../paths";
import { ThreadFilterTabs } from "./thread-filter-tabs";
import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";
import type { CodexExistingThread } from "../../shared/codex";
import { codexApi, errorMessage } from "./api";

export function ExistingCodexDialog({
  repositoryId,
  onSelect,
  onClose,
}: {
  repositoryId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [threads, setThreads] = useState<CodexExistingThread[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [home, setHome] = useState("");
  const [archived, setArchived] = useState(false);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const root = useRef<HTMLDivElement>(null),
    generation = useRef(0),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      }
      if (event.key === "Tab") {
        const controls = [
          ...root.current!.querySelectorAll<HTMLElement>(
            "button:not(:disabled)",
          ),
        ];
        if (!controls.length) return;
        event.preventDefault();
        const index = controls.indexOf(document.activeElement as HTMLElement);
        controls[
          (index + (event.shiftKey ? -1 : 1) + controls.length) %
            controls.length
        ]?.focus();
      }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      previous?.focus();
      generation.current++;
    };
  }, []);
  async function load(next?: string) {
    const revision = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const result = await codexApi().request("existing", {
        repositoryId,
        archived,
        cursor: next,
      });
      if (generation.current !== revision) return;
      setThreads((current) =>
        next
          ? [
              ...current,
              ...result.threads.filter(
                (t) => !current.some((old) => old.id === t.id),
              ),
            ]
          : result.threads,
      );
      setCursor(result.nextCursor);
      setHome(result.home);
    } catch (e) {
      if (generation.current === revision) setError(errorMessage(e));
    } finally {
      if (generation.current === revision) setBusy(false);
    }
  }
  useEffect(() => {
    setThreads([]);
    setCursor(null);
    void load();
    return () => {
      generation.current++;
    };
  }, [repositoryId, archived, refresh]);
  return (
    <div
      className="codex-modal-backdrop"
      onKeyDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="codex-settings-dialog codex-existing-dialog"
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-labelledby="codex-existing-title"
      >
        <header>
          <h2 id="codex-existing-title">Existing Codex threads</h2>
          <div className="codex-actions">
            <button
              className="icon-button"
              aria-label="Refresh existing threads"
              title="Refresh"
              disabled={busy}
              onClick={() => setRefresh((v) => v + 1)}
            >
              <RefreshCw size={15} />
            </button>
            <button
              className="icon-button"
              aria-label="Close existing threads"
              onClick={onClose}
            >
              <X size={17} />
            </button>
          </div>
        </header>
        <div className="codex-settings-scroll">
          <p>
            Continue a local Codex app or CLI thread in its existing folder.
            This uses your Codex account and configuration. New Forge threads
            keep their separate configuration.
          </p>
          {home && <p className="codex-path">{displayPath(home)}</p>}
          <p>
            Finish or stop the thread in Codex before continuing here. Existing
            files and uncommitted changes stay in place. Diffs start from HEAD
            when you add the thread.
          </p>
          <ThreadFilterTabs
            archived={archived}
            onChange={setArchived}
            disabled={busy}
            label="Existing thread filter"
          />
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {threads.map((thread) => (
            <div className="codex-existing-row" key={thread.id}>
              <span className="focus-main">
                <span className="focus-title">{displayPathText(thread.title)}</span>
                <span className="focus-meta" title={displayPath(thread.cwd)}>
                  {displayPath(thread.cwd)}
                </span>
                <small>
                  {thread.updatedAt
                    ? new Date(thread.updatedAt).toLocaleString()
                    : ""}
                  {thread.active ? " · Running in Codex" : ""}
                </small>
              </span>
              <button
                className="ghost-button"
                disabled={busy || thread.active}
                onClick={async () => {
                  const revision = ++generation.current;
                  setBusy(true);
                  setError("");
                  try {
                    const selected = await codexApi().request("adopt", {
                      repositoryId,
                      serverId: thread.id,
                      archived: thread.archived,
                    });
                    if (generation.current === revision) {
                      onSelect(selected.id);
                      onClose();
                    }
                  } catch (e) {
                    if (generation.current === revision)
                      setError(errorMessage(e));
                  } finally {
                    if (generation.current === revision) setBusy(false);
                  }
                }}
              >
                {thread.attachedId
                  ? "Open in Forge"
                  : thread.archived
                    ? "Restore and add"
                    : "Add to Forge"}
              </button>
            </div>
          ))}
          {busy && (
            <p className="codex-empty">
              <Loader2 size={18} className="spin" /> Loading…
            </p>
          )}
          {!busy && !threads.length && !error && (
            <p className="codex-muted">
              No matching threads found
              {cursor
                ? " in the scanned history. Scan more to check older threads."
                : " for this project's local Git repository."}
            </p>
          )}
          {cursor && (
            <button
              className="ghost-button"
              disabled={busy}
              onClick={() => void load(cursor)}
            >
              Scan more threads
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
