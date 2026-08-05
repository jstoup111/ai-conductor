/**
 * Acceptance specs for jstoup111/ai-conductor#976
 * (2026-07-26-rebased-features-stale-protected-artifact-seal-976).
 *
 * Stories: `.docs/stories/2026-07-26-rebased-features-stale-protected-artifact-seal-976.md`
 * Plan:    `.docs/plans/2026-07-26-rebased-features-stale-protected-artifact-seal-976.md` (Task 1)
 * ADR:     `.docs/decisions/adr-2026-07-26-protected-artifact-seal-rebaseline.md` (APPROVED)
 *
 * ── Why these drive the REAL entry points (writing-system-tests §3b/§3d) ────────
 * The seal predicate has exactly ONE production call site —
 * `conductor.ts:~4016`'s BUILD/SHIP dispatch guard (`verifyProtectedArtifactSeal`)
 * — and the rotation this feature adds has a second one inside `performRebase`,
 * reached only through `Conductor.runRebaseStep`. A unit test that calls a new
 * `rotateProtectedArtifactSeal` directly would pass while the live guard still
 * refuses to dispatch, which is exactly the #254 canary failure. So every spec
 * below drives a real `Conductor.run()` against a real scratch git repo with a
 * real `origin` remote, and asserts the OBSERVABLE artifact: whether the step
 * dispatched, what `.pipeline/protected-artifact-seal.json` holds afterwards,
 * what `.pipeline/HALT` + `.pipeline/HALT.class` say, and which telemetry events
 * were emitted.
 *
 * Real git is required, not a fake GitRunner: the trigger is
 * `git merge-base --is-ancestor` over a genuinely rewritten history, and the
 * permission predicate compares real blobs at HEAD and at `origin/main`.
 *
 * ── ASSUMPTIONS not pinned by the story / plan / ADR (verify-claims) ────────────
 * The ADR pins the seal shape (`version: 2`, append-only
 * `rebaselines[] = { fromCommit, toCommit, trigger, paths[] }`), that rotations
 * and refusals emit telemetry, and that a genuine violation's HALT carries an
 * explicit `haltClass`. It does NOT pin:
 *   1. the telemetry EVENT TYPE names. These specs therefore capture EVERY event
 *      emitted through the conductor's emitter and match on `/rebaselin/` in the
 *      type plus the ADR-pinned payload fields — no invented name is frozen.
 *   2. the `trigger` string values. Asserted only as a non-empty string, and as
 *      DIFFERENT between the proactive (rebase-step) and defensive (verification)
 *      paths, which is what makes the lineage readable.
 *   3. the exact `haltClass` string. Asserted as "not `unclassified`" and as
 *      naming the protected-artifact boundary (`/protected/i`), which is the
 *      story's actual requirement (machine-distinguishable from a stale seal).
 * If BUILD picks different names, these matchers still hold.
 */

import { execFile as execFileCb } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState } from '../../src/types/index.js';
import {
  createProtectedArtifactSeal,
  verifyProtectedArtifactSeal,
  PROTECTED_ARTIFACT_SEAL_PATH,
} from '../../src/engine/protected-artifact-seal.js';
import {
  HALT_CLASS_MARKER,
  HALT_MARKER,
  PROTECTED_ARTIFACT_HALT_CLASS,
  readHaltClass,
} from '../../src/engine/halt-marker.js';

const execFile = promisify(execFileCb);
const indeterminateMergeTreeRepos = vi.hoisted(() => new Set<string>());

// The fixture can make only the prospective finish assessment indeterminate.
// It deliberately delegates every other command to real Git, including the
// rebase whose seal rebaseline behavior these acceptance cases assert.
vi.mock('execa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('execa')>();
  return {
    ...actual,
    execa: (...args: any[]) => {
      const [command, gitArgs, options] = args;
      if (
        command === 'git' &&
        Array.isArray(gitArgs) &&
        gitArgs[0] === 'merge-tree' &&
        indeterminateMergeTreeRepos.has(String(options?.cwd ?? ''))
      ) {
        return Promise.resolve({
          exitCode: 128,
          stdout: '',
          stderr: 'fixture: prospective merge assessment unavailable',
        }) as unknown as ReturnType<typeof actual.execa>;
      }
      return (actual.execa as (...argv: any[]) => ReturnType<typeof actual.execa>)(...args);
    },
  };
});

/** This feature's own slug — the `feature_desc` a real daemon run carries. */
const FEATURE = '2026-07-26-rebased-features-stale-protected-artifact-seal-976';

/**
 * The exact protected path from the #254 canary (2026-07-26): the daemon
 * refused with `Protected artifact changed: <this>` while
 * `git diff origin/main..HEAD -- <this>` produced no output.
 */
const CANARY_PATH = '.docs/architecture/2026-06-30-harness-self-host-guardrails.md';
const OTHER_PLAN = '.docs/plans/other-feature.md';
const OWN_STORIES = `.docs/stories/${FEATURE}.md`;
const INHERITED_PLAN = '.docs/plans/build-tasks-can-amend-protected-docs-artifacts-ame.md';
const INHERITED_REVISION_FEATURE = 'build-halts-when-a-branch-inherits-an-older-revisi';

function sha256(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

interface Scratch {
  repo: string;
  origin: string;
  g: (args: string[]) => Promise<{ stdout: string; stderr: string }>;
}

const scratches: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  while (scratches.length > 0) {
    await rm(scratches.pop()!, { recursive: true, force: true });
  }
});

async function writeRepoFile(repo: string, path: string, content: string): Promise<void> {
  const destination = join(repo, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content, 'utf8');
}

/**
 * A faithful feature worktree: `main` carrying approved DECIDE artifacts, a
 * `feat` branch with one code commit on top, and a real bare `origin` so
 * `origin/main` resolves exactly as it does in a daemon worktree.
 */
async function makeFeatureRepo(): Promise<Scratch> {
  const origin = await mkdtemp(join(tmpdir(), 'seal-976-origin-'));
  scratches.push(origin);
  await execFile('git', ['init', '-q', '--bare', '-b', 'main', origin]);

  const repo = await mkdtemp(join(tmpdir(), 'seal-976-'));
  scratches.push(repo);
  const g = (args: string[]) => execFile('git', args, { cwd: repo });

  await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  await g(['config', 'user.email', 't@t.com']);
  await g(['config', 'user.name', 'T']);
  await g(['config', 'commit.gpgsign', 'false']);
  await g(['remote', 'add', 'origin', origin]);

  // A real feature worktree ignores generated pipeline state; without this the
  // fixture's own `git add -A` on `main` would TRACK the seal and a later
  // checkout would delete it, which is a fixture artifact, not the behavior
  // under test.
  await writeRepoFile(repo, '.gitignore', '.pipeline/\nconduct-state.json\n');
  await writeRepoFile(repo, 'base.ts', 'base\n');
  await writeRepoFile(repo, CANARY_PATH, 'guardrails v1\n');
  await writeRepoFile(repo, OTHER_PLAN, 'other plan v1\n');
  await writeRepoFile(repo, OWN_STORIES, 'own stories v1\n');
  await g(['add', '.']);
  await g(['commit', '-q', '-m', 'approved decide artifacts']);
  await g(['push', '-q', 'origin', 'main']);

  await g(['checkout', '-q', '-b', 'feat']);
  await writeRepoFile(repo, 'src/feature.ts', 'feature work\n');
  await g(['add', '.']);
  await g(['commit', '-q', '-m', 'feat: work']);

  return { repo, origin, g };
}

/**
 * Advance `main` (and `origin/main`) with `files`, then return to `feat`.
 * `null` content deletes the path — the base-branch deletion case in ST-976-2.
 */
async function advanceMain(
  scratch: Scratch,
  files: Record<string, string | null>,
  message = 'main: advance',
): Promise<string> {
  const { repo, g } = scratch;
  await g(['checkout', '-q', 'main']);
  for (const [path, content] of Object.entries(files)) {
    if (content === null) await unlink(join(repo, path));
    else await writeRepoFile(repo, path, content);
  }
  await g(['add', '-A']);
  await g(['commit', '-q', '-m', message]);
  const sha = (await g(['rev-parse', 'HEAD'])).stdout.trim();
  await g(['push', '-q', 'origin', 'main']);
  await g(['fetch', '-q', 'origin']);
  await g(['checkout', '-q', 'feat']);
  return sha;
}

async function head(scratch: Scratch): Promise<string> {
  return (await scratch.g(['rev-parse', 'HEAD'])).stdout.trim();
}

interface SealFile {
  version: number;
  baselineCommit: string;
  protectedArtifacts: { path: string; fingerprint: string }[];
  rebaselines?: { fromCommit: string; toCommit: string; trigger: string; paths: string[] }[];
}

async function readSealRaw(repo: string): Promise<string> {
  return readFile(join(repo, PROTECTED_ARTIFACT_SEAL_PATH), 'utf8');
}

async function readSeal(repo: string): Promise<SealFile> {
  return JSON.parse(await readSealRaw(repo)) as SealFile;
}

function fingerprintFor(seal: SealFile, path: string): string | undefined {
  return seal.protectedArtifacts.find((a) => a.path === path)?.fingerprint;
}

async function pathExists(p: string): Promise<boolean> {
  return readFile(p, 'utf8').then(
    () => true,
    () => false,
  );
}

/**
 * Records EVERY event the conductor emits, so specs can match a rotation /
 * refusal event on its ADR-pinned payload without freezing an invented type
 * name (see ASSUMPTIONS in the file header).
 */
type CapturedEvent = Record<string, unknown> & { type: string };
function captureEvents(events: ConductorEventEmitter): CapturedEvent[] {
  const seen: CapturedEvent[] = [];
  const original = events.emit.bind(events);
  vi.spyOn(events, 'emit').mockImplementation(async (event) => {
    seen.push(event as unknown as CapturedEvent);
    return original(event);
  });
  return seen;
}

function rebaselineEvents(seen: CapturedEvent[]): CapturedEvent[] {
  return seen.filter((e) => /rebaselin/i.test(e.type));
}

/** Seeds state so a real `Conductor.run({ fromStep: 'rebase' })` enters at rebase and stops after it. */
async function seedPreRebaseState(statePath: string): Promise<void> {
  const state: ConductState = { feature_desc: FEATURE } as ConductState;
  for (const s of ALL_STEPS) {
    if (s.name === 'rebase') break;
    (state as Record<string, unknown>)[s.name] = s.name === 'retro' ? 'skipped' : 'done';
  }
  // The subject is the rebase step's seal handling; keeping `finish` pending
  // would drag in unrelated SHIP publication validation.
  state.finish = 'done';
  await writeState(statePath, state);
}

interface RunResult {
  dispatched: string[];
  events: CapturedEvent[];
  logLines: string[];
}

/** Drives the SHIP-phase rebase step: a real `Conductor.run({ fromStep: 'rebase' })`, daemon mode. */
async function runRebaseStep(
  repo: string,
  { forceIndeterminateProspectiveMerge = false }: { forceIndeterminateProspectiveMerge?: boolean } = {},
): Promise<RunResult> {
  const statePath = join(repo, 'conduct-state.json');
  await seedPreRebaseState(statePath);
  const events = new ConductorEventEmitter();
  const seen = captureEvents(events);
  const dispatched: string[] = [];
  const logLines: string[] = [];
  const runner: StepRunner = {
    run: async (step) => {
      dispatched.push(step);
      return { success: true } satisfies StepRunResult;
    },
  };
  const conductor = new Conductor({
    stateFilePath: statePath,
    stepRunner: runner,
    events,
    projectRoot: repo,
    log: (line: string) => logLines.push(line),
    daemon: true,
    mode: 'auto',
    fromStep: 'rebase',
    // The real daemon always supplies the base branch (daemon-cli.ts:985).
    baseBranch: 'main',
  } as never);
  if (forceIndeterminateProspectiveMerge) indeterminateMergeTreeRepos.add(repo);
  try {
    await conductor.run();
  } finally {
    indeterminateMergeTreeRepos.delete(repo);
  }
  return { dispatched, events: seen, logLines };
}

/**
 * Drives the BUILD-phase dispatch guard: a real `Conductor.run({ fromStep: 'build' })`.
 * This is the site that emitted the #254 canary refusal.
 */
async function runBuildStep(
  repo: string,
  maxRetries = 1,
  featureDesc = FEATURE,
): Promise<RunResult> {
  const statePath = join(repo, 'conduct-state.json');
  await writeState(statePath, { plan: 'done', feature_desc: featureDesc } as ConductState);
  const events = new ConductorEventEmitter();
  const seen = captureEvents(events);
  const dispatched: string[] = [];
  const logLines: string[] = [];
  const runner: StepRunner = {
    run: async (step) => {
      dispatched.push(step);
      // Stop the loop right after the guard has had its say.
      return { success: false, output: 'expected stop after BUILD dispatch' } satisfies StepRunResult;
    },
  };
  const conductor = new Conductor({
    stateFilePath: statePath,
    stepRunner: runner,
    events,
    projectRoot: repo,
    log: (line: string) => logLines.push(line),
    config: {} as never,
    fromStep: 'build',
    mode: 'default',
    maxRetries,
    baseBranch: 'main',
  } as never);
  await conductor.run();
  return { dispatched, events: seen, logLines };
}

// ─────────────────────────────────────────────────────────────────────────────
// ST-976-1 — A clean engine rebase rebaselines the seal in the same operation
// ─────────────────────────────────────────────────────────────────────────────

// #1315 Story 1. Production call site: Conductor.run() BUILD dispatch guard.
describe('#1315 Story 1: BUILD accepts an older protected artifact this branch never touched', () => {
  async function makeInheritedRevisionFixture(): Promise<Scratch> {
    const scratch = await makeFeatureRepo();
    const baselineBeforePlanArrived = (await scratch.g(['rev-parse', 'main'])).stdout.trim();
    await createProtectedArtifactSeal({
      projectRoot: scratch.repo,
      baselineCommit: baselineBeforePlanArrived,
    });

    await advanceMain(scratch, { [INHERITED_PLAN]: 'accepted revision A\n' }, 'main: add plan');
    await scratch.g(['rebase', '-q', 'origin/main']);
    await advanceMain(scratch, { [INHERITED_PLAN]: 'amended revision B\n' }, 'main: amend plan');

    expect(await readFile(join(scratch.repo, INHERITED_PLAN), 'utf8')).toBe(
      'accepted revision A\n',
    );
    expect(
      (await scratch.g(['diff', '--name-only', 'origin/main...HEAD', '--', INHERITED_PLAN])).stdout,
    ).toBe('');
    return scratch;
  }

  it(
    'happy: the BUILD step dispatches and writes no HALT when the base amends an inherited plan after the merge-base',
    async () => {
      const scratch = await makeInheritedRevisionFixture();

      const { dispatched, events, logLines } = await runBuildStep(
        scratch.repo,
        1,
        INHERITED_REVISION_FEATURE,
      );

      expect(logLines.join('\n')).not.toContain(`Protected artifact added: ${INHERITED_PLAN}`);
      expect(JSON.stringify(events)).not.toContain(`Protected artifact added: ${INHERITED_PLAN}`);
      expect(dispatched).toContain('build');
      expect(await pathExists(join(scratch.repo, HALT_MARKER))).toBe(false);
    },
    30000,
  );

  it(
    'negative: a committed edit to that inherited plan still halts with the protected-artifact class',
    async () => {
      const scratch = await makeInheritedRevisionFixture();
      await writeRepoFile(scratch.repo, INHERITED_PLAN, 'tampered by this feature\n');
      await scratch.g(['add', INHERITED_PLAN]);
      await scratch.g(['commit', '-q', '-m', 'build: tamper with inherited plan']);

      const { dispatched } = await runBuildStep(
        scratch.repo,
        2,
        INHERITED_REVISION_FEATURE,
      );

      expect(dispatched).toEqual([]);
      expect(await readFile(join(scratch.repo, HALT_CLASS_MARKER), 'utf8')).toBe(
        PROTECTED_ARTIFACT_HALT_CLASS,
      );
    },
    30000,
  );
});

describe('ST-976-1: the SHIP rebase step rebaselines the seal in the same operation', () => {
  it(
    'happy: re-anchors baselineCommit + fingerprints to the post-rebase HEAD, and the next BUILD/SHIP attempt verifies ok',
    async () => {
      const scratch = await makeFeatureRepo();
      const { repo } = scratch;
      const preRebaseHead = await head(scratch);
      await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit: preRebaseHead });
      await advanceMain(scratch, { [CANARY_PATH]: 'guardrails v2\n', 'unrelated.ts': 'main1\n' });

      await runRebaseStep(repo, { forceIndeterminateProspectiveMerge: true });

      const postRebaseHead = await head(scratch);
      expect(postRebaseHead).not.toBe(preRebaseHead); // sanity: a real rebase ran
      const seal = await readSeal(repo);

      expect(seal.baselineCommit).toBe(postRebaseHead);
      expect(fingerprintFor(seal, CANARY_PATH)).toBe(sha256('guardrails v2\n'));
      await expect(
        verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: FEATURE, baseBranch: 'main' }),
      ).resolves.toMatchObject({ ok: true });
    },
    30000,
  );

  it(
    'happy: appends a rebaselines[] entry recording fromCommit, toCommit, trigger and the re-anchored paths, preserving pre-existing entries',
    async () => {
      const scratch = await makeFeatureRepo();
      const { repo } = scratch;
      const preRebaseHead = await head(scratch);
      await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit: preRebaseHead });

      // A seal that has already rotated once. Written in the ADR's v2 shape so
      // the append is observably an APPEND, not a replace.
      const seeded = await readSeal(repo);
      const priorEntry = {
        fromCommit: '0'.repeat(40),
        toCommit: preRebaseHead,
        trigger: 'seeded-prior-rotation',
        paths: [OTHER_PLAN],
      };
      await writeFile(
        join(repo, PROTECTED_ARTIFACT_SEAL_PATH),
        `${JSON.stringify({ ...seeded, version: 2, rebaselines: [priorEntry] }, null, 2)}\n`,
        'utf8',
      );

      await advanceMain(scratch, { [CANARY_PATH]: 'guardrails v2\n', 'unrelated.ts': 'main1\n' });

      await runRebaseStep(repo, { forceIndeterminateProspectiveMerge: true });

      const postRebaseHead = await head(scratch);
      const seal = await readSeal(repo);
      expect(seal.version).toBe(2);
      expect(seal.rebaselines?.[0]).toEqual(priorEntry);
      expect(seal.rebaselines).toHaveLength(2);
      expect(seal.rebaselines?.[1]).toEqual({
        fromCommit: preRebaseHead,
        toCommit: postRebaseHead,
        trigger: expect.stringMatching(/\S/),
        paths: expect.arrayContaining([CANARY_PATH]),
      });
    },
    30000,
  );

  it(
    'happy: a `noop` rebase (base unchanged) leaves the seal byte-for-byte identical with no rotation entry',
    async () => {
      const scratch = await makeFeatureRepo();
      const { repo } = scratch;
      await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit: await head(scratch) });
      const before = await readSealRaw(repo);

      await runRebaseStep(repo);

      expect(await readSealRaw(repo)).toBe(before);
      expect((await readSeal(repo)).rebaselines ?? []).toEqual([]);
    },
    30000,
  );

  it(
    'negative: a seal that ALREADY fails verification is never laundered by the rebase — no rotation, no rebase, refusal stands',
    async () => {
      const scratch = await makeFeatureRepo();
      const { repo } = scratch;
      const preRebaseHead = await head(scratch);
      await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit: preRebaseHead });
      await advanceMain(scratch, { [CANARY_PATH]: 'guardrails v2\n', 'unrelated.ts': 'main1\n' });
      // A BUILD agent edited another feature's approved plan. Written AFTER the
      // base advance so the tampering exists ONLY in this worktree — the base
      // branch must never vouch for it.
      await writeRepoFile(repo, OTHER_PLAN, 'tampered during BUILD\n');
      const before = await readSealRaw(repo);

      const { events } = await runRebaseStep(repo);

      expect(await readSealRaw(repo)).toBe(before);
      expect(await head(scratch)).toBe(preRebaseHead); // the rebase never ran
      expect(JSON.stringify(events)).toContain(`Protected artifact changed: ${OTHER_PLAN}`);
    },
    30000,
  );

  it(
    'negative: a `conflict_halt` rebase leaves the seal unrotated, so a half-applied history never becomes the baseline',
    async () => {
      const scratch = await makeFeatureRepo();
      const { repo } = scratch;
      const preRebaseHead = await head(scratch);
      await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit: preRebaseHead });
      // `main` adds the SAME path the feature added, with different content →
      // an add/add conflict that halts the rebase mid-flight.
      await advanceMain(scratch, {
        'src/feature.ts': 'base-authored conflicting content\n',
        [CANARY_PATH]: 'guardrails v2\n',
      });
      const before = await readSealRaw(repo);

      await runRebaseStep(repo);

      expect(await readSealRaw(repo)).toBe(before);
    },
    30000,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ST-976-2 — A resumed feature recovers from a seal stranded by a history rewrite
// ─────────────────────────────────────────────────────────────────────────────

describe('ST-976-2: verification recovers a seal stranded by a history rewrite', () => {
  it(
    'happy (#254 canary shape): a non-ancestor baseline whose divergence is fully inherited from origin/main rotates and the BUILD step dispatches',
    async () => {
      const scratch = await makeFeatureRepo();
      const { repo, g } = scratch;
      const strandedBaseline = await head(scratch);
      await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit: strandedBaseline });
      const currentSeal = await readSeal(repo);
      await writeFile(
        join(repo, PROTECTED_ARTIFACT_SEAL_PATH),
        `${JSON.stringify({
          version: 1,
          baselineCommit: currentSeal.baselineCommit,
          protectedArtifacts: currentSeal.protectedArtifacts,
        }, null, 2)}\n`,
      );
      const v1Seal = await readSeal(repo);
      expect(v1Seal.version).toBe(1); // the pre-change on-disk shape, upgraded below

      await advanceMain(scratch, { [CANARY_PATH]: 'guardrails v2\n', 'unrelated.ts': 'main1\n' });
      // Rebased OUTSIDE the engine — the canary's situation, and the situation of
      // any worktree already halted before this change shipped.
      await g(['rebase', '-q', 'origin/main']);

      const rewrittenHead = await head(scratch);
      // The canary's defining evidence: baseline off-history, yet no diff for the
      // reported path against origin/main.
      await expect(
        g(['merge-base', '--is-ancestor', strandedBaseline, rewrittenHead]),
      ).rejects.toBeTruthy();
      expect((await g(['diff', 'origin/main..HEAD', '--', CANARY_PATH])).stdout).toBe('');

      const { dispatched, events } = await runBuildStep(repo);

      expect(dispatched).toContain('build');
      expect(await pathExists(join(repo, HALT_MARKER))).toBe(false);

      const seal = await readSeal(repo);
      expect(seal.version).toBe(2); // v1 read and upgraded in place (ST-976-4)
      expect(seal.baselineCommit).toBe(rewrittenHead);
      expect(fingerprintFor(seal, CANARY_PATH)).toBe(sha256('guardrails v2\n'));
      expect(seal.rebaselines?.at(-1)).toEqual({
        fromCommit: strandedBaseline,
        toCommit: rewrittenHead,
        trigger: expect.stringMatching(/\S/),
        paths: expect.arrayContaining([CANARY_PATH]),
      });

      // ST-976-4: the rotation is observable as a rebaseline, not a failure.
      const rotations = rebaselineEvents(events);
      expect(rotations).toHaveLength(1);
      expect(rotations[0]).toMatchObject({
        fromCommit: strandedBaseline,
        toCommit: rewrittenHead,
        trigger: expect.stringMatching(/\S/),
        paths: expect.arrayContaining([CANARY_PATH]),
      });
    },
    30000,
  );

  it(
    'happy: a protected path the base branch DELETED or ADDED re-anchors to the current set instead of firing the deleted/added refusals',
    async () => {
      const scratch = await makeFeatureRepo();
      const { repo, g } = scratch;
      const strandedBaseline = await head(scratch);
      await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit: strandedBaseline });

      const addedPath = '.docs/plans/newly-merged-feature.md';
      await advanceMain(scratch, {
        [OTHER_PLAN]: null, // base deleted a sealed path
        [addedPath]: 'newly merged plan\n', // base added an unsealed one
      });
      await g(['rebase', '-q', 'origin/main']);

      const { dispatched } = await runBuildStep(repo);

      expect(dispatched).toContain('build');
      const seal = await readSeal(repo);
      expect(seal.baselineCommit).toBe(await head(scratch));
      expect(seal.protectedArtifacts.map((a) => a.path).sort()).toEqual(
        [CANARY_PATH, addedPath, OWN_STORIES].sort(),
      );
      expect(seal.rebaselines?.at(-1)?.paths).toEqual(
        expect.arrayContaining([OTHER_PLAN, addedPath]),
      );
    },
    30000,
  );

  it(
    'negative: a baseline that IS an ancestor of HEAD never rotates — same-history resealing stays forbidden even after HEAD advances',
    async () => {
      const scratch = await makeFeatureRepo();
      const { repo, g } = scratch;
      const baseline = await head(scratch);
      await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit: baseline });
      const before = await readSealRaw(repo);

      // Ordinary commits on the SAME history: HEAD advances, baseline stays an
      // ancestor, and a protected artifact is mutated.
      await writeRepoFile(repo, OTHER_PLAN, 'mutated on the same history\n');
      await g(['add', '-A']);
      await g(['commit', '-q', '-m', 'build: edit another feature plan']);
      await expect(
        g(['merge-base', '--is-ancestor', baseline, await head(scratch)]),
      ).resolves.toBeTruthy();

      const { dispatched } = await runBuildStep(repo, 2);

      expect(dispatched).toEqual([]);
      expect(await readSealRaw(repo)).toBe(before);
      expect(await readFile(join(repo, HALT_MARKER), 'utf8')).toContain(
        `Protected artifact changed: ${OTHER_PLAN}`,
      );
    },
    30000,
  );

  it(
    'negative: an unresolvable baseline object is an indeterminate fail-closed refusal with its own reason — never "rewritten, therefore rotatable"',
    async () => {
      const scratch = await makeFeatureRepo();
      const { repo } = scratch;
      await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit: await head(scratch) });
      // Garbage-collected / missing baseline object: well-formed sha, absent from
      // the object database. Its fingerprints are otherwise intact.
      const seal = await readSeal(repo);
      const missingBaseline = 'd'.repeat(40);
      await writeFile(
        join(repo, PROTECTED_ARTIFACT_SEAL_PATH),
        `${JSON.stringify({ ...seal, baselineCommit: missingBaseline }, null, 2)}\n`,
        'utf8',
      );
      // Drift that WOULD otherwise be provably inherited, so only the
      // unresolvable baseline can explain the refusal.
      await writeRepoFile(repo, CANARY_PATH, 'guardrails v2\n');

      const verdict = await verifyProtectedArtifactSeal({
        projectRoot: repo,
        featureDesc: FEATURE,
        baseBranch: 'main',
      });

      expect(verdict.ok).toBe(false);
      expect((verdict as { reason: string }).reason).toMatch(/baseline/i);
      expect((await readSeal(repo)).baselineCommit).toBe(missingBaseline); // unrotated
    },
    30000,
  );

  it(
    'negative: an unresolvable base tip refuses rotation and preserves the pre-existing failure — never rotate on a comparison that could not be made',
    async () => {
      const scratch = await makeFeatureRepo();
      const { repo, g } = scratch;
      const strandedBaseline = await head(scratch);
      await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit: strandedBaseline });
      await advanceMain(scratch, { [CANARY_PATH]: 'guardrails v2\n' });
      await g(['rebase', '-q', 'origin/main']);
      const before = await readSealRaw(repo);

      // Remove every ref that could answer "what does the base tip hold?".
      await g(['remote', 'remove', 'origin']);
      await g(['branch', '-q', '-D', 'main']);

      const verdict = await verifyProtectedArtifactSeal({
        projectRoot: repo,
        featureDesc: FEATURE,
        baseBranch: 'main',
      });

      expect(verdict).toEqual({ ok: false, reason: `Protected artifact changed: ${CANARY_PATH}` });
      expect(await readSealRaw(repo)).toBe(before);
    },
    30000,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ST-976-3 — A feature-authored mutation still blocks, across a rebase
// ─────────────────────────────────────────────────────────────────────────────

describe('ST-976-3: a feature-authored mutation still blocks across a rebase', () => {
  it(
    'classifies a genuine feature-authored protected-artifact violation',
    async () => {
      const scratch = await makeFeatureRepo();
      const { repo, g } = scratch;
      await writeRepoFile(repo, OTHER_PLAN, 'feature-authored edit\n');
      await g(['add', '-A']);
      await g(['commit', '-q', '-m', 'build: edit an approved plan']);
      const strandedBaseline = (await g(['rev-parse', 'HEAD~1'])).stdout.trim();
      await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit: strandedBaseline });
      await advanceMain(scratch, { 'unrelated.ts': 'main1\n' });
      await g(['rebase', '-q', 'origin/main']);

      await runBuildStep(repo, 2);

      expect([PROTECTED_ARTIFACT_HALT_CLASS, await readHaltClass(repo)]).toEqual([
        'protected-artifact',
        'protected-artifact',
      ]);
    },
    30000,
  );

  it(
    'happy: a committed edit to a DECIDE artifact refuses rotation after a rebase, naming the path and identifying it as feature-authored',
    async () => {
      const scratch = await makeFeatureRepo();
      const { repo, g } = scratch;
      // The BUILD agent commits an edit to an approved plan...
      await writeRepoFile(repo, OTHER_PLAN, 'feature-authored edit\n');
      await g(['add', '-A']);
      await g(['commit', '-q', '-m', 'build: edit an approved plan']);
      const strandedBaseline = (await g(['rev-parse', 'HEAD~1'])).stdout.trim();
      await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit: strandedBaseline });

      // ...and then rewrites history, hoping the rebase adopts it as the baseline.
      await advanceMain(scratch, { 'unrelated.ts': 'main1\n' });
      await g(['rebase', '-q', 'origin/main']);
      const before = await readSealRaw(repo);

      const { dispatched, events } = await runBuildStep(repo, 2);

      expect(dispatched).toEqual([]);
      expect(await readSealRaw(repo)).toBe(before);

      const halt = await readFile(join(repo, HALT_MARKER), 'utf8');
      expect(halt).toContain(OTHER_PLAN);
      expect(halt).toMatch(/feature-authored/i);

      // ST-976-4: the refusal states WHICH condition failed and names the path.
      const refusals = rebaselineEvents(events);
      expect(refusals).toHaveLength(1);
      expect(refusals[0]).toMatchObject({
        condition: expect.stringMatching(/feature-authored/i),
        path: OTHER_PLAN,
      });

      // ST-976-4 negative: the HALT is machine-distinguishable from a stale seal.
      expect(await readHaltClass(repo)).not.toBe('unclassified');
      expect(await readFile(join(repo, HALT_CLASS_MARKER), 'utf8')).toMatch(/protected/i);
    },
    30000,
  );

  it(
    'happy: a mixed worktree — one inherited path, one feature-authored — refuses as a whole and names the feature-authored path',
    async () => {
      const scratch = await makeFeatureRepo();
      const { repo, g } = scratch;
      await writeRepoFile(repo, OTHER_PLAN, 'feature-authored edit\n');
      await g(['add', '-A']);
      await g(['commit', '-q', '-m', 'build: edit an approved plan']);
      const strandedBaseline = (await g(['rev-parse', 'HEAD~1'])).stdout.trim();
      await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit: strandedBaseline });

      // CANARY_PATH is legitimately inherited; OTHER_PLAN is not.
      await advanceMain(scratch, { [CANARY_PATH]: 'guardrails v2\n' });
      await g(['rebase', '-q', 'origin/main']);
      const before = await readSealRaw(repo);

      const verdict = await verifyProtectedArtifactSeal({
        projectRoot: repo,
        featureDesc: FEATURE,
        baseBranch: 'main',
      });

      expect(verdict.ok).toBe(false);
      expect((verdict as { reason: string }).reason).toContain(OTHER_PLAN);
      expect((verdict as { reason: string }).reason).toMatch(/feature-authored/i);
      expect(await readSealRaw(repo)).toBe(before);
    },
    30000,
  );

  it(
    'negative: an UNCOMMITTED protected-artifact edit refuses rotation (workspace bytes ≠ blob at HEAD) and the existing refusal stands',
    async () => {
      const scratch = await makeFeatureRepo();
      const { repo, g } = scratch;
      const strandedBaseline = await head(scratch);
      await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit: strandedBaseline });
      await advanceMain(scratch, { [CANARY_PATH]: 'guardrails v2\n' });
      await g(['rebase', '-q', 'origin/main']);
      // Non-ancestor baseline, and an edit that lives ONLY in the working tree —
      // so it can never be explained by the blob at HEAD or at the base tip.
      await writeRepoFile(repo, OTHER_PLAN, 'uncommitted working-tree edit\n');
      const before = await readSealRaw(repo);

      const verdict = await verifyProtectedArtifactSeal({
        projectRoot: repo,
        featureDesc: FEATURE,
        baseBranch: 'main',
      });

      expect(verdict.ok).toBe(false);
      expect((verdict as { reason: string }).reason).toContain(OTHER_PLAN);
      expect(await readSealRaw(repo)).toBe(before);
    },
    30000,
  );

  it(
    'negative: a protected artifact replaced by a symlink outside the workspace keeps the indeterminate fail-closed refusal and attempts no rotation',
    async () => {
      const scratch = await makeFeatureRepo();
      const { repo, g } = scratch;
      const strandedBaseline = await head(scratch);
      await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit: strandedBaseline });
      await advanceMain(scratch, { [CANARY_PATH]: 'guardrails v2\n' });
      await g(['rebase', '-q', 'origin/main']);

      const outside = await mkdtemp(join(tmpdir(), 'seal-976-outside-'));
      scratches.push(outside);
      await writeFile(join(outside, 'smuggled.md'), 'content from outside the workspace\n', 'utf8');
      await unlink(join(repo, OTHER_PLAN));
      const { symlink: makeSymlink } = await import('node:fs/promises');
      await makeSymlink(join(outside, 'smuggled.md'), join(repo, OTHER_PLAN));
      const before = await readSealRaw(repo);

      const verdict = await verifyProtectedArtifactSeal({
        projectRoot: repo,
        featureDesc: FEATURE,
        baseBranch: 'main',
      });

      expect(verdict).toEqual({
        ok: false,
        reason: `Indeterminate protected artifact target: ${OTHER_PLAN}`,
      });
      expect(await readSealRaw(repo)).toBe(before);
    },
    30000,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ST-976-4 — The daemon log distinguishes a stale seal from a real mutation
// ─────────────────────────────────────────────────────────────────────────────

describe('ST-976-4: rotations, refusals and halts are machine-distinguishable', () => {
  it(
    'ST-976-4 proactive rebase rotation log carries the rebaseline marker, lineage commits, trigger, and changed path',
    async () => {
      const scratch = await makeFeatureRepo();
      const fromCommit = await head(scratch);
      await createProtectedArtifactSeal({
        projectRoot: scratch.repo,
        baselineCommit: fromCommit,
      });
      await advanceMain(scratch, { [CANARY_PATH]: 'guardrails v2\n', 'unrelated.ts': 'a\n' });

      const { logLines } = await runRebaseStep(scratch.repo, {
        forceIndeterminateProspectiveMerge: true,
      });
      const toCommit = await head(scratch);
      const rotationLine = logLines.find((line) => /protected artifact rebaseline/i.test(line));

      expect({
        marker: rotationLine,
        hasTrigger: rotationLine?.includes('trigger=proactive-rebase'),
        hasFromCommit: rotationLine?.includes(`fromCommit=${fromCommit}`),
        hasToCommit: rotationLine?.includes(`toCommit=${toCommit}`),
        hasChangedPath: rotationLine?.includes(CANARY_PATH),
      }).toMatchObject({
        marker: expect.stringMatching(/protected artifact rebaseline/i),
        hasTrigger: true,
        hasFromCommit: true,
        hasToCommit: true,
        hasChangedPath: true,
      });
    },
    30000,
  );

  it(
    'ST-976-4 feature-authored refusal log carries the rotation-refused marker, condition, and offending path',
    async () => {
      const scratch = await makeFeatureRepo();
      const { repo, g } = scratch;
      await writeRepoFile(repo, OTHER_PLAN, 'feature-authored edit\n');
      await g(['add', '-A']);
      await g(['commit', '-q', '-m', 'build: edit an approved plan']);
      const strandedBaseline = (await g(['rev-parse', 'HEAD~1'])).stdout.trim();
      await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit: strandedBaseline });
      await advanceMain(scratch, { 'unrelated.ts': 'main1\n' });
      await g(['rebase', '-q', 'origin/main']);

      const { logLines } = await runBuildStep(repo, 2);
      const refusalLine = logLines.find((line) => /rotation refused/i.test(line));

      expect({
        marker: refusalLine,
        hasFeatureAuthoredCondition: /condition=.*feature-authored/i.test(refusalLine ?? ''),
        hasOffendingPath: refusalLine?.includes(`path=${OTHER_PLAN}`),
      }).toMatchObject({
        marker: expect.stringMatching(/protected artifact rotation refused/i),
        hasFeatureAuthoredCondition: true,
        hasOffendingPath: true,
      });
    },
    30000,
  );

  it(
    'happy: the proactive (rebase-step) and defensive (verification) rotations record DIFFERENT triggers in both the event and the lineage entry',
    async () => {
      const proactive = await makeFeatureRepo();
      await createProtectedArtifactSeal({
        projectRoot: proactive.repo,
        baselineCommit: await head(proactive),
      });
      await advanceMain(proactive, { [CANARY_PATH]: 'guardrails v2\n', 'unrelated.ts': 'a\n' });
      const proactiveRun = await runRebaseStep(proactive.repo, {
        forceIndeterminateProspectiveMerge: true,
      });
      const proactiveEvents = rebaselineEvents(proactiveRun.events);

      const defensive = await makeFeatureRepo();
      await createProtectedArtifactSeal({
        projectRoot: defensive.repo,
        baselineCommit: await head(defensive),
      });
      await advanceMain(defensive, { [CANARY_PATH]: 'guardrails v2\n', 'unrelated.ts': 'a\n' });
      await defensive.g(['rebase', '-q', 'origin/main']);
      const defensiveRun = await runBuildStep(defensive.repo);
      const defensiveEvents = rebaselineEvents(defensiveRun.events);

      expect(proactiveEvents).toHaveLength(1);
      expect(defensiveEvents).toHaveLength(1);
      const proactiveTrigger = proactiveEvents[0].trigger as string;
      const defensiveTrigger = defensiveEvents[0].trigger as string;
      expect(proactiveTrigger).toMatch(/\S/);
      expect(defensiveTrigger).toMatch(/\S/);
      expect(proactiveTrigger).not.toBe(defensiveTrigger);

      // The lineage entry records the same trigger the event announced.
      expect((await readSeal(proactive.repo)).rebaselines?.at(-1)?.trigger).toBe(proactiveTrigger);
      expect((await readSeal(defensive.repo)).rebaselines?.at(-1)?.trigger).toBe(defensiveTrigger);
    },
    60000,
  );

  it(
    'happy: a refusal caused by an unresolvable base tip states THAT condition, distinct from the feature-authored condition',
    async () => {
      const scratch = await makeFeatureRepo();
      const { repo, g } = scratch;
      await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit: await head(scratch) });
      await advanceMain(scratch, { [CANARY_PATH]: 'guardrails v2\n' });
      await g(['rebase', '-q', 'origin/main']);
      await g(['remote', 'remove', 'origin']);
      await g(['branch', '-q', '-D', 'main']);

      const { events } = await runBuildStep(repo, 2);

      const refusals = rebaselineEvents(events);
      expect(refusals).toHaveLength(1);
      expect(refusals[0].condition).toMatch(/base.?tip|base.?branch/i);
      expect(refusals[0].condition).not.toMatch(/feature-authored/i);
    },
    30000,
  );

  it(
    'negative: a malformed seal still throws `Protected artifact seal is invalid`, exactly as today',
    async () => {
      const scratch = await makeFeatureRepo();
      const { repo } = scratch;
      await mkdir(join(repo, '.pipeline'), { recursive: true });
      await writeFile(
        join(repo, PROTECTED_ARTIFACT_SEAL_PATH),
        JSON.stringify({ version: 2, baselineCommit: 42 }),
        'utf8',
      );

      await expect(
        verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: FEATURE, baseBranch: 'main' }),
      ).rejects.toThrow('Protected artifact seal is invalid');
    },
    30000,
  );
});
