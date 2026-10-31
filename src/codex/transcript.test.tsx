import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { editedFiles, groupTranscript, recordedPatch, workedDuration } from "./transcript";
import { TranscriptView } from "./transcript-view";
import { type CodexItem } from "../../shared/codex";
import { parsePatchFiles } from "@pierre/diffs";
const item = (
  id: string,
  kind: string,
  phase?: CodexItem["phase"],
  turnId = "turn",
): CodexItem => ({ id, kind, phase, turnId, text: id });
describe("Codex transcript grouping", () => {
  it("shows the active timer before the first intermediate message arrives", () => {
    const html = renderToStaticMarkup(<TranscriptView
      thread={{ id: "t", repositoryId: "r", state: "running", turnId: "turn",
        turns: { turn: { startedAt: Date.now() - 5000 } },
        items: [item("prompt", "userMessage")] }}
      onError={() => {}}
    />);
    expect(html).toContain("Working for 5s");
  });
  it("shows a timed activity separator even when a turn contains only a final reply", () => {
    const html = renderToStaticMarkup(<TranscriptView
      thread={{ id: "t", repositoryId: "r", state: "idle", turns: { turn: { durationMs: 70_000 } },
        items: [item("prompt", "userMessage"), item("answer", "agentMessage", "final_answer")] }}
      onError={() => {}}
    />);
    expect(html).toContain("Worked for 1m 10s");
    expect(html.match(/codex-work-activity/g)).toHaveLength(1);
    expect(html.indexOf("Worked for")).toBeLessThan(html.indexOf('aria-label="Codex reply"'));
  });

  it("collects edited files by turn, combining repeated edits and excluding failed edits", () => {
    const items: CodexItem[] = [
      { ...item("edit1", "fileChange"), changes: [{ path: "src/a.ts", diff: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1,2 @@\n-old\n+new\n+line" }] },
      { ...item("edit2", "fileChange"), changes: [{ path: "src/a.ts", diff: "@@ -1 +1 @@\n-new\n+better" }, { path: "src/b.ts", diff: "@@ -0,0 +1 @@\n+hello" }] },
      { ...item("failed", "fileChange"), status: "failed", changes: [{ path: "failed.ts", diff: "+no" }] },
      { ...item("other", "fileChange", undefined, "other-turn"), changes: [{ path: "other.ts", diff: "+other" }] },
    ];
    expect(editedFiles(items, "turn")).toEqual([
      expect.objectContaining({ path: "src/a.ts", additions: 3, deletions: 2 }),
      expect.objectContaining({ path: "src/b.ts", additions: 1, deletions: 0 }),
    ]);
    expect(recordedPatch([{ path: "src/b.ts", diff: "@@ -0,0 +1 @@\n+hello" }]))
      .toBe("diff --git a/src/b.ts b/src/b.ts\n--- a/src/b.ts\n+++ b/src/b.ts\n@@ -0,0 +1 @@\n+hello");
  });
  it("builds recorded patches that the diff viewer recognizes, including filenames with spaces", () => {
    for (const path of ["src/file.ts", "src/my file.ts"]) {
      const diff = recordedPatch([{ path, diff: "@@ -1 +1 @@\n-old\n+new\n" }]);
      const files = parsePatchFiles(diff).flatMap((patch) => patch.files);
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe(path);
      expect(files[0].prevName).toBeUndefined();
    }
  });
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
