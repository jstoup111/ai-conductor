// Covers: task:8, task:9
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import { parseChildId } from '../../src/engine/child-context.js';
import { refreshPublishedStackMembers } from '../../src/engine/finish-publication-production.js';
import { executeRemoteGit } from '../../src/engine/remote-git-operations.js';
import { pushedTipIntentRef, pushedTipRef } from '../../src/engine/push-lease.js';
import { writePublicationRecord } from '../../src/engine/stack-publication-record.js';
import { refreshLedgerRefFor } from '../../src/engine/stack-refresh-ledger.js';
import type { GithubMutationExecutionContext } from '../../src/engine/tracker-client.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const roots: string[] = [];
const positions = [parseChildId(1)!, parseChildId(3)!, parseChildId(5)!, parseChildId(7)!] as const;
const branches = ['feat/c1/demo', 'feat/c3/demo', 'feat/c5/demo', 'feat/daemon-demo'] as const;

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

async function fixture(options: { readonly unchangedIndex?: number; readonly memberCount?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'finish-refresh-'));
  roots.push(root);
  const repo = join(root, 'repo');
  const origin = join(root, 'origin.git');
  await mkdir(repo);
  await initTestRepo(repo);
  await commit(repo, 'seed');
  await git(root, ['init', '--bare', '--initial-branch=main', origin]);
  await git(repo, ['remote', 'add', 'origin', origin]);
  const members = options.memberCount === undefined ? 3 : options.memberCount;
  const fixtureBranches = branches.slice(0, members);
  const fixturePositions = positions.slice(0, members);
  const oldTips: string[] = [];
  for (const [index, branch] of fixtureBranches.entries()) {
    await git(repo, index === 0 ? ['checkout', '-b', branch] : ['checkout', '-b', branch]);
    oldTips.push(await commit(repo, `old-${index}`));
    await git(repo, ['push', 'origin', `HEAD:refs/heads/${branch}`]);
  }
  await writePublicationRecord(repo, 'demo', undefined, {
    version: 1,
    members: fixtureBranches.map((branch, index) => ({ position: fixturePositions[index]!, branch, pr: 101 + index })),
  });
  for (const [index, branch] of fixtureBranches.entries()) await git(repo, ['update-ref', pushedTipRef('demo', branch), oldTips[index]!]);

  const newTips: string[] = [];
  await git(repo, ['checkout', fixtureBranches[0]!]);
  await git(repo, ['reset', '--hard', 'main']);
  newTips.push(await commit(repo, 'new-0'));
  for (let index = 1; index < fixtureBranches.length; index += 1) {
    await git(repo, ['checkout', fixtureBranches[index]!]);
    await git(repo, ['reset', '--hard', newTips[index - 1]!]);
    newTips.push(await commit(repo, `new-${index}`));
  }

  const recordedTips = newTips.map((tip, index) => index === options.unchangedIndex ? oldTips[index]! : tip);
  const ledger = {
    version: 1,
    members: Object.fromEntries(fixtureBranches.map((branch, index) => [branch, {
      position: fixturePositions[index], pr: 101 + index, publishedTip: oldTips[index], recordedTip: recordedTips[index],
    }])),
    rounds: [], aboveOwed: [], posted: [],
  };
  const blob = await git(repo, ['hash-object', '-w', '--stdin'], JSON.stringify(ledger));
  await git(repo, ['update-ref', refreshLedgerRefFor('demo'), blob.stdout.trim()]);
  return { repo, origin, branches: fixtureBranches, positions: fixturePositions, oldTips, recordedTips };
}

describe('FINISH published member refresh (real Git)', () => {
  it('pushes pending members bottom-up, records receipts, and persists one refresh event per moved member', async () => {
    const subject = await fixture();
    const remotePushes: string[][] = [];
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await refreshPublishedStackMembers({
        root: subject.repo, slug: 'demo', mutation: mutation(),
        remoteGit: async (args, dependencies) => {
          remotePushes.push([...args]);
          return localRemoteGit(args, dependencies);
        },
        git: async (args, options) => git(subject.repo, args, options?.input),
        events,
      });
    } finally {
      persister.stop();
    }

    expect(remotePushes).toEqual(subject.branches.map((branch, index) => [
      'push', 'origin', `${subject.recordedTips[index]}:refs/heads/${branch}`,
    ]));
    for (const [index, branch] of subject.branches.entries()) {
      expect(await tip(subject.origin, `refs/heads/${branch}`)).toBe(subject.recordedTips[index]);
      expect(await tip(subject.repo, pushedTipRef('demo', branch))).toBe(subject.recordedTips[index]);
    }
    expect(await git(subject.origin, ['merge-base', '--is-ancestor', subject.recordedTips[0]!, subject.recordedTips[1]!])).toMatchObject({ exitCode: 0 });
    expect(await git(subject.origin, ['merge-base', '--is-ancestor', subject.recordedTips[1]!, subject.recordedTips[2]!])).toMatchObject({ exitCode: 0 });

    const persisted = (await readFile(join(subject.repo, '.pipeline', 'events.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event.type === 'stack_member_refreshed');
    expect(persisted).toEqual(subject.branches.map((_, index) => expect.objectContaining({
      type: 'stack_member_refreshed', pr: 101 + index,
      oldTip: subject.oldTips[index], newTip: subject.recordedTips[index],
    })));
  });

  it('does not push or emit for a member whose receipt already equals its recorded tip', async () => {
    const subject = await fixture({ unchangedIndex: 2 });
    const remotePushes: string[][] = [];
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await refreshPublishedStackMembers({
        root: subject.repo, slug: 'demo', mutation: mutation(),
        remoteGit: async (args, dependencies) => {
          remotePushes.push([...args]);
          return localRemoteGit(args, dependencies);
        },
        git: async (args, options) => git(subject.repo, args, options?.input),
        events,
      });
    } finally {
      persister.stop();
    }
    expect(remotePushes).toEqual(subject.branches.slice(0, 2).map((branch, index) => [
      'push', 'origin', `${subject.recordedTips[index]}:refs/heads/${branch}`,
    ]));
    const persisted = (await readFile(join(subject.repo, '.pipeline', 'events.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event.type === 'stack_member_refreshed');
    expect(persisted.map((event) => event.pr)).toEqual([101, 102]);
  });

  it('after a crash following two of four pushes, resumes with only the remaining two members', async () => {
    const subject = await fixture({ memberCount: 4 });
    const firstAttemptPushes: string[][] = [];
    await expect(refreshPublishedStackMembers({
      root: subject.repo, slug: 'demo', mutation: mutation(),
      remoteGit: async (args, dependencies) => {
        if (firstAttemptPushes.length === 2) throw new Error('simulated crash after second push');
        firstAttemptPushes.push([...args]);
        return localRemoteGit(args, dependencies);
      },
      git: async (args, options) => git(subject.repo, args, options?.input),
    })).rejects.toThrow('simulated crash after second push');

    const resumedPushes: string[][] = [];
    await refreshPublishedStackMembers({
      root: subject.repo, slug: 'demo', mutation: mutation(),
      remoteGit: async (args, dependencies) => {
        resumedPushes.push([...args]);
        return localRemoteGit(args, dependencies);
      },
      git: async (args, options) => git(subject.repo, args, options?.input),
    });

    expect(firstAttemptPushes.map((args) => args[2])).toEqual(subject.branches.slice(0, 2).map((branch, index) => `${subject.recordedTips[index]}:refs/heads/${branch}`));
    expect(resumedPushes.map((args) => args[2])).toEqual(subject.branches.slice(2).map((branch, index) => `${subject.recordedTips[index + 2]}:refs/heads/${branch}`));
  });

  it('adopts a remote-completed push intent before retrying instead of pushing that member twice', async () => {
    const subject = await fixture();
    let remoteSucceeded = false;
    await expect(refreshPublishedStackMembers({
      root: subject.repo, slug: 'demo', mutation: mutation(),
      remoteGit: async (args, dependencies) => executeRemoteGit(args, {
        ...dependencies,
        config: async () => ({ stdout: 'git@github.com:acme/rocket.git\n' }),
        runRemoteGit: async (remoteArgs, options) => {
          const result = await dependencies.runRemoteGit(remoteArgs, options);
          remoteSucceeded = true;
          return result;
        },
        pushLeaseGit: async (gitArgs, input) => {
          if (remoteSucceeded && gitArgs[0] === 'update-ref' && gitArgs[1] === pushedTipRef('demo', subject.branches[0]!)) {
            return { stdout: '', exitCode: 1 };
          }
          return dependencies.pushLeaseGit!(gitArgs, input);
        },
      }),
      git: async (args, options) => git(subject.repo, args, options?.input),
    })).rejects.toThrow('published stack refresh refused at position 3');

    expect(await tip(subject.origin, `refs/heads/${subject.branches[0]}`)).toBe(subject.recordedTips[0]);
    expect(await tip(subject.repo, pushedTipIntentRef('demo', subject.branches[0]!))).toBeTruthy();

    const resumedPushes: string[][] = [];
    await refreshPublishedStackMembers({
      root: subject.repo, slug: 'demo', mutation: mutation(),
      remoteGit: async (args, dependencies) => {
        resumedPushes.push([...args]);
        return localRemoteGit(args, dependencies);
      },
      git: async (args, options) => git(subject.repo, args, options?.input),
    });

    expect(resumedPushes.map((args) => args[2])).toEqual(subject.branches.slice(1).map((branch, index) => `${subject.recordedTips[index + 1]}:refs/heads/${branch}`));
    expect(await tip(subject.repo, pushedTipRef('demo', subject.branches[0]!))).toBe(subject.recordedTips[0]);
    await expect(git(subject.repo, ['rev-parse', '--verify', '--quiet', pushedTipIntentRef('demo', subject.branches[0]!)]).then((result) => result.exitCode)).resolves.toBe(1);
  });

  it('halts stack-tip-diverged on a guard refusal while retaining prior pushed receipts', async () => {
    const subject = await fixture();
    await expect(refreshPublishedStackMembers({
      root: subject.repo, slug: 'demo', mutation: mutation(),
      remoteGit: async (args, dependencies) => {
        if (args[2]?.endsWith(`refs/heads/${subject.branches[1]}`)) {
          return { kind: 'refused', reason: 'stack-tip-mismatch', members: [{ pr: 102, position: subject.positions[1] }] } as const;
        }
        return localRemoteGit(args, dependencies);
      },
      git: async (args, options) => git(subject.repo, args, options?.input),
    })).rejects.toMatchObject({ reason: 'stack_tip_diverged' });

    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('positions: 3');
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('stack-tip-diverged');
    expect(await tip(subject.repo, pushedTipRef('demo', subject.branches[0]!))).toBe(subject.recordedTips[0]);
    expect(await tip(subject.repo, pushedTipRef('demo', subject.branches[1]!))).toBe(subject.oldTips[1]);
  });
});
