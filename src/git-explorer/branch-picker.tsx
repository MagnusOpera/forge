import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Cloud, FolderGit2, GitBranch, Search } from "lucide-react";
import type { GitBranch as Branch } from "../../shared/git-explorer";

export function BranchPicker({ branch, branches, blocker, navigationBlocker = null, onSwitch }: {
  branch: string | null;
  branches: Branch[];
  blocker: string | null;
  navigationBlocker?: string | null;
  onSwitch(ref: string): void;
}) {
  const id = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [activeRef, setActiveRef] = useState<string | null>(null);
  const visible = branches.filter((option) => option.label.toLowerCase().includes(filter));
  const currentRef = branch === null ? null : `refs/heads/${branch}`;
  const optionBlocker = (option: Branch) => option.blocker ?? (option.worktree ? navigationBlocker : blocker);
  const available = visible.filter((option) => !optionBlocker(option));
  const canOpenWorktree = available.some((option) => option.worktree);
  const active = visible.find((option) => option.ref === activeRef) ?? available[0];
  const activeIndex = active ? visible.indexOf(active) : -1;
  const pending = query.trim().toLowerCase() !== filter;

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  const show = () => {
    setQuery("");
    setFilter("");
    setActiveRef(null);
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const document = wrapper.current?.ownerDocument;
    const dismiss = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document?.addEventListener("pointerdown", dismiss);
    return () => document?.removeEventListener("pointerdown", dismiss);
  }, [open]);
  useEffect(() => {
    if (!open || !pending) return;
    const timer = setTimeout(() => {
      setFilter(query.trim().toLowerCase());
      setActiveRef(null);
    }, 200);
    return () => clearTimeout(timer);
  }, [open, pending, query]);
  useEffect(() => {
    if (open && activeIndex >= 0)
      wrapper.current?.ownerDocument.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, id, open]);

  const choose = (option: Branch) => {
    if (pending || optionBlocker(option)) return;
    close(true);
    if (option.ref !== currentRef) onSwitch(option.ref);
  };

  return (
    <div className="git-branch-picker" ref={wrapper} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) close(false);
    }}>
      <button ref={trigger} type="button" className="combobox-trigger" aria-label={`Branch: ${branch ?? "Detached HEAD"}`}
        aria-expanded={open} aria-controls={open ? id : undefined} title={navigationBlocker ?? "Choose branch or worktree"}
        onClick={() => open ? close(false) : show()}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            show();
          }
        }}>
        <GitBranch size={14} aria-hidden="true" />
        <span>{branch ?? "Detached HEAD"}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <div id={id} role="dialog" aria-label="Choose branch or worktree" className="git-branch-menu">
          <div className="search-box">
            <Search size={16} aria-hidden="true" />
            <input ref={input} type="text" role="combobox" aria-label="Search branches" aria-autocomplete="list"
              aria-expanded="true" aria-controls={`${id}-options`}
              aria-activedescendant={!pending && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
              placeholder="Search branches…" value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  close(true);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  if (active) choose(active);
                } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  if (pending || !available.length) return;
                  const direction = event.key === "ArrowDown" ? 1 : -1;
                  const index = available.findIndex((option) => option.ref === active?.ref);
                  const next = index === -1 ? (direction > 0 ? 0 : available.length - 1) :
                    (index + direction + available.length) % available.length;
                  setActiveRef(available[next].ref);
                }
              }} />
          </div>
          {blocker && !canOpenWorktree && <div className="git-branch-hint">{blocker}</div>}
          <div id={`${id}-options`} role="listbox" aria-label="Branches" className="git-branch-options" aria-busy={pending}>
            {visible.map((option, index) => {
              const Marker = option.remote ? Cloud : option.linkedWorktree ? FolderGit2 : null;
              const isCurrent = option.ref === currentRef;
              const description = option.remote ? "Remote branch" : option.linkedWorktree ? "Linked worktree" : undefined;
              const reason = optionBlocker(option);
              return (
                <div key={option.ref} id={`${id}-option-${index}`} role="option"
                  aria-selected={option.ref === active?.ref} aria-disabled={Boolean(reason)}
                  aria-description={reason ? [description, reason].filter(Boolean).join(". ") : description}
                  className="git-branch-option" onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)} title={reason ?? (option.worktree ? "Open existing worktree" : description)}>
                  <span>
                    {option.label}
                    {option.blocker && <small>{option.blocker}</small>}
                  </span>
                  {(Marker || isCurrent) && <span className="git-branch-option-icons">
                    {Marker && <Marker size={14} aria-hidden="true" />}
                    {isCurrent && <Check size={14} aria-label="Current branch" />}
                  </span>}
                </div>
              );
            })}
          </div>
          {!pending && !visible.length && <div role="status" className="git-branch-hint">No matching branches.</div>}
        </div>
      )}
    </div>
  );
}
