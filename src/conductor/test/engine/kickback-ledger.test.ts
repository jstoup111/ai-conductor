// Covers: task:1, task:2
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

import { rename } from 'node:fs/promises';
import {
  bumpMechanicalFaults,
  bumpKickbackGate,
  bumpKickbackGateInLedger,
  creditKickbackGateLaps,
  MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW,
  MAX_MECHANICAL_FAULTS_BUILD_REVIEW,
  recordGrowth,
  readGrowth,
  readKickbackLedger,
  writeKickbackLedger,
  type KickbackGateEntry,
  type KickbackLedger,
} from '../../src/engine/kickback-ledger.js';

describe('kickback-ledger', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kickback-ledger-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns an empty ledger when the ledger file is absent', async () => {
    await expect(readKickbackLedger(dir)).resolves.toEqual({ version: 1, gates: {} });
  });

  describe('plan growth', () => {
    it('persists authored and gate-added tasks, then reports the remaining cap', async () => {
      await recordGrowth(dir, {
        authored: 19,
        added: 3,
        byGate: { prd_audit: 3 },
      });

      await expect(readGrowth(dir, 4)).resolves.toEqual({
        authored: 19,
        added: 3,
        byGate: { prd_audit: 3 },
        remaining: 1,
      });
      await expect(readKickbackLedger(dir)).resolves.toMatchObject({
        growth: { authored: 19, added: 3, byGate: { prd_audit: 3 } },
      });
    });

    it('derives authored count from only the recorded active plan, including pre-existing rem tasks', async () => {
      const activePlan = join(dir, '.docs/plans/active.md');
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/engine-state.json'), JSON.stringify({
        activePlanPath: '.docs/plans/active.md',
      }));
      await writeFile(activePlan, [
        '### Task 1: Original work',
        '### Task rem-legacy-1: Pre-existing remediation',
        '### Task 2: More original work',
      ].join('\n'));
      await writeFile(join(dir, '.docs/plans/unrelated.md'), [
        '### Task 1: Wrong plan',
        '### Task 2: Wrong plan',
        '### Task 3: Wrong plan',
        '### Task 4: Wrong plan',
      ].join('\n'));

      await expect(readGrowth(dir, 4)).resolves.toEqual({
        authored: 3,
        added: 0,
        byGate: {},
        remaining: 4,
      });
    });

    it('recomputes and logs an impossible hand-edited growth record', async () => {
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/engine-state.json'), JSON.stringify({
        activePlanPath: '.docs/plans/active.md',
      }));
      await writeFile(join(dir, '.docs/plans/active.md'), [
        '### Task 1: Original work',
        '### Task rem-legacy-1: Pre-existing remediation',
      ].join('\n'));
      await writeFile(join(dir, '.pipeline/kickback-ledger.json'), JSON.stringify({
        version: 1,
        gates: {},
        growth: { authored: 1, added: 4, byGate: { prd_audit: 3 } },
      }));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        await expect(readGrowth(dir, 4)).resolves.toEqual({
          authored: 2,
          added: 0,
          byGate: {},
          remaining: 4,
        });
        await expect(readKickbackLedger(dir)).resolves.toMatchObject({
          growth: { authored: 2, added: 0, byGate: {} },
        });
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('impossible growth record'));
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('emits plan growth through the supplied event-spine sink', async () => {
      const emitted: unknown[] = [];

      await recordGrowth(dir, {
        authored: 19,
        added: 3,
        byGate: { prd_audit: 3 },
      }, {
        cap: 4,
        events: { emit: async (event) => { emitted.push(event); } },
      });

      expect(emitted).toEqual([{
        type: 'plan_growth',
        authored: 19,
        added: 3,
        byGate: { prd_audit: 3 },
        remaining: 1,
      }]);
    });
  });

  it('returns an empty ledger and warns when the ledger JSON is corrupt', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline/kickback-ledger.json'), 'not valid json {');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(readKickbackLedger(dir)).resolves.toEqual({ version: 1, gates: {} });
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('treats a ledger with an unsupported version as absent', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/kickback-ledger.json'),
      JSON.stringify({ version: 2, gates: { test_suite: { count: 2 } } }),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(readKickbackLedger(dir)).resolves.toEqual({ version: 1, gates: {} });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('unsupported ledger version'),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('round-trips populated gate entries', async () => {
    const ledger = {
      version: 1,
      gates: {
        test_suite: {
          count: 2,
          treeHash: '0123456789abcdef0123456789abcdef01234567',
          lastReason: 'production export is orphaned',
          priorVerdict: false,
          resolvedBefore: 7,
        },
      },
    };

    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline/kickback-ledger.json'), JSON.stringify(ledger));

    await expect(readKickbackLedger(dir)).resolves.toEqual({
      ...ledger,
      gates: { test_suite: { ...ledger.gates.test_suite, cumulative: 0, mechanicalFaults: 0 } },
    });
  });

  it('defaults a legacy build review entry without cumulative to zero', async () => {
    const legacyLedger = {
      version: 1,
      gates: {
        build_review: {
          count: 2,
          treeHash: '0123456789abcdef0123456789abcdef01234567',
          lastReason: 'production export is orphaned',
          priorVerdict: false,
          resolvedBefore: 7,
        },
      },
    };

    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline/kickback-ledger.json'), JSON.stringify(legacyLedger));

    const loaded = await readKickbackLedger(dir);
    expect(loaded).toEqual({
      ...legacyLedger,
      gates: {
        build_review: {
          ...legacyLedger.gates.build_review,
          cumulative: 0,
          mechanicalFaults: 0,
        },
      },
    });
  });

  it('preserves absent adjustment history on a legacy cumulative entry', async () => {
    const legacyLedger = {
      version: 1,
      gates: {
        build_review: {
          count: 2,
          cumulative: 4,
          treeHash: '0123456789abcdef0123456789abcdef01234567',
          lastReason: 'legacy semantic failure',
          priorVerdict: false,
          resolvedBefore: 7,
        },
      },
    };

    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline/kickback-ledger.json'), JSON.stringify(legacyLedger));

    const loaded = await readKickbackLedger(dir);
    expect(loaded).toEqual({
      ...legacyLedger,
      gates: {
        build_review: {
          ...legacyLedger.gates.build_review,
          cumulative: 4,
          mechanicalFaults: 0,
        },
      },
    });
    expect(loaded.gates.build_review?.cumulative).toBe(4);
    expect(loaded.gates.build_review?.effectiveLimit ?? MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW).toBe(
      MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW,
    );
    expect(loaded.gates.build_review).not.toHaveProperty('adjustments');
  });

  it('round-trips complete recoverable cumulative-budget state', async () => {
    const ledger: KickbackLedger = {
      version: 1,
      gates: {
        build_review: {
          count: 2,
          cumulative: 6,
          mechanicalFaults: 1,
          treeHash: '0123456789abcdef0123456789abcdef01234567',
          lastReason: 'latest semantic failure',
          priorVerdict: false,
          resolvedBefore: 7,
          effectiveLimit: 8,
          adjustments: [{
            id: 'adjustment-1',
            kind: 'raise',
            beforeCount: 6,
            afterCount: 6,
            beforeLimit: 5,
            afterLimit: 8,
            operator: 'james',
            rationale: 'the review scope expanded',
            at: '2026-08-30T12:00:00.000Z',
          }],
          exhaustedEvidence: {
            gate: 'build_review',
            count: 6,
            limit: 8,
            generation: 'cap-generation-2',
            latestReason: 'latest semantic failure',
          },
          pendingAdjustment: {
            id: 'adjustment-2',
            kind: 'reset',
            beforeCount: 6,
            afterCount: 0,
            beforeLimit: 8,
            afterLimit: 8,
            operator: 'james',
            rationale: 'the review contract was replaced',
            at: '2026-08-30T12:01:00.000Z',
            generation: 'cap-generation-2',
          },
          resumeAuthorization: {
            adjustmentId: 'adjustment-1',
            gate: 'build_review',
            haltClass: 'needs-human',
            generation: 'cap-generation-2',
          },
        },
      },
    };

    await writeKickbackLedger(dir, ledger);

    await expect(readKickbackLedger(dir)).resolves.toEqual(ledger);
  });

  it.each([
    ['blank adjustment identity', { id: ' ', kind: 'reset' }],
    ['unsafe adjustment count', { id: 'adjustment-1', kind: 'reset', beforeCount: Number.MAX_SAFE_INTEGER + 1 }],
    ['non-canonical adjustment timestamp', { id: 'adjustment-1', kind: 'reset', at: '2026-08-30T08:00:00-04:00' }],
    ['extended-year adjustment timestamp', { id: 'adjustment-1', kind: 'reset', at: '+010000-01-01T00:00:00.000Z' }],
  ])('rejects a %s in recoverable budget state', async (_name, invalidAdjustment) => {
    const baseAdjustment = {
      id: 'adjustment-1', kind: 'reset', beforeCount: 6, afterCount: 0,
      beforeLimit: 5, afterLimit: 5, operator: 'james', rationale: 'reason', at: '2026-08-30T12:00:00.000Z',
    };
    const adjustment = {
      ...baseAdjustment,
      ...invalidAdjustment,
    };
    const malformedLedger = {
      version: 1,
      gates: {
        build_review: {
          count: 2,
          cumulative: 6,
          treeHash: null,
          lastReason: 'latest semantic failure',
          priorVerdict: false,
          resolvedBefore: 7,
          adjustments: [adjustment],
        },
      },
    };
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline/kickback-ledger.json'), JSON.stringify(malformedLedger));

    await expect(readKickbackLedger(dir)).resolves.toEqual({ version: 1, gates: {} });
  });

  it('rejects conflicting pending and exhausted generations', async () => {
    const malformedLedger = {
      version: 1,
      gates: {
        build_review: {
          count: 2, cumulative: 6, treeHash: null, lastReason: 'latest semantic failure', priorVerdict: false, resolvedBefore: 7,
          exhaustedEvidence: { gate: 'build_review', count: 6, limit: 5, generation: 'cap-generation-1', latestReason: 'latest semantic failure' },
          pendingAdjustment: {
            id: 'adjustment-1', kind: 'reset', beforeCount: 6, afterCount: 0,
            beforeLimit: 5, afterLimit: 5, operator: 'james', rationale: 'reason', at: '2026-08-30T12:00:00.000Z',
            generation: 'cap-generation-2',
          },
        },
      },
    };
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline/kickback-ledger.json'), JSON.stringify(malformedLedger));

    await expect(readKickbackLedger(dir)).resolves.toEqual({ version: 1, gates: {} });
  });

  it('defaults a legacy build review entry without mechanical faults to zero', async () => {
    const legacyLedger = {
      version: 1,
      gates: {
        build_review: {
          count: 2,
          cumulative: 1,
          treeHash: '0123456789abcdef0123456789abcdef01234567',
          lastReason: 'provider was unavailable',
          priorVerdict: false,
          resolvedBefore: 7,
        },
      },
    };

    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline/kickback-ledger.json'), JSON.stringify(legacyLedger));

    await expect(readKickbackLedger(dir)).resolves.toEqual({
      ...legacyLedger,
      gates: {
        build_review: {
          ...legacyLedger.gates.build_review,
          mechanicalFaults: 0,
        },
      },
    });
  });

  it.each(['3', null, -1, 1.5])('rejects a malformed mechanical-fault count of %j', async (mechanicalFaults) => {
    const malformedLedger = {
      version: 1,
      gates: {
        build_review: {
          count: 2,
          cumulative: 1,
          mechanicalFaults,
          treeHash: '0123456789abcdef0123456789abcdef01234567',
          lastReason: 'provider was unavailable',
          priorVerdict: false,
          resolvedBefore: 7,
        },
      },
    };

    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline/kickback-ledger.json'), JSON.stringify(malformedLedger));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(readKickbackLedger(dir)).resolves.toEqual({ version: 1, gates: {} });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('corrupt ledger'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it.each(['3', null])('rejects a malformed cumulative value of %j', async (cumulative) => {
    const malformedLedger = {
      version: 1,
      gates: {
        build_review: {
          count: 2,
          cumulative,
          treeHash: '0123456789abcdef0123456789abcdef01234567',
          lastReason: 'production export is orphaned',
          priorVerdict: false,
          resolvedBefore: 7,
        },
      },
    };

    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline/kickback-ledger.json'), JSON.stringify(malformedLedger));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(readKickbackLedger(dir)).resolves.toEqual({ version: 1, gates: {} });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('corrupt ledger'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('never leaves a torn ledger for readers during concurrent writes', async () => {
    const legacyWinner = {
      version: 1,
      gates: {
        test_suite: {
          count: 1,
          treeHash: '0000000000000000000000000000000000000000',
          lastReason: 'legacy winner',
          priorVerdict: false,
          resolvedBefore: 0,
        },
      },
    };
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline/kickback-ledger.json'), JSON.stringify(legacyWinner));

    const currentLedger: KickbackLedger = {
      version: 1,
      gates: {
        test_suite: {
          count: 2,
          cumulative: 1,
          mechanicalFaults: 0,
          treeHash: '0000000000000000000000000000000000000001',
          lastReason: 'current writer',
          priorVerdict: false,
          resolvedBefore: 1,
        },
      },
    };
    const originalRename = vi.mocked(rename).getMockImplementation()!;
    let enteredRename!: () => void;
    const renameStarted = new Promise<void>((resolve) => { enteredRename = resolve; });
    let releaseRename!: () => void;
    const releaseGate = new Promise<void>((resolve) => { releaseRename = resolve; });
    vi.mocked(rename).mockImplementationOnce(async (from, to) => {
      enteredRename();
      await releaseGate;
      return originalRename(from, to);
    });

    try {
      const write = writeKickbackLedger(dir, currentLedger);
      await renameStarted;
      const observedDuringWrite = await readKickbackLedger(dir);
      expect(observedDuringWrite).toEqual({
        ...legacyWinner,
        gates: {
          test_suite: {
            ...legacyWinner.gates.test_suite,
            cumulative: 0,
            mechanicalFaults: 0,
          },
        },
      });

      releaseRename();
      await write;
      await expect(readKickbackLedger(dir)).resolves.toEqual(currentLedger);
    } finally {
      vi.mocked(rename).mockImplementation(originalRename);
    }

    const raw = await readFile(join(dir, '.pipeline/kickback-ledger.json'), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  describe('creditKickbackGateLaps', () => {
    it('credits an entry carrying only the cumulative lap count', () => {
      const entry: KickbackGateEntry = {
        count: 2,
        cumulative: 4,
        treeHash: '0123456789abcdef0123456789abcdef01234567',
        lastReason: 'repeated semantic failure',
        priorVerdict: false,
        resolvedBefore: 7,
      };

      expect(creditKickbackGateLaps(entry)).toEqual({ ...entry, cumulative: 0 });
    });

    it('credits the cumulative count and a per-rubric tally together', () => {
      const entry = {
        count: 2,
        cumulative: 4,
        rubricFailures: { tautology: 3, completeness: 1 },
        treeHash: '0123456789abcdef0123456789abcdef01234567',
        lastReason: 'repeated semantic failure',
        priorVerdict: false,
        resolvedBefore: 7,
      } satisfies KickbackGateEntry & { rubricFailures: Record<string, number> };

      expect(creditKickbackGateLaps(entry)).toEqual({
        ...entry,
        cumulative: 0,
        rubricFailures: {},
      });
    });

    it('credits an additional future lap-counting field', () => {
      const entry = {
        count: 2,
        cumulative: 4,
        mechanicalFaultAllowance: 3,
        treeHash: '0123456789abcdef0123456789abcdef01234567',
        lastReason: 'repeated semantic failure',
        priorVerdict: false,
        resolvedBefore: 7,
      } satisfies KickbackGateEntry & { mechanicalFaultAllowance: number };

      expect(creditKickbackGateLaps(entry)).toEqual({
        ...entry,
        cumulative: 0,
        mechanicalFaultAllowance: 0,
      });
    });

    it('leaves the per-tree count untouched while preserving non-lap state', () => {
      const entry = {
        count: 2,
        cumulative: 4,
        rubricFailures: { tautology: 3 },
        treeHash: '0123456789abcdef0123456789abcdef01234567',
        lastReason: 'repeated semantic failure',
        priorVerdict: false,
        resolvedBefore: 7,
      } satisfies KickbackGateEntry & { rubricFailures: Record<string, number> };

      const credited = creditKickbackGateLaps(entry);

      expect(credited.count).toBe(entry.count);
      expect({
        count: credited.count,
        treeHash: credited.treeHash,
        lastReason: credited.lastReason,
        priorVerdict: credited.priorVerdict,
        resolvedBefore: credited.resolvedBefore,
      }).toEqual({
        count: entry.count,
        treeHash: entry.treeHash,
        lastReason: entry.lastReason,
        priorVerdict: entry.priorVerdict,
        resolvedBefore: entry.resolvedBefore,
      });
    });
  });

  describe('bumpKickbackGate', () => {
    const existingEntry: KickbackGateEntry = {
      count: 1,
      cumulative: 0,
      mechanicalFaults: 0,
      treeHash: '0123456789abcdef0123456789abcdef01234567',
      lastReason: 'first failure',
      priorVerdict: false,
      resolvedBefore: 4,
    };

    it('increments the count when the tree and resolved count are unchanged', () => {
      const result = bumpKickbackGate(existingEntry, {
        treeHash: existingEntry.treeHash,
        resolvedCount: existingEntry.resolvedBefore,
        reason: 'different failure wording',
      });

      expect(result).toEqual({
        entry: {
          ...existingEntry,
          count: 2,
          cumulative: 1,
          lastReason: 'different failure wording',
        },
        cumulativeExhausted: false,
        exhausted: false,
      });
    });

    it('increments the cumulative count whether progress resets the per-tree count or not', () => {
      const changedTree = bumpKickbackGate({ ...existingEntry, count: 2, cumulative: 2 }, {
        treeHash: 'fedcba9876543210fedcba9876543210fedcba98',
        resolvedCount: existingEntry.resolvedBefore,
        reason: 'tree moved',
      });
      const unchangedTree = bumpKickbackGate({ ...existingEntry, count: 1, cumulative: 2 }, {
        treeHash: existingEntry.treeHash,
        resolvedCount: existingEntry.resolvedBefore,
        reason: 'still failing',
      });

      expect([changedTree.entry, unchangedTree.entry]).toMatchObject([
        { cumulative: 3, count: 1 },
        { cumulative: 3, count: 2 },
      ]);
    });

    it('keeps cumulative build review failures across distinct trees isolated from test suite bumps', async () => {
      const buildReviewEntries = [] as KickbackGateEntry[];
      for (let index = 0; index < 8; index += 1) {
        const { entry } = await bumpKickbackGateInLedger(dir, 'build_review', {
            treeHash: `${index + 1}`.padStart(40, '0'),
            resolvedCount: existingEntry.resolvedBefore,
            reason: `build review failure ${index + 1}`,
          });
        buildReviewEntries.push(entry);
      }
      await bumpKickbackGateInLedger(dir, 'test_suite', {
        treeHash: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
        resolvedCount: existingEntry.resolvedBefore,
        reason: 'test suite failure',
      });
      const ledger = await readKickbackLedger(dir);

      expect({
        buildReviewCumulative: buildReviewEntries.map(({ cumulative }) => cumulative),
        buildReviewCounts: buildReviewEntries.map(({ count }) => count),
        buildReviewCumulativeAfterTestSuiteBump: ledger.gates.build_review?.cumulative,
        testSuiteCumulative: ledger.gates.test_suite?.cumulative,
      }).toEqual({
        buildReviewCumulative: [1, 2, 3, 4, 5, 6, 7, 8],
        buildReviewCounts: [1, 1, 1, 1, 1, 1, 1, 1],
        buildReviewCumulativeAfterTestSuiteBump: 8,
        testSuiteCumulative: 1,
      });
    });

    it('resets the count to one and stores a changed tree hash', () => {
      const result = bumpKickbackGate({ ...existingEntry, count: 2 }, {
        treeHash: 'fedcba9876543210fedcba9876543210fedcba98',
        resolvedCount: existingEntry.resolvedBefore,
        reason: 'tree moved',
      });

      expect(result).toMatchObject({
        entry: {
          count: 1,
          treeHash: 'fedcba9876543210fedcba9876543210fedcba98',
          lastReason: 'tree moved',
        },
        exhausted: false,
      });
    });

    it('resets the count to one when the resolved count grows on an unchanged tree', () => {
      const result = bumpKickbackGate({ ...existingEntry, count: 2 }, {
        treeHash: existingEntry.treeHash,
        resolvedCount: existingEntry.resolvedBefore + 1,
        reason: 'resolved another task',
      });

      expect(result).toMatchObject({
        entry: {
          count: 1,
          treeHash: existingEntry.treeHash,
          resolvedBefore: existingEntry.resolvedBefore + 1,
        },
        exhausted: false,
      });
    });

    it('reports exhaustion without incrementing beyond the kickback cap', () => {
      const result = bumpKickbackGate({ ...existingEntry, count: 2 }, {
        treeHash: existingEntry.treeHash,
        resolvedCount: existingEntry.resolvedBefore,
        reason: 'still failing',
      });

      expect(result).toMatchObject({
        entry: { count: 2 },
        exhausted: true,
      });
    });

    it('reports cumulative exhaustion only beyond the shared build review cap', () => {
      const atCap = bumpKickbackGate(
        { ...existingEntry, cumulative: MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW - 1 },
        {
          treeHash: 'fedcba9876543210fedcba9876543210fedcba98',
          resolvedCount: existingEntry.resolvedBefore,
          reason: 'another semantic failure',
        },
      );
      const beyondCap = bumpKickbackGate(
        { ...existingEntry, cumulative: MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW },
        {
          treeHash: 'fedcba9876543210fedcba9876543210fedcba98',
          resolvedCount: existingEntry.resolvedBefore,
          reason: 'one semantic failure too many',
        },
      );

      expect({
        cap: MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW,
        atCap: atCap.cumulativeExhausted,
        beyondCap: beyondCap.cumulativeExhausted,
      }).toEqual({ cap: 5, atCap: false, beyondCap: true });
    });
  });

  describe('mechanical-fault allowance', () => {
    const entry: KickbackGateEntry = {
      count: 1,
      cumulative: 2,
      mechanicalFaults: 0,
      treeHash: '0123456789abcdef0123456789abcdef01234567',
      lastReason: 'mechanical fault',
      priorVerdict: true,
      resolvedBefore: 4,
    };

    it('advances once per mechanical lap to its declared ceiling', () => {
      const laps = Array.from({ length: MAX_MECHANICAL_FAULTS_BUILD_REVIEW + 1 }).reduce<KickbackGateEntry>(
        (current) => bumpMechanicalFaults(current),
        entry,
      );

      expect(laps.mechanicalFaults).toBe(MAX_MECHANICAL_FAULTS_BUILD_REVIEW);
    });

    it('does not clear the allowance on PASS and credits it with the other rebase-invalidated lap counts', () => {
      const afterPass = { ...entry, mechanicalFaults: MAX_MECHANICAL_FAULTS_BUILD_REVIEW };

      expect(creditKickbackGateLaps(afterPass)).toEqual({
        ...afterPass,
        cumulative: 0,
        mechanicalFaults: 0,
      });
    });
  });
});
