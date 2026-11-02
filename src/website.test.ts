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
      for (const kind of ["navigation", "detached", "releases"]) {
        expect(document.querySelector(`[data-showcase-image="${kind}"]`)?.getAttribute("src")).toBe(`screenshots/forge-${kind}-dark.png`);
        expect(document.querySelector(`[data-showcase-link="${kind}"]`)?.getAttribute("href")).toBe(`screenshots/forge-${kind}-dark.png`);
      }
      toggle.click();
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(preview.getAttribute("src")).toBe("screenshots/forge-light.png");
      for (const kind of ["navigation", "detached", "releases"]) {
        expect(document.querySelector(`[data-showcase-image="${kind}"]`)?.getAttribute("src")).toBe(`screenshots/forge-${kind}-light.png`);
        expect(document.querySelector(`[data-showcase-link="${kind}"]`)?.getAttribute("href")).toBe(`screenshots/forge-${kind}-light.png`);
      }
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
  it("ships native main and detached window captures in both themes", () => {
    for (const kind of ["navigation", "detached", "releases"]) {
      const sizes = ["dark", "light"].map(theme => {
        const file = `screenshots/forge-${kind}-${theme}.png`;
        const png = readFileSync(path.resolve("website", file));
        expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
        expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(1400);
        expect(png.readUInt32BE(20)).toBe(1840);
        return [png.readUInt32BE(16), png.readUInt32BE(20)];
      });
      expect(sizes[0]).toEqual(sizes[1]);
    }
  });

});

describe("website ignition branding", () => {
  it.each(["index", "install", "documentation", "changelog"])("uses the new logo and icons on %s", page => {
    const html = readFileSync(path.resolve(`website/${page}.html`), "utf8");
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector(".brand img")?.getAttribute("src")).toBe("assets/forge-ignition-128.png?v=2");
    expect(doc.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe("assets/forge-ignition-32.png?v=2");
    expect(doc.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href")).toBe("assets/forge-ignition-180.png?v=2");
  });

  it.each([32, 128, 180])("ships a correctly sized %ipx PNG", size => {
    const png = readFileSync(path.resolve(`website/assets/forge-ignition-${size}.png`));
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size, size]);
  });
});
