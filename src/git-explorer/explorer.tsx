import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDownToLine, GitBranch, Loader2, X } from "lucide-react";
import type { RepoSummary } from "../../shared/github";
import type { GitAction, GitPreview, GitSnapshot } from "../../shared/git-explorer";
import { codexApi, errorMessage } from "../codex/api";
import { DiffDialog } from "../codex/diff-dialog";
import { usePaneSurface } from "../pane-surface";
import { displayPathText } from "../paths";
import { BranchPicker } from "./branch-picker";
import { GitFileTree } from "./file-tree";
import "./explorer.css";

type ExplorerAction = GitAction & { kind: "pull" | "switch" };

const failureTitles: Record<ExplorerAction["kind"], string> = {
  pull: "Pull failed",
  switch: "Branch switch failed",
};

const previewMessages = {
  missing: "This file is missing from the working tree.",
  binary: "This file cannot be displayed as text.",
  "too-large": "This file exceeds the 512 KiB preview limit.",
  unsupported: "Symbolic links, submodules, and other special files cannot be previewed.",
};

type PreviewResult = {
  snapshot: GitSnapshot;
  file: string;
  result: GitPreview | { kind: "error"; message: string };
};

export function GitExplorer({ repo, treeHost, theme, refreshSequence, onConfigure, onFileGithubUrlChange }: {
  repo: RepoSummary;
  treeHost: HTMLElement | null;
  theme: "light" | "dark";
  refreshSequence: number;
  onConfigure(): void;
  onFileGithubUrlChange(url: string | null): void;
}) {
  const { document, portalRoot } = usePaneSurface();
  const [worktree, setWorktree] = useState<string>();
  const [diffFile, setDiffFile] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<GitSnapshot>();
  const [file, setFile] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [operation, setOperation] = useState<ExplorerAction["kind"]>();
  const [feedback, setFeedback] = useState<string>();
  const [failure, setFailure] = useState<{ title: string; message: string }>();
  const busy = useRef(false);
  const ready = snapshot?.kind === "ready" ? snapshot : null;
  const selected = ready?.files.some((entry) => entry.path === file) ? file : null;
  const filePreview = preview?.snapshot === snapshot && preview?.file === selected ? preview?.result : undefined;
  const revision = ready?.revision;
  const checkout = ready?.checkout;
  const loadDiff = useCallback(async () => {
    if (!diffFile || !revision) throw new Error("The checkout is unavailable.");
    return codexApi().request("gitFileDiff", { repositoryId: repo.id, revision, path: diffFile, worktree: checkout });
  }, [repo.id, revision, diffFile, checkout]);


  useEffect(() => {
    const api = window.forgeCodex;
    if (!api) return;
    let timer: ReturnType<typeof setTimeout>;
    const unsubscribe = api.onChanged((change) => {
      if (change.repositoryId !== repo.id || busy.current) return;
      clearTimeout(timer);
      timer = setTimeout(() => setRefresh((value) => value + 1), change.threadId ? 400 : 0);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [repo.id]);

  useEffect(() => {
    const api = window.forgeCodex;
    if (!api) {
      setError("Git Explorer requires the Forge desktop app.");
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    void api.request("gitSnapshot", { repositoryId: repo.id, worktree }).then((next) => {
      if (!active) return;
      setSnapshot(next);
      if (worktree && next.kind === "ready" && next.checkout !== worktree) setWorktree(next.checkout);
      setFile((current) => next.kind === "ready" && next.files.some((entry) => entry.path === current) ? current : null);
      setError("");
    }).catch((failure) => {
      if (!active) return;
      setSnapshot(undefined);
      setError(errorMessage(failure));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [repo.id, refresh, refreshSequence, worktree]);

  useEffect(() => setFeedback(undefined), [refreshSequence]);

  useEffect(() => {
    if (!ready || !selected || !window.forgeCodex || operation || loading) return;
    let active = true;
    const show = (result: PreviewResult["result"]) => {
      if (active) setPreview({ snapshot: ready, file: selected, result });
    };
    void window.forgeCodex.request("gitPreview", {
      repositoryId: repo.id, revision: ready.revision, path: selected, worktree: ready.checkout,
    }).then(show, (failure) => show({ kind: "error", message: errorMessage(failure) }));
    return () => { active = false; };
  }, [ready, selected, repo.id, operation, loading]);

  const act = (action: ExplorerAction) => {
    if (!ready || busy.current || loading || !window.forgeCodex) return;
    const opensWorktree = action.kind === "switch" &&
      ready.branches.some((branch) => branch.ref === action.ref && branch.worktree);
    if (!opensWorktree && ready.blockers[action.kind]) return;
    busy.current = true;
    setOperation(action.kind);
    setFeedback(undefined);
    void window.forgeCodex.request("gitAction", {
      repositoryId: repo.id, revision: ready.revision, action, worktree: ready.checkout,
    }).then(
      ({ message, checkout }) => {
        setFeedback(message);
        if (checkout === ready.checkout) return;
        setFile(null);
        setDiffFile(null);
        setWorktree(checkout);
      },
      (error) => setFailure({ title: failureTitles[action.kind], message: errorMessage(error) }),
    ).finally(() => {
      busy.current = false;
      setLoading(true);
      setOperation(undefined);
      setRefresh((value) => value + 1);
    });
  };

  const navigationBlocker = operation ? "A Git action is in progress." : loading ? "Reading the checkout…" : null;
  const blocker = (kind: ExplorerAction["kind"]) => navigationBlocker ?? ready?.blockers[kind] ?? null;
  const pullBlocker = blocker("pull") ?? (!ready ? "Configure a local checkout first." : null);
  const publishedCommit = filePreview && "publishedCommit" in filePreview ? filePreview.publishedCommit : undefined;
  const fileGithubUrl = selected && publishedCommit
    ? `${repo.url}/blob/${publishedCommit}/${selected.split("/").map(encodeURIComponent).join("/")}`
    : null;
  useLayoutEffect(() => {
    onFileGithubUrlChange(fileGithubUrl);
    return () => onFileGithubUrlChange(null);
  }, [fileGithubUrl, onFileGithubUrlChange]);
  const workingMessage = operation === "switch" ? "Switching branches…" : "Pulling the current branch…";

  return (
    <main className="content-pane git-explorer-content" tabIndex={0} aria-label="Git Explorer">
      {treeHost && createPortal(
        ready ? <>
          <BranchPicker branch={ready.branch} branches={ready.branches} blocker={blocker("switch")}
            navigationBlocker={navigationBlocker} onSwitch={(ref) => void act({ kind: "switch", ref })} />
          <GitFileTree key={ready.checkout} files={ready.files} selected={selected} onSelect={setFile}
            onOpenDiff={(path) => { if (!loading && !operation) setDiffFile(path); }} />
        </> :
          <p className="git-explorer-hint">{error || snapshot?.kind === "setup" && snapshot.message || "Reading the checkout…"}</p>,
        treeHost,
      )}
      <div className="content-header app-drag">
        <div className="content-header-left">
          <div className="content-title git-explorer-title">
            <GitBranch size={15} aria-hidden="true" />
            <span title={selected ?? "Git Explorer"}>{selected ?? "Git Explorer"}</span>
          </div>
        </div>
        <div className="header-actions git-explorer-actions" role="toolbar" aria-label="Git actions">
          <span title={pullBlocker ? `Pull · ${pullBlocker}` : "Pull"}>
            <button type="button" className="icon-button" aria-label="Pull" aria-description={pullBlocker ?? undefined}
              disabled={Boolean(pullBlocker)} onClick={() => void act({ kind: "pull" })}>
              {operation === "pull" ? <Loader2 size={16} className="spin" aria-hidden="true" /> :
                <ArrowDownToLine size={16} aria-hidden="true" />}
            </button>
          </span>
        </div>
      </div>
      {ready && (
        <div className="git-checkout-status">
          <span className="git-checkout-path" title={displayPathText(ready.checkout)}>{displayPathText(ready.checkout)}</span>
          <span className="git-upstream" title={ready.pushDestination ? `Upstream ${ready.pushDestination}` : "No remote upstream"}>
            {ready.pushDestination ?? "No upstream"}
          </span>
        </div>
      )}
      {(operation || feedback) && (
        <p className="git-explorer-message" role="status">{operation ? workingMessage : feedback}</p>
      )}
      {diffFile && createPortal(
        <DiffDialog title={diffFile} theme={theme} load={loadDiff} onClose={() => setDiffFile(null)}
          emptyMessage="No local changes to this file." />,
        portalRoot ?? document.querySelector(".app-shell") ?? document.body,
      )}
      {failure && <GitActionErrorDialog {...failure} onDismiss={() => setFailure(undefined)} />}
      {!ready && (
        <div className="content-scroll git-explorer-empty">
          <p>{error || (snapshot?.kind === "setup" ? snapshot.message : "Reading the checkout…")}</p>
          {snapshot?.kind === "setup" && <button type="button" className="ghost-button" onClick={onConfigure}>Configure local checkout</button>}
        </div>
      )}
      {ready && (!selected ? (
        <div className="content-scroll git-explorer-empty">Select a file to preview its working-tree content.</div>
      ) : !filePreview ? (
        <div className="content-scroll git-explorer-empty" role="status">Reading file…</div>
      ) : filePreview.kind === "text" ? (
        <pre className="git-file-preview" tabIndex={0} aria-label={`File preview: ${selected}`}>{filePreview.text}</pre>
      ) : (
        <div className="content-scroll git-explorer-empty">
          {filePreview.kind === "error" ? filePreview.message : previewMessages[filePreview.kind]}
        </div>
      ))}
    </main>
  );
}

function GitActionErrorDialog({ title, message, onDismiss }: {
  title: string;
  message: string;
  onDismiss(): void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal?.();
    element?.querySelector<HTMLButtonElement>("footer button")?.focus();
  }, []);

  const dismiss = () => {
    dialog.current?.close?.();
    onDismiss();
  };
  const details = message.replace(/^error:[ \t]*/gim, "").replace(/\r?\nAborting\s*$/i, "");
  return (
    <dialog ref={dialog} className="codex-settings-dialog git-action-error-dialog" role="alertdialog"
      aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-details`}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}>
      <header>
        <h2 id={`${id}-title`}>{title}</h2>
        <button type="button" className="icon-button" aria-label="Close Git error" title="Close" onClick={dismiss}>
          <X size={17} aria-hidden="true" />
        </button>
      </header>
      <pre id={`${id}-details`} tabIndex={0}>{details}</pre>
      <footer>
        <button type="button" className="ghost-button" onClick={dismiss}>Close</button>
      </footer>
    </dialog>
  );
}
