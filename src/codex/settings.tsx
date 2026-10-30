import { useEffect, useRef, useState } from "react";
import { FolderOpen, RefreshCw, X } from "lucide-react";
import type { AuthStatus, RepoSummary } from "../../shared/github";
import type {
  CodexConfiguration,
  CodexPreferences,
  CodexStatus,
} from "../../shared/codex";
import { DEFAULT_TEXT_EDITOR } from "../../shared/codex";
import { CLASSIC_TOKEN_SETTINGS_URL } from "../../shared/auth";
import { codexApi, errorMessage } from "./api";
import { PreferencesEditor, useCodexModels } from "./preferences";
export function CodexSettingsDialog({
  project,
  auth,
  onClose,
  onSaveGithub,
  onRemoveGithub,
  onOpenUrl,
}: {
  project?: RepoSummary;
  auth: AuthStatus | null;
  onClose: () => void;
  onSaveGithub: (token: string) => Promise<void>;
  onRemoveGithub: () => void;
  onOpenUrl: (url: string) => void;
}) {
  const [configuration, setConfiguration] = useState<CodexConfiguration | null>(
    null,
  );
  const [preferences, setPreferences] = useState<Partial<CodexPreferences>>({});
  const [executable, setExecutable] = useState("");
  const [editor, setEditor] = useState(DEFAULT_TEXT_EDITOR);
  const [status, setStatus] = useState<CodexStatus | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [waitingLogin, setWaitingLogin] = useState(false);
  const { models, error: modelsError } = useCodexModels();
  const root = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const operation = async (run: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await run();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLElement>("button, input, select")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key === "Tab") {
        const controls = Array.from(
          root.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]",
          ) ?? [],
        );
        const index = controls.indexOf(document.activeElement as HTMLElement);
        const next =
          (index + (event.shiftKey ? -1 : 1) + controls.length) %
          controls.length;
        event.preventDefault();
        controls[next]?.focus();
      }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (!window.forgeCodex) {
      setError("Codex requires the Forge desktop app.");
      return;
    }
    void codexApi()
      .request("configuration", {})
      .then((c) => {
        if (!active) return;
        setConfiguration(c);
        setExecutable(c.executable);
        setEditor(c.editor ?? DEFAULT_TEXT_EDITOR);
        setPreferences(
          project ? (c.projects[project.id]?.overrides ?? {}) : c.defaults,
        );
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    const refreshStatus = () =>
      void codexApi()
        .request("status", {})
        .then((s) => {
          if (active) {
            setStatus(s);
            setWaitingLogin(Boolean(s.loginPending) && !s.authenticated);
          }
        })
        .catch((e) => {
          if (active) setError(errorMessage(e));
        });
    if (!project) refreshStatus();
    const unsubscribe = codexApi().onChanged((change) => {
      if (!change.threadId && !project) {
        if (change.connectionError) {
          setStatus({
            connected: false,
            authenticated: false,
            error: change.connectionError,
          });
          setWaitingLogin(false);
          return;
        }
        if (change.auth) {
          setWaitingLogin(false);
          if (!change.auth.success)
            setError(change.auth.error || "ChatGPT sign-in failed.");
        }
        refreshStatus();
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [project?.id]);
  const binding = project ? configuration?.projects[project.id] : undefined;
  return (
    <div
      className="modal-backdrop codex-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="codex-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="codex-settings-title"
        ref={root}
      >
        <header>
          <h2 id="codex-settings-title">
            {project ? `${project.name} configuration` : "Global configuration"}
          </h2>
          <button
            className="icon-button"
            aria-label="Close configuration"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </header>
        <div className="codex-settings-scroll">
          {!project && (
            <section>
              <h3>GitHub account</h3>
              <p>
                {auth?.configured
                  ? `Connected${auth.viewerLogin ? ` as ${auth.viewerLogin}` : ""}`
                  : "No GitHub token configured"}
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void operation(async () => {
                    await onSaveGithub(token.trim());
                    setToken("");
                  });
                }}
              >
                <label className="codex-field">
                  <span>
                    {auth?.configured
                      ? "Replace classic personal access token"
                      : "Classic personal access token"}
                  </span>
                  <input
                    type="password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="ghp_…"
                  />
                </label>
                <div className="codex-actions">
                  <button
                    type="submit"
                    className="ghost-button"
                    disabled={busy || !token.trim()}
                  >
                    Save token
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => onOpenUrl(CLASSIC_TOKEN_SETTINGS_URL)}
                  >
                    GitHub token settings
                  </button>
                  {auth?.configured && (
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={onRemoveGithub}
                    >
                      Remove token
                    </button>
                  )}
                </div>
              </form>
              <p className="codex-muted">
                The token stays encrypted in Forge's main process.
              </p>
            </section>
          )}
          {!project && (
            <section>
              <h3>Codex account</h3>
              <p>
                {status?.authenticated
                  ? `Signed in${status.email ? ` as ${status.email}` : ""}${status.plan ? ` · ${status.plan}` : ""}`
                  : status?.connected
                    ? "Not signed in"
                    : "Codex unavailable"}
              </p>
              {status?.error && <p className="codex-muted">{status.error}</p>}
              {status?.version && <small>{status.version}</small>}
              <div className="codex-actions">
                <button
                  className="ghost-button"
                  disabled={busy}
                  onClick={() =>
                    void operation(async () => {
                      setStatus(await codexApi().request("status", {}));
                    })
                  }
                >
                  <RefreshCw size={13} />
                  Refresh
                </button>
                {status?.authenticated ? (
                  <button
                    className="ghost-button"
                    disabled={busy}
                    onClick={() =>
                      void operation(async () => {
                        await codexApi().request("logout", {});
                        setStatus(await codexApi().request("status", {}));
                      })
                    }
                  >
                    Sign out
                  </button>
                ) : (
                  <button
                    className="ghost-button"
                    disabled={busy || waitingLogin || !status?.connected}
                    onClick={() =>
                      void operation(async () => {
                        await codexApi().request("login", {});
                        setWaitingLogin(true);
                      })
                    }
                  >
                    {waitingLogin
                      ? "Waiting for browser sign-in"
                      : "Sign in with ChatGPT"}
                  </button>
                )}
              </div>
              {waitingLogin && (
                <button
                  className="ghost-button"
                  disabled={busy}
                  onClick={() =>
                    void operation(async () => {
                      await codexApi().request("cancelLogin", {});
                      setWaitingLogin(false);
                    })
                  }
                >
                  Cancel sign-in
                </button>
              )}
              <p className="codex-muted">
                This account belongs to Forge. Other Codex apps and CLI
                credentials are separate.
              </p>
            </section>
          )}
          {project && (
            <section>
              <h3>Local Git folder</h3>
              <p className="codex-path">
                {binding?.path || "No folder selected"}
              </p>
              <button
                className="ghost-button"
                disabled={busy}
                onClick={() =>
                  void operation(async () => {
                    setConfiguration(
                      await codexApi().request("pickFolder", {
                        repositoryId: project.id,
                        fullName: project.fullName,
                      }),
                    );
                  })
                }
              >
                <FolderOpen size={14} />
                Choose folder
              </button>
              {binding?.warning && <p role="note">{binding.warning}</p>}
              <p className="codex-muted">
                New threads start from committed HEAD in a separate worktree.
                Uncommitted checkout changes are excluded. Existing threads
                retain their original folder.
              </p>
            </section>
          )}
          {configuration && (
            <section>
              <h3>{project ? "Codex overrides" : "Codex defaults"}</h3>
              <p className="codex-muted">
                {project
                  ? "Each setting inherits the global value until overridden."
                  : "Defaults apply to new threads. Existing threads keep their settings."}
              </p>
              <PreferencesEditor
                value={preferences}
                inherited={project ? configuration.defaults : undefined}
                models={models}
                onChange={setPreferences}
              />
              {modelsError && (
                <p className="codex-muted">
                  Model catalog unavailable. {modelsError}
                </p>
              )}
            </section>
          )}
          {!project && (
            <section>
              <h3>Text editor</h3>
              <div className="codex-field">
                <span>Application name or .app path</span>
                <div className="codex-field-control">
                  <input
                    aria-label="Text editor application"
                    value={editor}
                    onChange={(event) => setEditor(event.target.value)}
                    placeholder={DEFAULT_TEXT_EDITOR}
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Choose text editor application"
                    title="Choose application"
                    disabled={busy}
                    onClick={() =>
                      void operation(async () => {
                        const selected = await codexApi().request(
                          "pickEditor",
                          {},
                        );
                        if (selected) setEditor(selected);
                      })
                    }
                  >
                    <FolderOpen size={16} />
                  </button>
                </div>
              </div>
              <p className="codex-muted">
                The editor button beside Finder opens the selected chat's
                worktree. Defaults to Visual Studio Code; no command-line
                launcher is required.
              </p>
            </section>
          )}
          {!project && (
            <section>
              <h3>Codex runtime</h3>
              <label className="codex-field">
                <span>Executable path</span>
                <input
                  value={executable}
                  onChange={(event) => setExecutable(event.target.value)}
                  placeholder="Automatic discovery"
                  spellCheck={false}
                />
              </label>
              <p className="codex-muted">
                Install Codex CLI locally. Leave blank to search PATH and common
                macOS locations. Save a new path, then refresh the account
                status.
              </p>
            </section>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          <button className="ghost-button" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button
            className="ghost-button"
            disabled={busy || !configuration}
            onClick={() =>
              void operation(async () => {
                const next = project
                  ? await codexApi().request("saveProject", {
                      repositoryId: project.id,
                      overrides: preferences,
                    })
                  : await codexApi().request("saveConfiguration", {
                      defaults: preferences as CodexPreferences,
                      executable,
                      editor,
                    });
                setConfiguration(next);
                onClose();
              })
            }
          >
            {busy ? "Saving…" : "Save configuration"}
          </button>
        </footer>
      </div>
    </div>
  );
}
