import { displayPath } from "../paths";
import { useMemo } from "react";
import { parsePatchFiles } from "@pierre/diffs";
import type { FileDiffProps } from "@pierre/diffs/react";
import {
  FileDiff,
  MultiFileDiff,
} from "../diff-viewer";
import type { CodexGitInfo } from "../../shared/codex";
export default function DiffFiles({
  info,
  theme,
  split,
  remote = false,
}: {
  info: CodexGitInfo;
  theme: "light" | "dark";
  split: boolean;
  remote?: boolean;
}) {
  const parsed = useMemo(() => {
    try {
      return parsePatchFiles(info.diff).flatMap((patch) => patch.files);
    } catch {
      return [];
    }
  }, [info.diff]);
  const options: FileDiffProps<undefined, undefined>["options"] = {
    diffStyle: split ? "split" : "unified",
    diffIndicators: "bars",
    disableFileHeader: true,
    hunkSeparators: "line-info-basic",
    lineDiffType: "word",
    overflow: "wrap",
    theme: { dark: "pierre-dark", light: "pierre-light" },
    themeType: theme,
  };
  return (
    <div className="changed-files-list">
      {parsed.map((file, index) => (
        <details
          className="changed-file-card"
          key={`${file.name}:${index}`}
          open
        >
          <summary className="codex-diff-file-title">
            {file.prevName ? `${displayPath(file.prevName, remote)} → ${displayPath(file.name, remote)}` : displayPath(file.name, remote)}
          </summary>
          <FileDiff
            className="diff-viewer"
            fileDiff={file}
            options={options}
            disableWorkerPool
          />
        </details>
      ))}
      {info.diff && !parsed.length && <pre>{info.diff}</pre>}
      {info.diff && parsed.length > 0 && (
        <details>
          <summary className="codex-diff-file-title">Raw patch</summary>
          <pre>{info.diff}</pre>
        </details>
      )}
      {info.untracked.map((file) => (
        <details className="changed-file-card" key={`new:${file.path}`} open>
          <summary className="codex-diff-file-title">
            {displayPath(file.path, remote)} · untracked
          </summary>
          {[
            "Binary file",
            "File unavailable",
            "Symlink outside the worktree.",
          ].includes(file.text) ? (
            <pre>{file.text}</pre>
          ) : (
            <MultiFileDiff
              className="diff-viewer"
              oldFile={{ name: file.path, contents: "" }}
              newFile={{ name: file.path, contents: file.text }}
              options={options}
              disableWorkerPool
            />
          )}
        </details>
      ))}
      {!info.diff && !info.untracked.length && (
        <p className="codex-muted">
          No changes since this thread's base commit.
        </p>
      )}
    </div>
  );
}
