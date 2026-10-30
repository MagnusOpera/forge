import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Check, ChevronDown, ChevronLeft, RotateCcw, Zap } from "lucide-react";
import type { CodexModel, CodexPreferences } from "../../shared/codex";

export function selectComposerModel(
  value: CodexPreferences,
  model: CodexModel | undefined,
  id: string,
): CodexPreferences {
  return {
    ...value,
    model: id,
    effort:
      model && value.effort && !model.efforts.includes(value.effort)
        ? ""
        : value.effort,
    speed: model && !model.fast ? "normal" : value.speed,
  };
}
const effortLabel = (effort: string) =>
  effort ? effort.charAt(0).toUpperCase() + effort.slice(1) : "Model default";

export function ModelPicker({
  value,
  models,
  disabled,
  onChange,
}: {
  value: CodexPreferences;
  models: CodexModel[];
  disabled: boolean;
  onChange: (value: CodexPreferences) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [showModels, setShowModels] = useState(false);
  const modelButton = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const restoreModelFocus = useRef(false);
  const effortTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const choices = [{ id: "", name: "Codex default" }, ...models];
  useEffect(() => {
    if (showModels)
      list.current
        ?.querySelector<HTMLElement>('[aria-selected="true"]')
        ?.focus();
    else if (restoreModelFocus.current) {
      modelButton.current?.focus();
      restoreModelFocus.current = false;
    }
  }, [showModels]);
  useEffect(() => () => clearTimeout(effortTimer.current), []);
  const model =
    models.find((model) => model.id === value.model) ??
    (!value.model ? models.find((model) => model.isDefault) : undefined);
  const efforts = model?.efforts ?? [];
  const currentEffort = value.effort || model?.defaultEffort || "";
  const [effort, setEffort] = useState(currentEffort);
  const committed = useRef(currentEffort);
  useEffect(() => {
    clearTimeout(effortTimer.current);
    setEffort(currentEffort);
    committed.current = currentEffort;
  }, [currentEffort, value.model]);
  useEffect(() => {
    const close = () => {
      if (panel.current?.matches(":popover-open")) panel.current.hidePopover();
    };
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, []);
  const commitEffort = (index: string) => {
    clearTimeout(effortTimer.current);
    const selected = efforts[Number(index)];
    if (selected && selected !== committed.current) {
      committed.current = selected;
      latest.current.onChange({ ...latest.current.value, effort: selected });
    }
  };
  const position = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect || !panel.current) return;
    panel.current.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 276))}px`;
    panel.current.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 8)}px`;
  };
  return (
    <div className="codex-model-picker">
      <button
        ref={trigger}
        type="button"
        className="ghost-button codex-model-trigger"
        popoverTarget={id}
        disabled={disabled}
        onClick={position}
        aria-label="Model and reasoning effort"
      >
        {value.speed === "fast" && (
          <Zap size={12} fill="currentColor" aria-label="Fast speed" />
        )}
        <span>{model?.name ?? (value.model || "Codex default")}</span>
        <span className="codex-muted">{effortLabel(currentEffort)}</span>
        <ChevronDown size={12} />
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        role="dialog"
        aria-label="Model and reasoning effort"
        className="codex-model-popover"
        onToggle={(event) => {
          if (event.newState === "closed") setShowModels(false);
        }}
      >
        {showModels ? (
          <div className="codex-model-menu">
            <button
              type="button"
              className="ghost-button codex-model-back"
              onClick={() => {
                restoreModelFocus.current = true;
                setShowModels(false);
              }}
            >
              <ChevronLeft size={14} />
              Choose model
            </button>
            <div
              ref={list}
              role="listbox"
              aria-label="Model"
              className="codex-model-options"
              onKeyDown={(event) => {
                const options = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    '[role="option"]',
                  ),
                );
                const index = options.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                let next = index;
                if (event.key === "ArrowDown")
                  next = (index + 1) % options.length;
                else if (event.key === "ArrowUp")
                  next = (index - 1 + options.length) % options.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = options.length - 1;
                else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  restoreModelFocus.current = true;
                  setShowModels(false);
                  return;
                } else return;
                event.preventDefault();
                options[next]?.focus();
              }}
            >
              {choices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  role="option"
                  aria-selected={value.model === choice.id}
                  disabled={disabled}
                  onClick={() => {
                    const selected =
                      models.find((model) => model.id === choice.id) ??
                      models.find((model) => model.isDefault);
                    onChange(selectComposerModel(value, selected, choice.id));
                    restoreModelFocus.current = true;
                    setShowModels(false);
                  }}
                >
                  <span>{choice.name}</span>
                  {value.model === choice.id && <Check size={14} />}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="codex-model-popover-heading">
              <button
                type="button"
                className="icon-button"
                aria-label="Fast speed"
                title={
                  model?.fast
                    ? "Toggle fast speed"
                    : "Fast speed is unavailable for this model"
                }
                aria-pressed={value.speed === "fast"}
                disabled={disabled || !model?.fast}
                onClick={() =>
                  onChange({
                    ...value,
                    speed: value.speed === "fast" ? "normal" : "fast",
                  })
                }
              >
                <Zap
                  size={17}
                  fill={value.speed === "fast" ? "currentColor" : "none"}
                />
              </button>
              <div className="codex-model-center">
                <label htmlFor={`${id}-effort`} className="codex-effort-label">
                  {effortLabel(effort)}
                </label>
                <button
                  ref={modelButton}
                  type="button"
                  className="codex-model-select"
                  aria-label="Choose model"
                  aria-haspopup="listbox"
                  disabled={disabled || !models.length}
                  onClick={() => setShowModels(true)}
                >
                  <span>
                    {model?.name ??
                      (value.model
                        ? `${value.model} (unavailable)`
                        : "Codex default")}
                  </span>
                  <ChevronDown size={12} aria-hidden="true" />
                </button>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Reset effort and speed"
                title="Use model default effort and normal speed"
                disabled={disabled}
                onClick={() =>
                  onChange({ ...value, effort: "", speed: "normal" })
                }
              >
                <RotateCcw size={16} />
              </button>
            </div>
            <div
              className="codex-effort-slider"
              style={
                {
                  "--effort-progress": `${efforts.length > 1 ? (Math.max(0, efforts.indexOf(effort)) / (efforts.length - 1)) * 100 : 0}%`,
                } as CSSProperties
              }
            >
              <div className="codex-effort-track" aria-hidden="true">
                <div className="codex-effort-fill" />
                <div className="codex-effort-dots">
                  {efforts.map((item, index) => (
                    <span
                      key={item}
                      style={{
                        left: `${efforts.length > 1 ? (index / (efforts.length - 1)) * 100 : 0}%`,
                      }}
                    />
                  ))}
                </div>
              </div>
              <input
                id={`${id}-effort`}
                type="range"
                aria-label="Reasoning effort"
                aria-valuetext={effortLabel(effort)}
                min={0}
                max={Math.max(0, efforts.length - 1)}
                step={1}
                value={Math.max(0, efforts.indexOf(effort))}
                disabled={disabled || efforts.length < 2}
                onChange={(event) => {
                  const index = event.target.value;
                  setEffort(efforts[Number(index)] ?? "");
                  clearTimeout(effortTimer.current);
                  // Native range change/accessibility events need not include pointerup.
                  effortTimer.current = setTimeout(
                    () => commitEffort(index),
                    200,
                  );
                }}
                onPointerUp={(event) => commitEffort(event.currentTarget.value)}
                onKeyUp={(event) => commitEffort(event.currentTarget.value)}
                onBlur={(event) => commitEffort(event.currentTarget.value)}
              />
            </div>
            {(!model || !efforts.length) && (
              <small>
                {!model
                  ? "Select an available model"
                  : "This model reports no effort choices"}
              </small>
            )}
          </>
        )}
      </div>
    </div>
  );
}
