import { useLayoutEffect, useRef, useState } from "react";

/** Follow new output only while the reader is at the end of the conversation. */
export function useTranscriptScroll(threadKey: string, items: unknown, requests: unknown) {
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const anchor = useRef<{ top: number; height: number } | null>(null);
  const [away, setAway] = useState(false);
  const jumpToLatest = () => {
    follow.current = true;
    setAway(false);
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  };
  const onScroll = () => {
    const element = scroll.current;
    if (!element) return;
    follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60;
    setAway(!follow.current);
  };
  const preserveHistory = () => {
    const element = scroll.current;
    if (!element) return;
    follow.current = false;
    anchor.current = { top: element.scrollTop, height: element.scrollHeight };
  };
  useLayoutEffect(() => {
    anchor.current = null;
    jumpToLatest();
  }, [threadKey]);
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element) return;
    if (anchor.current) {
      element.scrollTop = anchor.current.top + element.scrollHeight - anchor.current.height;
      anchor.current = null;
      onScroll();
    } else if (follow.current) jumpToLatest();
  }, [items, requests]);
  useLayoutEffect(() => {
    const element = scroll.current;
    const body = content.current;
    // Use the pane's window so this also works in detached conversation windows.
    const Observer = element?.ownerDocument.defaultView?.ResizeObserver;
    if (!element || !body || !Observer) return;
    const observer = new Observer(() => {
      if (follow.current) element.scrollTop = element.scrollHeight;
      else onScroll();
    });
    observer.observe(body);
    observer.observe(element);
    return () => observer.disconnect();
  }, [threadKey, items !== undefined]);
  return { scroll, content, away, onScroll, jumpToLatest, preserveHistory };
}
