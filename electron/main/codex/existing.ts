import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import path from "node:path";
import {
  effectiveCodexPreferences,
  resolveModelPreferences,
  type CodexExistingThread,
  type CodexThread,
} from "../../../shared/codex.js";
import { array, object, text } from "./client.js";
import { git } from "./git.js";
import { reduceCodexEvent } from "./events.js";
import { threadSummary } from "./store.js";
import type { ThreadManager } from "./threads.js";

export async function repositoryDirectory(folder: string): Promise<string> {
  return realpath(
    (
      await git(folder, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ])
    ).trim(),
  );
}
export async function belongsToRepository(
  folder: string,
  repository: string,
): Promise<boolean> {
  if (!path.isAbsolute(folder)) return false;
  try {
    return (
      (await repositoryDirectory(folder)) ===
      (await repositoryDirectory(repository))
    );
  } catch {
    return false;
  }
}
const timestamp = (value: unknown): string => {
  const date = new Date(
    typeof value === "number" ? value * 1000 : String(value),
  );
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
};
export function existingThread(
  value: unknown,
  archived: boolean,
): CodexExistingThread {
  const entry = object(value);
  return {
    id: text(entry.id),
    title:
      text(entry.name) || text(entry.preview).slice(0, 120) || "Codex thread",
    cwd: text(entry.cwd),
    updatedAt: timestamp(entry.updatedAt),
    archived,
    active: object(entry.status).type === "active",
  };
}
export class ExistingThreads {
  private adopting = new Map<
    string,
    Promise<ReturnType<typeof threadSummary>>
  >();
  constructor(
    private manager: ThreadManager,
    readonly home: string,
  ) {}
  private project(repositoryId: string) {
    const project = this.manager.store.configuration.projects[repositoryId];
    if (!project?.path)
      throw new Error(
        "Choose this project's local Git folder in project configuration first.",
      );
    return project;
  }
  private async runtime() {
    if (!existsSync(this.home))
      throw new Error(
        `Codex data folder not found: ${this.home}. Open Codex and create a local thread first.`,
      );
    const runtime = this.manager.runtime(this.home);
    await runtime.client.start();
    return runtime;
  }
  async list(repositoryId: string, cursor?: string, archived = false) {
    const project = this.project(repositoryId),
      { client } = await this.runtime();
    const threads: CodexExistingThread[] = [];
    const membership = new Map<string, boolean>();
    let nextCursor = cursor || null;
    const seen = new Set<string>(cursor ? [cursor] : []);
    // Bound each scan so a large unrelated history cannot block the renderer indefinitely.
    for (let page = 0; page < 5; page++) {
      const result = object(
        await client.request("thread/list", {
          limit: 50,
          sortKey: "updated_at",
          archived,
          useStateDbOnly: false,
          sourceKinds: ["cli", "vscode", "appServer", "unknown"],
          ...(nextCursor ? { cursor: nextCursor } : {}),
        }),
      );
      for (const value of array(result.data)) {
        const entry = existingThread(value, archived);
        if (!entry.id) continue;
        if (!membership.has(entry.cwd))
          membership.set(
            entry.cwd,
            await belongsToRepository(entry.cwd, project.path),
          );
        if (!membership.get(entry.cwd)) continue;
        entry.attachedId = [...this.manager.store.threads.values()].find(
          (t) => t.sourceHome === this.home && t.serverId === entry.id,
        )?.id;
        if (!threads.some((t) => t.id === entry.id)) threads.push(entry);
      }
      nextCursor = text(result.nextCursor) || null;
      if (!nextCursor || seen.has(nextCursor)) {
        nextCursor = null;
        break;
      }
      seen.add(nextCursor);
      if (threads.length) break;
    }
    return { home: this.home, threads, nextCursor };
  }

  adopt(repositoryId: string, serverId: string, archived: boolean) {
    const key = `${repositoryId}:${serverId}`;
    let pending = this.adopting.get(key);
    if (!pending) {
      pending = this.attach(repositoryId, serverId, archived).finally(() =>
        this.adopting.delete(key),
      );
      this.adopting.set(key, pending);
    }
    return pending;
  }
  private async attach(
    repositoryId: string,
    serverId: string,
    archived: boolean,
  ) {
    const store = this.manager.store,
      project = this.project(repositoryId);
    const previous = [...store.threads.values()].find(
      (t) => t.sourceHome === this.home && t.serverId === serverId,
    );
    if (previous) {
      if (previous.repositoryId !== repositoryId)
        throw new Error(
          "This Codex thread is already attached to another project.",
        );
      this.manager.update(previous, { archived: false });
      return threadSummary(previous);
    }
    const { client, models } = await this.runtime();
    const result = object(
      await client.request("thread/read", { threadId: serverId }),
    );
    const entry = existingThread(result.thread, archived);
    if (entry.id !== serverId)
      throw new Error(
        "Codex returned a different thread. Nothing was attached.",
      );
    if (entry.active)
      throw new Error(
        "This thread is running in Codex. Finish or stop it there before resuming in Forge.",
      );
    if (!(await belongsToRepository(entry.cwd, project.path)))
      throw new Error(
        "This thread's working folder does not belong to this project, or is missing.",
      );
    const worktree = await realpath(
      (await git(entry.cwd, ["rev-parse", "--show-toplevel"])).trim(),
    );
    const baseCommit = (
      await git(worktree, ["rev-parse", "--verify", "HEAD^{commit}"])
    ).trim();
    const branch = (await git(worktree, ["branch", "--show-current"])).trim();
    const settings = resolveModelPreferences(
      effectiveCodexPreferences(
        store.configuration.defaults,
        project.overrides,
      ),
      await models(),
    );
    if (archived)
      await client.request("thread/unarchive", { threadId: serverId });
    const now = new Date().toISOString();
    const thread: CodexThread = {
      id: randomUUID(),
      repositoryId,
      serverId,
      sourceHome: this.home,
      title: entry.title,
      createdAt: now,
      updatedAt: now,
      settings,
      archived: false,
      state: "idle",
      repositoryPath: project.path,
      worktree,
      branch,
      baseCommit,
      items: [],
      requests: [],
      queue: [],
      queuePaused: true,
      draft: "",
      draftAttachments: [],
    };
    // Recent history is optional. The original thread remains the model's source of context.
    try {
      const history = object(
        await client.request("thread/turns/list", {
          threadId: serverId,
          limit: 50,
          sortDirection: "desc",
          itemsView: "full",
        }),
      );
      for (const turn of array(history.data).reverse().map(object))
        for (const item of array(turn.items))
          reduceCodexEvent(thread, {
            method: "item/completed",
            params: { item },
          });
      if (history.nextCursor)
        thread.historyWarning =
          "Showing the most recent 50 turns. Codex retains the earlier conversation context.";
    } catch {
      thread.historyWarning =
        "Earlier history could not be displayed. Codex will resume the original thread with its stored context.";
    }
    // Persist before publishing; a failed write must not leave an invisible attached thread.
    store.saveThread(thread);
    store.threads.set(thread.id, thread);
    this.manager.update(thread, {});
    return threadSummary(thread);
  }
}
