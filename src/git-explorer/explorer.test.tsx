// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CodexApi, CodexGitInfo } from "../../shared/codex";
import type { GitPreview, GitSnapshot } from "../../shared/git-explorer";
import type { RepoSummary } from "../../shared/github";
import { BranchPicker } from "./branch-picker";
import { GitExplorer } from "./explorer";

vi.mock("../codex/diff-files", () => ({
  default: ({ info, split }: { info: CodexGitInfo; split: boolean }) =>
    <div aria-label={split ? "Rendered split diff" : "Rendered unified diff"}>{info.diff}</div>,
}));

let container: HTMLElement, tree: HTMLElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.body.appendChild(document.createElement("div"));
  tree = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  tree.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const key = (target: EventTarget, name: string) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));

it("debounces branch search and switches with the keyboard", async () => {
  vi.useFakeTimers();
  const onSwitch = vi.fn();
  await act(async () => root.render(<BranchPicker branch="main" blocker={null} onSwitch={onSwitch} branches={[
    { ref: "refs/remotes/origin/topic/one", label: "topic/one", remote: "origin" },
    { ref: "refs/heads/main", label: "main" },
    { ref: "refs/remotes/origin/topic/two", label: "topic/two", remote: "origin" },
    { ref: "refs/heads/blocked-topic", label: "blocked-topic", blocker: "Checked out in another worktree." },
  ]} />));
  const trigger = container.querySelector("button")!;
  await act(async () => { trigger.focus(); key(trigger, "ArrowDown"); });
  const search = container.querySelector("input")!;
  expect(document.activeElement).toBe(search);
  expect(search.closest(".search-box")?.querySelector("svg")).not.toBeNull();
  const remoteOption = container.querySelector('[role="option"][aria-selected="true"]')!;
  expect(remoteOption.querySelector(".git-branch-option-icons svg")).not.toBeNull();
  expect(remoteOption.getAttribute("aria-description")).toBe("Remote branch");
  expect(remoteOption.textContent).toBe("topic/one");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "topic");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => key(search, "Enter"));
  await act(async () => vi.advanceTimersByTime(199));
  expect(onSwitch).not.toHaveBeenCalled();
  expect(container.querySelectorAll('[role="option"]')).toHaveLength(4);
  await act(async () => vi.advanceTimersByTime(1));
  expect(container.querySelectorAll('[role="option"]')).toHaveLength(3);
  await act(async () => key(search, "ArrowDown"));
  await act(async () => key(search, "Enter"));
  expect(onSwitch).toHaveBeenCalledExactlyOnceWith("refs/remotes/origin/topic/two");
  expect(container.querySelector("input")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

const repo = (id: string) => ({ id, url: `https://github.com/octo/${id}` }) as RepoSummary;
const snapshot = (id: string): GitSnapshot => ({
  kind: "ready", checkout: `/tmp/${id}`, revision: id, branch: "main", pushDestination: "origin/main",
  blockers: { fetch: null, pull: null, push: null, switch: null },
  branches: [{ ref: "refs/heads/main", label: "main" }],
  files: [{ path: "src/main.txt", status: "conflict" }, { path: "other.txt", status: "changed" }],
});

it("keeps file previews and branch state scoped to the project and refreshes after an action error", async () => {
  const oldPreview = Promise.withResolvers<GitPreview>();
  const gitError = [
    "The following untracked working tree files would be overwritten by merge:",
    "\tsrc/main.txt",
    "\tother.txt",
  ].join("\n");
  const publishedCommit = "a".repeat(40);
  const request = vi.fn((method, { repositoryId }) => {
    if (method === "gitSnapshot") {
      const checkout = snapshot(repositoryId);
      if (checkout.kind === "ready" && repositoryId === "old")
        checkout.blockers.pull = "Finish the pending Git operation first.";
      return Promise.resolve(checkout);
    }
    if (method === "gitPreview") return repositoryId === "old" ? oldPreview.promise :
      Promise.resolve({ kind: "text", text: "<b>new checkout</b>", publishedCommit });
    if (method === "gitAction") return Promise.reject(new Error(`error: ${gitError}\nAborting`));
    throw new Error("Unexpected request");
  });
  vi.stubGlobal("forgeCodex", { request, onChanged: () => () => {} } as unknown as CodexApi);
  const onFileGithubUrlChange = vi.fn();
  const render = (id: string, refreshSequence = 0) => root.render(
    <GitExplorer key={id} repo={repo(id)} treeHost={tree} theme="light" refreshSequence={refreshSequence}
      onConfigure={vi.fn()} onFileGithubUrlChange={onFileGithubUrlChange} />,
  );
  const select = async () => {
    const dir = tree.querySelector<HTMLButtonElement>('[role="treeitem"][aria-expanded="false"]')!;
    await act(async () => { dir.focus(); key(dir, "ArrowRight"); });
    await act(async () => key(dir, "ArrowRight"));
    expect(document.activeElement?.textContent).toBe("main.txt");
    await act(async () => (document.activeElement as HTMLButtonElement).click());
    expect(tree.querySelector('[aria-selected="true"] [aria-label="Conflict"]')).not.toBeNull();
    expect(tree.querySelector('[aria-label="Local changes"]')).not.toBeNull();
  };
  await act(async () => render("old"));
  expect(tree.firstElementChild?.querySelector('[aria-label="Branch: main"]')).not.toBeNull();
  expect(tree.firstElementChild?.nextElementSibling?.getAttribute("role")).toBe("tree");
  const actions = [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Git actions"] button')];
  expect(actions.map((button) => button.getAttribute("aria-label"))).toEqual(["Pull"]);
  expect(actions[0].disabled).toBe(true);
  expect(actions[0].getAttribute("aria-description")).toBe("Finish the pending Git operation first.");
  await select();
  expect(container.textContent).toContain("Reading file…");
  await act(async () => render("new"));
  await select();
  expect(container.querySelector("pre")?.textContent).toBe("<b>new checkout</b>");
  expect(container.querySelector("pre b")).toBeNull();
  await act(async () => oldPreview.resolve({ kind: "text", text: "stale old project" }));
  expect(container.textContent).not.toContain("stale old project");
  expect(container.querySelector('[aria-label="Open in GitHub"]')).toBeNull();
  expect(onFileGithubUrlChange).toHaveBeenLastCalledWith(`${repo("new").url}/blob/${publishedCommit}/src/main.txt`);

  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Pull"]')!.click());
  const dialog = container.querySelector('[role="alertdialog"]')!;
  expect(dialog.querySelector("header h2")?.textContent).toBe("Pull failed");
  expect(dialog.querySelector("pre")?.textContent).toBe(gitError);
  expect(container.querySelector(".git-explorer-message")).toBeNull();
  expect(dialog.querySelector('header [aria-label="Close Git error"]')).not.toBeNull();
  const close = dialog.querySelector<HTMLButtonElement>("footer button")!;
  expect(close.textContent).toBe("Close");
  await act(async () => close.click());
  expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  expect(request.mock.calls.filter(([method, input]) => method === "gitSnapshot" && input.repositoryId === "new"))
    .toHaveLength(2);
  expect(tree.querySelector('[aria-selected="true"]')?.textContent).toBe("main.txt");
  expect(container.querySelector("pre")?.textContent).toBe("<b>new checkout</b>");
});

it("opens the shared diff dialog for a changed file and keeps single click as a file preview", async () => {
  const current = snapshot("repo");
  if (current.kind !== "ready") throw new Error("Expected a checkout.");
  current.files.push({ path: "clean.txt", status: "clean" });
  const request = vi.fn((method) => {
    if (method === "gitSnapshot") return Promise.resolve(current);
    if (method === "gitPreview") return Promise.resolve({ kind: "text", text: "working copy" });
    if (method === "gitFileDiff") return Promise.resolve({ status: "", diff: "selected patch", untracked: [] });
    throw new Error("Unexpected request");
  });
  vi.stubGlobal("forgeCodex", { request, onChanged: () => () => {} } as unknown as CodexApi);
  await act(async () => root.render(<GitExplorer repo={repo("repo")} treeHost={tree} theme="dark"
    refreshSequence={0} onConfigure={() => {}} onFileGithubUrlChange={() => {}} />));

  const clean = tree.querySelector<HTMLButtonElement>('[title="clean.txt"]')!;
  const changed = tree.querySelector<HTMLButtonElement>('[title="other.txt"]')!;
  const doubleClick = (row: HTMLButtonElement) => row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await act(async () => { changed.focus(); changed.click(); doubleClick(clean); });
  expect(container.querySelector("pre")?.textContent).toBe("working copy");
  expect(document.querySelector('[role="dialog"]')).toBeNull();

  await act(async () => doubleClick(changed));
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.querySelector("h2")?.textContent).toBe("other.txt");
  expect(request).toHaveBeenCalledWith("gitFileDiff", { repositoryId: "repo", revision: "repo", path: "other.txt", worktree: "/tmp/repo" });
  expect(dialog.querySelector('[aria-label="Rendered unified diff"]')?.textContent).toBe("selected patch");
  await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="Split diff"]')!.click());
  expect(dialog.querySelector('[aria-label="Rendered split diff"]')?.textContent).toBe("selected patch");
  await act(async () => key(document, "Escape"));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(changed);

  await act(async () => changed.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true })));
  expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("other.txt");
});

it("opens a linked worktree from the branch picker even when local edits block switching", async () => {
  const current = snapshot("repo");
  const linked = snapshot("linked");
  if (current.kind !== "ready" || linked.kind !== "ready") throw new Error("Expected two checkouts.");
  current.blockers.switch = "Commit or remove tracked changes first.";
  current.branches.push(
    { ref: "refs/heads/topic", label: "topic", worktree: linked.checkout, linkedWorktree: true },
    { ref: "refs/heads/spare", label: "spare" },
  );
  linked.branch = "topic";
  linked.files = [{ path: "linked.txt", status: "clean" }];
  const request = vi.fn((method, { worktree }) => {
    if (method === "gitSnapshot") return Promise.resolve(worktree === linked.checkout ? linked : current);
    if (method === "gitAction") return Promise.resolve({ checkout: linked.checkout, message: "Opened worktree for topic." });
    if (method === "gitPreview") return Promise.resolve({ kind: "text", text: "from the linked worktree" });
    throw new Error("Unexpected request");
  });
  vi.stubGlobal("forgeCodex", { request, onChanged: () => () => {} } as unknown as CodexApi);
  await act(async () => root.render(<GitExplorer repo={repo("repo")} treeHost={tree} theme="light"
    refreshSequence={0} onConfigure={() => {}} onFileGithubUrlChange={() => {}} />));

  await act(async () => tree.querySelector<HTMLButtonElement>('[aria-label="Branch: main"]')!.click());
  const topic = tree.querySelector<HTMLElement>('[aria-description="Linked worktree"]')!;
  expect(topic.querySelector(".git-branch-option-icons svg")).not.toBeNull();
  expect(topic.getAttribute("aria-disabled")).toBe("false");
  const spare = [...tree.querySelectorAll('[role="option"]')].find((entry) => entry.textContent === "spare");
  expect(spare?.getAttribute("aria-disabled")).toBe("true");
  expect(spare?.getAttribute("aria-description")).toBe("Commit or remove tracked changes first.");
  expect(tree.querySelector(".git-branch-hint")).toBeNull();
  await act(async () => topic.click());

  expect(tree.querySelector('[aria-label="Branch: topic"]')).not.toBeNull();
  await act(async () => tree.querySelector<HTMLButtonElement>('[title="linked.txt"]')!.click());
  expect(request).toHaveBeenCalledWith("gitPreview", expect.objectContaining({ path: "linked.txt", worktree: linked.checkout }));
  expect(container.querySelector(".git-file-preview")?.textContent).toBe("from the linked worktree");
});
