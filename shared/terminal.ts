export type TerminalTarget = { repositoryId: string; id: string };
export type TerminalSnapshot = TerminalTarget & {
  sessionId: string;
  attachmentId: string;
  cwd: string;
  cols: number;
  rows: number;
  data: string;
  sequence: number;
  exited: boolean;
  exitCode?: number;
};
export type TerminalEvent = TerminalTarget & {
  sessionId: string;
  attachmentId: string;
  sequence: number;
  data?: string;
  exited?: boolean;
  exitCode?: number;
};
export function terminalDimensions(
  cols: unknown,
  rows: unknown,
): { cols: number; rows: number } {
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    Number(cols) < 2 ||
    Number(cols) > 500 ||
    Number(rows) < 2 ||
    Number(rows) > 300
  )
    throw new Error("Invalid terminal dimensions.");
  return { cols: Number(cols), rows: Number(rows) };
}
export function terminalHeight(
  height: number,
  available: number,
  minimumChatHeight = 260,
): number {
  return Math.round(
    Math.max(
      90,
      Math.min(
        Number.isFinite(height) ? height : 220,
        Math.max(90, available - minimumChatHeight),
      ),
    ),
  );
}

export function terminalInputChunks(data: string): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < data.length;) {
    let end = Math.min(offset + 32768, data.length);
    const code = data.charCodeAt(end - 1);
    if (end < data.length && code >= 0xd800 && code <= 0xdbff) end--;
    chunks.push(data.slice(offset, end));
    offset = end;
  }
  return chunks;
}
