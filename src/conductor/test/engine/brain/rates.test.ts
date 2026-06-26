// Test: computeSignalRates — shared canonical metric-rate function (Task 8, FR-9+FR-12, ADR-006)
import { describe, it, expect } from 'vitest';
import { computeSignalRates } from '../../../src/engine/brain/rates.js';
import type { SignalRates } from '../../../src/engine/brain/rates.js';
import type { BrainSignal } from '../../../src/engine/brain-store.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeSignal(overrides: Partial<BrainSignal> = {}): BrainSignal {
  return {
    schemaVersion: 1,
    ts: '2026-06-25T00:00:00.000Z',
    project: 'proj',
    feature: 'feat',
    runId: 'run-1',
    outcome: 'done',
    kickbacks: [],
    halts: [],
    retryHotspots: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    durationByStep: {},
    ...overrides,
  };
}

// 3 signals with hand-computable values:
//
//  sig1: 1 kickback (count=2), 0 halts, 2 retries (retryHotspot count=2)
//        tokens: { input: 100, output: 50, cacheRead: 10, cacheCreation: 5 }
//
//  sig2: 1 kickback (count=1), 1 halt, 1 retry (retryHotspot count=1)
//        tokens: { input: 200, output: 100, cacheRead: 20, cacheCreation: 10 }
//
//  sig3: 0 kickbacks, 0 halts, 0 retries
//        tokens: { input: 300, output: 150, cacheRead: 30, cacheCreation: 15 }
//
//  Totals:
//    totalSignals = 3
//    totalKickbacks = 2 + 1 = 3   → kickbackRate = 3/3 = 1.0
//    totalHalts    = 0 + 1 = 1    → haltRate     = 1/3 ≈ 0.333...
//    totalRetries  = 2 + 1 = 3    → retryRate    = 3/3 = 1.0
//    tokens.input       = 100 + 200 + 300 = 600
//    tokens.output      = 50  + 100 + 150 = 300
//    tokens.cacheRead   = 10  + 20  + 30  = 60
//    tokens.cacheCreation = 5 + 10  + 15  = 30

const sig1 = makeSignal({
  runId: 'run-1',
  kickbacks: [{ from: 'gate', to: 'step-a', count: 2 }],
  halts: [],
  retryHotspots: [{ step: 'step-a', count: 2, topReason: 'test-fail' }],
  tokens: { input: 100, output: 50, cacheRead: 10, cacheCreation: 5 },
});

const sig2 = makeSignal({
  runId: 'run-2',
  outcome: 'halted',
  kickbacks: [{ from: 'gate', to: 'step-b', count: 1 }],
  halts: [{ reason: 'max-retries' }],
  retryHotspots: [{ step: 'step-b', count: 1, topReason: 'timeout' }],
  tokens: { input: 200, output: 100, cacheRead: 20, cacheCreation: 10 },
});

const sig3 = makeSignal({
  runId: 'run-3',
  kickbacks: [],
  halts: [],
  retryHotspots: [],
  tokens: { input: 300, output: 150, cacheRead: 30, cacheCreation: 15 },
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('computeSignalRates', () => {
  it('returns correct aggregate token spend across all signals', () => {
    const rates = computeSignalRates([sig1, sig2, sig3]);
    expect(rates.tokens.input).toBe(600);
    expect(rates.tokens.output).toBe(300);
    expect(rates.tokens.cacheRead).toBe(60);
    expect(rates.tokens.cacheCreation).toBe(30);
  });

  it('returns kickbackRate = totalKickbackCount / totalSignals', () => {
    const rates = computeSignalRates([sig1, sig2, sig3]);
    // totalKickbacks = 2 + 1 = 3; totalSignals = 3 → rate = 1.0
    expect(rates.kickbackRate).toBeCloseTo(1.0, 10);
  });

  it('returns haltRate = totalHaltCount / totalSignals', () => {
    const rates = computeSignalRates([sig1, sig2, sig3]);
    // totalHalts = 0 + 1 + 0 = 1; totalSignals = 3 → rate = 1/3
    expect(rates.haltRate).toBeCloseTo(1 / 3, 10);
  });

  it('returns retryRate = totalRetryCount / totalSignals', () => {
    const rates = computeSignalRates([sig1, sig2, sig3]);
    // totalRetries = 2 + 1 + 0 = 3; totalSignals = 3 → rate = 1.0
    expect(rates.retryRate).toBeCloseTo(1.0, 10);
  });

  it('returns totalSignals matching the input array length', () => {
    const rates = computeSignalRates([sig1, sig2, sig3]);
    expect(rates.totalSignals).toBe(3);
  });

  it('returns all zero-value token fields when no tokenUsage across signals', () => {
    const zeroSig = makeSignal({ runId: 'run-z', tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 } });
    const rates = computeSignalRates([zeroSig]);
    expect(rates.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
  });

  it('SignalRates type has the expected shape (type-level check via assignment)', () => {
    const rates: SignalRates = computeSignalRates([sig1]);
    // If SignalRates is missing any field, TypeScript rejects this assignment.
    expect(typeof rates.tokens.input).toBe('number');
    expect(typeof rates.tokens.output).toBe('number');
    expect(typeof rates.tokens.cacheRead).toBe('number');
    expect(typeof rates.tokens.cacheCreation).toBe('number');
    expect(typeof rates.kickbackRate).toBe('number');
    expect(typeof rates.haltRate).toBe('number');
    expect(typeof rates.retryRate).toBe('number');
    expect(typeof rates.totalSignals).toBe('number');
  });

  // ─── Edge-case: empty array / zero-denominator (Task 9, FR-9 + FR-12 negatives) ───

  describe('empty signals array (zero-denominator guard)', () => {
    it('returns totalSignals = 0 for empty array', () => {
      const rates = computeSignalRates([]);
      expect(rates.totalSignals).toBe(0);
    });

    it('returns kickbackRate = 0 (not NaN) for empty array', () => {
      const rates = computeSignalRates([]);
      // Falsifiable: current 0/0 yields NaN — guard must clamp to 0.
      expect(Number.isNaN(rates.kickbackRate)).toBe(false);
      expect(rates.kickbackRate).toBe(0);
    });

    it('returns haltRate = 0 (not NaN) for empty array', () => {
      const rates = computeSignalRates([]);
      expect(Number.isNaN(rates.haltRate)).toBe(false);
      expect(rates.haltRate).toBe(0);
    });

    it('returns retryRate = 0 (not NaN) for empty array', () => {
      const rates = computeSignalRates([]);
      expect(Number.isNaN(rates.retryRate)).toBe(false);
      expect(rates.retryRate).toBe(0);
    });

    it('returns all token fields as 0 for empty array', () => {
      const rates = computeSignalRates([]);
      expect(rates.tokens.input).toBe(0);
      expect(rates.tokens.output).toBe(0);
      expect(rates.tokens.cacheRead).toBe(0);
      expect(rates.tokens.cacheCreation).toBe(0);
    });

    it('no rate field is NaN for empty array (composite guard)', () => {
      const rates = computeSignalRates([]);
      // Belt-and-suspenders: all numeric rate fields must be finite numbers.
      expect(Number.isNaN(rates.kickbackRate)).toBe(false);
      expect(Number.isNaN(rates.haltRate)).toBe(false);
      expect(Number.isNaN(rates.retryRate)).toBe(false);
      expect(Number.isFinite(rates.kickbackRate)).toBe(true);
      expect(Number.isFinite(rates.haltRate)).toBe(true);
      expect(Number.isFinite(rates.retryRate)).toBe(true);
    });
  });

  describe('zero-denominator: signal with all-zero counts (non-NaN path)', () => {
    // All three rate denominators (kickbackRate, haltRate, retryRate) share
    // `signals.length` as their sole denominator — there is no independent
    // per-feature or per-metric secondary denominator. When the array is
    // non-empty, totalSignals >= 1 so division is always safe. This test
    // proves a single-signal with zero events yields 0.0 rates (not NaN),
    // exercising the non-empty fast path so a future refactor introducing a
    // second denominator would be caught by the empty-array tests above.
    it('returns 0 rates (not NaN) for one signal with zero kickbacks/halts/retries', () => {
      const zeroActivitySig = makeSignal({
        runId: 'run-zero',
        kickbacks: [],
        halts: [],
        retryHotspots: [],
        tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      });
      const rates = computeSignalRates([zeroActivitySig]);
      expect(rates.totalSignals).toBe(1);
      expect(Number.isNaN(rates.kickbackRate)).toBe(false);
      expect(Number.isNaN(rates.haltRate)).toBe(false);
      expect(Number.isNaN(rates.retryRate)).toBe(false);
      expect(rates.kickbackRate).toBe(0);
      expect(rates.haltRate).toBe(0);
      expect(rates.retryRate).toBe(0);
    });
  });
});
