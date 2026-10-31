// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TranscriptView } from "./transcript-view";
import type { CodexApi, CodexGitInfo } from "../../shared/codex";

vi.mock("./diff-files", () => ({
  default: ({ info }: { info: CodexGitInfo }) =>
    <div aria-label="Rendered diff">{info.diff}</div>,
}));
let container: HTMLDivElement, root: Root;
const request = vi.fn();
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  request.mockReset();
  window.forgeCodex = { request } as unknown as CodexApi;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.forgeCodex;
});
const render = async () => act(async () => root.render(<TranscriptView
  thread={{ id: "t", repositoryId: "r", state: "idle", turns: { turn: { durationMs: 70_000 } }, items: [
    { id: "edit", kind: "fileChange", turnId: "turn", text: "", changes: Array.from({ length: 8 }, (_, n) => ({ path: `src/file${n}.ts`, diff: "@@ -1 +1 @@\n-old\n+new\n" })) },
    { id: "answer", kind: "agentMessage", phase: "final_answer", turnId: "turn", text: "Fixed the issue." },
  ] }} onError={() => {}} theme="light"
/>));

it("shows the edited-file summary after the answer and expands the remaining files", async () => {
  await render();
  expect(container.textContent).toContain("Worked for 1m 10s");
  const card = container.querySelector('[aria-label="Edited files"]')!;
  expect(card.textContent).toContain("Edited 8 files");
  expect(card.querySelector("header")?.textContent).toContain("+8 -8");
  expect(card.querySelectorAll(".codex-edited-file:not(.codex-edited-toggle)")).toHaveLength(3);
  const toggle = card.querySelector<HTMLButtonElement>('[aria-expanded="false"]')!;
  expect(toggle.textContent).toContain("Show 5 more files");
  act(() => toggle.click());
  expect(card.querySelectorAll(".codex-edited-file:not(.codex-edited-toggle)")).toHaveLength(8);
  expect(container.textContent!.indexOf("Fixed the issue.")).toBeLessThan(container.textContent!.indexOf("Edited 8 files"));
});

it("opens a selected file's recorded diff without fetching today's worktree changes", async () => {
  await render();
  const file = container.querySelector<HTMLButtonElement>(".codex-edited-file")!;
  file.focus();
  await act(async () => file.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.querySelector("h2")?.textContent).toBe("src/file0.ts");
  expect(dialog.querySelector('[aria-label="Rendered diff"]')?.textContent).toContain("src/file0.ts");
  expect(dialog.querySelector('[aria-label="Rendered diff"]')?.textContent).not.toContain("src/file1.ts");
  expect(dialog.textContent).toContain("-old\n+new");
  expect(request).not.toHaveBeenCalled();
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(file);
});
