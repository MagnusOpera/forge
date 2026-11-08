import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import type { GitCommit, GitFileHistory, GitPreview } from "../../shared/git-explorer";
import { codexApi, errorMessage } from "../codex/api";
import { commitDate, GitHistoryRail } from "./history-rail";

export type FilePreview = GitPreview | { kind: "error"; message: string };
type FileVersion = GitFileHistory["commits"][number];
type FileViewContext = {
  repositoryId: string;
  repositoryUrl: string;
  revision: string;
  worktree: string;
  header: ReactNode;
  workingPreview?: FilePreview;
  onGithubUrlChange(url: string | null): void;
};

const previewMessages = {
  binary: "This file cannot be displayed as text.",
  "too-large": "This file exceeds the 512 KiB preview limit.",
  unsupported: "Symbolic links, submodules, and other special files cannot be previewed.",
};

export function GitFileView({ path, baseVersion, publishedTreeCommit, ...context }: FileViewContext & {
  path: string;
  baseVersion: GitCommit | null;
  publishedTreeCommit?: string;
}) {
  const { repositoryId, revision, worktree } = context;
  const [version, setVersion] = useState<FileVersion | null>(null);
  const commit = baseVersion?.commit;
  const loadHistory = useCallback(() => codexApi().request("gitFileHistory", { repositoryId, revision, worktree, path, commit }),
    [repositoryId, revision, worktree, path, commit]);

  return (
    <div className="git-history-layout git-file-body">
      <GitVersionPreview {...context} path={version?.path ?? path} version={version ?? baseVersion}
        publishedTreeCommit={version ? undefined : publishedTreeCommit} />
      <GitHistoryRail<FileVersion> title="File history" baseLabel={baseVersion ? "Selected commit" : undefined}
        loadHistory={loadHistory} version={version} onSelect={setVersion} />
    </div>
  );
}

export function GitVersionPreview({
  repositoryId, repositoryUrl, revision, worktree, path, version, workingPreview, onGithubUrlChange,
  header, publishedTreeCommit, emptyMessage,
}: FileViewContext & {
  path: string | null;
  version: GitCommit | null;
  publishedTreeCommit?: string;
  emptyMessage?: string;
}) {
  const [historicalPreview, setHistoricalPreview] = useState<{ key: string; preview: FilePreview }>();
  const commit = version?.commit;
  const previewKey = commit && path ? `${commit}\0${path}` : undefined;

  useEffect(() => {
    if (!commit || !path || !previewKey) return;
    let active = true;
    const show = (preview: FilePreview) => { if (active) setHistoricalPreview({ key: previewKey, preview }); };
    void codexApi().request("gitHistoricalPreview", { repositoryId, revision, worktree, path, commit }).then(
      show, (error) => show({ kind: "error", message: errorMessage(error) }),
    );
    return () => { active = false; };
  }, [repositoryId, revision, worktree, path, commit, previewKey]);

  const preview = version
    ? (historicalPreview && historicalPreview.key === previewKey ? historicalPreview.preview : undefined)
    : workingPreview;
  const publishedFileCommit = preview && "publishedCommit" in preview ? preview.publishedCommit : undefined;
  const githubUrl = publishedFileCommit && path
    ? `${repositoryUrl}/blob/${publishedFileCommit}/${path.split("/").map(encodeURIComponent).join("/")}`
    : publishedTreeCommit ? `${repositoryUrl}/commit/${publishedTreeCommit}` : null;
  useLayoutEffect(() => {
    onGithubUrlChange(githubUrl);
    return () => onGithubUrlChange(null);
  }, [githubUrl, onGithubUrlChange]);

  return (
    <div className="git-file-version">
      {header}
      {version && <div className="git-file-version-bar" title={version.subject}>
        <code>{version.commit.slice(0, 7)}</code>
        <span>{version.subject || "Untitled commit"}</span>
        <time dateTime={version.date}>{commitDate(version.date)}</time>
      </div>}
      {!path ? (
        <div className="content-scroll git-explorer-empty" role="status">{emptyMessage}</div>
      ) : !preview ? (
        <div className="content-scroll git-explorer-empty" role="status">{version ? "Reading version…" : "Reading file…"}</div>
      ) : preview.kind === "text" ? (
        <pre className="git-file-preview" key={previewKey ?? path} tabIndex={0} aria-label={`File preview: ${path}`}>{preview.text}</pre>
      ) : (
        <div className="content-scroll git-explorer-empty">
          {preview.kind === "error" ? preview.message : preview.kind === "missing" ?
            (version ? "This file does not exist at this commit." : "This file is missing from the working tree.") : previewMessages[preview.kind]}
        </div>
      )}
    </div>
  );
}
