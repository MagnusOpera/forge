import { useEffect, useState, type KeyboardEvent } from "react";
import { MessageSquare, RotateCw } from "lucide-react";
import type { CodexThreadSummary } from "../../shared/codex";
import type { RepoSummary } from "../../shared/github";
import { displayPathText } from "../paths";
import { bundleThreads, deliveryThreadKey, type DeliveryThread, type ProjectBundle } from "./delivery";
import { errorMessage } from "./api";

type RepoThreads = { threads: CodexThreadSummary[]; error?: string };

export function useBundleThreads(repos: RepoSummary[], enabled: boolean) {
  const repoIds = JSON.stringify(enabled ? repos.map(({ id }) => id).sort() : []);
  const [results, setResults] = useState<Map<string, RepoThreads>>(new Map());
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const ids: string[] = JSON.parse(repoIds);
    const api = window.forgeCodex;
    if (!api) return;
    let active = true;
    const revisions = new Map<string, number>();
    setResults((current) => new Map(ids.flatMap((id) => {
      const result = current.get(id);
      return result ? [[id, result]] : [];
    })));
    const refresh = (repositoryId: string) => {
      const revision = (revisions.get(repositoryId) ?? 0) + 1;
      revisions.set(repositoryId, revision);
      const publish = (threads?: CodexThreadSummary[], error?: string) => {
        if (!active || revisions.get(repositoryId) !== revision) return;
        setResults((current) => new Map(current).set(repositoryId, {
          threads: threads ?? current.get(repositoryId)?.threads ?? [],
          error,
        }));
      };
      void api.request("list", { repositoryId }).then(
        (threads) => publish(threads),
        (error) => publish(undefined, errorMessage(error)),
      );
    };
    const unsubscribe = api.onChanged(({ repositoryId, windowChanged }) => {
      if (windowChanged) return;
      if (!repositoryId) ids.forEach((id) => refresh(id));
      else if (ids.includes(repositoryId)) refresh(repositoryId);
    });
    ids.forEach((id) => refresh(id));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [enabled, repoIds, refreshVersion]);

  return {
    entries: enabled ? bundleThreads(repos, new Map([...results].map(([id, result]) => [id, result.threads]))) : [],
    loading: Boolean(window.forgeCodex && repos.some(({ id }) => !results.has(id))),
    error: window.forgeCodex ? "" : "Codex requires the Forge desktop app.",
    failures: repos.flatMap((repo) => {
      const error = results.get(repo.id)?.error;
      return error ? [{ repo, error }] : [];
    }),
    refresh: () => setRefreshVersion((version) => version + 1),
  };
}

const statusLabels: Record<CodexThreadSummary["state"], string> = {
  idle: "",
  starting: "Starting",
  running: "Running",
  waiting: "Needs input",
  interrupted: "Interrupted",
  failed: "Failed",
};

const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function DeliveryThreads({
  bundle, threads, selectedKey, sidebarCollapsed, formatUpdatedAt, onSelect,
}: {
  bundle?: ProjectBundle;
  threads: ReturnType<typeof useBundleThreads>;
  selectedKey?: string;
  sidebarCollapsed: boolean;
  formatUpdatedAt: (value: string) => string;
  onSelect: (entry: DeliveryThread) => void;
}) {
  const { entries, loading, error, failures, refresh } = threads;
  const moveSelection = (event: KeyboardEvent<HTMLOListElement>) => {
    if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    const focused = buttons.indexOf(event.target as HTMLButtonElement);
    const index = {
      ArrowDown: focused + 1,
      ArrowUp: focused - 1,
      Home: 0,
      End: buttons.length - 1,
    }[event.key];
    if (index === undefined) return;
    event.preventDefault();
    buttons[Math.max(0, Math.min(index, buttons.length - 1))]?.focus();
  };
  return (
    <section className="project-pane delivery-threads-pane" aria-label="Bundle threads">
      <div className={`pane-header app-drag${sidebarCollapsed ? " collapsed-project-header" : ""}`}>
        <div className="content-title"><span title={bundle?.name}>{bundle?.name ?? "Delivery"}</span></div>
      </div>
      <div className="section-title delivery-list-heading">
        <h2><MessageSquare size={15} /> Codex threads</h2>
        <span className="count">{entries.length}</span>
        <button className="icon-button" type="button" aria-label="Refresh bundle threads" title="Refresh bundle threads"
          disabled={Boolean(error) || !bundle || loading} onClick={refresh}>
          <RotateCw size={14} />
        </button>
      </div>
      {!bundle && <p className="delivery-hint">Create or select a bundle to see its Codex threads.</p>}
      {bundle && error && <p className="delivery-hint" role="alert">{error}</p>}
      {bundle && loading && <p className="delivery-hint" role="status">Loading Codex threads…</p>}
      {failures.map(({ repo, error }) => (
        <p key={repo.id} className="delivery-hint" role="alert">{repo.fullName} · {error}</p>
      ))}
      {bundle && !error && !loading && bundle.repositories.length > failures.length && !entries.length &&
        <p className="delivery-hint">No Codex threads in this bundle’s repositories.</p>}
      <ol className="sidebar-scroll delivery-rows" onKeyDown={moveSelection}>
        {entries.map((entry) => {
          const { repo, thread } = entry;
          const key = deliveryThreadKey(entry);
          const title = displayPathText(thread.title, Boolean(thread.environment));
          const status = thread.archived ? "Archived" : statusLabels[thread.state];
          const date = new Date(thread.updatedAt);
          const selected = key === selectedKey;
          return (
            <li key={key} className={`repo-button-wrap delivery-row${selected ? " selected" : ""}`}>
              <button type="button" className="repo-button delivery-thread" aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(entry)}>
                <strong className="repo-name" title={title}>{title}</strong>
                {Number.isFinite(date.getTime()) && (
                  <time className="repo-meta" dateTime={thread.updatedAt} title={dateFormat.format(date)}>
                    {formatUpdatedAt(thread.updatedAt)}
                  </time>
                )}
                <span className="repo-meta delivery-thread-repo" title={repo.fullName}>{repo.fullName}</span>
                {status && <span className={`codex-state ${thread.archived ? "" : thread.state}`}>{status}</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
