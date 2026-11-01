import { DatabaseSync } from "node:sqlite";
import type { CodexThread, CodexThreadSearchResult } from "../../../shared/codex.js";

// Treat input as literal prefix terms, never as FTS operators or SQL.
export function conversationSearchQuery(query: string): string {
  return (query.match(/[\p{L}\p{N}_]+/gu) ?? [])
    .map((term) => `"${term}"*`)
    .join(" AND ");
}

export class ConversationSearch {
  private readonly db = new DatabaseSync(":memory:");
  constructor() {
    this.db.exec(`CREATE VIRTUAL TABLE conversations USING fts5(
      title, body, id UNINDEXED, repository_id UNINDEXED,
      archived UNINDEXED, updated_at UNINDEXED
    )`);
  }
  update(thread: CodexThread): void {
    const body = thread.items
      .filter((item) => item.kind === "userMessage" || item.kind === "agentMessage")
      .map((item) => item.text)
      .join("\n\n");
    this.db.prepare("DELETE FROM conversations WHERE id = ?").run(thread.id);
    this.db.prepare(`INSERT INTO conversations
      (title, body, id, repository_id, archived, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(thread.title, body, thread.id, thread.repositoryId, Number(thread.archived), thread.updatedAt);
  }
  search(repositoryId: string, query: string, archived: boolean): CodexThreadSearchResult[] {
    const match = conversationSearchQuery(query);
    if (!match) return [];
    return this.db.prepare(`SELECT id,
        snippet(conversations, -1, '', '', '…', 24) AS snippet
      FROM conversations
      WHERE conversations MATCH ? AND repository_id = ? AND archived = ?
      ORDER BY bm25(conversations, 4.0, 1.0) ASC, updated_at DESC, id ASC`)
      .all(match, repositoryId, Number(archived)) as CodexThreadSearchResult[];
  }
  close(): void {
    this.db.close();
  }
}
