import type { CodexItem } from "../../shared/codex";
export type TranscriptEntry =
  | { type: "message"; item: CodexItem }
  | { type: "activity"; id: string; turnId?: string; items: CodexItem[] };

export function groupTranscript(items: CodexItem[]): TranscriptEntry[] {
  const result: TranscriptEntry[] = [];
  let pending: CodexItem[] = [];
  const flush = () => {
    if (pending.length)
      result.push({
        type: "activity",
        id: `activity:${pending[0].id}`,
        turnId: pending[0].turnId,
        items: pending,
      });
    pending = [];
  };
  items.forEach((item, index) => {
    if (pending.length && item.turnId !== pending[0].turnId) flush();
    // Older Codex histories do not have phases. Keep their last assistant message
    // visible and group earlier progress updates without crossing a user message.
    let laterAnswer = false;
    if (item.kind === "agentMessage" && !item.phase) {
      for (let next = index + 1; next < items.length; next++) {
        const candidate = items[next];
        if (
          candidate.kind === "userMessage" ||
          candidate.turnId !== item.turnId
        )
          break;
        if (
          candidate.kind === "agentMessage" &&
          candidate.phase !== "commentary"
        ) {
          laterAnswer = true;
          break;
        }
      }
    }
    if (
      item.kind === "userMessage" ||
      (item.kind === "agentMessage" &&
        item.phase !== "commentary" &&
        !laterAnswer)
    ) {
      flush();
      result.push({ type: "message", item });
    } else pending.push(item);
  });
  flush();
  return result;
}
export function workedDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
