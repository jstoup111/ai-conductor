import { describe, expect, it, vi } from "vitest";
import {
  classifyBuildReviewRubricBranches,
  type BuildReviewCoordinatorHooks,
} from "../../src/engine/build-review-coordinator.js";
import type { ResolvedBuildReviewConfig } from "../../src/engine/resolved-config.js";

function config(overrides: Partial<ResolvedBuildReviewConfig> = {}): ResolvedBuildReviewConfig {
  const policy = {
    enabled: true,
    llm_provider: "claude" as const,
    model: "sonnet",
    effort: "medium" as const,
    model_fallback_ladder: ["sonnet"],
    max_retries: 1,
    escalate: false,
  };
  return {
    enabled: true,
    perTaskFloor: true,
    scopeContainmentEnforced: false,
    maxParallel: 5,
    rubrics: {
      tautology: policy,
      scope: policy,
      rootCause: policy,
      completeness: policy,
      wiring: policy,
    },
    ...overrides,
  };
}

describe("build-review coordinator: pre-dispatch classification", () => {
  it("classifies disabled and Wiring-only missing-entry-point branches before any cache or model call", () => {
    const resolved = config({
      rubrics: {
        ...config().rubrics,
        tautology: { ...config().rubrics.tautology, enabled: false },
      },
    });
    const hooks: BuildReviewCoordinatorHooks = {
      lookupCache: vi.fn(),
      dispatchModel: vi.fn(),
    };

    expect(classifyBuildReviewRubricBranches(resolved, [], hooks)).toEqual({
      kind: "ready",
      branches: [
        { kind: "skipped", rubric: "tautology", reason: "disabled" },
        { rubric: "scope", skillName: "build-review-scope", policy: resolved.rubrics.scope },
        { rubric: "rootCause", skillName: "build-review-root-cause", policy: resolved.rubrics.rootCause },
        { rubric: "completeness", skillName: "build-review-completeness", policy: resolved.rubrics.completeness },
        { kind: "skipped", rubric: "wiring", reason: "missing-entry-points" },
      ],
    });
    expect(hooks.lookupCache).not.toHaveBeenCalled();
    expect(hooks.dispatchModel).not.toHaveBeenCalled();
  });

  it("refuses an enabled gate whose every rubric is disabled instead of passing an empty lap", () => {
    const disabled = { ...config().rubrics };
    for (const rubric of Object.keys(disabled) as Array<keyof typeof disabled>) {
      disabled[rubric] = { ...disabled[rubric], enabled: false };
    }

    expect(classifyBuildReviewRubricBranches(config({ rubrics: disabled }), ["src/index.ts"])).toEqual({
      kind: "refused",
      reason: "no-enabled-rubrics",
    });
  });

  it("returns a disabled gate result without creating a synthetic successful branch", () => {
    expect(classifyBuildReviewRubricBranches(config({ enabled: false }), ["src/index.ts"])).toEqual({
      kind: "gate-disabled",
    });
  });
});
