import type { ReactNode } from "react";
import type { CodexThreadSummary } from "../../shared/codex";
import { CodexConversation } from "./conversation";
import { TerminalPanel } from "./terminal-panel";

export function ThreadWorkspace({
  repositoryId,
  id,
  thread,
  theme,
  terminalOpen,
  detached = false,
  loading = false,
  interactionDisabled = false,
  error,
  onOpen,
  onConfigure,
  onHideTerminal,
  quickActions,
}: {
  repositoryId: string;
  id?: string;
  thread?: CodexThreadSummary;
  theme: "light" | "dark";
  terminalOpen: boolean;
  detached?: boolean;
  loading?: boolean;
  interactionDisabled?: boolean;
  error?: string;
  onOpen?: () => void;
  onConfigure: () => void;
  onHideTerminal: () => void;
  quickActions?: ReactNode;
}) {
  const target = `${repositoryId}:${id ?? "none"}`;
  return (
    <div className="codex-workspace">
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {detached ? (
        <div className="codex-empty">
          <p>This thread is open in another window.</p>
          <button className="ghost-button" onClick={onOpen}>
            Focus thread window
          </button>
        </div>
      ) : (
        <CodexConversation
          key={`conversation:${target}`}
          repositoryId={repositoryId}
          id={id}
          loading={loading}
          theme={theme}
          interactionDisabled={interactionDisabled}
          onConfigure={onConfigure}
          quickActions={quickActions}
        />
      )}
      {!detached && terminalOpen && thread && !thread.archived && (
        <TerminalPanel
          key={`terminal:${target}`}
          thread={thread}
          theme={theme}
          onHide={onHideTerminal}
        />
      )}
    </div>
  );
}
