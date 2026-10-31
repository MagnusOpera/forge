import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { RotateCcw, TerminalSquare, Trash2, X } from "lucide-react";
import type { Terminal } from "ghostty-web";
import type { CodexThreadSummary } from "../../shared/codex";
import {
  terminalHeight,
  terminalInputChunks,
  type TerminalEvent,
  type TerminalSnapshot,
} from "../../shared/terminal";
import { codexApi, errorMessage } from "./api";
export function TerminalPanel({
  thread,
  theme,
  onHide,
}: {
  thread: CodexThreadSummary;
  theme: "light" | "dark";
  onHide: () => void;
}) {
  const root = useRef<HTMLElement>(null),
    mount = useRef<HTMLDivElement>(null),
    term = useRef<Terminal | null>(null);
  const session = useRef<TerminalSnapshot | null>(null);
  const dragCleanup = useRef<(() => void) | undefined>(undefined);
  const [error, setError] = useState(""),
    [exited, setExited] = useState(false),
    [exitCode, setExitCode] = useState<number | undefined>();
  const [generation, setGeneration] = useState(0),
    [ready, setReady] = useState(false);
  const storageKey = `forge:terminal-height:${thread.repositoryId}:${thread.id}`;
  const [available, setAvailable] = useState(600);
  const [minimumChatHeight, setMinimumChatHeight] = useState(260);
  const [height, setHeight] = useState(() => {
    try {
      return Number(localStorage.getItem(storageKey)) || 220;
    } catch {
      return 220;
    }
  });
  const size = terminalHeight(height, available, minimumChatHeight);
  const readTheme = () => {
    if (!root.current) return undefined;
    const css = getComputedStyle(root.current);
    const palette =
      theme === "dark"
        ? {
            black: "#24292e",
            red: "#f97583",
            green: "#85e89d",
            yellow: "#ffea7f",
            blue: "#79b8ff",
            magenta: "#b392f0",
            cyan: "#76e3ea",
            white: "#d1d5da",
            brightBlack: "#6a737d",
            brightRed: "#fdaeb7",
            brightGreen: "#bef5cb",
            brightYellow: "#fff5b1",
            brightBlue: "#c8e1ff",
            brightMagenta: "#d1bcf9",
            brightCyan: "#b3f0ff",
            brightWhite: "#ffffff",
          }
        : {
            black: "#24292e",
            red: "#b31d28",
            green: "#22863a",
            yellow: "#735c0f",
            blue: "#0366d6",
            magenta: "#6f42c1",
            cyan: "#1b7c83",
            white: "#6a737d",
            brightBlack: "#586069",
            brightRed: "#cb2431",
            brightGreen: "#176f2c",
            brightYellow: "#6c5005",
            brightBlue: "#005cc5",
            brightMagenta: "#5a32a3",
            brightCyan: "#147078",
            brightWhite: "#24292e",
          };
    return {
      ...palette,
      background: css.getPropertyValue("--content-bg").trim(),
      foreground: css.getPropertyValue("--text-base").trim(),
      cursor: css.getPropertyValue("--text-strong").trim(),
      selectionBackground: css.getPropertyValue("--accent-muted-bg").trim(),
    };
  };
  useEffect(() => {
    const parent = root.current?.parentElement;
    if (!parent) return;
    const composer = parent.querySelector<HTMLElement>(".codex-composer");
    const update = () => {
      setAvailable(parent.clientHeight);
      setMinimumChatHeight(
        Math.max(260, (composer?.getBoundingClientRect().height ?? 0) + 64),
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(parent);
    if (composer) observer.observe(composer);
    update();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(height));
    } catch {
      /* Storage may be unavailable. */
    }
  }, [height, storageKey]);
  useEffect(() => () => dragCleanup.current?.(), []);
  useEffect(() => {
    let cancelled = false,
      unsubscribe: (() => void) | undefined;
    let terminal: Terminal | undefined;
    let removeCopy: (() => void) | undefined;
    let snapshot: TerminalSnapshot | undefined;
    let cursor = 0;
    const pending: TerminalEvent[] = [];
    const attachmentId = crypto.randomUUID();
    const args = { repositoryId: thread.repositoryId, id: thread.id };
    const detach = () => {
      if (snapshot)
        void codexApi()
          .request("terminalDetach", {
            ...args,
            sessionId: snapshot.sessionId,
            attachmentId,
          })
          .catch(() => {});
    };
    const visibility = () => {
      if (document.hidden) detach();
      else if (!cancelled) setGeneration((value) => value + 1);
    };
    document.addEventListener("visibilitychange", visibility);
    setError("");
    setReady(false);
    setExited(false);
    session.current = null;
    const fail = (e: unknown) => {
      if (!cancelled) setError(errorMessage(e));
    };
    const acknowledge = (sequence: number) => {
      if (cancelled || !snapshot) return;
      void codexApi()
        .request("terminalAck", {
          ...args,
          sessionId: snapshot.sessionId,
          attachmentId,
          sequence,
        })
        .catch(fail);
    };
    const consume = (event: TerminalEvent) => {
      if (
        !snapshot ||
        !terminal ||
        cancelled ||
        event.sessionId !== snapshot.sessionId
      )
        return;
      if (event.data && event.sequence > cursor) {
        const data = event.data.slice(
          Math.max(0, event.data.length - (event.sequence - cursor)),
        );
        cursor = event.sequence;
        terminal.write(data, () => acknowledge(event.sequence));
      }
      if (event.exited) {
        snapshot.exited = true;
        setExited(true);
        setExitCode(event.exitCode);
        terminal.options.disableStdin = true;
      }
    };
    void (async () => {
      try {
        const { loadTerminalEngine } = await import("./terminal-engine");
        if (cancelled) return;
        const module = await loadTerminalEngine();
        if (cancelled || !mount.current) return;
        terminal = new module.Terminal({
          ghostty: module.ghostty,
          fontSize: 12,
          fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, monospace',
          cursorBlink: true,
          scrollback: 5000,
          disableStdin: true,
          theme: readTheme(),
        });
        const fit = new module.FitAddon();
        terminal.loadAddon(fit);
        terminal.open(mount.current);
        // Clear the mounted grid before replaying only this chat's history.
        terminal.write("\x1bc");
        term.current = terminal;
        const element = mount.current;
        const copy = (event: ClipboardEvent) => {
          if (!terminal?.hasSelection() || !event.clipboardData) return;
          event.preventDefault();
          event.clipboardData.setData("text/plain", terminal.getSelection());
        };
        element.addEventListener("copy", copy);
        removeCopy = () => element.removeEventListener("copy", copy);
        fit.fit();
        fit.observeResize();
        terminal.textarea?.setAttribute("aria-label", "Terminal input");
        unsubscribe = codexApi().onTerminalEvent((event) => {
          if (
            cancelled ||
            event.id !== thread.id ||
            event.repositoryId !== thread.repositoryId ||
            event.attachmentId !== attachmentId
          )
            return;
          if (!snapshot) pending.push(event);
          else consume(event);
        });
        snapshot = await codexApi().request("terminalOpen", {
          ...args,
          attachmentId,
          cols: Math.max(2, Math.min(500, terminal.cols)),
          rows: Math.max(2, Math.min(300, terminal.rows)),
        });
        if (cancelled) {
          void codexApi()
            .request("terminalDetach", {
              ...args,
              sessionId: snapshot.sessionId,
              attachmentId,
            })
            .catch(() => {});
          return;
        }
        session.current = snapshot;
        terminal.resize(snapshot.cols, snapshot.rows);
        cursor = snapshot.sequence;
        // A fresh PTY often has no output yet; Ghostty 0.4 cannot write an empty buffer.
        if (snapshot.data.length)
          terminal.write(snapshot.data, () => acknowledge(snapshot!.sequence));
        else acknowledge(snapshot.sequence);
        setExited(snapshot.exited);
        setExitCode(snapshot.exitCode);
        terminal.options.disableStdin = snapshot.exited;
        pending.forEach(consume);
        pending.length = 0;
        terminal.onData((data) => {
          if (cancelled || !snapshot || snapshot.exited) return;
          // Bound each IPC message; paste remains ordered through Electron's channel.
          for (const chunk of terminalInputChunks(data))
            void codexApi()
              .request("terminalWrite", {
                ...args,
                sessionId: snapshot.sessionId,
                data: chunk,
              })
              .catch(fail);
        });
        terminal.onResize(({ cols, rows }) => {
          if (cancelled || !snapshot) return;
          void codexApi()
            .request("terminalResize", {
              ...args,
              sessionId: snapshot.sessionId,
              cols: Math.max(2, Math.min(500, cols)),
              rows: Math.max(2, Math.min(300, rows)),
            })
            .catch(fail);
        });
        terminal.attachCustomKeyEventHandler((event) => {
          if (event.type !== "keydown" || !event.metaKey) return false;
          if (event.key.toLowerCase() === "a") {
            event.preventDefault();
            terminal!.selectAll();
            return true;
          }
          if (event.key.toLowerCase() === "c" && terminal!.hasSelection()) {
            event.preventDefault();
            void navigator.clipboard
              .writeText(terminal!.getSelection())
              .catch(fail);
            return true;
          }
          if (event.key.toLowerCase() === "v") {
            event.preventDefault();
            void navigator.clipboard
              .readText()
              .then((text) => {
                if (!cancelled) terminal?.paste(text);
              })
              .catch(fail);
            return true;
          }
          return false;
        });
        fit.fit();
        if (document.hidden) detach();
        else terminal.focus();
        setReady(true);
      } catch (e) {
        fail(e);
      }
    })();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", visibility);
      removeCopy?.();
      unsubscribe?.();
      if (snapshot)
        void codexApi()
          .request("terminalDetach", {
            ...args,
            sessionId: snapshot.sessionId,
            attachmentId,
          })
          .catch(() => {});
      terminal?.dispose();
      if (term.current === terminal) term.current = null;
    };
  }, [thread.id, thread.repositoryId, thread.worktree, generation, theme]);
  const startDrag = (event: ReactPointerEvent) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragCleanup.current?.();
    const startY = event.clientY,
      start = size;
    const move = (e: PointerEvent) =>
      setHeight(
        terminalHeight(
          start + startY - e.clientY,
          available,
          minimumChatHeight,
        ),
      );
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      dragCleanup.current = undefined;
    };
    dragCleanup.current = finish;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };
  const endSession = async (restart: boolean) => {
    const current = session.current;
    try {
      if (current)
        await codexApi().request("terminalClose", {
          repositoryId: thread.repositoryId,
          id: thread.id,
          sessionId: current.sessionId,
        });
      if (restart) setGeneration((value) => value + 1);
      else onHide();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <section
      className="codex-terminal"
      aria-label="Chat terminal"
      ref={root}
      style={{ height: size }}
    >
      <div
        className="codex-terminal-splitter"
        role="separator"
        aria-label="Resize terminal"
        aria-orientation="horizontal"
        aria-valuemin={90}
        aria-valuemax={Math.max(90, available - minimumChatHeight)}
        aria-valuenow={size}
        tabIndex={0}
        onPointerDown={startDrag}
        onKeyDown={(event) => {
          if (
            event.key === "ArrowUp" ||
            event.key === "ArrowDown" ||
            event.key === "Home" ||
            event.key === "End"
          ) {
            event.preventDefault();
            setHeight(
              terminalHeight(
                event.key === "Home"
                  ? 90
                  : event.key === "End"
                    ? available
                    : size + (event.key === "ArrowUp" ? 20 : -20),
                available,
                minimumChatHeight,
              ),
            );
          }
        }}
      />
      <header>
        <TerminalSquare size={13} />
        <span>Terminal</span>
        {exited && (
          <span className="codex-muted">
            Exited{exitCode !== undefined ? ` (${exitCode})` : ""}
          </span>
        )}
        <div className="codex-terminal-actions">
          {(exited || error) && (
            <button
              className="icon-button"
              title="Restart terminal"
              aria-label="Restart terminal"
              onClick={() => void endSession(true)}
            >
              <RotateCcw size={14} />
            </button>
          )}
          <button
            className="icon-button"
            title="End terminal session"
            aria-label="End terminal session"
            onClick={() => void endSession(false)}
          >
            <Trash2 size={14} />
          </button>
          <button
            className="icon-button"
            title="Hide terminal; keep session running"
            aria-label="Hide terminal"
            onClick={onHide}
          >
            <X size={14} />
          </button>
        </div>
      </header>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {!ready && !error && (
        <span className="codex-terminal-loading">Starting terminal…</span>
      )}
      <div className="codex-terminal-screen" ref={mount} />
    </section>
  );
}
