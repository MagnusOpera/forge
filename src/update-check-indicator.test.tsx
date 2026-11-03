// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { AppUpdateStatus } from "../shared/github";
import { UpdateCheckIndicator } from "./update-check-indicator";

it("restores in-flight checks on mount, ignores stale snapshots, and unsubscribes", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  const root = createRoot(container);
  let resolve!: (status: AppUpdateStatus) => void;
  let changed!: (status: AppUpdateStatus) => void;
  const unsubscribe = vi.fn();
  const api = {
    getUpdateStatus: () => new Promise<AppUpdateStatus>(done => { resolve = done; }),
    onUpdateStatusChanged: (callback: typeof changed) => { changed = callback; return unsubscribe; },
    installUpdate: vi.fn(async () => {}),
    checkForUpdates: vi.fn(async () => {}),
  };
  try {
    await act(async () => root.render(<UpdateCheckIndicator api={api} />));
    await act(async () => resolve({ checking: true, failed: false, availableVersion: null, downloaded: false }));
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    await act(async () => changed({ checking: false, failed: false, availableVersion: null, downloaded: false }));
    expect(container.childElementCount).toBe(0);
    await act(async () => root.unmount());
    expect(unsubscribe).toHaveBeenCalledOnce();
    const nextRoot = createRoot(container);
    await act(async () => nextRoot.render(<UpdateCheckIndicator api={api} />));
    await act(async () => changed({ checking: false, failed: false, availableVersion: "1.2.3", downloaded: true }));
    await act(async () => resolve({ checking: true, failed: false, availableVersion: null, downloaded: false }));
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[aria-label="Upgrade to Forge 1.2.3"]')).not.toBeNull();
    await act(async () => nextRoot.unmount());
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  } finally { container.remove(); }
});
