import { expect, it } from "vitest";
import { contentPaneWindowBounds, contentPaneWindowFeatures } from "../shared/content-window";

it("maps a pane's viewport bounds to screen position and size at the current zoom", () => {
  const features = contentPaneWindowFeatures({ x: 675, y: 0, width: 600, height: 800 });
  expect(contentPaneWindowBounds(features, { x: 100, y: 50, width: 1440, height: 920 }, 1.1))
    .toEqual({ x: 843, y: 50, width: 660, height: 880 });
});
it("keeps negative monitor coordinates and rounds shared pane edges consistently", () => {
  const features = contentPaneWindowFeatures({ x: 580.5, y: 20.25, width: 400.25, height: 600.5 });
  expect(contentPaneWindowBounds(features, { x: -1440, y: -200, width: 1440, height: 1000 }, 1.25))
    .toEqual({ x: -714, y: -175, width: 500, height: 751 });
});
it("retains a narrow pane's actual size rather than enforcing a larger detached window", () => {
  expect(contentPaneWindowBounds(contentPaneWindowFeatures({ x: 740, y: 0, width: 240, height: 400 }), { x: 0, y: 0, width: 980, height: 400 }, 1))
    .toEqual({ x: 740, y: 0, width: 240, height: 400 });
});
it("rejects missing, malformed and out-of-viewport geometry", () => {
  const owner = { x: 10, y: 20, width: 1440, height: 920 };
  for (const features of ["popup", "forgepanex=1", ...[
    { x: -1, y: 0, width: 400, height: 700 },
    { x: 700, y: 0, width: 900, height: 700 },
    { x: 700, y: 0, width: 400, height: 1000 },
    { x: 700, y: 0, width: 0, height: 700 },
    { x: NaN, y: 0, width: 400, height: 700 },
  ].map(contentPaneWindowFeatures)]) expect(contentPaneWindowBounds(features, owner, 1)).toBeNull();
  expect(contentPaneWindowBounds(contentPaneWindowFeatures({ x: 0, y: 0, width: 400, height: 700 }), owner, Infinity)).toBeNull();
});
