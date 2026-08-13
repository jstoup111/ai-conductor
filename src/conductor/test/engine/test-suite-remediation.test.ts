import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  BUILD_REVIEW_REPAIR_LEDGER,
  diagnosticOverlapsBaseAdvance,
  readBaseAdvanceHistory,
  readTestSuiteRemediations,
  recordTestSuiteRemediation,
  wasInvalidatedByRebase,
} from '../../src/engine/test-suite-remediation.js';

describe('diagnosticOverlapsBaseAdvance', () => {
  it('matches a diagnostic naming a path in an advance but not another advance', () => {
    const diagnostic = 'build review failed: agents/planner.md has an invalid reference';

    expect([
      diagnosticOverlapsBaseAdvance({ paths: ['agents/planner.md'], ts: '2026-08-13T10:00:00.000Z' }, diagnostic),
      diagnosticOverlapsBaseAdvance({ paths: ['agents/evaluator.md'], ts: '2026-08-13T10:00:00.000Z' }, diagnostic),
      diagnosticOverlapsBaseAdvance({ paths: ['agents/planner.m'], ts: '2026-08-13T10:00:00.000Z' }, diagnostic),
    ]).toEqual([true, false, false]);
  });
});

describe('recordTestSuiteRemediation', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'test-suite-remediation-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('persists one stable repair record for the same upstream-induced failure across repeated rebases', async () => {
    const failure = {
      reason: 'command_failed' as const,
      message: 'full-suite-verification-gate expected npm run test:changed but config is npm test',
    };

    const first = await recordTestSuiteRemediation(dir, failure, {
      satisfied: false,
      checkedAt: 101,
      kickback: { from: 'rebase', evidence: 'first rebase' },
    });
    const second = await recordTestSuiteRemediation(dir, failure, {
      satisfied: false,
      checkedAt: 202,
      kickback: { from: 'rebase', evidence: 'second rebase' },
    });
    const records = await readTestSuiteRemediations(dir);

    expect(first?.id).toEqual(second?.id);
    expect(first?.id).toMatch(/^repair-[a-f0-9]{12}$/);
    expect(records).toEqual([first]);
    expect(records[0].diagnostic).toBe(failure.message);
  });

  it('accumulates distinct failures instead of replacing prior rebase remediation provenance', async () => {
    const first = await recordTestSuiteRemediation(dir, {
      reason: 'command_failed',
      message: 'repair stale expectation A',
    }, { satisfied: false, checkedAt: 101, kickback: { from: 'rebase', evidence: 'one' } });
    const second = await recordTestSuiteRemediation(dir, {
      reason: 'timeout',
      message: 'repair stale expectation B',
    }, { satisfied: false, checkedAt: 202, kickback: { from: 'rebase', evidence: 'two' } });
    const records = await readTestSuiteRemediations(dir);

    expect(first?.id).not.toBe(second?.id);
    expect(records).toEqual([first, second]);
  });

  it('authorizes recording only from a mechanically rebase-invalidated gate', () => {
    expect(wasInvalidatedByRebase({ kickback: { from: 'rebase' } })).toBe(true);
    expect(wasInvalidatedByRebase({ kickback: { from: 'build_review' } })).toBe(false);
    expect(wasInvalidatedByRebase(null)).toBe(false);
  });

  it('consumes one rebase invalidation once and serializes concurrent writers', async () => {
    const verdict = {
      satisfied: false,
      checkedAt: 303,
      kickback: { from: 'rebase' as const, evidence: 'same rebase' },
    };
    const [first, second] = await Promise.all([
      recordTestSuiteRemediation(dir, { reason: 'command_failed', message: 'first' }, verdict),
      recordTestSuiteRemediation(dir, { reason: 'command_failed', message: 'second' }, verdict),
    ]);
    const records = await readTestSuiteRemediations(dir);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(records).toHaveLength(1);
  });

  it('reclaims a lock left by a dead daemon process', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, `${BUILD_REVIEW_REPAIR_LEDGER}.lock`),
      JSON.stringify({ pid: 2_147_483_647, createdAt: 1 }) + '\n',
    );

    const record = await recordTestSuiteRemediation(
      dir,
      { reason: 'command_failed', message: 'repair after restart' },
      {
        satisfied: false,
        checkedAt: 404,
        kickback: { from: 'rebase', evidence: 'restarted daemon' },
      },
    );

    expect(record?.id).toMatch(/^repair-/);
  });

  it('reads every recorded base advance in event-log order', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline', 'events.jsonl'), [
      JSON.stringify({ type: 'step_started', step: 'rebase', ts: '2026-08-13T10:00:00.000Z' }),
      JSON.stringify({
        type: 'rebase_changed',
        changedPaths: ['src/gate.ts'],
        allChangedPaths: ['src/gate.ts', 'docs/guide.md'],
        ts: '2026-08-13T10:01:00.000Z',
      }),
      JSON.stringify({ type: 'gate_verdict', step: 'build_review', ts: '2026-08-13T10:02:00.000Z' }),
      JSON.stringify({
        type: 'rebase_changed',
        changedPaths: ['test/gate.test.ts'],
        allChangedPaths: ['test/gate.test.ts'],
        ts: '2026-08-13T10:03:00.000Z',
      }),
    ].join('\n') + '\n');

    await expect(readBaseAdvanceHistory(dir)).resolves.toEqual([
      {
        paths: ['src/gate.ts', 'docs/guide.md'],
        ts: '2026-08-13T10:01:00.000Z',
      },
      {
        paths: ['test/gate.test.ts'],
        ts: '2026-08-13T10:03:00.000Z',
      },
    ]);
  });

  it('skips malformed event records and treats an absent event log as empty history', async () => {
    const absent = await readBaseAdvanceHistory(dir);

    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline', 'events.jsonl'), [
      JSON.stringify({
        type: 'rebase_changed',
        changedPaths: ['src/first.ts'],
        allChangedPaths: ['src/first.ts'],
        ts: '2026-08-13T11:00:00.000Z',
      }),
      '{ this is not JSON',
      JSON.stringify({
        type: 'rebase_changed',
        changedPaths: ['src/second.ts'],
        allChangedPaths: ['src/second.ts'],
        ts: '2026-08-13T11:01:00.000Z',
      }),
    ].join('\n') + '\n');

    await expect(Promise.all([absent, readBaseAdvanceHistory(dir)])).resolves.toEqual([
      [],
      [
        { paths: ['src/first.ts'], ts: '2026-08-13T11:00:00.000Z' },
        { paths: ['src/second.ts'], ts: '2026-08-13T11:01:00.000Z' },
      ],
    ]);
  });
});
