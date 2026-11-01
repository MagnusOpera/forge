// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const homepage = readFileSync(path.resolve("website/index.html"), "utf8");
const siteScript = readFileSync(path.resolve("website/site.js"), "utf8");

describe("homepage Codex previews", () => {
  it("switches between the bundled dark and light screenshots with the theme control", () => {
    document.documentElement.innerHTML = homepage;
    localStorage.clear();
    try {
      window.eval(siteScript);
      const preview = document.querySelector<HTMLImageElement>("[data-preview-image]")!;
      const toggle = document.querySelector<HTMLButtonElement>("[data-theme-toggle]")!;
      expect(preview.getAttribute("src")).toBe("screenshots/forge-dark.png");
      expect(document.querySelector("[data-preview-theme]")?.textContent).toBe("dark");
      toggle.click();
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(preview.getAttribute("src")).toBe("screenshots/forge-light.png");
      expect(document.querySelector("[data-preview-theme]")?.textContent).toBe("light");
      expect(toggle.getAttribute("aria-label")).toBe("Switch to light theme");
      toggle.click();
      expect(preview.getAttribute("src")).toBe("screenshots/forge-dark.png");
      expect(preview.alt).toContain("Codex");
    } finally {
      document.documentElement.innerHTML = "";
      localStorage.clear();
    }
  });

  it("ships matching, high-resolution PNG previews for both themes", () => {
    const sizes = ["dark", "light"].map(theme => {
      const png = readFileSync(path.resolve(`website/screenshots/forge-${theme}.png`));
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      const width = png.readUInt32BE(16);
      const height = png.readUInt32BE(20);
      expect(width).toBeGreaterThanOrEqual(1512);
      expect(width / height).toBeCloseTo(1440 / 920, 2);
      return [width, height];
    });
    expect(sizes[0]).toEqual(sizes[1]);
    const styles = readFileSync(path.resolve("website/styles.css"), "utf8");
    expect(styles).toContain("aspect-ratio: 1440 / 920;");
  });
});
