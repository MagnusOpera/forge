import { expect, it } from "vitest";
import type { NativeNotificationPayload } from "../shared/github";
import { acknowledgeNotifications, emptyNotificationHistory, recordNotification } from "./notification-history";

const payload = (id: string) => ({ id, title: id, body: id } as NativeNotificationPayload);
it("records newest first, clears only the indicator when seen, and signals later arrivals", () => {
  const first = recordNotification(emptyNotificationHistory, payload("one"));
  expect(first.pending).toBe(true);
  const seen = acknowledgeNotifications(first);
  expect(seen.pending).toBe(false);
  expect(seen.items).toEqual(first.items);
  expect(recordNotification(seen, payload("one"))).toBe(seen);
  const next = recordNotification(seen, payload("two"));
  expect(next.pending).toBe(true);
  expect(next.items.map(item => item.id)).toEqual(["two", "one"]);
});
it("bounds the session history to the latest 100 notifications", () => {
  let history = emptyNotificationHistory;
  for (let i = 0; i < 105; i++) history = recordNotification(history, payload(String(i)));
  expect(history.items).toHaveLength(100);
  expect(history.items[0].id).toBe("104");
  expect(history.items.at(-1)?.id).toBe("5");
});
