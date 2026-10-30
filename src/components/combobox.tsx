import { useEffect, useId, useRef, useState, type Ref } from "react";
import { Check, ChevronDown } from "lucide-react";
export type ComboboxOption<Value extends string> = {
  value: Value;
  label: string;
  disabled?: boolean;
};
export function Combobox<Value extends string>({
  value,
  options,
  onChange,
  label,
  disabled = false,
  variant = "field",
  displayValue,
  title,
  triggerRef,
}: {
  value: Value;
  options: readonly ComboboxOption<Value>[];
  onChange: (value: Value) => void;
  label: string;
  disabled?: boolean;
  variant?: "field" | "toolbar";
  displayValue?: string;
  title?: string;
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const search = useRef({ text: "", time: 0 });
  const close = () => {
    panel.current?.hidePopover?.();
    trigger.current?.focus();
  };
  const position = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect || !panel.current) return;
    const width = Math.min(Math.max(rect.width, 220), window.innerWidth - 16);
    const height = Math.min(options.length * 34 + 12, 260);
    const above =
      variant === "toolbar"
        ? rect.top > height + 8
        : window.innerHeight - rect.bottom < height + 8 &&
          rect.top > window.innerHeight - rect.bottom;
    Object.assign(panel.current.style, {
      width: `${width}px`,
      left: `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`,
      top: above ? "auto" : `${rect.bottom + 6}px`,
      bottom: above ? `${window.innerHeight - rect.top + 6}px` : "auto",
      maxHeight: `${Math.max(40, Math.min(260, (above ? rect.top : window.innerHeight - rect.bottom) - 14))}px`,
    });
  };
  useEffect(() => {
    const reposition = () => {
      if (panel.current?.matches(":popover-open")) position();
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  });
  return (
    <div className={`combobox combobox-${variant}`}>
      <button
        ref={(node) => {
          trigger.current = node;
          if (typeof triggerRef === "function") triggerRef(node);
          else if (triggerRef) triggerRef.current = node;
        }}
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="listbox"
        className="combobox-trigger"
        disabled={disabled}
        title={title}
        popoverTarget={id}
        onClick={position}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            position();
            panel.current?.showPopover?.();
          }
        }}
      >
        <span>
          {displayValue ??
            options.find((option) => option.value === value)?.label ??
            value}
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        role="listbox"
        aria-label={label}
        className="combobox-menu combobox-options"
        onToggle={(event) => {
          const visible = event.newState === "open";
          setOpen(visible);
          if (visible)
            (
              panel.current?.querySelector<HTMLButtonElement>(
                '[aria-selected="true"]:not(:disabled)',
              ) ??
              panel.current?.querySelector<HTMLButtonElement>(
                '[role="option"]:not(:disabled)',
              )
            )?.focus();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
          }
          if (event.key === "Tab") {
            close();
            return;
          }
          const buttons = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              '[role="option"]:not(:disabled)',
            ),
          );
          if (!buttons.length) return;
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          let next = index;
          if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
          else if (event.key === "ArrowUp")
            next = (index - 1 + buttons.length) % buttons.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = buttons.length - 1;
          else if (
            event.key.length === 1 &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey &&
            event.key !== " "
          ) {
            const now = Date.now();
            search.current = {
              text:
                (now - search.current.time > 700 ? "" : search.current.text) +
                event.key.toLowerCase(),
              time: now,
            };
            const found = buttons.findIndex((button) =>
              button.textContent?.toLowerCase().startsWith(search.current.text),
            );
            if (found >= 0) next = found;
          } else return;
          event.preventDefault();
          buttons[next]?.focus();
        }}
      >
        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            role="option"
            aria-selected={option.value === value}
            disabled={disabled || option.disabled}
            onClick={() => {
              close();
              onChange(option.value);
            }}
          >
            <span>{option.label}</span>
            {option.value === value && <Check size={14} aria-hidden="true" />}
          </button>
        ))}
      </div>
    </div>
  );
}
