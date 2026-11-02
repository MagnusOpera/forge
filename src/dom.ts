/** DOM objects may belong to the detached content window's JavaScript realm. */
export function isDomNode(value: unknown): value is Node {
  const owner = (value as Node | null)?.ownerDocument?.defaultView;
  return value instanceof Node || Boolean(owner && value instanceof owner.Node);
}
export function isHtmlElement(value: unknown): value is HTMLElement {
  const owner = (value as Node | null)?.ownerDocument?.defaultView;
  // Moving the live pane changes ownerDocument, but retains its original prototypes.
  return value instanceof HTMLElement || Boolean(owner && value instanceof owner.HTMLElement);
}

/** Closed native popovers remain in the DOM with role=dialog; only visible overlays block shortcuts. */
export function hasOpenKeyboardOverlay(document: Document): boolean {
  return [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], .palette-backdrop')].some((overlay) => {
    for (let element: Element | null = overlay; element; element = element.parentElement) {
      if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") return false;
      const style = document.defaultView?.getComputedStyle(element);
      if (style?.display === "none" || style?.visibility === "hidden" || style?.visibility === "collapse" || style?.contentVisibility === "hidden") return false;
    }
    return true;
  });
}
