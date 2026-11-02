import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { ChatProject, ChatThread } from "../../../shared/chatgpt.js";
import { requiredText } from "./protocol.js";

export class ChatStore {
  projects: ChatProject[] = [];
  threads: ChatThread[] = [];
  private file: string;
  constructor(readonly root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.file = path.join(root, "history.json");
    if (existsSync(this.file)) {
      const saved = JSON.parse(readFileSync(this.file, "utf8"));
      if (
        saved.version !== 1 ||
        !Array.isArray(saved.projects) ||
        !Array.isArray(saved.threads)
      )
        throw new Error(
          "ChatGPT history could not be read. The original file has been preserved.",
        );
      this.projects = saved.projects;
      this.threads = saved.threads;
      for (const thread of this.threads)
        for (const message of thread.messages)
          if (message.status === "streaming") {
            message.status = "stopped";
            thread.error =
              "The previous response was interrupted. Send a message to continue.";
          }
    }
  }
  save() {
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(
      temporary,
      JSON.stringify({
        version: 1,
        projects: this.projects,
        threads: this.threads,
      }),
      { mode: 0o600 },
    );
    renameSync(temporary, this.file);
  }
  project(input: { id?: string; name: string; instructions: string }) {
    const name = requiredText(input.name, "project name", 100);
    if (
      typeof input.instructions !== "string" ||
      input.instructions.length > 32000
    )
      throw new Error(
        "Project instructions must be 32,000 characters or fewer.",
      );
    const project = input.id
      ? this.projects.find((p) => p.id === input.id)
      : { id: randomUUID(), name, instructions: input.instructions };
    if (!project) throw new Error("Unknown ChatGPT project.");
    project.name = name;
    project.instructions = input.instructions;
    if (!input.id) this.projects.push(project);
    this.save();
    return project;
  }
  reorderProjects(sourceId: string, targetId: string) {
    const source = this.projects.findIndex((p) => p.id === sourceId);
    const target = this.projects.findIndex((p) => p.id === targetId);
    if (source < 0 || target < 0) throw new Error("Unknown ChatGPT project.");
    if (source === target) return;
    const [project] = this.projects.splice(source, 1);
    this.projects.splice(target, 0, project);
    this.save();
  }
  deleteProject(id: string) {
    if (!this.projects.some((p) => p.id === id))
      throw new Error("Unknown ChatGPT project.");
    this.projects = this.projects.filter((p) => p.id !== id);
    this.threads = this.threads.filter((t) => t.projectId !== id);
    this.save();
  }
  create(projectId: string, model: string) {
    if (!this.projects.some((p) => p.id === projectId))
      throw new Error("Choose a ChatGPT project first.");
    const thread: ChatThread = {
      id: randomUUID(),
      projectId,
      model,
      title: "New thread",
      updatedAt: Date.now(),
      messages: [],
    };
    this.threads.unshift(thread);
    this.save();
    return thread;
  }
  get(id: string) {
    const thread = this.threads.find((t) => t.id === id);
    if (!thread) throw new Error("Unknown ChatGPT chat.");
    return thread;
  }
}
