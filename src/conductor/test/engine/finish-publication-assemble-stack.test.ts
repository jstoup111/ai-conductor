// Covers: task:11, task:rem-prd-audit-R7, task:rem-prd-audit-R7-2, task:rem-prd-audit-R7-3, task:rem-prd-audit-R7-4
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../src/engine/child-context.js';
import { assembleStack } from '../../src/engine/finish-publication-production.js';
import type { GithubOperationRequest, GithubOperationRunner } from '../../src/engine/github-operations.js';
import { makeGitRunner, type GitRunner } from '../../src/engine/rebase.js';
import {
  activePublicationRecord,
  writePublicationRecord,
  type PublicationRecord,
} from '../../src/engine/stack-publication-record.js';
import type { GhRunner } from '../../src/engine/tracker-client.js';

const c1 = parseChildId(1)!;
const c3 = parseChildId(3)!;
const c5 = parseChildId(5)!;

const members = [
  { position: c1, branch: 'feat/c1/demo', pr: 101 },
  { position: c3, branch: 'feat/c3/demo', pr: 103 },
  { position: c5, branch: 'feat/daemon-demo', pr: 500 },
] as const;

let root: string;

async function git(args: string[], options?: Parameters<GitRunner>[1]) {
  return makeGitRunner(root)(args, options);
}

async function writeRecord(record: PublicationRecord): Promise<void> {
  const origin = join(root, 'origin.git');
  const remote = await git(['config', '--get', 'remote.origin.url']);
  if (remote.exitCode !== 0) {
    await git(['init', '--bare', '-q', origin]);
    await git(['remote', 'add', 'origin', origin]);
  }
  const head = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  for (const member of record.members) {
    await git(['push', '-q', 'origin', `HEAD:refs/heads/${member.branch}`]);
    await git(['update-ref', `refs/conductor/demo/pushed/${member.branch}`, head]);
  }
  await expect(writePublicationRecord(root, 'demo', undefined, record, { git })).resolves.toEqual({ kind: 'updated' });
}

async function record(): Promise<PublicationRecord> {
  const stored = await activePublicationRecord(root, 'demo', { git });
  if (!stored) throw new Error('expected publication record');
  return stored.record;
}

function fixture(
  base: string,
  trace: string[],
  initialStack?: { number: number; pull_requests: readonly { number: number; head: { sha: string } }[] },
) {
  let stack: { number: number; pull_requests: readonly { number: number; head: { sha: string } }[] } | undefined = initialStack;
  const gh: GhRunner = async (args) => {
    trace.push(`read:${args.join(' ')}`);
    if (args[0] === 'api' && args[1]?.includes('/stacks?pull_request=')) {
      return { stdout: JSON.stringify(stack === undefined ? [] : [stack]) };
    }
    const number = Number(args[2]);
    if (Number.isInteger(number)) {
      const head = (await git(['rev-parse', 'HEAD'])).stdout.trim();
      const memberBase = number === 101 ? 'main' : number === 103 ? 'feat/c1/demo' : base;
      return { stdout: JSON.stringify({ baseRefName: memberBase, headRefOid: head }) };
    }
    return { stdout: JSON.stringify({ baseRefName: base }) };
  };
  const operations: GithubOperationRunner = {
    run: async (request: GithubOperationRequest) => {
      if (request.operation === 'pull-request.retarget') {
        trace.push(`retarget:${(request.payload as { base: string }).base}`);
        base = (request.payload as { base: string }).base;
      } else if (request.operation === 'stack.create') {
        const head = (await git(['rev-parse', 'HEAD'])).stdout.trim();
        stack = { number: 44, pull_requests: (request.payload as { pullRequests: readonly number[] }).pullRequests.map((number) => ({ number, head: { sha: head } })) };
        trace.push('stack:create');
      } else if (request.operation !== 'stack.read') {
        throw new Error(`unexpected operation ${request.operation}`);
      }
      return {};
    },
  };
  return { gh, operations };
}

function tracingGit(trace: string[]): GitRunner {
  return async (args, options) => {
    if (args[0] === 'hash-object' && typeof options?.input === 'string') {
      const value = JSON.parse(options.input) as PublicationRecord;
      if (value.retarget) trace.push(`write:${value.retarget.phase}`);
    }
    return git(args, options);
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'finish-publication-assemble-stack-'));
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'stack@example.invalid']);
  await git(['config', 'user.name', 'Stack fixture']);
  await writeFile(join(root, 'README.md'), 'fixture\n');
  await git(['add', 'README.md']);
  await git(['commit', '-qm', 'fixture']);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('assembleStack leaf retarget journal', () => {
  it('CAS-writes intended, retargets #500 to feat/c3/demo, then CAS-writes observed in order', async () => {
    await writeRecord({ version: 1, members });
    const trace: string[] = [];
    const { gh, operations } = fixture('main', trace);

    await assembleStack({ root, slug: 'demo', leafUrl: 'https://github.com/acme/demo/pull/500', baseBranch: 'main', git: tracingGit(trace), gh, operations });

    expect(trace.filter((entry) => entry.startsWith('write:') || entry.startsWith('retarget:'))).toEqual([
      'write:intended',
      'retarget:feat/c3/demo',
      'write:observed',
      'write:observed',
      'write:observed',
    ]);
    await expect(record()).resolves.toMatchObject({ retarget: { from: 'main', to: 'feat/c3/demo', phase: 'observed' } });
    await expect(record()).resolves.toMatchObject({ stack: { number: 44, verified: true } });
  });

  it('resumes after an intended write before the call with exactly one retarget', async () => {
    await writeRecord({
      version: 1,
      retarget: { from: 'main', to: 'feat/c3/demo', phase: 'intended' },
      members,
    });
    const trace: string[] = [];
    const { gh, operations } = fixture('main', trace);

    await assembleStack({ root, slug: 'demo', leafUrl: 'https://github.com/acme/demo/pull/500', baseBranch: 'main', git: tracingGit(trace), gh, operations });

    expect(trace.filter((entry) => entry.startsWith('retarget:'))).toEqual(['retarget:feat/c3/demo']);
    await expect(record()).resolves.toMatchObject({ retarget: { phase: 'observed' } });
  });

  it('resumes after the retarget call by observing the child base without repeating it', async () => {
    await writeRecord({
      version: 1,
      retarget: { from: 'main', to: 'feat/c3/demo', phase: 'intended' },
      members,
    });
    const trace: string[] = [];
    const { gh, operations } = fixture('feat/c3/demo', trace);

    await assembleStack({ root, slug: 'demo', leafUrl: 'https://github.com/acme/demo/pull/500', baseBranch: 'main', git: tracingGit(trace), gh, operations });

    expect(trace.filter((entry) => entry.startsWith('retarget:'))).toEqual([]);
    await expect(record()).resolves.toMatchObject({ retarget: { phase: 'observed' } });
  });

  it('discovers by member 1 and refuses a foreign stack before create or add', async () => {
    await writeRecord({ version: 1, members });
    const trace: string[] = [];
    const head = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    const { gh, operations } = fixture('feat/c3/demo', trace, {
      number: 91,
      pull_requests: [{ number: 999, head: { sha: head } }],
    });

    await expect(assembleStack({
      root, slug: 'demo', leafUrl: 'https://github.com/acme/demo/pull/500', baseBranch: 'main',
      git: tracingGit(trace), gh, operations,
    })).rejects.toMatchObject({ reason: 'stack_tip_diverged' });

    expect(trace).toContain('read:api repos/acme/demo/stacks?pull_request=101');
    expect(trace).not.toContain('stack:create');
  });
});
