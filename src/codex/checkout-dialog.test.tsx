// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CheckoutDialog } from "./checkout-dialog";
import type { CodexCheckoutPreview } from "../../shared/codex";
let container: HTMLDivElement, root: Root;
const confirm = vi.fn(), review = vi.fn(), close = vi.fn();
const preview: CodexCheckoutPreview = { token: "review", message: "feat: add widget", action: "merge", sourceBranch: "codex/widget", sourcePath: "/repo/worktree", targetBranch: "main", targetPath: "/repo", commits: 3, summary: "abc Add widget\ndef Test widget" };
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");document.body.append(container);root = createRoot(container);
  confirm.mockReset().mockResolvedValue(undefined);review.mockReset().mockResolvedValue(undefined);close.mockReset();
});
afterEach(() => { act(() => root.unmount());container.remove(); });
const render = async (value = preview) => act(async () => root.render(<CheckoutDialog preview={value} onConfirm={confirm} onReview={review} onClose={close} />));
const button = (text: string) => [...container.querySelectorAll("button")].find(node => node.textContent === text)!;
it("defaults to squash, focuses Cancel and submits a single-commit choice only after confirmation", async () => {
  await render();
  expect(container.querySelector<HTMLInputElement>('[value="squash"]')?.checked).toBe(true);
  expect(document.activeElement?.textContent).toBe("Cancel");
  expect(container.textContent).toContain("3 source commits → one commit on main");
  expect(container.querySelector<HTMLInputElement>('[aria-label="Squash commit message"]')?.value).toBe(preview.message);
  expect(confirm).not.toHaveBeenCalled();
  await act(async () => button("Squash and continue").click());
  expect(confirm).toHaveBeenCalledWith({ method: "squash", message: preview.message });
});
it("offers a normal merge and supports cancellation without submitting", async () => {
  await render();
  act(() => container.querySelector<HTMLInputElement>('[value="merge"]')!.click());
  expect(container.textContent).toContain("preserve commit history");
  expect(container.querySelector('[aria-label="Squash commit message"]')).toBeNull();
  await act(async () => button("Merge and continue").click());
  expect(confirm).toHaveBeenCalledWith({ method: "merge", message: preview.message });
  confirm.mockClear();
  act(() => button("Cancel").click());
  expect(close).toHaveBeenCalledOnce();
  expect(confirm).not.toHaveBeenCalled();
});
it("requires a refreshed review after a rejected integration", async () => {
  confirm.mockRejectedValueOnce(new Error("The repository changed. Review again."));
  await render();
  await act(async () => button("Squash and continue").click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("repository changed");
  expect(button("Squash and continue").disabled).toBe(true);
  await act(async () => button("Review again").click());
  expect(review).toHaveBeenCalledOnce();
  await render({ ...preview, token: "fresh-review" });
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(button("Squash and continue").disabled).toBe(false);
});
it("shows an HTML review for starting a worktree and lets Escape cancel it", async () => {
  await render({ ...preview, action: "worktree" });
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  expect(container.querySelector('[name="merge-method"]')).toBeNull();
  expect(button("Start worktree")).not.toBeUndefined();
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(close).toHaveBeenCalledOnce();expect(confirm).not.toHaveBeenCalled();
});
