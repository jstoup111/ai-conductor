// Covers: task:10.1
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Conductor } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState } from '../../src/types/index.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { resolveActiveChild, type ActiveChildResolution } from '../../src/engine/child-cursor.js';

let root: string;
let statePath: string;
const child1 = parseChildId(1)!;
const activeChild1: ActiveChildResolution = {
  kind: 'active', child: child1, position: child1, isLeaf: false, branch: 'feat/c1/demo',
};
const cursorRefusals: Array<[ActiveChildResolution, string]> = [
  [{ kind: 'divergent', child: child1 }, 'child 1 diverged from its declared successor; restack required (#2943)'],
  [{ kind: 'envelope-missing' }, 'coverage-binding envelope is missing while child state exists'],
  [{ kind: 'detached-head' }, 'worktree is in detached HEAD while resolving the active child'],
  [{ kind: 'git-error' }, 'git failed while resolving the active child cursor'],
];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'stacked-region-halt-'));
  await mkdir(join(root, '.pipeline'), { recursive: true });
  statePath = join(root, '.pipeline', 'conduct-state.json');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeState(state: ConductState): Promise<void> {
  await writeFile(statePath, JSON.stringify({ feature_desc: 'demo', ...state }));
}

async function haltContents(): Promise<{ body: string; haltClass: string }> {
  return {
    body: await readFile(join(root, '.pipeline', 'HALT'), 'utf8'),
    haltClass: await readFile(join(root, '.pipeline', 'HALT.class'), 'utf8'),
  };
}

describe('stacked BUILD-region refusals', () => {
  it.each(cursorRefusals)('halts needs-human for cursor refusal %o before dispatch', async (cursor, expected) => {
    await writeState({ acceptance_specs: 'pending' });
    const run = vi.fn().mockResolvedValue({ success: true });
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: statePath,
      featureSlug: 'demo',
      fromStep: 'acceptance_specs',
      events: new ConductorEventEmitter(),
      stepRunner: { run },
      config: { stacked_prs: { enabled: true } } as never,
      childRegionLifecycle: { resolveActiveChild: async () => cursor },
    });

    await conductor.run();

    expect(run).not.toHaveBeenCalled();
    await expect(haltContents()).resolves.toEqual({
      body: `child BUILD region refused: ${expected}\n`,
      haltClass: 'needs-human',
    });
  });

  it.each([
    ['startChild', 'reserved child namespace already exists: refs/heads/feat/c1'],
    ['switchToChild', 'worktree is dirty: src/a.ts'],
  ])('halts needs-human for %s refusal before dispatch', async (_operation, reason) => {
    await writeState({ acceptance_specs: 'pending' });
    const run = vi.fn().mockResolvedValue({ success: true });
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: statePath,
      featureSlug: 'demo',
      fromStep: 'acceptance_specs',
      events: new ConductorEventEmitter(),
      stepRunner: { run },
      config: { stacked_prs: { enabled: true } } as never,
      childRegionLifecycle: {
        resolveActiveChild: async () => activeChild1,
        enterChildRegion: async () => ({ kind: 'refused', reason }),
      },
    });

    await conductor.run();

    expect(run).not.toHaveBeenCalled();
    await expect(haltContents()).resolves.toEqual({
      body: `child BUILD region refused: child 1 region entry refused: ${reason}\n`,
      haltClass: 'needs-human',
    });
  });

  it('treats an unconfigured non-Git N=1 workspace as having no child', async () => {
    await expect(resolveActiveChild(root, 'demo')).resolves.toEqual({ kind: 'no-child' });
  });

  it.each([
    'cannot move leaf branch feat/daemon-demo; unrelated commit deadbeef',
    'cannot move leaf branch feat/daemon-demo; concurrent update refused',
  ])('halts needs-human for moveLeaf refusal without dispatching another region step', async (reason) => {
    const regionState = {
      acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
    } as const;
    await writeState(regionState);
    await mkdir(join(root, '.pipeline', 'children', '1'), { recursive: true });
    await writeFile(
      join(root, '.pipeline', 'children', '1', 'conduct-state.json'),
      JSON.stringify(regionState),
    );
    const run = vi.fn().mockResolvedValue({ success: true });
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: statePath,
      featureSlug: 'demo',
      fromStep: 'build_review',
      events: new ConductorEventEmitter(),
      stepRunner: { run },
      childRegionLifecycle: {
        resolveActiveChild: async () => activeChild1,
        enterChildRegion: async () => ({ kind: 'completed' }),
        advanceChildRegion: async () => ({ kind: 'refused', reason }),
      },
    });

    await conductor.run();

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toBe('build_review');
    const halt = await haltContents();
    expect(halt.haltClass).toBe('needs-human');
    expect(halt.body).toContain('child 1 region exit refused');
    expect(halt.body).toContain(reason);
  });
});
