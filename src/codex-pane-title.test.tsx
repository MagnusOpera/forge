// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { ContentPane } from "./App";

const noop = () => {};
const succeed = async () => true;

it.each([false, true])("shows the current thread name and the new-thread fallback, detached=%s", async detached => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const props: ComponentProps<typeof ContentPane> = {
    detached, attachmentOpening: false, onToggleAttachment: noop,
    codexContent: <div>Conversation</div>,
    auth: null, repo: null, selection: { kind: "repo" },
    prDetail: null, runDetail: null, prTab: "conversation", runTab: "jobs",
    repoLabels: [], loading: false, error: null, prActionSubmitting: false,
    theme: "light", workflowRuns: [],
    onPublishRelease: async release => release,
    onPrTabChange: noop, onRunTabChange: noop, onOpenGithubUrl: noop,
    onOpenWorkflowRunFromCheck: noop, onCopyText: succeed,
    onSubmitPullRequestReview: noop, onAddPullRequestComment: succeed,
    onUpdatePullRequestTitle: succeed, onUpdatePullRequestDraftState: succeed,
    onAddPullRequestLabel: succeed, onRemovePullRequestLabel: succeed,
    onEnablePullRequestAutoMerge: succeed, onDisablePullRequestAutoMerge: succeed,
    onMergePullRequest: succeed, onClosePullRequest: succeed,
    onSelectRun: noop, onRunWorkflow: noop, onRunWorkflowWithArguments: noop,
  };
  try {
    for (const title of [undefined, "Fix pane titles", "Renamed thread", undefined]) {
      await act(async () => root.render(<ContentPane {...props} codexTitle={title} />));
      const header = container.querySelector(".content-title > span")!;
      expect(header.textContent).toBe(title ?? "Codex");
      expect(header.getAttribute("title")).toBe(title ?? null);
    }
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
