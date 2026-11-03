import { expect, it, vi } from "vitest";
import type { NativeImage } from "electron";
import type { NativeNotificationPayload } from "../shared/github";
import { nativeNotificationOptions } from "../electron/main/notifications";

const payload = { title: " Pull request opened ", body: " Ready for review " } as NativeNotificationPayload;
const icon = { isEmpty: vi.fn(() => false) } as unknown as NativeImage;

it("uses macOS app identity without attaching a second notification image", () => {
  expect(nativeNotificationOptions(payload, "darwin", icon)).toEqual({
    title: "Pull request opened", body: "Ready for review",
  });
});

it.each(["win32", "linux"] as const)("retains custom notification icons on %s", platform => {
  expect(nativeNotificationOptions(payload, platform, icon)).toEqual({
    title: "Pull request opened", body: "Ready for review", icon,
  });
  const emptyIcon = { isEmpty: () => true } as NativeImage;
  expect(nativeNotificationOptions(payload, platform, emptyIcon)).not.toHaveProperty("icon");
});

it("preserves fallback text and bounds native notification text", () => {
  expect(nativeNotificationOptions({ title: " ", body: null } as unknown as NativeNotificationPayload, "darwin"))
    .toEqual({ title: "Forge", body: "New Forge notification" });
  expect(nativeNotificationOptions({ ...payload, body: "x".repeat(300) }, "darwin").body).toHaveLength(240);
});
