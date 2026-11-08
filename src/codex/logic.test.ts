import {
  codexQuickActionPrompt,
  codexQuickActionUnavailable,
} from "../../shared/codexActions";
import { describe, expect, it } from "vitest";
import {
  defaultCodexPreferences,
  effectiveCodexPreferences,
  resolveModelPreferences,
  validatePreferences,
  type CodexModel,
} from "../../shared/codex";
import {
  repositorySelectionFocusView,
  adjacentProjectFocusView,
  appKeyboardShortcut,
} from "../appLogic";
import {
  mapModels,
  assertCapabilities,
} from "../../electron/main/codex/client";
import { repositoryIdentity } from "../../shared/github";
import { trustedCodexSenderUrl } from "../../electron/main/codex/validation";
import { turnPolicy } from "../../electron/main/codex/events";
const model: CodexModel = {
  id: "server-default",
  name: "Default",
  efforts: ["low", "high"],
  defaultEffort: "high",
  isDefault: true,
  fast: false,
  images: true,
};
describe("Codex preferences", () => {
  it("inherits each project setting independently, including empty model defaults", () => {
    const global = {
      ...defaultCodexPreferences,
      model: "custom",
      effort: "high",
      speed: "fast" as const,
      mode: "plan" as const,
      followUp: "queue" as const,
      permissions: "full" as const,
    };
    const overrides = { model: "", effort: "", followUp: "steer" as const };
    expect(effectiveCodexPreferences(global, overrides)).toEqual({
      ...global,
      ...overrides,
    });
    expect(effectiveCodexPreferences(global, {})).toEqual(global);
  });
  it("uses server-provided model and effort defaults", () => {
    expect(
      resolveModelPreferences(defaultCodexPreferences, [model]),
    ).toMatchObject({ model: model.id, effort: "high" });
    expect(
      resolveModelPreferences({ ...defaultCodexPreferences, effort: "low" }, [
        model,
      ]).effort,
    ).toBe("low");
  });
  it("rejects unavailable choices rather than silently changing models", () => {
    expect(() =>
      resolveModelPreferences(
        { ...defaultCodexPreferences, model: "missing" },
        [model],
      ),
    ).toThrow("unavailable");
    expect(() =>
      resolveModelPreferences(
        { ...defaultCodexPreferences, effort: "medium" },
        [model],
      ),
    ).toThrow("Effort");
    expect(() =>
      resolveModelPreferences({ ...defaultCodexPreferences, speed: "fast" }, [
        model,
      ]),
    ).toThrow("Fast");
  });
  it("validates settings across IPC", () => {
    expect(validatePreferences(defaultCodexPreferences)).toEqual(
      defaultCodexPreferences,
    );
    expect(validatePreferences({ permissions: "strict" }, true)).toEqual({
      permissions: "strict",
    });
    expect(() =>
      validatePreferences({ permissions: "unrestricted" }, true),
    ).toThrow();
    expect(() => validatePreferences({})).toThrow();
    expect(() => validatePreferences({ mode: 2 }, true)).toThrow();
  });
  it("maps model capabilities and rejects incompatible runtimes", () => {
    expect(
      mapModels({
        data: [
          {
            model: "dynamic",
            displayName: "Dynamic",
            isDefault: true,
            defaultReasoningEffort: "low",
            supportedReasoningEfforts: [{ reasoningEffort: "low" }],
            serviceTiers: [{ id: "fast" }],
            inputModalities: ["text"],
          },
        ],
      }),
    ).toEqual([
      {
        id: "dynamic",
        name: "Dynamic",
        isDefault: true,
        defaultEffort: "low",
        efforts: ["low"],
        fast: true,
        images: false,
      },
    ]);
    expect(() => assertCapabilities("{}")).toThrow("Update Codex CLI");
  });
  it("always restricts Plan even under a full-access project setting", () => {
    expect(
      turnPolicy(
        { ...defaultCodexPreferences, mode: "plan", permissions: "full" },
        "/work",
      ),
    ).toEqual({ approvalPolicy: "never", sandboxPolicy: { type: "readOnly" } });
    expect(turnPolicy(defaultCodexPreferences, "/work")).toMatchObject({
      approvalPolicy: "on-request",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: ["/work"],
        networkAccess: false,
      },
    });
    expect(
      turnPolicy({ ...defaultCodexPreferences, permissions: "strict" }, "/work")
        .approvalPolicy,
    ).toBe("never");
    expect(
      turnPolicy({ ...defaultCodexPreferences, permissions: "full" }, "/work")
        .sandboxPolicy,
    ).toEqual({ type: "dangerFullAccess" });
  });
});
describe("stable project identity", () => {
  it("uses the same identity for REST list rows and GraphQL repository details", () => {
    expect(repositoryIdentity({ id: 123, node_id: "R_123" })).toBe(
      repositoryIdentity({ id: "R_123" }),
    );
  });
});
describe("Codex navigation", () => {
  it("opens favorites in Codex while retaining other selection behavior", () => {
    expect(repositorySelectionFocusView("issues", true)).toBe("codex");
    expect(repositorySelectionFocusView("pull-requests", false)).toBe(
      "pull-requests",
    );
    expect(repositorySelectionFocusView("git", true)).toBe("git");
    expect(adjacentProjectFocusView("codex", 1)).toBe("git");
    expect(
      appKeyboardShortcut({
        metaKey: true,
        ctrlKey: false,
        shiftKey: true,
        altKey: false,
        key: "c",
      }),
    ).toBe("codex");
  });
});

describe("Codex IPC origin boundary", () => {
  it("accepts only the actual renderer entry point", () => {
    expect(trustedCodexSenderUrl("http://127.0.0.1:5173/", false, "/app")).toBe(
      true,
    );
    expect(
      trustedCodexSenderUrl("https://malicious.example/", false, "/app"),
    ).toBe(false);
    expect(
      trustedCodexSenderUrl(
        "http://127.0.0.1:5173/untrusted.html",
        false,
        "/app",
      ),
    ).toBe(false);
    expect(
      trustedCodexSenderUrl(
        "file:///app/dist/renderer/index.html",
        true,
        "/app",
      ),
    ).toBe(true);
    expect(
      trustedCodexSenderUrl("file:///tmp/untrusted.html", true, "/app"),
    ).toBe(false);
  });
});

describe("Codex Git quick actions", () => {
  it("discovers the remote default branch before merging without publishing changes", () => {
    const prompt = codexQuickActionPrompt("sync");
    expect(prompt).toContain(
      "merge the fetched origin/<default-branch> into the current worktree branch without switching branches",
    );
    expect(prompt).toContain(
      "uncommitted changes or an existing merge/rebase in progress",
    );
    expect(prompt).toContain(
      "do not automatically stash, commit, discard changes",
    );
    expect(prompt).toContain(
      "Do not rebase, reset, force-push, push, or create a pull request",
    );
    expect(prompt).toContain("git ls-remote --symref origin HEAD");
    expect(prompt).toContain(
      "Do not assume the branch is named main or master",
    );
    expect(prompt).toContain("stop and report the blocker instead of guessing");
    expect(prompt).not.toContain("origin/main");
  });
  it("provides separate ordinary prompts for commit, push and PR creation", () => {
    expect(codexQuickActionPrompt("commit")).toContain(
      "Do not amend existing commits, push",
    );
    expect(codexQuickActionPrompt("push")).toContain("Do not force-push");
    expect(codexQuickActionPrompt("create-pr")).toContain(
      "Reuse an existing pull request",
    );
    expect(() => codexQuickActionPrompt("invalid" as "commit")).toThrow(
      "Unsupported",
    );
  });
});
