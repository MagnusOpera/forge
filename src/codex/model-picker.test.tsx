import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelPicker, selectComposerModel } from "./model-picker";
import { defaultCodexPreferences, type CodexModel } from "../../shared/codex";
const models: CodexModel[] = [
  {
    id: "sol",
    name: "GPT-6.1 Sol",
    efforts: ["low", "medium", "high"],
    defaultEffort: "medium",
    isDefault: true,
    fast: true,
    images: true,
  },
  {
    id: "other",
    name: "Other",
    efforts: ["high"],
    defaultEffort: "high",
    isDefault: false,
    fast: false,
    images: false,
  },
];
describe("Compact Codex model picker", () => {
  it("keeps project behavior and permissions while reconciling model capabilities", () => {
    const value = {
      ...defaultCodexPreferences,
      model: "sol",
      effort: "medium",
      speed: "fast" as const,
      mode: "plan" as const,
      followUp: "queue" as const,
      permissions: "strict" as const,
    };
    expect(selectComposerModel(value, models[1], "other")).toEqual({
      ...value,
      model: "other",
      effort: "",
      speed: "normal",
    });
    expect(
      selectComposerModel({ ...value, effort: "high" }, models[1], "other")
        .effort,
    ).toBe("high");
    expect(selectComposerModel(value, models[0], "")).toEqual({
      ...value,
      model: "",
    });
  });
  it("renders one compact trigger with a supported-effort slider and no mode or follow-up fields", () => {
    const html = renderToStaticMarkup(
      <ModelPicker
        value={{ ...defaultCodexPreferences, model: "sol" }}
        models={models}
        disabled={false}
        onChange={() => {}}
      />,
    );
    expect(html).toContain('popover="auto"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('type="range"');
    expect(html).toContain('aria-valuetext="Medium"');
    expect(html).toContain('max="2"');
    expect(html).toContain('aria-label="Fast speed"');
    expect(html).not.toContain("<select");
    expect(html).toContain("codex-effort-track");
    expect(html).toContain("codex-effort-fill");
    expect(html).not.toContain('aria-label="Mode"');
    expect(html).not.toContain("Follow-up");
  });
  it("preserves unavailable model labels and disables changes when busy", () => {
    const html = renderToStaticMarkup(
      <ModelPicker
        value={{
          ...defaultCodexPreferences,
          model: "missing",
          effort: "ultra",
        }}
        models={models}
        disabled={true}
        onChange={() => {}}
      />,
    );
    expect(html).toContain("missing (unavailable)");
    expect(html).toContain('aria-valuetext="Ultra"');
    expect(html).toContain('disabled=""');
  });
  it("uses a filled lightning bolt only when fast speed is selected", () => {
    const render = (speed: "normal" | "fast") =>
      renderToStaticMarkup(
        <ModelPicker
          value={{ ...defaultCodexPreferences, model: "sol", speed }}
          models={models}
          disabled={false}
          onChange={() => {}}
        />,
      );
    expect(render("fast")).toContain('fill="currentColor"');
    expect(render("normal")).not.toContain('fill="currentColor"');
  });
});
