import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { Combobox } from "../components/combobox";
import {
  codexEnvironmentIsFixed,
  type CodexConfiguration,
  type CodexEnvironmentCheck,
  type CodexThread,
} from "../../shared/codex";
import { codexApi, errorMessage } from "./api";

export function EnvironmentPicker({
  thread,
  onChange,
  onConfigure,
  compact = false,
}: {
  thread: CodexThread;
  onChange: () => Promise<void>;
  onConfigure: () => void;
  compact?: boolean;
}) {
  const [configuration, setConfiguration] = useState<CodexConfiguration | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkout, setCheckout] = useState<{
    key: string;
    result: CodexEnvironmentCheck;
  } | null>(null);
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
  const fixed = codexEnvironmentIsFixed(thread);
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
        label: entry.name,
      })),
  ];
  const selected = thread.environment?.id ?? "local";
  const hasCheckout = thread.environment
    ? Boolean(binding?.remotePaths?.[selected])
    : Boolean(binding?.path);
  const validationKey = JSON.stringify({
    repositoryId: thread.repositoryId,
    selected,
    path:
      selected === "local" ? binding?.path : binding?.remotePaths?.[selected],
    environment: thread.environment
      ? configuration?.environments?.find((entry) => entry.id === selected)
      : undefined,
  });
  useEffect(() => {
    if (!configuration || fixed || !hasCheckout) return;
    setCheckout(null);
    let active = true;
    void codexApi()
      .request("checkProjectCheckout", {
        repositoryId: thread.repositoryId,
        environmentId: selected,
      })
      .then((result) => {
        if (active) setCheckout({ key: validationKey, result });
      })
      .catch((error) => {
        if (active)
          setCheckout({
            key: validationKey,
            result: { ready: false, message: errorMessage(error) },
          });
      });
    return () => {
      active = false;
    };
  }, [
    configuration,
    fixed,
    hasCheckout,
    thread.repositoryId,
    selected,
    validationKey,
  ]);
  const needsConfiguration =
    !hasCheckout ||
    (checkout?.key === validationKey && checkout.result?.ready === false);
  if (!options.some((entry) => entry.value === selected))
    options.push({
      value: selected,
      label: thread.environment?.name ?? "Local",
    });
  return (
    <div
      className={`codex-environment-header${compact ? " compact" : ""}`}
      aria-label="Execution environment"
    >
      {!compact && <span>Environment</span>}
      {fixed ? (
        <strong>
          {thread.environment ? thread.environment.name : "Local"}
        </strong>
      ) : (
        <Combobox
          label="Thread environment"
          variant={compact ? "toolbar" : "field"}
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
      {configuration && !fixed && needsConfiguration && (
        <button
          type="button"
          className="icon-button"
          aria-label="Open project configuration"
          onClick={onConfigure}
          title={`Open project configuration. ${
            checkout?.key === validationKey
              ? (checkout.result?.message ?? "Checkout validation failed.")
              : "Checkout has not passed validation."
          }`}
        >
          <Settings size={16} aria-hidden="true" />
        </button>
      )}
      {thread.environment &&
        thread.serverId &&
        !thread.archived &&
        (thread.state === "interrupted" || thread.state === "failed") && (
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
