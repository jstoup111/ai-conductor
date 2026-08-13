import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  BUILD_REVIEW_REPAIR_LEDGER,
  diagnosticOverlapsBaseAdvance,
  failureMatchesBaseAdvance,
  readBaseAdvanceHistory,
  readTestSuiteRemediations,
  recordTestSuiteRemediation,
  resolveBaseAdvanceForFailure,
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

  it('matches prefixed renderings of the same path without matching a different repo path', () => {
    const advance = { paths: ['agents/planner.md'], ts: '2026-08-13T10:00:00.000Z' };

    expect([
      diagnosticOverlapsBaseAdvance(advance, './agents/planner.md failed to parse'),
      diagnosticOverlapsBaseAdvance(advance, 'FAIL /tmp/worktree/agents/planner.md > frontmatter'),
      diagnosticOverlapsBaseAdvance(advance, 'src/agents/planner.md failed to parse'),
    ]).toEqual([true, true, false]);
  });
});

describe('failureMatchesBaseAdvance', () => {
  it('does not attribute an overlapping failure that preceded the advance', () => {
    const advance = { paths: ['agents/planner.md'], ts: '2026-08-13T10:01:00.000Z' };

    expect([
      failureMatchesBaseAdvance(advance, {
        diagnostic: 'agents/planner.md has an invalid reference',
        observedAt: '2026-08-13T10:02:00.000Z',
      }),
      failureMatchesBaseAdvance(advance, {
        diagnostic: 'agents/planner.md has an invalid reference',
        observedAt: '2026-08-13T10:00:00.000Z',
      }),
    ]).toEqual([true, false]);
  });
});

describe('resolveBaseAdvanceForFailure', () => {
  it('finds a prior matching advance across the feature history', () => {
    const plannerAdvance = { paths: ['agents/planner.md'], ts: '2026-08-13T10:01:00.000Z' };
    const latestAdvance = { paths: ['agents/evaluator.md'], ts: '2026-08-13T10:03:00.000Z' };

    expect(resolveBaseAdvanceForFailure([plannerAdvance, latestAdvance], {
      diagnostic: 'agents/planner.md has an invalid reference',
      observedAt: '2026-08-13T10:04:00.000Z',
    })).toBe(plannerAdvance);
  });

  it('returns no attribution for diagnostics without a changed path or absent advances', () => {
    const advances = [{ paths: ['agents/planner.md'], ts: '2026-08-13T10:01:00.000Z' }];
    const observedAt = '2026-08-13T10:02:00.000Z';

    expect([
      resolveBaseAdvanceForFailure(advances, {
        diagnostic: 'agents/evaluator.md has an invalid reference',
        observedAt,
      }),
      resolveBaseAdvanceForFailure(advances, { diagnostic: 'build review failed', observedAt }),
      resolveBaseAdvanceForFailure([], {
        diagnostic: 'agents/planner.md has an invalid reference',
        observedAt,
      }),
    ]).toEqual([undefined, undefined, undefined]);
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

  it('records an observing gate against the causally matching advance', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline', 'events.jsonl'),
      `${JSON.stringify({
        type: 'rebase_changed',
        allChangedPaths: ['agents/planner.md'],
        ts: '2026-08-13T10:01:00.000Z',
      })}\n`,
    );

    const record = await recordTestSuiteRemediation(
      dir,
      'wiring_check',
      {
        reason: 'missing_coverage',
        message: 'agents/planner.md has an invalid reference',
        observedAt: Date.parse('2026-08-13T10:02:00.000Z'),
      },
    );

    await recordTestSuiteRemediation(dir, 'test_suite', {
      reason: 'missing_test',
      message: 'agents/planner.md has no matching test',
      observedAt: Date.parse('2026-08-13T10:03:00.000Z'),
    });
    await recordTestSuiteRemediation(dir, 'wiring_check', {
      reason: 'missing_coverage',
      message: 'agents/planner.md has an invalid reference',
      observedAt: Date.parse('2026-08-13T10:04:00.000Z'),
    });

    expect([record, await readTestSuiteRemediations(dir)]).toEqual([
      expect.objectContaining({ gate: 'wiring_check' }),
      expect.arrayContaining([
        expect.objectContaining({ diagnostic: 'agents/planner.md has an invalid reference' }),
        expect.objectContaining({ diagnostic: 'agents/planner.md has no matching test' }),
      ]),
    ]);
    expect(await readTestSuiteRemediations(dir)).toHaveLength(2);
  });

  it('preserves concurrent distinct repairs and surfaces an unacquirable lock', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline', 'events.jsonl'), `${JSON.stringify({
      type: 'rebase_changed',
      allChangedPaths: ['agents/planner.md', 'agents/evaluator.md'],
      ts: '2026-08-13T10:01:00.000Z',
    })}\n`);
    const observedAt = Date.parse('2026-08-13T10:02:00.000Z');

    await Promise.all([
      recordTestSuiteRemediation(dir, 'test_suite', {
        reason: 'missing_test', message: 'agents/planner.md has no matching test', observedAt,
      }),
      recordTestSuiteRemediation(dir, 'wiring_check', {
        reason: 'missing_coverage', message: 'agents/evaluator.md has no coverage', observedAt,
      }),
    ]);

    expect(await readTestSuiteRemediations(dir)).toHaveLength(2);

    await writeFile(
      join(dir, `${BUILD_REVIEW_REPAIR_LEDGER}.lock`),
      `${JSON.stringify({ pid: process.pid, createdAt: Date.now() })}\n`,
    );

    await expect(recordTestSuiteRemediation(dir, 'test_suite', {
      reason: 'missing_test', message: 'agents/planner.md has another missing test', observedAt,
    })).rejects.toThrow('timed out acquiring build-review rebase-repair ledger lock');
  });

  it('reads legacy and malformed ledgers as empty while retaining valid siblings', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const ledgerPath = join(dir, BUILD_REVIEW_REPAIR_LEDGER);

    await writeFile(ledgerPath, JSON.stringify({
      consumedInvalidations: [101],
      repairs: [{
        id: 'repair-legacy', gate: 'test_suite', reason: 'old', diagnostic: 'old', rebaseInvalidatedAt: 101,
      }],
    }));
    await expect(readTestSuiteRemediations(dir)).resolves.toEqual([]);

    await writeFile(ledgerPath, '{ invalid JSON');
    await expect(readTestSuiteRemediations(dir)).resolves.toEqual([]);

    const validRepair = {
      id: 'repair-valid',
      gate: 'test_suite',
      reason: 'missing_test',
      diagnostic: 'agents/planner.md has no matching test',
      rebaseInvalidatedAt: 101,
    };
    await writeFile(ledgerPath, JSON.stringify({ repairs: [
      validRepair,
      { ...validRepair, id: 42 },
    ] }));
    await expect(readTestSuiteRemediations(dir)).resolves.toEqual([validRepair]);
  });

  it('writes and reads the current repair shape over a legacy ledger', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline', 'events.jsonl'), `${JSON.stringify({
      type: 'rebase_changed',
      allChangedPaths: ['agents/planner.md'],
      ts: '2026-08-13T10:01:00.000Z',
    })}\n`);
    await writeFile(join(dir, BUILD_REVIEW_REPAIR_LEDGER), JSON.stringify({
      consumedInvalidations: [101],
      repairs: [],
    }));

    const record = await recordTestSuiteRemediation(dir, 'test_suite', {
      reason: 'missing_test',
      message: 'agents/planner.md has no matching test',
      observedAt: Date.parse('2026-08-13T10:02:00.000Z'),
    });

    expect(await readTestSuiteRemediations(dir)).toEqual([record]);
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

    expect(absent, 'an absent event log reads as empty history').toEqual([]);
    await expect(readBaseAdvanceHistory(dir)).resolves.toEqual([
      { paths: ['src/first.ts'], ts: '2026-08-13T11:00:00.000Z' },
      { paths: ['src/second.ts'], ts: '2026-08-13T11:01:00.000Z' },
    ]);
  });
});

describe('engine/test-suite-remediation — retired kickback-provenance predicate (Task 16)', () => {
  it('no longer exports wasInvalidatedByRebase', async () => {
    const mod: Record<string, unknown> = await import('../../src/engine/test-suite-remediation.js');
    expect('wasInvalidatedByRebase' in mod).toBe(false);
  });
});
