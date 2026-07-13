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

  it('evidence recorded for a stale HEAD sha fails validation (freshness check)', () => {
    const ev = validEvidence();
    // Evidence was recorded at 'head456', but HEAD has since advanced by
    // one commit to 'head789' — a later commit invalidates the wiring
    // analysis and must not be trusted as still-current evidence.
    const result = validateWiringEvidence(ev, 'head789');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('evidence recorded for head456 but HEAD is head789');
    }
  });

  it('evidence recorded for the current HEAD sha passes the freshness check', () => {
    const ev = validEvidence();

    const result = validateWiringEvidence(ev, 'head456');

    expect(result).toEqual({ ok: true });
  });

  it('freshness check is skipped when currentHead is not provided', () => {
    const ev = validEvidence();

    const result = validateWiringEvidence(ev);

    expect(result).toEqual({ ok: true });
  });
});
