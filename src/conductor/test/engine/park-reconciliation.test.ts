// Covers: task:1
import { describe, expect, it, vi } from 'vitest';
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  proveByMergedPrHead,
  reconcileMergedPark,
  reconcileParkedFeatures,
  requiresShippedRecord,
} from '../../src/engine/park-reconciliation.js';
import type { GhRunner, GitRunner } from '../../src/engine/pr-labels.js';
import { GhCapabilityError } from '../../src/engine/tracker-client.js';
import {
  getProvenanceType,
  isOperatorParked,
  removeOperatorPark,
  writeAutoPark,
  writeOperatorPark,
} from '../../src/engine/park-marker.js';
import { TEARDOWN_SCRIPT } from '../../src/engine/worktree-prepare.js';
import * as daemonParkCli from '../../src/engine/daemon-park-cli.js';

/**
 * A faithful in-memory stand-in for the four git reads the reconciler makes,
 * dispatched on the verb rather than on call order — the reconciler now reads
 * the base-branch shipped-record tree and the local ref listing before any
 * ancestry probe, and a sweep reads them once for the whole pass.
 *
 * `shipped`:
 *   - `string[]`  — `.docs/shipped` exists on origin/main with these stems
 *   - `'no-tree'` — origin/main exists but carries no `.docs/shipped` tree
 *   - `'unavailable'` — origin/main itself cannot be read (infra failure)
 */
interface GitWorld {
  shipped?: readonly string[] | 'no-tree' | 'unavailable';
  /** Local branches, full short refname (`spec/foo`, `feat/foo`, …). */
  branches?: readonly string[];
  /** Subset of `branches` contained in origin/main. */
  merged?: readonly string[];
  /** Merged PR heads that are ancestors of a branch despite the branch being outside origin/main. */
  mergedPrHeads?: readonly string[];
  /** Current tip SHA per branch, for `git rev-parse <branch>`. */
  tips?: Readonly<Record<string, string>>;
  /** Lines emitted by `git log --oneline --no-decorate <head>..<ref>`. */
  unmergedLog?: readonly string[] | 'unavailable';
  /** Refs whose ancestry probe fails with a non-1 exit (broken repo state). */
  ancestryBroken?: readonly string[];
  /** `git for-each-ref` itself fails. */
  refsUnavailable?: boolean;
  /** `git branch -d`/`-D` fails whatever the ref's merge state. */
  branchDeleteFails?: boolean;
  /** `git worktree remove` fails with this message (non-ENOENT, as git reports). */
  worktreeRemoveFails?: string;
  /** Paths `git worktree list --porcelain` reports as registered worktrees. */
  registeredWorktrees?: readonly string[];
  /** `git worktree list --porcelain` itself fails. */
  worktreeListUnavailable?: boolean;
  /** Output of `git status --porcelain` for the candidate worktree. */
  statusPorcelain?: string;
  /** Assertion seam for ordering a real project teardown before git removal. */
  onWorktreeRemove?: () => void | Promise<void>;
}

function gitFailure(code: number, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function makeGit(world: GitWorld = {}): {
  run: ReturnType<typeof vi.fn<GitRunner>>;
  deleted: string[];
  deleteArgv: string[][];
  events: string[];
} {
  const shipped = world.shipped ?? [];
  const branches = world.branches ?? [];
  const merged = world.merged ?? [];
  const deleted: string[] = [];
  const deleteArgv: string[][] = [];
  const events: string[] = [];

  const run = vi.fn<GitRunner>(async (args) => {
    const [verb] = args;
    if (verb === 'ls-tree') {
      if (shipped === 'no-tree' || shipped === 'unavailable') {
        throw gitFailure(128, 'fatal: Not a valid object name origin/main:.docs/shipped');
      }
      return { stdout: `${shipped.map((stem) => `${stem}.md`).join('\n')}\n` };
    }
    if (verb === 'rev-parse') {
      if (args[1] !== '--verify') {
        const tip = world.tips?.[args[1]];
        if (tip === undefined) throw gitFailure(128, `fatal: bad revision ${args[1]}`);
        return { stdout: `${tip}\n` };
      }
      if (shipped === 'unavailable') {
        throw gitFailure(128, 'fatal: Needed a single revision');
      }
      return { stdout: 'deadbeef\n' };
    }
    if (verb === 'cat-file') return { stdout: '' };
    if (verb === 'log') {
      if (world.unmergedLog === 'unavailable') {
        throw gitFailure(128, 'fatal: invalid revision range');
      }
      return { stdout: `${(world.unmergedLog ?? []).join('\n')}\n` };
    }
    if (verb === 'for-each-ref') {
      if (world.refsUnavailable) throw gitFailure(128, 'fatal: not a git repository');
      return { stdout: `${branches.join('\n')}\n` };
    }
    if (verb === 'merge-base') {
      const ref = args[2];
      if (world.ancestryBroken?.includes(ref)) {
        throw gitFailure(128, `fatal: Not a valid object name ${ref}`);
      }
      if (args[3] !== undefined && world.mergedPrHeads?.includes(ref)) return { stdout: '' };
      if (merged.includes(ref)) return { stdout: '' };
      throw gitFailure(1, 'not an ancestor');
    }
    if (verb === 'status') return { stdout: world.statusPorcelain ?? '' };
    if (verb === 'branch') {
      events.push('branch-deleted');
      deleteArgv.push([...args]);
      if (world.branchDeleteFails) throw gitFailure(1, 'branch delete failed');
      // Faithful to git: the safe delete refuses any ref it cannot prove merged
      // by ancestry, which is exactly the squash-merge case. Only `-D` forces.
      if (args[1] === '-d' && !merged.includes(args[2])) {
        throw gitFailure(1, `error: the branch '${args[2]}' is not fully merged`);
      }
      deleted.push(args[2]);
      return { stdout: '' };
    }
    if (verb === 'worktree') {
      if (args[1] === 'list') {
        if (world.worktreeListUnavailable) throw gitFailure(128, 'fatal: not a git repository');
        return {
          stdout: (world.registeredWorktrees ?? [])
            .map((path) => {
              const slug = path.split('/').at(-1);
              const branch = branches.find((ref) => ref.endsWith(`/${slug}`));
              return `worktree ${path}\nHEAD deadbeef\n${branch ? `branch refs/heads/${branch}\n` : ''}`;
            })
            .join('\n'),
        };
      }
      await world.onWorktreeRemove?.();
      events.push('worktree-removed');
      if (world.worktreeRemoveFails) throw gitFailure(128, world.worktreeRemoveFails);
      return { stdout: '' };
    }
    throw new Error(`unexpected git invocation: ${args.join(' ')}`);
  });

  return { run, deleted, deleteArgv, events };
}

describe('engine/park-reconciliation — proveByMergedPrHead', () => {
  const projectRoot = '/project';
  const ref = 'feat/parked';
  const mergedHead = '1111111111111111111111111111111111111111';
  const branchTip = '2222222222222222222222222222222222222222';

  function probeGit(mergeBaseExit?: 1, catFileFails = false): ReturnType<typeof vi.fn<GitRunner>> {
    return vi.fn<GitRunner>(async (args) => {
      if (args[0] === 'rev-parse') return { stdout: `${branchTip}\n` };
      if (args[0] === 'cat-file') {
        if (catFileFails) throw gitFailure(128, 'fatal: Not a valid object name');
        return { stdout: '' };
      }
      if (args[0] === 'merge-base') {
        if (mergeBaseExit === 1) throw gitFailure(1, 'not an ancestor');
        return { stdout: '' };
      }
      throw new Error(`unexpected git invocation: ${args.join(' ')}`);
    });
  }

  it.each([
    { name: 'reports no-pr when no merged PR is found', pr: '[]', git: probeGit(), expected: { kind: 'no-pr' } },
    {
      name: 'proves a branch whose tip exactly matches the merged PR head',
      pr: `[{"headRefOid":"${branchTip}"}]`,
      git: probeGit(),
      expected: { kind: 'proven' },
    },
    {
      name: 'reports ahead after the merged PR head is guarded and is an ancestor of the branch',
      pr: `[{"headRefOid":"${mergedHead}"}]`,
      git: probeGit(),
      expected: { kind: 'ahead', headRefOid: mergedHead },
    },
    {
      name: 'reports behind after the merged PR head is guarded but is not an ancestor of the branch',
      pr: `[{"headRefOid":"${mergedHead}"}]`,
      git: probeGit(1),
      expected: { kind: 'behind', headRefOid: mergedHead },
    },
    {
      name: 'reports indeterminate when the mismatched merged PR head cannot be resolved locally',
      pr: `[{"headRefOid":"${mergedHead}"}]`,
      git: probeGit(undefined, true),
      expected: { kind: 'indeterminate' },
    },
  ])('$name', async ({ pr, git, expected }) => {
    const runGh = vi.fn<GhRunner>().mockResolvedValue({ stdout: pr });

    const diagnosis = await proveByMergedPrHead(git, runGh, projectRoot, ref);

    expect({
      diagnosis,
      gitCalls: git.mock.calls.map(([args]) => args),
      ghCalls: runGh.mock.calls,
    }).toEqual({
      diagnosis: expected,
      gitCalls:
        expected.kind === 'no-pr'
          ? []
          : expected.kind === 'proven'
            ? [['rev-parse', ref]]
          : expected.kind === 'indeterminate'
            ? [
                ['rev-parse', ref],
                ['cat-file', '-e', `${mergedHead}^{commit}`],
              ]
            : [
                ['rev-parse', ref],
                ['cat-file', '-e', `${mergedHead}^{commit}`],
                ['merge-base', '--is-ancestor', mergedHead, ref],
              ],
      ghCalls: [
        [
          ['pr', 'list', '--head', ref, '--state', 'merged', '--json', 'headRefOid', '--limit', '1'],
          { cwd: projectRoot },
        ],
      ],
    });
  });
});

describe('engine/park-reconciliation — reconcileMergedPark', () => {
  it.each([
    { branch: undefined, expected: true },
    { branch: 'feat/daemon-example', expected: true },
    { branch: 'feat/example', expected: false },
    { branch: 'hotfix/example', expected: false },
    { branch: 'spec/example', expected: false },
  ])('requires a shipped record for branch %j only when dispatch depends on it', ({ branch, expected }) => {
    expect(requiresShippedRecord(branch)).toBe(expected);
  });

  it.each(['*', 'a/b', 'a,b', ''])(
    'refuses invalid single-slug input %j before invoking git',
    async (slug) => {
      const runGit = vi.fn<GitRunner>();

      const outcome = await reconcileMergedPark({
        projectRoot: '/project',
        slug,
        runGit,
      });

      expect({ outcome, calls: runGit.mock.calls }).toEqual({
        outcome: { slug, steps: [], refusal: 'invalid-slug' },
        calls: [],
      });
    },
  );

  it.each([
    { name: 'a modified tracked path', porcelain: ' M tracked.ts\n', file: 'tracked.ts', dirty: true },
    { name: 'an untracked path', porcelain: '?? untracked.txt\n', file: 'untracked.txt', dirty: true },
    { name: 'an empty porcelain result for a worktree clean apart from ignored output', porcelain: '', file: 'ignored.log', dirty: false },
  ])('checks porcelain before reclaiming $name', async ({ porcelain, file, dirty }) => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'porcelain-guard';
    const branch = `hotfix/${slug}`;
    const worktree = join(projectRoot, '.worktrees', slug);
    const { run, deleted } = makeGit({
      branches: [branch],
      merged: [branch],
      statusPorcelain: porcelain,
    });
    try {
      await mkdir(worktree, { recursive: true });
      await writeFile(join(worktree, file), 'retained content\n');

      const outcome = await reconcileMergedPark({ projectRoot, slug, branch, runGit: run });
      const destructiveCalls = run.mock.calls
        .map(([args]) => args)
        .filter((args) => (args[0] === 'worktree' && args[1] === 'remove') || (args[0] === 'branch' && args[1] === '-D'));

      expect({
        outcome,
        statusCalls: run.mock.calls.filter(([args]) => args[0] === 'status'),
        destructiveCalls,
        worktreeRemains: await access(worktree).then(() => true, () => false),
        fileRemains: await readFile(join(worktree, file), 'utf-8').then(() => true, () => false),
        branchRemains: !deleted.includes(branch),
      }).toEqual({
        outcome: dirty
          ? { slug, steps: [], refusal: 'dirty-worktree' }
          : { slug, steps: ['worktree-removed', 'branch-deleted'] },
        statusCalls: [[['status', '--porcelain'], { cwd: worktree }]],
        destructiveCalls: dirty ? [] : [['worktree', 'remove', '--force', worktree], ['branch', '-D', branch]],
        worktreeRemains: true,
        fileRemains: true,
        branchRemains: dirty,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('refuses an injected in-flight feature before any reconciliation action', async () => {
    const slug = 'active-feature';
    const { run, events } = makeGit();

    const outcome = await reconcileMergedPark({
      projectRoot: '/project',
      slug,
      runGit: run,
      isFeatureInFlight: (candidate) => candidate === slug,
    });

    expect({ outcome, calls: run.mock.calls, events }).toEqual({
      outcome: { slug, steps: [], refusal: 'in-flight' },
      calls: [],
      events: [],
    });
  });

  it('refuses a live phase marker before teardown, removal, deletion, or unpark', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'marker-active';
    const { run, events } = makeGit();
    try {
      await mkdir(join(projectRoot, '.worktrees', slug, '.pipeline'), { recursive: true });
      await writeFile(join(projectRoot, '.worktrees', slug, '.pipeline', 'phase-active'), 'step: build\n');
      await writeOperatorPark(projectRoot, slug);

      const outcome = await reconcileMergedPark({ projectRoot, slug, runGit: run });

      expect({ outcome, calls: run.mock.calls, events, parked: await isOperatorParked(projectRoot, slug) }).toEqual({
        outcome: { slug, steps: [], refusal: 'in-flight' },
        calls: [],
        events: [],
        parked: true,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: 'the branch exists but is not contained in origin/main and no record landed',
      world: { branches: ['feat/unmerged'], merged: [] },
      slug: 'unmerged',
      refusal: 'no-merge-proof',
    },
    {
      name: 'no branch carries the slug and no record landed',
      world: {},
      slug: 'missing-branch',
      refusal: 'branch-missing',
    },
    {
      name: 'the base branch cannot be read at all',
      world: { shipped: 'unavailable' as const },
      slug: 'no-origin',
      refusal: 'ancestry-check-failed',
    },
    {
      name: 'the local ref listing fails',
      world: { refsUnavailable: true },
      slug: 'no-refs',
      refusal: 'ancestry-check-failed',
    },
    {
      name: 'the only ancestry probe blows up on a broken ref',
      world: { branches: ['feat/broken'], ancestryBroken: ['feat/broken'] },
      slug: 'broken',
      refusal: 'ancestry-check-failed',
    },
  ])('re-derives merge evidence and refuses when $name', async ({ world, slug, refusal }) => {
    const { run } = makeGit(world);

    const outcome = await reconcileMergedPark({ projectRoot: '/project', slug, runGit: run });

    expect({ outcome, destructive: run.mock.calls.filter(([args]) => args[0] === 'branch' || args[0] === 'worktree') }).toEqual({
      outcome: { slug, steps: [], refusal },
      destructive: [],
    });
  });

  it('accepts a shipped record whose stem carries the plan date prefix the park marker omits', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'first-class-codex-harness-parity-904';
    const { run, deleted } = makeGit({
      shipped: [`2026-07-25-${slug}`],
      branches: [`spec/${slug}`],
      merged: [`spec/${slug}`],
    });
    try {
      await writeOperatorPark(projectRoot, slug);

      const outcome = await reconcileMergedPark({ projectRoot, slug, runGit: run });

      expect({ outcome, deleted, parked: await isOperatorParked(projectRoot, slug) }).toEqual({
        outcome: { slug, steps: ['worktree-removed', 'branch-deleted', 'unparked'] },
        deleted: [`spec/${slug}`],
        parked: false,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('reconciles a record-backed park whose branch was deleted after the merge', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'branch-already-gone';
    const { run, deleted } = makeGit({ shipped: [slug], branches: [] });
    try {
      await writeOperatorPark(projectRoot, slug);

      const outcome = await reconcileMergedPark({ projectRoot, slug, runGit: run });

      expect({ outcome, deleted, parked: await isOperatorParked(projectRoot, slug) }).toEqual({
        outcome: { slug, steps: ['worktree-removed', 'branch-absent', 'unparked'] },
        deleted: [],
        parked: false,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('does not report a deletion proof when a shipped record reconciles a branchless worktree', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'branchless-no-proof';
    const { run } = makeGit({ shipped: [slug], branches: [] });
    try {
      const outcome = await reconcileMergedPark({ projectRoot, slug, runGit: run, emitProof: true });

      expect(outcome).toEqual({
        slug,
        steps: ['worktree-removed', 'branch-absent'],
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('refuses cleanup when a record-backed slug still has a branch outside origin/main', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'raced-after-record';
    const { run, deleted } = makeGit({
      shipped: [slug],
      branches: [`spec/${slug}`],
      merged: [],
    });
    // No merged PR reports this head, so nothing can prove the branch carries
    // only what landed — the lack of a merge proof must stand.
    const runGh = vi.fn<GhRunner>().mockResolvedValue({ stdout: '[]' });
    try {
      await writeOperatorPark(projectRoot, slug);

      const outcome = await reconcileMergedPark({ projectRoot, slug, runGit: run, runGh });

      expect({ outcome, deleted, parked: await isOperatorParked(projectRoot, slug) }).toEqual({
        outcome: { slug, steps: [], refusal: 'no-merge-proof' },
        deleted: [],
        parked: true,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: 'no merged PR proves the branch',
      gh: '[]',
      expectedOutcome: { steps: [], refusal: 'no-merge-proof' },
    },
    {
      name: 'the branch contains commits beyond the merged PR head',
      gh: '[{"headRefOid":"1111111111111111111111111111111111111111"}]',
      mergedPrHeads: ['1111111111111111111111111111111111111111'],
      tips: { 'feat/deletion-gate-map': '2222222222222222222222222222222222222222' },
      expectedOutcome: {
        steps: [],
        refusal: 'unmerged-commits',
        unmergedCommits: { commits: [], overflow: 0 },
      },
    },
    {
      name: 'the branch is behind the merged PR head',
      gh: '[{"headRefOid":"1111111111111111111111111111111111111111"}]',
      tips: { 'feat/deletion-gate-map': '2222222222222222222222222222222222222222' },
      expectedOutcome: { steps: [], refusal: 'branch-behind-merged-head' },
    },
    {
      name: 'the branch tip cannot be resolved locally',
      gh: '[{"headRefOid":"1111111111111111111111111111111111111111"}]',
      expectedOutcome: { steps: [], refusal: 'ancestry-check-failed' },
    },
    {
      name: 'the current tip equals the merged PR head',
      gh: '[{"headRefOid":"1111111111111111111111111111111111111111"}]',
      tips: { 'feat/deletion-gate-map': '1111111111111111111111111111111111111111' },
      expectedOutcome: { steps: ['worktree-removed', 'branch-deleted', 'unparked'] },
    },
  ] as const)('maps deletion-gate diagnosis when $name', async ({ gh, mergedPrHeads, tips, expectedOutcome }) => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'deletion-gate-map';
    const { run, deleted } = makeGit({
      shipped: [slug],
      branches: [`feat/${slug}`],
      mergedPrHeads,
      tips,
    });
    const runGh = vi.fn<GhRunner>().mockResolvedValue({ stdout: gh });
    try {
      await writeOperatorPark(projectRoot, slug);

      const outcome = await reconcileMergedPark({ projectRoot, slug, runGit: run, runGh });

      expect({ outcome, deleted, parked: await isOperatorParked(projectRoot, slug) }).toEqual({
        outcome: { slug, ...expectedOutcome },
        deleted: expectedOutcome.refusal === undefined ? [`feat/${slug}`] : [],
        parked: expectedOutcome.refusal !== undefined,
      });
      if (expectedOutcome.refusal !== 'unmerged-commits') {
        expect(outcome).not.toHaveProperty('unmergedCommits');
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('deletes a squash-merged branch whose tip matches the merged PR head oid', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'squash-merged';
    const tip = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
    const { run, deleted, deleteArgv } = makeGit({
      shipped: [slug],
      branches: [`fix/${slug}`],
      merged: [],
      tips: { [`fix/${slug}`]: tip },
    });
    const runGh = vi.fn<GhRunner>().mockResolvedValue({
      stdout: `[{"headRefOid":"${tip}"}]`,
    });
    try {
      await writeOperatorPark(projectRoot, slug);

      const outcome = await reconcileMergedPark({ projectRoot, slug, runGit: run, runGh });

      expect({
        outcome,
        deleted,
        deleteArgv,
        ghCalls: runGh.mock.calls,
        parked: await isOperatorParked(projectRoot, slug),
      }).toEqual({
        outcome: { slug, steps: ['worktree-removed', 'branch-deleted', 'unparked'] },
        deleted: [`fix/${slug}`],
        // Force delete: this function, not git, established that the tip is the
        // commit the squash merge landed, and `-d` refuses that ref forever.
        deleteArgv: [['branch', '-D', `fix/${slug}`]],
        ghCalls: [
          [
            ['pr', 'list', '--head', `fix/${slug}`, '--state', 'merged', '--json', 'headRefOid', '--limit', '1'],
            { cwd: projectRoot },
          ],
        ],
        parked: false,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('refuses a squash-merged branch that gained commits after the merge', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'post-merge-commit';
    const { run, deleted } = makeGit({
      shipped: [slug],
      branches: [`feat/${slug}`],
      merged: [],
      mergedPrHeads: ['1111111111111111111111111111111111111111'],
      tips: { [`feat/${slug}`]: 'ffffffffffffffffffffffffffffffffffffffff' },
    });
    const runGh = vi.fn<GhRunner>().mockResolvedValue({
      stdout: '[{"headRefOid":"1111111111111111111111111111111111111111"}]',
    });
    try {
      await writeOperatorPark(projectRoot, slug);

      const outcome = await reconcileMergedPark({ projectRoot, slug, runGit: run, runGh });

      expect({ outcome, deleted, parked: await isOperatorParked(projectRoot, slug) }).toEqual({
        outcome: {
          slug,
          steps: [],
          refusal: 'unmerged-commits',
          unmergedCommits: { commits: [], overflow: 0 },
        },
        deleted: [],
        parked: true,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('lists the post-merge commits in git range order', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'ordered-post-merge-commits';
    const headRefOid = '1111111111111111111111111111111111111111';
    const { run } = makeGit({
      shipped: [slug],
      branches: [`feat/${slug}`],
      mergedPrHeads: [headRefOid],
      tips: { [`feat/${slug}`]: 'ffffffffffffffffffffffffffffffffffffffff' },
      unmergedLog: ['bbbbbbb newer commit', 'aaaaaaa older commit'],
    });
    const runGh = vi.fn<GhRunner>().mockResolvedValue({ stdout: `[{'headRefOid':'${headRefOid}'}]`.replaceAll("'", '"') });
    try {
      await writeOperatorPark(projectRoot, slug);

      const outcome = await reconcileMergedPark({ projectRoot, slug, runGit: run, runGh });

      expect(outcome).toEqual({
        slug,
        steps: [],
        refusal: 'unmerged-commits',
        unmergedCommits: {
          commits: [
            { sha: 'bbbbbbb', subject: 'newer commit' },
            { sha: 'aaaaaaa', subject: 'older commit' },
          ],
          overflow: 0,
        },
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('fails closed without a commit list when the unmerged range cannot be read', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'unreadable-post-merge-range';
    const headRefOid = '1111111111111111111111111111111111111111';
    const { run } = makeGit({
      shipped: [slug],
      branches: [`feat/${slug}`],
      mergedPrHeads: [headRefOid],
      tips: { [`feat/${slug}`]: 'ffffffffffffffffffffffffffffffffffffffff' },
      unmergedLog: 'unavailable',
    });
    const runGh = vi.fn<GhRunner>().mockResolvedValue({ stdout: `[{'headRefOid':'${headRefOid}'}]`.replaceAll("'", '"') });
    try {
      await writeOperatorPark(projectRoot, slug);

      const outcome = await reconcileMergedPark({ projectRoot, slug, runGit: run, runGh });

      expect(outcome).toEqual({ slug, steps: [], refusal: 'ancestry-check-failed' });
      expect(outcome).not.toHaveProperty('unmergedCommits');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('attaches the capped commit summaries that a force-delete would drop', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'post-merge-commit-summaries';
    const headRefOid = '1111111111111111111111111111111111111111';
    const { run } = makeGit({
      shipped: [slug],
      branches: [`feat/${slug}`],
      mergedPrHeads: [headRefOid],
      tips: { [`feat/${slug}`]: 'ffffffffffffffffffffffffffffffffffffffff' },
      unmergedLog: [
        'aaaaaaa first commit',
        'bbbbbbb second commit',
        'ccccccc third commit',
        'ddddddd fourth commit',
        'eeeeeee fifth commit',
        'fffffff sixth commit',
        '1111111 seventh commit',
        '2222222 eighth commit',
        '3333333 ninth commit',
        '4444444 tenth commit',
        '5555555 eleventh commit',
      ],
    });
    const runGh = vi.fn<GhRunner>().mockResolvedValue({ stdout: `[{"headRefOid":"${headRefOid}"}]` });
    try {
      await writeOperatorPark(projectRoot, slug);

      const outcome = await reconcileMergedPark({ projectRoot, slug, runGit: run, runGh });

      expect(outcome).toEqual({
        slug,
        steps: [],
        refusal: 'unmerged-commits',
        unmergedCommits: {
          commits: [
            ['aaaaaaa', 'first commit'],
            ['bbbbbbb', 'second commit'],
            ['ccccccc', 'third commit'],
            ['ddddddd', 'fourth commit'],
            ['eeeeeee', 'fifth commit'],
            ['fffffff', 'sixth commit'],
            ['1111111', 'seventh commit'],
            ['2222222', 'eighth commit'],
            ['3333333', 'ninth commit'],
            ['4444444', 'tenth commit'],
          ].map(([sha, subject]) => ({ sha, subject })),
          overflow: 1,
        },
      });
      expect(run.mock.calls).toContainEqual([
        ['log', '--oneline', '--no-decorate', `${headRefOid}..feat/${slug}`],
        { cwd: projectRoot },
      ]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it.each([
    { name: 'the PR lookup itself is unavailable', gh: () => Promise.reject(new Error('gh unavailable')) },
    { name: 'the PR lookup returns unparsable output', gh: async () => ({ stdout: 'not json' }) },
  ])('reports an ancestry-check failure when $name', async ({ gh }) => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'offline-refusal';
    const { run, deleted } = makeGit({
      shipped: [slug],
      branches: [`feat/${slug}`],
      merged: [],
      tips: { [`feat/${slug}`]: 'abcabcabcabcabcabcabcabcabcabcabcabcabca' },
    });
    const runGh = vi.fn<GhRunner>().mockImplementation(gh);
    try {
      await writeOperatorPark(projectRoot, slug);

      const outcome = await reconcileMergedPark({ projectRoot, slug, runGit: run, runGh });

      expect({ outcome, deleted, parked: await isOperatorParked(projectRoot, slug) }).toEqual({
        outcome: { slug, steps: [], refusal: 'ancestry-check-failed' },
        deleted: [],
        parked: true,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('refuses when a squash-merge candidate branch tip cannot be resolved', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'unresolvable-tip';
    const { run, deleted } = makeGit({
      shipped: [slug],
      branches: [`feat/${slug}`],
      merged: [],
    });
    const runGh = vi.fn<GhRunner>().mockResolvedValue({
      stdout: '[{"headRefOid":"1111111111111111111111111111111111111111"}]',
    });
    try {
      await writeOperatorPark(projectRoot, slug);

      const outcome = await reconcileMergedPark({ projectRoot, slug, runGit: run, runGh });

      expect({ outcome, deleted, parked: await isOperatorParked(projectRoot, slug) }).toEqual({
        outcome: { slug, steps: [], refusal: 'ancestry-check-failed' },
        deleted: [],
        parked: true,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('reads shipped records from origin/main before continuing past the record gate', async () => {
    const { run } = makeGit({ shipped: ['recorded'], branches: ['feat/recorded'], merged: ['feat/recorded'] });
    const runGh = vi.fn<GhRunner>();

    const outcome = await reconcileMergedPark({
      projectRoot: '/project',
      slug: 'recorded',
      runGit: run,
      runGh,
    });

    expect({
      outcome,
      gitVerbs: run.mock.calls.map(([args]) => args.slice(0, 2).join(' ')),
      ghCalls: runGh.mock.calls,
    }).toEqual({
      outcome: { slug: 'recorded', steps: ['worktree-removed', 'branch-deleted'] },
      gitVerbs: [
        'ls-tree --name-only',
        'for-each-ref --format=%(refname:short)',
        'merge-base --is-ancestor',
        'branch -D',
      ],
      ghCalls: [],
    });
  });

  it('reclaims a proven feat/daemon branch when its shipped record is present', async () => {
    const slug = 'daemon-recorded';
    const branch = `feat/daemon-${slug}`;
    const { run, deleted } = makeGit({ shipped: [slug], branches: [branch], merged: [branch] });

    const outcome = await reconcileMergedPark({ projectRoot: '/project', slug, branch, runGit: run });

    expect({ outcome, deleted }).toEqual({
      outcome: { slug, steps: ['worktree-removed', 'branch-deleted'] },
      deleted: [branch],
    });
  });

  it.each([
    { slug: 'hotfix-without-record', branch: 'hotfix/x' },
    { slug: 'spec-without-record', branch: 'spec/spec-without-record' },
  ])('reclaims a proven non-daemon $branch branch without a shipped-record repair', async ({ slug, branch }) => {
    const { run, deleted } = makeGit({ branches: [branch], merged: [branch] });
    const requestRecordRepair = vi.fn(async () => {});

    const outcome = await reconcileMergedPark({
      projectRoot: '/project',
      slug,
      branch,
      runGit: run,
      requestRecordRepair,
    });

    expect({ outcome, deleted, repairs: requestRecordRepair.mock.calls }).toEqual({
      outcome: { slug, steps: ['worktree-removed', 'branch-deleted'] },
      deleted: [branch],
      repairs: [],
    });
  });

  it('defers a proven feat/daemon branch without a shipped record and requests repair', async () => {
    const slug = 'daemon-record-missing';
    const branch = `feat/daemon-${slug}`;
    const { run } = makeGit({ branches: [branch], merged: [branch] });
    const runGh = vi.fn<GhRunner>().mockResolvedValue({ stdout: '[{"url":"https://example.test/pr/3"}]' });
    const requestRecordRepair = vi.fn(async () => {});

    const outcome = await reconcileMergedPark({
      projectRoot: '/project',
      slug,
      branch,
      runGit: run,
      runGh,
      requestRecordRepair,
    });

    expect({ outcome, repairs: requestRecordRepair.mock.calls }).toEqual({
      outcome: { slug, steps: [], refusal: 'record-missing', deferred: true },
      repairs: [[{ slug, prUrl: 'https://example.test/pr/3' }]],
    });
  });

  it('refuses an unproven hotfix branch without a shipped record before the record rule', async () => {
    const slug = 'hotfix-no-proof';
    const branch = 'hotfix/x';
    const { run, deleted } = makeGit({ branches: [branch] });
    const runGh = vi.fn<GhRunner>().mockResolvedValue({ stdout: '[]' });

    const outcome = await reconcileMergedPark({ projectRoot: '/project', slug, branch, runGit: run, runGh });

    expect({ outcome, deleted }).toEqual({
      outcome: { slug, steps: [], refusal: 'no-merge-proof' },
      deleted: [],
    });
  });

  it('fails closed when the shipped-record listing is unreadable for a feat/daemon branch', async () => {
    const slug = 'daemon-unreadable-records';
    const branch = `feat/daemon-${slug}`;
    const { run } = makeGit({ shipped: 'unavailable', branches: [branch], merged: [branch] });

    const outcome = await reconcileMergedPark({ projectRoot: '/project', slug, branch, runGit: run });

    expect(outcome).toEqual({ slug, steps: [], refusal: 'ancestry-check-failed' });
  });

  it('reclaims a proven non-daemon branch without reading an unavailable shipped-record listing', async () => {
    const slug = 'hotfix-unreadable-records';
    const branch = `hotfix/${slug}`;
    const { run, deleted } = makeGit({ shipped: 'unavailable', branches: [branch], merged: [branch] });
    const requestRecordRepair = vi.fn(async () => {});

    const outcome = await reconcileMergedPark({
      projectRoot: '/project',
      slug,
      branch,
      runGit: run,
      requestRecordRepair,
    });

    expect({
      outcome,
      deleted,
      repairs: requestRecordRepair.mock.calls,
      recordReads: run.mock.calls.filter(([args]) => args[0] === 'ls-tree' || args[0] === 'rev-parse'),
    }).toEqual({
      outcome: { slug, steps: ['worktree-removed', 'branch-deleted'] },
      deleted: [branch],
      repairs: [],
      recordReads: [],
    });
  });

  it('treats an origin/main without a .docs/shipped tree as no records rather than unavailable', async () => {
    const { run } = makeGit({ shipped: 'no-tree', branches: ['feat/no-tree'], merged: ['feat/no-tree'] });
    const runGh = vi.fn<GhRunner>().mockResolvedValue({ stdout: '[]' });
    const log = vi.fn<(message: string) => void>();

    const outcome = await reconcileMergedPark({
      projectRoot: '/project',
      slug: 'no-tree',
      runGit: run,
      runGh,
      log,
    });

    expect({ outcome, logs: log.mock.calls }).toEqual({
      outcome: { slug: 'no-tree', steps: [], refusal: 'record-missing', deferred: true },
      logs: [['[parked-reconciliation] no-tree not reconcilable until the record lands']],
    });
  });

  it('defers a missing record to the ST-916 repair seam via the resolved branch name', async () => {
    const { run } = makeGit({ branches: ['spec/missing-record'], merged: ['spec/missing-record'] });
    const runGh = vi.fn<GhRunner>().mockResolvedValue({
      stdout: '[{"url":"https://example.test/pr/1060"}]',
    });
    const requestRecordRepair = vi.fn(async () => {});
    const log = vi.fn<(message: string) => void>();

    const outcome = await reconcileMergedPark({
      projectRoot: '/project',
      slug: 'missing-record',
      runGit: run,
      runGh,
      requestRecordRepair,
      log,
    });

    expect({ outcome, ghCalls: runGh.mock.calls, repairs: requestRecordRepair.mock.calls, logs: log.mock.calls }).toEqual({
      outcome: { slug: 'missing-record', steps: [], refusal: 'record-missing', deferred: true },
      ghCalls: [
        [
          ['pr', 'list', '--state', 'merged', '--head', 'spec/missing-record', '--json', 'url', '--limit', '1'],
          { cwd: '/project' },
        ],
      ],
      repairs: [[{ slug: 'missing-record', prUrl: 'https://example.test/pr/1060' }]],
      logs: [['[parked-reconciliation] missing-record not reconcilable until the record lands']],
    });
  });

  it('defers without repair when a missing record has no merged PR', async () => {
    const { run } = makeGit({ branches: ['feat/no-merged-pr'], merged: ['feat/no-merged-pr'] });
    const runGh = vi.fn<GhRunner>().mockResolvedValue({ stdout: '[]' });
    const requestRecordRepair = vi.fn(async () => {});
    const log = vi.fn<(message: string) => void>();

    const outcome = await reconcileMergedPark({
      projectRoot: '/project',
      slug: 'no-merged-pr',
      runGit: run,
      runGh,
      requestRecordRepair,
      log,
    });

    expect({ outcome, repairs: requestRecordRepair.mock.calls, logs: log.mock.calls }).toEqual({
      outcome: { slug: 'no-merged-pr', steps: [], refusal: 'record-missing', deferred: true },
      repairs: [],
      logs: [['[parked-reconciliation] no-merged-pr not reconcilable until the record lands']],
    });
  });

  it('reconciles a record-backed park whose local pipeline state still reads in-progress', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'stale-in-progress-state';
    const { run } = makeGit({ shipped: [slug] });
    const log = vi.fn<(message: string) => void>();
    try {
      await writeOperatorPark(projectRoot, slug);
      // Exactly the shape `detectAutoResume` classifies as resumable: no
      // `feature_status: complete`, a build left mid-flight. The shipped record
      // on origin/main is the stronger, durable proof and must win.
      const pipeline = join(projectRoot, '.worktrees', slug, '.pipeline');
      await mkdir(pipeline, { recursive: true });
      await writeFile(
        join(pipeline, 'conduct-state.json'),
        JSON.stringify({ feature_desc: slug, build: 'in_progress' }),
      );

      const outcome = await reconcileMergedPark({ projectRoot, slug, runGit: run, log });

      expect({ outcome, parked: await isOperatorParked(projectRoot, slug), logs: log.mock.calls }).toEqual({
        outcome: { slug, steps: ['worktree-removed', 'branch-absent', 'unparked'] },
        parked: false,
        // Only the canonical unpark's own report; no in-progress refusal line.
        logs: [[
          `Unparked '${slug}' and reset no-evidence counter — normal dispatch and re-kick resume.`,
        ]],
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('falls back to plain directory removal for a leftover path git never registered', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'unregistered-leftover';
    const worktree = join(projectRoot, '.worktrees', slug);
    const observation = join(projectRoot, 'fallback-teardown-runs');
    const { run, deleted } = makeGit({
      shipped: [slug],
      branches: [`feat/${slug}`],
      merged: [`feat/${slug}`],
      worktreeRemoveFails: `fatal: '${worktree}' is not a working tree`,
      registeredWorktrees: [projectRoot],
      onWorktreeRemove: async () => {
        expect(await access(observation).then(() => true, () => false)).toBe(true);
      },
    });
    try {
      await mkdir(worktree, { recursive: true });
      await writeFile(join(worktree, 'leftover.txt'), 'not a git worktree');
      const teardown = join(worktree, TEARDOWN_SCRIPT);
      await mkdir(join(worktree, 'bin'), { recursive: true });
      await writeFile(join(worktree, 'package.json'), '{"type":"commonjs"}\n', 'utf-8');
      await writeFile(teardown, `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(${JSON.stringify(observation)}, 'ran\\n');\n`);
      await chmod(teardown, 0o755);
      await writeOperatorPark(projectRoot, slug);

      const outcome = await reconcileMergedPark({ projectRoot, slug, runGit: run });

      expect({
        outcome,
        deleted,
        stillOnDisk: await access(worktree).then(() => true, () => false),
        teardownRuns: await access(observation).then(async () => (await readFile(observation, 'utf-8')).trim().split('\n'), () => []),
        parked: await isOperatorParked(projectRoot, slug),
      }).toEqual({
        outcome: { slug, steps: ['worktree-removed', 'branch-deleted', 'unparked'] },
        deleted: [`feat/${slug}`],
        stillOnDisk: false,
        teardownRuns: ['ran'],
        parked: false,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('runs a registered worktree teardown exactly once before reporting removal', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'teardown-before-removal';
    const worktree = join(projectRoot, '.worktrees', slug);
    const observation = join(projectRoot, 'teardown-ran');
    const { run } = makeGit({
      shipped: [slug],
      branches: [`feat/${slug}`],
      merged: [`feat/${slug}`],
      registeredWorktrees: [projectRoot, worktree],
      onWorktreeRemove: async () => {
        await access(observation);
      },
    });
    try {
      const teardown = join(worktree, TEARDOWN_SCRIPT);
      await mkdir(join(worktree, 'bin'), { recursive: true });
      await writeFile(join(worktree, 'package.json'), '{"type":"commonjs"}\n', 'utf-8');
      await writeFile(teardown, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(observation)}, 'ran');\n`);
      await chmod(teardown, 0o755);
      await writeOperatorPark(projectRoot, slug);

      const outcome = await reconcileMergedPark({ projectRoot, slug, runGit: run });

      expect({
        outcome,
        teardownRuns: await access(observation).then(() => 1, () => 0),
      }).toEqual({
        outcome: { slug, steps: ['worktree-removed', 'branch-deleted', 'unparked'] },
        teardownRuns: 1,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('forwards verbose reconciliation to successful project teardown output', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'verbose-teardown-output';
    const worktree = join(projectRoot, '.worktrees', slug);
    const { run } = makeGit({
      shipped: [slug],
      branches: [`feat/${slug}`],
      merged: [`feat/${slug}`],
      registeredWorktrees: [projectRoot, worktree],
    });
    const log = vi.fn<(message: string) => void>();
    try {
      const teardown = join(worktree, TEARDOWN_SCRIPT);
      await mkdir(join(worktree, 'bin'), { recursive: true });
      await writeFile(teardown, '#!/usr/bin/env bash\necho cache-purge-complete\n');
      await chmod(teardown, 0o755);
      await writeOperatorPark(projectRoot, slug);

      await reconcileMergedPark({
        projectRoot,
        slug,
        runGit: run,
        log,
        verbose: true,
      } as Parameters<typeof reconcileMergedPark>[0]);

      expect(log.mock.calls).toContainEqual(['teardown: cache-purge-complete']);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: 'the path is a registered worktree git refused to remove',
      registeredWorktrees: undefined as string[] | undefined,
      worktreeListUnavailable: false,
    },
    {
      name: 'the worktree registration itself cannot be read',
      registeredWorktrees: [] as string[] | undefined,
      worktreeListUnavailable: true,
    },
  ])('refuses worktree removal when $name', async ({ registeredWorktrees, worktreeListUnavailable }) => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'registered-remove-fails';
    const worktree = join(projectRoot, '.worktrees', slug);
    const { run } = makeGit({
      shipped: [slug],
      branches: [`feat/${slug}`],
      merged: [`feat/${slug}`],
      worktreeRemoveFails: 'fatal: cannot remove a locked working tree',
      registeredWorktrees: registeredWorktrees ?? [projectRoot, worktree],
      worktreeListUnavailable,
    });
    try {
      await mkdir(worktree, { recursive: true });
      await writeOperatorPark(projectRoot, slug);

      const outcome = await reconcileMergedPark({ projectRoot, slug, runGit: run });

      expect({
        outcome,
        stillOnDisk: await access(worktree).then(() => true, () => false),
        parked: await isOperatorParked(projectRoot, slug),
      }).toEqual({
        outcome: { slug, steps: [], refusal: 'worktree-remove-failed' },
        stillOnDisk: true,
        parked: true,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('allows a quiescent worktree pipeline to reach ordered cleanup', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'quiescent-run';
    const { run } = makeGit({ shipped: [slug], branches: [`feat/${slug}`], merged: [`feat/${slug}`] });
    try {
      const pipeline = join(projectRoot, '.worktrees', slug, '.pipeline');
      await mkdir(pipeline, { recursive: true });
      await writeFile(join(pipeline, 'conduct-state.json'), JSON.stringify({ feature_status: 'complete' }));

      const outcome = await reconcileMergedPark({ projectRoot, slug, runGit: run });

      expect(outcome).toEqual({ slug, steps: ['worktree-removed', 'branch-deleted'] });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('reclaims an eligible non-parked worktree after project teardown without dispatching unpark', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'non-parked-reclaim';
    const worktree = join(projectRoot, '.worktrees', slug);
    const teardownObservation = join(projectRoot, 'teardown-ran');
    const { run, deleted } = makeGit({
      shipped: [slug],
      branches: [`feat/${slug}`],
      merged: [`feat/${slug}`],
      onWorktreeRemove: async () => {
        expect(await access(teardownObservation).then(() => true, () => false)).toBe(true);
      },
    });
    const log = vi.fn<(message: string) => void>();
    const dispatch = vi.spyOn(daemonParkCli, 'dispatchDaemonPark');
    try {
      await mkdir(join(worktree, 'bin'), { recursive: true });
      await writeFile(join(worktree, 'package.json'), '{"type":"commonjs"}\n', 'utf-8');
      await writeFile(
        join(worktree, TEARDOWN_SCRIPT),
        `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(teardownObservation)}, 'ran');\n`,
      );
      await chmod(join(worktree, TEARDOWN_SCRIPT), 0o755);

      const outcome = await reconcileMergedPark({ projectRoot, slug, runGit: run, log });

      expect({
        outcome,
        deleted,
        parked: await isOperatorParked(projectRoot, slug),
        dispatches: dispatch.mock.calls,
        unparkLogs: log.mock.calls.filter(([message]) => message.includes('was not operator-parked')),
      }).toEqual({
        outcome: { slug, steps: ['worktree-removed', 'branch-deleted'] },
        deleted: [`feat/${slug}`],
        parked: false,
        dispatches: [],
        unparkLogs: [],
      });
    } finally {
      dispatch.mockRestore();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('disposes the HALT watcher, removes the worktree and branch, then unparks last', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'ordered-cleanup';
    const worktree = join(projectRoot, '.worktrees', slug);
    const { run, events } = makeGit({ shipped: [slug], branches: [`feat/${slug}`], merged: [`feat/${slug}`] });
    try {
      await mkdir(worktree, { recursive: true });
      await writeOperatorPark(projectRoot, slug);

      const outcome = await reconcileMergedPark({
        projectRoot,
        slug,
        runGit: run,
        disposeHaltWatcher: () => events.push('watcher-disposed'),
      });

      expect({ outcome, events, parked: await isOperatorParked(projectRoot, slug) }).toEqual({
        outcome: { slug, steps: ['worktree-removed', 'branch-deleted', 'unparked'] },
        events: ['watcher-disposed', 'worktree-removed', 'branch-deleted'],
        parked: false,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('treats a missing worktree as removed and uses unpark fallback after deleting the branch', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'missing-worktree';
    const { run, deleted } = makeGit({ shipped: [slug], branches: [`fix/${slug}`], merged: [`fix/${slug}`] });
    try {
      await writeOperatorPark(projectRoot, slug);

      const outcome = await reconcileMergedPark({ projectRoot, slug, runGit: run });

      expect({
        outcome,
        deleted,
        parked: await isOperatorParked(projectRoot, slug),
      }).toEqual({
        outcome: { slug, steps: ['worktree-removed', 'branch-deleted', 'unparked'] },
        deleted: [`fix/${slug}`],
        parked: false,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('preserves worktree-remove-failed when contained teardown and git removal both fail', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'failing-teardown-and-removal';
    const worktree = join(projectRoot, '.worktrees', slug);
    const { run } = makeGit({
      shipped: [slug],
      branches: [`feat/${slug}`],
      merged: [`feat/${slug}`],
      worktreeRemoveFails: 'fatal: cannot remove a locked working tree',
      registeredWorktrees: [projectRoot, worktree],
    });
    const log = vi.fn<(message: string) => void>();
    try {
      const teardown = join(worktree, TEARDOWN_SCRIPT);
      await mkdir(join(worktree, 'bin'), { recursive: true });
      await writeFile(teardown, '#!/usr/bin/env bash\necho teardown failed\nexit 1\n');
      await chmod(teardown, 0o755);
      await writeOperatorPark(projectRoot, slug);

      const outcome = await reconcileMergedPark({ projectRoot, slug, runGit: run, log });

      expect(outcome).toEqual({ slug, steps: [], refusal: 'worktree-remove-failed' });
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]?.[0]).toContain(`teardown: failed in ${worktree}`);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('keeps the park marker when branch deletion fails after worktree removal', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'branch-delete-fails';
    const worktree = join(projectRoot, '.worktrees', slug);
    const { run } = makeGit({
      shipped: [slug],
      branches: [`feat/${slug}`],
      merged: [`feat/${slug}`],
      branchDeleteFails: true,
    });
    try {
      await mkdir(worktree, { recursive: true });
      await writeOperatorPark(projectRoot, slug);

      const outcome = await reconcileMergedPark({ projectRoot, slug, runGit: run });

      expect({ outcome, parked: await isOperatorParked(projectRoot, slug) }).toEqual({
        outcome: { slug, steps: ['worktree-removed'], refusal: 'branch-delete-failed' },
        parked: true,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('keeps the park marker when canonical unpark fails its counter reset', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'counter-reset-fails';
    const worktree = join(projectRoot, '.worktrees', slug);
    const { run } = makeGit({ shipped: [slug], branches: [`feat/${slug}`], merged: [`feat/${slug}`] });
    try {
      await mkdir(worktree, { recursive: true });
      await writeFile(join(worktree, '.pipeline'), 'not a directory');
      await writeOperatorPark(projectRoot, slug);

      const outcome = await reconcileMergedPark({ projectRoot, slug, runGit: run });

      expect({ outcome, parked: await isOperatorParked(projectRoot, slug) }).toEqual({
        outcome: {
          slug,
          steps: ['worktree-removed', 'branch-deleted'],
          refusal: 'unpark-failed',
        },
        parked: true,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

describe('engine/park-reconciliation — reconcileParkedFeatures', () => {
  it('retains one detached registered worktree without invoking destructive reconciliation', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'detached';
    const { run, deleted } = makeGit();
    const events: unknown[] = [];
    const log = vi.fn<(message: string) => void>();
    try {
      const result = await reconcileParkedFeatures({
        projectRoot,
        runGit: run,
        log,
        onEvent: (event) => events.push(event),
        worktreeListing: async () => [{ slug, reclaimable: false }],
      });

      expect({
        entries: result.entries,
        events,
        deleted,
        destructive: run.mock.calls.filter(([args]) =>
          args[0] === 'branch' || (args[0] === 'worktree' && args[1] === 'remove')),
        summary: log.mock.calls[0]?.[0],
      }).toEqual({
        entries: [{ slug, classification: 'unclassified', annotation: undefined }],
        events: [{ type: 'worktree_reclaim_retained', slug, branch: undefined, reason: 'detached' }],
        deleted: [],
        destructive: [],
        summary: expect.stringContaining('candidates=1 retained=1'),
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('unions parked and registered candidates once, carries their listed branches, and reports enumeration without a watch registry', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const { run, deleted } = makeGit({
      branches: ['hotfix/first', 'spec/second', 'fix/third'],
      merged: ['hotfix/first', 'spec/second', 'fix/third'],
    });
    const log = vi.fn<(message: string) => void>();
    const worktreeListing = vi.fn(async () => [
      { slug: 'first', branch: 'hotfix/first' },
      { slug: 'second', branch: 'spec/second' },
      { slug: 'third', branch: 'fix/third' },
    ]);
    try {
      const result = await reconcileParkedFeatures({ projectRoot, runGit: run, log, worktreeListing });

      expect({
        entries: result.entries.map(({ slug }) => slug).sort(),
        deleted: deleted.sort(),
        listingCalls: worktreeListing.mock.calls.length,
        logs: log.mock.calls,
      }).toEqual({
        entries: ['first', 'second', 'third'],
        deleted: ['fix/third', 'hotfix/first', 'spec/second'],
        listingCalls: 1,
        logs: [[
          expect.stringContaining('candidates=3 retained=0'),
        ]],
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('deduplicates a parked slug against the registered listing while retaining excluded candidates before cleanup', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const halted = 'halted';
    const markerReadError = 'marker-read-error';
    const { run, deleted } = makeGit({
      shipped: ['bad_slug', 'engineer-run', 'halted', 'in-flight', 'parked-only', 'resolve-run'],
      branches: [
        'hotfix/parked-only',
        'hotfix/shared',
        'hotfix/in-flight',
        'hotfix/engineer-run',
        'hotfix/resolve-run',
        'hotfix/bad_slug',
        'hotfix/halted',
        'hotfix/marker-read-error',
      ],
      merged: [
        'hotfix/parked-only',
        'hotfix/shared',
        'hotfix/in-flight',
        'hotfix/engineer-run',
        'hotfix/resolve-run',
        'hotfix/bad_slug',
        'hotfix/halted',
        'hotfix/marker-read-error',
      ],
    });
    const log = vi.fn<(message: string) => void>();
    try {
      await writeOperatorPark(projectRoot, 'parked-only');
      await writeOperatorPark(projectRoot, 'shared');
      await writeOperatorPark(projectRoot, 'in-flight');
      await writeOperatorPark(projectRoot, halted);
      await writeOperatorPark(projectRoot, 'engineer-run');
      await writeOperatorPark(projectRoot, 'resolve-run');
      await writeOperatorPark(projectRoot, 'bad_slug');
      await mkdir(join(projectRoot, '.worktrees', halted, '.pipeline'), { recursive: true });
      await writeFile(join(projectRoot, '.worktrees', halted, '.pipeline', 'HALT'), 'halted\n');
      // A directory at the marker path makes the marker read fail with EISDIR.
      // It exercises the same fail-closed path as EACCES without depending on
      // the test process's effective uid.
      await mkdir(join(projectRoot, '.daemon', 'parked', markerReadError), { recursive: true });

      const result = await reconcileParkedFeatures({
        projectRoot,
        runGit: run,
        log,
        isFeatureInFlight: (slug) => slug === 'in-flight',
        worktreeListing: async () => [
          { slug: 'shared', branch: 'hotfix/shared' },
          { slug: 'in-flight', branch: 'hotfix/in-flight' },
          { slug: 'engineer-run', branch: 'hotfix/engineer-run' },
          { slug: 'resolve-run', branch: 'hotfix/resolve-run' },
          { slug: 'bad_slug', branch: 'hotfix/bad_slug' },
          { slug: halted, branch: 'hotfix/halted' },
          { slug: markerReadError, branch: 'hotfix/marker-read-error' },
        ],
      });

      expect({
        entries: result.entries.map(({ slug }) => slug).sort(),
        deleted: deleted.sort(),
        branchDeletes: run.mock.calls.filter(([args]) => args[0] === 'branch').map(([args]) => args[2]),
        log: log.mock.calls[0]?.[0],
      }).toEqual({
        entries: ['bad_slug', 'engineer-run', 'halted', 'in-flight', 'marker-read-error', 'parked-only', 'resolve-run', 'shared'],
        // A listed ref remains authoritative even if its slug is operator
        // parked, so `shared` takes the non-daemon record policy.
        deleted: ['hotfix/parked-only', 'hotfix/shared'],
        branchDeletes: ['hotfix/parked-only', 'hotfix/shared'],
        log: expect.stringContaining('retained: foreign-lifecycle=2,halted=2,in-flight=1,invalid-slug=1'),
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('logs a gh capability diagnostic during the quiet automatic sweep and refuses with no-merge-proof', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'sweep-gh-capability';
    const branch = `feat/${slug}`;
    const { run, deleted } = makeGit({ shipped: [slug], branches: [branch] });
    const runGh = vi.fn<GhRunner>().mockRejectedValue(
      new GhCapabilityError('headRefOid', new Error('unsupported')),
    );
    const log = vi.fn<(message: string) => void>();
    try {
      await writeOperatorPark(projectRoot, slug);

      const result = await reconcileParkedFeatures({ projectRoot, runGit: run, runGh, log });

      expect({
        counts: result.counts,
        refusedByReason: result.refusedByReason,
        deleted,
        capabilityLog: log.mock.calls.map(([message]) => message)
          .filter((message) => message.includes('gh capability unavailable')),
      }).toEqual({
        counts: { reconciled: 0, deferred: 0, orphaned: 0, parked: 1, refused: 1, skipped: 0 },
        refusedByReason: { 'no-merge-proof': 1 },
        deleted: [],
        capabilityLog: [`[parked-reconciliation] ${slug}: gh capability unavailable for headRefOid`],
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('counts an open-intake automatic park and preserves machine versus operator provenance', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const autoSlug = 'auto-parked';
    const operatorSlug = 'operator-parked';
    const { run } = makeGit({ branches: [`feat/${autoSlug}`, `feat/${operatorSlug}`] });
    try {
      await writeAutoPark(projectRoot, autoSlug, 'terminal daemon failure');
      await writeOperatorPark(projectRoot, operatorSlug);
      await mkdir(join(projectRoot, '.docs', 'intake'), { recursive: true });
      for (const slug of [autoSlug, operatorSlug]) {
        await writeFile(join(projectRoot, '.docs', 'intake', `${slug}.md`), 'Source-Ref: acme/app#42\n');
      }

      const result = await reconcileParkedFeatures({
        projectRoot,
        runGit: run,
        getIssueState: async () => 'OPEN',
        autoCleanup: false,
      });

      expect({
        counts: result.counts,
        entries: result.entries.sort((left, right) => left.slug.localeCompare(right.slug)),
        provenance: await Promise.all([autoSlug, operatorSlug].map((slug) => getProvenanceType(projectRoot, slug))),
      }).toEqual({
        counts: { reconciled: 0, deferred: 0, orphaned: 0, parked: 2, refused: 0, skipped: 0 },
        entries: [
          { slug: autoSlug, classification: 'normal', annotation: undefined },
          { slug: operatorSlug, classification: 'normal', annotation: undefined },
        ],
        provenance: ['auto', 'operator'],
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('forwards its logger to verbose successful teardown output during cleanup', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'sweep-verbose-teardown-output';
    const worktree = join(projectRoot, '.worktrees', slug);
    const { run } = makeGit({
      shipped: [slug],
      branches: [`feat/${slug}`],
      merged: [`feat/${slug}`],
      registeredWorktrees: [projectRoot, worktree],
    });
    const log = vi.fn<(message: string) => void>();
    try {
      const teardown = join(worktree, TEARDOWN_SCRIPT);
      await mkdir(join(worktree, 'bin'), { recursive: true });
      await writeFile(teardown, '#!/usr/bin/env bash\necho sweep-cache-purge-complete\n');
      await chmod(teardown, 0o755);
      await writeOperatorPark(projectRoot, slug);

      await reconcileParkedFeatures({ projectRoot, runGit: run, log, verbose: true });

      expect(log.mock.calls).toContainEqual(['teardown: sweep-cache-purge-complete']);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('reports a failing teardown during a non-verbose automatic cleanup and still reconciles the feature', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'sweep-quiet-failing-teardown';
    const worktree = join(projectRoot, '.worktrees', slug);
    const { run } = makeGit({
      shipped: [slug],
      branches: [`feat/${slug}`],
      merged: [`feat/${slug}`],
      registeredWorktrees: [projectRoot, worktree],
    });
    const log = vi.fn<(message: string) => void>();
    try {
      const teardown = join(worktree, TEARDOWN_SCRIPT);
      await mkdir(join(worktree, 'bin'), { recursive: true });
      await writeFile(teardown, '#!/usr/bin/env bash\necho quiet-sweep-teardown-failure\nexit 1\n');
      await chmod(teardown, 0o755);
      await writeOperatorPark(projectRoot, slug);

      const result = await reconcileParkedFeatures({ projectRoot, runGit: run, log, autoCleanup: true, verbose: false });
      const teardownFailures = log.mock.calls
        .map(([message]) => message)
        .filter((message) => message.startsWith(`teardown: failed in ${worktree}`));

      expect({ teardownFailures, reconciled: result.counts.reconciled }).toEqual({
        teardownFailures: [expect.stringContaining('quiet-sweep-teardown-failure')],
        reconciled: 1,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('does not add per-slug output for a verbose cleanup with no teardown script', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'sweep-verbose-no-teardown';
    const worktree = join(projectRoot, '.worktrees', slug);
    const { run } = makeGit({
      shipped: [slug],
      branches: [`feat/${slug}`],
      merged: [`feat/${slug}`],
      registeredWorktrees: [projectRoot, worktree],
    });
    const log = vi.fn<(message: string) => void>();
    try {
      await mkdir(worktree, { recursive: true });
      await writeOperatorPark(projectRoot, slug);

      await reconcileParkedFeatures({ projectRoot, runGit: run, log, verbose: true });

      expect(log.mock.calls).toEqual([[
        '[parked-reconciliation] reconciled=1 deferred=0 orphaned=0 parked=1 refused=0 skipped=0; next: no action required',
      ]]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      slug: 'merged-by-record',
      world: { shipped: ['merged-by-record'] },
      intake: undefined,
      issue: undefined,
      classification: 'merged',
    },
    {
      slug: 'merged-by-non-feature-branch',
      world: {
        branches: ['spec/merged-by-non-feature-branch'],
        merged: ['spec/merged-by-non-feature-branch'],
      },
      intake: undefined,
      issue: undefined,
      classification: 'merged',
    },
    {
      slug: 'orphan',
      world: { branches: ['feat/orphan'] },
      intake: 'Source-Ref: acme/app#42\n',
      issue: 'CLOSED',
      classification: 'orphan',
    },
    {
      slug: 'normal',
      world: { branches: ['feat/normal'] },
      intake: 'Source-Ref: acme/app#42\n',
      issue: 'OPEN',
      classification: 'normal',
    },
    { slug: 'no-intake', world: {}, intake: undefined, issue: undefined, classification: 'unclassified' },
    {
      slug: 'bad-intake',
      world: {},
      intake: 'Source-Ref: not-a-ref\n',
      issue: undefined,
      classification: 'unclassified',
    },
  ] as const)('classifies $slug without cleanup actions', async ({ slug, world, intake, issue, classification }) => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const { run } = makeGit(world);
    const getIssueState = vi.fn(async () => issue ?? 'OPEN');
    try {
      await writeOperatorPark(projectRoot, slug);
      if (intake) {
        const intakeDir = join(projectRoot, '.docs', 'intake');
        await mkdir(intakeDir, { recursive: true });
        await writeFile(join(intakeDir, `${slug}.md`), intake);
      }

      const events: unknown[] = [];
      const result = await reconcileParkedFeatures({
        projectRoot,
        runGit: run,
        getIssueState,
        autoCleanup: false,
        onEvent: (event) => events.push(event),
      });

      expect({
        entries: result.entries,
        destructive: run.mock.calls.filter(([args]) =>
          args[0] === 'branch' || (args[0] === 'worktree' && args[1] === 'remove')),
        events,
      }).toEqual({
        entries: [{
          slug,
          classification,
          annotation:
            classification === 'orphan' ? 'orphan' : classification === 'merged' ? 'merged-ready' : undefined,
        }],
        destructive: [],
        events: [{
          type: 'worktree_reclaim_retained',
          slug,
          branch: undefined,
          reason: classification === 'merged' ? 'disabled' : 'no-merge-proof',
        }],
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('reads the record tree and ref listing once per pass rather than once per parked slug', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const { run } = makeGit({ shipped: ['alpha', 'beta', 'gamma'] });
    try {
      for (const slug of ['alpha', 'beta', 'gamma']) await writeOperatorPark(projectRoot, slug);

      await reconcileParkedFeatures({ projectRoot, runGit: run, autoCleanup: false });

      const verbs = run.mock.calls.map(([args]) => args[0]);
      expect({
        lsTree: verbs.filter((v) => v === 'ls-tree').length,
        forEachRef: verbs.filter((v) => v === 'for-each-ref').length,
      }).toEqual({ lsTree: 1, forEachRef: 1 });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('summarizes refusal reasons and names the dominant cause in guidance', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'sweep-refused';
    const mergedPrHead = '1111111111111111111111111111111111111111';
    const { run } = makeGit({
      shipped: [slug],
      branches: [`feat/${slug}`],
      mergedPrHeads: [mergedPrHead],
      tips: { [`feat/${slug}`]: '2222222222222222222222222222222222222222' },
    });
    const runGh = vi.fn<GhRunner>().mockResolvedValue({ stdout: `[{'headRefOid':'${mergedPrHead}'}]`.replaceAll("'", '"') });
    const log = vi.fn<(message: string) => void>();
    try {
      await writeOperatorPark(projectRoot, slug);

      const result = await reconcileParkedFeatures({ projectRoot, runGit: run, runGh, log });

      expect({ counts: result.counts, refusedByReason: result.refusedByReason, logs: log.mock.calls }).toEqual({
        counts: {
          reconciled: 0,
          deferred: 0,
          orphaned: 0,
          parked: 1,
          refused: 1,
          skipped: 0,
        },
        refusedByReason: { 'unmerged-commits': 1 },
        logs: [[
          '[parked-reconciliation] reconciled=0 deferred=0 orphaned=0 parked=1 refused=1 skipped=0; refusals: unmerged-commits=1; next: 1 refusal requires resolving unmerged-commits; 1 parked remains parked',
        ]],
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('counts three merged cleanup refusals by reason while keeping all three slugs parked', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slugs = ['behind', 'no-proof', 'unmerged'] as const;
    const unmergedHead = '1111111111111111111111111111111111111111';
    const behindHead = '2222222222222222222222222222222222222222';
    const { run } = makeGit({
      shipped: slugs,
      branches: slugs.map((slug) => `feat/${slug}`),
      mergedPrHeads: [unmergedHead],
      tips: Object.fromEntries(slugs.map((slug) => [
        `feat/${slug}`,
        'ffffffffffffffffffffffffffffffffffffffff',
      ])),
      unmergedLog: ['aaaaaaa local commit after merged head'],
    });
    const runGh = vi.fn<GhRunner>(async (args) => {
      const ref = args[args.indexOf('--head') + 1];
      if (ref === 'feat/no-proof') return { stdout: '[]' };
      const headRefOid = ref === 'feat/behind' ? behindHead : unmergedHead;
      return { stdout: JSON.stringify([{ headRefOid }]) };
    });
    const log = vi.fn<(message: string) => void>();
    try {
      for (const slug of slugs) await writeOperatorPark(projectRoot, slug);

      const result = await reconcileParkedFeatures({ projectRoot, runGit: run, runGh, log });

      expect({
        counts: result.counts,
        refusedByReason: result.refusedByReason,
        parked: await Promise.all(slugs.map((slug) => isOperatorParked(projectRoot, slug))),
        logs: log.mock.calls,
      }).toEqual({
        counts: {
          reconciled: 0,
          deferred: 0,
          orphaned: 0,
          parked: 3,
          refused: 3,
          skipped: 0,
        },
        refusedByReason: {
          'branch-behind-merged-head': 1,
          'no-merge-proof': 1,
          'unmerged-commits': 1,
        },
        parked: [true, true, true],
        logs: [[
          '[parked-reconciliation] reconciled=0 deferred=0 orphaned=0 parked=3 refused=3 skipped=0; refusals: branch-behind-merged-head=1, no-merge-proof=1, unmerged-commits=1; next: 3 refusals requires resolving branch-behind-merged-head; 3 parked remain parked',
        ]],
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('omits refusal-breakdown noise when a sweep has no refusals', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'merged-ready';
    const { run } = makeGit({ shipped: [slug] });
    const log = vi.fn<(message: string) => void>();
    try {
      await writeOperatorPark(projectRoot, slug);

      const result = await reconcileParkedFeatures({ projectRoot, runGit: run, autoCleanup: false, log });

      expect({ counts: result.counts, refusedByReason: result.refusedByReason, logs: log.mock.calls }).toEqual({
        counts: {
          reconciled: 0,
          deferred: 0,
          orphaned: 0,
          parked: 1,
          refused: 0,
          skipped: 0,
        },
        refusedByReason: {},
        logs: [[
          '[parked-reconciliation] reconciled=0 deferred=0 orphaned=0 parked=1 refused=0 skipped=0; next: 1 parked remains parked',
        ]],
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('leaves an ordinary unmerged park with its own registered worktree out of the refusal tally', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'ordinary-registered-park';
    const branch = `feat/daemon-${slug}`;
    const { run, deleted } = makeGit({ branches: [branch] });
    const runGh = vi.fn<GhRunner>().mockResolvedValue({ stdout: '[]' });
    const log = vi.fn<(message: string) => void>();
    try {
      await writeOperatorPark(projectRoot, slug);
      await mkdir(join(projectRoot, '.docs', 'intake'), { recursive: true });
      await writeFile(join(projectRoot, '.docs', 'intake', `${slug}.md`), 'Source-Ref: acme/app#42\n');

      const result = await reconcileParkedFeatures({
        projectRoot,
        runGit: run,
        runGh,
        log,
        getIssueState: async () => 'OPEN',
        worktreeListing: async () => [{ slug, branch }],
      });

      expect({ counts: result.counts, refusedByReason: result.refusedByReason, deleted }).toEqual({
        counts: {
          reconciled: 0,
          deferred: 0,
          orphaned: 0,
          parked: 1,
          refused: 0,
          skipped: 0,
        },
        refusedByReason: {},
        deleted: [],
      });
      expect(log.mock.calls[0]?.[0]).toContain('refused=0');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('keeps a record-missing outcome deferred rather than refused', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'sweep-record-missing';
    const { run } = makeGit({ branches: [`feat/${slug}`], merged: [`feat/${slug}`] });
    const runGh = vi.fn<GhRunner>().mockResolvedValue({ stdout: '[]' });
    try {
      await writeOperatorPark(projectRoot, slug);

      const result = await reconcileParkedFeatures({ projectRoot, runGit: run, runGh });

      expect({ counts: result.counts, refusedByReason: result.refusedByReason }).toEqual({
        counts: {
          reconciled: 0,
          deferred: 1,
          orphaned: 0,
          parked: 1,
          refused: 0,
          skipped: 0,
        },
        refusedByReason: {},
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('keeps an auto-parked no-own-commit branch, worktree, and marker when its shipped record is missing', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'auto-no-own-commits';
    const worktree = join(projectRoot, '.worktrees', slug);
    const branch = `feat/${slug}`;
    const { run, deleted } = makeGit({ branches: [branch], merged: [branch] });
    const runGh = vi.fn<GhRunner>().mockResolvedValue({ stdout: '[]' });
    try {
      await mkdir(worktree, { recursive: true });
      await writeAutoPark(projectRoot, slug, 'terminal daemon failure');

      const result = await reconcileParkedFeatures({ projectRoot, runGit: run, runGh });

      expect({
        entries: result.entries,
        counts: result.counts,
        refusedByReason: result.refusedByReason,
        markerRemains: await isOperatorParked(projectRoot, slug),
        worktreeRemains: await access(worktree).then(() => true, () => false),
        deleted,
      }).toEqual({
        entries: [{ slug, classification: 'merged', annotation: undefined }],
        counts: { reconciled: 0, deferred: 1, orphaned: 0, parked: 1, refused: 0, skipped: 0 },
        refusedByReason: {},
        markerRemains: true,
        worktreeRemains: true,
        deleted: [],
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('classifies an auto-park whose intake issue closed as orphan without removing its marker', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'auto-closed-intake';
    const { run } = makeGit({ branches: [`feat/${slug}`] });
    try {
      await writeAutoPark(projectRoot, slug, 'terminal daemon failure');
      await mkdir(join(projectRoot, '.docs', 'intake'), { recursive: true });
      await writeFile(join(projectRoot, '.docs', 'intake', `${slug}.md`), 'Source-Ref: acme/app#42\n');

      const result = await reconcileParkedFeatures({
        projectRoot,
        runGit: run,
        getIssueState: async () => 'CLOSED',
      });

      expect({
        entries: result.entries,
        counts: result.counts,
        markerRemains: await isOperatorParked(projectRoot, slug),
        provenance: await getProvenanceType(projectRoot, slug),
      }).toEqual({
        entries: [{ slug, classification: 'orphan', annotation: 'orphan' }],
        counts: { reconciled: 0, deferred: 0, orphaned: 1, parked: 0, refused: 0, skipped: 0 },
        markerRemains: true,
        provenance: 'auto',
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it.each([
    { name: 'empty', body: '', mode: undefined },
    { name: 'unreadable', body: 'auto-parked: terminal daemon failure\n', mode: 0o000 },
  ])('fails closed for a $name marker body without throwing or removing the marker', async ({ body, mode }) => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = `marker-${body === '' ? 'empty' : 'unreadable'}`;
    const marker = join(projectRoot, '.daemon', 'parked', slug);
    const { run } = makeGit();
    try {
      await mkdir(join(projectRoot, '.daemon', 'parked'), { recursive: true });
      await writeFile(marker, body);
      if (mode !== undefined) await chmod(marker, mode);

      const result = await reconcileParkedFeatures({ projectRoot, runGit: run });

      expect({
        entries: result.entries,
        counts: result.counts,
        markerRemains: await access(marker).then(() => true, () => false),
      }).toEqual({
        entries: [{ slug, classification: 'unclassified', annotation: undefined }],
        counts: { reconciled: 0, deferred: 0, orphaned: 0, parked: 0, refused: 0, skipped: 1 },
        markerRemains: true,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('suppresses repeated outcomes and summaries, then prunes a no-longer-parked slug', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'cached-merged';
    const cache = new Map<string, 'merged' | 'orphan' | 'normal' | 'unclassified'>();
    const { run } = makeGit({ branches: [`feat/${slug}`], merged: [`feat/${slug}`] });
    const log = vi.fn<(message: string) => void>();
    try {
      await writeOperatorPark(projectRoot, slug);
      await reconcileParkedFeatures({ projectRoot, runGit: run, cache, log });
      const firstPass = [...log.mock.calls];

      log.mockClear();
      await reconcileParkedFeatures({ projectRoot, runGit: run, cache, log });
      const secondPass = [...log.mock.calls];

      await removeOperatorPark(projectRoot, slug);
      await reconcileParkedFeatures({ projectRoot, runGit: run, cache, log });

      expect({ firstPass, secondPass, cache: [...cache.entries()] }).toEqual({
        firstPass: [
          ['[parked-reconciliation] reconciled=0 deferred=1 orphaned=0 parked=1 refused=0 skipped=0; next: 1 deferred awaits shipped-record repair; 1 parked remains parked'],
        ],
        secondPass: [],
        cache: [],
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('re-logs a changed refusal mix but suppresses an identical following sweep', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'cached-refusal';
    const mergedPrHead = '1111111111111111111111111111111111111111';
    const cache = new Map<string, 'merged' | 'orphan' | 'normal' | 'unclassified'>();
    const { run } = makeGit({
      shipped: [slug],
      branches: [`feat/${slug}`],
      tips: { [`feat/${slug}`]: '2222222222222222222222222222222222222222' },
    });
    const runGh = vi.fn<GhRunner>()
      .mockResolvedValueOnce({ stdout: '[]' })
      .mockResolvedValue({ stdout: `[{"headRefOid":"${mergedPrHead}"}]` });
    const log = vi.fn<(message: string) => void>();
    try {
      await writeOperatorPark(projectRoot, slug);

      await reconcileParkedFeatures({ projectRoot, runGit: run, runGh, cache, log });
      await reconcileParkedFeatures({ projectRoot, runGit: run, runGh, cache, log });
      await reconcileParkedFeatures({ projectRoot, runGit: run, runGh, cache, log });

      expect(log.mock.calls).toEqual([
        ['[parked-reconciliation] reconciled=0 deferred=0 orphaned=0 parked=1 refused=1 skipped=0; refusals: no-merge-proof=1; next: 1 refusal requires resolving no-merge-proof; 1 parked remains parked'],
        ['[parked-reconciliation] reconciled=0 deferred=0 orphaned=0 parked=1 refused=1 skipped=0; refusals: branch-behind-merged-head=1; next: 1 refusal requires resolving branch-behind-merged-head; 1 parked remains parked'],
      ]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('skips an unreadable origin/main with one log line and does not query issue state', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'missing-origin';
    const { run } = makeGit({ shipped: 'unavailable' });
    const getIssueState = vi.fn(async () => 'CLOSED');
    const log = vi.fn<(message: string) => void>();
    try {
      await writeOperatorPark(projectRoot, slug);

      const result = await reconcileParkedFeatures({ projectRoot, runGit: run, getIssueState, log });

      expect({ entries: result.entries, issueCalls: getIssueState.mock.calls, logs: log.mock.calls }).toEqual({
        entries: [{ slug, classification: 'unclassified', annotation: undefined }],
        issueCalls: [],
        logs: [['[parked-reconciliation] reconciled=0 deferred=0 orphaned=0 parked=0 refused=0 skipped=1; next: 1 skipped retry when merge/issue evidence is available']],
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('contains an orphan issue lookup failure and still classifies a merged sibling', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const failingSlug = 'issue-down';
    const mergedSlug = 'merged-sibling';
    const { run } = makeGit({ shipped: [mergedSlug], branches: [`feat/${failingSlug}`] });
    const log = vi.fn<(message: string) => void>();
    try {
      await writeOperatorPark(projectRoot, failingSlug);
      await writeOperatorPark(projectRoot, mergedSlug);
      const intakeDir = join(projectRoot, '.docs', 'intake');
      await mkdir(intakeDir, { recursive: true });
      await writeFile(join(intakeDir, `${failingSlug}.md`), 'Source-Ref: acme/app#42\n');

      const result = await reconcileParkedFeatures({
        projectRoot,
        runGit: run,
        autoCleanup: false,
        getIssueState: async () => { throw new Error('gh unavailable'); },
        log,
      });

      expect({ entries: result.entries.sort((a, b) => a.slug.localeCompare(b.slug)), logs: log.mock.calls }).toEqual({
        entries: [
          { slug: failingSlug, classification: 'unclassified', annotation: undefined },
          { slug: mergedSlug, classification: 'merged', annotation: 'merged-ready' },
        ],
        logs: [['[parked-reconciliation] reconciled=0 deferred=0 orphaned=0 parked=1 refused=0 skipped=1; next: 1 parked remains parked; 1 skipped retry when merge/issue evidence is available']],
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('retains every candidate when the pass-wide worktree listing is unavailable', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'listing-unavailable';
    const { run, deleted } = makeGit({ shipped: [slug], branches: [`feat/${slug}`], merged: [`feat/${slug}`] });
    const events: unknown[] = [];
    try {
      await writeOperatorPark(projectRoot, slug);
      const result = await reconcileParkedFeatures({
        projectRoot,
        runGit: run,
        worktreeListing: async () => null,
        onEvent: (event) => events.push(event),
      });

      expect({ deleted, events, skipped: result.counts.skipped }).toEqual({
        deleted: [],
        events: [{ type: 'worktree_reclaim_retained', slug, branch: undefined, reason: 'listing-unavailable' }],
        skipped: 1,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('honours the reclaim gate for enumerated worktrees while preserving the terminal event', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'disabled-reclaim';
    const branch = `hotfix/${slug}`;
    const { run, deleted } = makeGit({ branches: [branch], merged: [branch] });
    const events: unknown[] = [];
    try {
      const result = await reconcileParkedFeatures({
        projectRoot,
        runGit: run,
        reclaimMergedWorktrees: false,
        worktreeListing: async () => [{ slug, branch }],
        onEvent: (event) => events.push(event),
      });

      expect({ deleted, reconciled: result.counts.reconciled, events }).toEqual({
        deleted: [],
        reconciled: 0,
        events: [{ type: 'worktree_reclaim_retained', slug, branch, reason: 'disabled' }],
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('keeps parked cleanup enabled when the enumerated reclaim gate is off', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const parkedSlug = 'gate-off-parked';
    const enumeratedSlug = 'gate-off-enumerated';
    const parkedBranch = `feat/${parkedSlug}`;
    const enumeratedBranch = `hotfix/${enumeratedSlug}`;
    const { run, deleted } = makeGit({
      shipped: [parkedSlug],
      branches: [parkedBranch, enumeratedBranch],
      merged: [parkedBranch, enumeratedBranch],
    });
    const events: unknown[] = [];
    try {
      await writeOperatorPark(projectRoot, parkedSlug);
      await reconcileParkedFeatures({
        projectRoot,
        runGit: run,
        reclaimMergedWorktrees: false,
        worktreeListing: async () => [{ slug: enumeratedSlug, branch: enumeratedBranch }],
        onEvent: (event) => events.push(event),
      });

      expect({ deleted, events }).toEqual({
        deleted: [parkedBranch],
        events: [
          { type: 'worktree_reclaim_reclaimed', slug: parkedSlug },
          { type: 'worktree_reclaim_retained', slug: enumeratedSlug, branch: enumeratedBranch, reason: 'disabled' },
        ],
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('reclaims an enumerated worktree when auto-cleanup is off but its reclaim gate is enabled', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'auto-cleanup-off-enumerated';
    const branch = `hotfix/${slug}`;
    const { run, deleted } = makeGit({ branches: [branch], merged: [branch] });
    try {
      const result = await reconcileParkedFeatures({
        projectRoot,
        runGit: run,
        autoCleanup: false,
        worktreeListing: async () => [{ slug, branch }],
      });

      expect({ deleted, reconciled: result.counts.reconciled }).toEqual({
        deleted: [branch],
        reconciled: 1,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('uses independent gates: reclaiming an enumerated worktree while retaining a parked candidate', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const parkedSlug = 'auto-cleanup-off-parked';
    const enumeratedSlug = 'auto-cleanup-off-enumerated-with-park';
    const parkedBranch = `feat/${parkedSlug}`;
    const enumeratedBranch = `hotfix/${enumeratedSlug}`;
    const { run, deleted } = makeGit({
      shipped: [parkedSlug],
      branches: [parkedBranch, enumeratedBranch],
      merged: [parkedBranch, enumeratedBranch],
    });
    const events: unknown[] = [];
    try {
      await writeOperatorPark(projectRoot, parkedSlug);

      await reconcileParkedFeatures({
        projectRoot,
        runGit: run,
        autoCleanup: false,
        reclaimMergedWorktrees: true,
        worktreeListing: async () => [{ slug: enumeratedSlug, branch: enumeratedBranch }],
        onEvent: (event) => events.push(event),
      });

      expect({ deleted, events }).toEqual({
        deleted: [enumeratedBranch],
        events: [
          { type: 'worktree_reclaim_retained', slug: parkedSlug, reason: 'disabled' },
          { type: 'worktree_reclaim_reclaimed', slug: enumeratedSlug, branch: enumeratedBranch, proof: 'ancestry' },
        ],
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('emits the helper proof and retains unavailable pass-wide evidence', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const squashSlug = 'squash-event';
    const unavailableSlug = 'evidence-down';
    const squashBranch = `hotfix/${squashSlug}`;
    const unavailableBranch = `hotfix/${unavailableSlug}`;
    const head = '1111111111111111111111111111111111111111';
    const { run, deleted } = makeGit({
      branches: [squashBranch],
      tips: { [squashBranch]: head },
      mergedPrHeads: [head],
    });
    const events: unknown[] = [];
    try {
      await reconcileParkedFeatures({
        projectRoot,
        runGit: run,
        runGh: async () => ({ stdout: `[{"headRefOid":"${head}"}]` }),
        worktreeListing: async () => [{ slug: squashSlug, branch: squashBranch }],
        onEvent: (event) => events.push(event),
      });
      expect({ deleted, events }).toEqual({
        deleted: [squashBranch],
        events: [{ type: 'worktree_reclaim_reclaimed', slug: squashSlug, branch: squashBranch, proof: 'merged-pr-head' }],
      });

      const unavailable = makeGit({ refsUnavailable: true });
      events.length = 0;
      await reconcileParkedFeatures({
        projectRoot,
        runGit: unavailable.run,
        worktreeListing: async () => [{ slug: unavailableSlug, branch: unavailableBranch }],
        onEvent: (event) => events.push(event),
      });
      expect(events).toEqual([
        { type: 'worktree_reclaim_retained', slug: unavailableSlug, branch: unavailableBranch, reason: 'evidence-unavailable' },
      ]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('reclaims a non-daemon enumerated candidate without consulting unavailable records', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'sweep-hotfix-unreadable-records';
    const branch = `hotfix/${slug}`;
    const { run, deleted } = makeGit({ shipped: 'unavailable', branches: [branch], merged: [branch] });
    const events: unknown[] = [];
    try {
      await reconcileParkedFeatures({
        projectRoot,
        runGit: run,
        worktreeListing: async () => [{ slug, branch }],
        onEvent: (event) => events.push(event),
      });

      expect({
        deleted,
        events,
        recordReads: run.mock.calls.filter(([args]) => args[0] === 'ls-tree' || args[0] === 'rev-parse'),
      }).toEqual({
        deleted: [branch],
        events: [{ type: 'worktree_reclaim_reclaimed', slug, branch, proof: 'ancestry' }],
        recordReads: [],
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('retains a nested registered path as invalid-slug without calling the helper', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'feat/nested-worktree';
    const branch = 'feat/nested-worktree';
    const { run, deleted } = makeGit({ branches: [branch], merged: [branch] });
    const events: unknown[] = [];
    try {
      await reconcileParkedFeatures({
        projectRoot,
        runGit: run,
        worktreeListing: async () => [{ slug, branch, reclaimable: false }],
        onEvent: (event) => events.push(event),
      });

      expect({ deleted, events }).toEqual({
        deleted: [],
        events: [{ type: 'worktree_reclaim_retained', slug, branch, reason: 'invalid-slug' }],
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('emits one failed event when a proven registered worktree cannot be removed', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'remove-fails';
    const branch = `hotfix/${slug}`;
    const worktree = join(projectRoot, '.worktrees', slug);
    const { run } = makeGit({
      branches: [branch],
      merged: [branch],
      registeredWorktrees: [worktree],
      worktreeRemoveFails: 'locked worktree',
    });
    const events: unknown[] = [];
    try {
      await mkdir(worktree, { recursive: true });
      const result = await reconcileParkedFeatures({
        projectRoot,
        runGit: run,
        worktreeListing: async () => [{ slug, branch }],
        onEvent: (event) => events.push(event),
      });

      expect({ refused: result.counts.refused, events }).toEqual({
        refused: 1,
        events: [{ type: 'worktree_reclaim_failed', slug, branch, refusal: 'worktree-remove-failed' }],
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
