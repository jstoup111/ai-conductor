// Covers: task:69
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { leafBranchFor } from '../../../src/engine/feature-branch-identity.js';
import { createRepairObligationStore } from '../../../src/engine/repair-obligations.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { enterHostRegion } from '../../../src/engine/routing/host-region-entry.js';
import { admitRound } from '../../../src/engine/routing/round-admission.js';
import { createRouteRecord, readRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { closureRefFor } from '../../../src/engine/routing/routing-refs.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const child = parseChildId(1)!;
const roundId = parseRoundId('r1')!;
const planPath = '.docs/plans/demo.md';
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(input: { taskId: string; restage?: boolean; taskStatus?: boolean }) {
  const repo = await mkdtemp(join(tmpdir(), 'host-region-obligation-'));
  roots.push(repo);
  const git = makeGitRunner(repo);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'host-region@example.invalid']);
  await git(['config', 'user.name', 'Host region']);
  await mkdir(join(repo, '.docs', 'plans'), { recursive: true });
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await writeFile(join(repo, planPath), `### Task ${input.taskId}: Existing work\n`);
  await git(['add', '.gitignore', planPath]);
  await git(['commit', '-qm', 'base']);
  await git(['checkout', '-qb', 'feat/c1/demo']);
  await writeFile(join(repo, 'child.txt'), 'closed child\n');
  await git(['add', 'child.txt']);
  await git(['commit', '-qm', 'closed child']);
  const closure = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await git(['update-ref', closureRefFor('demo', child), closure]);
  await git(['checkout', '-qb', leafBranchFor('demo')]);
  await writeFile(join(repo, 'leaf.txt'), 'leaf\n');
  await git(['add', 'leaf.txt']);
  await git(['commit', '-qm', 'leaf']);
  await mkdir(join(repo, '.pipeline', 'children', '1'), { recursive: true });
  await writeFile(join(repo, '.pipeline', 'conduct-state.json'), JSON.stringify({ feature_desc: 'demo' }));
  await writeFile(join(repo, '.pipeline', 'children', '1', 'conduct-state.json'), JSON.stringify({
    acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
  }));
  if (input.taskStatus !== false) {
    await writeFile(join(repo, '.pipeline', 'task-status.json'), JSON.stringify({
      tasks: [{ id: input.taskId, status: 'completed' }],
    }));
  }
  const created = await createRouteRecord(repo, 'demo', {
    roundId,
    sealedAuthored: 1,
    kind: 'audit',
    items: [{
      findingId: `finding-${input.taskId}`,
      kind: 'audit', owner: child, host: child, reason: 'task-slice', fallback: [],
      existingTask: true,
      taskIds: [input.taskId],
      ...(input.restage === false ? { restage: false } : {}),
    }],
    allocation: { [child]: { remTaskIds: [], blockBodies: [] } },
  });
  if (created.kind !== 'created') throw new Error(`could not create route record: ${created.kind}`);
  const admitted = await admitRound(repo, 'demo', created.record, child, { git });
  if (admitted.kind !== 'admitted') throw new Error(admitted.detail);
  return { repo, git, closure };
}

function enter(subject: Awaited<ReturnType<typeof fixture>>) {
  return enterHostRegion({
    worktree: subject.repo, slug: 'demo', roundId, host: child,
    emitter: new ConductorEventEmitter(), git: subject.git, planPath,
  });
}

describe('routed host region obligation entry', () => {
  it('binds an existing task to the host branch and restages it before repair', async () => {
    const subject = await fixture({ taskId: 'T1' });

    await expect(enter(subject)).resolves.toMatchObject({ kind: 'entered' });
    const record = await readRouteRecord(subject.repo, 'demo', roundId);
    expect(record).toMatchObject({
      kind: 'record',
      record: { items: [expect.objectContaining({ obligation: expect.objectContaining({
        branch: 'feat/c1/demo', head: subject.closure,
      }) })] },
    });
    await expect(readFile(join(subject.repo, '.pipeline', 'task-status.json'), 'utf8').then(JSON.parse))
      .resolves.toMatchObject({ tasks: [expect.objectContaining({ id: 'T1', status: 'pending' })] });
  });

  it('admits a mixed-round binding without restaging its existing task', async () => {
    const subject = await fixture({ taskId: 'T2', restage: false, taskStatus: false });

    await expect(enter(subject)).resolves.toMatchObject({ kind: 'entered' });
    const record = await readRouteRecord(subject.repo, 'demo', roundId);
    expect(record).toMatchObject({
      kind: 'record',
      record: { items: [expect.objectContaining({ taskIds: ['T2'], restage: false, obligation: expect.any(Object) })] },
    });
  });

  it('refuses before repairing when an existing-task restage cannot be completed', async () => {
    const subject = await fixture({ taskId: 'T1', taskStatus: false });

    await expect(enter(subject)).resolves.toMatchObject({ kind: 'refused', detail: expect.stringContaining('re-stage') });
    await expect(readRouteRecord(subject.repo, 'demo', roundId)).resolves.toMatchObject({
      kind: 'record', record: { hosts: { 1: 'admitted' } },
    });
  });

  it('rebuilds missing engine-state obligations from a repairing route record', async () => {
    const subject = await fixture({ taskId: 'T1' });
    await expect(enter(subject)).resolves.toMatchObject({ kind: 'entered' });
    await rm(join(subject.repo, '.pipeline', 'engine-state.json'));

    await expect(enter(subject)).resolves.toMatchObject({ kind: 'resume' });
    const obligations = await createRepairObligationStore(
      subject.repo,
      join(subject.repo, '.pipeline', 'engine-state.json'),
    ).read();
    expect(obligations).toMatchObject({ ok: true });
    if (!obligations.ok) throw new Error(obligations.message);
    expect(Object.values(obligations.value.records)).toEqual([
      expect.objectContaining({ baseline: expect.objectContaining({ branch: 'feat/c1/demo', head: subject.closure }) }),
    ]);
  });

});
