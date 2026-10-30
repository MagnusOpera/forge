import { Combobox } from "../components/combobox";
import type { CodexPreferences } from "../../shared/codex";
const choices = [
  { value: "ask", label: "Ask when needed" },
  { value: "strict", label: "Strict sandbox" },
  { value: "full", label: "Full access" },
] as const;
export function AccessPicker({
  value,
  disabled,
  readOnly,
  onChange,
}: {
  value: CodexPreferences["permissions"];
  disabled: boolean;
  readOnly: boolean;
  onChange: (value: CodexPreferences["permissions"]) => void;
}) {
  return (
    <Combobox
      label="Access type"
      value={value}
      options={choices}
      onChange={onChange}
      variant="toolbar"
      displayValue={readOnly ? "Read-only" : undefined}
      disabled={disabled || readOnly}
      title={
        readOnly
          ? "Plan mode is read-only"
          : disabled
            ? "Access cannot be changed while a turn is active or an operation is pending"
            : "Access type"
      }
    />
  );
}
