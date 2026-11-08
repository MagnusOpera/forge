// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CodexApi, CodexGitInfo } from "../../shared/codex";
import type { GitFileHistory, GitHistoricalTree, GitPreview, GitSnapshot } from "../../shared/git-explorer";
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
  const oldHistory = Promise.withResolvers<GitFileHistory>();
  const gitError = [
    "The following untracked working tree files would be overwritten by merge:",
    "\tsrc/main.txt",
    "\tother.txt",
  ].join("\n");
  const publishedCommit = "a".repeat(40);
  const request = vi.fn((method, { repositoryId }) => {
    if (method === "gitRepositoryHistory") return Promise.resolve({ commits: [], hasOlder: false });
    if (method === "gitSnapshot") {
      const checkout = snapshot(repositoryId);
      if (checkout.kind === "ready" && repositoryId === "old")
        checkout.blockers.pull = "Finish the pending Git operation first.";
      return Promise.resolve(checkout);
    }
    if (method === "gitPreview") return repositoryId === "old" ? oldPreview.promise :
      Promise.resolve({ kind: "text", text: "<b>new checkout</b>", publishedCommit });
    if (method === "gitFileHistory") return repositoryId === "old" ? oldHistory.promise :
      Promise.resolve({ commits: [], hasOlder: false });
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
  expect(tree.querySelector('aside[aria-label="Repository history"]')?.nextElementSibling?.querySelector('[role="tree"]')).not.toBeNull();
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
  await act(async () => {
    oldPreview.resolve({ kind: "text", text: "stale old project" });
    oldHistory.resolve({ commits: [{ commit: publishedCommit, date: "2026-11-03T12:00:00Z", subject: "stale file commit", path: "src/main.txt" }], hasOlder: false });
  });
  expect(container.textContent).not.toContain("stale old project");
  expect(container.textContent).not.toContain("stale file commit");
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

it("shows Pull progress in the toolbar and refreshes without a status row", async () => {
  const pending = Promise.withResolvers<{ checkout: string; message: string }>();
  const request = vi.fn((method) => {
    if (method === "gitSnapshot") return Promise.resolve(snapshot("repo"));
    if (method === "gitRepositoryHistory") return Promise.resolve({ commits: [], hasOlder: false });
    if (method === "gitAction") return pending.promise;
    throw new Error("Unexpected request");
  });
  vi.stubGlobal("forgeCodex", { request, onChanged: () => () => {} } as unknown as CodexApi);
  await act(async () => root.render(<GitExplorer repo={repo("repo")} treeHost={tree} theme="light"
    refreshSequence={0} onConfigure={() => {}} onFileGithubUrlChange={() => {}} />));

  const pull = container.querySelector<HTMLButtonElement>('[aria-label="Pull"]')!;
  await act(async () => pull.click());
  expect(pull.querySelector(".spin")).not.toBeNull();
  expect(container.querySelector(".git-explorer-message")).toBeNull();
  await act(async () => pending.resolve({ checkout: "/tmp/repo", message: "Pulled origin/main into main." }));
  expect(pull.querySelector(".spin")).toBeNull();
  expect(pull.disabled).toBe(false);
  expect(container.querySelector(".git-explorer-message")).toBeNull();
  expect(request.mock.calls.filter(([method]) => method === "gitSnapshot")).toHaveLength(2);
});

it("opens the shared diff dialog for a changed file and keeps single click as a file preview", async () => {
  const current = snapshot("repo");
  if (current.kind !== "ready") throw new Error("Expected a checkout.");
  current.files.push({ path: "clean.txt", status: "clean" });
  const request = vi.fn((method) => {
    if (method === "gitRepositoryHistory" || method === "gitFileHistory") return Promise.resolve({ commits: [], hasOlder: false });
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

it("filters both rails and keeps each query until its branch or file changes", async () => {
  vi.useFakeTimers();
  const checkout = snapshot("repo");
  if (checkout.kind !== "ready") throw new Error("Expected a ready checkout");
  const recent = { commit: "a".repeat(40), subject: "Recent change", date: "2026-11-03T12:00:00Z" };
  const older = { commit: "b".repeat(40), subject: "Older change", date: "2026-11-02T12:00:00Z" };
  const late = Promise.withResolvers<GitFileHistory>();
  const request = vi.fn((method, input) => {
    if (method === "gitSnapshot") return Promise.resolve({ ...checkout });
    if (method === "gitPreview" || method === "gitHistoricalPreview") return Promise.resolve({ kind: "text", text: "file contents" });
    if (method === "gitHistoricalTree") return Promise.resolve({ files: checkout.files });
    if (method === "gitRepositoryHistory" || method === "gitFileHistory") {
      if (input.query === "slow") return late.promise;
      const matches = input.query ? [older] : [recent];
      return Promise.resolve({ commits: matches.map((commit) => ({ ...commit, path: input.path })), hasOlder: !input.query });
    }
    throw new Error("Unexpected request");
  });
  vi.stubGlobal("forgeCodex", { request, onChanged: () => () => {} } as unknown as CodexApi);
  const render = (refreshSequence: number) => root.render(<GitExplorer repo={repo("repo")} treeHost={tree}
    theme="light" refreshSequence={refreshSequence} onConfigure={() => {}} onFileGithubUrlChange={() => {}} />);
  const repositoryRail = () => tree.querySelector('aside[aria-label="Repository history"]')!;
  const fileRail = () => container.querySelector('aside[aria-label="File history"]')!;
  const input = (rail: Element) => rail.querySelector("input")!;
  const filterIndicator = (rail: Element) => rail.querySelector('.git-history-filter-indicator[role="img"]');
  const type = async (field: HTMLInputElement, value: string) => {
    await act(async () => {
      field.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => vi.advanceTimersByTime(200));
  };

  await act(async () => render(0));
  await act(async () => tree.querySelector<HTMLButtonElement>('[title="other.txt"]')!.click());
  expect(filterIndicator(repositoryRail())?.getAttribute("aria-label")).toBe("No commit filter");
  expect(filterIndicator(fileRail())?.querySelector(".lucide-search")).toBeInstanceOf(SVGElement);
  await type(input(repositoryRail()), "slow");
  await type(input(repositoryRail()), "Older");
  expect(repositoryRail().querySelector(".search-box svg")).not.toBeNull();
  expect(repositoryRail().textContent).toContain(older.subject);
  await act(async () => late.resolve({ commits: [{ ...recent, path: "other.txt" }], hasOlder: false }));
  expect(repositoryRail().textContent).not.toContain(recent.subject);
  expect(document.activeElement).toBe(input(repositoryRail()));
  await act(async () => container.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
  expect(document.activeElement).not.toBe(input(repositoryRail()));
  expect(input(repositoryRail()).value).toBe("Older");
  expect(filterIndicator(repositoryRail())?.getAttribute("aria-label")).toBe("Commit filter active");
  expect(filterIndicator(repositoryRail())?.querySelector(".lucide-funnel")).toBeInstanceOf(SVGElement);

  await type(input(fileRail()), "bbbbbbbb");
  expect(filterIndicator(fileRail())?.getAttribute("aria-label")).toBe("Commit filter active");
  expect(fileRail().textContent).toContain(older.subject);
  expect(fileRail().textContent).not.toContain(recent.subject);
  await act(async () => repositoryRail().querySelector<HTMLButtonElement>('button[title="Older change"]')!.click());
  await act(async () => vi.advanceTimersByTime(200));
  expect(input(fileRail()).value).toBe("bbbbbbbb");
  expect(request).toHaveBeenCalledWith("gitFileHistory", expect.objectContaining({
    path: "other.txt", query: "bbbbbbbb", commit: older.commit,
  }));
  await act(async () => fileRail().querySelector<HTMLButtonElement>('button[aria-label="Clear search"]')!.click());
  expect(input(fileRail()).value).toBe("");
  expect(filterIndicator(fileRail())?.getAttribute("aria-label")).toBe("No commit filter");
  expect(document.activeElement).toBe(input(fileRail()));
  expect(fileRail().textContent).toContain(recent.subject);

  await type(input(fileRail()), "Older");
  checkout.revision = "new-head";
  await act(async () => render(1));
  expect(input(repositoryRail()).value).toBe("Older");
  expect(input(fileRail()).value).toBe("Older");
  await act(async () => tree.querySelector<HTMLButtonElement>('[title="src/"]')!.click());
  await act(async () => tree.querySelector<HTMLButtonElement>('[title="src/main.txt"]')!.click());
  expect(input(fileRail()).value).toBe("");
  expect(input(repositoryRail()).value).toBe("Older");
  await type(input(fileRail()), "Older");
  checkout.branch = "another-branch";
  checkout.revision = "another-head";
  await act(async () => render(2));
  expect(input(repositoryRail()).value).toBe("");
  expect(input(fileRail()).value).toBe("");
});

it("browses file versions, ignores a late preview, and returns to the working tree", async () => {
  const slowPreview = Promise.withResolvers<GitPreview>();
  const commits: GitFileHistory["commits"] = [
    { commit: "a".repeat(40), path: "other.txt", subject: "Improve preview", date: "2026-11-03T12:00:00Z" },
    { commit: "b".repeat(40), path: "old name.txt", subject: "Add preview", date: "2026-11-02T12:00:00Z" },
  ];
  const request = vi.fn((method, input) => {
    if (method === "gitSnapshot") return Promise.resolve(snapshot("repo"));
    if (method === "gitPreview") return Promise.resolve({ kind: "text", text: "local edit" });
    if (method === "gitRepositoryHistory") return Promise.resolve({ commits: [], hasOlder: false });
    if (method === "gitFileHistory") return Promise.resolve({ commits, hasOlder: false });
    if (method === "gitHistoricalPreview") return input.commit === commits[0].commit ? slowPreview.promise :
      Promise.resolve({ kind: "text", text: "older version", publishedCommit: commits[1].commit });
    throw new Error("Unexpected request");
  });
  vi.stubGlobal("forgeCodex", { request, onChanged: () => () => {} } as unknown as CodexApi);
  const onFileGithubUrlChange = vi.fn();
  await act(async () => root.render(<GitExplorer repo={repo("repo")} treeHost={tree} theme="light"
    refreshSequence={0} onConfigure={() => {}} onFileGithubUrlChange={onFileGithubUrlChange} />));
  expect(request).not.toHaveBeenCalledWith("gitFileHistory", expect.anything());
  await act(async () => tree.querySelector<HTMLButtonElement>('[title="other.txt"]')!.click());

  const history = container.querySelector('[aria-label="File history"]')!;
  expect(history.parentElement?.previousElementSibling?.matches(".git-checkout-status")).toBe(true);
  expect(history.previousElementSibling?.firstElementChild?.matches(".git-file-preview")).toBe(true);
  expect(history.previousElementSibling?.querySelector("pre")?.textContent).toBe("local edit");
  const firstEntry = history.querySelector(".git-history-entry");
  expect(firstEntry?.textContent).toBe("Working tree");
  expect(history.textContent).not.toContain("File history");
  expect(request).toHaveBeenCalledWith("gitFileHistory", expect.objectContaining({ path: "other.txt" }));
  const [working, newer, older] = history.querySelectorAll<HTMLButtonElement>(".git-history-entry");
  expect(working.getAttribute("aria-pressed")).toBe("true");
  expect(older.textContent).toContain("Add preview");
  await act(async () => newer.click());
  expect(container.textContent).toContain("Reading version…");
  await act(async () => older.click());
  expect(request).toHaveBeenCalledWith("gitHistoricalPreview", expect.objectContaining({ path: "old name.txt", commit: commits[1].commit }));
  expect(container.querySelector("pre")?.textContent).toBe("older version");
  expect(container.querySelector("time")?.dateTime).toBe(commits[1].date);
  expect(history.parentElement?.previousElementSibling).toBe(container.querySelector(".git-file-version-bar"));
  expect(history.previousElementSibling?.firstElementChild?.matches(".git-file-preview")).toBe(true);
  expect(onFileGithubUrlChange).toHaveBeenLastCalledWith(`${repo("repo").url}/blob/${commits[1].commit}/old%20name.txt`);

  await act(async () => slowPreview.resolve({ kind: "text", text: "stale version" }));
  expect(container.querySelector("pre")?.textContent).toBe("older version");
  await act(async () => working.click());
  expect(container.querySelector("pre")?.textContent).toBe("local edit");
  expect(container.querySelector("time")).toBeNull();
  expect(onFileGithubUrlChange).toHaveBeenLastCalledWith(null);
});

it("browses repository trees and keeps the file timeline scoped to the selected file", async () => {
  const slowTree = Promise.withResolvers<GitHistoricalTree>();
  const newer = { commit: "a".repeat(40), subject: "Edit unrelated file", date: "2026-11-03T12:00:00Z" };
  const older = { commit: "b".repeat(40), subject: "Initialize layout", date: "2026-11-02T12:00:00Z" };
  const fileChange = { commit: "c".repeat(40), subject: "Add the file", date: "2026-11-01T12:00:00Z" };
  const request = vi.fn((method, input) => {
    if (method === "gitSnapshot") return Promise.resolve(snapshot("repo"));
    if (method === "gitPreview") return Promise.resolve({ kind: "text", text: "local edit" });
    if (method === "gitRepositoryHistory") return Promise.resolve({ commits: [newer, older], hasOlder: false });
    if (method === "gitHistoricalTree") return input.commit === newer.commit ? slowTree.promise :
      Promise.resolve({ files: [{ path: "old-only.txt", status: "clean" }], publishedCommit: older.commit });
    if (method === "gitHistoricalPreview") return Promise.resolve({ kind: "text",
      text: input.commit === older.commit ? "committed file" : "original file", publishedCommit: input.commit });
    if (method === "gitFileHistory") return Promise.resolve({ commits: [{ ...fileChange, path: input.path }], hasOlder: false });
    throw new Error("Unexpected request");
  });
  vi.stubGlobal("forgeCodex", { request, onChanged: () => () => {} } as unknown as CodexApi);
  const onFileGithubUrlChange = vi.fn();
  await act(async () => root.render(<GitExplorer repo={repo("repo")} treeHost={tree} theme="light"
    refreshSequence={0} onConfigure={() => {}} onFileGithubUrlChange={onFileGithubUrlChange} />));
  expect(request).toHaveBeenCalledWith("gitRepositoryHistory", { repositoryId: "repo", revision: "repo", worktree: "/tmp/repo" });
  const repositoryHistory = tree.querySelector('aside[aria-label="Repository history"]')!;
  expect(repositoryHistory.querySelector(".git-history-entry")?.textContent).toBe("Working tree");
  expect(repositoryHistory.textContent).not.toContain("Repository history");
  expect(container.querySelector('button[aria-label="Repository history"]')).toBeNull();
  expect(container.querySelector('aside[aria-label="File history"]')).toBeNull();
  await act(async () => tree.querySelector<HTMLButtonElement>('[title="other.txt"]')!.click());
  const [working, recentCommit, olderCommit] = repositoryHistory.querySelectorAll<HTMLButtonElement>(".git-history-entry");
  expect(recentCommit.textContent).toContain(newer.subject);
  await act(async () => recentCommit.click());
  expect(tree.textContent).toContain("Reading commit files…");
  await act(async () => olderCommit.click());
  expect(tree.querySelector('[aria-label="Commit files"]')).not.toBeNull();
  expect(tree.querySelector('[title="other.txt"]')).toBeNull();
  expect(onFileGithubUrlChange).toHaveBeenLastCalledWith(`${repo("repo").url}/commit/${older.commit}`);
  await act(async () => slowTree.resolve({ files: [{ path: "stale.txt", status: "clean" }] }));
  expect(tree.querySelector('[title="stale.txt"]')).toBeNull();
  await act(async () => tree.querySelector<HTMLButtonElement>('[title="old-only.txt"]')!.click());
  expect(request).toHaveBeenCalledWith("gitHistoricalPreview", expect.objectContaining({ path: "old-only.txt", commit: older.commit }));
  expect(container.querySelector("pre")?.textContent).toBe("committed file");
  expect(onFileGithubUrlChange).toHaveBeenLastCalledWith(`${repo("repo").url}/blob/${older.commit}/old-only.txt`);
  expect(request).toHaveBeenCalledWith("gitFileHistory", expect.objectContaining({ path: "old-only.txt", commit: older.commit }));
  const [baseline, original] = container.querySelectorAll<HTMLButtonElement>('aside[aria-label="File history"] .git-history-entry');
  expect(baseline.textContent).toBe("Selected commit");
  await act(async () => original.click());
  expect(container.querySelector("pre")?.textContent).toBe("original file");
  expect(olderCommit.getAttribute("aria-pressed")).toBe("true");
  await act(async () => baseline.click());
  expect(container.querySelector("pre")?.textContent).toBe("committed file");
  await act(async () => working.click());
  expect(tree.querySelector('[title="other.txt"][aria-selected="true"]')).not.toBeNull();
  expect(container.querySelector("pre")?.textContent).toBe("local edit");
  expect(request).toHaveBeenCalledWith("gitFileHistory", expect.objectContaining({ path: "other.txt", commit: undefined }));
  const fileHistory = container.querySelector('aside[aria-label="File history"]')!;
  expect(fileHistory.querySelectorAll(".git-history-entry")).toHaveLength(2);
  expect(fileHistory.textContent).toContain(fileChange.subject);
  expect(fileHistory.textContent).not.toContain(newer.subject);
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
    if (method === "gitRepositoryHistory" || method === "gitFileHistory") return Promise.resolve({ commits: [], hasOlder: false });
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
