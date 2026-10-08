// Covers: task:7
import { describe, expect, it } from 'vitest';
import { isEngineComputedStep } from '../../src/engine/step-completion.js';

describe('step completion', () => {
  it('identifies computed engine-native steps without exposing the dispatching set', () => {
    expect(isEngineComputedStep('test_suite')).toBe(true);
    expect(isEngineComputedStep('build_review')).toBe(false);
  });
});
