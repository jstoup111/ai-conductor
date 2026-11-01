// Covers: task:8, task:9
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import { parseChildId } from '../../src/engine/child-context.js';
import { refreshPublishedStackMembers } from '../../src/engine/finish-publication-production.js';
import { executeRemoteGit } from '../../src/engine/remote-git-operations.js';
import { pushedTipRef } from '../../src/engine/push-lease.js';
import { writePublicationRecord } from '../../src/engine/stack-publication-record.js';
import { refreshLedgerRefFor } from '../../src/engine/stack-refresh-ledger.js';
import type { GithubMutationExecutionContext } from '../../src/engine/tracker-client.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const roots: string[] = [];
const positions = [parseChildId(1)!, parseChildId(3)!, parseChildId(5)!] as const;
const branches = ['feat/c1/demo', 'feat/c3/demo', 'feat/daemon-demo'] as const;

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function git(cwd: string, args: readonly string[], input?: string) {
  const result = await execa('git', [...args], { cwd, input, reject: false });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode ?? 1 };
}

async function tip(cwd: string, ref: string): Promise<string> {
  const result = await git(cwd, ['rev-parse', '--verify', ref]);
  if (result.exitCode !== 0) throw new Error(`missing ${ref}`);
  return result.stdout.trim();
}

async function commit(repo: string, name: string): Promise<string> {
  await writeFile(join(repo, `${name}.txt`), `${name}\n`);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', name]);
  return tip(repo, 'HEAD');
}

function mutation(): GithubMutationExecutionContext {
  return {
    provenance: { repository: 'acme/rocket', defaultBranch: 'main', specBranch: 'spec/demo', featureMarker: '.docs/specs/demo.md', publication: 'initial' },
    dependencies: {
      resolveMachineOwner: async () => ({ resolved: true, id: 'alice' }),
      provenanceDiscovery: { readCommittedRecords: async () => [{ path: '.docs/specs/demo.md', content: 'Owner: alice\n' }] },
    },
  };
}

const localRemoteGit: typeof executeRemoteGit = async (args, dependencies) => executeRemoteGit(args, {
  ...dependencies,
  config: async () => ({ stdout: 'git@github.com:acme/rocket.git\n' }),
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'finish-refresh-'));
  roots.push(root);
  const repo = join(root, 'repo');
  const origin = join(root, 'origin.git');
  await mkdir(repo);
  await initTestRepo(repo);
  await commit(repo, 'seed');
  await git(root, ['init', '--bare', '--initial-branch=main', origin]);
  await git(repo, ['remote', 'add', 'origin', origin]);
  const oldTips: string[] = [];
  for (const [index, branch] of branches.entries()) {
    await git(repo, index === 0 ? ['checkout', '-b', branch] : ['checkout', '-b', branch]);
    oldTips.push(await commit(repo, `old-${index}`));
    await git(repo, ['push', 'origin', `HEAD:refs/heads/${branch}`]);
  }
  await writePublicationRecord(repo, 'demo', undefined, {
    version: 1,
    members: branches.map((branch, index) => ({ position: positions[index]!, branch, pr: 101 + index })),
  });
  for (const [index, branch] of branches.entries()) await git(repo, ['update-ref', pushedTipRef('demo', branch), oldTips[index]!]);

  const newTips: string[] = [];
  await git(repo, ['checkout', branches[0]]);
  await git(repo, ['reset', '--hard', 'main']);
  newTips.push(await commit(repo, 'new-0'));
  await git(repo, ['checkout', branches[1]]);
  await git(repo, ['reset', '--hard', newTips[0]!]);
  newTips.push(await commit(repo, 'new-1'));
  await git(repo, ['checkout', branches[2]]);
  await git(repo, ['reset', '--hard', newTips[1]!]);
  newTips.push(await commit(repo, 'new-2'));

  const ledger = {
    version: 1,
    members: Object.fromEntries(branches.map((branch, index) => [branch, {
      position: positions[index], pr: 101 + index, publishedTip: oldTips[index], recordedTip: newTips[index],
    }])),
    rounds: [], aboveOwed: [], posted: [],
  };
  const blob = await git(repo, ['hash-object', '-w', '--stdin'], JSON.stringify(ledger));
  await git(repo, ['update-ref', refreshLedgerRefFor('demo'), blob.stdout.trim()]);
  return { repo, origin, oldTips, newTips };
}

describe('FINISH published member refresh (real Git)', () => {
  it('pushes pending members bottom-up, records their receipts, and emits one event each', async () => {
    const subject = await fixture();
    const events: Array<{ pr: number; oldTip: string; newTip: string }> = [];
    await refreshPublishedStackMembers({
      root: subject.repo, slug: 'demo', mutation: mutation(),
      remoteGit: localRemoteGit,
      git: async (args, options) => git(subject.repo, args, options?.input),
      events: { emit: async (event) => { events.push(event); } },
    });

    expect(events.map((event) => event.pr)).toEqual([101, 102, 103]);
    for (const [index, branch] of branches.entries()) {
      expect(await tip(subject.origin, `refs/heads/${branch}`)).toBe(subject.newTips[index]);
      expect(await tip(subject.repo, pushedTipRef('demo', branch))).toBe(subject.newTips[index]);
    }
    expect(await git(subject.origin, ['merge-base', '--is-ancestor', subject.newTips[0]!, subject.newTips[1]!])).toMatchObject({ exitCode: 0 });
    expect(await git(subject.origin, ['merge-base', '--is-ancestor', subject.newTips[1]!, subject.newTips[2]!])).toMatchObject({ exitCode: 0 });
  });

  it('resumes by skipping members whose pushed receipt already equals their recorded tip', async () => {
    const subject = await fixture();
    await refreshPublishedStackMembers({
      root: subject.repo, slug: 'demo', mutation: mutation(),
      remoteGit: localRemoteGit,
      git: async (args, options) => git(subject.repo, args, options?.input),
    });
    const events: unknown[] = [];
    await refreshPublishedStackMembers({
      root: subject.repo, slug: 'demo', mutation: mutation(),
      remoteGit: localRemoteGit,
      git: async (args, options) => git(subject.repo, args, options?.input),
      events: { emit: async (event) => { events.push(event); } },
    });
    expect(events).toEqual([]);
  });
});
