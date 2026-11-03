import type { NativeImage, NotificationConstructorOptions } from "electron";
import type { NativeNotificationPayload } from "../../shared/github.js";

function notificationText(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, 240);
}

export function nativeNotificationOptions(
  payload: NativeNotificationPayload,
  platform: NodeJS.Platform,
  icon?: NativeImage,
): NotificationConstructorOptions {
  return {
    title: notificationText(payload.title, "Forge"),
    body: notificationText(payload.body, "New Forge notification"),
    // macOS supplies the app icon on the left. A custom icon becomes an
    // additional content image on the right of the notification.
    ...(platform !== "darwin" && icon && !icon.isEmpty() ? { icon } : {}),
  };
}
