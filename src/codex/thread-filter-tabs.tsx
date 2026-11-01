import { Archive, MessageSquare } from "lucide-react";
import { useSlidingUnderline } from "../useSlidingUnderline";

export function ThreadFilterTabs({
  archived,
  onChange,
  activeCount,
  archivedCount,
  disabled = false,
  label = "Thread filter",
}: {
  archived: boolean;
  onChange: (archived: boolean) => void;
  activeCount?: number;
  archivedCount?: number;
  disabled?: boolean;
  label?: string;
}) {
  "use no memo"; // Preserve the live ref handling at this imperative UI boundary.

  const underline = useSlidingUnderline(
    `${archived}:${activeCount}:${archivedCount}`,
  );
  return (
    <div
      ref={underline.containerRef}
      className="pull-request-tabs codex-thread-tabs"
      role="tablist"
      aria-label={label}
    >
      <button
        className={`pull-request-tab ${!archived ? "active" : ""}`}
        data-active-tab={!archived ? "true" : undefined}
        role="tab"
        aria-selected={!archived}
        disabled={disabled}
        onClick={() => onChange(false)}
      >
        <MessageSquare size={14} />
        Active{activeCount !== undefined && <span>{activeCount}</span>}
      </button>
      <button
        className={`pull-request-tab ${archived ? "active" : ""}`}
        data-active-tab={archived ? "true" : undefined}
        role="tab"
        aria-selected={archived}
        disabled={disabled}
        onClick={() => onChange(true)}
      >
        <Archive size={14} />
        Archived{archivedCount !== undefined && <span>{archivedCount}</span>}
      </button>
      <span
        className="sliding-tab-underline"
        style={underline.underlineStyle}
        aria-hidden="true"
      />
    </div>
  );
}
