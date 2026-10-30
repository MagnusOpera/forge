import type { CodexThread, JsonObject } from "../../../shared/codex.js";
import { array, object, text, type RpcEvent } from "./client.js";
function recordTurn(
  thread: CodexThread,
  turn: JsonObject,
  live?: "started" | "completed",
): void {
  const id = text(turn.id);
  if (!id) return;
  const timing = (thread.turns ??= {})[id] ?? {};
  const valid = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0;
  if (valid(turn.startedAt)) timing.startedAt = turn.startedAt * 1000;
  else if (live === "started") timing.startedAt ??= Date.now();
  if (valid(turn.completedAt)) timing.completedAt = turn.completedAt * 1000;
  else if (live === "completed" && timing.startedAt !== undefined)
    timing.completedAt ??= Date.now();
  if (valid(turn.durationMs)) timing.durationMs = turn.durationMs;
  else if (timing.startedAt !== undefined && timing.completedAt !== undefined)
    timing.durationMs = Math.max(0, timing.completedAt - timing.startedAt);
  thread.turns[id] = timing;
}
export function hydrateCodexTurn(thread: CodexThread, turn: JsonObject): void {
  recordTurn(thread, turn);
  for (const item of array(turn.items))
    reduceCodexEvent(thread, {
      method: "item/completed",
      params: { item, turnId: turn.id, historical: true },
    });
}
export function reduceCodexEvent(thread: CodexThread, event: RpcEvent): void {
  const { method, params, requestId } = event;
  if (requestId !== undefined) {
    if (!thread.requests.some((r) => r.id === requestId))
      thread.requests.push({
        id: requestId,
        method,
        params,
        ...(method === "item/tool/requestUserInput"
          ? {
              questions: array(params.questions)
                .map(object)
                .map((q) => ({
                  id: text(q.id),
                  header: text(q.header),
                  question: text(q.question),
                  secret: q.isSecret === true,
                  options: array(q.options)
                    .map(object)
                    .map((o) => ({
                      label: text(o.label),
                      description: text(o.description),
                    })),
                })),
            }
          : {}),
      });
    thread.state = "waiting";
    return;
  }
  if (method === "serverRequest/resolved") {
    thread.requests = thread.requests.filter((r) => r.id !== params.requestId);
    if (!thread.requests.length && thread.state === "waiting")
      thread.state = "running";
    return;
  }
  if (method === "turn/started") {
    recordTurn(thread, object(params.turn), "started");
    thread.turnId = text(object(params.turn).id);
    thread.state = "running";
    return;
  }
  if (method === "turn/completed") {
    const turn = object(params.turn);
    recordTurn(thread, turn, "completed");
    hydrateCodexTurn(thread, turn);
    thread.state =
      turn.status === "completed"
        ? "idle"
        : turn.status === "interrupted"
          ? "interrupted"
          : "failed";
    thread.error =
      thread.state === "failed"
        ? text(object(turn.error).message) || "Codex turn failed."
        : undefined;
    thread.turnId = undefined;
    thread.requests = [];
    if (thread.state !== "idle") thread.queuePaused = true;
    return;
  }
  if (method === "turn/plan/updated") {
    const id = `plan:${text(params.turnId) || thread.turnId || "current"}`;
    const content = [
      text(params.explanation),
      ...array(params.plan)
        .map(object)
        .map(
          (step) =>
            `${step.status === "completed" ? "- [x]" : "- [ ]"} ${text(step.step)}${["inProgress", "in_progress"].includes(text(step.status)) ? " (in progress)" : ""}`,
        ),
    ]
      .filter(Boolean)
      .join("\n");
    const existing = thread.items.find((item) => item.id === id);
    if (existing) existing.text = content;
    else
      thread.items.push({
        id,
        kind: "plan",
        text: content,
        turnId: text(params.turnId) || thread.turnId,
      });
    return;
  }
  const item = object(params.item),
    id = text(item.id) || text(params.itemId);
  if (!id) return;
  const existing = thread.items.find((i) => i.id === id);
  const kind =
    text(item.type) ||
    existing?.kind ||
    (method === "item/agentMessage/delta"
      ? "agentMessage"
      : method === "item/commandExecution/outputDelta"
        ? "commandExecution"
        : method === "item/reasoning/summaryTextDelta"
          ? "reasoning"
          : method === "item/plan/delta"
            ? "plan"
            : "");
  if (
    ![
      "reasoning",
      "agentMessage",
      "userMessage",
      "plan",
      "commandExecution",
      "fileChange",
      "mcpToolCall",
      "dynamicToolCall",
      "webSearch",
    ].includes(kind)
  )
    return;
  let content = text(item.text);
  if (kind === "reasoning") {
    // Only expose the summaries provided for display, never raw reasoning content.
    if (
      typeof params.delta === "string" &&
      method !== "item/reasoning/summaryTextDelta"
    )
      return;
    content = array(item.summary)
      .filter((part): part is string => typeof part === "string")
      .join("\n\n");
    if (!content && typeof params.delta !== "string" && !existing) return;
  }
  if (kind === "userMessage")
    content = array(item.content)
      .map(object)
      .map(
        (part) =>
          text(part.text) ||
          (part.type === "localImage" ? "[Image attachment]" : ""),
      )
      .join("\n");
  if (kind === "commandExecution")
    content = [text(item.command), text(item.aggregatedOutput)]
      .filter(Boolean)
      .join("\n");
  if (kind === "commandExecution" && method === "item/started" && content)
    content += "\n";
  if (
    kind === "commandExecution" &&
    method === "item/completed" &&
    existing &&
    existing.text.length > content.length
  )
    content = existing.text;
  if (kind === "fileChange")
    content = array(item.changes)
      .map(object)
      .map((c) => `${text(c.path)}\n${text(c.diff)}`)
      .join("\n\n");
  if (["mcpToolCall", "dynamicToolCall", "webSearch"].includes(kind))
    content = JSON.stringify(item, null, 2);
  if (typeof params.delta === "string")
    content = (existing?.text ?? "") + params.delta;
  const next: import("../../../shared/codex.js").CodexItem = {
    id,
    kind,
    text: content || existing?.text || "",
    status: text(item.status) || existing?.status,
    turnId: text(params.turnId) || existing?.turnId || thread.turnId,
    createdAt:
      existing?.createdAt ??
      (params.historical === true ? undefined : Date.now()),
    phase:
      item.phase === "commentary" || item.phase === "final_answer"
        ? item.phase
        : existing?.phase,
  };
  if (existing) Object.assign(existing, next);
  else thread.items.push(next);
}
export function turnPolicy(
  settings: CodexThread["settings"],
  cwd: string,
): JsonObject {
  const readOnly = settings.mode === "plan";
  return {
    approvalPolicy:
      readOnly ||
      settings.permissions === "strict" ||
      settings.permissions === "full"
        ? "never"
        : "on-request",
    sandboxPolicy: readOnly
      ? { type: "readOnly" }
      : settings.permissions === "full"
        ? { type: "dangerFullAccess" }
        : {
            type: "workspaceWrite",
            writableRoots: [cwd],
            networkAccess: false,
            excludeTmpdirEnvVar: true,
            excludeSlashTmp: true,
          },
  };
}
