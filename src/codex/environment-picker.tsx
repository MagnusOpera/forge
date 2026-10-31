import { useEffect, useState } from "react";
import { Combobox } from "../components/combobox";
import {
  codexIsActive,
  type CodexConfiguration,
  type CodexThread,
} from "../../shared/codex";
import { codexApi, errorMessage } from "./api";

export function EnvironmentPicker({
  thread,
  onChange,
}: {
  thread: CodexThread;
  onChange: () => Promise<void>;
}) {
  const [configuration, setConfiguration] = useState<CodexConfiguration | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void codexApi()
        .request("configuration", {})
        .then((value) => {
          if (active) setConfiguration(value);
        })
        .catch((error) => {
          if (active) setError(errorMessage(error));
        });
    refresh();
    const unsubscribe = codexApi().onChanged((change) => {
      if (!change.threadId) refresh();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  const fixed = Boolean(
    thread.worktree ||
    thread.serverId ||
    thread.items.length ||
    thread.sourceHome ||
    codexIsActive(thread),
  );
  const binding = configuration?.projects[thread.repositoryId];
  const options = [
    {
      value: "local",
      label: binding?.path ? "Local" : "Local · checkout not configured",
      disabled: !binding?.path,
    },
    ...(configuration?.environments ?? [])
      .filter((entry) => Boolean(binding?.remotePaths?.[entry.id]))
      .map((entry) => ({
        value: entry.id,
        label: `${entry.name} · ${entry.host}`,
      })),
  ];
  const selected = thread.environment?.id ?? "local";
  if (!options.some((entry) => entry.value === selected))
    options.push({
      value: selected,
      label: thread.environment?.name ?? "Local",
    });
  return (
    <div className="codex-environment-header">
      <span>Environment</span>
      {fixed ? (
        <strong>
          {thread.environment
            ? `${thread.environment.name} · ${thread.environment.host}`
            : "Local"}
        </strong>
      ) : (
        <Combobox
          label="Thread environment"
          value={selected}
          options={options}
          disabled={busy || !configuration}
          onChange={(environmentId) => {
            setBusy(true);
            setError("");
            void codexApi()
              .request("setEnvironment", {
                repositoryId: thread.repositoryId,
                id: thread.id,
                environmentId,
              })
              .then(onChange)
              .catch((error) => setError(errorMessage(error)))
              .finally(() => setBusy(false));
          }}
        />
      )}
      <code title={thread.worktree || thread.repositoryPath}>
        {thread.worktree ||
          thread.repositoryPath ||
          "Choose a configured environment"}
      </code>
      {thread.environment && thread.serverId && !codexIsActive(thread) && (
        <button
          className="ghost-button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            void codexApi()
              .request("reconnect", {
                repositoryId: thread.repositoryId,
                id: thread.id,
              })
              .then(onChange)
              .catch((error) => setError(errorMessage(error)))
              .finally(() => setBusy(false));
          }}
        >
          Reconnect
        </button>
      )}
      {error && (
        <span role="alert" className="inline-error">
          {error}
        </span>
      )}
    </div>
  );
}
