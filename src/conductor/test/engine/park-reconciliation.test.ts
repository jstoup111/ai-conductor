import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { reconcileMergedPark, reconcileParkedFeatures } from '../../src/engine/park-reconciliation.js';
import type { GhRunner, GitRunner } from '../../src/engine/pr-labels.js';
import { isOperatorParked, removeOperatorPark, writeOperatorPark } from '../../src/engine/park-marker.js';

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
  /** Refs whose ancestry probe fails with a non-1 exit (broken repo state). */
  ancestryBroken?: readonly string[];
  /** `git for-each-ref` itself fails. */
  refsUnavailable?: boolean;
  /** `git branch -d` fails. */
  branchDeleteFails?: boolean;
}

function gitFailure(code: number, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function makeGit(world: GitWorld = {}): {
  run: ReturnType<typeof vi.fn<GitRunner>>;
  deleted: string[];
  events: string[];
} {
  const shipped = world.shipped ?? [];
  const branches = world.branches ?? [];
  const merged = world.merged ?? [];
  const deleted: string[] = [];
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
      if (shipped === 'unavailable') {
        throw gitFailure(128, 'fatal: Needed a single revision');
      }
      return { stdout: 'deadbeef\n' };
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
      if (merged.includes(ref)) return { stdout: '' };
      throw gitFailure(1, 'not an ancestor');
    }
    if (verb === 'branch') {
      events.push('branch-deleted');
      if (world.branchDeleteFails) throw gitFailure(1, 'branch delete failed');
      deleted.push(args[2]);
      return { stdout: '' };
    }
    if (verb === 'worktree') {
      events.push('worktree-removed');
      return { stdout: '' };
    }
    throw new Error(`unexpected git invocation: ${args.join(' ')}`);
  });

  return { run, deleted, events };
}

describe('engine/park-reconciliation — reconcileMergedPark', () => {
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
    {
      name: 'the branch exists but is not contained in origin/main and no record landed',
      world: { branches: ['feat/unmerged'], merged: [] },
      slug: 'unmerged',
      refusal: 'not-ancestor',
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

  it('refuses cleanup when a record-backed slug still has a branch outside origin/main', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'raced-after-record';
    const { run, deleted } = makeGit({
      shipped: [slug],
      branches: [`spec/${slug}`],
      merged: [],
    });
    try {
      await writeOperatorPark(projectRoot, slug);

      const outcome = await reconcileMergedPark({ projectRoot, slug, runGit: run });

      expect({ outcome, deleted, parked: await isOperatorParked(projectRoot, slug) }).toEqual({
        outcome: { slug, steps: [], refusal: 'not-ancestor' },
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
      outcome: { slug: 'recorded', steps: ['worktree-removed', 'branch-deleted', 'unparked'] },
      gitVerbs: [
        'ls-tree --name-only',
        'for-each-ref --format=%(refname:short)',
        'merge-base --is-ancestor',
        'branch -d',
      ],
      ghCalls: [],
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

  it('refuses cleanup when the established resume detector finds an in-progress worktree run', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'park-reconciliation-'));
    const slug = 'active-run';
    const { run } = makeGit({ shipped: [slug] });
    const log = vi.fn<(message: string) => void>();
    try {
      const pipeline = join(projectRoot, '.worktrees', slug, '.pipeline');
      await mkdir(pipeline, { recursive: true });
      await writeFile(
        join(pipeline, 'conduct-state.json'),
        JSON.stringify({ feature_desc: slug, build: 'in_progress' }),
      );

      const outcome = await reconcileMergedPark({ projectRoot, slug, runGit: run, log });

      expect({
        outcome,
        destructive: run.mock.calls.filter(([args]) => args[0] === 'branch' || args[0] === 'worktree'),
        logs: log.mock.calls,
      }).toEqual({
        outcome: { slug, steps: [], refusal: 'in-progress' },
        destructive: [],
        logs: [[`[parked-reconciliation] ${slug} has an in-progress run; refusing cleanup`]],
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

      expect(outcome).toEqual({ slug, steps: ['worktree-removed', 'branch-deleted', 'unparked'] });
    } finally {
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

      expect({ outcome, deleted, parked: await isOperatorParked(projectRoot, slug) }).toEqual({
        outcome: { slug, steps: ['worktree-removed', 'branch-deleted', 'unparked'] },
        deleted: [`fix/${slug}`],
        parked: false,
      });
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

      const result = await reconcileParkedFeatures({
        projectRoot,
        runGit: run,
        getIssueState,
        autoCleanup: false,
      });

      expect({
        entries: result.entries,
        destructive: run.mock.calls.filter(([args]) => args[0] === 'worktree' || args[0] === 'branch'),
      }).toEqual({
        entries: [{
          slug,
          classification,
          annotation:
            classification === 'orphan' ? 'orphan' : classification === 'merged' ? 'merged-ready' : undefined,
        }],
        destructive: [],
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
          [`[parked-reconciliation] ${slug} not reconcilable until the record lands`],
          [`[parked-reconciliation] ${slug} merged`],
          ['[parked-reconciliation] reconciled=0 deferred=1 orphaned=0 parked=1 skipped=0'],
        ],
        secondPass: [],
        cache: [],
      });
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
        logs: [['[parked-reconciliation] missing-origin origin/main merge evidence unavailable; skipped']],
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
        logs: [['[parked-reconciliation] issue-down issue lookup unavailable; skipped']],
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
