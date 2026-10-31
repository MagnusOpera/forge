import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CodexQuickActions } from "./quick-actions";
import {
  defaultCodexPreferences,
  type CodexThreadSummary,
} from "../../shared/codex";
const thread: CodexThreadSummary = {
  id: "t",
  repositoryId: "r",
  title: "Test",
  archived: false,
  createdAt: "",
  updatedAt: "",
  settings: defaultCodexPreferences,
  state: "idle",
  worktree: "/repo",
  branch: "codex/task",
  baseCommit: "base",
};
it("names the repository default branch in merge tooltips without guessing when unknown", () => {
  for (const branch of ["main", "develop", "release/stable", null]) {
    const html = renderToStaticMarkup(
      <CodexQuickActions
        thread={thread}
        theme="light"
        defaultBranch={branch}
      />,
    );
    const label = branch ? `Merge ${branch}` : "Merge default branch";
    expect(html).toContain(`title="${label}"`);
    expect(html).toContain(`aria-label="${label}"`);
    expect(html).not.toContain("with Codex");
  }
});

it("shows the current checkout and offers the appropriate round-trip action", () => {
  const main = renderToStaticMarkup(
    <CodexQuickActions
      thread={{ ...thread, checkout: "default", branch: "trunk" }}
      theme="dark"
      defaultBranch="trunk"
    />,
  );
  expect(main).toContain('aria-label="Start worktree"');
  expect(main).toContain(">trunk</button>");
  expect(main).not.toContain('aria-label="Merge trunk"');
  expect(main).not.toContain('aria-label="Create PR"');
  const worktree = renderToStaticMarkup(
    <CodexQuickActions thread={thread} theme="light" defaultBranch="trunk" />,
  );
  expect(worktree).toContain('aria-label="Merge into trunk"');
  expect(worktree).toContain(">Worktree</button>");
});

it("separates checkout header actions from composer Git actions", () => {
  const header = renderToStaticMarkup(
    <CodexQuickActions thread={thread} theme="light" group="checkout" />,
  );
  for (const label of [
    "Copy checkout location",
    "Open checkout in Finder",
    "Open checkout in text editor",
    "Diff checkout changes",
  ])
    expect(header).toContain(`aria-label="${label}"`);
  expect(header).not.toContain('aria-label="Commit"');
  const composer = renderToStaticMarkup(
    <CodexQuickActions thread={thread} theme="light" group="git" />,
  );
  expect(composer).toContain('aria-label="Commit"');
  expect(composer).not.toContain('aria-label="Copy checkout location"');
  expect(composer).not.toContain('aria-label="Diff checkout changes"');
});
