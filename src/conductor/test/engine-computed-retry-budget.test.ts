/**
 * `wiring_check` is a deprecated no-op whose completion predicate passes
 * unconditionally without dispatching (adr-2026-08-11-deprecated-no-op-step-
 * retirement), so it no longer carries a skill-invocation entry to classify.
 */
import { describe, it, expect } from 'vitest';

import { isEngineComputedStep } from '../src/engine/conductor.js';

describe('isEngineComputedStep — retired wiring_check classification', () => {
  it('does not classify the retired wiring_check no-op, which never dispatches', () => {
    expect(isEngineComputedStep('wiring_check')).toBe(false);
  });
});
