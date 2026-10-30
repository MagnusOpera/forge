import type { CodexThread, JsonObject } from "../../../shared/codex.js";
import { array, object, text, type RpcEvent } from "./client.js";
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
    thread.turnId = text(object(params.turn).id);
    thread.state = "running";
    return;
  }
  if (method === "turn/completed") {
    const turn = object(params.turn);
    for (const item of array(turn.items))
      reduceCodexEvent(thread, { method: "item/completed", params: { item } });
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
    else thread.items.push({ id, kind: "plan", text: content });
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
        : method === "item/plan/delta"
          ? "plan"
          : "");
  if (
    ![
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
  const next = {
    id,
    kind,
    text: content || existing?.text || "",
    status: text(item.status) || existing?.status,
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
