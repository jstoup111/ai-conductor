import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFilesystemConductStateStore } from '../../src/engine/filesystem-conduct-state-store.js';
import { readVerdict } from '../../src/engine/gate-verdicts.js';
import { applyRebaseTransition } from '../../src/engine/rebase-transition.js';

const dirs: string[] = [];
afterEach(async () => { while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true }); });

describe('applyRebaseTransition', () => {
  it('uses one expected-value batch and leaves skipped gates alone', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rebase-transition-'));
    dirs.push(dir);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline/conduct-state.json'), JSON.stringify({ build_review: 'done', manual_test: 'skipped', acceptance_specs: 'done' }));
    const result = await applyRebaseTransition({
      projectRoot: dir,
      stateStore: createFilesystemConductStateStore(join(dir, '.pipeline/conduct-state.json')),
      operationId: 'operation-1',
      replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      invalidated: ['build_review', 'manual_test'],
      preserved: ['prd_audit'],
    });
    expect(result.stateResult).toBe('applied');
    expect(JSON.parse(await (await import('node:fs/promises')).readFile(join(dir, '.pipeline/conduct-state.json'), 'utf8'))).toMatchObject({ build_review: 'pending', manual_test: 'skipped', acceptance_specs: 'done' });
    expect((await readVerdict(dir, 'rebase'))?.rebaseOperation).toMatchObject({ id: 'operation-1', status: 'applied' });
  });

  it('recognizes the same replay operation on a restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rebase-transition-'));
    dirs.push(dir);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline/conduct-state.json'), JSON.stringify({ build_review: 'done' }));
    const input = {
      projectRoot: dir,
      stateStore: createFilesystemConductStateStore(join(dir, '.pipeline/conduct-state.json')),
      replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      invalidated: ['build_review'] as const,
      preserved: [] as const,
    };
    expect((await applyRebaseTransition(input)).stateResult).toBe('applied');
    expect((await applyRebaseTransition(input)).stateResult).toBe('already-applied');
  });
});
