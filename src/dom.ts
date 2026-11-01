/** DOM objects may belong to the detached content window's JavaScript realm. */
export function isDomNode(value: unknown): value is Node {
  const owner = (value as Node | null)?.ownerDocument?.defaultView;
  return Boolean(owner && value instanceof owner.Node);
}
export function isHtmlElement(value: unknown): value is HTMLElement {
  const owner = (value as Node | null)?.ownerDocument?.defaultView;
  return Boolean(owner && value instanceof owner.HTMLElement);
}
