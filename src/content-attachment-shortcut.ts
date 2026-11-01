import { useEffect, useRef } from "react";
import { hasOpenKeyboardOverlay } from "./dom";
import { usePaneSurface } from "./pane-surface";

type ShortcutEvent = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;
export function isContentAttachmentShortcut(event: ShortcutEvent): boolean {
  return event.metaKey !== event.ctrlKey && event.shiftKey && !event.altKey && event.key.toLowerCase() === "d";
}

/** Bind to the content's current window so independent detached items cannot toggle one another. */
export function useContentAttachmentShortcut(toggle: () => void, enabled: boolean): void {
  const { window, document } = usePaneSurface();
  const latestToggle = useRef(toggle);
  latestToggle.current = toggle;
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || !isContentAttachmentShortcut(event)) return;
      if (hasOpenKeyboardOverlay(document)) return;
      event.preventDefault();
      event.stopPropagation();
      latestToggle.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [window, document, enabled]);
}
