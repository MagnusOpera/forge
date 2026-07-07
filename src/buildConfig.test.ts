import { describe, expect, it } from "vitest";
import viteConfig from "../vite.config";

describe("viteConfig", () => {
  it("emits relative asset paths for packaged Electron file URLs", () => {
    expect(viteConfig).toMatchObject({ base: "./" });
  });
});
