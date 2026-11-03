import type { NativeNotificationPayload } from "../shared/github";

export interface NotificationHistory {
  items: (NativeNotificationPayload & { read: boolean })[];
  pending: boolean;
}

export const emptyNotificationHistory: NotificationHistory = { items: [], pending: false };

export function recordNotification(history: NotificationHistory, payload: NativeNotificationPayload): NotificationHistory {
  if (history.items.some(item => item.id === payload.id)) return history;
  return { items: [{ ...payload, read: false }, ...history.items].slice(0, 10), pending: true };
}

export function acknowledgeNotifications(history: NotificationHistory): NotificationHistory {
  return { ...history, pending: false };
}

export function markNotificationRead(history: NotificationHistory, id: string): NotificationHistory {
  if (!history.items.some(item => item.id === id && !item.read)) return history;
  return { ...history, items: history.items.map(item => item.id === id ? { ...item, read: true } : item) };
}
