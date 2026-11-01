import { useEffect, useRef, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { Combobox } from "../components/combobox";
import type { CodexStartOptions, CodexThread, CodexThreadStart } from "../../shared/codex";
import { codexApi, errorMessage } from "./api";

export function ThreadStartPicker({ thread, onChange, onPendingChange }: {
  thread: CodexThread;
  onChange: () => Promise<void>;
  onPendingChange: (pending: boolean) => void;
}) {
  const [options, setOptions] = useState<CodexStartOptions | null>(null);
  const [kind, setKind] = useState<CodexThreadStart["kind"]>(thread.start?.kind ?? "worktree");
  const [branch, setBranch] = useState(thread.start?.kind === "new" ? thread.start.branch : "");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [validation, setValidation] = useState<{ branch: string; state: "checking" | "valid" | "invalid"; message?: string } | null>(null);
  const refresh = useRef(onChange);
  refresh.current = onChange;
  const [saved, setSaved] = useState(thread.start);
  useEffect(() => {
    let active = true;
    void codexApi().request("startOptions", { repositoryId: thread.repositoryId, id: thread.id })
      .then((value) => { if (active) setOptions(value); })
      .catch((e) => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, [thread.repositoryId, thread.id]);
  const branchStatus = validation?.branch === branch.trim() ? validation : null;
  const pending = busy || (kind === "new" && branchStatus?.state !== "valid");
  useEffect(() => {
    if (kind !== "new" || !branch.trim()) return;
    let active = true;
    const name = branch.trim();
    const timer = setTimeout(() => {
      setValidation({ branch: name, state: "checking" });
      const start: CodexThreadStart = { kind: "new", branch: name };
      void codexApi().request("setStart", { repositoryId: thread.repositoryId, id: thread.id, start })
        .then(async () => {
          if (!active) return;
          setSaved(start);
          setValidation({ branch: name, state: "valid" });
          await refresh.current();
        })
        .catch((e) => {
          if (active) setValidation({ branch: name, state: "invalid", message: errorMessage(e) });
        });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [kind, branch, thread.repositoryId, thread.id]);
  useEffect(() => {
    onPendingChange(pending);
    return () => onPendingChange(false);
  }, [pending, onPendingChange]);
  async function save(nextKind: CodexThreadStart["kind"]) {
    const selectedBranch = nextKind === "new" ? branch.trim() : nextKind === "current" ? options?.currentBranch : options?.defaultBranch;
    if (!selectedBranch) return;
    setBusy(true); setError("");
    try {
      const start = { kind: nextKind, branch: selectedBranch };
      await codexApi().request("setStart", { repositoryId: thread.repositoryId, id: thread.id, start });
      setSaved(start);
      await onChange();
    } catch (e) {
      setError(errorMessage(e));
      if (nextKind !== "new") setKind(saved?.kind ?? "worktree");
    } finally { setBusy(false); }
  }
  return <div className="codex-starting-point" aria-label="Thread starting point">
    <div className="codex-field codex-starting-point-row"><span>Start in</span>
      <Combobox
        label="Thread starting point"
        value={kind}
        disabled={busy || !options}
        options={[
          { value: "worktree", label: `Worktree from ${options?.defaultBranch || "default branch"} HEAD (default)`, disabled: !options?.defaultBranch },
          { value: "default", label: `Default branch (${options?.defaultBranch || "unavailable"})`, disabled: !options?.defaultBranch },
          { value: "new", label: `New branch from ${options?.defaultBranch || "default branch"}`, disabled: !options?.defaultBranch },
          { value: "current", label: `Current repository branch (${options?.currentBranch || "detached HEAD"})`, disabled: !options?.currentBranch },
        ]}
        onChange={(next) => {
          setKind(next);
          setValidation(null);
          if (next !== "new") void save(next);
        }}
      />
    </div>
    {kind === "new" && <label className="codex-field codex-starting-point-row"><span>Branch name</span>
      <div className="codex-branch-input">
        <input aria-label="Branch name" aria-invalid={branchStatus?.state === "invalid"} autoFocus required value={branch} placeholder="codex/my-task" onChange={(event) => {
          setBranch(event.target.value);
          setValidation(null);
          setError("");
        }} />
        {branch.trim() && <span className={`codex-branch-status ${branchStatus?.state ?? "checking"}`} role="status" aria-label={branchStatus?.state === "valid" ? "Branch name available" : branchStatus?.state === "invalid" ? "Branch name unavailable" : "Checking branch name"} title={branchStatus?.message}>
          {branchStatus?.state === "valid" ? <Check size={16} /> : branchStatus?.state === "invalid" ? <X size={16} /> : <Loader2 size={16} className="spin" />}
        </span>}
      </div>
    </label>}
    {kind === "new" && branchStatus?.message && <p>{branchStatus.message}</p>}
    {error && <div className="inline-error" role="alert">{error}</div>}
  </div>;
}
