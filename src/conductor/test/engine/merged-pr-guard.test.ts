/**
 * Tests for `checkMergedPrGuard` in src/engine/merged-pr-guard.ts (Task 1).
 *
 * Story: Guard verdict mapping — checkMergedPrGuard
 *
 * The guard wraps prMergeState and maps verdicts to 'merged' | 'proceed':
 * - MERGED → 'merged'
 * - OPEN/CLOSED/NOTFOUND/UNKNOWN → 'proceed' (fail-open)
 * - gh runner throws → 'proceed'
 * - prUrl undefined → 'proceed' with zero gh invocations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { checkMergedPrGuard, writeSyntheticShipMarkers } from '../../src/engine/merged-pr-guard.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';
import type { ConductState } from '../../src/types/index.js';
import { readState, writeState } from '../../src/engine/state.js';

const PR_URL = 'https://github.com/foo/bar/pull/42';

/**
 * Scripted GhRunner that records calls and can simulate prMergeState verdicts.
 */
function fakeGh(
  verdict: 'MERGED' | 'OPEN' | 'CLOSED' | 'NOTFOUND' | 'UNKNOWN' | 'throw',
): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhRunner = async (args, _opts) => {
    calls.push([...args]);
    if (verdict === 'throw') {
      throw new Error('gh runner failure');
    }
    return {
      stdout: JSON.stringify({
        state: verdict,
        mergeable: 'UNKNOWN',
        statusCheckRollup: [],
        labels: [],
      }),
    };
  };
  return { gh, calls };
}

describe('engine/merged-pr-guard — checkMergedPrGuard', () => {
  describe('verdict mapping', () => {
    it('MERGED → "merged"', async () => {
      const { gh } = fakeGh('MERGED');
      const result = await checkMergedPrGuard(gh, '/repo', PR_URL);
      expect(result).toBe('merged');
    });

    it('OPEN → "proceed"', async () => {
      const { gh } = fakeGh('OPEN');
      const result = await checkMergedPrGuard(gh, '/repo', PR_URL);
      expect(result).toBe('proceed');
    });

    it('CLOSED → "proceed"', async () => {
      const { gh } = fakeGh('CLOSED');
      const result = await checkMergedPrGuard(gh, '/repo', PR_URL);
      expect(result).toBe('proceed');
    });

    it('NOTFOUND → "proceed"', async () => {
      const { gh } = fakeGh('NOTFOUND');
      const result = await checkMergedPrGuard(gh, '/repo', PR_URL);
      expect(result).toBe('proceed');
    });

    it('UNKNOWN → "proceed"', async () => {
      const { gh } = fakeGh('UNKNOWN');
      const result = await checkMergedPrGuard(gh, '/repo', PR_URL);
      expect(result).toBe('proceed');
    });

    it('gh runner throws → "proceed"', async () => {
      const { gh } = fakeGh('throw');
      const result = await checkMergedPrGuard(gh, '/repo', PR_URL);
      expect(result).toBe('proceed');
    });
  });

  describe('no prUrl behavior', () => {
    it('undefined prUrl → "proceed" with zero gh invocations', async () => {
      const { gh, calls } = fakeGh('MERGED');
      const result = await checkMergedPrGuard(gh, '/repo', undefined);
      expect(result).toBe('proceed');
      expect(calls).toHaveLength(0);
    });
  });

  describe('logging', () => {
    it('logs gh errors at debug level', async () => {
      const logs: string[] = [];
      const { gh } = fakeGh('throw');
      await checkMergedPrGuard(gh, '/repo', PR_URL, (msg) => logs.push(msg));
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0]).toContain('error');
    });
  });
});

// ── Task 2: Synthetic ship markers ────────────────────────────────────────

const TEST_SHA = '1234567890abcdef1234567890abcdef12345678';

async function fileExists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false,
  );
}

async function fileContent(p: string): Promise<string> {
  return readFile(p, 'utf-8');
}

describe('engine/merged-pr-guard — writeSyntheticShipMarkers (Task 2)', () => {
  let dir: string;
  let statePath: string;
  let logs: string[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'merged-pr-guard-synthetic-'));
    statePath = join(dir, 'conduct-state.json');
    logs = [];
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes .pipeline/finish-choice = "pr" and .pipeline/DONE on first invoke', async () => {
    // Set up initial state
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const initialState: ConductState = {
      feature_desc: 'test-feature',
      complexity_tier: 'L',
    };
    await writeState(statePath, initialState);

    const mockLog = (m: string) => logs.push(m);

    await writeSyntheticShipMarkers(dir, TEST_SHA, mockLog);

    expect(await fileExists(join(dir, '.pipeline/finish-choice'))).toBe(true);
    expect((await fileContent(join(dir, '.pipeline/finish-choice'))).trim()).toBe('pr');
    expect(await fileExists(join(dir, '.pipeline/DONE'))).toBe(true);
  });

  it('leaves conduct-state.json byte-identical after invoke', async () => {
    // Set up initial state
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const initialState: ConductState = {
      feature_desc: 'test-feature',
      complexity_tier: 'L',
      pr_url: 'https://github.com/jstoup111/ai-conductor/pull/358',
    };
    await writeState(statePath, initialState);
    const beforeBytes = await fileContent(statePath);

    const mockLog = (m: string) => logs.push(m);

    await writeSyntheticShipMarkers(dir, TEST_SHA, mockLog);

    const afterBytes = await fileContent(statePath);
    expect(afterBytes).toBe(beforeBytes);
  });

  it('idempotent: double-invoke produces identical markers, no throw', async () => {
    // Set up initial state
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const initialState: ConductState = {
      feature_desc: 'test-feature',
      complexity_tier: 'L',
    };
    await writeState(statePath, initialState);

    const mockLog = (m: string) => logs.push(m);

    // First invoke
    await writeSyntheticShipMarkers(dir, TEST_SHA, mockLog);
    const firstFinishChoice = await fileContent(join(dir, '.pipeline/finish-choice'));
    const firstDoneExists = await fileExists(join(dir, '.pipeline/DONE'));

    // Second invoke — must not throw
    await writeSyntheticShipMarkers(dir, TEST_SHA, mockLog);
    const secondFinishChoice = await fileContent(join(dir, '.pipeline/finish-choice'));
    const secondDoneExists = await fileExists(join(dir, '.pipeline/DONE'));

    expect(secondFinishChoice).toBe(firstFinishChoice);
    expect(secondDoneExists).toBe(firstDoneExists);
    expect(secondDoneExists).toBe(true);
  });

  it('logs "already shipped out-of-band" with the retained SHA', async () => {
    // Set up initial state
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const initialState: ConductState = {
      feature_desc: 'test-feature',
      complexity_tier: 'L',
    };
    await writeState(statePath, initialState);

    const mockLog = (m: string) => logs.push(m);

    await writeSyntheticShipMarkers(dir, TEST_SHA, mockLog);

    const logLine = logs.find((l) => /already shipped out-of-band/.test(l));
    expect(logLine).toBeTruthy();
    expect(logLine).toMatch(/already shipped out-of-band/);
    expect(logLine).toMatch(new RegExp(TEST_SHA));
  });
});
