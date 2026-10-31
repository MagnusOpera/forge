// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TranscriptView } from "./transcript-view";
import type { CodexItem, CodexThread } from "../../shared/codex";

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});
const work = (id: string, turnId: string | undefined = "turn"): CodexItem => ({
  id, kind: "commandExecution", text: `Command ${id}`, turnId,
});
const followup: CodexItem = { id: "followup", kind: "userMessage", text: "Also check this", turnId: "turn" };
const render = (items: CodexItem[], state: CodexThread["state"] = "running", turnId: string | undefined = state === "starting" ? undefined : "turn") => act(() => root.render(
  <TranscriptView thread={{ id: "t", repositoryId: "r", state, turnId, items,
    turns: { turn: { startedAt: 95_000, ...(state === "idle" ? { durationMs: 6000 } : {}) } },
  }} onError={() => {}} />,
));
const summaries = () => [...container.querySelectorAll(".codex-work-activity > summary")].map((node) => node.textContent);

it("runs only one live timer when a follow-up splits the active turn", () => {
  const items = [work("first"), followup, work("second")];
  render(items);
  expect(summaries()).toEqual(["Activity", "Working for 5s"]);
  expect(vi.getTimerCount()).toBe(1);
  act(() => vi.advanceTimersByTime(1000));
  expect(summaries()).toEqual(["Activity", "Working for 6s"]);
  // Earlier tools remain in order and accessible through the disclosure.
  expect(container.textContent).toContain("Command first");
  expect(container.textContent!.indexOf("Command first")).toBeLessThan(container.textContent!.indexOf("Also check this"));
  render(items, "idle");
  expect(summaries()).toEqual(["Activity", "Worked for 6s"]);
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps one live timer below a follow-up before more tool output arrives", () => {
  render([work("first"), followup]);
  expect(summaries()).toEqual(["Activity", "Working for 5s"]);
  expect(vi.getTimerCount()).toBe(1);
  expect(container.lastElementChild?.lastElementChild?.className).toBe("codex-work-activity");
  render([work("first"), followup, work("second")]);
  expect(summaries()).toEqual(["Activity", "Working for 5s"]);
  expect(vi.getTimerCount()).toBe(1);
});

it("does not animate older history or restart the previous turn's timer", () => {
  const legacy = { ...work("legacy"), turnId: undefined };
  render([legacy, followup, work("current")]);
  expect(summaries().filter((text) => text?.startsWith("Working"))).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(1);
  render([work("old")], "starting", undefined);
  expect(summaries().some((text) => text?.startsWith("Working"))).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it("renders streaming progress updates outside tool activity and keeps one timer through completion", () => {
  const progress: CodexItem = { id: "progress", kind: "agentMessage", phase: "commentary", text: "The homepage is updated. I am checking the layout.", turnId: "turn" };
  const changes: CodexItem = { id: "changes", kind: "fileChange", turnId: "turn", text: "Changed files", changes: [{ path: "website/index.html", diff: "@@ -1 +1 @@\n-old\n+new\n" }] };
  const items = [work("first"), changes, progress];
  render(items);
  expect(container.querySelectorAll(".codex-message.agentMessage")).toHaveLength(1);
  expect(container.querySelector(".codex-message.agentMessage")?.textContent).toContain(progress.text);
  expect(container.querySelector(".codex-work-content")?.textContent).not.toContain(progress.text);
  expect(container.querySelector('[aria-label="Edited files"]')).toBeNull();
  expect(summaries()).toEqual(["Activity", "Working for 5s"]);
  expect(vi.getTimerCount()).toBe(1);
  act(() => vi.advanceTimersByTime(1000));
  expect(summaries()).toEqual(["Activity", "Working for 6s"]);

  const final: CodexItem = { id: "final", kind: "agentMessage", phase: "final_answer", text: "Finished and verified.", turnId: "turn" };
  render([...items, final]);
  expect(summaries()).toEqual(["Activity", "Working for 6s"]);
  expect(vi.getTimerCount()).toBe(1);
  render([...items, final], "idle");
  expect(summaries()).toEqual(["Activity", "Worked for 6s"]);
  expect(vi.getTimerCount()).toBe(0);
  expect(container.querySelector('[aria-label="Edited files"]')?.closest("article")?.textContent).toContain(final.text);
  const children = [...container.querySelector(".codex-messages")!.children];
  const answer = children.findIndex((child) => child.textContent?.includes(final.text));
  expect(children[answer - 1].className).toBe("codex-work-activity");
});
