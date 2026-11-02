import { expect, it } from "vitest";
import { ChatActivity } from "../../electron/main/chatgpt/activity";
it("groups indexed summary parts, reconciles completion, and ignores raw reasoning", () => {
  const activity = new ChatActivity();
  const update = (method: string, params: Record<string, unknown>) =>
    activity.update({ method, params });
  expect(
    update("item/reasoning/textDelta", { itemId: "r", delta: "private" }),
  ).toBeUndefined();
  update("item/reasoning/summaryTextDelta", {
    itemId: "r",
    summaryIndex: 1,
    delta: "Second",
  });
  update("item/reasoning/summaryTextDelta", {
    itemId: "r",
    summaryIndex: 0,
    delta: "First",
  });
  expect(
    update("item/completed", {
      item: {
        id: "r",
        type: "reasoning",
        content: ["private"],
        summary: ["First", "Second"],
      },
    }),
  ).toEqual([{ id: "r", kind: "reasoning", text: "First\n\nSecond" }]);
  update("item/started", {
    item: {
      id: "c",
      type: "commandExecution",
      command: "cat notes.txt",
      status: "inProgress",
    },
  });
  expect(
    update("item/commandExecution/outputDelta", {
      itemId: "c",
      delta: "\nTuesday",
    })?.at(-1)?.text,
  ).toBe("cat notes.txt\nTuesday");
  expect(
    update("item/completed", {
      item: {
        id: "c",
        type: "commandExecution",
        command: "cat notes.txt",
        aggregatedOutput: "Tuesday",
        status: "completed",
      },
    })?.at(-1),
  ).toEqual({
    id: "c",
    kind: "commandExecution",
    text: "cat notes.txt\nTuesday",
    status: "completed",
  });
});
