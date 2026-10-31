import type { CodexFileChange, CodexItem, CodexTurnTiming } from "../../shared/codex";
export type TranscriptEntry =
  | { type: "message"; item: CodexItem }
  | { type: "activity"; id: string; turnId?: string; items: CodexItem[] };

export function groupTranscript(
  items: CodexItem[],
  turns: Record<string, CodexTurnTiming> = {},
): TranscriptEntry[] {
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
    // Older histories have no phases. Find their final reply so an empty timed
    // separator is added before the answer, rather than before a progress update.
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
    if (item.kind === "userMessage" || item.kind === "agentMessage") {
      flush();
      const previous = result.at(-1);
      if (
        item.kind === "agentMessage" && item.phase !== "commentary" && !laterAnswer &&
        item.turnId && turns[item.turnId] &&
        !(previous?.type === "activity" && previous.turnId === item.turnId)
      )
        result.push({
          type: "activity", id: `activity:${item.id}`, turnId: item.turnId, items: [],
        });
      result.push({ type: "message", item });
    } else pending.push(item);
  });
  flush();
  return result;
}

type EditedFile = CodexFileChange & { additions: number; deletions: number };
export function editedFiles(items: CodexItem[], turnId: string): EditedFile[] {
  const files = new Map<string, EditedFile>();
  for (const item of items) {
    if (
      item.turnId !== turnId || item.kind !== "fileChange" ||
      item.status === "failed" || item.status === "declined"
    ) continue;
    for (const change of item.changes ?? []) {
      const file = files.get(change.path) ?? { ...change, diff: "", additions: 0, deletions: 0 };
      file.diff += `${file.diff ? "\n" : ""}${change.diff}`;
      for (const line of change.diff.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) file.additions++;
        if (line.startsWith("-") && !line.startsWith("---")) file.deletions++;
      }
      files.set(change.path, file);
    }
  }
  return [...files.values()];
}

export function recordedPatch(changes: CodexFileChange[]): string {
  return changes.map(({ path, diff }) => {
    if (diff.startsWith("diff --git ")) return diff;
    const header = `diff --git a/${path} b/${path}\n`;
    return header + (diff.startsWith("--- ") ? diff : `--- a/${path}\n+++ b/${path}\n${diff}`);
  }).join("\n");
}
export function workedDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
