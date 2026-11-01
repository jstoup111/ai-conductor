// Covers: task:9
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { restackResolverForStepRunner } from '../../../src/daemon-cli.js';
import { parseChildId } from '../../../src/engine/child-context.js';
import { resolveRestackConflict } from '../../../src/engine/restack/restack-resolver.js';
import { parseCommitSha, type CommitSha } from '../../../src/engine/restack/restack-types.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const stamp = { name: 'Journal Committer', email: 'journal@example.test', date: '2030-02-03T04:05:06Z' };

function sha(value: string): CommitSha {
  const parsed = parseCommitSha(value.trim());
  if (!parsed) throw new Error(`expected SHA, got ${value}`);
  return parsed;
}

async function invokeThroughDaemonResolver(operatorDecision?: { answer: string; commit: string; paths: readonly string[] }) {
  const repo = await mkdtemp(join(tmpdir(), 'restack-resolver-wiring-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.name', 'Fixture']);
  await git(['config', 'user.email', 'fixture@example.test']);
  await writeFile(join(repo, 'shared.txt'), 'base\n');
  await git(['add', 'shared.txt']);
  await git(['commit', '-qm', 'base']);
  const oldParent = sha((await git(['rev-parse', 'HEAD'])).stdout);
  await git(['checkout', '-qb', 'child']);
  await writeFile(join(repo, 'shared.txt'), 'child\n');
  await git(['commit', '-am', 'child change', '-q']);
  const oldTip = sha((await git(['rev-parse', 'HEAD'])).stdout);
  await git(['checkout', '-q', 'main']);
  await writeFile(join(repo, 'shared.txt'), 'main\n');
  await git(['commit', '-am', 'main change', '-q']);
  const newParent = sha((await git(['rev-parse', 'HEAD'])).stdout);

  const resolveRebaseConflict = vi.fn(async () => ({ resolved: false as const, reason: 'stop after observing context' }));
  const resolver = restackResolverForStepRunner({ resolveRebaseConflict });
  if (!resolver) throw new Error('expected daemon resolver wiring');
  await resolveRestackConflict({
    worktree: repo,
    range: { child: parseChildId(2)!, oldParent, oldTip, kind: 'active' },
    newParent,
    stamp,
    resolver,
    cap: 1,
    ...(operatorDecision === undefined ? {} : { operatorDecision }),
  });
  return resolveRebaseConflict;
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

describe('restack resolver production wiring', () => {
  it('passes the supplied operator decision through the daemon-wired step runner', async () => {
    const operatorDecision = { answer: 'keep upstream', commit: 'a'.repeat(40), paths: ['shared.txt'] };
    const resolveRebaseConflict = await invokeThroughDaemonResolver(operatorDecision);

    expect(resolveRebaseConflict).toHaveBeenCalledWith(expect.objectContaining({ operatorDecision }));
  });

  it('does not add an operator decision when none was supplied', async () => {
    const resolveRebaseConflict = await invokeThroughDaemonResolver();

    expect(resolveRebaseConflict).toHaveBeenCalledWith(expect.not.objectContaining({ operatorDecision: expect.anything() }));
  });
});
