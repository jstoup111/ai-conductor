import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createFilesystemConductStateStore } from '../../src/engine/filesystem-conduct-state-store.js';
import { writeVerdict } from '../../src/engine/gate-verdicts.js';
import { creditKickbackGateLaps, readKickbackLedger, type KickbackGateEntry } from '../../src/engine/kickback-ledger.js';
import { reverifyOrInvalidateRebaseGate } from '../../src/engine/rebase.js';
import { applyRebaseTransition } from '../../src/engine/rebase-transition.js';

const dirs: string[] = [];
afterEach(async () => { while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true }); });

describe('N=1 rebase refund stays unchanged (sweep)', () => {
  // Covers: task:21
  it('refunds an N=1 build_review invalidation exactly as before and writes no cause on the rebase operation record', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rebase-transition-sweep-'));
    dirs.push(dir);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline/conduct-state.json'), JSON.stringify({ build_review: 'done' }));
    const entry = { count: 1, cumulative: 2, laps: 3, treeHash: null, lastReason: '', priorVerdict: true, resolvedBefore: 0 } as KickbackGateEntry;
    await writeFile(join(dir, '.pipeline/kickback-ledger.json'), JSON.stringify({ version: 1, gates: { build_review: entry } }));
    await writeVerdict(dir, 'build_review', { satisfied: true, checkedAt: 1, reason: 'approved' });
    const before = (await readKickbackLedger(dir)).gates.build_review!;
    // The N=1 rebase writer reopens the gate with no restack cause.
    await reverifyOrInvalidateRebaseGate(dir, 'build_review', undefined, 'changed replay', true);

    const result = await applyRebaseTransition({
      projectRoot: dir,
      stateStore: createFilesystemConductStateStore(join(dir, '.pipeline/conduct-state.json')),
      replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      invalidated: ['build_review'],
      preserved: [],
      preservedCandidates: [],
    });

    expect(result.stateResult).toBe('applied');
    expect(result.convergenceCredit).toEqual({ gate: 'build_review' });
    expect((await readKickbackLedger(dir)).gates.build_review).toEqual(creditKickbackGateLaps(before));
    const rebaseRecord = JSON.parse(await readFile(join(dir, '.pipeline/gates/rebase.json'), 'utf8')) as { rebaseOperation: Record<string, unknown> };
    expect(rebaseRecord.rebaseOperation.status).toBe('applied');
    expect(rebaseRecord.rebaseOperation).not.toHaveProperty('cause');
    const buildReview = JSON.parse(await readFile(join(dir, '.pipeline/gates/build_review.json'), 'utf8')) as { kickback: Record<string, unknown> };
    expect(buildReview.kickback).toEqual({ from: 'rebase', evidence: 'changed replay' });
  });
});
