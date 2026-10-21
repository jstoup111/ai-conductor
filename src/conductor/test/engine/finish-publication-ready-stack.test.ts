// Covers: task:15
// Covers: task:rem-prd-audit-R9, task:rem-prd-audit-R9-2, task:rem-prd-audit-R9-3
// Covers: task:rem-prd-audit-rem-s6-1-child-ensure-ship-ready
// Covers: task:rem-prd-audit-rem-v3-ready-target-binding
// Covers: task:rem-as-built-rem-as-built-rem-v4-second-read-indeterminate
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseChildId } from '../../src/engine/child-context.js';
import { allStackMembersReady, readyStackChildren } from '../../src/engine/finish-publication-production.js';
import { advanceFinishPublication, type PublicationSnapshot } from '../../src/engine/finish-publication.js';
import type { GithubOperationRequest, GithubOperationRunner, GithubOperationTarget } from '../../src/engine/github-operations.js';
import { pushedTipRef } from '../../src/engine/push-lease.js';
import { makeGitRunner, type GitRunner } from '../../src/engine/rebase.js';
import { writePublicationRecord, type PublicationRecord } from '../../src/engine/stack-publication-record.js';
import { renderChildBody } from '../../src/engine/stack-member-body.js';
import type { GhRunner } from '../../src/engine/tracker-client.js';
import type { ConductorEvent } from '../../src/types/events.js';

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

function fixture(input: {
  ready?: readonly number[];
  mismatchedHead?: boolean;
  invalidChildBody?: boolean;
  nativeMembers?: readonly number[];
  /** Number of guarded ready writes needed before GitHub reports the PR ready. */
  readyAfterAttempts?: Readonly<Record<number, number>>;
} = {}) {
  const drafts = new Map<number, boolean>([[101, !input.ready?.includes(101)], [103, !input.ready?.includes(103)], [500, !input.ready?.includes(500)]]);
  const bodies = new Map([[101, childBody(1, 'feat/c1/demo')], [103, childBody(3, 'feat/c3/demo')]]);
  if (input.invalidChildBody) bodies.set(103, `${bodies.get(103)}\n\nCloses acme/demo#7`);
  const writes: string[] = [];
  const ghCalls: string[][] = [];
  const readyAttempts = new Map<number, number>();
  const gh: GhRunner = async (args) => {
    ghCalls.push(args);
    if (args[0] === 'api' && args[1]?.includes('/stacks?pull_request=')) {
      return {
        stdout: JSON.stringify([{
          number: 44,
          pull_requests: members.filter((member) => input.nativeMembers?.includes(member.pr) ?? true).map((member) => ({
            number: member.pr,
            head: { sha: input.mismatchedHead && member.pr === 103 ? 'f'.repeat(40) : head },
          })),
        }]),
      };
    }
    const reference = args[2] ?? '';
    const number = /^\d+$/.test(reference)
      ? Number(reference)
      : Number(reference.split('/').at(-1));
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
      const attempt = (readyAttempts.get(request.target.number) ?? 0) + 1;
      readyAttempts.set(request.target.number, attempt);
      if (attempt >= (input.readyAfterAttempts?.[request.target.number] ?? 1)) {
        drafts.set(request.target.number, false);
      }
      return {};
    },
  };
  return { gh, operations, writes, drafts, ghCalls };
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
    const { gh, writes, drafts, ghCalls } = fixture();
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
    expect(ghCalls.some((args) => args.includes('ready'))).toBe(false);
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

  it('retries a child ready flip until GitHub observes it ready', async () => {
    const { gh, operations, writes, drafts } = fixture({ readyAfterAttempts: { 103: 2 } });

    await readyStackChildren({
      root, slug: 'demo', leafUrl, git, gh, operations,
      sleep: async () => {},
    });

    expect(writes).toEqual(['ready:103', 'ready:103', 'ready:101']);
    expect(drafts.get(103)).toBe(false);
  });

  it('leaves a persistently draft child for a retry instead of halting FINISH', async () => {
    const { gh, operations, writes, drafts } = fixture({ readyAfterAttempts: { 103: Number.POSITIVE_INFINITY } });
    const snapshot: PublicationSnapshot = {
      mode: 'daemon',
      intent: { outcome: 'pr', authority: { kind: 'unattended_policy', mode: 'daemon' } },
      implementationEvidence: 'valid', shipEvidence: 'valid', releaseReadiness: 'valid', branchPushed: 'valid',
      shippedRecord: 'valid', outcomeRecord: 'missing', stack: 'valid',
      pr: { identity: 'one', url: leafUrl, prose: 'accepted', ready: false },
    };

    await expect(advanceFinishPublication({
      observe: async () => snapshot,
      effects: {
        dispatchJudgment: async () => ({ kind: 'accepted' }),
        repairPresentation: async () => readyStackChildren({
          root, slug: 'demo', leafUrl, git, gh, operations, sleep: async () => {},
        }),
      },
    })).resolves.toEqual({
      kind: 'publication_retry', transition: 'ready_pr', reason: 'presentation_repair_partial',
      detail: 'child ready flip remains unobserved at position 3',
    });

    expect(writes).toEqual(['ready:103', 'ready:103', 'ready:103']);
    expect(drafts.get(103)).toBe(true);
  });

  it('halts before a child flip when a native member head no longer matches its pushed receipt', async () => {
    const { gh, operations, writes } = fixture({ mismatchedHead: true });

    await expect(readyStackChildren({ root, slug: 'demo', leafUrl, git, gh, operations }))
      .rejects.toMatchObject({ reason: 'stack_tip_diverged' });

    expect(writes).toEqual([]);
  });

  it('halts before a child flip when parsed native membership diverges from the publication record', async () => {
    const { gh, operations, writes } = fixture({ nativeMembers: [101, 500] });

    await expect(readyStackChildren({ root, slug: 'demo', leafUrl, git, gh, operations }))
      .rejects.toMatchObject({ reason: 'stack_tip_diverged' });

    expect(writes).toEqual([]);
  });

  it('keeps a child draft and returns a needs-human FINISH outcome when its body postconditions fail', async () => {
    const { gh, operations, writes, drafts } = fixture({ invalidChildBody: true });
    const snapshot: PublicationSnapshot = {
      mode: 'daemon',
      intent: { outcome: 'pr', authority: { kind: 'unattended_policy', mode: 'daemon' } },
      implementationEvidence: 'valid', shipEvidence: 'valid', releaseReadiness: 'valid', branchPushed: 'valid',
      shippedRecord: 'valid', outcomeRecord: 'missing', stack: 'valid',
      pr: { identity: 'one', url: leafUrl, prose: 'accepted', ready: false },
    };

    await expect(advanceFinishPublication({
      observe: async () => snapshot,
      effects: {
        dispatchJudgment: async () => ({ kind: 'accepted' }),
        repairPresentation: async () => readyStackChildren({ root, slug: 'demo', leafUrl, git, gh, operations }),
      },
    })).resolves.toMatchObject({
      kind: 'human_required', reason: 'stack_publication_precondition_failed', detail: expect.stringContaining('feat/c3/demo'),
    });

    expect(writes).toEqual([]);
    expect(drafts.get(103)).toBe(true);
  });

  it.each([
    ['times out', () => { throw new Error('native stack reread timed out'); }],
    ['returns unparseable JSON', () => ({ stdout: '{not json' })],
  ])('retries publication when the native stack reread after validation %s', async (_description, indeterminateRead) => {
    const { gh: fixtureGh } = fixture();
    const operationsSeen: string[] = [];
    const events: ConductorEvent[] = [];
    const gh: GhRunner = async (args) => {
      if (args[0] === 'api' && args[1]?.includes('/stacks?pull_request=')) {
        return indeterminateRead();
      }
      return fixtureGh(args, { cwd: root });
    };
    const readyWrites: string[] = [];
    const operations: GithubOperationRunner = {
      run: async (request) => {
        operationsSeen.push(request.operation);
        if (request.operation === 'stack.read') return {};
        if (request.operation === 'pull-request.ready') readyWrites.push(request.operation);
        throw new Error(`unexpected operation: ${request.operation}`);
      },
    };
    const snapshot: PublicationSnapshot = {
      mode: 'daemon',
      intent: { outcome: 'pr', authority: { kind: 'unattended_policy', mode: 'daemon' } },
      implementationEvidence: 'valid', shipEvidence: 'valid', releaseReadiness: 'valid', branchPushed: 'valid',
      shippedRecord: 'valid', outcomeRecord: 'missing', stack: 'valid',
      pr: { identity: 'one', url: leafUrl, prose: 'accepted', ready: false },
    };

    await expect(advanceFinishPublication({
      observe: async () => snapshot,
      effects: {
        dispatchJudgment: async () => ({ kind: 'accepted' }),
        repairPresentation: async () => readyStackChildren({
          root, slug: 'demo', leafUrl, git, gh, operations,
          events: { emit: async (event: ConductorEvent) => { events.push(event); } } as never,
        }),
      },
    })).resolves.toEqual({
      kind: 'publication_retry', transition: 'ready_pr', reason: 'presentation_repair_failed',
    });

    expect(operationsSeen).toEqual(['stack.read']);
    expect(operationsSeen).not.toContain('pull-request.ready');
    expect(readyWrites).toEqual([]);
    expect(events.filter((event) => event.type === 'stack_tip_diverged')).toEqual([]);
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports a verified stack ready only after every member is non-draft', async () => {
    const first = fixture({ ready: [500, 103] });

    await expect(allStackMembersReady({ root, slug: 'demo', repository: 'acme/demo', git, gh: first.gh })).resolves.toBe(false);

    const second = fixture({ ready: [500, 103, 101] });
    await expect(allStackMembersReady({ root, slug: 'demo', repository: 'acme/demo', git, gh: second.gh })).resolves.toBe(true);
  });
});
