// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { RepoSummary } from "../../shared/github";
import { DeliveryBundles } from "./delivery-bundles";

const repo = (owner: string, name: string): RepoSummary => ({
  id: name, owner, name, fullName: `${owner}/${name}`, url: `https://github.com/${owner}/${name}`,
  isPrivate: false, isArchived: false, isFork: false,
});

it("selects repositories across owner groups and keeps selections when searching", async () => {
  const alpha = repo("acme", "alpha");
  const beta = repo("other", "beta");
  const onSave = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  const click = async (label: string) => {
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    expect(button).not.toBeNull();
    await act(async () => button.click());
  };
  const type = async (label: string, value: string) => {
    const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  try {
    await act(async () => root.render(
      <DeliveryBundles bundles={[]} repositories={[beta, alpha]} loading={false}
        onSelect={() => {}} onSave={onSave} onRemove={() => {}} />,
    ));
    await click("New bundle");
    expect([...container.querySelectorAll(".repo-group-name")].map((group) => group.textContent)).toEqual(["acme", "other"]);

    await type("Bundle name", "Release");
    await click("acme/alpha");
    await click("Collapse acme repositories");
    expect(container.querySelector('[aria-label="acme/alpha"]')).toBeNull();

    await type("Search repositories for bundle", "beta");
    expect(container.querySelector(".section-title .count")?.textContent).toBe("1 · 1 selected");
    await click("other/beta");
    await click("Clear search");
    await click("Expand acme repositories");
    expect(container.querySelector('[aria-label="acme/alpha"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[aria-label="other/beta"]')?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    expect(onSave).toHaveBeenCalledWith({ id: expect.any(String), name: "Release", repositories: [alpha, beta] });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
