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

  if (status.checking) {
    const label = status.availableVersion && !status.downloaded ? "Downloading update" : "Checking for updates";
    return (
      <span className="rail-update-check" role="status" aria-label={label} title={label}>
        <RefreshCw size={17} className="spin" aria-hidden="true" />
      </span>
    );
  }
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
  if (!status.availableVersion || !status.downloaded) return null;
  const label = `Upgrade to Forge ${status.availableVersion}`;
  return (
    <button className="icon-button" aria-label={label}
      title={`${label}, ready to install`}
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
