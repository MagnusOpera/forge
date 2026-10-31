import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
const exec = promisify(execFile);

export function terminalDescendants(output: string, root: number): number[] {
  const children = new Map<number, number[]>();
  for (const line of output.trim().split("\n")) {
    const [pid, parent] = line.trim().split(/\s+/).map(Number);
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(parent) || pid <= 1) continue;
    children.set(parent, [...(children.get(parent) ?? []), pid]);
  }
  const result: number[] = [], seen = new Set([root]);
  const visit = (pid: number) => {
    for (const child of children.get(pid) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      visit(child);
      result.push(child);
    }
  };
  visit(root);
  return result;
}

/** Stop the owned shell and its jobs before deleting or moving its checkout. */
export async function terminateTerminalProcesses(root: number): Promise<void> {
  if (!Number.isSafeInteger(root) || root <= 1 || root === process.pid)
    throw new Error("Invalid terminal process.");
  if (process.platform === "win32") {
    await exec("taskkill", ["/PID", String(root), "/T", "/F"], { timeout: 5000 });
    return;
  }
  const listing = await exec("/bin/ps", ["-axo", "pid=,ppid="], { timeout: 3000, maxBuffer: 4 * 1024 * 1024 });
  const ids = [...terminalDescendants(listing.stdout, root), root];
  const signal = (pid: number, name: NodeJS.Signals) => {
    try { process.kill(pid, name); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  };
  // Stop children first, while the shell can reap them.
  for (const pid of ids) signal(pid, "SIGTERM");
  const running = async () => {
    try {
      const result = await exec("/bin/ps", ["-p", ids.join(","), "-o", "pid=,stat="], { timeout: 3000 });
      return result.stdout.trim().split("\n").filter(Boolean).flatMap((line) => {
        const [pid, state] = line.trim().split(/\s+/);
        return state?.startsWith("Z") ? [] : [Number(pid)];
      });
    } catch (error) {
      if ((error as { code?: number }).code === 1) return [];
      throw error;
    }
  };
  for (let attempt = 0; attempt < 20; attempt++) {
    const remaining = await running();
    if (!remaining.length) return;
    if (attempt === 5) for (const pid of remaining) signal(pid, "SIGKILL");
    await delay(50);
  }
  throw new Error("The terminal is still shutting down. The checkout was kept.");
}
