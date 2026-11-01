// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { ReleaseSummary } from "../shared/github";
import type { ReleaseTab } from "../shared/releases";
import { ReleasesSection } from "./releases";

let root: Root, container: HTMLDivElement;
const releases: ReleaseSummary[] = [
  { id: "old", name: "Old release", tagName: "v1", description: null, isDraft: false, isPrerelease: false, createdAt: "2026-01-01Z", publishedAt: "2026-01-02Z", url: "https://github.com/test/repo/releases/tag/v1" },
  { id: "draft", name: null, tagName: "v3", description: "Draft notes", isDraft: true, isPrerelease: false, createdAt: "2026-03-01Z", publishedAt: null, url: "https://github.com/test/repo/releases/3" },
  { id: "new", name: "New release", tagName: "v2", description: "Notes", isDraft: false, isPrerelease: true, createdAt: "2026-02-01Z", publishedAt: "2026-02-02Z", url: "https://github.com/test/repo/releases/tag/v2" }
];
function Harness({ data = releases }: { data?: ReleaseSummary[] }) {
  const [tab, setTab] = useState<ReleaseTab>("active");
  const [selected, setSelected] = useState<ReleaseSummary>();
  return <><ReleasesSection releases={data} tab={tab} onTab={setTab} selectedId={selected?.id} onSelect={setSelected} /><output>{selected?.id}</output></>;
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it.each(["light", "dark"])("shows sorted published releases, switches drafts and selects with the existing theme: %s", async theme => {
  container.dataset.theme = theme;
  await act(async () => root.render(<Harness />));
  expect([...container.querySelectorAll(".focus-title")].map(node => node.textContent)).toEqual(["Old release"]);
  await act(async () => container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1].click());
  expect([...container.querySelectorAll(".focus-title")].map(node => node.textContent)).toEqual(["New release"]);
  expect(container.textContent).toContain("Pre-release");
  const draftTab = container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[2];
  await act(async () => draftTab.click());
  expect(draftTab.getAttribute("aria-selected")).toBe("true");
  expect([...container.querySelectorAll(".focus-title")].map(node => node.textContent)).toEqual(["v3"]);
  await act(async () => container.querySelector<HTMLButtonElement>(".focus-row")!.click());
  expect(container.querySelector("output")?.textContent).toBe("draft");
  expect(container.querySelector(".focus-row.active")).not.toBeNull();
});
it("has distinct empty states for active, preview, and draft tabs", async () => {
  await act(async () => root.render(<Harness data={[]} />));
  expect(container.textContent).toContain("No active releases");
  await act(async () => container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1].click());
  expect(container.textContent).toContain("No preview releases");
  await act(async () => container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[2].click());
  expect(container.textContent).toContain("No draft releases");
});
