// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
// jsdom has no constructed stylesheet support. Model the library's main-realm
// registration while leaving foreign-document elements unregistered.
vi.mock("@pierre/diffs/react", () => {
  customElements.define("diffs-container", class extends HTMLElement {
    constructor() {
      super();
      Object.defineProperty(this.attachShadow({ mode: "open" }), "adoptedStyleSheets", {
        value: [{ cssRules: [{ cssText: "[data-diffs] { display: grid; }" }] }],
      });
    }
  });
  return { FileDiff: () => null, MultiFileDiff: () => null, PatchDiff: () => null };
});
import { preserveDiffStyles } from "./diff-viewer";

it("keeps layout CSS through document adoption and does not duplicate it on reattach", () => {
  const container = document.createElement("div");
  const viewer = document.createElement("diffs-container");
  container.append(viewer);
  preserveDiffStyles(container);
  const style = viewer.shadowRoot!.querySelector("style")!;
  expect(style.textContent).toContain("display: grid");
  const external = document.implementation.createHTMLDocument();
  external.body.append(container);
  preserveDiffStyles(container);
  document.body.append(container);
  preserveDiffStyles(container);
  expect(viewer.shadowRoot!.querySelectorAll("style")).toHaveLength(1);
  expect(viewer.shadowRoot!.querySelector("style")).toBe(style);
  container.remove();
});

it("styles diffs opened directly in a foreign document without the library's element registration", () => {
  const external = document.implementation.createHTMLDocument();
  const container = external.createElement("div");
  const viewer = external.createElement("diffs-container");
  const shadow = viewer.attachShadow({ mode: "open" });
  shadow.innerHTML = '<pre data-diffs>changed code</pre>';
  container.append(viewer);
  preserveDiffStyles(container);
  expect(shadow.querySelector("style")?.textContent).toContain("display: grid");
  expect(shadow.querySelector("pre")?.textContent).toBe("changed code");
});
