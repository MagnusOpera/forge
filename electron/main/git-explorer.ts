import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import type { GitAction, GitBranch, GitFile, GitPreview, GitSnapshot } from "../../shared/git-explorer.js";
import type { CodexGitInfo } from "../../shared/codex.js";
import { git } from "./codex/git.js";
import { parseWorktreeBranches } from "./codex/merge.js";

const localPrefix = "refs/heads/";
const remotePrefix = "refs/remotes/";
const maxPreviewBytes = 512 * 1024;
const operationMarkers = [
  "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge",
  "rebase-apply", "sequencer", "BISECT_LOG", "index.lock",
];

type Ref = {
  ref: string;
  symbolic: string;
  worktree: string;
  upstream: string;
  remote: string;
  remoteRef: string;
};

function run(
  cwd: string,
  args: string[],
  options: { network?: boolean; maxBuffer?: number } = {},
): Promise<string> {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
  for (const key of [
    "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE",
  ]) delete env[key];
  return git(cwd, ["--no-optional-locks", ...args], {
    env, timeout: options.network ? 120_000 : 30_000, maxBuffer: options.maxBuffer,
  });
}

function outputLine(output: string): string {
  return output.replace(/\n$/, "");
}

export async function resolveGitCheckout(folder: string): Promise<string> {
  const configured = await realpath(folder);
  const root = await realpath(outputLine(await run(configured, ["rev-parse", "--show-toplevel"])));
  if (root !== configured || configured !== path.resolve(folder))
    throw new Error("The configured folder is no longer the root of a Git checkout.");
  return root;
}

export async function resolveExplorerWorktree(root: string, worktree?: string): Promise<string> {
  if (!worktree || worktree === root) return root;
  const entries = parseWorktreeBranches(await run(root, ["worktree", "list", "--porcelain", "-z"]));
  const missing = () => new Error("This worktree is no longer available in the project checkout.");
  if (!path.isAbsolute(worktree)) throw missing();
  const candidate = await realpath(worktree).catch(() => { throw missing(); });
  const registered = await Promise.all(entries.map(({ path }) => realpath(path).catch(() => null)));
  if (!registered.includes(candidate)) throw missing();
  const commonDirectory = async (cwd: string) =>
    realpath(outputLine(await run(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"])));
  const [checkout, projectGitDir] = await Promise.all([resolveGitCheckout(candidate), commonDirectory(root)]);
  if (await commonDirectory(checkout) !== projectGitDir) throw missing();
  return checkout;
}

function parseGitStatus(output: string): {
  files: Map<string, GitFile["status"]>;
  branch: string | null;
  head: string;
  hasTrackedChanges: boolean;
} {
  const files = new Map<string, GitFile["status"]>();
  const records = output.split("\0");
  const untracked: string[] = [];
  let branch: string | null = null, head = "";
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (record.startsWith("# branch.oid ")) head = record.slice(13);
    if (record.startsWith("# branch.head ")) branch = record.slice(14);
    if (record.startsWith("? ")) untracked.push(record.slice(2));
    if (record.startsWith("1 ")) files.set(record.split(" ").slice(8).join(" "), "changed");
    if (record.startsWith("2 ")) {
      files.set(record.split(" ").slice(9).join(" "), "changed");
      index++; // The original name is a separate NUL-delimited field.
    }
    if (record.startsWith("u ")) files.set(record.split(" ").slice(10).join(" "), "conflict");
  }
  const hasTrackedChanges = files.size > 0;
  for (const file of untracked) {
    if (!files.has(file)) files.set(file, "changed");
  }
  return { files, branch: branch === "(detached)" ? null : branch, head, hasTrackedChanges };
}

async function readBranch(cwd: string): Promise<string | null> {
  const ref = await run(cwd, ["symbolic-ref", "--quiet", "HEAD"]).then(outputLine, (error: NodeJS.ErrnoException) => {
    if (String(error.code) === "1") return "";
    throw error;
  });
  return ref.startsWith(localPrefix) ? ref.slice(localPrefix.length) : null;
}

async function readRefs(cwd: string, prefixes: string[]): Promise<Ref[]> {
  const result = await run(cwd, [
    "for-each-ref",
    "--sort=refname",
    "--sort=-committerdate",
    "--format=%(refname)%00%(symref)%00%(worktreepath)%00%(upstream)%00%(upstream:remotename)%00%(upstream:remoteref)%00",
    ...prefixes,
  ]);
  // A worktree path can contain newlines, so split only on the record terminator.
  return result.split("\0\n").filter(Boolean).map((line) => {
    const [ref, symbolic, worktree, upstream, remote, remoteRef] = line.split("\0");
    return { ref, symbolic, worktree, upstream, remote, remoteRef };
  });
}

function listBranches(cwd: string, refs: Ref[], remotes: string[], projectCheckout: string): GitBranch[] {
  const local = refs.filter(({ ref }) => ref.startsWith(localPrefix));
  const localNames = new Set(local.map(({ ref }) => ref.slice(localPrefix.length)));
  const trackedRefs = new Set(local.map(({ upstream }) => upstream));
  const remoteNames = [...remotes].sort((a, b) => b.length - a.length);
  const branches = new Map<string, GitBranch>();
  for (const { ref, symbolic, worktree } of refs) {
    if (ref.startsWith(localPrefix)) {
      const label = ref.slice(localPrefix.length);
      branches.set(label, {
        ref, label,
        ...(worktree && worktree !== cwd ? { worktree } : {}),
        ...(worktree && worktree !== projectCheckout ? { linkedWorktree: true } : {}),
      });
      continue;
    }
    if (symbolic || trackedRefs.has(ref) || !ref.startsWith(remotePrefix)) continue;
    const qualifiedName = ref.slice(remotePrefix.length);
    const remote = remoteNames.find((name) => qualifiedName.startsWith(name + "/"));
    if (!remote) continue;
    const label = qualifiedName.slice(remote.length + 1);
    if (localNames.has(label)) continue;
    if (branches.has(label)) {
      if (remote !== "origin") continue;
      // Reinsert at origin's position in the list sorted by commit date.
      branches.delete(label);
    }
    branches.set(label, { ref, label, remote });
  }
  return [...branches.values()];
}

async function pendingOperation(cwd: string): Promise<boolean> {
  const gitDir = outputLine(await run(cwd, ["rev-parse", "--absolute-git-dir"]));
  const markers = await Promise.all(operationMarkers.map((marker) =>
    lstat(path.join(gitDir, marker)).then(() => true, (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    }),
  ));
  return markers.some(Boolean);
}

function position(cwd: string, branch: string | null, head: string, refs: Ref[]) {
  const upstream = refs.find(({ ref }) => branch !== null && ref === localPrefix + branch);
  const revision = createHash("sha256").update(JSON.stringify([
    cwd, branch, head, upstream?.upstream, upstream?.remote, upstream?.remoteRef,
  ])).digest("hex");
  return { revision, branch, head, upstream };
}

async function readState(cwd: string, checkoutBlocker: string | null, includeFiles = true, projectCheckout = cwd) {
  const [status, refs, remoteOutput, pending, trackedFiles] = await Promise.all([
    run(cwd, ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all", "--ignore-submodules=none"]),
    readRefs(cwd, ["refs/heads", "refs/remotes"]),
    run(cwd, ["remote"]),
    pendingOperation(cwd),
    includeFiles ? run(cwd, ["ls-files", "--cached", "-z"]) : "",
  ]);
  const { files: changes, branch: reportedBranch, head, hasTrackedChanges } = parseGitStatus(status);
  const branch = reportedBranch ?? await readBranch(cwd);
  const current = position(cwd, branch, head, refs);
  const { upstream } = current;
  const remotes = outputLine(remoteOutput).split("\n").filter(Boolean);
  const remoteUpstream = upstream?.upstream.startsWith(remotePrefix) &&
    upstream.remoteRef.startsWith(localPrefix) && remotes.includes(upstream.remote) ? upstream : undefined;
  const files = new Map<string, GitFile["status"]>();
  if (includeFiles) {
    for (const file of trackedFiles.split("\0").filter(Boolean)) files.set(file, "clean");
    for (const [file, status] of changes) files.set(file, status);
  }
  const operationBlocker = checkoutBlocker ??
    (pending || [...changes.values()].includes("conflict") ? "Finish the pending Git operation first." : null);
  const upstreamBlocker = operationBlocker ??
    (changes.size ? "Commit or remove local changes first." :
      !branch || head === "(initial)" ? "Check out a branch with a commit first." :
      !remoteUpstream ? "Configure a remote upstream for the current branch first." : null);
  const snapshot: Extract<GitSnapshot, { kind: "ready" }> = {
    kind: "ready",
    checkout: cwd,
    revision: current.revision,
    branch,
    pushDestination: remoteUpstream ? remoteUpstream.remote + "/" + remoteUpstream.remoteRef.slice(localPrefix.length) : null,
    files: Array.from(files, ([path, status]) => ({ path, status })),
    branches: listBranches(cwd, refs, remotes, projectCheckout),
    blockers: {
      fetch: checkoutBlocker ?? (remotes.length ? null : "Configure a Git remote first."),
      pull: upstreamBlocker,
      push: upstreamBlocker,
      switch: operationBlocker ?? (hasTrackedChanges ? "Commit or remove tracked changes first." : null),
    },
  };
  return { snapshot, current, remotes, upstream: remoteUpstream };
}

export async function gitSnapshot(
  cwd: string, checkoutBlocker: string | null, projectCheckout = cwd,
): Promise<GitSnapshot> {
  const { snapshot } = await readState(cwd, checkoutBlocker, true, projectCheckout);
  if (cwd !== projectCheckout) snapshot.blockers.switch = checkoutBlocker;
  return snapshot;
}

function gitError(error: unknown): string {
  const command = error as { stderr?: string; killed?: boolean; message?: string };
  if (command.killed) return "The Git command timed out. Refresh to check the checkout.";
  return (command.stderr?.trim() || command.message || String(error))
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/]+@/gi, "$1")
    .replace(/(https?:\/\/[^\s?'"]+)\?[^\s'"]+/gi, "$1")
    .slice(0, 2000);
}

export async function runGitAction(
  cwd: string,
  expected: string,
  action: GitAction,
  checkPlacement: () => void = () => {},
): Promise<string> {
  try {
    const { snapshot, current, remotes, upstream } = await readState(cwd, null, false);
    checkPlacement();
    if (expected !== snapshot.revision) throw new Error("The checkout changed. Refresh and try again.");
    const blocker = snapshot.blockers[action.kind];
    if (blocker) throw new Error(blocker);

    if (action.kind === "fetch") {
      const failures: string[] = [];
      for (const remote of remotes) {
        checkPlacement();
        try {
          const refspecs = await run(cwd, ["config", "--null", "--get-all", `remote.${remote}.fetch`])
            .then((output) => output.split("\0").filter(Boolean), (error: NodeJS.ErrnoException) => {
              if (String(error.code) === "1") return [];
              throw error;
            });
          const tracking = refspecs.filter((spec) => spec.split(":")[1]?.startsWith(remotePrefix));
          if (!tracking.length) throw new Error("Configure a remote-tracking fetch mapping for this remote.");
          const exclusions = refspecs.filter((spec) => spec.startsWith("^"));
          await run(cwd, [
            "fetch", "--prune", "--no-prune-tags", "--no-tags", "--no-recurse-submodules",
            "--refmap=", "--", remote, ...tracking, ...exclusions,
          ], { network: true });
        } catch (error) {
          failures.push(`${remote}: ${gitError(error)}`);
        }
      }
      if (failures.length) throw new Error(`Fetch failed for ${failures.join("\n")}`);
      return "Fetch complete.";
    }

    if (action.kind === "switch") {
      const branch = snapshot.branches.find(({ ref }) => ref === action.ref);
      if (!branch) throw new Error("This branch is no longer available.");
      if (branch.worktree) throw new Error("This branch is checked out in another worktree.");
      if (branch.blocker) throw new Error(branch.blocker);
      const name = branch.label;
      if (name === current.branch) return `Already on ${name}.`;
      if (name.startsWith("-")) throw new Error("This branch name cannot be switched to safely.");
      const args = ["switch", "--no-guess", "--no-overwrite-ignore", "--no-recurse-submodules"];
      if (branch.remote) args.push("--track=direct", "--create", name, "--", branch.ref);
      else args.push("--", name);
      await run(cwd, args);
      return `Switched to ${name}.`;
    }

    if (!upstream) throw new Error("Configure a remote upstream first.");
    if (action.kind === "push") {
      await run(cwd, [
        "-c", `remote.${upstream.remote}.mirror=false`, "push", "--no-force", "--no-follow-tags",
        "--recurse-submodules=no", "--", upstream.remote, `${current.head}:${upstream.remoteRef}`,
      ], { network: true });
      return `Pushed ${current.branch} to ${snapshot.pushDestination}.`;
    }

    await run(cwd, [
      "fetch", "--no-prune", "--no-prune-tags", "--no-tags", "--no-recurse-submodules", "--refmap=", "--",
      upstream.remote, `+${upstream.remoteRef}:${upstream.upstream}`,
    ], { network: true });
    const target = outputLine(await run(cwd, ["rev-parse", "--verify", upstream.upstream]));
    const base = await run(cwd, ["merge-base", current.head, target]).then(outputLine, (error: NodeJS.ErrnoException) => {
      if (String(error.code) === "1") return "";
      throw error;
    });
    const afterFetch = await readState(cwd, null, false);
    checkPlacement();
    if (afterFetch.snapshot.revision !== expected) throw new Error("The checkout changed while fetching. Refresh and try again.");
    if (afterFetch.snapshot.blockers.pull) throw new Error(afterFetch.snapshot.blockers.pull);
    if (base === target) return `${current.branch} is up to date with ${snapshot.pushDestination}.`;
    if (base !== current.head) throw new Error("The local branch and its upstream have diverged. Pull requires a fast-forward.");
    await run(cwd, ["-c", "submodule.recurse=false", "merge", "--ff-only", "--no-autostash", "--no-overwrite-ignore", "--no-squash", target]);
    return `Pulled ${snapshot.pushDestination} into ${current.branch}.`;
  } catch (error) {
    throw new Error(gitError(error));
  }
}

function githubRepository(url: string): string | undefined {
  const match = url.match(/^(?:https?:\/\/(?:[^/]+@)?github\.com\/|ssh:\/\/(?:[^/]+@)?github\.com(?::22)?\/|(?:[^@]+@)?github\.com:)([^/]+\/[^/]+?)(?:\.git)?\/?$/i);
  return match?.[1].toLowerCase();
}

async function publishedGitHubCommit(cwd: string, fullName: string, file: string, upstream?: Ref) {
  if (!fullName || !upstream?.upstream.startsWith(remotePrefix)) return undefined;
  const url = await run(cwd, ["remote", "get-url", "--", upstream.remote]).then(outputLine, () => "");
  if (githubRepository(url) !== fullName.toLowerCase()) return undefined;
  const commit = await run(cwd, ["rev-parse", "--verify", upstream.upstream]).then(outputLine, () => "");
  if (!/^[\da-f]{40}(?:[\da-f]{24})?$/.test(commit)) return undefined;
  const entry = await run(cwd, ["--literal-pathspecs", "ls-tree", "-z", commit, "--", file]);
  return entry ? commit : undefined;
}

function checkoutFilePath(cwd: string, file: string): string {
  const target = path.resolve(cwd, file);
  const relative = path.relative(cwd, target);
  if (path.isAbsolute(file) || !relative || relative === ".." || relative.startsWith(".." + path.sep) ||
      path.isAbsolute(relative) || file.includes("\0") || file.split("/").some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git"))
    throw new Error("Invalid checkout file path.");
  return target;
}

async function readPosition(cwd: string) {
  const [head, branch] = await Promise.all([
    run(cwd, ["rev-parse", "--verify", "HEAD"]).then(outputLine, () => "(initial)"),
    readBranch(cwd),
  ]);
  const refs = branch ? await readRefs(cwd, [localPrefix + branch]) : [];
  return position(cwd, branch, head, refs);
}

export async function gitBranchCheckout(root: string, ref: string) {
  if (ref.startsWith(localPrefix)) {
    const branch = (await readRefs(root, [ref])).find((entry) => entry.ref === ref);
    if (branch?.worktree) {
      const checkout = await resolveExplorerWorktree(root, branch.worktree);
      return { checkout, message: `Opened worktree for ${ref.slice(localPrefix.length)}.` };
    }
  }
  return null;
}

export async function gitCheckoutRevision(cwd: string): Promise<string> {
  return (await readPosition(cwd)).revision;
}

export async function gitPreview(cwd: string, fullName: string, expected: string, file: string): Promise<GitPreview> {
  const target = checkoutFilePath(cwd, file);
  const [current, listed] = await Promise.all([
    readPosition(cwd),
    run(cwd, ["--literal-pathspecs", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", file]),
  ]);
  if (current.revision !== expected) throw new Error("The checkout changed. Refresh to preview this file.");
  const publishedCommit = await publishedGitHubCommit(cwd, fullName, file, current.upstream);
  if (!listed.split("\0").includes(file)) return { kind: "missing", publishedCommit };
  return { ...await readWorkingFile(target), publishedCommit };
}

async function readWorkingFile(target: string): Promise<GitPreview> {
  try {
    // Canonical equality rejects both escaping symlinks and symlinked parent directories.
    const before = await lstat(target);
    if (!before.isFile() || await realpath(target) !== target) return { kind: "unsupported" };
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino || await realpath(target) !== target)
        return { kind: "unsupported" };
      if (info.size > maxPreviewBytes) return { kind: "too-large" };
      const buffer = Buffer.allocUnsafe(maxPreviewBytes + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > maxPreviewBytes) return { kind: "too-large" };
      const data = buffer.subarray(0, length);
      if (data.includes(0)) return { kind: "binary" };
      try {
        return { kind: "text", text: new TextDecoder("utf-8", { fatal: true }).decode(data) };
      } catch {
        return { kind: "binary" };
      }
    } finally {
      await handle.close();
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { kind: "missing" };
    if (code === "ELOOP") return { kind: "unsupported" };
    throw error;
  }
}

export async function gitFileDiff(cwd: string, expected: string, file: string): Promise<CodexGitInfo> {
  const target = checkoutFilePath(cwd, file);
  const [current, output] = await Promise.all([
    readPosition(cwd),
    run(cwd, [
      "--literal-pathspecs", "status", "--porcelain=v2", "-z", "--untracked-files=all",
      "--ignore-submodules=none", "--", file,
    ]),
  ]);
  if (current.revision !== expected) throw new Error("The checkout changed. Refresh Git Explorer and try again.");
  const { files, hasTrackedChanges } = parseGitStatus(output);
  const result: CodexGitInfo = { status: "", diff: "", untracked: [] };
  if (!files.has(file)) return result;

  if (!hasTrackedChanges) {
    const content = await readWorkingFile(target);
    if (content.kind === "text") result.untracked.push({ path: file, text: content.text });
    else if (content.kind === "binary") result.untracked.push({ path: file, text: "Binary file" });
    else if (content.kind === "too-large") throw new Error("This file exceeds the 512 KiB text preview limit.");
    else if (content.kind === "unsupported") throw new Error("This file type cannot be shown in the diff viewer.");
    return result;
  }

  const patch = (...comparison: string[]) => run(cwd, [
    "--literal-pathspecs", "diff", "--patch", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames",
    "--ignore-submodules=none", "--submodule=short", "--src-prefix=a/", "--dst-prefix=b/",
    ...comparison, "--", file,
  ], { maxBuffer: 1024 * 1024 });
  try {
    if (current.head !== "(initial)") result.diff = await patch(current.head);
    if (!result.diff) {
      result.diff = await patch("--cached");
      if (result.diff && current.head !== "(initial)")
        result.status = "The working tree matches HEAD. Showing the staged changes.";
    }
    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
      throw new Error("This patch exceeds the 1 MiB diff limit.");
    throw new Error(gitError(error));
  }
}
