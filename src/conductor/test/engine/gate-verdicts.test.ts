// Covers: task:2
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  checkGateCompletion,
  computeAndWriteVerdict,
  readAllVerdicts,
  readVerdict,
  writeVerdict,
  validRebaseOperationRecord,
  type GateVerdict,
} from '../../src/engine/gate-verdicts.js';

describe('engine/gate-verdicts', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gate-verdicts-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('write + read roundtrip', async () => {
    await writeVerdict(dir, 'build', { satisfied: true, checkedAt: 123 });
    const v = await readVerdict(dir, 'build');
    expect(v?.satisfied).toBe(true);
    expect(v?.checkedAt).toBe(123);
  });

  it('readVerdict returns null when absent', async () => {
    expect(await readVerdict(dir, 'plan')).toBeNull();
  });

  it('readVerdict returns null on malformed JSON', async () => {
    await mkdir(join(dir, '.pipeline/gates'), { recursive: true });
    await writeFile(join(dir, '.pipeline/gates/plan.json'), 'not json');
    expect(await readVerdict(dir, 'plan')).toBeNull();
  });

  it('computeAndWriteVerdict persists the predicate result', async () => {
    // build with no task-status.json → predicate reports not done
    const v = await computeAndWriteVerdict(dir, 'build');
    expect(v.satisfied).toBe(false);
    expect(v.reason).toMatch(/task-status/);
    const onDisk = await readVerdict(dir, 'build');
    expect(onDisk?.satisfied).toBe(false);
    expect(onDisk?.checkedAt).toBeTypeOf('number');
  });

  it('readAllVerdicts returns every persisted gate', async () => {
    await writeVerdict(dir, 'build', { satisfied: true, checkedAt: 1 });
    await writeVerdict(dir, 'plan', { satisfied: false, reason: 'x', checkedAt: 2 });
    const all = await readAllVerdicts(dir);
    expect(Object.keys(all).sort()).toEqual(['build', 'plan']);
    expect(all.plan?.satisfied).toBe(false);
  });

  it('preserves kickback provenance', async () => {
    await writeVerdict(dir, 'plan', {
      satisfied: false,
      checkedAt: 5,
      kickback: { from: 'build', evidence: 'AC-7 needs a new table' },
    });
    const v = await readVerdict(dir, 'plan');
    expect(v?.kickback?.from).toBe('build');
    expect(v?.kickback?.evidence).toMatch(/AC-7/);
  });

  it('preserves decide-change kickback provenance for an unsatisfied coverage binding', async () => {
    await writeVerdict(dir, 'coverage_binding', {
      satisfied: false,
      checkedAt: 6,
      kickback: { from: 'decide-change', evidence: 'accepted plan amendment changed coverage' },
    });

    expect((await readVerdict(dir, 'coverage_binding'))?.kickback?.from).toBe('decide-change');
  });

  it('round trips replay-bound preservation without replacing the original judge identity', async () => {
    const preservation = {
      gate: 'build_review' as const,
      original: {
        artifactDigest: 'sha256:original-artifact',
        attemptId: 'attempt-original',
        runId: 'run-original',
        codeStamp: 'a'.repeat(40),
      },
      replay: {
        preRebaseHead: 'a'.repeat(40),
        mergeBase: 'b'.repeat(40),
        target: 'c'.repeat(40),
        completedHead: 'd'.repeat(40),
        expectedTree: 'e'.repeat(40),
      },
      relevantInputIdentities: ['.docs/plans/feature.md@sha256:plan'],
      operationId: 'rebase-operation-1',
    };
    const replayBoundVerdict: GateVerdict = {
      satisfied: true,
      checkedAt: 123,
      preservation,
    };
    await writeVerdict(dir, 'build_review', replayBoundVerdict);

    expect(await readVerdict(dir, 'build_review')).toEqual({
      satisfied: true,
      checkedAt: 123,
      preservation,
    });
  });

  it('round trips applying and applied rebase transition records', async () => {
    const operation = {
      id: 'rebase-operation-1',
      status: 'applying' as const,
      transition: {
        preserved: ['build_review'] as const,
        invalidated: ['test_suite'] as const,
        reverified: [] as const,
      },
      replay: {
        preRebaseHead: 'a'.repeat(40),
        mergeBase: 'b'.repeat(40),
        target: 'c'.repeat(40),
        completedHead: 'd'.repeat(40),
        expectedTree: 'e'.repeat(40),
      },
    };
    const applyingVerdict: GateVerdict = { satisfied: true, checkedAt: 123, rebaseOperation: operation };
    await writeVerdict(dir, 'rebase', applyingVerdict);
    expect((await readVerdict(dir, 'rebase'))?.rebaseOperation).toEqual(operation);

    await writeVerdict(dir, 'rebase', {
      satisfied: true,
      checkedAt: 124,
      rebaseOperation: { ...operation, status: 'applied' },
    });
    expect((await readVerdict(dir, 'rebase'))?.rebaseOperation).toEqual({ ...operation, status: 'applied' });
  });

  it('validates optional appliedAt only when it is a finite positive number', () => {
    const operation = {
      id: 'rebase-operation-1',
      status: 'applied' as const,
      transition: { preserved: [], invalidated: [], reverified: [] },
      replay: {
        preRebaseHead: 'a'.repeat(40),
        mergeBase: 'b'.repeat(40),
        target: 'c'.repeat(40),
        completedHead: 'd'.repeat(40),
        expectedTree: 'e'.repeat(40),
      },
    };

    expect(validRebaseOperationRecord({ ...operation, appliedAt: 123 })).toBe(true);
    expect(validRebaseOperationRecord({ ...operation, appliedAt: Number.NaN })).toBe(false);
    expect(validRebaseOperationRecord({ ...operation, appliedAt: '123' } as never)).toBe(false);
  });

  it('drops obsolete preservation metadata when an ordinary verdict replaces the record', async () => {
    await writeVerdict(dir, 'build_review', {
      satisfied: true,
      checkedAt: 1,
      preservation: {
        gate: 'build_review',
        original: { artifactDigest: 'sha256:old', attemptId: 'attempt-old', runId: 'run-old', codeStamp: 'a'.repeat(40) },
        replay: { preRebaseHead: 'a'.repeat(40), mergeBase: 'b'.repeat(40), target: 'c'.repeat(40), completedHead: 'd'.repeat(40), expectedTree: 'e'.repeat(40) },
        relevantInputIdentities: [],
        operationId: 'old-operation',
      },
    });

    await writeVerdict(dir, 'build_review', { satisfied: true, checkedAt: 2, reason: 'fresh ordinary verdict' });
    expect(await readVerdict(dir, 'build_review')).toEqual({
      satisfied: true,
      checkedAt: 2,
      reason: 'fresh ordinary verdict',
    });
  });

  it('continues to read legacy verdicts without optional replay metadata', async () => {
    await writeVerdict(dir, 'build_review', { satisfied: true, checkedAt: 123 });
    const verdict = await readVerdict(dir, 'build_review');
    expect(verdict?.preservation).toBeUndefined();
    expect(verdict?.rebaseOperation).toBeUndefined();
  });

  it.each(['failed', 'refused'] as const)('does not satisfy coverage_binding for a %s envelope', async (status) => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline', 'coverage-binding.json'), JSON.stringify({
      version: 1,
      slug: 'coverage-feature',
      runId: 'coverage-run',
      status,
      entries: [],
    }));

    expect(await checkGateCompletion(dir, 'coverage_binding')).toMatchObject({ done: false });
  });
});
