import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  WIRING_EVIDENCE,
  validateWiringEvidence,
  CUSTOM_COMPLETION_PREDICATES,
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

describe('CUSTOM_COMPLETION_PREDICATES.wiring_check — wiring_check step completion gate', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wiring-check-'));
    await mkdir(join(dir, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeEvidence(ev: unknown): Promise<void> {
    await writeFile(join(dir, WIRING_EVIDENCE), JSON.stringify(ev, null, 2), 'utf-8');
  }

  it('valid, fresh evidence with zero gaps across all tasks is satisfied', async () => {
    const ev: WiringEvidence = {
      baseSha: 'base123',
      headSha: 'head456',
      layer2Applicable: true,
      waiverResolutions: [],
      tasks: [
        { taskId: '1', contractForm: 'declared', symbols: [] },
        { taskId: '2', contractForm: 'none_no_surface', symbols: [] },
      ],
    };
    await writeEvidence(ev);

    const predicate = CUSTOM_COMPLETION_PREDICATES.wiring_check!;
    const result = await predicate(dir, { getHeadSha: async () => 'head456' });

    expect(result.done).toBe(true);
  });

  it('evidence with at least one gap is unsatisfied and the kickback reason carries the gap message verbatim', async () => {
    const gapMessage = 'symbol "doThing" has no-reference — task 7 never wires it into a reachable surface';
    const ev = {
      baseSha: 'base123',
      headSha: 'head456',
      layer2Applicable: true,
      waiverResolutions: [],
      tasks: [
        {
          taskId: '7',
          contractForm: 'declared',
          symbols: [{ symbol: 'doThing', kind: 'no-reference', message: gapMessage }],
        },
      ],
    };
    await writeEvidence(ev);

    const predicate = CUSTOM_COMPLETION_PREDICATES.wiring_check!;
    const result = await predicate(dir, { getHeadSha: async () => 'head456' });

    expect(result.done).toBe(false);
    expect(result.reason).toBeDefined();
    // The fixture's real, specific gap message (as computed by wiring-probe.ts's
    // gap-producing functions) must appear verbatim in the kickback reason —
    // not just have its taskId/symbol/kind substrings present.
    expect(result.reason).toContain(gapMessage);
  });

  it('gap without a message field falls back to a synthesized description naming task/symbol/kind', async () => {
    const ev = {
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
    await writeEvidence(ev);

    const predicate = CUSTOM_COMPLETION_PREDICATES.wiring_check!;
    const result = await predicate(dir, { getHeadSha: async () => 'head456' });

    expect(result.done).toBe(false);
    expect(result.reason).toContain('doThing');
    expect(result.reason).toContain('no-reference');
    expect(result.reason).toContain('7');
  });

  it('missing evidence file is unsatisfied, fail-closed, with a named reason', async () => {
    const predicate = CUSTOM_COMPLETION_PREDICATES.wiring_check!;
    const result = await predicate(dir, { getHeadSha: async () => 'head456' });

    expect(result.done).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain('wiring evidence not found');
  });
});
