import { useEffect, useState } from "react";
import { ArrowUpCircle, Loader2, RefreshCw } from "lucide-react";
import type { AppUpdateStatus, GithubFocusApi } from "../shared/github";

type UpdateApi = Pick<GithubFocusApi, "getUpdateStatus" | "onUpdateStatusChanged" | "installUpdate" | "checkForUpdates">;

export function UpdateCheckIndicator({ api }: { api: UpdateApi }) {
  const [status, setStatus] = useState<AppUpdateStatus>({ checking: false, failed: false, availableVersion: null, downloaded: false });
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let receivedEvent = false;
    const unsubscribe = api.onUpdateStatusChanged?.(value => {
      receivedEvent = true;
      if (active) { setStatus(value); setError(""); }
    });
    void api.getUpdateStatus?.().then(value => {
      if (active && !receivedEvent) setStatus(value);
    }).catch(() => { if (active && !receivedEvent) setError("Unable to check for updates. Try again."); });
    return () => { active = false; unsubscribe?.(); };
  }, [api]);

  if (status.checking) return (
    <span className="rail-update-check" role="status" aria-label="Checking for updates" title="Checking for updates">
      <Loader2 size={17} className="spin" aria-hidden="true" />
    </span>
  );
  if (status.failed || error) return (
    <button className="icon-button" aria-label="Retry update check" title="Update failed. Check again."
      disabled={installing} onClick={() => {
        setInstalling(true);
        setError("");
        void api.checkForUpdates().catch(() => setError("Unable to check for updates. Try again."))
          .finally(() => setInstalling(false));
      }}>
      <RefreshCw size={17} />
    </button>
  );
  if (!status.availableVersion) return null;
  const label = `Upgrade to Forge ${status.availableVersion}`;
  return (
    <button className="icon-button" aria-label={label}
      title={error || `${label}${status.downloaded ? ", ready to install" : ", downloading"}`}
      disabled={installing} aria-busy={installing}
      onClick={() => {
        setInstalling(true);
        setError("");
        void api.installUpdate().catch(() => setError("Unable to prepare the update. Try again."))
          .finally(() => setInstalling(false));
      }}>
      {installing ? <Loader2 size={17} className="spin" /> : <ArrowUpCircle size={17} />}
    </button>
  );
}
