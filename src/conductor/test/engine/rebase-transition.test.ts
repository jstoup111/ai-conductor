import { describe, expect, it, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFilesystemConductStateStore } from '../../src/engine/filesystem-conduct-state-store.js';
import { readVerdict, writeVerdict } from '../../src/engine/gate-verdicts.js';
import { applyRebaseTransition } from '../../src/engine/rebase-transition.js';

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
      invalidated: ['build_review', 'manual_test'],
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

    expect(result.stateResult).toBe('applied');
    expect(await readVerdict(dir, 'prd_audit')).toEqual({
      satisfied: true,
      checkedAt: 2,
      reason: 'newer ordinary judgement',
    });
  });
});
