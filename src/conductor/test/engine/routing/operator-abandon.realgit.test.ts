// Covers: task:22
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mutationPort = vi.hoisted(() => ({ applyBatch: vi.fn() }));

vi.mock('../../../src/engine/conduct-state-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/conduct-state-store.js')>();
  return {
    ...actual,
    createRoutedConductStateStore: (...args: Parameters<typeof actual.createRoutedConductStateStore>) => {
      const store = actual.createRoutedConductStateStore(...args);
      return {
        ...store,
        applyBatch: async (...batch: Parameters<typeof store.applyBatch>) => {
          mutationPort.applyBatch(...batch);
          return store.applyBatch(...batch);
        },
      };
    },
  };
});

import { parseChildId } from '../../../src/engine/child-context.js';
import { leafBranchFor } from '../../../src/engine/feature-branch-identity.js';
import { verdictPathFor } from '../../../src/engine/gate-verdicts.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { abandonOperatorRound, openOperatorRound } from '../../../src/engine/routing/operator-round.js';
import { readRepairMarker, readRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { closureRefFor, rejectedPinRefFor } from '../../../src/engine/routing/routing-refs.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const roots: string[] = [];
const host = parseChildId(1)!;
const carried = parseChildId(2)!;
const roundId = parseRoundId('r1')!;
const regionStatePath = (root: string) => join(root, '.pipeline', 'children', '1', 'conduct-state.json');

afterEach(async () => {
  mutationPort.applyBatch.mockClear();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(options: { readonly carry?: boolean } = {}) {
  const repo = await mkdtemp(join(tmpdir(), 'operator-abandon-'));
  roots.push(repo);
  const git = makeGitRunner(repo);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'operator-abandon@example.invalid']);
  await git(['config', 'user.name', 'Operator abandon']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await git(['add', '.gitignore']);
  await git(['commit', '-qm', 'initial']);

  await git(['checkout', '-qb', 'feat/c1/demo']);
  await writeFile(join(repo, 'child-1.txt'), 'closed child one\n');
  await git(['add', 'child-1.txt']);
  await git(['commit', '-qm', 'closed child one']);
  const closure = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await git(['update-ref', closureRefFor('demo', host), closure]);
  await writeFile(join(repo, 'reviewer-edit.txt'), 'reviewer edit\n');
  await git(['add', 'reviewer-edit.txt']);
  await git(['commit', '-qm', 'reviewer edit']);
  const abandonedTip = (await git(['rev-parse', 'HEAD'])).stdout.trim();

  let carriedTip: string | undefined;
  if (options.carry) {
    await git(['checkout', '-qb', 'feat/c2/demo', closure]);
    await writeFile(join(repo, 'child-2.txt'), 'closed child two\n');
    await git(['add', 'child-2.txt']);
    await git(['commit', '-qm', 'closed child two']);
    const childTwoClosure = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    await git(['update-ref', closureRefFor('demo', carried), childTwoClosure]);
    await writeFile(join(repo, 'carried-edit.txt'), 'carried reviewer edit\n');
    await git(['add', 'carried-edit.txt']);
    await git(['commit', '-qm', 'carried reviewer edit']);
    carriedTip = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  }

  await git(['checkout', '-qb', leafBranchFor('demo'), closure]);
  await writeFile(join(repo, 'leaf.txt'), 'leaf\n');
  await git(['add', 'leaf.txt']);
  await git(['commit', '-qm', 'leaf']);
  await mkdir(join(repo, '.pipeline', 'children', '1', 'gates'), { recursive: true });
  const state = JSON.stringify({
    acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done', last_step: 'build_review',
  }, null, 2) + '\n';
  await writeFile(regionStatePath(repo), state);
  for (const step of ['acceptance_specs', 'build', 'test_suite', 'build_review'] as const) {
    await writeFile(verdictPathFor(repo, step, host), `${step} original verdict\n`);
  }
  const verdicts = await Promise.all(
    (['acceptance_specs', 'build', 'test_suite', 'build_review'] as const)
      .map(async (step) => [step, await readFile(verdictPathFor(repo, step, host), 'utf8')] as const),
  );
  return { repo, git, closure, abandonedTip, carriedTip, state, verdicts: Object.fromEntries(verdicts) };
}

async function open(subject: Awaited<ReturnType<typeof fixture>>, carry = false): Promise<void> {
  await expect(openOperatorRound({
    worktree: subject.repo,
    slug: 'demo',
    roundId,
    host,
    reason: 'abandon the reviewer landing',
    operator: 'operator@example.test',
    carried: carry ? [{ child: carried, tip: subject.carriedTip! as never }] : [],
    emitter: new ConductorEventEmitter(),
    git: subject.git,
  })).resolves.toMatchObject({ kind: 'opened' });
  mutationPort.applyBatch.mockClear();
}

describe('abandon operator round (real local Git)', () => {
  it('pins and resets the rejected host, restores its region through the mutation port, and removes the marker', async () => {
    const subject = await fixture();
    await open(subject);

    await expect(abandonOperatorRound({ worktree: subject.repo, slug: 'demo', roundId, host, git: subject.git }))
      .resolves.toMatchObject({ kind: 'abandoned' });

    await expect(subject.git(['rev-parse', 'refs/heads/feat/c1/demo']).then((result) => result.stdout.trim())).resolves.toBe(subject.closure);
    await expect(subject.git(['rev-parse', rejectedPinRefFor('demo', roundId, host)]).then((result) => result.stdout.trim())).resolves.toBe(subject.abandonedTip);
    await expect(readRepairMarker(subject.repo, 'demo')).resolves.toEqual({ kind: 'absent' });
    await expect(readRouteRecord(subject.repo, 'demo', roundId)).resolves.toMatchObject({
      kind: 'record', record: { hosts: { 1: 'abandoned' }, operator: { abandon: { rejectedTip: subject.abandonedTip, resetTip: subject.closure, stage: 'synced' } } },
    });
    await expect(readFile(regionStatePath(subject.repo), 'utf8')).resolves.toBe(subject.state);
    for (const [step, bytes] of Object.entries(subject.verdicts)) {
      await expect(readFile(verdictPathFor(subject.repo, step as 'acceptance_specs', host), 'utf8')).resolves.toBe(bytes);
    }
    expect(mutationPort.applyBatch).toHaveBeenCalledWith(expect.objectContaining({
      name: 'restore abandoned operator host 1 region',
      mutations: expect.arrayContaining([expect.objectContaining({ field: 'acceptance_specs', next: 'done' })]),
    }));
  });

  it('pins a rewritten host tip and leaves carried child commits untouched', async () => {
    const subject = await fixture({ carry: true });
    await open(subject, true);
    await writeFile(join(subject.repo, 'rewritten.txt'), 'rewritten host tip\n');
    await subject.git(['add', 'rewritten.txt']);
    await subject.git(['commit', '-qm', 'rewritten host tip', '--no-verify']);
    const rewritten = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim();

    await expect(abandonOperatorRound({ worktree: subject.repo, slug: 'demo', roundId, host, git: subject.git }))
      .resolves.toMatchObject({ kind: 'abandoned' });

    await expect(subject.git(['rev-parse', rejectedPinRefFor('demo', roundId, host)]).then((result) => result.stdout.trim())).resolves.toBe(rewritten);
    await expect(subject.git(['rev-parse', 'refs/heads/feat/c2/demo']).then((result) => result.stdout.trim())).resolves.toBe(subject.carriedTip);
    await expect(readRouteRecord(subject.repo, 'demo', roundId)).resolves.toMatchObject({
      kind: 'record', record: { hosts: { 1: 'abandoned' }, operator: { abandon: { rejectedTip: rewritten } } },
    });
  });
});
