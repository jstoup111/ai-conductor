/**
 * #982 — engine-computed steps collapsed their retry budget into wasted work.
 *
 * A step that is declared engine-native (skill-invocation.ts) and is never
 * dispatched to an agent has its verdict computed in-process, so re-running it
 * over an unchanged tree is guaranteed to return the identical verdict.
 * Observed on a live daemon: three attempts, identical rejection message,
 * 357ms total (and again at 453ms) before a terminal failure that cost a full
 * build + build_review cycle.
 *
 * An engine-computed step runs once, is judged once, and does not enter the
 * retry loop. `build_review` and `attribution_verify` are also declared
 * engine-native but DO dispatch a one-shot LLM (grader / verifier) whose
 * output can legitimately differ between attempts — they keep the normal
 * budget.
 *
 * `wiring_check` was this rule's original subject. It is now a deprecated
 * no-op whose completion predicate passes unconditionally without dispatching
 * (adr-2026-08-11-deprecated-no-op-step-retirement), so it never reaches the
 * retry loop at all and no longer carries a skill-invocation entry to classify.
 */
import { describe, it, expect } from 'vitest';

import { isEngineComputedStep } from '../src/engine/conductor.js';

describe('isEngineComputedStep — which steps get a budget of one (#982)', () => {
  it('classifies the in-process engine-native steps as engine-computed', () => {
    expect(isEngineComputedStep('test_suite')).toBe(true);
  });

  it('does NOT classify engine-native steps that dispatch a one-shot LLM', () => {
    expect(isEngineComputedStep('build_review')).toBe(false);
    expect(isEngineComputedStep('attribution_verify')).toBe(false);
  });

  it('does NOT classify ordinary skill-dispatched steps', () => {
    expect(isEngineComputedStep('build')).toBe(false);
    expect(isEngineComputedStep('plan')).toBe(false);
  });

  it('does NOT classify the retired wiring_check no-op, which never dispatches', () => {
    expect(isEngineComputedStep('wiring_check')).toBe(false);
  });
});
