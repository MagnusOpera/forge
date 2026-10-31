import { displayPath, displayPathText } from "../paths";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { CodexCheckoutPreview, CodexMergeChoice } from "../../shared/codex";
import { errorMessage } from "./api";

export function CheckoutDialog({ preview, onConfirm, onReview, onClose }: {
  preview: CodexCheckoutPreview;
  onConfirm: (choice: CodexMergeChoice) => Promise<void>;
  onReview: () => Promise<void>;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<CodexMergeChoice["method"]>("squash");
  const [message, setMessage] = useState(preview.message);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef({ busy, onClose });
  latest.current = { busy, onClose };
  useEffect(() => setError(""), [preview.token]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLButtonElement>(".codex-checkout-cancel")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!latest.current.busy) latest.current.onClose();
      }
      if (event.key !== "Tab") return;
      const controls = [...(root.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), summary") ?? [])];
      if (!controls.length) return;
      const index = controls.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
    };
    document.addEventListener("keydown", keydown, true);
    return () => { document.removeEventListener("keydown", keydown, true); previous?.focus(); };
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  const merging = preview.action === "merge";
  const confirmLabel = merging ? method === "squash" ? "Squash and continue" : "Merge and continue" : "Start worktree";
  return (
    <div className="codex-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <div className="codex-settings-dialog codex-checkout-dialog" role="dialog" aria-modal="true" aria-labelledby="codex-checkout-title" ref={root}>
        <header>
          <h2 id="codex-checkout-title">{merging ? `Integrate into ${preview.targetBranch}` : "Start a worktree"}</h2>
          <button className="icon-button" aria-label="Close checkout review" disabled={busy} onClick={onClose}><X size={18} /></button>
        </header>
        <div className="codex-checkout-content">
          <p className="codex-checkout-branches"><span>{preview.sourceBranch}</span><span aria-hidden="true">→</span><strong>{preview.targetBranch}</strong></p>
          {merging && <>
            <p>{preview.commits} source {preview.commits === 1 ? "commit" : "commits"}{method === "squash" ? ` → one commit on ${preview.targetBranch}` : " · preserve commit history"}</p>
            <fieldset className="codex-merge-options" disabled={busy}>
              <legend>Integration method</legend>
              <label><input type="radio" name="merge-method" value="squash" checked={method === "squash"} onChange={() => setMethod("squash")} /><span><strong>Squash merge</strong><small>Combine the changes into one commit. Recommended.</small></span></label>
              <label><input type="radio" name="merge-method" value="merge" checked={method === "merge"} onChange={() => setMethod("merge")} /><span><strong>Merge</strong><small>Keep individual commits and create a merge commit when needed.</small></span></label>
            </fieldset>
            {method === "squash" && <label className="codex-field">Commit message<input aria-label="Squash commit message" value={message} maxLength={2000} disabled={busy} onChange={(event) => setMessage(event.target.value)} /></label>}
            {preview.summary && <details><summary>Source commits</summary><pre className="codex-checkout-summary">{displayPathText(preview.summary)}</pre></details>}
          </>}
          <p>{merging ? "The changes are prepared and verified before the default checkout is updated. The source branch and chat history are kept; the worktree is removed after successful integration." : "Continue this chat in a fresh, isolated worktree from the current commit."}</p>
          <p className="codex-muted">This chat’s terminal and child jobs will stop. All changes stay local.</p>
          <details><summary>Checkout folders</summary><p className="codex-path">From: {displayPath(preview.sourcePath)}<br />Continue in: {displayPath(preview.targetPath)}</p></details>
          {error && <div className="inline-error" role="alert">{error}<button className="ghost-button" disabled={busy} onClick={() => void run(onReview)}>Review again</button></div>}
        </div>
        <footer className="codex-actions">
          <button className="ghost-button codex-checkout-cancel" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="primary-button" disabled={busy || Boolean(error) || (merging && method === "squash" && !message.trim())} onClick={() => void run(() => onConfirm({ method, message: message.trim() }))}>{busy ? "Applying…" : confirmLabel}</button>
        </footer>
      </div>
    </div>
  );
}
