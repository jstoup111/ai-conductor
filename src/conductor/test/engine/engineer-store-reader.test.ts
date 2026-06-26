import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  appendSignal,
  createEngineerStoreReader,
  type EngineerSignal,
} from '../../src/engine/engineer-store.js';

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for createEngineerStoreReader / EngineerStoreReader.readSignals
// (Phase 9.3, Task 3 — FR-1, FR-5).
//
// Verifies:
//   - readSignals() returns all signals when no filter given
//   - readSignals({ project }) filters to only that project's signals
//   - readSignals({ project, feature }) filters to project+feature
//   - Malformed JSONL lines are skipped (resilient parse)
//   - Missing signals.jsonl returns [] (no crash)
//   - opts.engineerDir takes precedence over env AI_CONDUCTOR_ENGINEER_DIR
// ─────────────────────────────────────────────────────────────────────────────

function makeSignal(over: Partial<EngineerSignal> = {}): EngineerSignal {
  return {
    schemaVersion: 1,
    ts: new Date().toISOString(),
    project: 'alpha',
    feature: 'feat-a',
    runId: 'run-1',
    outcome: 'done',
    kickbacks: [],
    halts: [],
    retryHotspots: [],
    tokens: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0 },
    durationByStep: {},
    ...over,
  };
}

describe('createEngineerStoreReader / readSignals', () => {
  let engineerDir: string;
  const savedEnv: string | undefined = process.env.AI_CONDUCTOR_ENGINEER_DIR;

  beforeEach(async () => {
    engineerDir = await mkdtemp(join(tmpdir(), 'engineer-reader-test-'));
    process.env.AI_CONDUCTOR_ENGINEER_DIR = engineerDir;
  });

  afterEach(async () => {
    process.env.AI_CONDUCTOR_ENGINEER_DIR = savedEnv;
    await rm(engineerDir, { recursive: true, force: true });
  });

  it('returns empty array when signals.jsonl does not exist', async () => {
    const reader = createEngineerStoreReader();
    const results = await reader.readSignals();
    expect(results).toEqual([]);
  });

  it('returns all signals with no filter', async () => {
    const sigA = makeSignal({ project: 'alpha', feature: 'feat-a', runId: 'r1' });
    const sigB = makeSignal({ project: 'beta', feature: 'feat-b', runId: 'r2' });
    await appendSignal(engineerDir, sigA);
    await appendSignal(engineerDir, sigB);

    const reader = createEngineerStoreReader();
    const results = await reader.readSignals();
    expect(results).toHaveLength(2);
  });

  it('filters by project — returns only matching project signals', async () => {
    const alphaSignal = makeSignal({ project: 'alpha', feature: 'feat-a', runId: 'r1' });
    const betaSignal = makeSignal({ project: 'beta', feature: 'feat-b', runId: 'r2' });
    const alpha2Signal = makeSignal({ project: 'alpha', feature: 'feat-c', runId: 'r3' });
    await appendSignal(engineerDir, alphaSignal);
    await appendSignal(engineerDir, betaSignal);
    await appendSignal(engineerDir, alpha2Signal);

    const reader = createEngineerStoreReader();
    const results = await reader.readSignals({ project: 'alpha' });
    expect(results).toHaveLength(2);
    expect(results.every((s) => s.project === 'alpha')).toBe(true);
    // beta signal must not appear
    expect(results.some((s) => s.project === 'beta')).toBe(false);
  });

  it('filters by project + feature — returns only that project+feature combination', async () => {
    const sigA = makeSignal({ project: 'alpha', feature: 'feat-a', runId: 'r1' });
    const sigB = makeSignal({ project: 'alpha', feature: 'feat-b', runId: 'r2' });
    const sigC = makeSignal({ project: 'beta', feature: 'feat-a', runId: 'r3' });
    await appendSignal(engineerDir, sigA);
    await appendSignal(engineerDir, sigB);
    await appendSignal(engineerDir, sigC);

    const reader = createEngineerStoreReader();
    const results = await reader.readSignals({ project: 'alpha', feature: 'feat-a' });
    expect(results).toHaveLength(1);
    expect(results[0].project).toBe('alpha');
    expect(results[0].feature).toBe('feat-a');
  });

  it('skips malformed JSONL lines and returns valid ones (resilient parse)', async () => {
    const validSig = makeSignal({ project: 'alpha', feature: 'feat-a', runId: 'r1' });
    await appendSignal(engineerDir, validSig);

    // Manually append a malformed line
    const { appendFile } = await import('node:fs/promises');
    await appendFile(join(engineerDir, 'signals.jsonl'), 'NOT VALID JSON\n', 'utf-8');

    // Append another valid signal after the bad line
    const validSig2 = makeSignal({ project: 'beta', feature: 'feat-b', runId: 'r2' });
    await appendSignal(engineerDir, validSig2);

    const reader = createEngineerStoreReader();
    const results = await reader.readSignals();
    // Only 2 valid signals, malformed line skipped
    expect(results).toHaveLength(2);
  });

  it('uses opts.engineerDir when provided, ignoring env AI_CONDUCTOR_ENGINEER_DIR', async () => {
    const altDir = await mkdtemp(join(tmpdir(), 'engineer-reader-alt-'));
    try {
      const sigInAlt = makeSignal({ project: 'gamma', feature: 'feat-g', runId: 'r99' });
      await appendSignal(altDir, sigInAlt);

      // engineerDir (from env) has no signals
      const reader = createEngineerStoreReader({ engineerDir: altDir });
      const results = await reader.readSignals();
      expect(results).toHaveLength(1);
      expect(results[0].project).toBe('gamma');
    } finally {
      await rm(altDir, { recursive: true, force: true });
    }
  });

  // ── Task 4: empty-file + skipped-count ───────────────────────────────────────

  it('returns empty array when signals.jsonl exists but is empty (or whitespace-only)', async () => {
    // Create an empty signals.jsonl (file exists but has no content)
    await writeFile(join(engineerDir, 'signals.jsonl'), '', 'utf-8');
    const reader = createEngineerStoreReader();
    const results = await reader.readSignals();
    expect(results).toEqual([]);

    // Also verify whitespace-only file behaves the same
    await writeFile(join(engineerDir, 'signals.jsonl'), '   \n  \n', 'utf-8');
    const results2 = await reader.readSignals();
    expect(results2).toEqual([]);
  });

  it('readSignalsWithStats reports skipped count for malformed lines', async () => {
    // Seed 2 valid signals and 3 malformed lines
    const sig1 = makeSignal({ project: 'alpha', feature: 'feat-a', runId: 'rs1' });
    const sig2 = makeSignal({ project: 'alpha', feature: 'feat-b', runId: 'rs2' });
    await appendSignal(engineerDir, sig1);
    await writeFile(
      join(engineerDir, 'signals.jsonl'),
      // Overwrite so we control exact content: 2 valid + 3 malformed lines
      [
        JSON.stringify(sig1),
        'NOT VALID JSON',
        '{broken:',
        JSON.stringify(sig2),
        'also bad',
      ].join('\n') + '\n',
      'utf-8',
    );

    const reader = createEngineerStoreReader();
    const { signals, skipped } = await reader.readSignalsWithStats();
    expect(signals).toHaveLength(2);
    expect(skipped).toBe(3);
  });
});
