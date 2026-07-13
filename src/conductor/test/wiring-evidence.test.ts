import { describe, it, expect } from 'vitest';
import {
  WIRING_EVIDENCE,
  validateWiringEvidence,
  type WiringEvidence,
} from '../src/engine/artifacts.js';

function validEvidence(): WiringEvidence {
  return {
    baseSha: 'base123',
    headSha: 'head456',
    layer2Applicable: true,
    waiverResolutions: [],
    tasks: [
      {
        taskId: '7',
        contractForm: 'declared',
        symbols: [{ symbol: 'doThing', kind: 'no-reference' }],
      },
    ],
  };
}

describe('validateWiringEvidence — validator for wiring-reachability evidence artifacts', () => {
  it('valid evidence object validates ok', () => {
    const ev = validEvidence();

    const result = validateWiringEvidence(ev);

    expect(result).toEqual({ ok: true });
  });

  it('non-object input fails with "not a JSON object" reason naming the path', () => {
    const result = validateWiringEvidence('not an object');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain(WIRING_EVIDENCE);
      expect(result.reason).toContain('not a JSON object');
    }
  });

  it('missing required field (headSha) fails, naming that field', () => {
    const ev = validEvidence() as unknown as Record<string, unknown>;
    delete ev.headSha;

    const result = validateWiringEvidence(ev);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('headSha');
    }
  });

  it('unknown gap kind value fails, naming the bad value', () => {
    const ev = validEvidence() as unknown as {
      tasks: Array<{ symbols: Array<{ kind: string }> }>;
    };
    ev.tasks[0].symbols[0].kind = 'bogus-kind';

    const result = validateWiringEvidence(ev);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('bogus-kind');
    }
  });
});
