import { accentColors, type AccentColor } from "../appearance";
import { usePaneSurface } from "../pane-surface";
import { displayPath, displayPathText, expandDisplayPath } from "../paths";
import { EnvironmentsEditor, ProjectEnvironments } from "./environments";
import { Combobox } from "../components/combobox";
import { useEffect, useRef, useState } from "react";
import { FolderOpen, RefreshCw, X } from "lucide-react";
import type { AuthStatus, RepoSummary } from "../../shared/github";
import type {
  CodexConfiguration,
  CodexSendShortcut,
  CodexPreferences,
  CodexThreadStartKind,
  CodexStatus,
} from "../../shared/codex";
import { isThreadStartKind, DEFAULT_THREAD_START, DEFAULT_TEXT_EDITOR, MINIMUM_CODEX_VERSION } from "../../shared/codex";
import { codexApi, errorMessage } from "./api";
import { PreferencesEditor, useCodexModels } from "./preferences";
const threadStartLabels: Record<CodexThreadStartKind, string> = {
  worktree: "Worktree from origin/HEAD (fetch first)",
  new: "New branch from origin/HEAD (fetch first)",
  default: "Default branch checkout",
  current: "Current repository branch",
};

export function CodexSettingsDialog({
  project,
  projectAccent,
  initialSection,
  onSaveProjectAccent,
  auth,
  onClose,
  onSignInGithub,
  onRemoveGithub,
  onCancelGithubSignIn,
  onOpenUrl,
}: {
  project?: RepoSummary;
  projectAccent?: AccentColor;
  initialSection?: "github";
  onSaveProjectAccent?: (color: AccentColor | undefined) => void;
  auth: AuthStatus | null;
  onClose: () => void;
  onSignInGithub: () => Promise<void>;
  onCancelGithubSignIn?: () => Promise<void>;
  onRemoveGithub: () => void;
  onOpenUrl: (url: string) => void;
}) {
  "use no memo"; // React Compiler does not yet support this try/finally control flow.

  const { document } = usePaneSurface();
  const [accent, setAccent] = useState<AccentColor | undefined>(projectAccent);
  useEffect(() => setAccent(projectAccent), [project?.id, projectAccent]);
  const [section, setSection] = useState(initialSection ?? (project ? "appearance" : "general"));
  const [homeRelativePath, setHomeRelativePath] = useState<string | null>(null);
  const [defaultEnvironment, setDefaultEnvironment] = useState("local");
  const [defaultThreadStart, setDefaultThreadStart] = useState<CodexThreadStartKind | "">(project ? "" : DEFAULT_THREAD_START);
  const [remotePaths, setRemotePaths] = useState<Record<string, string>>({});
  const [configuration, setConfiguration] = useState<CodexConfiguration | null>(
    null,
  );
  const [preferences, setPreferences] = useState<Partial<CodexPreferences>>({});
  const [executable, setExecutable] = useState("");
  const [editor, setEditor] = useState(DEFAULT_TEXT_EDITOR);
  const [sendShortcut, setSendShortcut] = useState<CodexSendShortcut>("enter");
  const [accountOverride, setAccountOverride] = useState(false);
  const accountInput =
    project && accountOverride ? { repositoryId: project.id } : {};
  const [status, setStatus] = useState<CodexStatus | null>(null);
  const [githubWaiting, setGithubWaiting] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [waitingLogin, setWaitingLogin] = useState(false);
  const { models, error: modelsError } = useCodexModels(
    project?.id,
    undefined,
    undefined,
    accountOverride,
    accountOverride ? project?.id : undefined,
  );
  const root = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const githubWaitingRef = useRef(false);
  const cancelGithubRef = useRef(onCancelGithubSignIn);
  cancelGithubRef.current = onCancelGithubSignIn;
  useEffect(() => () => {
    if (githubWaitingRef.current) void cancelGithubRef.current?.().catch(() => undefined);
  }, []);
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
      if (
        (event.key === "Escape" || event.key === "Tab") &&
        root.current?.querySelector(":popover-open")
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key === "Tab") {
        const controls = Array.from(
          root.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]",
          ) ?? [],
        ).filter((element) => element.getClientRects().length > 0);
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
  }, [document]);
  useEffect(() => {
    let active = true;
    setSection(initialSection ?? (project ? "appearance" : "general"));
    if (!window.forgeCodex) {
      setError("Codex requires the Forge desktop app.");
      return;
    }
    void codexApi()
      .request("configuration", {})
      .then((c) => {
        if (!active) return;
        setConfiguration(c);
        setDefaultEnvironment(
          project
            ? (c.projects[project.id]?.defaultEnvironment ?? "local")
            : "local",
        );
        setDefaultThreadStart(project
          ? c.projects[project.id]?.defaultThreadStart ?? ""
          : c.defaultThreadStart ?? DEFAULT_THREAD_START);
        setAccountOverride(
          Boolean(project && c.projects[project.id]?.accountOverride),
        );
        setRemotePaths(
          project ? (c.projects[project.id]?.remotePaths ?? {}) : {},
        );
        setExecutable(c.executable);
        setEditor(c.editor ?? DEFAULT_TEXT_EDITOR);
        setSendShortcut(c.sendShortcut ?? "enter");
        setPreferences(
          project ? (c.projects[project.id]?.overrides ?? {}) : c.defaults,
        );
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [initialSection, project?.id]);
  useEffect(() => {
    if (!window.forgeCodex) return;
    let active = true;
    const scope = project && accountOverride ? project.id : undefined;
    const input = scope ? { repositoryId: scope } : {};
    setStatus(null);
    setWaitingLogin(false);
    const refreshStatus = () =>
      void codexApi()
        .request("status", input)
        .then((s) => {
          if (active) {
            setStatus(s);
            setWaitingLogin(Boolean(s.loginPending) && !s.authenticated);
          }
        })
        .catch((e) => {
          if (active) setError(errorMessage(e));
        });
    refreshStatus();
    const unsubscribe = codexApi().onChanged((change) => {
      if (change.environmentId || change.accountId !== scope || change.threadId)
        return;
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
          setError(displayPathText(change.auth.error || "ChatGPT sign-in failed."));
      }
      refreshStatus();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [project?.id, accountOverride]);
  const binding = project ? configuration?.projects[project.id] : undefined;
  useEffect(() => {
    setHomeRelativePath(null);
    if (!project || !binding?.path) return;
    let active = true;
    void codexApi()
      .request("inferRemotePath", { repositoryId: project.id })
      .then((suggested) => {
        if (active)
          setHomeRelativePath(typeof suggested === "string" ? suggested : null);
      })
      .catch((error) => {
        if (active) setError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [project?.id, binding?.path]);
  useEffect(() => {
    if (section !== "github" || !homeRelativePath) return;
    setRemotePaths((current) => {
      const next = { ...current };
      for (const environment of configuration?.environments ?? []) {
        next[environment.id] ??= homeRelativePath;
      }
      return next;
    });
  }, [section, homeRelativePath, configuration?.environments]);

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
        <div className="codex-settings-body">
          <nav
            className="codex-settings-nav"
            aria-label="Configuration sections"
          >
            {(project
              ? [
                  ["appearance", "Appearance"],
                  ["github", "GitHub"],
                  ["codex", "OpenAI"],
                ]
              : [
                  ["general", "General"],
                  ["environments", "Environments"],
                  ["github", "GitHub"],
                  ["codex", "OpenAI"],
                ]
            ).map(([id, label]) => (
              <button
                key={id}
                className={`ghost-button ${section === id ? "active" : ""}`}
                aria-current={section === id ? "page" : undefined}
                onClick={() => setSection(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="codex-settings-scroll">
            {project && section === "appearance" && (
              <section>
                <h3>Accent color</h3>
                <p className="codex-muted">Choose an accent for this project in light and dark mode.</p>
                <label>
                  <input type="checkbox" checked={!accent} onChange={event => setAccent(event.target.checked ? undefined : accentColors[0])} />{" "}
                  Use global accent color
                </label>
                <div className="project-accent-swatches" role="radiogroup" aria-label="Project accent color">
                  {accentColors.map((color, index) => (
                    <button key={color} className={`accent-swatch ${accent === color ? "active" : ""}`}
                      style={{ "--swatch-color": color } as React.CSSProperties}
                      role="radio" aria-checked={accent === color} aria-label={`Project accent ${index + 1}`}
                      onClick={() => setAccent(color)} />
                  ))}
                </div>
              </section>
            )}
            {!project && section === "environments" && configuration && (
              <EnvironmentsEditor
                configuration={configuration}
                onChange={setConfiguration}
              />
            )}
            {!project && section === "github" && (
              <section>
                <h3>GitHub account</h3>
                <p>
                  {auth?.configured
                    ? `Connected${auth.viewerLogin ? ` as ${auth.viewerLogin}` : ""}`
                    : "Not signed in to GitHub"}
                </p>
                <div className="codex-actions">
                  <button type="button" className="primary-button" disabled={busy || !auth?.encryptionAvailable}
                    onClick={() => void operation(async () => {
                      githubWaitingRef.current = true;
                      setGithubWaiting(true);
                      try { await onSignInGithub(); }
                      finally { githubWaitingRef.current = false; setGithubWaiting(false); }
                    })}>
                    {githubWaiting ? "Waiting for GitHub…" : auth?.configured ? "Reconnect with GitHub" : "Sign in with GitHub"}
                  </button>
                  {githubWaiting && <button type="button" className="ghost-button"
                    onClick={() => void onCancelGithubSignIn?.().catch(e => setError(errorMessage(e)))}>Cancel sign-in</button>}
                  {auth?.configured && <button type="button" className="ghost-button" disabled={busy} onClick={onRemoveGithub}>Sign out</button>}
                  <button type="button" className="ghost-button" onClick={() => onOpenUrl("https://github.com/settings/applications")}>Manage GitHub access</button>
                </div>
                {!auth?.encryptionAvailable && <p className="inline-error">Secure storage is unavailable.</p>}
                <p className="codex-muted">Sign in through your browser. Your credentials stay encrypted on this Mac.</p>
              </section>
            )}
            {section === "github" && configuration && (
              <section>
                <h3>Thread starting point</h3>
                <div className="codex-field">
                  <span>Default starting point</span>
                  <Combobox
                    label="Default thread starting point"
                    value={defaultThreadStart}
                    disabled={busy}
                    options={[
                      ...(project ? [{ value: "", label: `Use global default (${threadStartLabels[configuration.defaultThreadStart ?? DEFAULT_THREAD_START]})` }] : []),
                      ...Object.entries(threadStartLabels).map(([value, label]) => ({ value, label })),
                    ]}
                    onChange={value => { if (value === "" || isThreadStartKind(value)) setDefaultThreadStart(value); }}
                  />
                </div>
                <p className="codex-muted">
                  Applies to new threads. You can change the starting point in each thread before it starts.
                  New branch requires a branch name in the thread. Worktree excludes uncommitted checkout changes.
                </p>
              </section>
            )}
            {project && section === "codex" && (
              <section>
                <h3>OpenAI account</h3>
                <label>
                  <input
                    type="checkbox"
                    checked={accountOverride}
                    disabled={busy || waitingLogin}
                    onChange={(event) =>
                      setAccountOverride(event.target.checked)
                    }
                  />{" "}
                  Use a separate OpenAI account for this project
                </label>
                <p className="codex-muted">
                  {accountOverride
                    ? "New local threads use this project's account."
                    : "New local threads use the global account."}{" "}
                  Existing threads keep their account. Remote threads use the
                  remote host's account; imported threads keep their original
                  OpenAI account.
                </p>
              </section>
            )}
            {section === "codex" && (!project || accountOverride) && (
              <section>
                <h3>{project ? "Project account" : "OpenAI account"}</h3>
                <p>
                  {!status
                    ? "Checking Codex and updating if needed…"
                    : status.authenticated
                    ? `Signed in${status.email ? ` as ${status.email}` : ""}${status.plan ? ` · ${status.plan}` : ""}`
                    : status?.connected
                      ? "Not signed in"
                      : "Codex unavailable"}
                </p>
                {status?.error && <p className="codex-muted">{displayPathText(status.error)}</p>}
                {status?.version && <small>{status.version}</small>}
                <div className="codex-actions">
                  <button
                    className="ghost-button"
                    disabled={busy}
                    onClick={() =>
                      void operation(async () => {
                        setStatus(
                          await codexApi().request("status", accountInput),
                        );
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
                          await codexApi().request("logout", accountInput);
                          setStatus(
                            await codexApi().request("status", accountInput),
                          );
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
                          await codexApi().request("login", accountInput);
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
                        await codexApi().request("cancelLogin", accountInput);
                        setWaitingLogin(false);
                      })
                    }
                  >
                    Cancel sign-in
                  </button>
                )}
                <p className="codex-muted">
                  {project
                    ? "This sign-in is stored separately from the global account. Save configuration to use it for new local threads."
                    : "This account belongs to Forge. Other Codex apps and CLI credentials are separate."}
                </p>
              </section>
            )}
            {project && section === "github" && configuration && (
              <section>
                <h3>Checkouts</h3>
                <div className="codex-field">
                  <span>Default environment</span>
                  <Combobox
                    label="Default environment"
                    value={defaultEnvironment}
                    options={[
                      { value: "local", label: "Local" },
                      ...(configuration.environments ?? []).map(
                        (environment) => ({
                          value: environment.id,
                          label: environment.name,
                          disabled: !remotePaths[environment.id]?.trim(),
                        }),
                      ),
                    ]}
                    onChange={setDefaultEnvironment}
                  />
                </div>
                <p className="codex-muted">
                  New threads start in this environment. Existing threads keep
                  their target.
                </p>
              </section>
            )}
            {project && section === "github" && (
              <section>
                <h3>Local Git folder</h3>
                <p className="codex-path" title={displayPath(binding?.path ?? "")}>
                  {homeRelativePath || displayPath(binding?.path ?? "") || "No folder selected"}
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
                {binding?.warning && <p role="note">{displayPathText(binding.warning)}</p>}
                <p className="codex-muted">
                  New threads use the starting point selected above. Worktrees exclude
                  uncommitted checkout changes. Existing threads retain their original folder.
                </p>
              </section>
            )}
            {project && section === "github" && configuration && (
              <ProjectEnvironments
                configuration={configuration}
                paths={remotePaths}
                onChange={setRemotePaths}
              />
            )}
            {configuration && section === "codex" && (
              <section>
                <h3>{project ? "Codex" : "Codex defaults"}</h3>
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
            {!project && section === "general" && (
              <section>
                <h3>Message input</h3>
                <div className="codex-field">
                  <span>Send message with</span>
                  <Combobox
                    label="Send message with"
                    value={sendShortcut}
                    options={[
                      { value: "enter", label: "Enter" },
                      { value: "command-enter", label: "⌘Enter / Ctrl+Enter" },
                    ]}
                    onChange={setSendShortcut}
                  />
                </div>
                <p className="codex-muted">
                  With ⌘Enter / Ctrl+Enter selected, Enter inserts a new line.
                  Shift+Enter always inserts a new line. Inside code blocks,
                  Enter inserts a new line and ⌘Enter / Ctrl+Enter sends.
                  Applies to all chats.
                </p>
              </section>
            )}
            {!project && section === "general" && (
              <section>
                <h3>Text editor</h3>
                <div className="codex-field">
                  <span>Application name or .app path</span>
                  <div className="codex-field-control">
                    <input
                      aria-label="Text editor application"
                      value={displayPath(editor)}
                      onChange={(event) => setEditor(expandDisplayPath(event.target.value))}
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
            {!project && section === "codex" && (
              <section>
                <h3>Codex runtime</h3>
                <label className="codex-field">
                  <span>Executable path</span>
                  <input
                    value={displayPath(executable)}
                    onChange={(event) => setExecutable(expandDisplayPath(event.target.value))}
                    placeholder="Automatic discovery"
                    spellCheck={false}
                  />
                </label>
                <p className="codex-muted">
                  Forge requires Codex CLI {MINIMUM_CODEX_VERSION} or newer. It checks at startup
                  and upgrades older Homebrew or global npm installations automatically.
                  Leave blank to search PATH and common macOS locations, or save
                  a custom path and refresh the account status.
                </p>
              </section>
            )}
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
        <footer>
          <button className="ghost-button" onClick={onClose} disabled={busy}>
            Close
          </button>
          {project && section === "appearance" ? (
            <button className="ghost-button" onClick={() => { onSaveProjectAccent?.(accent); onClose(); }}>
              Save configuration
            </button>
          ) : (project || ["general", "github", "codex"].includes(section)) && (
            <button
              className="ghost-button"
              disabled={busy || !configuration}
              onClick={() =>
                void operation(async () => {
                  const next = project
                    ? await codexApi().request("saveProject", {
                        repositoryId: project.id,
                        fullName: project.fullName,
                        overrides: preferences,
                        remotePaths,
                        accountOverride,
                        defaultEnvironment,
                        defaultThreadStart: defaultThreadStart || null,
                      })
                    : await codexApi().request("saveConfiguration", {
                        defaults: preferences as CodexPreferences,
                        executable,
                        editor,
                        sendShortcut,
                        defaultThreadStart: defaultThreadStart || DEFAULT_THREAD_START,
                      });
                  setConfiguration(next);
                  if (project) onSaveProjectAccent?.(accent);
                  onClose();
                })
              }
            >
              {busy ? "Saving…" : "Save configuration"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
