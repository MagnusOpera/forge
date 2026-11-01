import type { CodexStartOptions, CodexThreadStart } from "../../../shared/codex.js";

export type GitRunner = (args: string[]) => Promise<string>;
export async function threadStartOptions(run: GitRunner): Promise<CodexStartOptions> {
  const currentBranch = (await run(["branch", "--show-current"])).trim();
  let defaultBranch = (await run(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]).catch(() => "")).trim().replace(/^origin\//, "");
  if (!defaultBranch) {
    const advertised = await run(["ls-remote", "--symref", "origin", "HEAD"]).catch(() => "");
    defaultBranch = advertised.match(/^ref: refs\/heads\/(.+)\tHEAD$/m)?.[1] ?? "";
  }
  if (!defaultBranch) {
    const configured = (await run(["config", "--get", "init.defaultBranch"]).catch(() => "")).trim();
    for (const candidate of [configured, "main", "master"].filter(Boolean)) {
      if (await run(["show-ref", "--verify", `refs/heads/${candidate}`]).then(() => true, () => false)) {
        defaultBranch = candidate;
        break;
      }
    }
  }
  return { defaultBranch, currentBranch };
}
export async function startBaseCommit(run: GitRunner, start: CodexThreadStart): Promise<string> {
  if (!start.branch?.trim()) throw new Error("Choose a branch name.");
  await run(["check-ref-format", "--branch", start.branch]);
  return (await run(["rev-parse", "--verify", `refs/heads/${start.branch}^{commit}`])).trim();
}
export async function prepareDirectCheckout(run: GitRunner, start: CodexThreadStart): Promise<{ branch: string; baseCommit: string }> {
  if (!start.branch?.trim()) throw new Error("Choose a branch name.");
  await run(["check-ref-format", "--branch", start.branch]);
  const current = (await run(["branch", "--show-current"])).trim();
  if (start.kind === "current" && current !== start.branch)
    throw new Error("The repository branch changed. Create a new thread with the current branch.");
  if (start.kind === "new" || current !== start.branch) {
    if ((await run(["status", "--porcelain"])).trim())
      throw new Error("Commit or stash repository changes before switching branches.");
    if (start.kind === "new") {
      // New branches start at the default branch, independently of the current checkout.
      const options = await threadStartOptions(run);
      const base = await startBaseCommit(run, { kind: "worktree", branch: options.defaultBranch });
      await run(["switch", "-c", start.branch, base]);
    } else {
      await startBaseCommit(run, start);
      await run(["switch", start.branch]);
    }
  }
  return { branch: start.branch, baseCommit: (await run(["rev-parse", "--verify", "HEAD^{commit}"])).trim() };
}

export async function validateThreadStart(run: GitRunner, start: CodexThreadStart): Promise<void> {
  const validated = (await run(["check-ref-format", "--branch", start.branch])).trim();
  if (validated !== start.branch) throw new Error("Enter a literal branch name.");
  if (start.kind === "new") {
    for (const ref of [`refs/heads/${start.branch}`, `refs/remotes/origin/${start.branch}`]) {
      if (await run(["show-ref", "--verify", ref]).then(() => true, () => false))
        throw new Error("That branch already exists. Choose a new branch name.");
    }
  } else {
    await startBaseCommit(run, start);
  }
}
