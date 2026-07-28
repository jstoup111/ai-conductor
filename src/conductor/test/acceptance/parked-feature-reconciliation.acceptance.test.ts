import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execa } from 'execa';
import { mkdtemp, mkdir, rm, writeFile, readFile, access, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

import type { GitRunner, GhRunner } from '../../src/engine/pr-labels.js';
import {
  writeOperatorPark,
  isOperatorParked,
  __resetResolveCacheForTests,
} from '../../src/engine/park-marker.js';

const execFile = promisify(execFileCb);
const REPO_ROOT = join(fileURLToPath(new URL('../../../..', import.meta.url)));
const REAL_CONDUCT_TS = join(REPO_ROOT, 'bin', 'conduct-ts');

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "Parked-Feature Reconciliation Sweep (#1060)"
// (.docs/stories/parked-feature-reconciliation-1060.md; plan Tasks 16 and 17).
//
// These drive REAL git repositories on disk (bare origin + working clone +
// real `git worktree add`) through the REAL production entry points, with a
// faithful FAKE only at the `gh` third-party boundary. Ancestry is a genuine
// git fact here — nothing about `merge-base --is-ancestor` is simulated.
//
// §3d call-site enumeration. `reconcileMergedPark` is the ONLY deletion
// authority in this feature (plan "Technical Approach"; story S4). Its
// production call sites are:
//   1. the sweep    — src/conductor/src/engine/park-reconciliation.ts
//                     #reconcileParkedFeatures  (plan Tasks 7-9, wired Tasks 10-11)
//   2. the CLI verb — src/conductor/src/engine/daemon-park-cli.ts
//                     `daemon reconcile-parked <slug>` (plan Task 13, dispatched
//                     pre-boot from src/conductor/src/index.ts)
// Both are exercised below against REAL adversarial repo state (a branch that
// has gained a commit since classification, a record that never landed, a live
// `.pipeline/` run) rather than against the helper in isolation.
//
// NOT-YET-IMPLEMENTED MODULE. `park-reconciliation.ts` does not exist at RED
// time, and `daemon-park-cli.ts` has no reconcile verb yet, so both are loaded
// dynamically rather than by static import — the same pattern used by
// test/acceptance/operator-park-rekick-sweep.acceptance.test.ts for
// `park-marker.ts`. This file therefore compiles today and fails for the right
// reason: the export does not exist.
//
// CONTRACT NOTES (surfaced for the implementer — behavior is story-pinned, the
// symbol/field NAMES below are this spec's proposal where the plan left them
// open):
//   - `runGit` / `runGh` are the canonical `GitRunner`/`GhRunner` seams from
//     pr-labels.ts / tracker-client.ts (pinned — plan Task 2 "injected git/gh
//     runners, injected log").
//   - `getIssueState(ref, cwd) => Promise<string>` matches the existing
//     `TrackerClient.getIssueState` signature (pinned — plan Task 7).
//   - `requestRecordRepair` is the injected ST-916 record-only repair-PR seam
//     hook (plan Task 4 "injected callback"; the NAME is proposed here).
//   - Annotation values `'orphan'` / `'merged-ready'` are pinned by plan Task 12.
//   - Summary counts `reconciled / deferred / orphaned / parked / skipped` are
//     pinned by story S7.
//   - The reconcile verb's detector/dispatcher symbol is deliberately NOT
//     frozen: plan Task 13 offers either extending `detectDaemonParkCommand` or
//     adding `detectDaemonReconcileCommand`. `loadReconcileVerb()` below accepts
//     either, because story S5 pins the BEHAVIOR ("detected pre-boot alongside
//     `daemon park|unpark` and dispatched without starting the daemon"), not
//     the symbol.
// ─────────────────────────────────────────────────────────────────────────────

const PARK_RECONCILIATION_MOD = '../../src/engine/park-reconciliation.js';
const PARK_CLI_MOD = '../../src/engine/daemon-park-cli.js';

/** Annotation the dashboard renders as a PARKED-line suffix (plan Task 12). */
type ParkAnnotation = 'orphan' | 'merged-ready';

interface ParkedSweepEntry {
  slug: string;
  annotation?: ParkAnnotation;
}

interface ParkedSweepCounts {
  reconciled: number;
  deferred: number;
  orphaned: number;
  parked: number;
  skipped: number;
}

interface ParkedSweepResult {
  entries: ParkedSweepEntry[];
  counts: ParkedSweepCounts;
}

interface RecordRepairRequest {
  slug: string;
  prUrl: string;
}

interface ReconcileSweepOpts {
  projectRoot: string;
  autoCleanup?: boolean;
  runGit?: GitRunner;
  runGh?: GhRunner;
  getIssueState?: (ref: string, cwd: string) => Promise<string>;
  requestRecordRepair?: (req: RecordRepairRequest) => Promise<void>;
  log?: (msg: string) => void;
}

interface ReconcileParkOutcome {
  slug: string;
  /** Steps actually taken, e.g. 'worktree-removed' | 'branch-deleted' | 'unparked'. */
  steps: string[];
  /** Refusal reason naming the failed precondition; absent on success. */
  refusal?: string;
}

type ReconcileParkedFeaturesFn = (opts: ReconcileSweepOpts) => Promise<ParkedSweepResult>;
type ReconcileMergedParkFn = (
  opts: ReconcileSweepOpts & { slug: string },
) => Promise<ReconcileParkOutcome>;

async function loadMod(path: string): Promise<Record<string, unknown>> {
  return (await import(path)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...a: never[]) => unknown {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...a: never[]) => unknown;
}

async function loadSweep(): Promise<ReconcileParkedFeaturesFn> {
  const mod = await loadMod(PARK_RECONCILIATION_MOD);
  return requireFn(mod, 'reconcileParkedFeatures') as unknown as ReconcileParkedFeaturesFn;
}

async function loadHelper(): Promise<ReconcileMergedParkFn> {
  const mod = await loadMod(PARK_RECONCILIATION_MOD);
  return requireFn(mod, 'reconcileMergedPark') as unknown as ReconcileMergedParkFn;
}

/**
 * Lazy façades. Resolving the not-yet-existing module at the point of CALL —
 * rather than at the top of each test — means the real-git fixture below is
 * fully exercised during RED. Without this, every spec would die on the
 * missing import before touching a single repo, and a latent fixture bug
 * would only surface after implementation (a failure for the wrong reason).
 */
const sweep: ReconcileParkedFeaturesFn = async (opts) => (await loadSweep())(opts);
const reconcileMergedPark: ReconcileMergedParkFn = async (opts) => (await loadHelper())(opts);

/**
 * Resolve the pre-boot reconcile verb without freezing plan Task 13's open
 * symbol choice: either a dedicated `detectDaemonReconcileCommand` /
 * `dispatchDaemonReconcile` pair, or the existing park detector/dispatcher
 * widened to carry a `reconcile-parked` kind. Whichever exists must, per story
 * S5, detect `['node','conduct','daemon','reconcile-parked',<slug>]` and
 * dispatch it without starting the daemon.
 */
async function loadReconcileVerb(): Promise<{
  detect: (argv: string[]) => { kind: string; slug?: string } | null;
  dispatch: (
    cmd: { kind: string; slug?: string },
    deps: { cwd?: string; out?: (line: string) => void; runGit?: GitRunner; runGh?: GhRunner },
  ) => Promise<number>;
}> {
  const mod = await loadMod(PARK_CLI_MOD);
  const detect = (typeof mod.detectDaemonReconcileCommand === 'function'
    ? mod.detectDaemonReconcileCommand
    : mod.detectDaemonParkCommand) as (argv: string[]) => { kind: string; slug?: string } | null;
  const dispatch = (typeof mod.dispatchDaemonReconcile === 'function'
    ? mod.dispatchDaemonReconcile
    : mod.dispatchDaemonPark) as (
    cmd: { kind: string; slug?: string },
    deps: { cwd?: string; out?: (line: string) => void; runGit?: GitRunner; runGh?: GhRunner },
  ) => Promise<number>;
  if (typeof detect !== 'function' || typeof dispatch !== 'function') {
    throw new Error('daemon-park-cli.ts exposes no reconcile detector/dispatcher (not yet implemented)');
  }
  // Fail fast and legibly while the verb is unimplemented: whichever detector
  // we resolved must actually recognise the reconcile argv. Without this the
  // fallback detector silently returns null and every verb spec dies on an
  // unrelated null-deref deep inside `dispatchDaemonPark`.
  if (detect(['node', 'conduct', 'daemon', 'reconcile-parked', 'probe-slug']) === null) {
    throw new Error(
      "argv 'daemon reconcile-parked <slug>' is not detected pre-boot by daemon-park-cli.ts (not yet implemented)",
    );
  }
  return { detect, dispatch };
}

// ── Real-git fixture ────────────────────────────────────────────────────────
// Mirrors the bare-origin + working-clone fixture in
// daemon-stale-engine-origin-advance.acceptance.test.ts. Ancestry, branch
// existence, and "record on the base branch" are all REAL git facts.

let tmpBase: string;
let projectRoot: string;
let originDir: string;

async function git(args: string[], cwd: string = projectRoot): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

/** Real git runner injected into the production code under test. */
const realGit: GitRunner = async (args, opts) => {
  const { stdout } = await execFile('git', args, { cwd: opts.cwd });
  return { stdout };
};

/** A `gh` that would fail loudly if the sweep ever reached the network. */
function fakeGh(handler: (args: string[]) => string | Promise<string>): GhRunner {
  return async (args) => ({ stdout: String(await handler(args)) });
}

/** `gh` fake that reports one merged implementation PR for `feature/<slug>`. */
function ghWithMergedPr(slug: string, prUrl: string): GhRunner {
  return fakeGh((args) => {
    if (args[0] === 'pr' && args[1] === 'list') {
      return JSON.stringify([{ number: 1060, url: prUrl, headRefName: `feature/${slug}` }]);
    }
    return '[]';
  });
}

/** `gh` fake that is entirely down — every invocation rejects. */
const ghDown: GhRunner = async () => {
  throw new Error('gh: command not found');
};

async function initRepo(): Promise<void> {
  tmpBase = await mkdtemp(join(tmpdir(), 'parked-reconciliation-'));
  projectRoot = join(tmpBase, 'work');
  originDir = join(tmpBase, 'origin.git');
  await mkdir(projectRoot, { recursive: true });
  await mkdir(originDir, { recursive: true });
  await execFile('git', ['init', '--bare', '-q', '-b', 'main'], { cwd: originDir });
  await execFile('git', ['init', '-q', '-b', 'main'], { cwd: projectRoot });
  await git(['config', 'user.email', 'test@test.com']);
  await git(['config', 'user.name', 'Test']);
  await git(['config', 'gc.auto', '0']);
  await git(['remote', 'add', 'origin', originDir]);
  await writeFile(join(projectRoot, 'README.md'), 'init\n');
  await git(['add', '-A']);
  await git(['commit', '-q', '-m', 'init']);
  await git(['push', '-q', '-u', 'origin', 'main']);
}

async function writeRepoFile(relPath: string, body: string): Promise<void> {
  const abs = join(projectRoot, relPath);
  await mkdir(join(abs, '..'), { recursive: true });
  await writeFile(abs, body);
}

/** A plan file, so `validateSlug` recognises the slug as real work. */
async function seedPlan(slug: string): Promise<void> {
  await writeRepoFile(`.docs/plans/${slug}.md`, `# Plan: ${slug}\n`);
}

/** An intake marker carrying a parseable `Source-Ref:` (story S6). */
async function seedIntakeMarker(slug: string, sourceRef: string): Promise<void> {
  await writeRepoFile(`.docs/intake/${slug}.md`, `Source-Ref: ${sourceRef}\n\n## Desired outcome\n- x\n`);
}

/**
 * Build a parked feature: a `feature/<slug>` branch with one commit and a real
 * linked worktree at `.worktrees/<slug>`, plus the park marker.
 *
 * `merged: true` merges the branch into main and pushes, so
 * `git merge-base --is-ancestor feature/<slug> origin/main` succeeds for real.
 * `record: true` additionally lands `.docs/shipped/<slug>.md` on the base branch.
 */
async function seedParkedFeature(
  slug: string,
  opts: { merged: boolean; record: boolean; sourceRef?: string },
): Promise<void> {
  await seedPlan(slug);
  if (opts.sourceRef) await seedIntakeMarker(slug, opts.sourceRef);
  await git(['add', '-A']);
  await git(['commit', '-q', '-m', `spec: ${slug}`]);

  await git(['checkout', '-q', '-b', `feature/${slug}`]);
  await writeRepoFile(`src/${slug}.txt`, 'feature work\n');
  await git(['add', '-A']);
  await git(['commit', '-q', '-m', `feat: ${slug}`]);
  await git(['checkout', '-q', 'main']);

  if (opts.merged) {
    await git(['merge', '-q', '--no-ff', '-m', `merge ${slug}`, `feature/${slug}`]);
  }
  if (opts.record) {
    await writeRepoFile(`.docs/shipped/${slug}.md`, `# Shipped: ${slug}\nPR: https://example.test/pr/1\n`);
    await git(['add', '-A']);
    await git(['commit', '-q', '-m', `chore(shipped): ${slug}`]);
  }
  await git(['push', '-q', 'origin', 'main']);

  await git(['worktree', 'add', '-q', join(projectRoot, '.worktrees', slug), `feature/${slug}`]);
  await writeOperatorPark(projectRoot, slug);
}

/** Add a commit to the feature branch AFTER it merged — it is no longer an ancestor. */
async function advanceFeatureBranch(slug: string): Promise<void> {
  const wt = join(projectRoot, '.worktrees', slug);
  await writeFile(join(wt, 'late.txt'), 'work that landed after classification\n');
  await git(['add', '-A'], wt);
  await git(['commit', '-q', '-m', 'feat: late work'], wt);
}

/** Write a `.pipeline/` that indicates a LIVE run in the feature worktree. */
async function seedInFlightPipeline(slug: string): Promise<void> {
  const pipelineDir = join(projectRoot, '.worktrees', slug, '.pipeline');
  await mkdir(pipelineDir, { recursive: true });
  await writeFile(
    join(pipelineDir, 'conduct-state.json'),
    JSON.stringify(
      {
        feature_desc: slug,
        build: 'in_progress',
        last_step: 'build',
        run_started_at: Date.now(),
        session_started_at: Date.now(),
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(pipelineDir, 'task-status.json'),
    JSON.stringify({ 'task-1': { status: 'in_progress' } }, null, 2),
  );
}

async function exists(p: string): Promise<boolean> {
  return access(p)
    .then(() => true)
    .catch(() => false);
}

async function worktreeExists(slug: string): Promise<boolean> {
  return exists(join(projectRoot, '.worktrees', slug));
}

async function branchExists(slug: string): Promise<boolean> {
  return git(['rev-parse', '--verify', '--quiet', `refs/heads/feature/${slug}`])
    .then(() => true)
    .catch(() => false);
}

async function branchSha(slug: string): Promise<string | null> {
  return git(['rev-parse', `refs/heads/feature/${slug}`]).catch(() => null);
}

function entryFor(result: ParkedSweepResult, slug: string): ParkedSweepEntry | undefined {
  return result.entries.find((e) => e.slug === slug);
}

beforeEach(async () => {
  __resetResolveCacheForTests();
  await initRepo();
});

afterEach(async () => {
  __resetResolveCacheForTests();
  await rm(tmpBase, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Plan Task 16 — S2/S3: end-to-end reconciliation through the REAL sweep
// ─────────────────────────────────────────────────────────────────────────────

describe('parked-feature reconciliation acceptance (S2/S3): the sweep reconciles only ancestry-proven, record-backed parks', () => {
  it('S2 happy (a): a merged park with its record on the base branch is fully reconciled in one pass — worktree, branch, and marker all gone', async () => {
    const slug = 'merged-and-recorded';
    await seedParkedFeature(slug, { merged: true, record: true });

    expect(await worktreeExists(slug)).toBe(true);
    expect(await branchExists(slug)).toBe(true);
    expect(await isOperatorParked(projectRoot, slug)).toBe(true);

    const log: string[] = [];
    const result = await sweep({
      projectRoot,
      runGit: realGit,
      runGh: ghWithMergedPr(slug, 'https://example.test/pr/1'),
      log: (m) => log.push(m),
    });

    expect(await worktreeExists(slug)).toBe(false);
    expect(await branchExists(slug)).toBe(false);
    expect(await isOperatorParked(projectRoot, slug)).toBe(false);
    expect(result.counts.reconciled).toBe(1);
    expect(log).toContain(`[parked-reconciliation] reconciled ${slug}`);
  });

  it('S2 happy: an ancestry-proven park whose worktree directory is already gone still deletes the branch and removes the marker', async () => {
    const slug = 'worktree-already-gone';
    await seedParkedFeature(slug, { merged: true, record: true });

    // Remove only the worktree checkout; the branch is the source of truth.
    await git(['worktree', 'remove', '--force', join(projectRoot, '.worktrees', slug)]);
    expect(await worktreeExists(slug)).toBe(false);
    expect(await branchExists(slug)).toBe(true);

    await sweep({
      projectRoot,
      runGit: realGit,
      runGh: ghWithMergedPr(slug, 'https://example.test/pr/1'),
    });

    expect(await branchExists(slug)).toBe(false);
    expect(await isOperatorParked(projectRoot, slug)).toBe(false);
  });

  it('S2 negative (b): a park whose branch is NOT an ancestor of origin/main leaves worktree, branch sha, and marker byte-identical', async () => {
    const slug = 'still-in-flight';
    await seedParkedFeature(slug, { merged: false, record: false });

    const shaBefore = await branchSha(slug);
    const markerBefore = await readFile(join(projectRoot, '.daemon', 'parked', slug), 'utf-8');

    await sweep({
      projectRoot,
      runGit: realGit,
      runGh: fakeGh(() => '[]'),
      getIssueState: async () => 'OPEN',
    });

    expect(await worktreeExists(slug)).toBe(true);
    expect(await branchExists(slug)).toBe(true);
    expect(await branchSha(slug)).toBe(shaBefore);
    expect(await readFile(join(projectRoot, '.daemon', 'parked', slug), 'utf-8')).toBe(markerBefore);
  });

  it('S2 negative (c): ancestry-proven but record MISSING — nothing is deleted, record creation is delegated to the ST-916 seam, marker survives', async () => {
    const slug = 'merged-without-record';
    await seedParkedFeature(slug, { merged: true, record: false });

    const requestRecordRepair = vi.fn(async () => {});
    const log: string[] = [];
    const result = await sweep({
      projectRoot,
      runGit: realGit,
      runGh: ghWithMergedPr(slug, 'https://example.test/pr/1060'),
      requestRecordRepair,
      log: (m) => log.push(m),
    });

    expect(await worktreeExists(slug)).toBe(true);
    expect(await branchExists(slug)).toBe(true);
    expect(await isOperatorParked(projectRoot, slug)).toBe(true);

    expect(requestRecordRepair).toHaveBeenCalledTimes(1);
    expect(requestRecordRepair).toHaveBeenCalledWith(
      expect.objectContaining({ slug, prUrl: 'https://example.test/pr/1060' }),
    );
    expect(result.counts.deferred).toBe(1);
    expect(result.counts.reconciled).toBe(0);
    expect(log.some((l) => l.includes(slug) && /not reconcilable until the record lands/.test(l))).toBe(true);

    // The sweep never writes a record itself.
    expect(await exists(join(projectRoot, '.docs', 'shipped', `${slug}.md`))).toBe(false);
  });

  it('S2 negative (c2): ancestry-proven, record missing, and NO merged PR resolvable — zero record writes, zero deletions, zero delegation', async () => {
    const slug = 'merged-no-pr-found';
    await seedParkedFeature(slug, { merged: true, record: false });

    const requestRecordRepair = vi.fn(async () => {});
    const result = await sweep({
      projectRoot,
      runGit: realGit,
      runGh: fakeGh(() => '[]'), // no merged PR for this head
      requestRecordRepair,
    });

    expect(requestRecordRepair).not.toHaveBeenCalled();
    expect(await worktreeExists(slug)).toBe(true);
    expect(await branchExists(slug)).toBe(true);
    expect(await isOperatorParked(projectRoot, slug)).toBe(true);
    expect(await exists(join(projectRoot, '.docs', 'shipped', `${slug}.md`))).toBe(false);
    expect(result.counts.reconciled).toBe(0);
  });

  it('S2 negative (d): a merged, record-backed park with an IN-FLIGHT .pipeline run keeps its worktree — the reason is logged', async () => {
    const slug = 'parked-over-live-run';
    await seedParkedFeature(slug, { merged: true, record: true });
    await seedInFlightPipeline(slug);

    const log: string[] = [];
    const result = await sweep({
      projectRoot,
      runGit: realGit,
      runGh: ghWithMergedPr(slug, 'https://example.test/pr/1'),
      log: (m) => log.push(m),
    });

    expect(await worktreeExists(slug)).toBe(true);
    expect(await exists(join(projectRoot, '.worktrees', slug, '.pipeline', 'conduct-state.json'))).toBe(true);
    expect(await isOperatorParked(projectRoot, slug)).toBe(true);
    expect(result.counts.reconciled).toBe(0);
    expect(log.some((l) => l.includes(slug) && /in.?flight|in.?progress|\.pipeline/i.test(l))).toBe(true);
  });

  it('S2 negative: a park with NO feature branch at all makes no ancestry claim and is never treated as merged', async () => {
    const slug = 'branchless-park';
    await seedPlan(slug);
    await git(['add', '-A']);
    await git(['commit', '-q', '-m', `spec: ${slug}`]);
    await git(['push', '-q', 'origin', 'main']);
    await writeOperatorPark(projectRoot, slug);

    const result = await sweep({
      projectRoot,
      runGit: realGit,
      runGh: fakeGh(() => '[]'),
      getIssueState: async () => 'OPEN',
    });

    expect(await isOperatorParked(projectRoot, slug)).toBe(true);
    expect(result.counts.reconciled).toBe(0);
    expect(entryFor(result, slug)?.annotation).toBeUndefined();
  });

  it('S2 negative: with no origin/main resolvable, the pass is a per-slug no-op — nothing deleted, reason logged', async () => {
    const slug = 'no-remote-park';
    await seedParkedFeature(slug, { merged: true, record: true });

    // Drop the remote and its tracking refs: `origin/main` no longer exists.
    await git(['remote', 'remove', 'origin']);
    await git(['update-ref', '-d', 'refs/remotes/origin/main']).catch(() => '');

    const log: string[] = [];
    const result = await sweep({
      projectRoot,
      runGit: realGit,
      runGh: fakeGh(() => '[]'),
      log: (m) => log.push(m),
    });

    expect(await worktreeExists(slug)).toBe(true);
    expect(await branchExists(slug)).toBe(true);
    expect(await isOperatorParked(projectRoot, slug)).toBe(true);
    expect(result.counts.reconciled).toBe(0);
    expect(log.some((l) => /origin\/main|no remote/i.test(l))).toBe(true);
  });

  it('S3 negative (e): with reconcile_parked_auto_cleanup OFF, a merged record-backed park is annotated `merged-ready` and NOTHING is deleted', async () => {
    const slug = 'merged-but-toggle-off';
    await seedParkedFeature(slug, { merged: true, record: true });

    const shaBefore = await branchSha(slug);
    const result = await sweep({
      projectRoot,
      autoCleanup: false,
      runGit: realGit,
      runGh: ghWithMergedPr(slug, 'https://example.test/pr/1'),
    });

    expect(await worktreeExists(slug)).toBe(true);
    expect(await branchExists(slug)).toBe(true);
    expect(await branchSha(slug)).toBe(shaBefore);
    expect(await isOperatorParked(projectRoot, slug)).toBe(true);
    expect(result.counts.reconciled).toBe(0);
    expect(entryFor(result, slug)?.annotation).toBe('merged-ready');
  });

  it('S1/S7 negative: one slug whose classification fails does not stop the pass — a sibling merged park still reconciles', async () => {
    await seedParkedFeature('healthy-merged', { merged: true, record: true });
    await seedParkedFeature('broken-classify', { merged: false, record: false });

    // A git runner that blows up with an UNEXPECTED error (not the documented
    // exit-1 "not an ancestor") for one slug only.
    const flakyGit: GitRunner = async (args, opts) => {
      if (args.join(' ').includes('broken-classify') && args[0] === 'merge-base') {
        throw Object.assign(new Error('fatal: bad object'), { code: 128 });
      }
      return realGit(args, opts);
    };

    const log: string[] = [];
    const result = await sweep({
      projectRoot,
      runGit: flakyGit,
      runGh: ghWithMergedPr('healthy-merged', 'https://example.test/pr/1'),
      log: (m) => log.push(m),
    });

    // Sibling reconciled.
    expect(await worktreeExists('healthy-merged')).toBe(false);
    expect(await branchExists('healthy-merged')).toBe(false);
    expect(await isOperatorParked(projectRoot, 'healthy-merged')).toBe(false);

    // Failing slug skipped — never deleted, never labelled merged.
    expect(await worktreeExists('broken-classify')).toBe(true);
    expect(await branchExists('broken-classify')).toBe(true);
    expect(await isOperatorParked(projectRoot, 'broken-classify')).toBe(true);
    expect(result.counts.skipped).toBeGreaterThanOrEqual(1);
    expect(log.some((l) => l.includes('broken-classify'))).toBe(true);
  });

  it('S7 negative: with `gh` entirely down, the merged+record-on-main park STILL reconciles (a pure-git fact) and the pass never throws', async () => {
    const slug = 'merged-gh-down';
    await seedParkedFeature(slug, { merged: true, record: true, sourceRef: 'acme/repo#7' });

    const requestRecordRepair = vi.fn(async () => {});
    await expect(
      sweep({
        projectRoot,
        runGit: realGit,
        runGh: ghDown,
        getIssueState: async () => {
          throw new Error('gh: command not found');
        },
        requestRecordRepair,
      }),
    ).resolves.toBeDefined();

    expect(await worktreeExists(slug)).toBe(false);
    expect(await branchExists(slug)).toBe(false);
    expect(await isOperatorParked(projectRoot, slug)).toBe(false);
    expect(requestRecordRepair).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Plan Task 17 — S6/S7: orphan surfacing, fail-closed
// ─────────────────────────────────────────────────────────────────────────────

describe('parked-feature reconciliation acceptance (S6/S7): orphan surfacing is fail-closed and never authorises deletion', () => {
  it('S6 happy: a park with a CLOSED Source-Ref issue and a non-ancestor branch is annotated `orphan` and nothing is deleted', async () => {
    const slug = 'closed-issue-unmerged';
    await seedParkedFeature(slug, { merged: false, record: false, sourceRef: 'acme/repo#1060' });

    const seenRefs: string[] = [];
    const log: string[] = [];
    const result = await sweep({
      projectRoot,
      runGit: realGit,
      runGh: fakeGh(() => '[]'),
      getIssueState: async (ref) => {
        seenRefs.push(ref);
        return 'CLOSED';
      },
      log: (m) => log.push(m),
    });

    expect(seenRefs).toContain('acme/repo#1060'); // the shared parser's canonical form
    expect(entryFor(result, slug)?.annotation).toBe('orphan');
    expect(result.counts.orphaned).toBe(1);

    expect(await worktreeExists(slug)).toBe(true);
    expect(await branchExists(slug)).toBe(true);
    expect(await isOperatorParked(projectRoot, slug)).toBe(true);
    expect(log.some((l) => l.includes(slug) && /orphan/i.test(l))).toBe(true);
  });

  it('S6 negative: a park with NO intake marker is never labelled orphan and renders as a normal parked entry', async () => {
    const slug = 'no-intake-marker';
    await seedParkedFeature(slug, { merged: false, record: false }); // no Source-Ref

    const getIssueState = vi.fn(async () => 'CLOSED');
    const result = await sweep({
      projectRoot,
      runGit: realGit,
      runGh: fakeGh(() => '[]'),
      getIssueState,
    });

    expect(getIssueState).not.toHaveBeenCalled(); // no ref → no lookup at all
    expect(entryFor(result, slug)?.annotation).toBeUndefined();
    expect(result.counts.orphaned).toBe(0);
    expect(await worktreeExists(slug)).toBe(true);
    expect(await isOperatorParked(projectRoot, slug)).toBe(true);
  });

  it('S6 negative: an UNPARSEABLE Source-Ref is not an orphan — fail-closed, no lookup, no annotation, no deletion', async () => {
    const slug = 'garbage-source-ref';
    await seedParkedFeature(slug, { merged: false, record: false, sourceRef: 'not-a-ref' });

    const getIssueState = vi.fn(async () => 'CLOSED');
    const result = await sweep({
      projectRoot,
      runGit: realGit,
      runGh: fakeGh(() => '[]'),
      getIssueState,
    });

    expect(getIssueState).not.toHaveBeenCalled();
    expect(entryFor(result, slug)?.annotation).toBeUndefined();
    expect(result.counts.orphaned).toBe(0);
    expect(await isOperatorParked(projectRoot, slug)).toBe(true);
  });

  it('S6 negative: an issue-state lookup FAILURE adds no orphan label and changes nothing', async () => {
    const slug = 'issue-lookup-fails';
    await seedParkedFeature(slug, { merged: false, record: false, sourceRef: 'acme/repo#42' });

    const result = await sweep({
      projectRoot,
      runGit: realGit,
      runGh: fakeGh(() => '[]'),
      getIssueState: async () => {
        throw new Error('HTTP 403: API rate limit exceeded');
      },
    });

    expect(entryFor(result, slug)?.annotation).toBeUndefined();
    expect(result.counts.orphaned).toBe(0);
    expect(await worktreeExists(slug)).toBe(true);
    expect(await branchExists(slug)).toBe(true);
    expect(await isOperatorParked(projectRoot, slug)).toBe(true);
  });

  it('S6 negative: a park whose Source-Ref issue is still OPEN renders as a normal parked entry', async () => {
    const slug = 'open-issue-park';
    await seedParkedFeature(slug, { merged: false, record: false, sourceRef: 'acme/repo#9' });

    const result = await sweep({
      projectRoot,
      runGit: realGit,
      runGh: fakeGh(() => '[]'),
      getIssueState: async () => 'OPEN',
    });

    expect(entryFor(result, slug)?.annotation).toBeUndefined();
    expect(result.counts.orphaned).toBe(0);
    expect(result.counts.parked).toBeGreaterThanOrEqual(1);
    expect(await isOperatorParked(projectRoot, slug)).toBe(true);
  });

  it('S6 gate: an orphan is NEVER handed to the cleanup helper — its worktree, branch, and marker all survive a pass that reconciles a sibling', async () => {
    await seedParkedFeature('orphan-slug', {
      merged: false,
      record: false,
      sourceRef: 'acme/repo#1060',
    });
    await seedParkedFeature('mergeable-slug', { merged: true, record: true });

    const result = await sweep({
      projectRoot,
      runGit: realGit,
      runGh: ghWithMergedPr('mergeable-slug', 'https://example.test/pr/2'),
      getIssueState: async () => 'CLOSED',
    });

    // Orphan fully intact.
    expect(await worktreeExists('orphan-slug')).toBe(true);
    expect(await branchExists('orphan-slug')).toBe(true);
    expect(await isOperatorParked(projectRoot, 'orphan-slug')).toBe(true);
    expect(entryFor(result, 'orphan-slug')?.annotation).toBe('orphan');

    // Sibling reconciled in the same pass.
    expect(await worktreeExists('mergeable-slug')).toBe(false);
    expect(await branchExists('mergeable-slug')).toBe(false);
    expect(await isOperatorParked(projectRoot, 'mergeable-slug')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3d — the SECOND production call site of the deletion helper: the operator
// verb. Driven through the real pre-boot detect + dispatch path (story S5),
// against real repo state, not by calling the helper directly.
// ─────────────────────────────────────────────────────────────────────────────

describe('parked-feature reconciliation acceptance (S5/S4): the operator verb is the second deletion call site and re-verifies for itself', () => {
  it('S5 negative: bare or malformed reconciliation input prints actionable rejection before attempting Git root resolution', async () => {
    const nonGitCwd = join(tmpBase, 'not-a-repo');
    const fakeBin = join(tmpBase, 'fake-bin');
    const gitProbe = join(tmpBase, 'git-was-called');
    await mkdir(nonGitCwd);
    await mkdir(fakeBin);
    await writeFile(join(fakeBin, 'git'), '#!/bin/sh\nprintf called > "$GIT_PROBE"\nexit 1\n');
    await chmod(join(fakeBin, 'git'), 0o755);
    const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}`, GIT_PROBE: gitProbe };

    const [bare, malformed] = await Promise.all([
      execa(REAL_CONDUCT_TS, ['daemon', 'reconcile-parked'], { cwd: nonGitCwd, reject: false, all: true, env }),
      execa(REAL_CONDUCT_TS, ['daemon', 'reconcile-parked', 'bad/slug'], { cwd: nonGitCwd, reject: false, all: true, env }),
    ]);
    const gitWasCalled = await access(gitProbe).then(() => true).catch(() => false);

    expect({
      bare: { code: bare.exitCode, output: `${bare.stdout}\n${bare.stderr}` },
      malformed: { code: malformed.exitCode, output: `${malformed.stdout}\n${malformed.stderr}` },
      gitWasCalled,
    }).toEqual({
      bare: { code: 1, output: expect.stringContaining('Usage: conduct daemon reconcile-parked <slug>') },
      malformed: { code: 1, output: expect.stringContaining("Could not reconcile 'bad/slug': invalid-slug") },
      gitWasCalled: false,
    });
  });

  it('S5 happy: `conduct daemon reconcile-parked <slug>` reconciles a merged, record-backed park, prints the steps taken, and exits 0', async () => {
    const slug = 'verb-reconciles-me';
    await seedParkedFeature(slug, { merged: true, record: true });
    const { detect, dispatch } = await loadReconcileVerb();

    const cmd = detect(['node', 'conduct', 'daemon', 'reconcile-parked', slug]);
    expect(cmd).not.toBeNull();
    expect(cmd?.slug).toBe(slug);

    const out: string[] = [];
    const code = await dispatch(cmd as { kind: string; slug: string }, {
      cwd: projectRoot,
      out: (l) => out.push(l),
      runGit: realGit,
      runGh: ghWithMergedPr(slug, 'https://example.test/pr/1'),
    });

    expect(code).toBe(0);
    expect(await worktreeExists(slug)).toBe(false);
    expect(await branchExists(slug)).toBe(false);
    expect(await isOperatorParked(projectRoot, slug)).toBe(false);

    const printed = out.join('\n');
    expect(printed).toMatch(/worktree/i);
    expect(printed).toMatch(/branch/i);
    expect(printed).toMatch(/unpark/i);
  });

  it('S5/S4 negative (§3d re-verification): a branch that gained a commit AFTER classification is refused at the point of deletion — no force path', async () => {
    const slug = 'raced-branch';
    await seedParkedFeature(slug, { merged: true, record: true });

    // The adversarial input the real call site actually sees: the slug looked
    // merged a moment ago, and then real work landed on the branch.
    await advanceFeatureBranch(slug);
    const shaAfterRace = await branchSha(slug);
    const { detect, dispatch } = await loadReconcileVerb();

    const out: string[] = [];
    const code = await dispatch(
      detect(['node', 'conduct', 'daemon', 'reconcile-parked', slug]) as { kind: string; slug: string },
      {
        cwd: projectRoot,
        out: (l) => out.push(l),
        runGit: realGit,
        runGh: ghWithMergedPr(slug, 'https://example.test/pr/1'),
      },
    );

    expect(code).not.toBe(0);
    expect(await worktreeExists(slug)).toBe(true);
    expect(await branchExists(slug)).toBe(true);
    expect(await branchSha(slug)).toBe(shaAfterRace);
    expect(await isOperatorParked(projectRoot, slug)).toBe(true);
    expect(out.join('\n')).toMatch(/ancestor/i);
    expect(out.join('\n')).not.toMatch(/--force|force path/i);
  });

  it('S5 negative: a slug that is not parked and does not validate is refused with an actionable message, non-zero, without touching git', async () => {
    const { detect, dispatch } = await loadReconcileVerb();
    const gitSpy = vi.fn(realGit);

    const out: string[] = [];
    const code = await dispatch(
      detect(['node', 'conduct', 'daemon', 'reconcile-parked', 'no-such-slug']) as {
        kind: string;
        slug: string;
      },
      { cwd: projectRoot, out: (l) => out.push(l), runGit: gitSpy, runGh: fakeGh(() => '[]') },
    );

    expect(code).not.toBe(0);
    expect(out.join('\n')).toMatch(/no-such-slug/);
    expect(
      gitSpy.mock.calls.some(([args]) => args[0] === 'worktree' || args[0] === 'branch'),
    ).toBe(false);
  });

  it('S5 negative: a bare `daemon reconcile-parked` dispatches usage without executing reconciliation', async () => {
    const { detect, dispatch } = await loadReconcileVerb();

    // Positive control FIRST: without it this spec passes vacuously today,
    // because a detector that recognises nothing also returns null here.
    const withSlug = detect(['node', 'conduct', 'daemon', 'reconcile-parked', 'some-slug']);
    expect(withSlug).not.toBeNull();
    expect(withSlug?.slug).toBe('some-slug');

    const invalid = detect(['node', 'conduct', 'daemon', 'reconcile-parked']);
    expect(invalid).toMatchObject({ kind: 'reconcile-parked', invalidArgs: true });
    if (!invalid) throw new Error('expected usage dispatch');

    const out: string[] = [];
    const gitSpy = vi.fn(realGit);
    const code = await dispatch(invalid, {
      cwd: projectRoot,
      out: (line: string) => out.push(line),
      runGit: gitSpy,
    });
    expect(code).toBe(1);
    expect(out).toEqual(['Usage: conduct daemon reconcile-parked <slug>']);
    expect(gitSpy).not.toHaveBeenCalled();

    expect(detect(['node', 'conduct', 'daemon'])).toBeNull();
  });

  it('S4 negative (§3d): a slug argument carrying a glob, a path separator, or a comma list is rejected before any git command runs', async () => {
    const gitSpy = vi.fn(realGit);

    for (const badSlug of ['*', 'a/b', 'a,b', '', '../escape']) {
      const outcome = await reconcileMergedPark({
        projectRoot,
        slug: badSlug,
        runGit: gitSpy,
        runGh: fakeGh(() => '[]'),
      });
      expect(outcome.refusal, `slug ${JSON.stringify(badSlug)} must be refused`).toBeTruthy();
      expect(outcome.steps).toEqual([]);
    }

    expect(gitSpy).not.toHaveBeenCalled();
  });

  it('S3 happy: the operator verb still reconciles when auto-cleanup is OFF — the toggle governs the sweep only', async () => {
    const slug = 'verb-beats-toggle';
    await seedParkedFeature(slug, { merged: true, record: true });
    const { detect, dispatch } = await loadReconcileVerb();

    const code = await dispatch(
      detect(['node', 'conduct', 'daemon', 'reconcile-parked', slug]) as { kind: string; slug: string },
      {
        cwd: projectRoot,
        out: () => {},
        runGit: realGit,
        runGh: ghWithMergedPr(slug, 'https://example.test/pr/1'),
        // No autoCleanup is threaded here at all: the verb must not consult it.
      },
    );

    expect(code).toBe(0);
    expect(await worktreeExists(slug)).toBe(false);
    expect(await isOperatorParked(projectRoot, slug)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// rem-adr-006 — PRODUCTION-CALLER wiring (adr-2026-07-27 Decision 4).
//
// The specs above prove the ST-916 hand-off is *injectable*. This one proves it
// is *reachable*: it drives the real `conduct daemon reconcile-parked <slug>`
// operator verb with NO `reconcileMergedPark` fake and NO `requestRecordRepair`
// fake — only the `gh` third-party boundary is faked — and asserts a real
// record-only repair PR is published for a merged park whose record never
// landed, with the park itself left completely untouched.
// ─────────────────────────────────────────────────────────────────────────────

describe('parked-feature reconciliation acceptance (rem-adr-006): the production operator verb reaches the ST-916 repair seam', () => {
  it('publishes a record-only, human-reviewed repair PR and deletes nothing', async () => {
    const slug = 'merged-record-never-landed';
    const implementationPr = 'https://github.com/acme/repo/pull/1060';
    const repairBranch = `shipment-repair/1060/${slug}`;
    const repairPr = 'https://github.com/acme/repo/pull/2000';
    await seedParkedFeature(slug, { merged: true, record: false });

    // Actions supplies GITHUB_REPOSITORY; a long-running daemon does not, so
    // the adapter must resolve the repository from `gh` itself.
    vi.stubEnv('GITHUB_REPOSITORY', '');

    const ghCalls: string[][] = [];
    const gh: GhRunner = async (args, opts) => {
      ghCalls.push(args);
      const json = (value: unknown) => ({ stdout: JSON.stringify(value) });
      const has = (flag: string, value: string) => args[args.indexOf(flag) + 1] === value;

      if (args[0] === 'repo' && args[1] === 'view') return json({ nameWithOwner: 'acme/repo' });
      if (args[0] === 'pr' && args[1] === 'list' && args.includes('--state') && has('--state', 'merged')) {
        return json([{ url: implementationPr }]);
      }
      if (args[0] === 'pr' && args[1] === 'list') return json([]); // no open repair PR yet
      if (args[0] === 'pr' && args[1] === 'view' && args[2] === implementationPr) {
        if (has('--json', 'mergedAt')) return json({ mergedAt: '2026-07-27T10:11:12Z' });
        return json({
          url: implementationPr,
          body: `Implements \`.docs/plans/${slug}.md\``,
          files: [{ path: `src/${slug}.ts` }],
          headRefOid: await git(['rev-parse', `refs/heads/feature/${slug}`]),
        });
      }
      if (args[0] === 'pr' && args[1] === 'view' && args[2] === repairPr) {
        return json({ url: repairPr, headRefOid: await git(['rev-parse', 'HEAD'], opts.cwd) });
      }
      if (args[0] === 'pr' && args[1] === 'create') return { stdout: `${repairPr}\n` };
      // The repair branch does not exist on the remote yet.
      if (args[0] === 'api' && args[1]?.startsWith('repos/')) throw new Error('gh: HTTP 404');
      if (args[0] === 'api') return { stdout: '' }; // status POST
      throw new Error(`unexpected gh invocation: ${args.join(' ')}`);
    };

    const { detect, dispatch } = await loadReconcileVerb();
    const out: string[] = [];
    const code = await dispatch(
      detect(['node', 'conduct', 'daemon', 'reconcile-parked', slug]) as { kind: string; slug: string },
      { cwd: projectRoot, out: (line) => out.push(line), runGit: realGit, runGh: gh },
    );

    // Cleanup is correctly refused and deferred — the record still is not on main.
    expect(code).toBe(1);
    expect(out.join('\n')).toContain(`Could not reconcile '${slug}': record-missing`);
    expect(await worktreeExists(slug)).toBe(true);
    expect(await branchExists(slug)).toBe(true);
    expect(await isOperatorParked(projectRoot, slug)).toBe(true);

    // …but the ST-916 repair seam actually ran: a record-only repair branch is
    // on the remote, carrying exactly the record and naming the REAL merged PR.
    const pushedRecord = (
      await execFile('git', ['show', `${repairBranch}:.docs/shipped/${slug}.md`], { cwd: originDir })
    ).stdout;
    expect(pushedRecord).toContain(`slug: ${slug}`);
    expect(pushedRecord).toContain(`pr: ${implementationPr}`);
    expect(pushedRecord).toContain('shipped: 2026-07-27');
    const pushedPaths = (
      await execFile('git', ['show', '--name-only', '--format=', repairBranch], { cwd: originDir })
    ).stdout.split('\n').filter(Boolean);
    expect(pushedPaths).toEqual([`.docs/shipped/${slug}.md`]);

    // A human-reviewed PR, a required-check status at its exact head, and no
    // merge/auto-merge anywhere.
    const created = ghCalls.find((args) => args[0] === 'pr' && args[1] === 'create');
    expect(created).toBeDefined();
    expect(created).toContain(repairBranch);
    expect(created?.join(' ')).toContain('Human review and merge required');
    expect(ghCalls.some((args) => args.join(' ').includes('statuses/') && args.includes('state=success'))).toBe(true);
    expect(ghCalls.some((args) => args.includes('merge') || args.includes('--auto'))).toBe(false);
    expect(out.some((line) => line.includes(repairPr))).toBe(true);
  });

  it('never invents identity: a PR that does not associate with the slug produces no repair branch and no PR', async () => {
    const slug = 'merged-unassociated-pr';
    const implementationPr = 'https://github.com/acme/repo/pull/1061';
    await seedParkedFeature(slug, { merged: true, record: false });
    vi.stubEnv('GITHUB_REPOSITORY', '');

    const ghCalls: string[][] = [];
    const gh: GhRunner = async (args) => {
      ghCalls.push(args);
      if (args[0] === 'pr' && args[1] === 'list') return { stdout: JSON.stringify([{ url: implementationPr }]) };
      if (args[0] === 'pr' && args[1] === 'view' && args.includes('mergedAt')) {
        return { stdout: JSON.stringify({ mergedAt: '2026-07-27T10:11:12Z' }) };
      }
      if (args[0] === 'pr' && args[1] === 'view') {
        return {
          stdout: JSON.stringify({
            url: implementationPr,
            body: 'Implements `.docs/plans/some-other-feature.md`',
            files: [{ path: 'src/other.ts' }],
            headRefOid: 'a'.repeat(40),
          }),
        };
      }
      if (args[0] === 'repo') return { stdout: JSON.stringify({ nameWithOwner: 'acme/repo' }) };
      throw new Error(`unexpected gh invocation: ${args.join(' ')}`);
    };

    const { detect, dispatch } = await loadReconcileVerb();
    const out: string[] = [];
    const code = await dispatch(
      detect(['node', 'conduct', 'daemon', 'reconcile-parked', slug]) as { kind: string; slug: string },
      { cwd: projectRoot, out: (line) => out.push(line), runGit: realGit, runGh: gh },
    );

    expect(code).toBe(1);
    expect(ghCalls.some((args) => args[0] === 'pr' && args[1] === 'create')).toBe(false);
    expect(await exists(join(projectRoot, '.docs', 'shipped', `${slug}.md`))).toBe(false);
    expect(await worktreeExists(slug)).toBe(true);
    expect(await isOperatorParked(projectRoot, slug)).toBe(true);
    expect(out.some((line) => line.includes('no repair requested'))).toBe(true);
  });
});
