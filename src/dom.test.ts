// @vitest-environment jsdom
import { expect, it } from "vitest";
import { hasOpenKeyboardOverlay, isDomNode, isHtmlElement } from "./dom";
it("recognizes live editor nodes adopted into a detached window and back", () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const editor = document.createElement("div");
  editor.contentEditable = "true";
  const text = document.createTextNode("draft");
  editor.append(text);
  try {
    frame.contentDocument!.body.append(editor);
    expect(editor instanceof frame.contentDocument!.defaultView!.HTMLElement).toBe(false);
    expect(isHtmlElement(editor)).toBe(true);
    expect(isDomNode(text)).toBe(true);
    document.body.append(editor);
    expect(isHtmlElement(editor)).toBe(true);
    expect(isDomNode(text)).toBe(true);
  } finally { editor.remove(); frame.remove(); }
});
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

it("ignores closed native model popovers while blocking visible dialogs", () => {
  const popover = document.createElement("div");
  popover.setAttribute("popover", "auto");
  popover.setAttribute("role", "dialog");
  document.body.append(popover);
  try {
    expect(hasOpenKeyboardOverlay(document)).toBe(false);
    popover.removeAttribute("popover");
    expect(hasOpenKeyboardOverlay(document)).toBe(true);
    popover.hidden = true;
    expect(hasOpenKeyboardOverlay(document)).toBe(false);
  } finally { popover.remove(); }
});
it("ignores overlays hidden by ancestors and checks the owning window", () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  try {
    const doc = frame.contentDocument!;
    doc.body.innerHTML = '<div style="display:none"><div role="alertdialog"></div></div>';
    expect(hasOpenKeyboardOverlay(doc)).toBe(false);
    doc.body.firstElementChild!.removeAttribute("style");
    expect(hasOpenKeyboardOverlay(doc)).toBe(true);
    expect(hasOpenKeyboardOverlay(document)).toBe(false);
  } finally { frame.remove(); }
});
