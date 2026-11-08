import { usePaneSurface } from "../pane-surface";
import { displayPath } from "../paths";
import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Columns2, List, Loader2, RefreshCw, X } from "lucide-react";
import type { CodexFileChange, CodexGitInfo, CodexThreadSummary } from "../../shared/codex";
import { codexApi, errorMessage } from "./api";
import { recordedPatch } from "./transcript";
const DiffFiles = lazy(() => import("./diff-files"));
export function CodexDiffDialog({
  thread,
  theme,
  onClose,
  changes,
  filePath,
}: {
  thread: Pick<CodexThreadSummary, "id" | "repositoryId"> & Partial<CodexThreadSummary>;
  theme: "light" | "dark";
  onClose: () => void;
  changes?: CodexFileChange[];
  filePath?: string;
}) {
  const { id, repositoryId } = thread;
  const remote = Boolean(thread.environment);
  const load = useCallback(async () => changes
    ? { status: "", diff: recordedPatch(filePath ? changes.filter((file) => file.path === filePath) : changes), untracked: [] }
    : codexApi().request("git", { repositoryId, id }), [changes, filePath, repositoryId, id]);
  return <DiffDialog
    title={changes ? filePath ? displayPath(filePath, remote) : "Edited files" : "Worktree changes"}
    theme={theme} onClose={onClose} load={load} refreshable={!changes} remote={remote}
    context={!changes && <p className="codex-path">
      {thread.branch}
      <br />
      {displayPath(thread.worktree ?? "", remote)}
      <br />
      Compared with {thread.baseCommit?.slice(0, 12)}
    </p>}
  />;
}

export function DiffDialog({
  title, theme, onClose, load, refreshable = true, context, remote = false, emptyMessage,
}: {
  title: string;
  theme: "light" | "dark";
  onClose(): void;
  load(): Promise<CodexGitInfo>;
  refreshable?: boolean;
  context?: ReactNode;
  remote?: boolean;
  emptyMessage?: string;
}) {
  "use no memo"; // Preserve the live ref handling at this imperative UI boundary.

  const { document } = usePaneSurface();
  const titleId = useId();
  const [info, setInfo] = useState<CodexGitInfo | null>(null),
    [error, setError] = useState("");
  const [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0),
    [split, setSplit] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLElement>("button")?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      }
      if (event.key === "Tab") {
        const controls = Array.from(
          root.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), summary, select",
          ) ?? [],
        );
        const index = controls.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        controls[
          (index + (event.shiftKey ? -1 : 1) + controls.length) %
            controls.length
        ]?.focus();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => {
      document.removeEventListener("keydown", handler, true);
      previous?.focus();
    };
  }, [document]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setInfo(null);
    void Promise.resolve().then(load)
      .then((result) => {
        if (active) setInfo(result);
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [load, refresh]);
  return (
    <div
      className="codex-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="codex-settings-dialog codex-diff-dialog"
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header>
          <h2 id={titleId}>{title}</h2>
          <div className="codex-actions">
            <button
              className={`icon-button ${!split ? "active" : ""}`}
              aria-label="Unified diff"
              title="Unified diff"
              aria-pressed={!split}
              onClick={() => setSplit(false)}
            >
              <List size={17} />
            </button>
            <button
              className={`icon-button ${split ? "active" : ""}`}
              aria-label="Split diff"
              title="Split diff"
              aria-pressed={split}
              onClick={() => setSplit(true)}
            >
              <Columns2 size={17} />
            </button>
            {refreshable && <button
              className="icon-button"
              aria-label="Refresh diff"
              disabled={loading}
              onClick={() => setRefresh((value) => value + 1)}
            >
              <RefreshCw size={15} className={loading ? "spin" : undefined} />
            </button>}
            <button
              className="icon-button"
              aria-label="Close diff"
              onClick={onClose}
            >
              <X size={17} />
            </button>
          </div>
        </header>
        <div className="codex-diff-scroll">
          {context}
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          {loading ? (
            <div className="codex-empty">
              <Loader2 size={20} className="spin" />
            </div>
          ) : (
            info && (
              <>
                {(context || info.status) && <pre className="codex-git-status">
                  {info.status || "Working tree clean"}
                </pre>}
                <Suspense
                  fallback={<p className="codex-muted">Loading diff…</p>}
                >
                  <DiffFiles info={info} theme={theme} split={split} remote={remote} emptyMessage={emptyMessage} />
                </Suspense>
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}
