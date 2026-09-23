import { describe, expect, it, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFilesystemConductStateStore } from '../../src/engine/filesystem-conduct-state-store.js';
import { readVerdict, writeVerdict } from '../../src/engine/gate-verdicts.js';
import { applyRebaseTransition, clampRebaseContinuation } from '../../src/engine/rebase-transition.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';

function preservedCandidate(gate: 'prd_audit', checkedAt = 2) {
  const original = { satisfied: true, checkedAt, reason: 'approved' };
  // The production caller uses this same JSON digest to bind the candidate to
  // the original verdict captured before transition writes begin.
  const originalVerdictDigest = createHash('sha256').update(JSON.stringify(original)).digest('hex');
  return {
    gate,
    original: {
      artifactDigest: originalVerdictDigest,
      attemptId: `${checkedAt}`,
      runId: `${checkedAt}`,
      codeStamp: 'a',
    },
    originalVerdictDigest,
    relevantInputIdentities: [],
  };
}

const dirs: string[] = [];
afterEach(async () => { while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true }); });

describe('applyRebaseTransition', () => {
  it('uses one expected-value batch and leaves skipped gates alone', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rebase-transition-'));
    dirs.push(dir);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline/conduct-state.json'), JSON.stringify({ build_review: 'done', manual_test: 'skipped', acceptance_specs: 'done' }));
    await writeVerdict(dir, 'build_review', { satisfied: false, checkedAt: 1, kickback: { from: 'rebase', evidence: 'changed replay' } });
    await writeVerdict(dir, 'prd_audit', { satisfied: true, checkedAt: 2, reason: 'approved' });
    const result = await applyRebaseTransition({
      projectRoot: dir,
      stateStore: createFilesystemConductStateStore(join(dir, '.pipeline/conduct-state.json')),
      operationId: 'operation-1',
      replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      // The rebase verdict writer removes skipped gates before the shared
      // transition receives its durable operation set.
      invalidated: ['build_review'],
      preserved: ['prd_audit'],
      preservedCandidates: [preservedCandidate('prd_audit')],
    });
    expect(result.stateResult).toBe('applied');
    expect(JSON.parse(await (await import('node:fs/promises')).readFile(join(dir, '.pipeline/conduct-state.json'), 'utf8'))).toMatchObject({ build_review: 'pending', manual_test: 'skipped', acceptance_specs: 'done' });
    expect((await readVerdict(dir, 'rebase'))?.rebaseOperation).toMatchObject({ id: 'operation-1', status: 'applied' });
    expect((await readVerdict(dir, 'prd_audit'))?.preservation).toMatchObject({
      gate: 'prd_audit',
      operationId: 'operation-1',
      original: {
        attemptId: '2',
        runId: '2',
        codeStamp: 'a',
      },
      replay: { expectedTree: 'e' },
    });
  });

  it('recognizes the same replay operation on a restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rebase-transition-'));
    dirs.push(dir);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline/conduct-state.json'), JSON.stringify({ build_review: 'done' }));
    await writeVerdict(dir, 'build_review', { satisfied: false, checkedAt: 1, kickback: { from: 'rebase', evidence: 'changed replay' } });
    const input = {
      projectRoot: dir,
      stateStore: createFilesystemConductStateStore(join(dir, '.pipeline/conduct-state.json')),
      replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      invalidated: ['build_review'] as const,
      preserved: [] as const,
      preservedCandidates: [] as const,
    };
    expect((await applyRebaseTransition(input)).stateResult).toBe('applied');
    expect((await applyRebaseTransition(input)).stateResult).toBe('already-applied');
  });

  it('credits an applied build-review invalidation once per operation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rebase-transition-'));
    dirs.push(dir);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline/conduct-state.json'), JSON.stringify({ build_review: 'done' }));
    await writeFile(join(dir, '.pipeline/kickback-ledger.json'), JSON.stringify({
      version: 1, gates: { build_review: { count: 1, cumulative: 2, laps: 3, treeHash: null, lastReason: '', priorVerdict: true, resolvedBefore: 0 } },
    }));
    await writeVerdict(dir, 'build_review', { satisfied: false, checkedAt: 1, kickback: { from: 'rebase', evidence: 'changed replay' } });
    const input = {
      projectRoot: dir, stateStore: createFilesystemConductStateStore(join(dir, '.pipeline/conduct-state.json')),
      operationId: 'credited-operation', replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      invalidated: ['build_review'] as const, preserved: [] as const, preservedCandidates: [] as const,
    };
    expect((await applyRebaseTransition(input)).convergenceCredit).toEqual({ gate: 'build_review' });
    // A receipted operation performs no second refund, so it claims none.
    const repeated = await applyRebaseTransition(input);
    expect(repeated.stateResult).toBe('already-applied');
    expect(repeated).not.toHaveProperty('convergenceCredit');
    const ledger = await readKickbackLedger(dir);
    expect(ledger.gates.build_review?.cumulative).toBe(0);
    expect(ledger.convergenceCreditReceipts).toEqual({ 'credited-operation': { gate: 'build_review' } });
  });

  it('refuses to apply an operation that names a preserved gate without its bound candidate', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rebase-transition-'));
    dirs.push(dir);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline/conduct-state.json'), JSON.stringify({ build_review: 'done' }));

    const result = await applyRebaseTransition({
      projectRoot: dir,
      stateStore: createFilesystemConductStateStore(join(dir, '.pipeline/conduct-state.json')),
      replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      invalidated: [],
      preserved: ['build_review'],
      preservedCandidates: [],
    });

    expect(result.stateResult).toBe('refused');
    expect((await readVerdict(dir, 'rebase'))).toBeNull();
  });

  it('uses the caller-owned state path instead of assuming the pipeline default', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rebase-transition-'));
    dirs.push(dir);
    const stateFilePath = join(dir, 'conduct-state.json');
    await writeFile(stateFilePath, JSON.stringify({ build_review: 'done' }));
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeVerdict(dir, 'build_review', {
      satisfied: false,
      checkedAt: 1,
      kickback: { from: 'rebase', evidence: 'changed replay' },
    });

    const result = await applyRebaseTransition({
      projectRoot: dir,
      stateFilePath,
      stateStore: createFilesystemConductStateStore(stateFilePath),
      replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      invalidated: ['build_review'],
      preserved: [],
      preservedCandidates: [],
    });

    expect(result.stateResult).toBe('applied');
  });

  it('does not attach an older replay preservation record to a newer ordinary verdict', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rebase-transition-'));
    dirs.push(dir);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline/conduct-state.json'), JSON.stringify({ build_review: 'done' }));
    await writeVerdict(dir, 'build_review', {
      satisfied: false,
      checkedAt: 1,
      kickback: { from: 'rebase', evidence: 'changed replay' },
    });
    await writeVerdict(dir, 'prd_audit', { satisfied: true, checkedAt: 1, reason: 'original judgement' });

    const stateStore = createFilesystemConductStateStore(join(dir, '.pipeline/conduct-state.json'));
    const originalApplyBatch = stateStore.applyBatch.bind(stateStore);
    stateStore.applyBatch = async (batch) => {
      await writeVerdict(dir, 'prd_audit', { satisfied: true, checkedAt: 2, reason: 'newer ordinary judgement' });
      return originalApplyBatch(batch);
    };

    const result = await applyRebaseTransition({
      projectRoot: dir,
      stateStore,
      operationId: 'operation-2',
      replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      invalidated: ['build_review'],
      preserved: ['prd_audit'],
      preservedCandidates: [preservedCandidate('prd_audit', 1)],
    });

    // The original verdict was replaced while the transition was applying,
    // so the declared preservation effect cannot be made durable.  Refusal
    // leaves that newer ordinary judgement authoritative.
    expect(result.stateResult).toBe('refused');
    expect(await readVerdict(dir, 'prd_audit')).toEqual({
      satisfied: true,
      checkedAt: 2,
      reason: 'newer ordinary judgement',
    });
  });

  it('applies when an invalidated gate retains its own ordinary failure instead of a rebase kickback', async () => {
    // Production shape: prd_audit halted FAIL on its kickback cap, then a
    // proactive rebase listed it as invalidated while keeping that newer
    // failure verdict (no `kickback.from: 'rebase'`).
    const dir = await mkdtemp(join(tmpdir(), 'rebase-transition-'));
    dirs.push(dir);
    const statePath = join(dir, '.pipeline/conduct-state.json');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(statePath, JSON.stringify({ test_suite: 'done', prd_audit: 'pending' }));
    await writeVerdict(dir, 'test_suite', { satisfied: false, checkedAt: 1, kickback: { from: 'rebase', evidence: 'changed replay' } });
    const retainedFailure = { satisfied: false, checkedAt: 1, reason: 'prd-audit found blocking criterion grades: S2.1 (FIXABLE)' };
    await writeVerdict(dir, 'prd_audit', retainedFailure);

    const result = await applyRebaseTransition({
      projectRoot: dir,
      stateStore: createFilesystemConductStateStore(statePath),
      operationId: 'retained-failure-operation',
      replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      invalidated: ['test_suite', 'prd_audit'],
      preserved: [],
      preservedCandidates: [],
    });

    expect(result.stateResult).toBe('applied');
    expect((await readVerdict(dir, 'rebase'))?.rebaseOperation).toMatchObject({ id: 'retained-failure-operation', status: 'applied' });
    expect(await readVerdict(dir, 'prd_audit')).toEqual(retainedFailure);
  });

  it('refuses when a concurrent writer publishes a PASS for an invalidated gate', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rebase-transition-'));
    dirs.push(dir);
    const statePath = join(dir, '.pipeline/conduct-state.json');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(statePath, JSON.stringify({ test_suite: 'done' }));
    await writeVerdict(dir, 'test_suite', { satisfied: false, checkedAt: 1, kickback: { from: 'rebase', evidence: 'changed replay' } });
    const store = createFilesystemConductStateStore(statePath);
    const applyBatch = store.applyBatch.bind(store);
    store.applyBatch = async (batch) => {
      await writeVerdict(dir, 'test_suite', { satisfied: true, checkedAt: 2, reason: 'concurrent pass' });
      return applyBatch(batch);
    };

    const result = await applyRebaseTransition({
      projectRoot: dir, stateStore: store, operationId: 'raced-operation',
      replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      invalidated: ['test_suite'], preserved: [], preservedCandidates: [],
    });

    expect(result.stateResult).toBe('refused');
    expect((await readVerdict(dir, 'rebase'))?.rebaseOperation?.status).not.toBe('applied');
  });

  it('refuses a persisted same-field conflict without overwriting state or publishing an applied operation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rebase-transition-'));
    dirs.push(dir);
    const statePath = join(dir, '.pipeline/conduct-state.json');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(statePath, JSON.stringify({ build_review: 'done' }));
    await writeVerdict(dir, 'build_review', {
      satisfied: false, checkedAt: 1, kickback: { from: 'rebase', evidence: 'changed replay' },
    });
    const store = createFilesystemConductStateStore(statePath);
    const applyBatch = store.applyBatch.bind(store);
    store.applyBatch = async (batch) => {
      // A concurrent owner changes the exact field after transition snapshot
      // and before its expected-value mutation reaches persistent storage.
      await writeFile(statePath, JSON.stringify({ build_review: 'in_progress' }));
      return applyBatch(batch);
    };

    const result = await applyRebaseTransition({
      projectRoot: dir, stateStore: store, operationId: 'conflicted-operation',
      replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      invalidated: ['build_review'], preserved: [], preservedCandidates: [],
    });

    expect(result.stateResult).toBe('refused');
    expect(JSON.parse(await (await import('node:fs/promises')).readFile(statePath, 'utf8'))).toMatchObject({ build_review: 'in_progress' });
    expect((await readVerdict(dir, 'rebase'))?.rebaseOperation?.status).not.toBe('applied');
  });
});

describe('clampRebaseContinuation', () => {
  const steps = [{ name: 'coverage_binding' }, { name: 'acceptance_specs' }, { name: 'build' }, { name: 'test_suite' }, { name: 'manual_test' }] as const;

  it('moves a completed pre-suite selection to test_suite after a post-rebase coverage refresh', () => {
    expect(clampRebaseContinuation(steps, { acceptance_specs: 'skipped', build: 'done' }, 2, true)).toBe(3);
    expect(clampRebaseContinuation(steps, { acceptance_specs: 'skipped', build: 'done' }, 1, true)).toBe(3);
  });

  it('leaves a genuinely open BUILD, a later gate, and ordinary lifecycle selection alone', () => {
    expect(clampRebaseContinuation(steps, { build: 'pending' }, 2, true)).toBe(2);
    expect(clampRebaseContinuation(steps, { build: 'done' }, 4, true)).toBe(4);
    expect(clampRebaseContinuation(steps, { build: 'done' }, 2, false)).toBe(2);
  });
});
