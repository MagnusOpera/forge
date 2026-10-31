// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TranscriptView } from "./transcript-view";
import type { CodexApi, CodexItem, CodexMessageAttachment } from "../../shared/codex";

let container: HTMLDivElement, root: Root;
const request = vi.fn(), onError = vi.fn();
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  request.mockReset().mockResolvedValue(null);
  onError.mockReset();
  window.forgeCodex = { request } as unknown as CodexApi;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.forgeCodex;
});

const render = async (attachments: CodexMessageAttachment[], legacy?: Partial<CodexItem>) => {
  await act(async () => root.render(
    <TranscriptView
      thread={{
        id: "thread", repositoryId: "repo", state: "idle",
        items: [{ id: "files", kind: "userMessage", text: "These are my files.", attachments, ...legacy }],
      }}
      onError={onError}
    />,
  ));
};

it("renders PDFs, spreadsheets and images as filename chips without loading previews", async () => {
  await render([
    { name: "sample.pdf", href: "file:///attachments/sample.pdf", kind: "document" },
    { name: "PER.xlsx", href: "file:///attachments/PER.xlsx", kind: "document" },
    { name: "dog.png", href: "file:///attachments/dog.png", kind: "image" },
  ]);
  expect(container.querySelectorAll(".codex-message-attachment")).toHaveLength(3);
  expect(container.querySelector(".lucide-file-text")).not.toBeNull();
  expect(container.querySelector(".lucide-file-spreadsheet")).not.toBeNull();
  expect(container.querySelector(".lucide-image")).not.toBeNull();
  expect(container.textContent).toContain("sample.pdf");
  expect(container.textContent).toContain("PER.xlsx");
  expect(container.textContent).toContain("dog.png");
  expect(container.querySelector("img")).toBeNull();
  expect(request).not.toHaveBeenCalled();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Open PER.xlsx"]')!.click());
  expect(request).toHaveBeenCalledWith("outputFile", {
    repositoryId: "repo", id: "thread", href: "file:///attachments/PER.xlsx", action: "open",
  });
});

it("reports native open failures without losing the attachment", async () => {
  request.mockRejectedValue(new Error("File is missing"));
  await render([{ name: "dog.png", href: "file:///attachments/dog.png", kind: "image" }]);
  await act(async () => container.querySelector<HTMLButtonElement>(".codex-message-attachment")!.click());
  expect(onError).toHaveBeenCalledWith("File is missing");
  expect(container.textContent).toContain("dog.png");
});

it("keeps legacy cached images available as filename chips", async () => {
  await render([], { attachments: undefined, images: ["file:///attachments/my%20dog.png"] });
  expect(container.textContent).toContain("my dog.png");
  expect(container.querySelector("img")).toBeNull();
});

it("renders text-only messages without an attachment group", async () => {
  await render([]);
  expect(request).not.toHaveBeenCalled();
  expect(container.querySelector('[aria-label="Attachments"]')).toBeNull();
});
