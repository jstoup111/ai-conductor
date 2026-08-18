/**
 * Acceptance specs for feature-aware step artifact resolution
 * (jstoup111/ai-conductor#993,
 *  .docs/stories/step-completion-globs-are-feature-unscoped-so-anot.md,
 *  .docs/decisions/adr-2026-07-28-feature-aware-artifact-resolution.md,
 *  .docs/plans/step-completion-globs-are-feature-unscoped-so-anot.md).
 *
 * WHY THESE DRIVE THE REAL ENTRY POINTS (writing-system-tests §3b/§3d)
 * -------------------------------------------------------------------
 * `resolveArtifactFiles` is a correctness-critical derivation: it decides
 * whether a file on disk belongs to the ACTIVE feature. A unit test that calls
 * it directly, on a hand-built candidate list, passes while the three
 * PRODUCTION call sites still expand `STEP_ARTIFACT_GLOBS` through the raw,
 * policy-free `findArtifactFiles` — which is exactly the #993 defect (feature
 * A's `.docs/conflicts/a.md` satisfies feature B's gate). §3d therefore
 * requires one spec per production call site, fed the REAL adversarial input
 * that site sees (a neighbouring feature's artifact sitting in the same shared
 * `.docs/` directory), asserting the OBSERVABLE guarantee at that site.
 *
 * Enumerated production call sites of the generic artifact corpus (verified by
 * grep at authoring time, 2026-07-28):
 *   1. src/conductor/src/engine/artifacts.ts:3252 — `checkStepCompletion`
 *      generic fallback (`findArtifactFiles(dir, step, extra)`).
 *   2. src/conductor/src/engine/conductor.ts:6130 — `Conductor.run` interactive
 *      artifact-review gate (`findArtifactFilesForStep(projectRoot, step)`).
 *   3. src/conductor/src/engine/artifacts.ts:3279 — `getArtifactStatus`
 *      (`matchGlob` per pattern), consumed by
 *      src/conductor/src/ui/terminal-renderer.ts:87 and
 *      src/conductor/src/ui/create-renderer.ts:70.
 * (conductor.ts:796 and :3921 and :6197 are explicit whole-corpus callers —
 *  the plan keeps raw discovery available for them; see the D5 regression.)
 *
 * LAYER SPLIT (§3a)
 * -----------------
 * TS-993-1 (typed `STEP_ARTIFACT_CONTRACTS` registry + derived
 * `STEP_ARTIFACT_GLOBS` projection) is a single-module registry contract —
 * `unit-covered` by plan Tasks 1-2 in test/engine/artifacts.test.ts. The pure
 * identity-normalisation helper (Task 3), the context builder (Task 4) and the
 * resolver's own ladder/diagnostic shape (Tasks 5-6) are likewise unit-covered.
 * This file owns only the cross-module flows: seed two features' artifacts into
 * one shared directory, then drive completion / interactive review / dashboard
 * status and assert they agree on the CURRENT feature's files.
 *
 * AS-BUILT REGRESSION STATE
 * -------------------------
 * The specs exercise the production feature-aware entry points with prepared
 * `ArtifactResolutionContext` values. Cases marked `[REGRESSION]` pin behavior
 * introduced by this feature; `[GUARD]` cases pin intentionally broad
 * repository/run scopes and stronger custom predicates that TS-993-4 forbids
 * this fix from weakening.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile, utimes } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { Writable } from 'node:stream';

vi.mock('../../src/engine/self-host/operator-credentials.js', () => ({
  readOperatorCredentialsState: vi.fn().mockResolvedValue('fresh'),
  waitForCredentialsChange: vi.fn(),
}));
vi.mock('../../src/engine/self-host/sandbox-build-env.js', () => ({
  provisionSandboxBuildEnv: vi.fn(),
  realSandboxFs: {},
  SandboxProvisionError: class SandboxProvisionError extends Error {},
}));
vi.mock('../../src/engine/rebase.js', async () => {
  const actual = await vi.importActual('../../src/engine/rebase.js');
  return { ...actual, performRebase: vi.fn().mockResolvedValue({ kind: 'noop' }) };
});

import {
  checkStepCompletion,
  buildArtifactResolutionContext,
  findArtifactFiles,
  getArtifactStatus,
  type ArtifactPatternStatus,
  type ArtifactResolutionContext,
  type CompletionContext,
} from '../../src/engine/artifacts.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { TerminalRenderer } from '../../src/ui/terminal-renderer.js';
import { createRenderer } from '../../src/ui/create-renderer.js';
import { createLiveRegion } from '../../src/ui/live-region.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import type { HarnessConfig } from '../../src/types/config.js';

// --- Two features sharing one `.docs/` corpus (the #993 adversarial input) ---

const FEATURE_A = 'feature-a-neighbour-work';
const FEATURE_B = 'feature-b-current-work';
const FEATURE_C = 'feature-c-third-party';

const CONFLICT_DIR = '.docs/conflicts';
const A_CONFLICT = `${CONFLICT_DIR}/${FEATURE_A}.md`;
const B_CONFLICT = `${CONFLICT_DIR}/${FEATURE_B}.md`;
const C_CONFLICT = `${CONFLICT_DIR}/${FEATURE_C}.md`;

const DECISIONS_DIR = '.docs/decisions';
const A_ARCHITECTURE_REVIEW =
  `${DECISIONS_DIR}/architecture-review-2026-01-09-${FEATURE_A}.md`;
const B_ARCHITECTURE_REVIEW =
  `${DECISIONS_DIR}/architecture-review-2026-07-28-${FEATURE_B}.md`;

type ScopedArtifactStatus = ArtifactPatternStatus;

function resolutionContextFor(featureIdentity: string): ArtifactResolutionContext {
  return {
    featureIdentities: [featureIdentity],
    changedPaths: new Set(),
  };
}

async function seed(dir: string, relPath: string, body: string): Promise<void> {
  const full = join(dir, relPath);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, body, 'utf-8');
}

/** Completion context for the ACTIVE feature (B). */
function ctxFor(dir: string, featureDesc: string): CompletionContext {
  return { projectRoot: dir, featureDesc, planPath: join(dir, `.docs/plans/${featureDesc}.md`) };
}

function statusFor(
  records: ScopedArtifactStatus[],
  pattern: string,
): ScopedArtifactStatus {
  const found = records.find((r) => r.pattern === pattern);
  expect(found, `no status record for pattern ${pattern}`).toBeDefined();
  return found!;
}

// ---------------------------------------------------------------------------
// Suite A — call site 1: the real `checkStepCompletion` generic fallback.
// Stories TS-993-2 (all paths) and TS-993-3 happy path 1.
// ---------------------------------------------------------------------------

describe('#993 call site 1 — checkStepCompletion resolves the CURRENT feature only', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'artifact-scope-completion-'));
    await seed(dir, `.docs/plans/${FEATURE_B}.md`, '# Plan B\n');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('[REGRESSION] TS-993-2 N1: an ambiguous foreign conflict corpus cannot complete this feature\'s step', async () => {
    // A and C have conflict reports. B has authored nothing.
    await seed(dir, A_CONFLICT, '# Conflicts for feature A\n');
    await seed(dir, C_CONFLICT, '# Conflicts for feature C\n');

    const result = await checkStepCompletion(dir, 'conflict_check', ctxFor(dir, FEATURE_B));

    expect(result.done).toBe(false);
    // The diagnostic must name the ambiguous feature evidence, not just
    // report a generic "no files matching <glob>" — an operator reading it has
    // to know a FOREIGN artifact was present and rejected.
    expect(result.reason ?? '').toContain(FEATURE_B);
  });

  it('[GUARD] TS-993-2 H1: this feature\'s own report completes the step even with a neighbour\'s file present', async () => {
    await seed(dir, A_CONFLICT, '# Conflicts for feature A\n');
    await seed(dir, B_CONFLICT, '# Conflicts for feature B\n');

    const result = await checkStepCompletion(dir, 'conflict_check', ctxFor(dir, FEATURE_B));

    expect(result.done).toBe(true);
  });

  it('[REGRESSION] TS-993-2 N2: several foreign candidates fail closed and are never chosen alphabetically or by mtime', async () => {
    // `A_CONFLICT` sorts first and `C_CONFLICT` is the newest on disk — the two
    // orderings a naive resolver would fall back to. Neither belongs to B.
    await seed(dir, A_CONFLICT, '# Conflicts for feature A\n');
    await seed(dir, C_CONFLICT, '# Conflicts for feature C\n');
    const future = new Date(Date.now() + 60_000);
    await utimes(join(dir, C_CONFLICT), future, future);

    const result = await checkStepCompletion(dir, 'conflict_check', ctxFor(dir, FEATURE_B));

    expect(result.done).toBe(false);
    expect(result.reason ?? '').toMatch(/ambiguous|none can be associated|no .*artifact/i);
  });

  it('[GUARD] TS-993-2 H4: a legacy singleton with an unrecognisable name stays recognised', async () => {
    // Pre-convention repositories have exactly one report under a name that
    // resembles no plan stem. Feature scoping must not orphan it.
    await seed(dir, `${CONFLICT_DIR}/conflict-report.md`, '# legacy report\n');

    const result = await checkStepCompletion(dir, 'conflict_check', ctxFor(dir, FEATURE_B));

    expect(result.done).toBe(true);
  });

  it('[REGRESSION] TS-993-2 N4: historical dated filenames for other plans stay ambiguous', async () => {
    // `architecture_review` declares dated/prefixed review names. A's and C's
    // dated reviews normalize away from B, so the corpus must not satisfy B.
    await seed(dir, A_ARCHITECTURE_REVIEW, '# Architecture review for feature A\n');
    await seed(
      dir,
      `${DECISIONS_DIR}/architecture-review-2026-06-15-${FEATURE_C}.md`,
      '# Architecture review for feature C\n',
    );

    const result = await checkStepCompletion(
      dir,
      'architecture_review',
      ctxFor(dir, FEATURE_B),
    );

    expect(result.done).toBe(false);
    expect(result.reason ?? '').toContain(FEATURE_B);
  });

  it('[GUARD] TS-993-2 H3: this feature\'s own dated architecture review is recognised without a manifest', async () => {
    await seed(dir, A_ARCHITECTURE_REVIEW, '# Architecture review for feature A\n');
    await seed(dir, B_ARCHITECTURE_REVIEW, '# Architecture review for feature B\n');

    const result = await checkStepCompletion(
      dir,
      'architecture_review',
      ctxFor(dir, FEATURE_B),
    );

    expect(result.done).toBe(true);
  });

  it('[GUARD] TS-993-2 N3: a file belonging to this feature but OUTSIDE the declared patterns cannot satisfy the step', async () => {
    // B authored a note, not a conflict report. Branch membership alone is not
    // evidence — the file must also match the step's declared pattern.
    await seed(dir, `.docs/notes/${FEATURE_B}.md`, '# scratch note\n');

    const result = await checkStepCompletion(dir, 'conflict_check', ctxFor(dir, FEATURE_B));

    expect(result.done).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suite B — TS-993-4: intentionally broad scope and stronger predicates survive.
// Same real `checkStepCompletion` entry point; these must never flip to a
// false FAILURE as a side effect of feature scoping.
// ---------------------------------------------------------------------------

describe('#993 TS-993-4 — repository/run scope and custom predicates keep their semantics', () => {
  let dir: string;

  const RED_EVIDENCE = JSON.stringify({
    outcome: 'specs-generated',
    command: 'npx vitest run test/acceptance',
    targetSpecs: ['test/acceptance/unrelated-name.acceptance.test.ts'],
    executed: 3,
    passed: 0,
    failed: 3,
    skipped: 0,
    errors: 0,
    failingTests: [{ name: 'repository acceptance corpus', reason: 'expected behavior is not implemented' }],
    ranAt: '2026-08-10T00:00:00.000Z',
    intentRationale: 'The fixture records an executed, failing repository acceptance corpus.',
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'artifact-scope-preserve-'));
    await seed(dir, `.docs/plans/${FEATURE_B}.md`, '# Plan B\n');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('[GUARD] H1/N2: a repository-scoped acceptance corpus is not filtered by plan-stem resemblance', async () => {
    // None of these filenames resemble FEATURE_B. `acceptance_specs` is
    // repository-scoped, so plan-stem normalisation must not reject them.
    await seed(dir, 'test/acceptance/unrelated-name.acceptance.test.ts', '// spec\n');
    await seed(dir, 'api/spec/acceptance/legacy_spec.rb', '# spec\n');
    await seed(dir, '.pipeline/acceptance-specs-red.json', RED_EVIDENCE);

    const config = { acceptance_spec_globs: ['*/spec/acceptance/**/*'] } as unknown as HarnessConfig;
    const result = await checkStepCompletion(dir, 'acceptance_specs', {
      ...ctxFor(dir, FEATURE_B),
      config,
    });

    expect(result.done).toBe(true);
  });

  it('[GUARD] H3/N3: project-declared acceptance globs stay eligible, but the stronger RED predicate still fails without evidence', async () => {
    await seed(dir, 'api/spec/acceptance/legacy_spec.rb', '# spec\n');
    // No `.pipeline/acceptance-specs-red.json` — matching alone is not a pass.

    const config = { acceptance_spec_globs: ['*/spec/acceptance/**/*'] } as unknown as HarnessConfig;
    const result = await checkStepCompletion(dir, 'acceptance_specs', {
      ...ctxFor(dir, FEATURE_B),
      config,
    });

    expect(result.done).toBe(false);
    expect(result.reason ?? '').toContain('acceptance-specs-red.json');
  });

  it('[GUARD] N1: a run-scoped verdict file that merely MATCHES its pattern cannot pass its custom predicate', async () => {
    await seed(dir, '.pipeline/build-review.json', '{ not valid json');

    const result = await checkStepCompletion(dir, 'build_review', {
      ...ctxFor(dir, FEATURE_B),
      sessionStartedAt: Date.now() - 1_000,
      attemptStartedAt: Date.now() - 1_000,
    });

    expect(result.done).toBe(false);
  });

  it('[GUARD] H4/N4: a configured completion artifact keeps its exact-file freshness floor', async () => {
    const config = {
      steps: { conflict_check: { completion_artifact: '.pipeline/conflict-verdict.md' } },
    } as unknown as HarnessConfig;
    await seed(dir, '.pipeline/conflict-verdict.md', 'verdict\n');

    const stale = new Date(Date.now() - 10 * 60_000);
    await utimes(join(dir, '.pipeline/conflict-verdict.md'), stale, stale);
    const staleResult = await checkStepCompletion(dir, 'conflict_check', {
      ...ctxFor(dir, FEATURE_B),
      config,
      sessionStartedAt: Date.now() - 60_000,
    });
    expect(staleResult.done).toBe(false);

    const fresh = new Date();
    await utimes(join(dir, '.pipeline/conflict-verdict.md'), fresh, fresh);
    const freshResult = await checkStepCompletion(dir, 'conflict_check', {
      ...ctxFor(dir, FEATURE_B),
      config,
      sessionStartedAt: Date.now() - 60_000,
    });
    expect(freshResult.done).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite C — call site 2: the real `Conductor.run` interactive artifact-review
// gate (conductor.ts:6130). Story TS-993-3 happy path 1 and negative path 1.
// ---------------------------------------------------------------------------

describe('#993 call site 2 — interactive artifact review never presents a neighbour\'s file', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  function trackingRunner(): StepRunner {
    return {
      run: async (): Promise<StepRunResult> => ({ success: true }),
      resetSession: async () => {},
    };
  }

  /** Every step except `conflict_check` marked done, so the run touches one gate. */
  async function seedThrough(target: StepName): Promise<void> {
    const res = await readState(statePath);
    const state = (res.ok ? res.value : {}) as Record<string, unknown>;
    for (const s of ALL_STEPS) {
      if (s.name === target) continue;
      state[s.name] = 'done';
    }
    state.complexity_tier = 'M';
    state.feature_desc = FEATURE_B;
    state.track = 'technical';
    await writeState(statePath, state as unknown as ConductState);
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'artifact-scope-review-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await seedThrough('conflict_check');
    await seed(dir, `.docs/plans/${FEATURE_B}.md`, '# Plan B\n');
    // `conflict_check` review is `conditional`; the marker forces the prompt.
    await seed(dir, '.pipeline/review-required-conflict_check', '1');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function reviewedPathsFor(calls: unknown[][]): string[] {
    return calls
      .filter((c) => c[0] === 'conflict_check')
      .flatMap((c) => (c[1] as string[]) ?? [])
      .map((p) => relative(dir, p));
  }

  it('[REGRESSION] TS-993-3 H1: the review prompt receives only the current feature\'s report', async () => {
    await seed(dir, A_CONFLICT, '# Conflicts for feature A\n');
    await seed(dir, B_CONFLICT, '# Conflicts for feature B\n');

    const onReviewArtifacts = vi.fn().mockResolvedValue('approved' as const);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: trackingRunner(),
      events,
      projectRoot: dir,
      featureDesc: FEATURE_B,
      resume: true,
      fromStep: 'conflict_check',
      onReviewArtifacts,
    });

    await conductor.run();

    const reviewed = reviewedPathsFor(onReviewArtifacts.mock.calls);
    expect(reviewed).toContain(B_CONFLICT);
    expect(reviewed).not.toContain(A_CONFLICT);
  });

  it('[REGRESSION] TS-993-3 N1: ambiguous foreign artifacts are never offered for approval when this feature authored nothing', async () => {
    await seed(dir, A_CONFLICT, '# Conflicts for feature A\n');
    await seed(dir, C_CONFLICT, '# Conflicts for feature C\n');

    const onReviewArtifacts = vi.fn().mockResolvedValue('approved' as const);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: trackingRunner(),
      events,
      projectRoot: dir,
      featureDesc: FEATURE_B,
      resume: true,
      fromStep: 'conflict_check',
      onReviewArtifacts,
    });

    await conductor.run();

    expect(reviewedPathsFor(onReviewArtifacts.mock.calls)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Suite D — call site 3: `getArtifactStatus` and both dashboard renderers.
// Story TS-993-3 happy paths 1-3 and negative path 2; TS-993-2 happy path 2.
// ---------------------------------------------------------------------------

class CaptureStream extends Writable {
  chunks: string[] = [];
  _write(chunk: Buffer | string, _e: string, cb: (err?: Error | null) => void): void {
    this.chunks.push(chunk.toString());
    cb();
  }
  output(): string {
    return this.chunks.join('');
  }
}

describe('#993 call site 3 — dashboard status shows the current feature\'s files only', () => {
  let dir: string;

  const CONFLICT_PATTERN = '.docs/conflicts/*.md';

  const readStateFn = async (): Promise<{ ok: true; value: ConductState }> => ({
    ok: true as const,
    value: { feature_desc: FEATURE_B, complexity_tier: 'M', conflict_check: 'done' } as ConductState,
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'artifact-scope-dashboard-'));
    await seed(dir, `.docs/plans/${FEATURE_B}.md`, '# Plan B\n');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('[REGRESSION] TS-993-3 H1: getArtifactStatus lists only the current feature\'s file', async () => {
    await seed(dir, A_CONFLICT, '# Conflicts for feature A\n');
    await seed(dir, B_CONFLICT, '# Conflicts for feature B\n');

    const records = await getArtifactStatus(
      dir,
      'conflict_check',
      resolutionContextFor(FEATURE_B),
    );
    const status = statusFor(records, CONFLICT_PATTERN);

    expect(status.satisfied).toBe(true);
    expect(status.files).toEqual([B_CONFLICT]);
  });

  it('[REGRESSION] TS-993-3 N2: an ambiguous feature corpus renders unsatisfied, never a checkmark backed by a neighbour', async () => {
    await seed(dir, A_CONFLICT, '# Conflicts for feature A\n');
    await seed(dir, C_CONFLICT, '# Conflicts for feature C\n');

    const records = await getArtifactStatus(
      dir,
      'conflict_check',
      resolutionContextFor(FEATURE_B),
    );
    const status = statusFor(records, CONFLICT_PATTERN);

    expect(status.satisfied).toBe(false);
    // The pattern is retained so the dashboard can still explain itself, and
    // the diagnostic says WHY rather than implying the file is absent.
    expect(status.pattern).toBe(CONFLICT_PATTERN);
    expect(status.diagnostic ?? '').not.toBe('');
    expect(status.files).not.toContain(A_CONFLICT);
  });

  it('[GUARD] TS-993-3 H3: raw whole-corpus discovery remains available to explicit callers', async () => {
    await seed(dir, A_CONFLICT, '# Conflicts for feature A\n');
    await seed(dir, B_CONFLICT, '# Conflicts for feature B\n');

    const all = (await findArtifactFiles(dir, 'conflict_check')).map((f) => relative(dir, f));

    expect(all.sort()).toEqual([A_CONFLICT, B_CONFLICT].sort());
  });

  it('[REGRESSION] TS-993-3 H2: the terminal dashboard renders the current feature\'s file and not the neighbour\'s', async () => {
    await seed(dir, A_CONFLICT, '# Conflicts for feature A\n');
    await seed(dir, B_CONFLICT, '# Conflicts for feature B\n');

    const stream = new CaptureStream();
    const renderer = new TerminalRenderer({
      stateFilePath: join(dir, 'conduct-state.json'),
      featureDesc: FEATURE_B,
      steps: ALL_STEPS,
      readStateFn,
      projectRoot: dir,
      liveRegion: createLiveRegion({ stream, forceTTY: false }),
    });

    await renderer.handle({ type: 'step_completed', step: 'conflict_check', status: 'done' });

    const output = stream.output();
    expect(output).toContain(B_CONFLICT);
    expect(output).not.toContain(A_CONFLICT);
  });

  it('[REGRESSION] TS-993-3 H2: the create dashboard renders the current feature\'s file and not the neighbour\'s', async () => {
    await seed(dir, A_CONFLICT, '# Conflicts for feature A\n');
    await seed(dir, B_CONFLICT, '# Conflicts for feature B\n');

    const stream = new CaptureStream();
    const render = createRenderer({
      stateFilePath: join(dir, 'conduct-state.json'),
      featureDesc: FEATURE_B,
      steps: ALL_STEPS,
      readStateFn,
      projectRoot: dir,
      liveRegion: createLiveRegion({ stream, forceTTY: false }),
    });

    await render({ type: 'step_completed', step: 'conflict_check', status: 'done' });

    const output = stream.output();
    expect(output).toContain(B_CONFLICT);
    expect(output).not.toContain(A_CONFLICT);
  });
});

// ---------------------------------------------------------------------------
// Suite E — TS-993-2 happy path 2: worktree change-set attribution.
// A real bounded git fixture, because merge-base + working-tree semantics ARE
// the behaviour under test (plan Prerequisites). Both candidate filenames are
// deliberately unrecognisable, so ONLY the change set can attribute them.
// ---------------------------------------------------------------------------

describe('#993 TS-993-2 H2 — the feature\'s own worktree changes attribute its artifact', () => {
  let root: string;
  let repo: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'artifact-scope-git-'));
    const bare = join(root, 'origin.git');
    const seedRepo = join(root, 'seed');
    repo = join(root, 'repo');

    execSync(`git init -q --bare -b main "${bare}"`);
    execSync(`git init -q -b main "${seedRepo}"`);
    execSync('git config user.email "test@example.com"', { cwd: seedRepo });
    execSync('git config user.name "Test User"', { cwd: seedRepo });
    // Feature A's report landed on main long ago, under a name that resembles
    // no plan stem — a historical artifact, not B's work.
    await seed(seedRepo, `${CONFLICT_DIR}/legacy-conflicts.md`, '# feature A, landed\n');
    execSync('git add -A', { cwd: seedRepo });
    execSync('git commit -q -m "chore: land feature A conflict report"', { cwd: seedRepo });
    execSync(`git remote add origin "${bare}"`, { cwd: seedRepo });
    execSync('git push -q origin main', { cwd: seedRepo });

    execSync(`git clone -q "${bare}" "${repo}"`);
    execSync('git config user.email "test@example.com"', { cwd: repo });
    execSync('git config user.name "Test User"', { cwd: repo });
    execSync(`git checkout -q -b feat/${FEATURE_B}`, { cwd: repo });
    await seed(repo, `.docs/plans/${FEATURE_B}.md`, '# Plan B\n');
    // B's own report is UNTRACKED in its isolated worktree (authored this run,
    // not yet committed) and also carries an unrecognisable name.
    await seed(repo, `${CONFLICT_DIR}/report.md`, '# feature B, in flight\n');
    // The historical file is made the NEWEST on disk, so an mtime tie-break
    // would pick the wrong one.
    const future = new Date(Date.now() + 60_000);
    await utimes(join(repo, `${CONFLICT_DIR}/legacy-conflicts.md`), future, future);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('[REGRESSION] recognises the untracked in-worktree artifact and rejects the historical one despite its newer mtime', async () => {
    const resolutionContext = await buildArtifactResolutionContext(repo, {
      planPath: join(repo, `.docs/plans/${FEATURE_B}.md`),
      featureDesc: FEATURE_B,
    });
    const records = await getArtifactStatus(repo, 'conflict_check', resolutionContext);
    const status = statusFor(records, '.docs/conflicts/*.md');

    expect(status.files).toEqual([`${CONFLICT_DIR}/report.md`]);
    expect(status.files).not.toContain(`${CONFLICT_DIR}/legacy-conflicts.md`);
  });

  it('[GUARD] the same change-set evidence keeps the real completion gate satisfied', async () => {
    const result = await checkStepCompletion(repo, 'conflict_check', {
      projectRoot: repo,
      featureDesc: FEATURE_B,
      planPath: join(repo, `.docs/plans/${FEATURE_B}.md`),
    });

    // The gate passes because B's own untracked report was attributed to B,
    // as proven by the companion status assertion above.
    expect(result.done).toBe(true);
  });
});
