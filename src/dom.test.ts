// @vitest-environment jsdom
import { expect, it } from "vitest";
import { isDomNode, isHtmlElement } from "./dom";
it("recognizes controls from another window so typing and focus guards still work", () => {
  const frame = document.createElement("iframe");document.body.append(frame);
  try {
    const input = frame.contentDocument!.createElement("textarea");
    expect(input instanceof HTMLElement).toBe(false);
    expect(isHtmlElement(input)).toBe(true);expect(isDomNode(input)).toBe(true);
    expect(isHtmlElement(document.createElement("button"))).toBe(true);
    expect(isHtmlElement(null)).toBe(false);expect(isDomNode(window)).toBe(false);
    expect(isHtmlElement(frame.contentDocument!.createTextNode("text"))).toBe(false);
  } finally { frame.remove(); }
});
