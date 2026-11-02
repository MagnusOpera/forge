import type { CodexItem } from "../../../shared/codex.js";
import { object, text, type RpcEvent } from "../codex/client.js";

/** Collect display summaries and file-reading activity; never expose raw reasoning. */
export class ChatActivity {
  private items = new Map<string, CodexItem>();
  private summaries = new Map<string, Map<number, string>>();
  update(event: RpcEvent): CodexItem[] | undefined {
    const { method, params } = event;
    const item = object(params.item);
    const id = text(item.id) || text(params.itemId);
    if (!id) return;
    const previous = this.items.get(id);
    if (method === "item/reasoning/summaryTextDelta") {
      let parts = this.summaries.get(id);
      if (!parts) this.summaries.set(id, (parts = new Map()));
      const index =
        typeof params.summaryIndex === "number" ? params.summaryIndex : 0;
      parts.set(index, (parts.get(index) ?? "") + text(params.delta));
      this.items.set(id, {
        id,
        kind: "reasoning",
        text: [...parts]
          .sort(([a], [b]) => a - b)
          .map(([, value]) => value)
          .join("\n\n"),
      });
    } else if (
      (method === "item/started" || method === "item/completed") &&
      item.type === "reasoning"
    ) {
      const summary = Array.isArray(item.summary)
        ? item.summary
            .filter((part): part is string => typeof part === "string")
            .join("\n\n")
        : "";
      this.items.set(id, {
        id,
        kind: "reasoning",
        text: summary || previous?.text || "",
      });
    } else if (
      (method === "item/started" || method === "item/completed") &&
      item.type === "imageGeneration"
    ) {
      this.items.set(id, {
        id,
        kind: "imageGeneration",
        status: text(item.status),
        text:
          item.status === "completed"
            ? "Image generated."
            : item.failure || item.status === "failed"
              ? "Image generation failed."
              : "Generating an image…",
      });
    } else if (
      (method === "item/started" || method === "item/completed") &&
      item.type === "commandExecution"
    ) {
      this.items.set(id, {
        id,
        kind: "commandExecution",
        status: text(item.status),
        text: [text(item.command), text(item.aggregatedOutput)]
          .filter(Boolean)
          .join("\n")
          .slice(0, 64_000),
      });
    } else if (
      method === "item/commandExecution/outputDelta" &&
      previous?.kind === "commandExecution"
    ) {
      this.items.set(id, {
        ...previous,
        text: (previous.text + text(params.delta)).slice(0, 64_000),
      });
    } else return;
    return [...this.items.values()];
  }
}
