import {
  mkdirSync,
  openSync,
  closeSync,
  fsyncSync,
  writeFileSync,
  renameSync,
  readFileSync,
  readdirSync,
  existsSync,
  truncateSync,
  fstatSync,
  ftruncateSync,
} from "node:fs";
import path from "node:path";
import {
  defaultCodexPreferences,
  DEFAULT_TEXT_EDITOR,
  codexIsActive,
  type CodexConfiguration,
  type CodexItem,
  type CodexThread,
  type CodexThreadSummary,
} from "../../../shared/codex.js";

export function atomicWrite(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp`;
  const fd = openSync(temporary, "w", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, file);
  const dir = openSync(path.dirname(file), "r");
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}
export function recoverThread(thread: CodexThread): CodexThread {
  if (codexIsActive(thread)) {
    thread.state = "interrupted";
    thread.error =
      "Forge stopped before this turn completed. The worktree and conversation were retained. Resume explicitly.";
  }
  thread.requests = [];
  thread.turnId = undefined;
  thread.queuePaused = true;
  return thread;
}
export function threadSummary(thread: CodexThread): CodexThreadSummary {
  const {
    id,
    repositoryId,
    title,
    archived,
    createdAt,
    updatedAt,
    settings,
    state,
    error,
    worktree,
    branch,
    baseCommit,
    checkout,
    worktreeGeneration,
    start,
    mergedInto,
    environment,
    sourceHome,
    accountId,
    historyWarning,
  } = thread;
  return {
    id,
    repositoryId,
    title,
    archived,
    createdAt,
    updatedAt,
    settings,
    state,
    error,
    worktree,
    branch,
    baseCommit,
    checkout,
    worktreeGeneration,
    start,
    mergedInto,
    environment,
    sourceHome,
    accountId,
    historyWarning,
  };
}
export class CodexStore {
  configuration: CodexConfiguration;
  threads = new Map<string, CodexThread>();
  private savedItems = new Map<string, Map<string, CodexItem>>();
  constructor(readonly root: string) {
    const configurationPath = path.join(root, "configuration.json");
    this.configuration = existsSync(configurationPath)
      ? (JSON.parse(
          readFileSync(configurationPath, "utf8"),
        ) as CodexConfiguration)
      : {
          defaults: { ...defaultCodexPreferences },
          executable: "",
          editor: DEFAULT_TEXT_EDITOR,
          projects: {},
        };
    this.configuration.version ??= 1;
    this.configuration.environments ??= [];
    this.configuration.editor ??= DEFAULT_TEXT_EDITOR;
    this.configuration.sendShortcut ??= "enter";
    const directory = path.join(root, "threads");
    if (existsSync(directory))
      for (const name of readdirSync(directory).filter((name) =>
        /^[a-f0-9-]{36}\.json$/.test(name),
      )) {
        const thread = recoverThread(
          JSON.parse(
            readFileSync(path.join(directory, name), "utf8"),
          ) as CodexThread,
        );
        const history = path.join(directory, `${thread.id}.items.jsonl`);
        if (existsSync(history)) {
          const data = readFileSync(history, "utf8");
          // A power loss may leave one unfinished append. Keep every complete record.
          const complete = data.endsWith("\n")
            ? data
            : data.slice(0, data.lastIndexOf("\n") + 1);
          if (complete !== data)
            truncateSync(history, Buffer.byteLength(complete));
          const items = new Map(thread.items.map((item) => [item.id, item]));
          for (const line of complete.split("\n").filter(Boolean)) {
            const item = JSON.parse(line) as CodexItem & { deleted?: boolean };
            if (item.deleted) items.delete(item.id);
            else items.set(item.id, item);
          }
          thread.items = [...items.values()];
          this.savedItems.set(
            thread.id,
            new Map(thread.items.map((item) => [item.id, { ...item }])),
          );
        }
        this.threads.set(thread.id, thread);
        this.saveThread(thread);
      }
  }
  saveConfiguration(): void {
    atomicWrite(path.join(this.root, "configuration.json"), this.configuration);
  }
  saveThread(thread: CodexThread): void {
    const directory = path.join(this.root, "threads");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const saved =
      this.savedItems.get(thread.id) ?? new Map<string, CodexItem>();
    const changes = thread.items.filter((item) => {
      const previous = saved.get(item.id);
      return (
        !previous ||
        previous.kind !== item.kind ||
        previous.text !== item.text ||
        previous.status !== item.status ||
        previous.turnId !== item.turnId ||
        previous.phase !== item.phase ||
        previous.createdAt !== item.createdAt
      );
    });
    const currentIds = new Set(thread.items.map((item) => item.id));
    const removed = [...saved.keys()].filter((id) => !currentIds.has(id));
    if (changes.length || removed.length) {
      const fd = openSync(
        path.join(directory, `${thread.id}.items.jsonl`),
        "a",
        0o600,
      );
      const previousSize = fstatSync(fd).size;
      try {
        writeFileSync(
          fd,
          [
            ...removed.map((id) => JSON.stringify({ id, deleted: true })),
            ...changes.map((item) => JSON.stringify(item)),
          ].join("\n") + "\n",
        );
        fsyncSync(fd);
      } catch (error) {
        try {
          ftruncateSync(fd, previousSize);
          fsyncSync(fd);
        } catch {
          /* Preserve the original write error. */
        }
        throw error;
      } finally {
        closeSync(fd);
      }
      for (const id of removed) saved.delete(id);
      for (const item of changes) saved.set(item.id, { ...item });
      this.savedItems.set(thread.id, saved);
    }
    // Streaming appends changes; deletion records retain edits across restart.
    atomicWrite(path.join(directory, `${thread.id}.json`), {
      ...thread,
      items: [],
    });
  }
  get(repositoryId: string, id: string): CodexThread {
    const thread = this.threads.get(id);
    if (!thread || thread.repositoryId !== repositoryId)
      throw new Error("Thread does not belong to this project.");
    return thread;
  }
  list(repositoryId: string): CodexThreadSummary[] {
    return [...this.threads.values()]
      .filter((t) => t.repositoryId === repositoryId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(threadSummary);
  }
}
