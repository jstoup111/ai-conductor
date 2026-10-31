// Covers: task:9
import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { makeGitRunner } from '../../../src/engine/rebase.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import type { RestackResolver } from '../../../src/engine/restack/restack-resolver.js';
import { createSweepRepository, removeAll, sealStack, stackRefs } from './restack-sweepG2-fixture.js';

const execFile = promisify(execFileCallback);
const cleanup: string[] = [];

afterEach(async () => {
  await removeAll(cleanup);
});

async function addHaltRecords(subject: Awaited<ReturnType<typeof createSweepRepository>>) {
  await subject.commit('record one', '.docs/halted/demo.md', '# Halt record\nHalted at: 2026-10-31T10:00:00.000Z\n');
  await subject.commit('record two', '.docs/halted/demo.md', '# Halt record\nHalted at: 2026-10-31T11:00:00.000Z\n');
}

function inTemporaryCheckout(context: Parameters<RestackResolver>[0]) {
  return (args: string[]) => execFile('git', args, { cwd: context.projectRoot, env: { ...process.env, ...context.environment } });
}

describe('halt-record bookkeeping preserves restack refusals (real local Git)', () => {
  it('does not mask silent-revert replay-mismatch after two halt-only commits', async () => {
    const subject = await createSweepRepository('restack-halt-record-ownership-', cleanup);
    await subject.write('src/g.ts', 'original\n');
    await subject.git(['add', 'src/g.ts']);
    await subject.commit('base', 'base.txt', 'base\n');
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    const c1 = await subject.commit('C1', 'c1.txt', 'c1\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    await subject.commit('add X', 'src/g.ts', 'X\n');
    await subject.commit('revert X', 'src/g.ts', 'original\n');
    await addHaltRecords(subject);
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', await subject.rev('HEAD')]);
    await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
    await subject.commit('L1', 'leaf.txt', 'leaf\n');
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await subject.commit('repair adds X', 'src/g.ts', 'X\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    await sealStack(subject.repo);
    const before = await stackRefs(subject);

    await expect(runRestack({ worktree: subject.repo, slug: 'demo', cause: 'feature-repair', git: makeGitRunner(subject.repo) }))
      .resolves.toEqual({ kind: 'halted' });

    const halt = await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain('replay-mismatch');
    expect(halt).toContain('src/g.ts');
    expect(await stackRefs(subject)).toBe(before);
  });

  it('does not let bookkeeping hide the FR-9 rejection of a resolver tip that drops C2', async () => {
    const subject = await createSweepRepository('restack-halt-record-fr9-', cleanup);
    await subject.write('src/c.ts', 'one\ntwo\n');
    await subject.git(['add', 'src/c.ts']);
    await subject.commit('base', 'base.txt', 'base\n');
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    const c1 = await subject.commit('C1', 'c1.txt', 'c1\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    await subject.commit('C2', 'src/c.ts', 'one\nchild\n');
    await addHaltRecords(subject);
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', await subject.rev('HEAD')]);
    await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
    await subject.commit('L1', 'leaf.txt', 'leaf\n');
    await subject.git(['checkout', '-q', 'main']);
    const newDefault = await subject.commit('main advance', 'src/c.ts', 'one\nmain\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    await sealStack(subject.repo);
    const before = await stackRefs(subject);
    const resolver: RestackResolver = async (context) => {
      await inTemporaryCheckout(context)(['rebase', '--skip']);
      return { resolved: true };
    };

    await expect(runRestack({ worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault, git: makeGitRunner(subject.repo), resolver, resolverCap: 1 }))
      .resolves.toEqual({ kind: 'halted' });

    const halt = await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain('feature commit(s) lost during resolution: C2');
    expect(await stackRefs(subject)).toBe(before);
    const movedHistory = (await subject.git(['log', '--all', '--format=%s'])).stdout;
    expect(movedHistory).not.toContain('halt record: demo');
  });

  it('does not let halt-record pinning bypass flatten_refused for a merge that also conflicts on source', async () => {
    const subject = await createSweepRepository('restack-halt-record-flatten-', cleanup);
    await subject.write('src/q.ts', 'base\n');
    await subject.git(['add', 'src/q.ts']);
    await subject.commit('base', 'base.txt', 'base\n');
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    const c1 = await subject.commit('C1', 'c1.txt', 'c1\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    await subject.commit('C2', 'src/q.ts', 'child\n');
    await subject.git(['checkout', '-qb', 'side', c1]);
    await subject.write('src/q.ts', 'side\n');
    await subject.write('.docs/halted/demo.md', '# Halt record\nHalted at: 2026-10-31T12:00:00.000Z\n');
    await subject.git(['add', 'src/q.ts', '.docs/halted/demo.md']);
    await subject.git(['commit', '-qm', 'side record and q']);
    await subject.git(['checkout', '-q', 'feat/c2/demo']);
    await subject.git(['merge', '--no-ff', '--no-commit', 'side']).catch(() => undefined);
    await subject.write('src/q.ts', 'merged\n');
    await subject.git(['add', 'src/q.ts', '.docs/halted/demo.md']);
    await subject.git(['commit', '-qm', 'merge side record and q']);
    const merge = await subject.rev('HEAD');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', await subject.rev('HEAD')]);
    await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
    await subject.commit('L1', 'leaf.txt', 'leaf\n');
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await subject.commit('repair q', 'src/q.ts', 'repair\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    await sealStack(subject.repo);
    const before = await stackRefs(subject);

    await expect(runRestack({ worktree: subject.repo, slug: 'demo', cause: 'feature-repair', git: makeGitRunner(subject.repo) }))
      .resolves.toEqual({ kind: 'halted' });

    const halt = await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain('flatten_refused');
    expect(halt).toContain(merge);
    expect((await subject.git(['merge-base', '--is-ancestor', merge, 'feat/c2/demo'])).stderr).toBe('');
    expect(await stackRefs(subject)).toBe(before);
  });
});
