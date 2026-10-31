import { useEffect, useState } from "react";
import type {
  CodexApi,
  CodexThreadSummary,
  CodexThreadWindow,
} from "../../shared/codex";
export function codexApi(): CodexApi {
  if (!window.forgeCodex)
    throw new Error("Codex requires the Forge desktop app.");
  return window.forgeCodex;
}
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
export function useCodexThreads(repositoryId?: string): {
  threads: CodexThreadSummary[];
  error: string;
} {
  const [threads, setThreads] = useState<CodexThreadSummary[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    setThreads([]);
    setError("");
    if (!repositoryId) return;
    let active = true,
      version = 0;
    const refresh = () => {
      const revision = ++version;
      void codexApi()
        .request("list", { repositoryId })
        .then((result) => {
          if (active && revision === version) {
            setThreads(result);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(errorMessage(e));
        });
    };
    if (!window.forgeCodex) {
      setError("Codex requires the Forge desktop app.");
      return;
    }
    refresh();
    const unsubscribe = codexApi().onChanged((change) => {
      if (!change.repositoryId || change.repositoryId === repositoryId)
        refresh();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [repositoryId]);
  return { threads, error };
}

export function useThreadWindows(): CodexThreadWindow[] {
  const [windows, setWindows] = useState<CodexThreadWindow[]>([]);
  useEffect(() => {
    if (!window.forgeCodex) return;
    let active = true;
    const refresh = () =>
      void codexApi()
        .request("threadWindows", {})
        .then((result) => {
          if (active && Array.isArray(result)) setWindows(result);
        })
        .catch(() => undefined);
    refresh();
    const unsubscribe = codexApi().onChanged((change) => {
      if (change.windowChanged) refresh();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return windows;
}
