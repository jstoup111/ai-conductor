// Covers: task:rem-prd-audit-rem-prd-audit-rem-v4-child-divergence-member, task:rem-prd-audit-R3, task:rem-prd-audit-R4
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseChildId } from '../../src/engine/child-context.js';
import { writeCoverageBindingEnvelope, type CoverageBindingEnvelopeFilesystem } from '../../src/engine/coverage-binding-envelope.js';
import { pushedTipRef } from '../../src/engine/push-lease.js';
import { makeGitRunner, type GitRunner } from '../../src/engine/rebase.js';
import type { GithubMutationExecutionContext, GhRunner } from '../../src/engine/tracker-client.js';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const c1 = parseChildId(1)!;
const c3 = parseChildId(3)!;
const c5 = parseChildId(5)!;
const leafUrl = 'https://github.com/acme/demo/pull/500';

let root: string;
let origin: string;

const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

async function git(args: string[], options?: Parameters<GitRunner>[1]) {
  return makeGitRunner(root)(args, options);
}

async function ref(name: string): Promise<string> {
  return (await git(['rev-parse', name])).stdout.trim();
}

async function sealStack(): Promise<void> {
  const positions = await git(['hash-object', '-w', '--stdin'], { input: JSON.stringify([c1, c3, c5]) });
  await git(['update-ref', 'refs/conductor/demo/positions', positions.stdout.trim()]);
  await writeCoverageBindingEnvelope(root, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { one: c1, three: c3, leaf: c5 }, titles: ['One', 'Three', 'Leaf'] },
    storyOwnership: { S1: c1, S3: c3, S5: c5 },
  }, envelopeFilesystem);
}

async function publishRemote(branch: string, target: string): Promise<void> {
  await git(['push', 'origin', `${target}:refs/heads/${branch}`]);
}

function listedPullRequests(listed: readonly number[]): GhRunner {
  return async (args) => {
    const branch = args[args.indexOf('--head') + 1];
    const number = branch === 'feat/c1/demo' ? 101
      : branch === 'feat/c3/demo' ? 103
        : branch === 'feat/daemon-demo' ? 500
          : undefined;
    if (number === undefined) throw new Error(`unexpected PR list: ${args.join(' ')}`);
    return {
      stdout: JSON.stringify(listed.includes(number) || number === 500
        ? [{ number, isDraft: true, state: 'OPEN', baseRefName: number === 101 ? 'main' : 'feat/c1/demo' }]
        : []),
    };
  };
}

const operations = { run: async () => ({}) };

function recordingEvents(records: unknown[]): ConductorEventEmitter {
  const events = new ConductorEventEmitter();
  events.on('stack_tip_diverged', (event) => { records.push(event); });
  events.on('stack_member_redrafted', (event) => { records.push(event); });
  events.on('stack_member_published', (event) => { records.push(event); });
  return events;
}

async function establishThroughProductionCoordinator(gh: GhRunner, events: unknown[]): Promise<unknown> {
  vi.resetModules();
  vi.doMock('../../src/engine/finish-publication.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/engine/finish-publication.js')>();
    return {
      ...actual,
      advanceFinishPublication: async (input: { effects: { establishChildPrs: () => Promise<void> } }) => {
        await input.effects.establishChildPrs();
        return { kind: 'advanced' as const, transition: 'establish_child_prs' as const };
      },
    };
  });
  try {
    const { createProductionFinishPublicationCoordinator } = await import('../../src/engine/finish-publication-production.js');
    return await createProductionFinishPublicationCoordinator({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      baseBranch: 'main',
      git,
      gh,
      operations,
      remoteMutation: {} as GithubMutationExecutionContext,
      events: recordingEvents(events),
    }).advance({
      state: { feature_desc: 'demo', pr_url: leafUrl } as ConductState,
      mode: 'auto', daemon: true, dispatchJudgment: async () => ({ success: true }), emit: async () => {},
    });
  } finally {
    vi.doUnmock('../../src/engine/finish-publication.js');
    vi.resetModules();
  }
}

/**
 * Exercise the production target-binding closure rather than supplying a
 * permissive test runner. The fallback runner deliberately throws: success
 * proves every child and leaf mutation was rebound to its exact target before
 * the real mutation-policy runner reached the fake GitHub transport.
 */
async function establishThroughTargetBoundProductionCoordinator(
  gh: GhRunner,
  events: unknown[],
  remoteCalls: string[][],
  trace: string[],
): Promise<unknown> {
  const mutation: GithubMutationExecutionContext = {
    provenance: {
      repository: 'acme/demo', defaultBranch: 'main', specBranch: 'feat/daemon-demo',
      featureMarker: '.docs/intake/demo.md', publication: 'initial',
    },
    dependencies: {
      resolveMachineOwner: async () => ({ resolved: true, id: 'alice' }),
      provenanceDiscovery: {
        readCommittedRecords: async () => [{ path: '.docs/intake/demo.md', content: 'Owner: alice\n' }],
      },
    },
  };
  vi.resetModules();
  vi.doMock('../../src/engine/finish-publication.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/engine/finish-publication.js')>();
    return {
      ...actual,
      advanceFinishPublication: async (input: { effects: { establishChildPrs: () => Promise<void> } }) => {
        await input.effects.establishChildPrs();
        return { kind: 'advanced' as const, transition: 'establish_child_prs' as const };
      },
    };
  });
  vi.doMock('../../src/engine/ship-draft-pr.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/engine/ship-draft-pr.js')>();
    return {
      ...actual,
      createShipDraftPublicationDependencies: async () => ({
        remoteMutation: mutation,
        operations: { run: async () => { throw new Error('unbound fallback runner must not execute'); } },
      }),
    };
  });
  try {
    const { createProductionFinishPublicationCoordinator } = await import('../../src/engine/finish-publication-production.js');
    return await createProductionFinishPublicationCoordinator({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      baseBranch: 'main',
      git,
      gh,
      remoteMutation: mutation,
      remoteGit: async (args) => {
        remoteCalls.push([...args]);
        trace.push(`push:${args.at(-1)}`);
        return {
          kind: 'executed' as const,
          targets: [{
            operation: 'remote-ref.push' as const, repository: 'acme/demo', kind: 'remote-ref' as const,
            ref: args.at(-1)!.split(':').at(-1)!, endpoint: 'https' as const,
          }],
        };
      },
      events: recordingEvents(events),
    }).advance({
      state: { feature_desc: 'demo', worktree_branch: 'feat/daemon-demo', pr_url: leafUrl } as ConductState,
      mode: 'auto', daemon: true, dispatchJudgment: async () => ({ success: true }), emit: async () => {},
    });
  } finally {
    vi.doUnmock('../../src/engine/finish-publication.js');
    vi.doUnmock('../../src/engine/ship-draft-pr.js');
    vi.resetModules();
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'finish-publication-child-divergence-'));
  origin = join(root, 'origin.git');
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'stack@example.invalid']);
  await git(['config', 'user.name', 'Stack fixture']);
  await writeFile(join(root, 'README.md'), 'fixture\n');
  await git(['add', 'README.md']);
  await git(['commit', '-qm', 'fixture']);
  await git(['checkout', '-qb', 'feat/c1/demo']);
  await writeFile(join(root, 'one.txt'), 'one\n');
  await git(['add', 'one.txt']);
  await git(['commit', '-qm', 'child one']);
  await git(['update-ref', 'refs/conductor/demo/closed/c1', await ref('HEAD')]);
  await git(['checkout', '-qb', 'feat/c3/demo']);
  await writeFile(join(root, 'three.txt'), 'three\n');
  await git(['add', 'three.txt']);
  await git(['commit', '-qm', 'child three']);
  await git(['update-ref', 'refs/conductor/demo/closed/c3', await ref('HEAD')]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await writeFile(join(root, 'leaf.txt'), 'leaf\n');
  await git(['add', 'leaf.txt']);
  await git(['commit', '-qm', 'leaf']);
  await git(['init', '--bare', '-b', 'main', '-q', origin]);
  await git(['remote', 'add', 'origin', origin]);
  await sealStack();
  await mkdir(join(root, '.docs', 'stories'), { recursive: true });
  await writeFile(join(root, '.docs', 'stories', 'demo.md'), [
    '## Story S1: One',
    '',
    '## Story S3: Three',
  ].join('\n'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('establishChildPrs child-closure divergence', () => {
  it('reports only the diverging listed child', async () => {
    const c1Closure = await ref('refs/conductor/demo/closed/c1');
    await publishRemote('feat/c1/demo', c1Closure);
    await git(['update-ref', pushedTipRef('demo', 'feat/c1/demo'), c1Closure]);
    await publishRemote('feat/c3/demo', 'main');
    const events: unknown[] = [];

    await expect(establishThroughProductionCoordinator(listedPullRequests([101, 103]), events))
      .rejects.toMatchObject({ reason: 'stack_tip_diverged', message: 'child closure diverged at position 3' });

    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toBe(
      'published stack tip diverged at position 3 for positions: 3\n',
    );
    expect(events).toContainEqual({ type: 'stack_tip_diverged', prs: [103] });
  });

  it('does not name the leaf when no child PR has been recorded or listed', async () => {
    await publishRemote('feat/c1/demo', 'main');
    const events: unknown[] = [];

    await expect(establishThroughProductionCoordinator(listedPullRequests([]), events))
      .rejects.toMatchObject({ reason: 'stack_tip_diverged', message: 'child closure diverged at position 1' });

    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toBe(
      'published stack tip diverged at position 1 for positions: 1\n',
    );
    expect(events).toContainEqual({ type: 'stack_tip_diverged', prs: [] });
  });

  it('publishes children through target-bound mutation policy runners and re-drafts the ready leaf before the first push', async () => {
    const ghCalls: string[][] = [];
    const remoteCalls: string[][] = [];
    const events: unknown[] = [];
    const trace: string[] = [];
    const prs = new Map<string, { number: number; isDraft: boolean; base: string }>([
      ['feat/daemon-demo', { number: 500, isDraft: false, base: 'main' }],
    ]);
    const gh: GhRunner = async (args) => {
      ghCalls.push([...args]);
      if (args[0] === 'pr' && args[1] === 'list') {
        const branch = args[args.indexOf('--head') + 1]!;
        const pr = prs.get(branch);
        return { stdout: JSON.stringify(pr === undefined ? [] : [{
          number: pr.number, isDraft: pr.isDraft, state: 'OPEN', baseRefName: pr.base,
        }]) };
      }
      if (args[0] === 'pr' && args[1] === 'ready' && args.includes('--undo')) {
        const number = Number(args[2]);
        const leaf = prs.get('feat/daemon-demo');
        if (number !== 500 || !leaf) throw new Error(`unexpected re-draft argv: ${args.join(' ')}`);
        leaf.isDraft = true;
        trace.push('redraft:500');
        return { stdout: '' };
      }
      if (args[0] === 'pr' && args[1] === 'create') {
        const branch = args[args.indexOf('--head') + 1]!;
        const base = args[args.indexOf('--base') + 1]!;
        const number = branch === 'feat/c1/demo' ? 101 : branch === 'feat/c3/demo' ? 103 : undefined;
        if (number === undefined) throw new Error(`unexpected child create argv: ${args.join(' ')}`);
        prs.set(branch, { number, isDraft: true, base });
        trace.push(`create:${branch}`);
        return { stdout: '' };
      }
      throw new Error(`unexpected GitHub argv: ${args.join(' ')}`);
    };

    await expect(establishThroughTargetBoundProductionCoordinator(gh, events, remoteCalls, trace))
      .resolves.toMatchObject({ kind: 'publication_progress', transition: 'establish_child_prs' });

    expect(remoteCalls).toHaveLength(2);
    expect(remoteCalls.map((args) => args.at(-1))).toEqual([
      expect.stringMatching(/:refs\/heads\/feat\/c1\/demo$/),
      expect.stringMatching(/:refs\/heads\/feat\/c3\/demo$/),
    ]);
    expect(ghCalls.filter((args) => args[0] === 'pr' && args[1] === 'create').map((args) => [
      args[args.indexOf('--head') + 1], args[args.indexOf('--base') + 1],
    ])).toEqual([
      ['feat/c1/demo', 'main'],
      ['feat/c3/demo', 'feat/c1/demo'],
    ]);
    const redraft = ghCalls.findIndex((args) => args[0] === 'pr' && args[1] === 'ready' && args.includes('--undo'));
    expect(redraft).toBeGreaterThanOrEqual(0);
    expect(trace.indexOf('redraft:500')).toBeLessThan(trace.findIndex((entry) => entry.startsWith('push:')));
    expect(events.findIndex((event) => (event as { type?: string }).type === 'stack_member_redrafted'))
      .toBeLessThan(events.findIndex((event) => (event as { type?: string }).type === 'stack_member_published'));
    expect(events).toContainEqual({ type: 'stack_member_redrafted', child: c5, pr: 500 });
    expect(events).toContainEqual({ type: 'stack_member_published', child: c1, pr: 101 });
    expect(events).toContainEqual({ type: 'stack_member_published', child: c3, pr: 103 });
  });
});
