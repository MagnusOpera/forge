import { expect, it } from "vitest";
import { contentItemKey, retainedContentItems } from "./content-items";
it("keeps item kind and repository in detached-window identity", () => {
  const keys = [contentItemKey("one", "pr:1"), contentItemKey("one", "issue:1"), contentItemKey("two", "pr:1")];
  expect(new Set(keys).size).toBe(3);
  expect(contentItemKey("one", "pr:1")).toBe(keys[0]);
});
it("retains detached items while allowing an unrelated item in the main pane, without duplicates", () => {
  const a = { key: "chat" }, b = { key: "issue" }, c = { key: "pr" };
  expect(retainedContentItems(c, [a, b])).toEqual([a, b, c]);
  expect(retainedContentItems(a, [a, b])).toEqual([b, a]);
  expect(retainedContentItems(b, [a])).toEqual([a, b]);
  expect(retainedContentItems(c, [])).toEqual([c]);
});
