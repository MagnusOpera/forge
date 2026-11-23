import { useLayoutEffect, useMemo, useRef, type DragEvent, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Loader2, Plus, Search, Star, StarOff, X } from "lucide-react";
import type { RepoSummary } from "../../shared/github";
import { formatRelative, groupRepositoriesByOwner } from "../appLogic";
import { Github } from "../GithubIcon";

export function RepositorySelector({
  repositories, search, onSearch, loading, collapsedGroups, onToggleGroup, renderRepository,
  searchLabel = "Search repositories", selectedCount, footer,
}: {
  repositories: RepoSummary[];
  search: string;
  onSearch: (value: string) => void;
  loading: boolean;
  collapsedGroups: Record<string, boolean>;
  onToggleGroup: (owner: string) => void;
  renderRepository: (repo: RepoSummary) => ReactNode;
  searchLabel?: string;
  selectedCount?: number;
  footer?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const searching = search.trim().length > 0;
  const groups = useMemo(() => groupRepositoriesByOwner(repositories), [repositories]);

  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = 0;
  }, [search]);

  return (
    <div className="sidebar-repositories sidebar-scroll sidebar-repository-scroll" ref={list}>
      <div className="sidebar-repo-header sidebar-repo-chrome">
        <div className="search-box">
          <Search size={16} />
          <input ref={input} value={search} onChange={(event) => onSearch(event.target.value)}
            placeholder="Search" aria-label={searchLabel} />
          {searching && (
            <button type="button" className="search-clear-button" aria-label="Clear search"
              onClick={() => { onSearch(""); input.current?.focus(); }}>
              <X size={14} />
            </button>
          )}
        </div>
        <div className="section-title">
          <Github size={15} />
          <span>{searching ? "Results" : "Repositories"}</span>
          {loading ? <Loader2 className="spin" size={14} /> : (
            <span className="count">
              {repositories.length}{selectedCount !== undefined && ` · ${selectedCount} selected`}
            </span>
          )}
        </div>
      </div>
      <div className="sidebar-repo-groups">
        {!groups.length && (
          <div className="empty-row">
            {searching ? "No matching repositories." : "No repositories."}
          </div>
        )}
        {groups.map(([owner, repos]) => {
          const collapsed = collapsedGroups[owner] === true;
          return (
            <div key={owner} className={collapsed ? "repo-group collapsed" : "repo-group"}>
              <button type="button" className="repo-group-toggle"
                aria-expanded={!collapsed}
                aria-label={`${collapsed ? "Expand" : "Collapse"} ${owner} repositories`}
                onClick={() => onToggleGroup(owner)}>
                {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <span className="repo-group-name">{owner}</span>
                <span className="repo-group-count">{repos.length}</span>
              </button>
              {!collapsed && <div className="repo-group-items">{repos.map(renderRepository)}</div>}
            </div>
          );
        })}
      </div>
      {footer && <div className="sidebar-repo-footer sidebar-repo-chrome">{footer}</div>}
    </div>
  );
}

export function RepoButton(props: {
  repo: RepoSummary;
  selected: boolean;
  favorite?: boolean;
  draggable?: boolean;
  dragging?: boolean;
  dragOver?: boolean;
  showOwner?: boolean;
  onDragStart?(event: DragEvent<HTMLDivElement>): void;
  onDragOver?(event: DragEvent<HTMLDivElement>): void;
  onDrop?(event: DragEvent<HTMLDivElement>): void;
  onDragEnd?(): void;
  onSelect(): void;
  onToggleFavorite?(): void;
}) {
  const multiSelect = !props.onToggleFavorite;
  const repoLabel = props.showOwner ? (
    <>
      <span className="repo-owner">{props.repo.owner}/</span>
      <span className="repo-short-name">{props.repo.name}</span>
    </>
  ) : (
    <span className="repo-short-name">{props.repo.name}</span>
  );

  return (
    <div
      className={[
        "repo-button-wrap",
        multiSelect && "repo-multi-select",
        props.selected && "selected",
        props.draggable && "draggable",
        props.dragging && "dragging",
        props.dragOver && "drag-over",
      ].filter(Boolean).join(" ")}
      draggable={props.draggable}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
    >
      <button type="button" className="repo-button" onClick={props.onSelect}
        aria-pressed={multiSelect ? props.selected : undefined}
        aria-label={multiSelect ? props.repo.fullName : undefined}
        title={multiSelect ? props.repo.fullName : undefined}>
        <span className={props.showOwner ? "repo-name repo-name-with-owner" : "repo-name"}>{repoLabel}</span>
        <span className="repo-meta">{formatRelative(props.repo.updatedAt)}</span>
        {multiSelect && (props.selected ? <Check size={14} /> : <Plus size={14} />)}
      </button>
      {props.onToggleFavorite && (
        <button type="button" className="star-button"
          aria-label={props.favorite ? "Remove favorite" : "Add favorite"}
          onClick={props.onToggleFavorite}>
          {props.favorite ? <Star size={14} fill="currentColor" /> : <StarOff size={14} />}
        </button>
      )}
    </div>
  );
}
