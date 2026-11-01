import { useState } from "react";
import { CLASSIC_TOKEN_SETTINGS_URL } from "../shared/auth";
import { userFacingError } from "../shared/errors";

export function GitHubTokenForm({ disabled, onSave, onOpenUrl, onBusyChange, active = false, connected = false }: {
  disabled: boolean;
  active?: boolean;
  connected?: boolean;
  onSave(token: string): Promise<void>;
  onOpenUrl(url: string): void;
  onBusyChange(busy: boolean): void;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <details className="github-token-alternative">
    <summary>{active ? "Replace personal access token" : connected ? "Switch to a personal access token" : "Use a personal access token"}</summary>
    <p className="token-help">If your organization restricts OAuth Apps, you can use a classic token with <strong>repo</strong> and <strong>read:project</strong> permissions, subject to its token policy.</p>
    <form onSubmit={async event => {
      event.preventDefault();
      if (disabled || busy || !token.trim()) return;
      setBusy(true);
      onBusyChange(true);
      setError(null);
      try { await onSave(token.trim()); setToken(""); }
      catch (error) { setError(userFacingError(error, "Unable to save GitHub token.")); }
      finally { setBusy(false); onBusyChange(false); }
    }}>
      <label className="codex-field">
        <span>Classic personal access token</span>
        <input type="password" value={token} onChange={event => setToken(event.target.value)}
          autoComplete="off" spellCheck={false} placeholder="ghp_…" disabled={disabled || busy} />
      </label>
      <div className="codex-actions">
        <button type="submit" className="ghost-button" disabled={disabled || busy || !token.trim()}>{busy ? "Saving token…" : "Save token"}</button>
        <button type="button" className="ghost-button" onClick={() => onOpenUrl(CLASSIC_TOKEN_SETTINGS_URL)}>Open classic token settings</button>
      </div>
      {error && <div className="inline-error" role="alert">{error}</div>}
    </form>
  </details>;
}
