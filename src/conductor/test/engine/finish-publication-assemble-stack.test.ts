// Covers: task:11, task:rem-prd-audit-R7, task:rem-prd-audit-R7-2, task:rem-prd-audit-R7-3, task:rem-prd-audit-R7-4, task:rem-prd-audit-rem-v3-foreign-stack, task:rem-prd-audit-rem-v3-rerender-template, task:rem-prd-audit-rem-v3-read-indeterminate, task:rem-prd-audit-rem-v3-divergence-mapping
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../src/engine/child-context.js';
import { assembleStack } from '../../src/engine/finish-publication-production.js';
import { advanceFinishPublication, type PublicationSnapshot } from '../../src/engine/finish-publication.js';
import type { GithubOperationRequest, GithubOperationRunner } from '../../src/engine/github-operations.js';
import { makeGitRunner, type GitRunner } from '../../src/engine/rebase.js';
import {
  activePublicationRecord,
  writePublicationRecord,
  type PublicationRecord,
} from '../../src/engine/stack-publication-record.js';
import { writeRegionCapture } from '../../src/engine/pr-body-region-store.js';
import type { GhRunner } from '../../src/engine/tracker-client.js';

const c1 = parseChildId(1)!;
const c3 = parseChildId(3)!;
const c5 = parseChildId(5)!;

const members = [
  { position: c1, branch: 'feat/c1/demo', pr: 101 },
  { position: c3, branch: 'feat/c3/demo', pr: 103 },
  { position: c5, branch: 'feat/daemon-demo', pr: 500 },
] as const;

const regionTemplate = [
  '<!-- ai-conductor:step release-disposition -->',
  'Release-Disposition: no-note',
  '## Stack',
  'opaque project content',
  '<!-- /ai-conductor:step -->',
].join('\n');

const capturedLeafRegion = '\nRelease-Disposition: note\nRelease-Note: retained leaf prose\n';
const staleLeafRegion = '\nRelease-Disposition: no-note\n';

let root: string;

async function git(args: string[], options?: Parameters<GitRunner>[1]) {
  return makeGitRunner(root)(args, options);
}

async function writeRecord(record: PublicationRecord): Promise<void> {
  const origin = join(root, 'origin.git');
  const remote = await git(['config', '--get', 'remote.origin.url']);
  if (remote.exitCode !== 0) {
    await git(['init', '--bare', '-b', 'main', '-q', origin]);
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
  stacksByMember: Readonly<Record<number, { number: number; pull_requests: readonly { number: number; head: { sha: string } }[] }>> = {},
  bodies?: Map<number, string>,
  createdStackHeadFor: Readonly<Record<number, string>> = {},
) {
  let stack: { number: number; pull_requests: readonly { number: number; head: { sha: string } }[] } | undefined = initialStack;
  const gh: GhRunner = async (args) => {
    trace.push(`read:${args.join(' ')}`);
    if (args[0] === 'api' && args[1]?.includes('/stacks?pull_request=')) {
      const member = Number(args[1].split('=').at(-1));
      const observed = stacksByMember[member] ?? stack;
      return { stdout: JSON.stringify(observed === undefined ? [] : [observed]) };
    }
    const number = Number(args[2]);
    if (Number.isInteger(number)) {
      const head = (await git(['rev-parse', 'HEAD'])).stdout.trim();
      const memberBase = number === 101 ? 'main' : number === 103 ? 'feat/c1/demo' : base;
      if (args.at(-1) === 'body') return { stdout: JSON.stringify({ body: bodies?.get(number) }) };
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
        stack = { number: 44, pull_requests: (request.payload as { pullRequests: readonly number[] }).pullRequests.map((number) => ({ number, head: { sha: createdStackHeadFor[number] ?? head } })) };
        trace.push(`stack:create:${(request.payload as { pullRequests: readonly number[] }).pullRequests.join(',')}`);
      } else if (request.operation === 'stack.add') {
        if (!stack) throw new Error('stack.add without a native stack');
        const head = (await git(['rev-parse', 'HEAD'])).stdout.trim();
        stack = {
          ...stack,
          pull_requests: [...stack.pull_requests, ...(request.payload as { pullRequests: readonly number[] }).pullRequests.map((number) => ({ number, head: { sha: head } }))],
        };
        trace.push(`stack:add:${(request.payload as { pullRequests: readonly number[] }).pullRequests.join(',')}`);
      } else if (request.operation === 'pull-request.edit') {
        const number = request.target.kind === 'pull-request' ? request.target.number : undefined;
        if (number === undefined || !bodies) throw new Error('missing body fixture');
        bodies.set(number, (request.payload as { body: string }).body);
        trace.push(`edit:${number}`);
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
      if (value.stack) trace.push(`write:stack:${value.stack.number}:${value.stack.verified}`);
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
  it('creates the ordered native stack, verifies its pushed tips, and records stack_assembled', async () => {
    await writeRecord({ version: 1, members });
    const trace: string[] = [];
    const events: unknown[] = [];
    const { gh, operations } = fixture('main', trace);

    await assembleStack({
      root, slug: 'demo', leafUrl: 'https://github.com/acme/demo/pull/500', baseBranch: 'main',
      git: tracingGit(trace), gh, operations, events: { emit: async (event) => { events.push(event); } },
    });

    expect(trace).toContain('stack:create:101,103,500');
    expect(trace.filter((entry) => entry === 'read:api repos/acme/demo/stacks?pull_request=101')).toHaveLength(2);
    await expect(record()).resolves.toMatchObject({ stack: { number: 44, verified: true } });
    expect(events).toContainEqual({ type: 'stack_assembled', prs: [101, 103, 500] });
  });

  it('records a one-member prefix before adding its missing ordered members without creating another stack', async () => {
    await writeRecord({ version: 1, members });
    const trace: string[] = [];
    const head = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    const { gh, operations } = fixture('main', trace, {
      number: 44, pull_requests: [{ number: 101, head: { sha: head } }],
    });

    await assembleStack({
      root, slug: 'demo', leafUrl: 'https://github.com/acme/demo/pull/500', baseBranch: 'main',
      git: tracingGit(trace), gh, operations,
    });

    expect(trace).toContain('stack:add:103,500');
    expect(trace).not.toContain('stack:create:101,103,500');
    expect(trace.indexOf('write:stack:44:false')).toBeLessThan(trace.indexOf('stack:add:103,500'));
    await expect(record()).resolves.toMatchObject({ stack: { number: 44, verified: true } });
  });

  it('CAS-writes intended, retargets #500 to feat/c3/demo, then CAS-writes observed in order', async () => {
    await writeRecord({ version: 1, members });
    const trace: string[] = [];
    const { gh, operations } = fixture('main', trace);

    await assembleStack({ root, slug: 'demo', leafUrl: 'https://github.com/acme/demo/pull/500', baseBranch: 'main', git: tracingGit(trace), gh, operations });

    expect(trace.filter((entry) => (entry.startsWith('write:') && !entry.startsWith('write:stack:')) || entry.startsWith('retarget:'))).toEqual([
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

  it('maps an observed retarget-base divergence to a retained stack-tip halt', async () => {
    await writeRecord({ version: 1, members });
    const trace: string[] = [];
    const events: unknown[] = [];
    const { gh, operations } = fixture('unexpected-base', trace);

    await expect(assembleStack({
      root, slug: 'demo', leafUrl: 'https://github.com/acme/demo/pull/500', baseBranch: 'main',
      git: tracingGit(trace), gh, operations, events: { emit: async (event) => { events.push(event); } },
    })).rejects.toMatchObject({ reason: 'stack_tip_diverged', message: expect.stringContaining('retained leaf pull request base diverged') });

    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('positions: 1, 3, 5');
    expect(events).toContainEqual({ type: 'stack_tip_diverged', prs: [101, 103, 500] });
    expect(trace.some((entry) => entry.startsWith('stack:create:'))).toBe(false);
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

  it('refuses #c3 in a different stack before create or add', async () => {
    await writeRecord({ version: 1, members });
    const trace: string[] = [];
    const head = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    const { gh, operations } = fixture('feat/c3/demo', trace, undefined, {
      103: { number: 91, pull_requests: [{ number: 103, head: { sha: head } }] },
    });

    const events: unknown[] = [];
    await expect(assembleStack({
      root, slug: 'demo', leafUrl: 'https://github.com/acme/demo/pull/500', baseBranch: 'main',
      git: tracingGit(trace), gh, operations, events: { emit: async (event) => { events.push(event); } },
    })).rejects.toMatchObject({ reason: 'stack_tip_diverged', message: 'native stack membership diverged at position 3' });

    expect(trace).toEqual(expect.arrayContaining([
      'read:api repos/acme/demo/stacks?pull_request=101',
      'read:api repos/acme/demo/stacks?pull_request=103',
      'read:api repos/acme/demo/stacks?pull_request=500',
    ]));
    expect(trace.filter((entry) => entry.startsWith('stack:create:') || entry.startsWith('stack:add:'))).toEqual([]);
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('positions: 3');
    expect(events).toContainEqual({ type: 'stack_tip_diverged', prs: [103] });
  });

  it('retries a timed-out stack.read without recording a pull-request.ready write', async () => {
    await writeRecord({ version: 1, members });
    const trace: string[] = [];
    const { gh } = fixture('feat/c3/demo', trace);
    const writes: string[] = [];
    const operations: GithubOperationRunner = {
      run: async (request) => {
        if (request.operation === 'stack.read') throw new Error('stack.read timed out');
        if (request.operation === 'pull-request.ready') writes.push('pull-request.ready');
        throw new Error(`unexpected operation ${request.operation}`);
      },
    };
    const snapshot: PublicationSnapshot = {
      mode: 'daemon',
      intent: { outcome: 'pr', authority: { kind: 'unattended_policy', mode: 'daemon' } },
      implementationEvidence: 'valid', shipEvidence: 'valid', releaseReadiness: 'valid',
      branchPushed: 'valid', shippedRecord: 'valid', outcomeRecord: 'missing', stack: 'unassembled',
      pr: { identity: 'one', url: 'https://github.com/acme/demo/pull/500', prose: 'accepted', ready: false },
    };

    await expect(advanceFinishPublication({
      observe: async () => snapshot,
      effects: {
        dispatchJudgment: async () => ({ kind: 'accepted' }),
        assembleStack: async () => assembleStack({
          root, slug: 'demo', leafUrl: 'https://github.com/acme/demo/pull/500', baseBranch: 'main',
          git: tracingGit(trace), gh, operations,
        }),
      },
    })).resolves.toMatchObject({
      kind: 'publication_retry', transition: 'assemble_stack', reason: 'publication_transition_indeterminate',
    });
    expect(writes).toEqual([]);
  });

  it('halts a non-prefix native stack without creating or extending it', async () => {
    await writeRecord({ version: 1, members });
    const trace: string[] = [];
    const head = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    const { gh, operations } = fixture('feat/c3/demo', trace, {
      number: 44,
      pull_requests: [{ number: 101, head: { sha: head } }, { number: 500, head: { sha: head } }],
    });

    await expect(assembleStack({
      root, slug: 'demo', leafUrl: 'https://github.com/acme/demo/pull/500', baseBranch: 'main',
      git: tracingGit(trace), gh, operations,
    })).rejects.toMatchObject({ reason: 'stack_tip_diverged' });

    expect(trace.filter((entry) => entry.startsWith('stack:create:') || entry.startsWith('stack:add:'))).toEqual([]);
  });

  it('halts a wrongly ordered existing stack without creating or extending it', async () => {
    await writeRecord({ version: 1, members });
    const trace: string[] = [];
    const head = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    const { gh, operations } = fixture('feat/c3/demo', trace, {
      number: 44,
      pull_requests: [{ number: 103, head: { sha: head } }, { number: 101, head: { sha: head } }, { number: 500, head: { sha: head } }],
    });

    await expect(assembleStack({
      root, slug: 'demo', leafUrl: 'https://github.com/acme/demo/pull/500', baseBranch: 'main',
      git: tracingGit(trace), gh, operations,
    })).rejects.toMatchObject({ reason: 'stack_tip_diverged' });

    expect(trace.filter((entry) => entry.startsWith('stack:create:') || entry.startsWith('stack:add:'))).toEqual([]);
  });

  it('does not verify a stack whose assembled member head differs from its pushed receipt', async () => {
    await writeRecord({ version: 1, members });
    const trace: string[] = [];
    const events: unknown[] = [];
    const { gh, operations } = fixture('main', trace, undefined, {}, undefined, { 103: 'f'.repeat(40) });

    await expect(assembleStack({
      root, slug: 'demo', leafUrl: 'https://github.com/acme/demo/pull/500', baseBranch: 'main',
      git: tracingGit(trace), gh, operations, events: { emit: async (event) => { events.push(event); } },
    })).rejects.toMatchObject({ reason: 'stack_tip_diverged', message: expect.stringContaining('position 3') });

    await expect(record()).resolves.toMatchObject({ stack: { number: 44, verified: false } });
    expect(events).toContainEqual({ type: 'stack_tip_diverged', prs: [103] });
  });

  it('re-renders every member from the template while preserving opaque child and captured leaf regions', async () => {
    await writeRecord({ version: 1, members });
    const leafUrl = 'https://github.com/acme/demo/pull/500';
    await writeRegionCapture(root, leafUrl, 'release-disposition', capturedLeafRegion);
    const bodies = new Map<number, string>([
      [101, [
        '# Child one',
        '',
        regionTemplate,
        '',
        '## Stack',
        '',
        '- #101 (current)',
      ].join('\n')],
      [103, [
        '# Child three',
        '',
        regionTemplate,
        '',
        '## Stack',
        '',
        '- #101',
        '- #103 (current)',
      ].join('\n')],
      [500, [
        '# Retained leaf prose',
        '',
        '<!-- ai-conductor:step release-disposition -->',
        staleLeafRegion.trim(),
        '<!-- /ai-conductor:step -->',
        '',
        '## Stack',
        '',
        '- #101',
        '- #103',
        '- #500 (current)',
        '',
        'Plan: demo',
        'Closes acme/demo#7',
      ].join('\n')],
    ]);
    const trace: string[] = [];
    const events: unknown[] = [];
    const { gh, operations } = fixture('main', trace, undefined, {}, bodies);

    await assembleStack({
      root, slug: 'demo', leafUrl, baseBranch: 'main', git: tracingGit(trace), gh, operations,
      refreshMemberBodies: true, template: regionTemplate,
      events: { emit: async (event) => { events.push(event); } },
    });

    for (const [number, body] of bodies) {
      expect(body).toContain([
        '## Stack',
        '',
        ...members.map((member) => `- #${member.pr}${member.pr === number ? ' (current)' : ''}`),
      ].join('\n'));
    }
    expect(bodies.get(101)).toContain(regionTemplate);
    expect(bodies.get(103)).toContain(regionTemplate);
    expect(bodies.get(500)).toContain(`<!-- ai-conductor:step release-disposition -->${capturedLeafRegion}<!-- /ai-conductor:step -->`);
    expect(bodies.get(500)).toContain('Plan: demo');
    expect(bodies.get(500)).toContain('Closes acme/demo#7');
    expect(trace.filter((entry) => entry.startsWith('edit:'))).toEqual(['edit:101', 'edit:103', 'edit:500']);
    expect(events).toContainEqual({ type: 'stack_assembled', prs: [101, 103, 500] });
    const captures = await readFile(join(root, '.pipeline', 'pr-body-region-captures.json'), 'utf8');
    expect(captures).toContain(leafUrl);
    expect(captures).not.toContain('/pull/101');
    expect(captures).not.toContain('/pull/103');
  });

  it('checks a child re-render before edit and leaves it untouched when its body violates child postconditions', async () => {
    await writeRecord({ version: 1, members });
    const bodies = new Map<number, string>([
      [101, `${regionTemplate}\n\nCloses acme/demo#7`],
      [103, regionTemplate],
      [500, '## Stack\n\n- #500 (current)'],
    ]);
    const trace: string[] = [];
    const { gh, operations } = fixture('main', trace, undefined, {}, bodies);

    await expect(assembleStack({
      root, slug: 'demo', leafUrl: 'https://github.com/acme/demo/pull/500', baseBranch: 'main',
      git: tracingGit(trace), gh, operations, refreshMemberBodies: true, template: regionTemplate,
    })).rejects.toMatchObject({ reason: 'stack_publication_precondition_failed', message: expect.stringContaining('feat/c1/demo') });

    expect(trace.filter((entry) => entry.startsWith('edit:'))).toEqual([]);
  });
});
