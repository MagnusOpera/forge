import { expect, it } from "vitest";
import { accentColors, projectAccentColor, type ProjectAccentColors } from "./appearance";

it("resolves project accents independently of the active theme and other projects", () => {
  const overrides: ProjectAccentColors = { forge: accentColors[3], other: accentColors[4] };
  for (const globalAccent of [accentColors[0], accentColors[1]]) {
    expect(projectAccentColor(overrides, "forge", globalAccent)).toBe(accentColors[3]);
    expect(projectAccentColor(overrides, "other", globalAccent)).toBe(accentColors[4]);
    expect(projectAccentColor(overrides, "unset", globalAccent)).toBe(globalAccent);
    expect(projectAccentColor(overrides, undefined, globalAccent)).toBe(globalAccent);
  }
  delete overrides.forge;
  expect(projectAccentColor(overrides, "forge", accentColors[1])).toBe(accentColors[1]);
});

it("ignores invalid persisted project accents", () => {
  expect(projectAccentColor({ forge: "invalid" } as unknown as ProjectAccentColors, "forge", accentColors[0])).toBe(accentColors[0]);
  expect(projectAccentColor(null as unknown as ProjectAccentColors, "forge", accentColors[0])).toBe(accentColors[0]);
});
