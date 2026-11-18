// Covers: task:16
// A planned fold has a source-to-placement plan, not generic replay ranges.
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { ConductorEventEmitter } from '../../../src/engine/conductor-event-emitter.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import {
  createRestackJournal,
  journalRefFor,
  readRestackJournal,
  writeRestackJournalBlob,
  type RestackJournal,
} from '../../../src/engine/restack/restack-journal.js';
import { recoverRestackJournal } from '../../../src/engine/restack/restack-recovery.js';
import type {
  ResolveRestackConflictOptions,
  RestackConflictResolution,
  RestackResolver,
} from '../../../src/engine/restack/restack-resolver.js';
import { createRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import type { FoldCommitPlan } from '../../../src/engine/restack/fold-types.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import type { CommitSha, RestackOpId } from '../../../src/engine/restack/restack-types.js';
import { writeSliceTopologyFixture } from '../slice-topology-fixture.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const DEAD_OWNER = { host: 'dead-fold-recovery-host', pid: 1, processStartTime: '0' } as const;
const foldConflictHarness = vi.hoisted(() => ({
  resolve: undefined as undefined | ((options: ResolveRestackConflictOptions) => Promise<RestackConflictResolution>),
}));

vi.mock('../../../src/engine/restack/restack-resolver.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/restack/restack-resolver.js')>();
  return {
    ...actual,
    resolveRestackConflict: (options: ResolveRestackConflictOptions) =>
      foldConflictHarness.resolve === undefined
        ? actual.resolveRestackConflict(options)
        : foldConflictHarness.resolve(options),
  };
});

afterEach(async () => {
  foldConflictHarness.resolve = undefined;
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

function child(value: number) {
  const parsed = parseChildId(value);
  if (!parsed) throw new Error(`invalid child ${value}`);
  return parsed;
}

async function fixture(options: { readonly stampedOwner?: boolean; readonly hardBreak?: boolean } = {}) {
  const repo = await mkdtemp(join(tmpdir(), 'restack-fold-recovery-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, path: string, content: string): Promise<CommitSha> => {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), content);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim() as CommitSha;
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'fold-recovery@example.test']);
  await git(['config', 'user.name', 'Fold recovery']);
  const base = await commit('base', 'base.txt', 'base\n');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const c1 = await commit('child one', 'src/server/identity.ts', 'child identity\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
  await git(['checkout', '-qb', 'feat/c2/demo']);
  const c2 = await commit('child two', 'two.txt', 'two\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c2', c2]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  const foldedSource = await commit(
    options.stampedOwner ? 'deferred repair\n\nRound: r1\nOwner: c1' : 'deferred repair',
    'src/server/identity.ts',
    options.hardBreak ? 'deferred identity  \n' : 'deferred identity\n',
  );
  const leaf = await commit('leaf build', 'src/server/ten-players.ts', 'ten players\n');
  const route = await createRouteRecord(
    repo,
    'demo',
    {
      roundId: parseRoundId('r1')!,
      kind: 'audit',
      sealedAuthored: 1,
      execution: 'leaf',
      items: [
        { findingId: 'finding-c1', kind: 'audit', owner: child(1), host: child(1), reason: 'repair', fallback: [] },
      ],
      allocation: { [child(1)]: { remTaskIds: [], blockBodies: [] } },
      placements: { [child(1)]: { state: 'deferred', leafEntryTip: c2, exitTip: foldedSource } },
    },
    { git: makeGitRunner(repo) },
  );
  if (route.kind !== 'created') throw new Error(`could not create deferred fold route: ${route.kind}`);
  await writeSliceTopologyFixture(repo, {
    version: 1,
    slug: 'demo',
    runId: 'fold-run',
    status: 'done',
    entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2, '3': 3 }, titles: ['Child 1', 'Child 2', 'Leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  });
  return { repo, git, base, c1, c2, foldedSource, leaf };
}

it('folds a last added Markdown hard break without changing the leaf tree', async () => {
  const subject = await fixture({ stampedOwner: true, hardBreak: true });
  const before = (await subject.git(['rev-parse', 'feat/daemon-demo^{tree}'])).stdout.trim();

  await expect(
    runRestack({ worktree: subject.repo, slug: 'demo', cause: 'fold', git: makeGitRunner(subject.repo) }),
  ).resolves.toMatchObject({ kind: 'applied' });

  expect((await subject.git(['show', 'feat/c1/demo:src/server/identity.ts'])).stdout).toBe('deferred identity  \n');
  expect((await subject.git(['rev-parse', 'feat/daemon-demo^{tree}'])).stdout.trim()).toBe(before);
});

async function snapshot(git: (args: string[]) => Promise<{ stdout: string }>) {
  const refs = [
    'refs/heads/feat/c1/demo',
    'refs/conductor/demo/closed/c1',
    'refs/heads/feat/c2/demo',
    'refs/conductor/demo/closed/c2',
    'refs/heads/feat/daemon-demo',
  ];
  return Object.fromEntries(
    await Promise.all(refs.map(async (name) => [name, (await git(['rev-parse', name])).stdout.trim()])),
  );
}

describe('planned fold recovery (real local Git)', () => {
  it('re-materializes only frozen blocks while replaying a mixed source commit on its planned children', async () => {
    const subject = await fixture();
    const block = '### Task rem-prd-audit-T1: Repair\n**Done when:**\n- fixed\n**Child:** 1\n**Round:** r2\n';
    const planPath = join(subject.repo, '.docs', 'plans', 'demo.md');
    const [basePlan, stories, complexity] = await Promise.all([
      readFile(planPath, 'utf8'),
      readFile(join(subject.repo, '.docs', 'stories', 'demo.md'), 'utf8'),
      readFile(join(subject.repo, '.docs', 'complexity', 'demo.md'), 'utf8'),
    ]);

    await subject.git(['update-ref', '-d', 'refs/conductor/demo/routes/r1']);
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await mkdir(join(subject.repo, '.docs', 'plans'), { recursive: true });
    await mkdir(join(subject.repo, '.docs', 'stories'), { recursive: true });
    await mkdir(join(subject.repo, '.docs', 'complexity'), { recursive: true });
    await writeFile(planPath, basePlan);
    await writeFile(join(subject.repo, '.docs', 'stories', 'demo.md'), stories);
    await writeFile(join(subject.repo, '.docs', 'complexity', 'demo.md'), complexity);
    await subject.git(['add', '.docs/plans/demo.md', '.docs/stories/demo.md', '.docs/complexity/demo.md']);
    await subject.git(['commit', '-qm', 'child one plan']);
    const c1 = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim() as CommitSha;
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);

    await subject.git(['checkout', '-qB', 'feat/c2/demo', c1]);
    await writeFile(join(subject.repo, 'residual.txt'), 'before\n');
    await subject.git(['add', 'residual.txt']);
    await subject.git(['commit', '-qm', 'child two residual']);
    const c2 = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim() as CommitSha;
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', c2]);

    await subject.git(['checkout', '-qB', 'feat/daemon-demo', c2]);
    await writeFile(join(subject.repo, 'leaf.txt'), 'leaf\n');
    await subject.git(['add', 'leaf.txt']);
    await subject.git(['commit', '-qm', 'leaf build']);
    const entry = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim() as CommitSha;
    const foldedPlan = `${basePlan}${basePlan.endsWith('\n') ? '\n' : '\n\n'}${block}`;
    await writeFile(planPath, foldedPlan);
    await writeFile(join(subject.repo, 'residual.txt'), 'after\n');
    await subject.git(['add', '.docs/plans/demo.md', 'residual.txt']);
    await subject.git(['commit', '-qm', 'mixed routed repair\n\nRound: r2\nOwner: c1']);
    const source = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim() as CommitSha;
    const preFoldTree = (await subject.git(['rev-parse', `${source}^{tree}`])).stdout.trim();

    const route = await createRouteRecord(
      subject.repo,
      'demo',
      {
        roundId: parseRoundId('r2')!,
        kind: 'audit',
        sealedAuthored: 1,
        execution: 'leaf',
        items: [
          { findingId: 'mixed', kind: 'audit', owner: child(1), host: child(1), reason: 'repair', fallback: [] },
        ],
        allocation: { [child(1)]: { remTaskIds: ['rem-prd-audit-T1'], blockBodies: [block] } },
        placements: { [child(1)]: { state: 'deferred', leafEntryTip: entry, exitTip: source } },
      },
      { git: makeGitRunner(subject.repo) },
    );
    if (route.kind !== 'created') throw new Error(`could not create mixed fold route: ${route.kind}`);

    const folded = await runRestack({ worktree: subject.repo, slug: 'demo', cause: 'fold', git: makeGitRunner(subject.repo) });
    expect(folded).toMatchObject({ kind: 'applied' });

    expect((await subject.git(['show', 'feat/c1/demo:.docs/plans/demo.md'])).stdout).toBe(foldedPlan);
    await expect(subject.git(['show', 'feat/c1/demo:residual.txt'])).rejects.toMatchObject({ code: 128 });
    expect((await subject.git(['show', 'feat/c2/demo:residual.txt'])).stdout).toBe('after\n');
    expect((await subject.git(['log', '-Safter', '--format=%H', 'feat/c2/demo', '--', 'residual.txt'])).stdout.trim().split('\n'))
      .toHaveLength(1);
    expect((await subject.git(['log', '--format=%H', 'feat/c2/demo'])).stdout.trim().split('\n')).not.toContain(source);
    expect((await subject.git(['rev-parse', 'feat/daemon-demo^{tree}'])).stdout.trim()).toBe(preFoldTree);
  });

  it('rolls every ref back rather than generically replaying an interrupted FoldPlan', async () => {
    const subject = await fixture();
    const before = await snapshot(subject.git);
    const foldPlan: readonly FoldCommitPlan[] = [
      {
        sha: subject.foldedSource,
        roundId: parseRoundId('r1')!,
        owner: child(1),
        parts: [{ kind: 'whole', child: child(1), paths: [], reason: 'owner' }],
      },
    ];
    const created = await createRestackJournal(
      subject.repo,
      'demo',
      {
        opId: 'planned-fold-recovery' as RestackOpId,
        cause: 'fold',
        foldPlan,
        committer: { name: 'Fold recovery', email: 'fold-recovery@example.test', date: '2030-01-02T03:04:05Z' },
        dirtyPaths: [],
        refs: Object.entries(before).map(([ref, oldSha]) => ({ ref: ref as never, oldSha: oldSha as CommitSha })),
        ranges: [
          { child: child(1), oldParent: subject.base, oldTip: subject.c1, kind: 'closed' },
          { child: child(2), oldParent: subject.c1, oldTip: subject.c2, kind: 'closed' },
          { child: child(3), oldParent: subject.c2, oldTip: subject.leaf, kind: 'leaf-active' },
        ],
        children: [child(1), child(2), child(3)].map((value) => ({ child: value, status: 'pending' as const })),
      },
      undefined,
      { git: makeGitRunner(subject.repo) },
    );
    if (created.kind !== 'created') throw new Error(`could not create planned fold journal: ${created.kind}`);

    // The journal write is durable; process death happens before staging or a move.
    const abandoned: RestackJournal = { ...created.journal.journal, owner: DEAD_OWNER };
    const abandonedBlob = await writeRestackJournalBlob(subject.repo, abandoned, { git: makeGitRunner(subject.repo) });
    await subject.git(['update-ref', journalRefFor('demo'), abandonedBlob, created.journal.blob]);

    await expect(
      recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) }),
    ).resolves.toEqual({ kind: 'recovered', fromState: 'planned' });

    expect(await snapshot(subject.git)).toEqual(before);
    expect(await readRestackJournal(subject.repo, 'demo')).toEqual({ kind: 'missing' });
    expect((await subject.git(['log', '--format=%B', 'feat/c1/demo', 'feat/daemon-demo'])).stdout).not.toContain(
      'Folded-from:',
    );
  });

  it('leaves every ref untouched when a fold refuses its invalid owner before moving', async () => {
    const subject = await fixture();
    const before = await snapshot(subject.git);

    await expect(
      runRestack({ worktree: subject.repo, slug: 'demo', cause: 'fold', git: makeGitRunner(subject.repo) }),
    ).resolves.toMatchObject({ kind: 'halted' });

    expect(await snapshot(subject.git)).toEqual(before);
    await expect(
      recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) }),
    ).resolves.not.toMatchObject({ kind: 'live-owner' });
  });

  // Covers: task:rem-prd-audit-rem2-S3.1
  it('keeps child 1 on its existing parent when origin/HEAD advances before the fold', async () => {
    const subject = await fixture({ stampedOwner: true });
    await subject.git(['checkout', '-q', 'main']);
    await writeFile(join(subject.repo, 'advanced.txt'), 'advanced\n');
    await subject.git(['add', 'advanced.txt']);
    await subject.git(['commit', '-qm', 'advanced default']);
    const advanced = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim();
    await subject.git(['update-ref', 'refs/remotes/origin/main', advanced]);
    await subject.git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);

    await expect(
      runRestack({ worktree: subject.repo, slug: 'demo', cause: 'fold', git: makeGitRunner(subject.repo) }),
    ).resolves.toMatchObject({ kind: 'applied' });

    expect((await subject.git(['merge-base', subject.base, 'feat/c1/demo'])).stdout.trim()).toBe(subject.base);
    await expect(subject.git(['merge-base', '--is-ancestor', advanced, 'feat/c1/demo'])).rejects.toMatchObject({ code: 1 });
    expect((await subject.git(['show', 'feat/c1/demo:src/server/identity.ts'])).stdout).toBe('deferred identity\n');
    expect((await subject.git(['show', 'feat/daemon-demo:src/server/ten-players.ts'])).stdout).toBe('ten players\n');
  });

  // Covers: task:rem-as-built-rem2-asb-3, task:rem-prd-audit-rem2-S7.1
  it('resolves a fold replay conflict and persists its fold resolver attribution', async () => {
    const subject = await fixture({ stampedOwner: true });
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    const resolver: RestackResolver = async ({ restack }) => {
      await events.emit({
        type: 'provider_attempt',
        step: 'rebase',
        provider: 'test-resolver',
        outcome: 'success',
        invoked: true,
        ...(restack === undefined ? {} : { restack }),
      });
      return { resolved: true };
    };
    const native = makeGitRunner(subject.repo);
    const conflict = async (...args: Parameters<typeof native>) => {
      if (args[0][0] === 'merge-tree' && args[0].at(-1) === subject.c2)
        return { stdout: '', stderr: 'CONFLICT (content): Merge conflict in two.txt\n', exitCode: 1 };
      return native(...args);
    };
    foldConflictHarness.resolve = async (options) => {
      expect(options).toMatchObject({ cap: 1, range: { child: child(2) }, restack: { cause: 'fold', roundId: 'r1' } });
      await options.resolver({
        conflicts: ['two.txt'],
        projectRoot: options.worktree,
        baseRef: options.newParent,
        environment: {},
        restack: options.restack,
      });
      const merged = await native([
        'merge-tree', '--write-tree', '--merge-base', options.range.oldParent, options.newParent, options.range.oldTip,
      ]);
      if (merged.exitCode !== 0) throw new Error(`could not build resolved fold child: ${merged.stderr}`);
      const committed = await native(['commit-tree', merged.stdout.trim(), '-p', options.newParent], { input: 'resolved fold child\n' });
      const tip = committed.stdout.trim() as CommitSha;
      return {
        outcome: { kind: 'changed', baseSha: options.newParent, changedCodePaths: [] },
        tip,
        rewrites: new Map([[options.range.oldTip, tip]]),
        candidates: [options.range.oldTip],
      };
    };

    let result: Awaited<ReturnType<typeof runRestack>>;
    try {
      result = await runRestack({
        worktree: subject.repo,
        slug: 'demo',
        cause: 'fold',
        events,
        resolver,
        resolverCap: 1,
        git: conflict,
      });
    } finally {
      persister.stop();
    }

    expect(result!).toMatchObject({ kind: 'applied' });
    const persisted = (await readFile(join(subject.repo, '.pipeline', 'events.jsonl'), 'utf8'))
      .split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
    const foldPlan = persisted.find((event) => event.type === 'restack_planned' && event.cause === 'fold');
    expect(foldPlan).toBeDefined();
    expect(persisted).toContainEqual(expect.objectContaining({
      type: 'provider_attempt',
      step: 'rebase',
      restack: { opId: foldPlan!.opId, cause: 'fold', roundId: 'r1' },
    }));
    expect((await subject.git(['show', 'feat/c2/demo:src/server/identity.ts'])).stdout).toBe('deferred identity\n');
  });

  // Covers: task:rem-as-built-rem2-asb-3
  it('halts a fold replay conflict after the resolver cap is exhausted without moving refs', async () => {
    const subject = await fixture({ stampedOwner: true });
    const before = await snapshot(subject.git);
    let attempts = 0;
    const resolver: RestackResolver = async () => {
      attempts += 1;
      return { resolved: false, reason: 'cannot resolve fold conflict' };
    };
    const native = makeGitRunner(subject.repo);
    const conflict = async (...args: Parameters<typeof native>) => {
      if (args[0][0] === 'merge-tree' && args[0].at(-1) === subject.c2)
        return { stdout: '', stderr: 'CONFLICT (content): Merge conflict in two.txt\n', exitCode: 1 };
      return native(...args);
    };
    foldConflictHarness.resolve = async (options) => {
      expect(options.cap).toBe(1);
      const attempt = await options.resolver({
        conflicts: ['two.txt'],
        projectRoot: options.worktree,
        baseRef: options.newParent,
        environment: {},
        restack: options.restack,
      });
      return {
        outcome: { kind: 'conflict_halt', conflicts: ['two.txt'], reason: attempt.reason ?? 'resolver cap exhausted' },
        tip: undefined,
        rewrites: new Map(),
        candidates: [options.range.oldTip],
      };
    };

    await expect(runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'fold',
      resolver,
      resolverCap: 1,
      git: conflict,
    })).resolves.toMatchObject({ kind: 'halted' });

    expect(attempts).toBe(1);
    expect(await snapshot(subject.git)).toEqual(before);
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('cannot resolve fold conflict');
  });

  it('aborts its journal and leaves every ref untouched when the folded leaf tree differs', async () => {
    const subject = await fixture({ stampedOwner: true });
    const before = await snapshot(subject.git);
    const native = makeGitRunner(subject.repo);
    const mismatchedTree = async (...args: Parameters<typeof native>) => {
      const result = await native(...args);
      if (args[0][0] === 'rev-parse' && args[0][1]?.endsWith('^{tree}') && args[0][1] !== `${subject.leaf}^{tree}`) {
        return { ...result, stdout: `${subject.base}\n` };
      }
      return result;
    };

    await expect(
      runRestack({ worktree: subject.repo, slug: 'demo', cause: 'fold', git: mismatchedTree }),
    ).resolves.toMatchObject({ kind: 'halted' });

    expect(await snapshot(subject.git)).toEqual(before);
    await expect(
      recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) }),
    ).resolves.not.toMatchObject({ kind: 'live-owner' });
  });

  it('rolls back every ref and releases its journal when fold move verification fails', async () => {
    const subject = await fixture({ stampedOwner: true });
    const before = await snapshot(subject.git);
    const native = makeGitRunner(subject.repo);
    let moved = false;
    const verificationFailure = async (...args: Parameters<typeof native>) => {
      const result = await native(...args);
      if (
        args[0][0] === 'update-ref' &&
        args[0][1] === '--stdin' &&
        args[1]?.input?.includes('update refs/heads/feat/c1/demo ')
      )
        moved = true;
      if (moved && args[0].join(' ') === 'rev-parse --verify refs/heads/feat/c1/demo') {
        return { ...result, stdout: `${subject.c1}\n` };
      }
      return result;
    };

    await expect(
      runRestack({ worktree: subject.repo, slug: 'demo', cause: 'fold', git: verificationFailure }),
    ).resolves.toMatchObject({ kind: 'halted' });

    expect(await snapshot(subject.git)).toEqual(before);
    await expect(
      recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) }),
    ).resolves.not.toMatchObject({ kind: 'live-owner' });
  });
});
