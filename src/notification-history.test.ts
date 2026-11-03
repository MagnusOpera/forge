import { expect, it } from "vitest";
import type { NativeNotificationPayload } from "../shared/github";
import { acknowledgeNotifications, emptyNotificationHistory, markNotificationRead, recordNotification } from "./notification-history";

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
it("bounds the session history to the latest 10 notifications", () => {
  let history = emptyNotificationHistory;
  for (let i = 0; i < 15; i++) history = recordNotification(history, payload(String(i)));
  expect(history.items).toHaveLength(10);
  expect(history.items[0].id).toBe("14");
  expect(history.items.at(-1)?.id).toBe("5");
});

it("keeps items unread when the list is viewed and marks only the chosen item read", () => {
  const history = recordNotification(recordNotification(emptyNotificationHistory, payload("one")), payload("two"));
  const seen = acknowledgeNotifications(history);
  expect(seen.items.every(item => !item.read)).toBe(true);
  const read = markNotificationRead(seen, "one");
  expect(read.items.map(item => [item.id, item.read])).toEqual([["two", false], ["one", true]]);
  expect(history.items.every(item => !item.read)).toBe(true);
  expect(read.pending).toBe(false);
  expect(markNotificationRead(read, "one")).toBe(read);
  expect(markNotificationRead(read, "missing")).toBe(read);
  expect(recordNotification(read, payload("one"))).toBe(read);
  const next = recordNotification(read, payload("three"));
  expect(next.items[0].read).toBe(false);
  expect(next.items.find(item => item.id === "one")?.read).toBe(true);
});
