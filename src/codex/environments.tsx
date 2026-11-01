import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CircleHelp, Loader2, Trash2, X } from "lucide-react";
import type {
  CodexConfiguration,
  CodexEnvironment,
  CodexEnvironmentCheck,
} from "../../shared/codex";
import { Combobox } from "../components/combobox";
import { codexApi, errorMessage } from "./api";

const CREATE_ENVIRONMENT = "__create_environment__";

export function EnvironmentsEditor({
  configuration,
  onChange,
}: {
  configuration: CodexConfiguration;
  onChange: (configuration: CodexConfiguration) => void;
}) {
  const [environments, setEnvironments] = useState(
    configuration.environments ?? [],
  );
  const [selected, setSelected] = useState(environments[0]?.id ?? "");
  const [check, setCheck] = useState<CodexEnvironmentCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const environment = environments.find((entry) => entry.id === selected);
  const resetCheck = () => {
    generation.current++;
    clearTimeout(debounce.current);
    setCheck(null);
    setChecking(false);
  };
  const update = (values: Partial<CodexEnvironment>) => {
    resetCheck();
    setEnvironments((entries) =>
      entries.map((entry) =>
        entry.id === selected ? { ...entry, ...values } : entry,
      ),
    );
  };
  const checkConnection = useCallback(async () => {
    if (
      !environment?.host.trim() ||
      !environment.name.trim() ||
      !environment.executable.trim()
    )
      return;
    clearTimeout(debounce.current);
    const version = ++generation.current;
    setChecking(true);
    setCheck(null);
    try {
      const result = await codexApi().request("checkEnvironment", {
        environment,
      });
      if (generation.current === version) setCheck(result);
    } catch (error) {
      if (generation.current === version)
        setCheck({ ready: false, message: errorMessage(error) });
    } finally {
      if (generation.current === version) setChecking(false);
    }
  }, [environment]);
  useEffect(() => {
    generation.current++;
    setCheck(null);
    setChecking(false);
    if (
      environment?.host.trim() &&
      environment.name.trim() &&
      environment.executable.trim()
    )
      debounce.current = setTimeout(() => void checkConnection(), 600);
    return () => {
      clearTimeout(debounce.current);
      generation.current++;
    };
  }, [checkConnection]);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const mounted = useRef(true);
  const saved = useRef(JSON.stringify(configuration.environments ?? []));
  const latest = useRef(JSON.stringify(environments));
  latest.current = JSON.stringify(environments);
  const pendingSave = useRef<CodexEnvironment[] | null>(null);
  const saveQueue = useRef(Promise.resolve());
  const save = useCallback((entries: CodexEnvironment[]) => {
    pendingSave.current = null;
    const snapshot = JSON.stringify(entries);
    saved.current = snapshot;
    // Serialize writes so a slow save cannot overwrite newer edits.
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        const next = await codexApi().request("saveEnvironments", {
          environments: entries,
        });
        if (mounted.current && latest.current === snapshot) {
          setError("");
          onChangeRef.current(next);
        }
      } catch (error) {
        if (mounted.current && latest.current === snapshot)
          setError(errorMessage(error));
      }
    });
  }, []);
  useEffect(() => {
    setError("");
    pendingSave.current = null;
    if (
      latest.current === saved.current ||
      environments.some(
        (entry) =>
          !entry.name.trim() || !entry.host.trim() || !entry.executable.trim(),
      )
    )
      return;
    pendingSave.current = environments;
    const timer = setTimeout(() => save(environments), 600);
    return () => clearTimeout(timer);
  }, [environments, save]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (pendingSave.current) save(pendingSave.current);
    };
  }, [save]);
  const state = check ? (check.ready ? "good" : "bad") : "unchecked";
  return (
    <section>
      <h3>Execution environments</h3>
      <p>
        Local is always available. Remote environments use SSH over your LAN or
        Tailscale and your development user's managed Codex daemon.
      </p>
      <div className="codex-environment-selector">
        <Combobox
          label="Edit environment"
          value={selected || CREATE_ENVIRONMENT}
          options={[
            ...environments.map((entry) => ({
              value: entry.id,
              label: entry.name,
            })),
            { value: CREATE_ENVIRONMENT, label: "Add environment…" },
          ]}
          onChange={(id) => {
            resetCheck();
            if (id === CREATE_ENVIRONMENT) {
              const entry: CodexEnvironment = {
                id: crypto.randomUUID(),
                name: "New environment",
                host: "",
                executable: "codex",
              };
              setEnvironments((entries) => [...entries, entry]);
              setSelected(entry.id);
            } else {
              setSelected(id);
            }
          }}
        />
        {environment && (
          <button
            type="button"
            className="icon-button"
            aria-label={`Delete ${environment.name} environment`}
            title="Delete environment"
            onClick={() => {
              resetCheck();
              const remaining = environments.filter(
                (entry) => entry.id !== selected,
              );
              setEnvironments(remaining);
              setSelected(remaining[0]?.id ?? "");
            }}
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      {environment && (
        <div className="codex-environment-fields">
          <label className="codex-field">
            <span>Name</span>
            <input
              value={environment.name}
              onChange={(event) => update({ name: event.target.value })}
            />
          </label>
          <div className="codex-field">
            <label htmlFor={`environment-host-${selected}`}>
              SSH host alias or user@hostname
            </label>
            <div className="codex-project-checkout-row">
              <input
                id={`environment-host-${selected}`}
                value={environment.host}
                placeholder="linux-dev"
                spellCheck={false}
                onChange={(event) => update({ host: event.target.value })}
              />
              <button
                type="button"
                className={`icon-button codex-checkout-check ${state}`}
                aria-label={`Check ${environment.name} connection`}
                aria-busy={checking}
                title={
                  checking
                    ? "Checking connection…"
                    : check
                      ? `${check.message}${check.version ? ` ${check.version}` : ""}. Click to check again.`
                      : "Check SSH connection"
                }
                disabled={
                  checking ||
                  !environment.host.trim() ||
                  !environment.name.trim() ||
                  !environment.executable.trim()
                }
                onClick={() => void checkConnection()}
              >
                {checking ? (
                  <Loader2 size={18} className="spin" aria-hidden="true" />
                ) : check ? (
                  check.ready ? (
                    <Check size={18} aria-hidden="true" />
                  ) : (
                    <X size={18} aria-hidden="true" />
                  )
                ) : (
                  <CircleHelp size={18} aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
          <label className="codex-field">
            <span>Remote Codex executable</span>
            <input
              value={environment.executable}
              spellCheck={false}
              placeholder="/home/user/.local/bin/codex"
              onChange={(event) => update({ executable: event.target.value })}
            />
          </label>
          <p className="codex-muted">
            Use ~/.ssh/config for ports, keys and connection options. Connect
            once from your local terminal to trust the host key. Forge uses
            non-interactive SSH and never accepts unknown keys automatically.
          </p>
          {check && !check.ready && (
            <p role="status" className="inline-error">
              {check.message}
            </p>
          )}
          <details open={check?.ready === false}>
            <summary>Remote host setup procedure</summary>
            <ol>
              <li>
                Install Codex CLI, Git and the project's development tools as
                the development user.
              </li>
              <li>
                Run <code>{environment.executable} login --device-auth</code>{" "}
                and complete browser sign-in.
              </li>
              <li>
                Run{" "}
                <code>
                  {environment.executable} app-server daemon bootstrap
                </code>
                , then{" "}
                <code>{environment.executable} app-server daemon start</code>.
              </li>
              <li>
                Check that the daemon survives SSH logout. A headless Linux user
                service may require lingering to be enabled by an administrator.
              </li>
              <li>
                Keep the machine awake and reachable. Configure a checkout path
                per project.
              </li>
            </ol>
            <p>
              Forge only connects to the daemon. It does not install, start, or
              stop remote services.
            </p>
          </details>
        </div>
      )}
      <p className="codex-muted">
        Changes apply to new selections. Started threads retain their original
        target, even after its configuration is edited or removed. Remote
        worktrees are retained for manual cleanup.
      </p>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </section>
  );
}

export function ProjectEnvironments({
  configuration,
  paths,
  onChange,
}: {
  configuration: CodexConfiguration;
  paths: Record<string, string>;
  onChange: (paths: Record<string, string>) => void;
}) {
  return (
    <section>
      <h3>Remote project checkouts</h3>
      <p>
        Use an existing checkout on each target. Forge creates a separate
        worktree from committed HEAD when the thread starts. Paths beginning
        with ~/ use the remote user's home. When a local checkout is configured
        inside your home, its relative path is suggested automatically.
      </p>
      {!configuration.environments?.length && (
        <p className="codex-muted">
          Add environments in global configuration first.
        </p>
      )}
      {configuration.environments?.map((environment) => (
        <ProjectEnvironmentRow
          key={environment.id}
          environment={environment}
          path={paths[environment.id] ?? ""}
          onChange={(value) => onChange({ ...paths, [environment.id]: value })}
        />
      ))}
    </section>
  );
}

function ProjectEnvironmentRow({
  environment,
  path,
  onChange,
}: {
  environment: CodexEnvironment;
  path: string;
  onChange: (path: string) => void;
}) {
  const [result, setResult] = useState<CodexEnvironmentCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const check = useCallback(async () => {
    clearTimeout(debounce.current);
    debounce.current = undefined;
    const version = ++generation.current;
    setBusy(true);
    setResult(null);
    try {
      const checked = await codexApi().request("checkEnvironment", {
        environment,
        repositoryPath: path,
      });
      if (generation.current === version) setResult(checked);
    } catch (error) {
      if (generation.current === version)
        setResult({ ready: false, message: errorMessage(error) });
    } finally {
      if (generation.current === version) setBusy(false);
    }
  }, [environment, path]);
  useEffect(() => {
    generation.current++;
    setResult(null);
    setBusy(false);
    if (path.trim()) {
      debounce.current = setTimeout(() => {
        debounce.current = undefined;
        void check();
      }, 600);
    }
    return () => {
      clearTimeout(debounce.current);
      debounce.current = undefined;
      generation.current++;
    };
  }, [check, path]);
  const state = result ? (result.ready ? "good" : "bad") : "unchecked";
  return (
    <div className="codex-environment-fields">
      <div className="codex-project-checkout-row">
        <label className="codex-field codex-project-checkout-field">
          <span>{environment.name}</span>
          <input
            aria-label={`${environment.name} checkout path`}
            value={path}
            spellCheck={false}
            placeholder="~/path/to/repository"
            onChange={(event) => {
              generation.current++;
              clearTimeout(debounce.current);
              debounce.current = undefined;
              setResult(null);
              setBusy(false);
              onChange(event.target.value);
            }}
          />
        </label>
        <button
          type="button"
          className={`icon-button codex-checkout-check ${state}`}
          aria-label={`Check ${environment.name} checkout`}
          aria-busy={busy}
          title={
            busy
              ? "Checking checkout…"
              : result
                ? `${result.ready ? "Valid checkout" : result.message}. Click to check again.`
                : "Check checkout path"
          }
          disabled={busy || !path.trim()}
          onClick={() => void check()}
        >
          {busy ? (
            <Loader2 size={18} className="spin" aria-hidden="true" />
          ) : result ? (
            result.ready ? (
              <Check size={18} aria-hidden="true" />
            ) : (
              <X size={18} aria-hidden="true" />
            )
          ) : (
            <CircleHelp size={18} aria-hidden="true" />
          )}
        </button>
      </div>
      {result && !result.ready && (
        <p role="status" className="codex-checkout-error">
          {result.message}
        </p>
      )}
    </div>
  );
}
