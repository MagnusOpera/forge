import { parse } from "yaml";
import type { WorkflowDispatchConfig, WorkflowDispatchInputSummary, WorkflowDispatchInputType } from "./github.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function inputTypeFor(value: unknown): WorkflowDispatchInputType {
  if (value === "boolean" || value === "choice" || value === "number" || value === "environment") {
    return value;
  }
  return "string";
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function parseDispatchInputs(value: unknown): WorkflowDispatchInputSummary[] {
  const inputs = asRecord(value);
  if (!inputs) {
    return [];
  }

  return Object.entries(inputs).map(([key, definition]) => {
    const record = asRecord(definition);
    return {
      key,
      label: key,
      description: stringValue(record?.description) ?? null,
      required: record?.required === true,
      defaultValue: stringValue(record?.default) ?? null,
      type: inputTypeFor(record?.type),
      options: asStringList(record?.options)
    };
  });
}

function workflowDispatchNode(root: Record<string, unknown>): unknown {
  const onValue = root.on ?? root.true;
  if (Array.isArray(onValue)) {
    return onValue.includes("workflow_dispatch") ? {} : null;
  }

  const onRecord = asRecord(onValue);
  if (!onRecord) {
    return null;
  }

  return onRecord.workflow_dispatch ?? null;
}

export function parseWorkflowDispatchConfig(
  source: string,
  workflowId: number,
  workflowName: string,
  ref: string
): WorkflowDispatchConfig {
  const root = asRecord(parse(source)) ?? {};
  const dispatch = workflowDispatchNode(root);
  const dispatchRecord = asRecord(dispatch);

  return {
    workflowId,
    workflowName,
    ref,
    inputs: parseDispatchInputs(dispatchRecord?.inputs)
  };
}
