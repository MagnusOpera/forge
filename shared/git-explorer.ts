export type GitFile = {
  path: string;
  status: "clean" | "changed" | "conflict";
};

export type GitBranch = {
  ref: string;
  label: string;
  remote?: string;
  worktree?: string;
  linkedWorktree?: boolean;
  blocker?: string;
};

export type GitSnapshot =
  | { kind: "setup"; message: string }
  | {
      kind: "ready";
      checkout: string;
      revision: string;
      branch: string | null;
      pushDestination: string | null;
      files: GitFile[];
      branches: GitBranch[];
      blockers: Record<GitAction["kind"], string | null>;
    };

export type GitActionResult = { message: string; checkout: string };

export type GitAction =
  | { kind: "fetch" | "pull" | "push" }
  | { kind: "switch"; ref: string };

export type GitPreview = {
  publishedCommit?: string;
} & (
  | { kind: "text"; text: string }
  | { kind: "missing" | "binary" | "too-large" | "unsupported" }
);
