import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bumpKickbackGate,
  bumpKickbackGateInLedger,
  readKickbackLedger,
  resetKickbackGateCumulativeInLedger,
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
    const ledger: KickbackLedger = {
      version: 1,
      gates: {
        wiring_check: {
          count: 2,
          cumulative: 0,
          treeHash: '0123456789abcdef0123456789abcdef01234567',
          lastReason: 'production export is orphaned',
          priorVerdict: false,
          resolvedBefore: 7,
        },
      },
    };

    await writeKickbackLedger(dir, ledger);

    await expect(readKickbackLedger(dir)).resolves.toEqual(ledger);
  });

  it('accepts an on-disk gate entry with an initial cumulative count', async () => {
    const ledger: KickbackLedger = {
      version: 1,
      gates: {
        wiring_check: {
          count: 2,
          treeHash: '0123456789abcdef0123456789abcdef01234567',
          lastReason: 'production export is orphaned',
          priorVerdict: false,
          resolvedBefore: 7,
          cumulative: 0,
        },
      },
    };

    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline/kickback-ledger.json'), JSON.stringify(ledger));

    await expect(readKickbackLedger(dir)).resolves.toEqual(ledger);
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
    const ledgers: KickbackLedger[] = Array.from({ length: 10 }, (_, index) => ({
      version: 1,
      gates: {
        wiring_check: {
          count: index + 1,
          cumulative: 0,
          treeHash: `${index}`.padStart(40, '0'),
          lastReason: `attempt ${index + 1}`,
          priorVerdict: false,
          resolvedBefore: index,
        },
      },
    }));

    await Promise.all(ledgers.map((ledger) => writeKickbackLedger(dir, ledger)));

    const raw = await readFile(join(dir, '.pipeline/kickback-ledger.json'), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('resets only build review cumulative failures while retaining its count', async () => {
    const ledger: KickbackLedger = {
      version: 1,
      gates: {
        build_review: {
          count: 2,
          cumulative: 4,
          treeHash: '0123456789abcdef0123456789abcdef01234567',
          lastReason: 'repeated semantic failure',
          priorVerdict: false,
          resolvedBefore: 7,
        },
        test_suite: {
          count: 1,
          cumulative: 3,
          treeHash: 'fedcba9876543210fedcba9876543210fedcba98',
          lastReason: 'unrelated test failure',
          priorVerdict: false,
          resolvedBefore: 6,
        },
      },
    };
    await writeKickbackLedger(dir, ledger);

    await resetKickbackGateCumulativeInLedger(dir, 'build_review');

    await expect(readKickbackLedger(dir)).resolves.toEqual({
      ...ledger,
      gates: {
        ...ledger.gates,
        build_review: { ...ledger.gates.build_review, cumulative: 0 },
      },
    });
  });

  it('treats resetting a missing build review ledger as a no-op', async () => {
    await expect(resetKickbackGateCumulativeInLedger(dir, 'build_review')).resolves.toBeUndefined();

    await expect(readFile(join(dir, '.pipeline/kickback-ledger.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readKickbackLedger(dir)).resolves.toEqual({ version: 1, gates: {} });
  });

  it('does not interrupt a reset when the build review ledger cannot be read', async () => {
    const unreadableLedgerPath = join(dir, '.pipeline/kickback-ledger.json');
    await mkdir(unreadableLedgerPath, { recursive: true });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(resetKickbackGateCumulativeInLedger(dir, 'build_review')).resolves.toBeUndefined();
      await expect(readFile(unreadableLedgerPath)).rejects.toMatchObject({ code: 'EISDIR' });
    } finally {
      warnSpy.mockRestore();
    }
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
  });
});
