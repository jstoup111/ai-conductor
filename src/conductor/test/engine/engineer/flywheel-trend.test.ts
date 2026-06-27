// Test: computeFlywheelTrend — FR-12 trend over store ∩ ledger (Task 16, ADR-006)
//
// Computes the learning-trajectory trend over the features the engineer actually
// AUTHORED (store signals ∩ authored-keys ledger). Non-engineer signals are
// EXCLUDED; ledger-only keys (no store signal) are ABSENT from the result.
//
// Happy path:
//   - >=2 engineer-planned features → per-feature rates + trend direction
//
// Negative paths (each falsifiable):
//   (a) fewer-than-2 engineer-planned features → "insufficient-data" sentinel
//       (NOT "improving" / "regressing")
//   (b) non-engineer signal excluded: a (project,feature) in the store but NOT in
//       the ledger must NOT appear in the trend output
//   (c) ledger key with zero store signals → ABSENT from trend (no zero-rate
//       phantom entry)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeFlywheelTrend,
  type FlywheelTrend,
  type FlywheelTrendInsufficient,
} from '../../../src/engine/engineer/flywheel-trend.js';
import { createEngineerStoreReader } from '../../../src/engine/engineer-store.js';
import type { EngineerSignal } from '../../../src/engine/engineer-store.js';
import type { AuthoredKey } from '../../../src/engine/engineer/authored-ledger.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Build a minimal EngineerSignal. Fields that don't affect rates can be defaults. */
function makeSignal(overrides: Partial<EngineerSignal> & { project: string; feature: string }): EngineerSignal {
  return {
    schemaVersion: 1,
    ts: '2026-06-25T10:00:00.000Z',
    runId: 'run-1',
    outcome: 'done',
    kickbacks: [],
    halts: [],
    retryHotspots: [],
    tokens: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0 },
    durationByStep: {},
    ...overrides,
  };
}

/** Write signals as JSONL lines to the engineer dir. */
async function seedSignals(engineerDir: string, signals: EngineerSignal[]): Promise<void> {
  await mkdir(engineerDir, { recursive: true });
  const lines = signals.map((s) => JSON.stringify(s)).join('\n') + '\n';
  await writeFile(join(engineerDir, 'signals.jsonl'), lines, 'utf-8');
}

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('computeFlywheelTrend', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'flywheel-trend-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ── Happy path: >=2 engineer-planned features → trend direction + per-feature rates ──

  describe('happy path: two features with improving kickback trend', () => {
    // Feature "feat-alpha" (earlier ts): high kickback rate (2 kickbacks / 1 signal)
    // Feature "feat-beta"  (later ts):  low kickback rate  (0 kickbacks / 1 signal)
    // Trend: improving (kickbackRate first > last)

    it('returns a FlywheelTrend with direction "improving" when kickback rate decreases', async () => {
      const sigAlpha = makeSignal({
        project: 'proj-A',
        feature: 'feat-alpha',
        ts: '2026-06-25T08:00:00.000Z',
        kickbacks: [{ from: 'gate', to: 'step', count: 2 }],
      });
      const sigBeta = makeSignal({
        project: 'proj-A',
        feature: 'feat-beta',
        ts: '2026-06-25T12:00:00.000Z',
        kickbacks: [],
      });

      await seedSignals(tempDir, [sigAlpha, sigBeta]);

      const reader = createEngineerStoreReader({ engineerDir: tempDir });
      const ledger: AuthoredKey[] = [
        { project: 'proj-A', feature: 'feat-alpha' },
        { project: 'proj-A', feature: 'feat-beta' },
      ];

      const result = await computeFlywheelTrend(reader, ledger);

      // Must NOT be the insufficient-data sentinel
      expect(result.kind).toBe('trend');
      const trend = result as FlywheelTrend;
      expect(trend.direction).toBe('improving');
    });

    it('includes both features in the per-feature series list', async () => {
      const sigAlpha = makeSignal({
        project: 'proj-A',
        feature: 'feat-alpha',
        ts: '2026-06-25T08:00:00.000Z',
        kickbacks: [{ from: 'gate', to: 'step', count: 2 }],
      });
      const sigBeta = makeSignal({
        project: 'proj-A',
        feature: 'feat-beta',
        ts: '2026-06-25T12:00:00.000Z',
        kickbacks: [],
      });

      await seedSignals(tempDir, [sigAlpha, sigBeta]);

      const reader = createEngineerStoreReader({ engineerDir: tempDir });
      const ledger: AuthoredKey[] = [
        { project: 'proj-A', feature: 'feat-alpha' },
        { project: 'proj-A', feature: 'feat-beta' },
      ];

      const result = await computeFlywheelTrend(reader, ledger);
      const trend = result as FlywheelTrend;

      expect(trend.series).toHaveLength(2);
      const featureNames = trend.series.map((f) => f.feature);
      expect(featureNames).toContain('feat-alpha');
      expect(featureNames).toContain('feat-beta');
    });

    it('orders features chronologically by earliest signal ts (oldest first)', async () => {
      const sigAlpha = makeSignal({
        project: 'proj-A',
        feature: 'feat-alpha',
        ts: '2026-06-25T08:00:00.000Z',
      });
      const sigBeta = makeSignal({
        project: 'proj-A',
        feature: 'feat-beta',
        ts: '2026-06-25T12:00:00.000Z',
      });

      await seedSignals(tempDir, [sigBeta, sigAlpha]); // note: reversed insertion order

      const reader = createEngineerStoreReader({ engineerDir: tempDir });
      const ledger: AuthoredKey[] = [
        { project: 'proj-A', feature: 'feat-alpha' },
        { project: 'proj-A', feature: 'feat-beta' },
      ];

      const result = await computeFlywheelTrend(reader, ledger);
      const trend = result as FlywheelTrend;

      // Oldest signal ts (feat-alpha at 08:00) must come first
      expect(trend.series[0]!.feature).toBe('feat-alpha');
      expect(trend.series[1]!.feature).toBe('feat-beta');
    });

    it('returns direction "regressing" when kickback rate increases first→last', async () => {
      const sigAlpha = makeSignal({
        project: 'proj-R',
        feature: 'feat-first',
        ts: '2026-06-25T08:00:00.000Z',
        kickbacks: [], // low kickback
      });
      const sigBeta = makeSignal({
        project: 'proj-R',
        feature: 'feat-second',
        ts: '2026-06-25T12:00:00.000Z',
        kickbacks: [{ from: 'gate', to: 'step', count: 3 }], // high kickback
      });

      await seedSignals(tempDir, [sigAlpha, sigBeta]);

      const reader = createEngineerStoreReader({ engineerDir: tempDir });
      const ledger: AuthoredKey[] = [
        { project: 'proj-R', feature: 'feat-first' },
        { project: 'proj-R', feature: 'feat-second' },
      ];

      const result = await computeFlywheelTrend(reader, ledger);
      expect(result.kind).toBe('trend');
      expect((result as FlywheelTrend).direction).toBe('regressing');
    });

    it('returns direction "flat" when kickback rates are equal first→last', async () => {
      const sigAlpha = makeSignal({
        project: 'proj-F',
        feature: 'feat-flat-a',
        ts: '2026-06-25T08:00:00.000Z',
        kickbacks: [{ from: 'gate', to: 'step', count: 1 }],
      });
      const sigBeta = makeSignal({
        project: 'proj-F',
        feature: 'feat-flat-b',
        ts: '2026-06-25T12:00:00.000Z',
        kickbacks: [{ from: 'gate', to: 'step', count: 1 }],
      });

      await seedSignals(tempDir, [sigAlpha, sigBeta]);

      const reader = createEngineerStoreReader({ engineerDir: tempDir });
      const ledger: AuthoredKey[] = [
        { project: 'proj-F', feature: 'feat-flat-a' },
        { project: 'proj-F', feature: 'feat-flat-b' },
      ];

      const result = await computeFlywheelTrend(reader, ledger);
      expect(result.kind).toBe('trend');
      expect((result as FlywheelTrend).direction).toBe('flat');
    });

    it('per-feature entry includes kickbackRate from computeSignalRates', async () => {
      const sig = makeSignal({
        project: 'proj-A',
        feature: 'feat-alpha',
        ts: '2026-06-25T08:00:00.000Z',
        kickbacks: [{ from: 'gate', to: 'step', count: 2 }],
      });

      await seedSignals(tempDir, [sig, makeSignal({
        project: 'proj-A',
        feature: 'feat-beta',
        ts: '2026-06-25T12:00:00.000Z',
        kickbacks: [],
      })]);

      const reader = createEngineerStoreReader({ engineerDir: tempDir });
      const ledger: AuthoredKey[] = [
        { project: 'proj-A', feature: 'feat-alpha' },
        { project: 'proj-A', feature: 'feat-beta' },
      ];

      const result = await computeFlywheelTrend(reader, ledger);
      const trend = result as FlywheelTrend;
      const alphaEntry = trend.series.find((f) => f.feature === 'feat-alpha');

      expect(alphaEntry).toBeDefined();
      // 2 kickback events / 1 signal = kickbackRate 2.0
      expect(alphaEntry!.rates.kickbackRate).toBeCloseTo(2.0, 10);
    });
  });

  // ── Negative (a): fewer than 2 engineer-planned features → insufficient-data sentinel ──

  describe('negative (a): fewer than 2 engineer-planned features → insufficient-data sentinel', () => {
    it('returns insufficient-data sentinel (not "improving"/"regressing") when only ONE feature in both store and ledger', async () => {
      // Falsifiable: if the function fabricates a trend direction instead of
      // returning the sentinel, this test fails.
      const sig = makeSignal({
        project: 'proj-X',
        feature: 'feat-only',
        ts: '2026-06-25T10:00:00.000Z',
      });
      await seedSignals(tempDir, [sig]);

      const reader = createEngineerStoreReader({ engineerDir: tempDir });
      const ledger: AuthoredKey[] = [
        { project: 'proj-X', feature: 'feat-only' },
      ];

      const result = await computeFlywheelTrend(reader, ledger);

      // Must be the sentinel — not a fabricated trend
      expect(result.kind).toBe('insufficient-data');
      const sentinel = result as FlywheelTrendInsufficient;
      expect(sentinel.direction).not.toBe('improving');
      expect(sentinel.direction).not.toBe('regressing');
    });

    it('returns insufficient-data sentinel when the store is empty (zero signals)', async () => {
      // Zero signals → zero engineer-planned features even if ledger is non-empty
      await seedSignals(tempDir, []); // empty store

      const reader = createEngineerStoreReader({ engineerDir: tempDir });
      const ledger: AuthoredKey[] = [
        { project: 'proj-Y', feature: 'feat-a' },
        { project: 'proj-Y', feature: 'feat-b' },
      ];

      const result = await computeFlywheelTrend(reader, ledger);
      // No store signals → intersection is empty → <2 → sentinel
      expect(result.kind).toBe('insufficient-data');
    });

    it('returns insufficient-data sentinel when ledger is empty (no authored features)', async () => {
      const sig = makeSignal({
        project: 'proj-Z',
        feature: 'feat-orphan',
        ts: '2026-06-25T10:00:00.000Z',
      });
      await seedSignals(tempDir, [sig]);

      const reader = createEngineerStoreReader({ engineerDir: tempDir });
      const ledger: AuthoredKey[] = []; // no authored keys

      const result = await computeFlywheelTrend(reader, ledger);
      // Intersection is empty → <2 → sentinel
      expect(result.kind).toBe('insufficient-data');
    });
  });

  // ── Negative (b): non-engineer signal excluded from trend ──────────────────────

  describe('negative (b): non-engineer signal excluded from trend output', () => {
    it('excludes a signal whose (project,feature) is in the store but NOT in the ledger', async () => {
      // Falsifiable: if the intersection check is skipped, the non-engineer feature
      // would appear in trend.features — this assertion would then fail.
      const engineerSig = makeSignal({
        project: 'proj-B',
        feature: 'feat-engineer',
        ts: '2026-06-25T08:00:00.000Z',
        kickbacks: [{ from: 'gate', to: 'step', count: 1 }],
      });
      const nonEngineerSig = makeSignal({
        project: 'proj-B',
        feature: 'feat-non-engineer', // NOT in ledger
        ts: '2026-06-25T09:00:00.000Z',
        kickbacks: [],
      });
      const engineerSig2 = makeSignal({
        project: 'proj-B',
        feature: 'feat-engineer-2',
        ts: '2026-06-25T10:00:00.000Z',
        kickbacks: [],
      });

      await seedSignals(tempDir, [engineerSig, nonEngineerSig, engineerSig2]);

      const reader = createEngineerStoreReader({ engineerDir: tempDir });
      // Ledger contains feat-engineer and feat-engineer-2 ONLY — feat-non-engineer is absent
      const ledger: AuthoredKey[] = [
        { project: 'proj-B', feature: 'feat-engineer' },
        { project: 'proj-B', feature: 'feat-engineer-2' },
      ];

      const result = await computeFlywheelTrend(reader, ledger);
      expect(result.kind).toBe('trend');
      const trend = result as FlywheelTrend;

      // The non-engineer feature must NOT appear in the trend output
      const featureNames = trend.series.map((f) => f.feature);
      expect(featureNames).not.toContain('feat-non-engineer');

      // The two engineer features MUST appear
      expect(featureNames).toContain('feat-engineer');
      expect(featureNames).toContain('feat-engineer-2');
    });
  });

  // ── FR-12 (skipped count): malformed entries skipped, not fatal ──────────────

  describe('FR-12: malformed JSONL entries are skipped (not fatal), skipped count surfaced', () => {
    it('returns a valid trend with skipped > 0 when the store contains malformed lines', async () => {
      // Seed: 2 valid signals + 2 malformed lines
      // The valid signals produce a trend; the malformed lines are silently skipped.
      const sig1 = makeSignal({
        project: 'proj-M',
        feature: 'feat-first',
        ts: '2026-06-25T08:00:00.000Z',
        kickbacks: [{ from: 'gate', to: 'step', count: 2 }],
      });
      const sig2 = makeSignal({
        project: 'proj-M',
        feature: 'feat-second',
        ts: '2026-06-25T12:00:00.000Z',
        kickbacks: [],
      });

      await mkdir(tempDir, { recursive: true });
      // Interleave malformed lines among the valid ones
      const lines = [
        JSON.stringify(sig1),
        'NOT_VALID_JSON',
        JSON.stringify(sig2),
        '{"truncated": true', // incomplete JSON
      ].join('\n') + '\n';
      await writeFile(join(tempDir, 'signals.jsonl'), lines, 'utf-8');

      const reader = createEngineerStoreReader({ engineerDir: tempDir });
      const ledger: AuthoredKey[] = [
        { project: 'proj-M', feature: 'feat-first' },
        { project: 'proj-M', feature: 'feat-second' },
      ];

      const result = await computeFlywheelTrend(reader, ledger);

      // Must produce a trend (2 valid signals → 2 features → trend)
      expect(result.kind).toBe('trend');

      // Malformed lines must have been skipped (not fatal) and counted
      expect(result.skipped).toBe(2);

      // The trend direction is derived only from the valid signals
      // sig1: 2 kickbacks / 1 signal = 2.0; sig2: 0 → improving
      expect((result as import('../../../src/engine/engineer/flywheel-trend.js').FlywheelTrend).direction).toBe('improving');
    });

    it('insufficient-data sentinel also carries the skipped count', async () => {
      // Only ONE valid signal + 3 malformed lines → insufficient data
      const sig = makeSignal({
        project: 'proj-N',
        feature: 'feat-only',
        ts: '2026-06-25T10:00:00.000Z',
      });

      await mkdir(tempDir, { recursive: true });
      const lines = [
        JSON.stringify(sig),
        'BAD_LINE_1',
        'BAD_LINE_2',
        'BAD_LINE_3',
      ].join('\n') + '\n';
      await writeFile(join(tempDir, 'signals.jsonl'), lines, 'utf-8');

      const reader = createEngineerStoreReader({ engineerDir: tempDir });
      const ledger: AuthoredKey[] = [
        { project: 'proj-N', feature: 'feat-only' },
      ];

      const result = await computeFlywheelTrend(reader, ledger);

      expect(result.kind).toBe('insufficient-data');
      // Skipped count must be surfaced even in the sentinel shape
      expect(result.skipped).toBe(3);
      // featuresFound = 1 (one valid engineer-planned feature survived)
      expect((result as import('../../../src/engine/engineer/flywheel-trend.js').FlywheelTrendInsufficient).featuresFound).toBe(1);
    });

    it('skipped = 0 when all lines are valid (no false positives)', async () => {
      const sig1 = makeSignal({
        project: 'proj-O',
        feature: 'feat-clean-a',
        ts: '2026-06-25T08:00:00.000Z',
      });
      const sig2 = makeSignal({
        project: 'proj-O',
        feature: 'feat-clean-b',
        ts: '2026-06-25T12:00:00.000Z',
      });

      await seedSignals(tempDir, [sig1, sig2]);

      const reader = createEngineerStoreReader({ engineerDir: tempDir });
      const ledger: AuthoredKey[] = [
        { project: 'proj-O', feature: 'feat-clean-a' },
        { project: 'proj-O', feature: 'feat-clean-b' },
      ];

      const result = await computeFlywheelTrend(reader, ledger);

      expect(result.kind).toBe('trend');
      expect(result.skipped).toBe(0);
    });
  });

  // ── Negative (c): ledger key with zero store signals → absent from trend ────

  describe('negative (c): engineer-planned feature with no store signals is absent from trend', () => {
    it('omits a ledger key that has no matching store signals (no zero-rate phantom)', async () => {
      // Falsifiable: if the implementation fabricates a zero-rate entry for
      // ledger-only keys, the features list would contain 'feat-ghost' — this
      // assertion would then fail.
      const sig1 = makeSignal({
        project: 'proj-C',
        feature: 'feat-real-a',
        ts: '2026-06-25T08:00:00.000Z',
        kickbacks: [{ from: 'gate', to: 'step', count: 1 }],
      });
      const sig2 = makeSignal({
        project: 'proj-C',
        feature: 'feat-real-b',
        ts: '2026-06-25T12:00:00.000Z',
        kickbacks: [],
      });

      // Only seed real-a and real-b; 'feat-ghost' is in the ledger but has NO
      // store signal.
      await seedSignals(tempDir, [sig1, sig2]);

      const reader = createEngineerStoreReader({ engineerDir: tempDir });
      const ledger: AuthoredKey[] = [
        { project: 'proj-C', feature: 'feat-real-a' },
        { project: 'proj-C', feature: 'feat-real-b' },
        { project: 'proj-C', feature: 'feat-ghost' }, // in ledger, NOT in store
      ];

      const result = await computeFlywheelTrend(reader, ledger);
      expect(result.kind).toBe('trend');
      const trend = result as FlywheelTrend;

      const featureNames = trend.series.map((f) => f.feature);

      // feat-ghost must NOT appear (no zero-rate phantom)
      expect(featureNames).not.toContain('feat-ghost');

      // Real features with store signals MUST appear
      expect(featureNames).toContain('feat-real-a');
      expect(featureNames).toContain('feat-real-b');
    });
  });
});
