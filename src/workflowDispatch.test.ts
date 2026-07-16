import { describe, expect, it } from "vitest";
import { parseWorkflowDispatchConfig } from "../shared/workflowDispatch";

describe("workflowDispatch", () => {
  it("parses workflow_dispatch inputs with defaults, required flags, and choices", () => {
    const config = parseWorkflowDispatchConfig(
      `
name: Deploy
on:
  workflow_dispatch:
    inputs:
      environment:
        description: Target environment
        required: true
        type: choice
        options:
          - staging
          - production
      dry_run:
        description: Dry run
        required: false
        default: true
        type: boolean
`,
      42,
      "Deploy",
      "main"
    );

    expect(config).toEqual({
      workflowId: 42,
      workflowName: "Deploy",
      ref: "main",
      inputs: [
        {
          key: "environment",
          label: "environment",
          description: "Target environment",
          required: true,
          defaultValue: null,
          type: "choice",
          options: ["staging", "production"]
        },
        {
          key: "dry_run",
          label: "dry_run",
          description: "Dry run",
          required: false,
          defaultValue: "true",
          type: "boolean",
          options: []
        }
      ]
    });
  });

  it("treats array syntax workflow_dispatch declarations as dispatchable without inputs", () => {
    const config = parseWorkflowDispatchConfig(
      `
name: Build
on:
  - push
  - workflow_dispatch
`,
      99,
      "Build",
      "main"
    );

    expect(config.inputs).toEqual([]);
  });
});
