import { usePaneSurface } from "../pane-surface";
import { displayPath, displayPathText } from "../paths";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import {
  Code2,
  FileDiff,
  FolderOpen,
  GitCommitHorizontal,
  GitMerge,
  GitBranchPlus,
  GitPullRequestArrow,
  GitPullRequestClosed,
  Upload,
  X,
} from "lucide-react";
import type { CodexCheckoutPreview, CodexMergeConflict, CodexThreadSummary } from "../../shared/codex";
import {
  codexQuickActionUnavailable,
  type CodexQuickAction,
} from "../../shared/codexActions";
import { codexApi, errorMessage } from "./api";
import { CodexDiffDialog } from "./diff-dialog";
import { CheckoutDialog } from "./checkout-dialog";
export function CodexQuickActions({
  thread,
  theme,
  defaultBranch,
  group = "all",
}: {
  thread?: CodexThreadSummary;
  theme: "light" | "dark";
  defaultBranch?: string | null;
  group?: "all" | "checkout" | "git";
}) {
  const { document, portalRoot } = usePaneSurface();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false),
    [diff, setDiff] = useState(false);
  const [mergeConflict, setMergeConflict] = useState<CodexMergeConflict | null>(null);
  const [checkoutReview, setCheckoutReview] = useState<CodexCheckoutPreview | null>(null);
  useEffect(() => {
    setError("");
    setMergeConflict(null);
    setCheckoutReview(null);
  }, [thread?.id, thread?.repositoryId]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const execute = async (action: () => Promise<void>) => {
    setError("");
    setMergeConflict(null);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const unavailable = codexQuickActionUnavailable(thread);
  const reviewCheckout = async (action: "merge" | "worktree") => {
    if (!thread) return;
    const result = await codexApi().request("checkoutPreview", { repositoryId: thread.repositoryId, id: thread.id, action });
    setCheckoutReview(result?.preview ?? null);
    if (result?.conflict) setMergeConflict(result.conflict);
  };
  const actions: {
    action: CodexQuickAction;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      action: "sync",
      label: defaultBranch ? `Merge ${defaultBranch}` : "Merge default branch",
      icon: <GitMerge size={16} />,
    },
    {
      action: "commit",
      label: "Commit",
      icon: <GitCommitHorizontal size={16} />,
    },
    { action: "push", label: "Push", icon: <Upload size={16} /> },
    {
      action: "create-pr",
      label: "Create PR",
      icon: <GitPullRequestArrow size={16} />,
    },
  ];
  return (
    <>
      <div
        className="codex-quick-actions"
        role="group"
        aria-label="Worktree quick actions"
      >
        {group !== "git" && (
          <>
            {thread?.worktree && (
              <button
                type="button"
                className={`icon-button codex-checkout-label underline-action ${copied ? "invoked" : ""}`}
                aria-label="Copy checkout location"
                title={`${displayPath(thread.worktree, Boolean(thread.environment))}\nClick to copy path`}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(thread.worktree)
                    .then(() => {
                      setCopied(true);
                      if (timer.current) clearTimeout(timer.current);
                      timer.current = setTimeout(() => setCopied(false), 900);
                    })
                    .catch((e) => setError(errorMessage(e)));
                }}
              >
                {thread.checkout === "default" ? thread.branch : "Worktree"}
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label="Open checkout in Finder"
              title={
                thread?.environment
                  ? "Finder is unavailable for remote threads"
                  : "Open checkout in Finder"
              }
              disabled={
                !thread?.worktree || Boolean(thread.environment) || busy
              }
              onClick={() => {
                if (thread)
                  void execute(async () => {
                    await codexApi().request("openFolder", {
                      repositoryId: thread.repositoryId,
                      id: thread.id,
                    });
                  });
              }}
            >
              <FolderOpen size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="Open checkout in text editor"
              title={
                thread?.environment
                  ? "Local editors cannot open remote checkouts"
                  : "Open checkout in text editor"
              }
              disabled={
                !thread?.worktree || Boolean(thread.environment) || busy
              }
              onClick={() => {
                if (thread)
                  void execute(async () => {
                    await codexApi().request("openEditor", {
                      repositoryId: thread.repositoryId,
                      id: thread.id,
                    });
                  });
              }}
            >
              <Code2 size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="Diff checkout changes"
              title={
                thread?.environment
                  ? "Diff is unavailable for remote threads"
                  : "Diff checkout changes"
              }
              disabled={!thread?.worktree || Boolean(thread.environment)}
              onClick={() => setDiff(true)}
            >
              <FileDiff size={16} />
            </button>
          </>
        )}
        {group === "all" && <span className="toolbar-divider" />}
        {group !== "checkout" && thread && !thread.sourceHome && (
          <button
            className="icon-button"
            aria-label={
              thread.checkout === "default"
                ? "Start worktree"
                : `Merge into ${defaultBranch || "default branch"}`
            }
            title={
              unavailable ||
              (thread.checkout === "default"
                ? "Start worktree"
                : `Merge into ${defaultBranch || "default branch"}`)
            }
            disabled={busy || Boolean(unavailable)}
            onClick={() =>
              void execute(async () => {
                await reviewCheckout(thread.checkout === "default" ? "worktree" : "merge");
              })
            }
          >
            {thread.checkout === "default" ? (
              <GitBranchPlus size={16} />
            ) : (
              <GitPullRequestClosed size={16} />
            )}
          </button>
        )}
        {group !== "checkout" &&
          actions
            .filter(
              (action) =>
                thread?.checkout !== "default" ||
                ((thread.start?.kind === "new" || thread.start?.kind === "current") && thread.branch !== defaultBranch) ||
                !["sync", "create-pr"].includes(action.action),
            )
            .map((action) => (
              <button
                key={action.action}
                className="icon-button"
                aria-label={action.label}
                title={unavailable || action.label}
                disabled={busy || Boolean(unavailable)}
                onClick={() => {
                  if (thread)
                    void execute(async () => {
                      await codexApi().request("quickAction", {
                        repositoryId: thread.repositoryId,
                        id: thread.id,
                        action: action.action,
                      });
                    });
                }}
              >
                {action.icon}
              </button>
            ))}
        {(error || mergeConflict) && (
          <div className="codex-action-error" role="alert">
            <span>
              {displayPathText(error) || (mergeConflict && <span className="codex-conflict-resolution">
                <span>Changes conflict with {mergeConflict.defaultBranch} in: {mergeConflict.files.map(file => displayPath(file)).join(", ")}. Codex can resolve them in this worktree before you retry the merge.</span>
                <button
                  className="ghost-button"
                  disabled={busy || Boolean(unavailable)}
                  onClick={() => {
                    if (thread) void execute(async () => {
                      await codexApi().request("resolveMergeConflicts", {
                        repositoryId: thread.repositoryId, id: thread.id,
                      });
                    });
                  }}
                >Resolve with Codex</button>
              </span>)}
            </span>
            <button
              className="icon-button"
              aria-label="Dismiss Git action error"
              onClick={() => { setError(""); setMergeConflict(null); }}
            >
              <X size={13} />
            </button>
          </div>
        )}
      </div>
      {diff &&
        thread &&
        createPortal(
          <CodexDiffDialog
            thread={thread}
            theme={theme}
            onClose={() => setDiff(false)}
          />,
          portalRoot ?? document.querySelector(".app-shell") ?? document.body,
        )}
      {checkoutReview && thread && createPortal(
        <CheckoutDialog
          preview={checkoutReview}
          onClose={() => setCheckoutReview(null)}
          onReview={() => reviewCheckout(checkoutReview.action)}
          onConfirm={async (choice) => {
            const result = await codexApi().request("checkout", {
              repositoryId: thread.repositoryId, id: thread.id, action: checkoutReview.action,
              token: checkoutReview.token, ...choice,
            });
            setCheckoutReview(null);
            if (result?.conflict) setMergeConflict(result.conflict);
          }}
        />,
        portalRoot ?? document.querySelector(".app-shell") ?? document.body,
      )}
    </>
  );
}
