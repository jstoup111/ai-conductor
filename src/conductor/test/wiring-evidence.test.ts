import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
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
    schema: 1,
    base: 'base123',
    head: 'head456',
    layer2: { applicable: true },
    waivers: [],
    tasks: [
      {
        id: '7',
        contract: 'src/x.ts#doThing',
        gaps: [{ kind: 'no-reference', message: 'doThing has no non-test reference' }],
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

  it('missing required field (head) fails, naming that field', () => {
    const ev = validEvidence() as unknown as Record<string, unknown>;
    delete ev.head;

    const result = validateWiringEvidence(ev);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('head');
    }
  });

  it('unknown gap kind value fails, naming the bad value', () => {
    const ev = validEvidence() as unknown as {
      tasks: Array<{ gaps: Array<{ kind: string }> }>;
    };
    ev.tasks[0].gaps[0].kind = 'bogus-kind';

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
      schema: 1,
      base: 'base123',
      head: 'head456',
      layer2: { applicable: true },
      waivers: [],
      tasks: [
        { id: '1', contract: 'src/x.ts#foo', gaps: [] },
        { id: '2', contract: 'none (no new production surface)', gaps: [] },
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
      schema: 1,
      base: 'base123',
      head: 'head456',
      layer2: { applicable: true },
      waivers: [],
      tasks: [
        {
          id: '7',
          contract: 'src/x.ts#doThing',
          gaps: [{ kind: 'no-reference', message: gapMessage }],
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

  it('missing evidence file is unsatisfied, fail-closed, with a named reason', async () => {
    const predicate = CUSTOM_COMPLETION_PREDICATES.wiring_check!;
    const result = await predicate(dir, { getHeadSha: async () => 'head456' });

    expect(result.done).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain('wiring evidence not found');
  });

  it('missing evidence file with a wiringProbe injected computes evidence live and persists it to .pipeline/wiring-evidence.json', async () => {
    const computed: WiringEvidence = {
      schema: 1,
      base: 'base123',
      head: 'head456',
      layer2: { applicable: true },
      waivers: [],
      tasks: [{ id: '1', contract: 'src/x.ts#foo', gaps: [] }],
    };
    const predicate = CUSTOM_COMPLETION_PREDICATES.wiring_check!;

    const result = await predicate(dir, {
      getHeadSha: async () => 'head456',
      wiringProbe: async () => computed,
    });

    expect(result.done).toBe(true);
    const written = JSON.parse(await readFile(join(dir, WIRING_EVIDENCE), 'utf-8'));
    expect(written).toEqual(computed);
  });

  it('wiringProbe throwing is unsatisfied with a reason naming the probe failure', async () => {
    const predicate = CUSTOM_COMPLETION_PREDICATES.wiring_check!;

    const result = await predicate(dir, {
      getHeadSha: async () => 'head456',
      wiringProbe: async () => {
        throw new Error('probe boom');
      },
    });

    expect(result.done).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain('wiring probe failed: probe boom');
  });

  it('stale evidence (recorded head != current head) with a wiringProbe injected re-derives fresh evidence instead of failing closed', async () => {
    const staleEvidence: WiringEvidence = {
      schema: 1,
      base: 'base123',
      head: 'H1',
      layer2: { applicable: true },
      waivers: [],
      tasks: [{ id: '1', contract: 'src/x.ts#foo', gaps: [] }],
    };
    await writeEvidence(staleEvidence);

    const freshEvidence: WiringEvidence = {
      schema: 1,
      base: 'base123',
      head: 'H2',
      layer2: { applicable: true },
      waivers: [],
      tasks: [{ id: '1', contract: 'src/x.ts#foo', gaps: [] }],
    };

    const predicate = CUSTOM_COMPLETION_PREDICATES.wiring_check!;
    const result = await predicate(dir, {
      getHeadSha: async () => 'H2',
      wiringProbe: async () => freshEvidence,
    });

    expect(result.done).toBe(true);
    if (result.reason) {
      expect(result.reason).not.toMatch(/stale/i);
    }

    const written = JSON.parse(await readFile(join(dir, WIRING_EVIDENCE), 'utf-8'));
    expect(written.head).toBe('H2');
  });

  it('stale evidence re-derived into a fresh verdict with gaps surfaces the gap message verbatim, not as staleness', async () => {
    const staleEvidence: WiringEvidence = {
      schema: 1,
      base: 'base123',
      head: 'H1',
      layer2: { applicable: true },
      waivers: [],
      tasks: [{ id: '1', contract: 'src/x.ts#foo', gaps: [] }],
    };
    await writeEvidence(staleEvidence);

    const gapMessage = 'someExport has no non-test reference';
    const freshEvidence: WiringEvidence = {
      schema: 1,
      base: 'base123',
      head: 'H2',
      layer2: { applicable: true },
      waivers: [],
      tasks: [
        {
          id: '1',
          contract: 'src/x.ts#someExport',
          gaps: [{ kind: 'no-reference', message: gapMessage }],
        },
      ],
    };

    const predicate = CUSTOM_COMPLETION_PREDICATES.wiring_check!;
    const result = await predicate(dir, {
      getHeadSha: async () => 'H2',
      wiringProbe: async () => freshEvidence,
    });

    expect(result.done).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain(gapMessage);
    expect(result.reason).not.toMatch(/stale/i);
  });
});
