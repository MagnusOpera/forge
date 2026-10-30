import { useEffect, useState } from "react";
import type { CodexApi, CodexThreadSummary } from "../../shared/codex";
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
