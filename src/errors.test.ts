import { describe, expect, it } from "vitest";
import { AUTO_MERGE_API_UNAVAILABLE_MESSAGE, userFacingError } from "../shared/errors";

describe("error helpers", () => {
  it("strips Electron IPC wrappers from user-facing messages", () => {
    expect(
      userFacingError(
        new Error("Error invoking remote method 'github:update-title': Error: Pull request title cannot be empty."),
        "Fallback"
      )
    ).toBe("Pull request title cannot be empty.");
  });

  it("uses a clear message when GitHub rejects public API auto-merge", () => {
    expect(
      userFacingError(
        new Error(
          "Error invoking remote method 'github:enable-pull-request-auto-merge': GraphqlResponseError: Request failed due to following response errors: - Auto merge is not allowed for this repository"
        ),
        "Unable to enable auto-merge."
      )
    ).toBe(AUTO_MERGE_API_UNAVAILABLE_MESSAGE);
  });
});
