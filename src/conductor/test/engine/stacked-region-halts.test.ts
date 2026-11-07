// Covers: task:9, task:10.1
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Conductor } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState } from '../../src/types/index.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { resolveActiveChild, type ActiveChildResolution } from '../../src/engine/child-cursor.js';
import { parseRoundId } from '../../src/engine/routing/route-types.js';

let root: string;
let statePath: string;
const child1 = parseChildId(1)!;
const activeChild1: ActiveChildResolution = {
  kind: 'active', child: child1, position: child1, isLeaf: false, branch: 'feat/c1/demo',
};
const cursorRefusals: Array<[ActiveChildResolution, string]> = [
  [{ kind: 'divergent', child: child1, check: 'closed-child-rewritten' }, 'child 1 failed active-child check closed-child-rewritten'],
  [{ kind: 'divergent', child: child1, check: 'range-not-ancestor' }, 'child 1 failed active-child check range-not-ancestor'],
  [{ kind: 'topology-unavailable', cause: 'plan-missing' }, 'slice topology is unavailable while child state exists (plan-missing)\nRecovery:\nai-conductor reseal --slug demo --path .docs/plans/demo.md --reason "«why»" --clear-halt'],
  [{ kind: 'topology-unavailable', cause: 'positions-changed', planPath: '.docs/plans/demo.md', recordedPositions: [1, 2], planPositions: [1, 3] }, 'slice topology is unavailable while child state exists (positions-changed); plan path .docs/plans/demo.md; recorded positions [1,2]; plan positions [1,3]\nRecovery:\nai-conductor reseal --slug demo --path .docs/plans/demo.md --reason "«why»" --clear-halt'],
  [{ kind: 'detached-head' }, 'worktree is in detached HEAD while resolving the active child\nRecovery:\ngit switch feat/daemon-demo'],
  [{ kind: 'git-error' }, 'git failed while resolving the active child cursor\nRecovery:\nrm -f .pipeline/HALT .pipeline/HALT.class'],
  [{ kind: 'git-error', unreadableRef: 'refs/conductor/demo/revalidate' }, 'cannot read refs/conductor/demo/revalidate while resolving the active child cursor'],
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

  it('does not try to close an already closed routed host after its BUILD region', async () => {
    const regionState = {
      acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
    } as const;
    await writeState(regionState);
    await mkdir(join(root, '.pipeline', 'children', '1'), { recursive: true });
    await writeFile(
      join(root, '.pipeline', 'children', '1', 'conduct-state.json'),
      JSON.stringify(regionState),
    );
    const advanceChildRegion = vi.fn(async () => ({ kind: 'refused' as const, reason: 'closed ref already exists' }));
    const cursor: ActiveChildResolution = {
      kind: 'repair-pending', child: parseChildId(3)!, position: parseChildId(3)!, isLeaf: true,
      branch: 'feat/daemon-demo', repairChildren: [child1],
      routedRepair: { child: child1, roundId: parseRoundId('r1')! },
    };
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: statePath,
      featureSlug: 'demo',
      fromStep: 'build_review',
      events: new ConductorEventEmitter(),
      stepRunner: { run: async () => ({ success: true }) },
      config: { stacked_prs: { enabled: true } } as never,
      childRegionLifecycle: {
        resolveActiveChild: async () => cursor,
        enterChildRegion: async () => ({ kind: 'completed' }),
        advanceChildRegion,
      },
    });

    await conductor.run();

    expect(advanceChildRegion).not.toHaveBeenCalled();
  });
});
