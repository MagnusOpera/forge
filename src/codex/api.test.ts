import { expect, it } from "vitest";
import { errorMessage } from "./api";

it("removes Electron's IPC wrapper while preserving the useful error", () => {
  expect(errorMessage(new Error("Error invoking remote method 'codex:request': Error: Choose a local Git folder.")))
    .toBe("Choose a local Git folder.");
  expect(errorMessage('Error invoking remote method "codex:request": File missing'))
    .toBe("File missing");
});

it("preserves errors without an IPC wrapper", () => {
  expect(errorMessage(new Error("Permission denied"))).toBe("Permission denied");
  expect(errorMessage("A document mentions codex:request")).toBe("A document mentions codex:request");
});
