import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import {
  Check,
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
import type { CodexThreadSummary } from "../../shared/codex";
import {
  codexQuickActionUnavailable,
  type CodexQuickAction,
} from "../../shared/codexActions";
import { githubUrlClickActionForDetail } from "../appLogic";
import { codexApi, errorMessage } from "./api";
import { CodexDiffDialog } from "./diff-dialog";
export function CodexQuickActions({
  thread,
  theme,
  defaultBranch,
}: {
  thread?: CodexThreadSummary;
  theme: "light" | "dark";
  defaultBranch?: string | null;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false),
    [diff, setDiff] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const execute = async (action: () => Promise<void>) => {
    setError("");
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
        {thread?.worktree && (
          <span
            className="codex-checkout-label"
            title={`${thread.branch} · ${thread.worktree}`}
          >
            {thread.checkout === "default" ? thread.branch : "Worktree"}
          </span>
        )}
        <button
          className={`icon-button underline-action ${copied ? "invoked" : ""}`}
          aria-label="Copy checkout location. Double-click to open in Finder"
          title={
            thread?.worktree
              ? `${thread.worktree}\nClick to copy · Double-click to open in Finder`
              : "No worktree selected"
          }
          disabled={!thread?.worktree}
          onClick={(event) => {
            if (!thread?.worktree) return;
            if (githubUrlClickActionForDetail(event.detail) === "open") {
              void execute(async () => {
                await codexApi().request("openFolder", {
                  repositoryId: thread.repositoryId,
                  id: thread.id,
                });
              });
            } else {
              void navigator.clipboard
                .writeText(thread.worktree)
                .then(() => {
                  setCopied(true);
                  if (timer.current) clearTimeout(timer.current);
                  timer.current = setTimeout(() => setCopied(false), 900);
                })
                .catch((e) => setError(errorMessage(e)));
            }
          }}
        >
          {copied ? <Check size={16} /> : <FolderOpen size={16} />}
        </button>
        <button
          className="icon-button"
          aria-label="Open checkout in text editor"
          title="Open checkout in text editor"
          disabled={!thread?.worktree || busy}
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
          title="Diff checkout changes"
          disabled={!thread?.worktree}
          onClick={() => setDiff(true)}
        >
          <FileDiff size={16} />
        </button>
        <span className="toolbar-divider" />
        {thread && !thread.sourceHome && (
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
                await codexApi().request("checkout", {
                  repositoryId: thread.repositoryId,
                  id: thread.id,
                  action: thread.checkout === "default" ? "worktree" : "merge",
                });
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
        {actions
          .filter(
            (action) =>
              thread?.checkout !== "default" ||
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
        {error && (
          <div className="codex-action-error" role="alert">
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="Dismiss Git action error"
              onClick={() => setError("")}
            >
              <X size={13} />
            </button>
          </div>
        )}
      </div>
      <span className="toolbar-divider" />
      {diff &&
        thread &&
        createPortal(
          <CodexDiffDialog
            thread={thread}
            theme={theme}
            onClose={() => setDiff(false)}
          />,
          document.querySelector(".app-shell") ?? document.body,
        )}
    </>
  );
}
