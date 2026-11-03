import { Bell, Check, GitPullRequest, Workflow, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { NativeNotificationPayload } from "../shared/github";
import type { NotificationHistory } from "./notification-history";

export function NotificationList({ history, onSeen, onOpen, onRead }: {
  history: NotificationHistory;
  onSeen(): void;
  onRead(id: string): void;
  onOpen(payload: NativeNotificationPayload): void;
}) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  return <div ref={host} className="rail-notifications">
    <button ref={trigger} className="icon-button notification-bell" aria-label={history.pending ? "Notifications, unread activity" : "Notifications"}
      title={history.pending ? "Notifications, unread activity" : "Notifications"} aria-expanded={open} aria-controls={id} aria-haspopup="dialog"
      onClick={() => { onSeen(); setOpen(!open); }}>
      <Bell size={18} />
      {history.pending && <span className="notification-dot" aria-hidden="true" />}
    </button>
    {open && <div ref={panel} id={id} className="notification-panel" role="dialog" aria-label="Notifications">
      <div className="notification-panel-header"><span>Notifications</span>
        <button className="icon-button" aria-label="Close notifications" onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={14} /></button>
      </div>
      <div className="notification-list">
        {history.items.length === 0 ? <div className="empty-row">No notifications yet.</div> : history.items.map(item => <div className={`repo-button-wrap notification-item${item.read ? "" : " unread"}`} key={item.id}>
          <button className="repo-button notification-row" title={`${item.title}\n${item.body}`}
            onClick={() => { onOpen(item); setOpen(false); trigger.current?.focus(); }}>
            {item.source.kind === "pull-request" ? <GitPullRequest size={15} /> : <Workflow size={15} />}
            <span className="notification-copy"><span className="repo-name notification-title">{item.title}</span><span className="repo-meta">{item.body}</span></span>
          </button>
          {!item.read && <button className="icon-button notification-mark-read" aria-label={`Mark as read: ${item.title}`} title="Mark as read"
            onClick={event => { (event.currentTarget.previousElementSibling as HTMLButtonElement | null)?.focus(); onRead(item.id); }}><Check size={15} /></button>}
        </div>)}
      </div>
    </div>}
  </div>;
}
