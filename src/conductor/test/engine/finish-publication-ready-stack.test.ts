// Covers: task:15
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseChildId } from '../../src/engine/child-context.js';
import { allStackMembersReady, readyStackChildren } from '../../src/engine/finish-publication-production.js';
import type { GithubOperationRequest, GithubOperationRunner, GithubOperationTarget } from '../../src/engine/github-operations.js';
import { pushedTipRef } from '../../src/engine/push-lease.js';
import { makeGitRunner, type GitRunner } from '../../src/engine/rebase.js';
import { writePublicationRecord, type PublicationRecord } from '../../src/engine/stack-publication-record.js';
import { renderChildBody } from '../../src/engine/stack-member-body.js';
import type { GhRunner } from '../../src/engine/tracker-client.js';

const c1 = parseChildId(1)!;
const c3 = parseChildId(3)!;
const c5 = parseChildId(5)!;
const leafUrl = 'https://github.com/acme/demo/pull/500';

const members = [
  { position: c1, branch: 'feat/c1/demo', pr: 101 },
  { position: c3, branch: 'feat/c3/demo', pr: 103 },
  { position: c5, branch: 'feat/daemon-demo', pr: 500 },
] as const;

let root: string;
let head: string;

async function git(args: string[], options?: Parameters<GitRunner>[1]) {
  return makeGitRunner(root)(args, options);
}

function childBody(position: number, branch: string): string {
  return renderChildBody({
    slice: { position, name: `Slice ${position}`, taskIds: [], storyIds: [] },
    stories: [], branch, base: 'main', diffstat: '',
    members: members.map((member) => ({ position: member.position, name: member.branch, reference: `#${member.pr}` })),
  });
}

function fixture(input: { ready?: readonly number[]; mismatchedHead?: boolean } = {}) {
  const drafts = new Map<number, boolean>([[101, !input.ready?.includes(101)], [103, !input.ready?.includes(103)], [500, !input.ready?.includes(500)]]);
  const bodies = new Map([[101, childBody(1, 'feat/c1/demo')], [103, childBody(3, 'feat/c3/demo')]]);
  const writes: string[] = [];
  const gh: GhRunner = async (args) => {
    if (args[0] === 'api' && args[1]?.includes('/stacks?pull_request=')) {
      return {
        stdout: JSON.stringify([{
          number: 44,
          pull_requests: members.map((member) => ({
            number: member.pr,
            head: { sha: input.mismatchedHead && member.pr === 103 ? 'f'.repeat(40) : head },
          })),
        }]),
      };
    }
    const number = Number(args[2]);
    return {
      stdout: JSON.stringify({
        body: bodies.get(number),
        isDraft: drafts.get(number),
        state: 'OPEN',
      }),
    };
  };
  const operations: GithubOperationRunner = {
    run: async (request: GithubOperationRequest) => {
      if (request.operation === 'stack.read') return {};
      if (request.operation !== 'pull-request.ready' || request.target.kind !== 'pull-request') {
        throw new Error(`unexpected write: ${request.operation}`);
      }
      writes.push(`ready:${request.target.number}`);
      drafts.set(request.target.number, false);
      return {};
    },
  };
  return { gh, operations, writes, drafts };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'finish-publication-ready-stack-'));
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'stack@example.invalid']);
  await git(['config', 'user.name', 'Stack fixture']);
  await writeFile(join(root, 'README.md'), 'fixture\n');
  await git(['add', 'README.md']);
  await git(['commit', '-qm', 'fixture']);
  head = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  for (const member of members) {
    await git(['update-ref', pushedTipRef('demo', member.branch), head]);
  }
  const record: PublicationRecord = { version: 1, members, stack: { number: 44, verified: true } };
  await expect(writePublicationRecord(root, 'demo', undefined, record, { git })).resolves.toEqual({ kind: 'updated' });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('readyStackChildren', () => {
  it('uses target-bound runners for every stack read and child ready flip', async () => {
    const { gh, writes, drafts } = fixture();
    const fallback: GithubOperationRunner = {
      run: async () => { throw new Error('unbound operation runner must not execute'); },
    };
    const targets: GithubOperationTarget[] = [];
    const operationsForTarget = vi.fn((target: GithubOperationTarget): GithubOperationRunner => ({
      run: async (request: GithubOperationRequest) => {
        targets.push(target);
        expect(request.target).toEqual(target);
        if (request.operation === 'stack.read') return {};
        if (request.operation !== 'pull-request.ready' || target.kind !== 'pull-request') {
          throw new Error(`unexpected target-bound operation: ${request.operation}`);
        }
        writes.push(`ready:${target.number}`);
        drafts.set(target.number, false);
        return {};
      },
    }));

    await readyStackChildren({ root, slug: 'demo', leafUrl, git, gh, operations: fallback, operationsForTarget });

    expect(targets).toEqual([
      { repository: 'acme/demo', kind: 'repository' },
      { repository: 'acme/demo', kind: 'pull-request', number: 103 },
      { repository: 'acme/demo', kind: 'repository' },
      { repository: 'acme/demo', kind: 'pull-request', number: 101 },
    ]);
    expect(writes).toEqual(['ready:103', 'ready:101']);
  });

  it('flips only draft children from the highest position to the lowest', async () => {
    const { gh, operations, writes, drafts } = fixture();

    await readyStackChildren({ root, slug: 'demo', leafUrl, git, gh, operations });

    expect(writes).toEqual(['ready:103', 'ready:101']);
    expect(drafts.get(103)).toBe(false);
    expect(drafts.get(101)).toBe(false);
  });

  it('resumes after a higher child is ready without repeating its flip', async () => {
    const { gh, operations, writes } = fixture({ ready: [103] });

    await readyStackChildren({ root, slug: 'demo', leafUrl, git, gh, operations });

    expect(writes).toEqual(['ready:101']);
  });

  it('halts before a child flip when a native member head no longer matches its pushed receipt', async () => {
    const { gh, operations, writes } = fixture({ mismatchedHead: true });

    await expect(readyStackChildren({ root, slug: 'demo', leafUrl, git, gh, operations }))
      .rejects.toMatchObject({ reason: 'stack_tip_diverged' });

    expect(writes).toEqual([]);
  });

  it('reports a verified stack ready only after every member is non-draft', async () => {
    const first = fixture({ ready: [500, 103] });

    await expect(allStackMembersReady({ root, slug: 'demo', repository: 'acme/demo', git, gh: first.gh })).resolves.toBe(false);

    const second = fixture({ ready: [500, 103, 101] });
    await expect(allStackMembersReady({ root, slug: 'demo', repository: 'acme/demo', git, gh: second.gh })).resolves.toBe(true);
  });
});
