import { useEffect, useRef, useState } from "react";
import { Funnel, Search, X } from "lucide-react";
import type { GitCommit, GitHistory } from "../../shared/git-explorer";
import { errorMessage } from "../codex/api";

export function commitDate(date: string) {
  return new Date(date).toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function GitHistoryRail<T extends GitCommit>({
  title, baseLabel = "Working tree", loadHistory, version, onSelect, query, onSearch,
}: {
  title: string;
  baseLabel?: string;
  loadHistory(query?: string): Promise<GitHistory<T>>;
  version: T | null;
  onSelect(version: T | null): void;
  query: string;
  onSearch(query: string): void;
}) {
  const rail = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const filter = query.trim();
  const StatusIcon = filter ? Funnel : Search;
  const [result, setResult] = useState<{
    filter: string;
    loadHistory: typeof loadHistory;
    history?: GitHistory<T>;
    error?: string;
  }>();
  const current = result?.filter === filter && result.loadHistory === loadHistory ? result : undefined;
  const history = current?.history;

  useEffect(() => {
    let active = true;
    const load = () => {
      void loadHistory(filter || undefined).then(
        (history) => { if (active) setResult({ filter, loadHistory, history }); },
        (error) => { if (active) setResult({ filter, loadHistory, error: errorMessage(error) }); },
      );
    };
    const timer = filter ? setTimeout(load, 200) : undefined;
    if (!filter) load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [filter, loadHistory]);

  useEffect(() => {
    const element = rail.current;
    if (!element) return;
    const document = element.ownerDocument;
    const dismiss = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) element.querySelector<HTMLElement>(":focus")?.blur();
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, []);

  return (
    <aside ref={rail} className="git-history-rail" aria-label={title}>
      <div className="git-history-search-slot">
        <span className="git-history-filter-indicator" data-filtered={Boolean(filter)} role="img"
          aria-label={filter ? "Commit filter active" : "No commit filter"}>
          <StatusIcon size={16} aria-hidden="true" />
        </span>
        <div className="search-box git-history-search">
          <StatusIcon size={16} aria-hidden="true" />
          <input ref={search} value={query} placeholder="Search commits" aria-label={`Search ${title.toLowerCase()}`}
            maxLength={4096} onChange={(event) => onSearch(event.target.value)} />
          {query && <button type="button" className="search-clear-button" aria-label="Clear search" onClick={() => {
            onSearch("");
            search.current?.focus();
          }}><X size={14} aria-hidden="true" /></button>}
        </div>
      </div>
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
          {current?.error}
          {!current && (filter ? "Searching history…" : "Loading history…")}
          {history?.commits.length === 0 && (filter ? "No matching commits." : "No committed history.")}
          {history?.hasOlder && `Showing the latest ${history.commits.length} ${filter ? "matches" : "commits"}.`}
        </div>
      </div>
    </aside>
  );
}
