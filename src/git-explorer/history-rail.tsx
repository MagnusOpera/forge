import { useEffect, useState } from "react";
import type { GitCommit, GitHistory } from "../../shared/git-explorer";
import { errorMessage } from "../codex/api";

export function commitDate(date: string) {
  return new Date(date).toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function GitHistoryRail<T extends GitCommit>({ title, baseLabel = "Working tree", loadHistory, version, onSelect }: {
  title: string;
  baseLabel?: string;
  loadHistory(): Promise<GitHistory<T>>;
  version: T | null;
  onSelect(version: T | null): void;
}) {
  const [history, setHistory] = useState<GitHistory<T>>();
  const [historyError, setHistoryError] = useState<string>();

  useEffect(() => {
    let active = true;
    void loadHistory().then(
      (result) => { if (active) setHistory(result); },
      (error) => { if (active) setHistoryError(errorMessage(error)); },
    );
    return () => { active = false; };
  }, [loadHistory]);

  return (
    <aside className="git-history-rail" aria-label={title}>
      <div className="git-history-timeline">
        <button type="button" className="git-history-entry" aria-pressed={!version} onClick={() => onSelect(null)}>
          <span className="git-history-dot" aria-hidden="true" />
          <span className="git-history-label"><strong>{baseLabel}</strong></span>
        </button>
        {history?.commits.map((entry) => (
          <button type="button" className="git-history-entry" key={entry.commit} title={entry.subject}
            aria-pressed={version?.commit === entry.commit} onClick={() => onSelect(entry)}>
            <span className="git-history-dot" aria-hidden="true" />
            <span className="git-history-label">
              <strong>{entry.subject || "Untitled commit"}</strong>
              <small>{commitDate(entry.date)} · {entry.commit.slice(0, 7)}</small>
            </span>
          </button>
        ))}
        <div className="git-history-note git-history-label" role="status">
          {historyError}
          {!historyError && !history && "Loading history…"}
          {history?.commits.length === 0 && "No committed history."}
          {history?.hasOlder && `Showing the latest ${history.commits.length} commits.`}
        </div>
      </div>
    </aside>
  );
}
