import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { groupTranscript, workedDuration } from "./transcript";
import { TranscriptView } from "./transcript-view";
import { type CodexItem } from "../../shared/codex";
const item = (
  id: string,
  kind: string,
  phase?: CodexItem["phase"],
  turnId = "turn",
): CodexItem => ({ id, kind, phase, turnId, text: id });
describe("Codex transcript grouping", () => {
  it("keeps user messages and final answers visible, grouping intermediate work", () => {
    const items = [
      item("prompt", "userMessage"),
      item("progress", "agentMessage", "commentary"),
      item("summary", "reasoning"),
      item("command", "commandExecution"),
      item("plan", "plan"),
      item("answer", "agentMessage", "final_answer"),
    ];
    const entries = groupTranscript(items);
    expect(entries.map((entry) => entry.type)).toEqual([
      "message",
      "activity",
      "message",
    ]);
    expect(entries[1]).toMatchObject({
      type: "activity",
      items: items.slice(1, -1),
      turnId: "turn",
    });
  });
  it("preserves steer message ordering and separates turns", () => {
    const entries = groupTranscript([
      item("work", "commandExecution"),
      item("steer", "userMessage"),
      item("more", "commandExecution"),
      item("answer", "agentMessage", "final_answer"),
      item("next", "reasoning", undefined, "next-turn"),
    ]);
    expect(entries.map((entry) => entry.type)).toEqual([
      "activity",
      "message",
      "activity",
      "message",
      "activity",
    ]);
  });
  it("keeps legacy final answers visible without hiding answers across prompts", () => {
    const items = [
      item("update", "agentMessage"),
      item("answer", "agentMessage"),
      item("prompt", "userMessage"),
      item("another answer", "agentMessage"),
    ].map(({ turnId, ...entry }) => entry);
    const entries = groupTranscript(items);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({ type: "activity", items: [items[0]] });
    expect(entries[1]).toMatchObject({ type: "message", item: items[1] });
    expect(entries[3]).toMatchObject({ type: "message", item: items[3] });
  });
  it("formats runtime durations without inventing elapsed time", () => {
    expect(workedDuration(68_000)).toBe("1m 8s");
    expect(workedDuration(999)).toBe("0s");
    expect(workedDuration(3_660_000)).toBe("1h 1m");
  });
  it("renders work collapsed by default with right/left message classes and timed disclosure", () => {
    const thread = {
      id: "t",
      repositoryId: "r",
      state: "idle" as const,
      turns: { turn: { durationMs: 68_000 } },
      items: [
        item("prompt", "userMessage"),
        item("command", "commandExecution"),
        item("answer", "agentMessage", "final_answer"),
      ],
    };
    const html = renderToStaticMarkup(
      <div className="codex-conversation">
        <TranscriptView thread={thread} onError={() => {}} />
      </div>,
    );
    expect(html).toContain("Worked for 1m 8s");
    expect(html).toContain("codex-message userMessage");
    expect(html).toContain("codex-message agentMessage");
    expect(html).toContain('aria-label="Your message"');
    expect(html).not.toContain(' open=""');
    expect(html).not.toContain("Download message");
    const legacy = renderToStaticMarkup(
      <TranscriptView
        thread={{ ...thread, turns: undefined }}
        onError={() => {}}
      />,
    );
    expect(legacy).not.toContain("Worked for");
  });
  it("includes timestamps and an edit action only on user messages", () => {
    const thread = {
      id: "t",
      repositoryId: "r",
      state: "idle" as const,
      turns: { turn: { startedAt: 100_000, completedAt: 168_000 } },
      items: [
        item("prompt", "userMessage"),
        item("answer", "agentMessage", "final_answer"),
      ],
    };
    const html = renderToStaticMarkup(
      <TranscriptView thread={thread} onError={() => {}} onEdit={() => {}} />,
    );
    expect(html).toContain('dateTime="1970-01-01T00:01:40.000Z"');
    expect(html).toContain('dateTime="1970-01-01T00:02:48.000Z"');
    expect(html.match(/aria-label="Edit message"/g)).toHaveLength(1);
    expect(html.match(/aria-label="Copy message"/g)).toHaveLength(2);
  });
  it("offers editing on only the latest user message, retaining timestamps on all messages", () => {
    const thread = {
      id: "t",
      repositoryId: "r",
      state: "idle" as const,
      items: [
        item("older", "userMessage"),
        item("answer", "agentMessage"),
        item("latest", "userMessage"),
      ],
    };
    const html = renderToStaticMarkup(
      <TranscriptView thread={thread} onError={() => {}} onEdit={() => {}} />,
    );
    expect(html.match(/aria-label="Edit message"/g)).toHaveLength(1);
    const users = html.split('aria-label="Your message"');
    expect(users[1]).not.toContain('aria-label="Edit message"');
    expect(users[2]).toContain('aria-label="Edit message"');
  });
});
