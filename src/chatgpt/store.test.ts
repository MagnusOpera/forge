import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ChatStore } from "../../electron/main/chatgpt/store";
let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "forge-chatgpt-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
it("persists projects, instructions and conversations across restarts", () => {
  const store = new ChatStore(root);
  const project = store.project({
    name: "Forge",
    instructions: "Keep answers concise.",
  });
  const thread = store.create(project.id, "available-model");
  thread.messages.push({
    id: "message",
    text: "Hello",
    role: "user",
    status: "complete",
  });
  store.save();
  const restored = new ChatStore(root);
  expect(restored.projects).toEqual([project]);
  expect(restored.get(thread.id)).toEqual(thread);
  expect(statSync(path.join(root, "history.json")).mode & 0o777).toBe(0o600);
});
it("recovers streaming responses as interrupted without discarding partial text", () => {
  const store = new ChatStore(root),
    project = store.project({ name: "Project", instructions: "" });
  const thread = store.create(project.id, "model");
  thread.messages.push({
    id: "partial",
    role: "assistant",
    text: "Partial reply",
    status: "streaming",
  });
  store.save();
  const restored = new ChatStore(root).get(thread.id);
  expect(restored.messages[0]).toMatchObject({
    text: "Partial reply",
    status: "stopped",
  });
  expect(restored.error).toContain("interrupted");
});
it("rejects invalid projects and preserves unreadable history", () => {
  const store = new ChatStore(root);
  expect(() => store.create("unknown", "model")).toThrow();
  expect(() => store.project({ name: " ", instructions: "" })).toThrow();
  expect(() =>
    store.project({ id: "unknown", name: "Project", instructions: "" }),
  ).toThrow();
  const file = path.join(root, "history.json");
  writeFileSync(file, "corrupted");
  expect(() => new ChatStore(root)).toThrow();
  expect(readFileSync(file, "utf8")).toBe("corrupted");
});

it("persists project ordering without affecting conversations and validates reorder targets", () => {
  const store = new ChatStore(root);
  const a = store.project({ name: "A", instructions: "" });
  const b = store.project({ name: "B", instructions: "" });
  const c = store.project({ name: "C", instructions: "" });
  const thread = store.create(b.id, "model");
  store.reorderProjects(c.id, a.id);
  expect(new ChatStore(root).projects.map((p) => p.id)).toEqual([
    c.id,
    a.id,
    b.id,
  ]);
  store.reorderProjects(c.id, b.id);
  expect(new ChatStore(root).projects.map((p) => p.id)).toEqual([
    a.id,
    b.id,
    c.id,
  ]);
  expect(new ChatStore(root).get(thread.id)).toEqual(thread);
  expect(() => store.reorderProjects("unknown", a.id)).toThrow();
});
it("deletes only the chosen project's history and preserves that deletion across restarts", () => {
  const store = new ChatStore(root);
  const a = store.project({ name: "A", instructions: "" });
  const b = store.project({ name: "B", instructions: "" });
  store.create(a.id, "model");
  const retained = store.create(b.id, "model");
  store.deleteProject(a.id);
  const saved = new ChatStore(root);
  expect(saved.projects).toEqual([b]);
  expect(saved.threads).toEqual([retained]);
  expect(() => store.deleteProject("unknown")).toThrow();
});
