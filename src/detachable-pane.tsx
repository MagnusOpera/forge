import { contentPaneWindowFeatures } from "../shared/content-window";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PaneSurfaceContext } from "./pane-surface";

export function contentWindowUrl(href: string): string {
  return new URL("content-window.html", href).href;
}

/** One portal container, moved rather than remounted: drafts and local view state survive. */
export function useDetachablePane(options: { onReattach?: () => void } = {}) {
  const [windowName] = useState(() => `forge-content-pane-${crypto.randomUUID()}`);
  const onReattach = useRef(options.onReattach);
  onReattach.current = options.onReattach;
  const [host] = useState(() => document.createElement("div"));
  const slot = useRef<HTMLDivElement>(null);
  const external = useRef<Window | null>(null);
  const [surface, setSurface] = useState<Window>(window);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<(() => void) | null>(null);
  const detached = surface !== window;

  const restore = useCallback(() => {
    const child = external.current;
    external.current = null;
    pending.current?.();
    pending.current = null;
    // Move the live tree back before the native window disposes its document.
    if (slot.current) slot.current.append(host);
    setSurface(window);
    setOpening(false);
    if (child && !child.closed) child.close();
  }, [host]);
  // Only an explicit reattach should navigate the main workspace to this item.
  const reattach = useCallback(() => {
    const wasDetached = host.ownerDocument !== document;
    restore();
    if (wasDetached) onReattach.current?.();
  }, [host, restore]);
  const focus = useCallback(() => {
    if (!external.current || external.current.closed) return;
    if (window.githubFocus?.focusContentWindow) void window.githubFocus.focusContentWindow(windowName);
    else external.current.focus();
  }, [windowName]);
  const detach = useCallback(() => {
    if (external.current && !external.current.closed) { focus(); return; }
    // Measure before opening, moving the view, or collapsing the main window.
    const rect = host.getBoundingClientRect();
    const child = window.open(contentWindowUrl(window.location.href), windowName, contentPaneWindowFeatures(rect));
    if (!child) throw new Error("The content window could not be opened. Please try again.");
    external.current = child;
    setError("");
    setOpening(true);
    let moved = false;
    const ready = (event: MessageEvent) => {
      if (event.source !== child || event.data !== "forge-content-ready" || moved) return;
      moved = true;
      window.removeEventListener("message", ready);
      child.document.body.append(host);
      // ProseMirror's existing selection observer belongs to the original realm.
      // Its view root is updated by ComposerEditor after the move.
      child.document.addEventListener("selectionchange", () => document.dispatchEvent(new Event("selectionchange")));
      child.addEventListener("beforeunload", restore);
      setSurface(child);
      setOpening(false);
      child.focus();
    };
    window.addEventListener("message", ready);
    const timeout = window.setTimeout(() => {
      if (!moved) { restore(); setError("The content window could not be loaded. Your content remains attached."); }
    }, 10000);
    const timer = window.setInterval(() => { if (child.closed) restore(); }, 250);
    pending.current = () => { window.removeEventListener("message", ready); window.clearInterval(timer); window.clearTimeout(timeout); child.removeEventListener("beforeunload", restore); };
  }, [host, focus, restore, windowName]);
  useLayoutEffect(() => {
    slot.current?.append(host);
    return () => { host.remove(); };
  }, [host]);
  useEffect(() => () => { pending.current?.(); external.current?.close(); }, []);
  return { host, slot, surface, detached, opening, error, detach, reattach, focus, windowName };
}

export function DetachablePane({ pane, theme, accent, title, appearance, children }: {
  pane: ReturnType<typeof useDetachablePane>;
  theme: string;
  accent: string;
  title: string;
  appearance?: string;
  children: ReactNode;
}) {
  const { host, surface, detached } = pane;
  useLayoutEffect(() => {
    if (!detached) pane.slot.current?.append(host);
  }, [host, detached, pane.slot]);
  useLayoutEffect(() => {
    host.className = `app-shell content-pane-shell${detached ? " content-pane-detached" : ""}`;
    host.dataset.theme = theme;
    host.dataset.sidebarAppearance = appearance ?? "normal";
    host.style.setProperty("--accent", accent);
    if (detached) surface.document.title = `${title} · Forge`;
  }, [host, surface, detached, theme, accent, title, appearance]);
  return <>
    <div className="content-pane-slot" ref={pane.slot} hidden={detached} />
    {createPortal(<PaneSurfaceContext.Provider value={{ window: surface, document: surface.document, portalRoot: host }}>{children}</PaneSurfaceContext.Provider>, host)}
  </>;
}
