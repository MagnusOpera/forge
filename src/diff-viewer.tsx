import { useLayoutEffect, useRef, type ReactNode } from "react";
import { FileDiff as PierreFileDiff, MultiFileDiff as PierreMultiFileDiff, PatchDiff as PierrePatchDiff, type FileDiffProps, type MultiFileDiffProps, type PatchDiffProps } from "@pierre/diffs/react";
import { usePaneSurface } from "./pane-surface";

let coreCSS: string | undefined;

/** Constructed stylesheets are discarded when a shadow host moves to another document. */
export function preserveDiffStyles(container: HTMLElement): void {
  const viewers = container.querySelectorAll("diffs-container");
  if (!viewers.length) return;
  if (coreCSS === undefined) {
    // The library registers its element in the main realm only. Read its public
    // shadow stylesheet there, including when the actual viewer lives in a portal.
    const probe = document.createElement("diffs-container");
    const sheets = probe.shadowRoot?.adoptedStyleSheets;
    if (!sheets?.length) return;
    coreCSS = Array.from(sheets).flatMap(sheet => Array.from(sheet.cssRules, rule => rule.cssText)).join("\n");
  }
  for (const viewer of viewers) {
    const shadow = viewer.shadowRoot;
    if (!shadow || shadow.querySelector("style[data-forge-diff-layout]")) continue;
    const style = viewer.ownerDocument.createElement("style");
    style.setAttribute("data-forge-diff-layout", "");
    style.textContent = coreCSS;
    shadow.prepend(style);
  }
}

function DiffSurface({ children }: { children: ReactNode }) {
  "use no memo"; // Inspect the library's shadow DOM after its refs have attached.
  const root = useRef<HTMLDivElement>(null);
  const { document: surfaceDocument } = usePaneSurface();
  useLayoutEffect(() => {
    if (root.current) preserveDiffStyles(root.current);
  }, [surfaceDocument]);
  return <div ref={root}>{children}</div>;
}

export function PatchDiff<LAnnotation = undefined, Caret = undefined>(props: PatchDiffProps<LAnnotation, Caret>) {
  return <DiffSurface><PierrePatchDiff {...props} /></DiffSurface>;
}
export function FileDiff<LAnnotation = undefined, Caret = undefined>(props: FileDiffProps<LAnnotation, Caret>) {
  return <DiffSurface><PierreFileDiff {...props} /></DiffSurface>;
}
export function MultiFileDiff<LAnnotation = undefined, Caret = undefined>(props: MultiFileDiffProps<LAnnotation, Caret>) {
  return <DiffSurface><PierreMultiFileDiff {...props} /></DiffSurface>;
}
