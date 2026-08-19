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
  bumpKickbackGate,
  bumpKickbackGateInLedger,
  creditKickbackGateLaps,
  MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW,
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
      JSON.stringify({ version: 2, gates: { wiring_check: { count: 2 } } }),
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
        wiring_check: {
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
      gates: { wiring_check: { ...ledger.gates.wiring_check, cumulative: 0 } },
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

    await expect(readKickbackLedger(dir)).resolves.toEqual({
      ...legacyLedger,
      gates: {
        build_review: {
          ...legacyLedger.gates.build_review,
          cumulative: 0,
        },
      },
    });
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
        wiring_check: {
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
        wiring_check: {
          count: 2,
          cumulative: 1,
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
          wiring_check: { ...legacyWinner.gates.wiring_check, cumulative: 0 },
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
});
