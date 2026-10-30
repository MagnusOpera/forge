import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

type SlidingUnderlineVars = CSSProperties &
  Record<"--tab-underline-left" | "--tab-underline-width", string>;

export function useSlidingUnderline(layoutKey: string) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [underlineStyle, setUnderlineStyle] = useState<SlidingUnderlineVars>({
    "--tab-underline-left": "0px",
    "--tab-underline-width": "0px",
  });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    let frame: number | null = null;
    const update = () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }

      frame = window.requestAnimationFrame(() => {
        const active = container.querySelector<HTMLElement>(
          '[data-active-tab="true"]',
        );
        frame = null;
        setUnderlineStyle({
          "--tab-underline-left": active ? `${active.offsetLeft}px` : "0px",
          "--tab-underline-width": active ? `${active.offsetWidth}px` : "0px",
        });
      });
    };

    update();
    const active = container.querySelector<HTMLElement>(
      '[data-active-tab="true"]',
    );
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(container);
    if (active) {
      observer?.observe(active);
    }
    window.addEventListener("resize", update);

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [layoutKey]);

  return { containerRef, underlineStyle };
}
