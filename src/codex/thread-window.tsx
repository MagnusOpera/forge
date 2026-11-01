import { displayPathText } from "../paths";
import { useEffect, useState, type CSSProperties } from "react";
import { TerminalSquare } from "lucide-react";
import type { CodexThreadWindow } from "../../shared/codex";
import type { RepoSummary } from "../../shared/github";
import { codexApi, errorMessage, useCodexThreads } from "./api";
import { ThreadWorkspace } from "./thread-workspace";
import { CodexQuickActions } from "./quick-actions";
import { CodexSettingsDialog } from "./settings";
import { flushThreadDraft } from "./thread-drafts";

function stored<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export function ThreadWindow() {
  const [context, setContext] = useState<CodexThreadWindow | null>(null);
  const [error, setError] = useState("");
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [projectConfigurationOpen, setProjectConfigurationOpen] =
    useState(false);
  const [, setAppearance] = useState(0);
  const [darkSystem, setDarkSystem] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const preference = stored<string>("github-focus:theme", "system");
  const theme =
    preference === "system"
      ? darkSystem
        ? "dark"
        : "light"
      : preference === "dark"
        ? "dark"
        : "light";
  const accent = stored<string>(
    `github-focus:accent-color:${theme}`,
    theme === "dark" ? "#7ee787" : "#79c0ff",
  );
  const { threads } = useCodexThreads(context?.repositoryId);
  const thread = threads.find((thread) => thread.id === context?.id);
  useEffect(() => {
    let active = true;
    void codexApi()
      .request("threadWindowContext", {})
      .then((value) => {
        if (!active) return;
        if (!value) throw new Error("No thread is assigned to this window.");
        setContext(value);
        setTerminalOpen(value.terminalOpen);
      })
      .catch((error) => {
        if (active) setError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const changed = () => setDarkSystem(media.matches);
    const storage = () => setAppearance((value) => value + 1);
    media.addEventListener("change", changed);
    window.addEventListener("storage", storage);
    return () => {
      media.removeEventListener("change", changed);
      window.removeEventListener("storage", storage);
    };
  }, []);
  useEffect(() => {
    if (thread && context)
      document.title = `${displayPathText(thread.title, Boolean(thread.environment))} · ${context.fullName} · Forge`;
  }, [thread?.title, context?.fullName]);
  useEffect(() => {
    if (!context) return;
    let closing = false;
    return codexApi().onChanged((change) => {
      if (!change.windowCloseRequested || closing) return;
      closing = true;
      void flushThreadDraft(context.repositoryId, context.id)
        .then(() => codexApi().request("closeThreadWindow", {}))
        .catch((error) => {
          closing = false;
          setError(errorMessage(error));
          void codexApi()
            .request("cancelThreadWindowClose", {})
            .catch(() => undefined);
        });
    });
  }, [context]);
  const [owner, name] = context?.fullName.split("/") ?? [];
  const repo: RepoSummary | undefined = context
    ? {
        id: context.repositoryId,
        owner: owner ?? "",
        name: name ?? context.fullName,
        fullName: context.fullName,
        defaultBranch: context.defaultBranch,
        isPrivate: false,
        isArchived: false,
        isFork: false,
        url: `https://github.com/${context.fullName}`,
      }
    : undefined;
  const openUrl = (url: string) => {
    void codexApi()
      .request("openLink", { url })
      .catch((error) => setError(errorMessage(error)));
  };
  return (
    <div
      className="app-shell thread-window-shell"
      data-theme={theme}
      data-sidebar-appearance="normal"
      style={
        {
          "--accent": /^#[\da-f]{6}$/i.test(accent) ? accent : "#79c0ff",
        } as CSSProperties
      }
    >
      <header className="content-header app-drag thread-window-header">
        <div className="content-header-left">
          <strong title={context?.fullName}>
            {thread ? displayPathText(thread.title, Boolean(thread.environment)) : context?.title || "Codex"}
          </strong>
        </div>
        <div className="header-actions">
          <CodexQuickActions thread={thread} theme={theme} group="checkout" />
          <button
            className="icon-button"
            aria-label="Toggle terminal"
            title="Toggle terminal"
            aria-pressed={terminalOpen && !thread?.archived}
            disabled={!thread || thread.archived}
            onClick={() => setTerminalOpen((value) => !value)}
          >
            <TerminalSquare size={16} />
          </button>
        </div>
      </header>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {context && (
        <ThreadWorkspace
          repositoryId={context.repositoryId}
          id={context.id}
          thread={thread}
          theme={theme}
          terminalOpen={terminalOpen}
          onConfigure={() => setProjectConfigurationOpen(true)}
          onHideTerminal={() => setTerminalOpen(false)}
          quickActions={
            <CodexQuickActions
              thread={thread}
              theme={theme}
              defaultBranch={context.defaultBranch}
              group="git"
            />
          }
        />
      )}
      {projectConfigurationOpen && (
        <CodexSettingsDialog
          project={repo}
          auth={null}
          onClose={() => setProjectConfigurationOpen(false)}
          onSignInGithub={async () => {}}
          onRemoveGithub={() => {}}
          onOpenUrl={openUrl}
        />
      )}
    </div>
  );
}
