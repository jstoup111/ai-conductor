import { describe, it, expect } from 'vitest';
import type { StepName } from '../src/types/steps.js';
import { DEFAULT_STEP_MODELS } from '../src/engine/resolved-config.js';
import { STEP_RATIONALE } from '../src/engine/model-table-metadata.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED/GREEN specs for STEP_RATIONALE metadata (.docs/stories/generated-model-table.md,
// TS-1 happy path 1; negative path 1 — compile-time enforcement).
// ─────────────────────────────────────────────────────────────────────────────

describe('STEP_RATIONALE completeness (TS-1)', () => {
  it('has a non-empty rationale entry for every key in DEFAULT_STEP_MODELS', () => {
    const missing: string[] = [];
    const empty: string[] = [];

    for (const step of Object.keys(DEFAULT_STEP_MODELS) as StepName[]) {
      if (!(step in STEP_RATIONALE)) {
        missing.push(step);
        continue;
      }
      if (STEP_RATIONALE[step].trim().length === 0) {
        empty.push(step);
      }
    }

    expect(missing).toEqual([]);
    expect(empty).toEqual([]);
  });

  it('type-checks as a complete Record<StepName, string>', () => {
    // Compile-time assertion: if STEP_RATIONALE were missing a key or had a
    // non-string value, this would fail to typecheck.
    const typed = STEP_RATIONALE satisfies Record<StepName, string>;
    expect(typed).toBe(STEP_RATIONALE);
  });
});

// Type-level negative fixture: a rationale record missing a required key must
// fail to typecheck against Record<StepName, string>. Not executed — this
// file is only meaningful to `tsc`/`vitest --typecheck`.
function _typeFixture() {
  const incomplete = {
    bootstrap: 'x',
    memory: 'x',
    assess: 'x',
    explore: 'x',
    prd: 'x',
    complexity: 'x',
    stories: 'x',
    conflict_check: 'x',
    plan: 'x',
    architecture_diagram: 'x',
    architecture_review: 'x',
    worktree: 'x',
    acceptance_specs: 'x',
    build: 'x',
    manual_test: 'x',
    prd_audit: 'x',
    architecture_review_as_built: 'x',
    retro: 'x',
    rebase: 'x',
    finish: 'x',
    // 'remediate' intentionally omitted
  };
  // @ts-expect-error missing required key "remediate" must fail typecheck
  const shouldFail = incomplete satisfies Record<StepName, string>;
  return shouldFail;
}
