import { describe, it, expect } from 'vitest';
import { evaluateWhen, validateWhenSyntax } from '../../src/engine/when-expression.js';
import type { ConductState } from '../../src/types/index.js';

// Minimal state helper
function makeState(overrides: Record<string, unknown> = {}): ConductState {
  return overrides as ConductState;
}

describe('evaluateWhen — Form 1: tier == <literal>', () => {
  it('returns true when tier matches', () => {
    const state = makeState({ complexity_tier: 'L' });
    expect(evaluateWhen('tier == L', state).result).toBe(true);
  });

  it('returns false when tier does not match', () => {
    const state = makeState({ complexity_tier: 'S' });
    expect(evaluateWhen('tier == L', state).result).toBe(false);
  });

  it('returns false when complexity_tier is undefined', () => {
    const state = makeState({});
    expect(evaluateWhen('tier == L', state).result).toBe(false);
  });

  it('handles whitespace around ==', () => {
    const state = makeState({ complexity_tier: 'M' });
    expect(evaluateWhen('tier==M', state).result).toBe(true);
    expect(evaluateWhen('tier  ==  M', state).result).toBe(true);
  });
});

describe('evaluateWhen — Form 2: tier in [...]', () => {
  it('returns true when tier is in the set', () => {
    const state = makeState({ complexity_tier: 'M' });
    expect(evaluateWhen('tier in [M, L]', state).result).toBe(true);
  });

  it('returns true for tier at end of set', () => {
    const state = makeState({ complexity_tier: 'L' });
    expect(evaluateWhen('tier in [M, L]', state).result).toBe(true);
  });

  it('returns false when tier is not in the set', () => {
    const state = makeState({ complexity_tier: 'S' });
    expect(evaluateWhen('tier in [M, L]', state).result).toBe(false);
  });

  it('returns false when complexity_tier is undefined', () => {
    const state = makeState({});
    expect(evaluateWhen('tier in [S, M, L]', state).result).toBe(false);
  });
});

describe('evaluateWhen — Form 3: phase == <literal>', () => {
  it('returns true when current_phase matches', () => {
    const state = makeState({ current_phase: 'BUILD' });
    expect(evaluateWhen('phase == BUILD', state).result).toBe(true);
  });

  it('returns false when current_phase does not match', () => {
    const state = makeState({ current_phase: 'SHIP' });
    expect(evaluateWhen('phase == BUILD', state).result).toBe(false);
  });

  it('returns false with undefinedKey when current_phase not in state', () => {
    const state = makeState({});
    const result = evaluateWhen('phase == BUILD', state);
    expect(result.result).toBe(false);
    expect(result.undefinedKey).toBe('current_phase');
  });
});

describe('evaluateWhen — Form 4: ${key} == value', () => {
  it('returns true when state key matches value', () => {
    const state = makeState({ bootstrap_mode: 'new' });
    expect(evaluateWhen('${bootstrap_mode} == new', state).result).toBe(true);
  });

  it('returns false when state key value does not match', () => {
    const state = makeState({ bootstrap_mode: 'fresh' });
    expect(evaluateWhen('${bootstrap_mode} == new', state).result).toBe(false);
  });

  it('returns false with undefinedKey when key not in state', () => {
    const state = makeState({});
    const result = evaluateWhen('${bootstrap_mode} == new', state);
    expect(result.result).toBe(false);
    expect(result.undefinedKey).toBe('bootstrap_mode');
  });

  it('coerces state value to string for comparison', () => {
    const state = makeState({ some_count: 3 });
    expect(evaluateWhen('${some_count} == 3', state).result).toBe(true);
  });
});

describe('evaluateWhen — Form 5: A && B', () => {
  it('returns true when both operands are true', () => {
    const state = makeState({ complexity_tier: 'L', bootstrap_mode: 're-bootstrap' });
    expect(evaluateWhen('tier == L && ${bootstrap_mode} == re-bootstrap', state).result).toBe(true);
  });

  it('returns false and short-circuits when left is false', () => {
    const state = makeState({ complexity_tier: 'S', bootstrap_mode: 're-bootstrap' });
    const result = evaluateWhen('tier == L && ${bootstrap_mode} == re-bootstrap', state);
    expect(result.result).toBe(false);
  });

  it('returns false when right is false', () => {
    const state = makeState({ complexity_tier: 'L', bootstrap_mode: 'new' });
    expect(evaluateWhen('tier == L && ${bootstrap_mode} == re-bootstrap', state).result).toBe(false);
  });

  it('propagates undefinedKey from right side', () => {
    const state = makeState({ complexity_tier: 'L' });
    const result = evaluateWhen('tier == L && ${bootstrap_mode} == re-bootstrap', state);
    expect(result.result).toBe(false);
    expect(result.undefinedKey).toBe('bootstrap_mode');
  });

  it('works with tier in [...] on the left', () => {
    const state = makeState({ complexity_tier: 'M', bootstrap_mode: 'new' });
    expect(evaluateWhen('tier in [M, L] && ${bootstrap_mode} == new', state).result).toBe(true);
  });
});

describe('evaluateWhen — unknown / malformed expressions', () => {
  it('returns false for completely unknown expression', () => {
    expect(evaluateWhen('foo > bar', makeState({})).result).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(evaluateWhen('', makeState({})).result).toBe(false);
  });
});

describe('validateWhenSyntax', () => {
  it('accepts: tier == L', () => {
    expect(validateWhenSyntax('tier == L')).toBeNull();
  });

  it('accepts: tier in [M, L]', () => {
    expect(validateWhenSyntax('tier in [M, L]')).toBeNull();
  });

  it('accepts: phase == BUILD', () => {
    expect(validateWhenSyntax('phase == BUILD')).toBeNull();
  });

  it('accepts: ${key} == value', () => {
    expect(validateWhenSyntax('${bootstrap_mode} == new')).toBeNull();
  });

  it('accepts: A && B conjunction', () => {
    expect(validateWhenSyntax('tier == L && ${bootstrap_mode} == re-bootstrap')).toBeNull();
  });

  it('accepts: tier in [...] && ${key} == value', () => {
    expect(validateWhenSyntax('tier in [M, L] && phase == SHIP')).toBeNull();
  });

  it('rejects empty expression', () => {
    const err = validateWhenSyntax('');
    expect(err).not.toBeNull();
    expect(err).toMatch(/empty/);
  });

  it('rejects whitespace-only expression', () => {
    const err = validateWhenSyntax('   ');
    expect(err).not.toBeNull();
  });

  it('rejects unknown operator', () => {
    const err = validateWhenSyntax('tier > L');
    expect(err).not.toBeNull();
    expect(err).toMatch(/unsupported/i);
  });

  it('rejects && with missing right operand', () => {
    const err = validateWhenSyntax('tier == L &&');
    expect(err).not.toBeNull();
    expect(err).toMatch(/right-hand/);
  });

  it('rejects && with missing left operand', () => {
    const err = validateWhenSyntax('&& tier == L');
    expect(err).not.toBeNull();
    expect(err).toMatch(/left-hand/);
  });

  it('rejects invalid left side of &&', () => {
    const err = validateWhenSyntax('invalid expr && tier == L');
    expect(err).not.toBeNull();
    expect(err).toMatch(/unsupported/i);
  });
});
