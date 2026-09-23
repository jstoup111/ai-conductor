// The SHIP criticality mirror writes labels onto the PR, so the publication
// provenance it resolves must be bound to that PR. Bound to the branch ref
// instead, the owner gate refused every mirror as `invalid-target`.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Conductor } from '../test-conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('SHIP PR criticality mirror provenance', () => {
  it('binds publication provenance to the PR it labels', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'ship-pr-criticality-'));
    roots.push(projectRoot);
    const prUrl = 'https://github.com/acme/conductor/pull/13';
    const subject = new Conductor({
      stateFilePath: join(projectRoot, '.pipeline', 'state.json'),
      stepRunner: { run: async () => ({ success: true }) },
      events: new ConductorEventEmitter(),
      projectRoot,
      daemon: true,
      baseBranch: 'main',
      config: {} as never,
      gh: vi.fn(async () => ({ stdout: '[]' })),
      git: vi.fn(async () => ({ stdout: '' })),
    });
    const resolvePublication = vi.fn(async () => undefined);
    (subject as any).resolveShipDraftPublicationDependencies = resolvePublication;

    await (subject as any).mirrorShipPrCriticalityLabels(prUrl, {
      worktree_branch: 'feat/daemon-task-13',
      feature_desc: 'task-13',
    });

    expect(resolvePublication).toHaveBeenCalledWith(expect.objectContaining({
      branch: 'feat/daemon-task-13',
      prUrl,
    }));
  });
});
