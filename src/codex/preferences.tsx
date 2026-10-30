import { useEffect, useState } from "react";
import {
  defaultCodexPreferences,
  effectiveCodexPreferences,
  type CodexModel,
  type CodexPreferences,
} from "../../shared/codex";
import { codexApi, errorMessage } from "./api";
const labels: Record<keyof CodexPreferences, string> = {
  model: "Model",
  effort: "Reasoning effort",
  speed: "Speed",
  mode: "Mode",
  followUp: "Follow-up behavior",
  permissions: "Permissions",
};
export function useCodexModels() {
  const [models, setModels] = useState<CodexModel[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (!window.forgeCodex) return;
    const refresh = () =>
      void codexApi()
        .request("models", {})
        .then((result) => {
          if (active) {
            setModels(result);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(errorMessage(e));
        });
    refresh();
    const unsubscribe = codexApi().onChanged((change) => {
      if (change.connectionError) {
        setError(change.connectionError);
        return;
      }
      if (!change.repositoryId && !change.threadId) refresh();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return { models, error };
}
export function PreferencesEditor({
  value,
  onChange,
  inherited,
  models,
  compact = false,
}: {
  value: Partial<CodexPreferences>;
  onChange: (value: Partial<CodexPreferences>) => void;
  inherited?: CodexPreferences;
  models: CodexModel[];
  compact?: boolean;
}) {
  const effective = effectiveCodexPreferences(
    inherited ?? defaultCodexPreferences,
    value,
  );
  const model =
    models.find((m) => m.id === effective.model) ??
    (!effective.model ? models.find((m) => m.isDefault) : undefined);
  const options: Record<
    keyof CodexPreferences,
    { value: string; label: string }[]
  > = {
    model: [
      { value: "", label: "Codex default" },
      ...models.map((m) => ({ value: m.id, label: m.name })),
    ],
    effort: [
      { value: "", label: "Model default" },
      ...(model?.efforts ?? []).map((effort) => ({
        value: effort,
        label: effort,
      })),
    ],
    speed: [
      { value: "normal", label: "Normal" },
      ...(model?.fast || effective.speed === "fast"
        ? [{ value: "fast", label: "Fast" }]
        : []),
    ],
    mode: [
      { value: "implement", label: "Implement" },
      { value: "plan", label: "Plan" },
    ],
    followUp: [
      { value: "steer", label: "Steer" },
      { value: "queue", label: "Queue" },
    ],
    permissions: [
      { value: "ask", label: "Ask when needed" },
      { value: "strict", label: "Strict sandbox" },
      { value: "full", label: "Full access" },
    ],
  };
  const keys = (
    compact
      ? ["model", "effort", "speed", "mode", "followUp"]
      : Object.keys(labels)
  ) as (keyof CodexPreferences)[];
  return (
    <div className={`codex-preferences ${compact ? "compact" : ""}`}>
      {keys.map((key) => {
        const isInherited = inherited && value[key] === undefined;
        const choices = options[key];
        if (!choices.some((o) => o.value === effective[key]))
          choices.push({
            value: effective[key],
            label: `${effective[key]} (unavailable)`,
          });
        return (
          <label className="codex-field" key={key}>
            <span>
              {labels[key]}
              {isInherited && <small> · Global</small>}
            </span>
            <div className="codex-field-control">
              <select
                aria-label={labels[key]}
                value={effective[key]}
                onChange={(event) => {
                  const next = { ...value, [key]: event.target.value };
                  if (key === "model" && !inherited) {
                    const selected =
                      models.find((entry) => entry.id === event.target.value) ??
                      models.find((entry) => entry.isDefault);
                    if (
                      selected &&
                      effective.effort &&
                      !selected.efforts.includes(effective.effort)
                    )
                      next.effort = "";
                    if (selected && !selected.fast) next.speed = "normal";
                  }
                  onChange(next);
                }}
              >
                {choices.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {inherited && (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    const next = { ...value };
                    if (isInherited)
                      Object.assign(next, { [key]: effective[key] });
                    else delete next[key];
                    onChange(next);
                  }}
                >
                  {isInherited ? "Override" : "Use global"}
                </button>
              )}
            </div>
          </label>
        );
      })}
      {!compact && effective.permissions === "full" && (
        <p className="codex-policy-note" role="note">
          Full access allows unrestricted local commands and network access.
          Plan mode remains read-only.
        </p>
      )}
    </div>
  );
}
