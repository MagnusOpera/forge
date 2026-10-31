// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initializeDisplayPaths, displayPath } from "../paths";
import { CheckoutDialog } from "./checkout-dialog";
import { CodexQuickActions } from "./quick-actions";
import { CodexMarkdown } from "./markdown";
import { TranscriptView } from "./transcript-view";
import { errorMessage } from "./api";
import { defaultCodexPreferences, type CodexApi, type CodexGitInfo } from "../../shared/codex";
vi.mock("./diff-files", () => ({ default: ({ info }: { info: CodexGitInfo }) => <pre data-raw-patch>{info.diff}</pre> }));
let container: HTMLDivElement, root: Root;
const request = vi.fn(), copy = vi.fn();
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");document.body.append(container);root = createRoot(container);
  request.mockReset().mockImplementation(async (method) => method === "displayContext" ? { homeDirectory: "/Users/alice", platform: "darwin" } : undefined);
  copy.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
  window.forgeCodex = { request } as unknown as CodexApi;
  await initializeDisplayPaths();
});
afterEach(async () => {
  act(() => root.unmount());container.remove();delete window.forgeCodex;vi.unstubAllGlobals();
  await initializeDisplayPaths();
});
it("shortens checkout review paths without changing its operational data", async () => {
  const preview = { token: "review", action: "merge" as const, message: "Feature", sourceBranch: "feature", targetBranch: "main", sourcePath: "/Users/alice/worktree", targetPath: "/Users/alice/Library/Application Support/Forge", commits: 2, summary: "" };
  await act(async () => root.render(<CheckoutDialog preview={preview} onConfirm={async () => {}} onReview={async () => {}} onClose={() => {}} />));
  expect(container.textContent).toContain("From: ~/worktree");
  expect(container.textContent).toContain("Continue in: ~/Library/Application Support/Forge");
  expect(container.textContent).not.toContain("/Users/alice");
  expect(preview.targetPath).toBe("/Users/alice/Library/Application Support/Forge");
});
it("shortens checkout tooltips but copies the full usable path", async () => {
  await act(async () => root.render(<CodexQuickActions theme="light" thread={{ id: "t", repositoryId: "r", title: "Test", createdAt: "", updatedAt: "", archived: false, settings: defaultCodexPreferences, state: "idle", branch: "feature", baseCommit: "base", worktree: "/Users/alice/worktree" }} />));
  const label = container.querySelector<HTMLButtonElement>('[aria-label="Copy checkout location"]')!;
  expect(label.title).toContain("~/worktree");
  expect(label.title).not.toContain("/Users/alice");
  await act(async () => label.click());
  expect(copy).toHaveBeenCalledWith("/Users/alice/worktree");
});
it("formats human prose and file-link labels while retaining link targets and literal code", async () => {
  await act(async () => root.render(<CodexMarkdown repositoryId="r" id="t" onError={() => {}} text={'Open /Users/alice/report.pdf.\n\n[/Users/alice/report.pdf](/Users/alice/report.pdf)\n\n`/Users/alice/tool --flag`\n\n```sh\ncat /Users/alice/report.pdf\n```'} />));
  expect(container.querySelector("p")?.textContent).toBe("Open ~/report.pdf.");
  const link = container.querySelector("a")!;
  expect(link.textContent).toBe("~/report.pdf");
  expect(link.getAttribute("href")).toBe("/Users/alice/report.pdf");
  expect(container.querySelector("code")?.textContent).toBe("/Users/alice/tool --flag");
  expect(container.querySelector("pre")?.textContent).toContain("cat /Users/alice/report.pdf");
  await act(async () => link.click());
  expect(request).toHaveBeenCalledWith("outputFile", { repositoryId: "r", id: "t", href: "/Users/alice/report.pdf", action: "reveal" });
});
it("shortens local edited-file labels while keeping recorded diff paths intact", async () => {
  const thread = { id: "t", repositoryId: "r", state: "idle" as const, items: [
    { id: "edit", kind: "fileChange", turnId: "turn", text: "", changes: [{ path: "/Users/alice/src/file.ts", diff: "@@ -1 +1 @@\n-old\n+new\n" }] },
    { id: "answer", kind: "agentMessage", turnId: "turn", phase: "final_answer" as const, text: "Done" },
  ] };
  await act(async () => root.render(<TranscriptView thread={thread} onError={() => {}} />));
  const file = container.querySelector<HTMLButtonElement>(".codex-edited-file")!;
  expect(file.textContent).toContain("~/src/file.ts");
  await act(async () => file.click());
  expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("~/src/file.ts");
  expect(document.querySelector('[data-raw-patch]')?.textContent).toContain("/Users/alice/src/file.ts");
});
it("does not assume a remote machine has the local home or rewrite Windows displays", async () => {
  expect(displayPath("/Users/alice/remote", true)).toBe("/Users/alice/remote");
  await act(async () => root.render(<CodexMarkdown repositoryId="r" id="t" remote onError={() => {}} text="Remote folder /Users/alice/remote" />));
  expect(container.textContent).toContain("/Users/alice/remote");
  request.mockResolvedValue({ homeDirectory: "/Users/alice", platform: "win32" });
  await initializeDisplayPaths();
  expect(displayPath("/Users/alice/file")).toBe("/Users/alice/file");
  expect(errorMessage(new Error("Open /Users/alice/file"))).toBe("Open /Users/alice/file");
});
