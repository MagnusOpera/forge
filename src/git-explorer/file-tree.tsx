import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, File, FilePenLine, Folder } from "lucide-react";
import type { GitFile } from "../../shared/git-explorer";

type Entry = {
  key: string;
  name: string;
  children: Map<string, Entry> | null;
  file?: GitFile;
};

function buildTree(files: GitFile[]): Map<string, Entry> {
  const root = new Map<string, Entry>();
  for (const file of files) {
    const parts = file.path.split("/");
    const name = parts.pop()!;
    let children = root;
    let prefix = "";
    for (const part of parts) {
      prefix += part + "/";
      if (!children.has(prefix)) children.set(prefix, { key: prefix, name: part, children: new Map() });
      children = children.get(prefix)!.children!;
    }
    children.set(file.path, { key: file.path, name, children: null, file });
  }
  return root;
}

export function GitFileTree({ files, selected, onSelect, onOpenDiff }: {
  files: GitFile[];
  selected: string | null;
  onSelect(path: string): void;
  onOpenDiff(path: string): void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const rows: { entry: Entry; depth: number; parent: string | null }[] = [];
  const append = (entries: Map<string, Entry>, depth: number, parent: string | null) => {
    const ordered = [...entries.values()].sort((a, b) => Number(!a.children) - Number(!b.children) || a.name.localeCompare(b.name));
    for (const entry of ordered) {
      rows.push({ entry, depth, parent });
      if (entry.children && expanded.has(entry.key)) append(entry.children, depth + 1, entry.key);
    }
  };
  append(tree, 1, null);
  const focusKey = rows.find(({ entry }) => entry.key === focused)?.entry.key ?? rows[0]?.entry.key;
  const toggle = (key: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const { entry, parent } = rows[index];
    let next: string | null | undefined;
    switch (event.key) {
      case "ArrowDown": next = rows[index + 1]?.entry.key; break;
      case "ArrowUp": next = rows[index - 1]?.entry.key; break;
      case "Home": next = rows[0]?.entry.key; break;
      case "End": next = rows.at(-1)?.entry.key; break;
      case "ArrowRight":
        if (entry.children && !expanded.has(entry.key)) toggle(entry.key);
        else if (entry.children && rows[index + 1]?.parent === entry.key) next = rows[index + 1].entry.key;
        break;
      case "ArrowLeft":
        if (entry.children && expanded.has(entry.key)) toggle(entry.key);
        else next = parent;
        break;
      default: return;
    }
    event.preventDefault();
    if (next) buttons.current.get(next)?.focus();
  };

  if (!rows.length) return <p className="git-explorer-hint">No tracked or untracked files.</p>;
  return (
    <div role="tree" aria-label="Checkout files" className="git-file-tree">
      {rows.map(({ entry, depth }, index) => {
        const isOpen = expanded.has(entry.key);
        const status = entry.file?.status;
        const canDiff = status === "changed" || status === "conflict";
        const Chevron = isOpen ? ChevronDown : ChevronRight;
        return (
          <button key={entry.key} type="button" role="treeitem" aria-level={depth}
            aria-expanded={entry.children ? isOpen : undefined}
            aria-selected={entry.file ? selected === entry.key : undefined}
            aria-keyshortcuts={canDiff ? "Shift+Enter" : undefined}
            tabIndex={entry.key === focusKey ? 0 : -1}
            title={entry.key} className="git-tree-row" style={{ paddingInlineStart: 5 + (depth - 1) * 15 }}
            ref={(node) => {
              if (node) buttons.current.set(entry.key, node);
              else buttons.current.delete(entry.key);
            }}
            onFocus={() => setFocused(entry.key)}
            onKeyDown={(event) => {
              if (canDiff && event.shiftKey && event.key === "Enter") {
                event.preventDefault();
                onOpenDiff(entry.key);
                return;
              }
              navigate(event, index);
            }}
            onDoubleClick={canDiff ? () => onOpenDiff(entry.key) : undefined}
            onClick={() => {
              setFocused(entry.key);
              if (entry.children) toggle(entry.key);
              else onSelect(entry.key);
            }}>
            {entry.children ? <><Chevron size={12} aria-hidden="true" /><Folder size={14} aria-hidden="true" /></> :
              <File size={14} aria-hidden="true" />}
            <span className="git-tree-name">{entry.name}</span>
            {status === "changed" && <FilePenLine size={14} role="img" aria-label="Local changes" className="git-file-changed" />}
            {status === "conflict" && <AlertTriangle size={14} role="img" aria-label="Conflict" className="git-file-conflict" />}
          </button>
        );
      })}
    </div>
  );
}
