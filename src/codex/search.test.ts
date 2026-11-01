import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { ConversationSearch, conversationSearchQuery } from "../../electron/main/codex/search";
import { CodexStore } from "../../electron/main/codex/store";
import { defaultCodexPreferences, type CodexThread } from "../../shared/codex";

const indexes: ConversationSearch[] = [];
const roots: string[] = [];
const stores: CodexStore[] = [];
afterEach(() => {
  indexes.splice(0).forEach((index) => index.close());
  stores.splice(0).forEach((store) => store.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});
function thread(title: string, body = "", overrides: Partial<CodexThread> = {}): CodexThread {
  return {
    id: randomUUID(), repositoryId: "repo", title, archived: false,
    createdAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T10:00:00Z",
    settings: defaultCodexPreferences, state: "idle", worktree: "/repo", branch: "main",
    baseCommit: "base", serverId: "server", repositoryPath: "/repo", queue: [], requests: [],
    queuePaused: true, draft: "", draftAttachments: [],
    items: [{ id: "message", kind: "agentMessage", text: body }], ...overrides,
  };
}
function index(...threads: CodexThread[]) {
  const result = new ConversationSearch();
  indexes.push(result);
  threads.forEach((thread) => result.update(thread));
  return result;
}
it("matches titles and full user/assistant history with case-insensitive prefixes and all terms", () => {
  const title = thread("Authentication configuration");
  const body = thread("Other topic", "Implement authentication through configuration.");
  const user = thread("Question", "", { items: [{ id: "user", kind: "userMessage", text: "AUTHENTICATION configuration?" }] });
  const unrelated = thread("Authentication only");
  const search = index(title, body, user, unrelated);
  const matches = search.search("repo", "AUTH config", false);
  expect(matches.map((match) => match.id)).toEqual(expect.arrayContaining([title.id, body.id, user.id]));
  expect(matches).toHaveLength(3);
  expect(matches[0].id).toBe(title.id);
  expect(matches.find((match) => match.id === body.id)?.snippet).toContain("authentication");
});
it("keeps projects and archive filters separate and excludes tools, drafts, and queued messages", () => {
  const active = thread("First", "needle");
  const archived = thread("Archived", "needle", { archived: true });
  const other = thread("Other project", "needle", { repositoryId: "other" });
  const tools = thread("Tool only", "", {
    items: [{ id: "tool", kind: "commandExecution", text: "needle" }],
    draft: "needle", queue: [{ id: "queued", text: "needle", attachments: [] }],
  });
  const search = index(active, archived, other, tools);
  expect(search.search("repo", "needle", false).map((match) => match.id)).toEqual([active.id]);
  expect(search.search("repo", "needle", true).map((match) => match.id)).toEqual([archived.id]);
});
it("normalizes punctuation and Unicode safely without accepting query operators", () => {
  const document = thread("Café configuration", "A quoted \"phrase\" in src/config.ts");
  const search = index(document);
  expect(conversationSearchQuery('  "+()* : -  ')).toBe("");
  for (const query of ["", "  ", "\"()*:+-", '" OR *', "NOT", "NEAR(config)"]) {
    expect(() => search.search("repo", query, false)).not.toThrow();
  }
  expect(search.search("repo", "cafe config", false)[0].id).toBe(document.id);
  expect(search.search("repo", "src/config.ts", false)[0].id).toBe(document.id);
  expect(search.search("repo", '"phrase"', false)[0].id).toBe(document.id);
});
it("replaces indexed text and archive state without duplicate or stale matches", () => {
  const document = thread("Initial", "obsolete");
  const search = index(document);
  document.items[0].text = "replacement";
  document.title = "Renamed";
  document.archived = true;
  search.update(document);
  expect(search.search("repo", "obsolete", true)).toEqual([]);
  expect(search.search("repo", "initial", true)).toEqual([]);
  expect(search.search("repo", "replacement", false)).toEqual([]);
  expect(search.search("repo", "replacement", true)).toHaveLength(1);
  expect(search.search("repo", "renamed", true)).toHaveLength(1);
});
it("indexes complete persisted history on first search and keeps edits current across restart", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-search-"));
  roots.push(root);
  const store = new CodexStore(root);
  stores.push(store);
  const document = thread("Saved", "original");
  store.threads.set(document.id, document);
  store.saveThread(document);
  expect(store.search("repo", "original", false)).toHaveLength(1);
  document.items = [{ id: "edited", kind: "userMessage", text: "updated" }];
  store.saveThread(document);
  expect(store.search("repo", "original", false)).toEqual([]);
  expect(store.search("repo", "updated", false)).toHaveLength(1);
  const recovered = new CodexStore(root);
  stores.push(recovered);
  expect(recovered.search("repo", "updated", false)).toHaveLength(1);
  expect(recovered.search("repo", "original", false)).toEqual([]);
});
