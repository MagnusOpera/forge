import { lazy, Suspense, useEffect, useRef, useState } from "react";
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
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    if (changes) {
      setInfo({
        status: "",
        diff: recordedPatch(filePath ? changes.filter((file) => file.path === filePath) : changes),
        untracked: [],
      });
      setLoading(false);
      return;
    }
    void codexApi()
      .request("git", { repositoryId: thread.repositoryId, id: thread.id })
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
  }, [thread.repositoryId, thread.id, refresh, changes, filePath]);
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
        aria-labelledby="codex-diff-title"
      >
        <header>
          <h2 id="codex-diff-title">{changes ? filePath ?? "Edited files" : "Worktree changes"}</h2>
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
            {!changes && <button
              className="icon-button"
              aria-label="Refresh worktree diff"
              disabled={loading}
              onClick={() => setRefresh((value) => value + 1)}
            >
              <RefreshCw size={15} className={loading ? "spin" : undefined} />
            </button>}
            <button
              className="icon-button"
              aria-label="Close worktree diff"
              onClick={onClose}
            >
              <X size={17} />
            </button>
          </div>
        </header>
        <div className="codex-diff-scroll">
          {!changes && <p className="codex-path">
            {thread.branch}
            <br />
            {thread.worktree}
            <br />
            Compared with {thread.baseCommit?.slice(0, 12)}
          </p>}
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
                {!changes && <pre className="codex-git-status">
                  {info.status || "Working tree clean"}
                </pre>}
                <Suspense
                  fallback={<p className="codex-muted">Loading diff…</p>}
                >
                  <DiffFiles info={info} theme={theme} split={split} />
                </Suspense>
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}
