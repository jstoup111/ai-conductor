/**
 * Acceptance for FR-8 / Story 10: review infrastructure failures are
 * operator-recoverable, never build rework.
 *
 * A rubric that cannot RUN (here `testQuality` returning
 * `invalid-provider-result`) is a mechanical fault, not a reviewer verdict.
 * The engine consumes its bounded mechanical allowance
 * (`MAX_MECHANICAL_FAULTS_BUILD_REVIEW`), never routes to `build`, then HALTs
 * `needs-human` with an operator-readable recovery recipe. The operator runs
 * the real `conduct build-review record-reduced-coverage` entry point, clears
 * the documented halt markers, and the next dispatch resolves build_review as
 * done and advances — with no hand edit to any durable state file.
 *
 * Third-party boundary: the rubric coordinator (the only seam that reaches a
 * provider) is a deterministic fake. Internal boundaries stay real:
 * DefaultStepRunner's mechanical lane, the kickback ledger, aggregate
 * publication, the disposition store and its lease, the effective-verdict
 * resolver, the CLI dispatcher, Conductor routing, and the halt markers.
 * Feature identity is resolved from the `<root>/.worktrees/<feature>` layout
 * with the main-root probe injected, so no git process is spawned.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { dispatchBuildReviewRecordReducedCoverage } from '../../src/engine/build-review-cli.js';
import {
  coordinateBuildReviewRubrics,
  type BuildReviewCoordination,
  type BuildReviewCoordinationInput,
} from '../../src/engine/build-review-coordinator.js';
import { joinBuildReviewRubricOutcomes } from '../../src/engine/build-review-aggregate.js';
import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import { BuildReviewDispositionStore } from '../../src/engine/build-review-dispositions.js';
import { resolveEffectiveBuildReviewVerdict } from '../../src/engine/build-review-effective.js';
import type { BuildReviewFrozenInputs } from '../../src/engine/build-review-inputs.js';
import type { ConductorOptions, StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { HALT_CLASS_MARKER, HALT_MARKER, readHaltClass } from '../../src/engine/halt-marker.js';
import {
  MAX_MECHANICAL_FAULTS_BUILD_REVIEW,
  readKickbackLedger,
  writeKickbackLedger,
} from '../../src/engine/kickback-ledger.js';
import { resolveBuildReviewConfig } from '../../src/engine/resolved-config.js';
import { readState, writeState } from '../../src/engine/state.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { ConductorEvent, ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { Conductor } from '../test-conductor.js';

vi.mock('../../src/engine/build-review-coordinator.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/build-review-coordinator.js')>(),
  coordinateBuildReviewRubrics: vi.fn(),
}));

const FEATURE = 'review-infrastructure-failures-are-operator-unreco';
const HEAD_SHA = 'fixture-head';
const LAP_ID = `lap-${HEAD_SHA}`;
/** The engine's closed cause for a coordinator `invalid-provider-result` branch. */
const CLOSED_CAUSE = 'malformed-artifact';
const dirs: string[] = [];

type ExhaustedEvent = Extract<ConductorEvent, { type: 'build_review_mechanical_allowance_exhausted' }>;

interface Fixture {
  root: string;
  worktree: string;
  statePath: string;
}

async function seedFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'mechanical-review-recovery-'));
  dirs.push(root);
  const worktree = join(root, '.worktrees', FEATURE);
  await mkdir(join(worktree, '.pipeline'), { recursive: true });
  const statePath = join(worktree, '.pipeline', 'conduct-state.json');
  await writeState(statePath, seedState());
  return { root, worktree, statePath };
}

function seedState(): ConductState {
  const state: Record<string, unknown> = {};
  for (const step of ALL_STEPS) {
    if (step.name === 'build_review') break;
    state[step.name] = 'done';
  }
  state.build_review = 'pending';
  state.complexity_tier = 'S';
  state.track = 'technical';
  state.feature_desc = FEATURE;
  state.run_started_at = Date.now();
  return state as unknown as ConductState;
}

/** Feature identity from the on-disk `.worktrees/<feature>` layout — no git. */
function identityDeps(fixture: Fixture) {
  return {
    resolveMainRoot: async () => fixture.root,
    realpath: async (path: string) => path,
  };
}

function infrastructureCoordination(): BuildReviewCoordination {
  return {
    kind: 'ready',
    branches: [{
      kind: 'infrastructure-failure',
      rubric: 'testQuality',
      reason: 'invalid-provider-result',
      detail: 'no parseable JSON object was found in the response',
    }],
  };
}

/**
 * A recovered provider: the rubric judges the diff and its artifact is
 * written through the real branch-artifact writer, so the real reader joins
 * it into the lap aggregate exactly as production does.
 */
async function judgedPassCoordination(input: BuildReviewCoordinationInput): Promise<BuildReviewCoordination> {
  const result = {
    kind: 'judged' as const,
    rubric: 'testQuality' as const,
    lapId: input.lapId,
    snapshotDigest: input.inputs.sourceSnapshot.digest,
    contractVersion: 'v3' as const,
    findings: [],
    verdict: 'PASS' as const,
  };
  await input.writeArtifact({
    rubric: 'testQuality',
    lapId: input.lapId,
    snapshotDigest: input.inputs.sourceSnapshot.digest,
    result,
    provenance: { kind: 'fresh' },
  });
  return { kind: 'ready', branches: [{ kind: 'dispatched', rubric: 'testQuality', result }] };
}

/**
 * The real DefaultStepRunner mechanical lane, driven at its rubric seam with
 * the frozen-input assembly (a git/test-suite boundary) pre-computed.
 */
function makeRunner(fixture: Fixture, downstream: StepName[]): StepRunner {
  const provider: LLMProvider = { invoke: vi.fn(), };
  const stepRunner = new DefaultStepRunner(provider, 'mechanical-review-session', fixture.worktree, {
    pipelineDir: join(fixture.worktree, '.pipeline'),
    buildReviewEffectiveResolver: async (root, aggregate, deps) =>
      resolveEffectiveBuildReviewVerdict(root, aggregate, { ...deps, ...identityDeps(fixture) }),
  });
  const runRubricLap = () => (stepRunner as unknown as {
    runRubricBuildReview: (
      inputs: BuildReviewFrozenInputs,
      config: ReturnType<typeof resolveBuildReviewConfig>,
    ) => Promise<StepRunResult>;
  }).runRubricBuildReview(
    { sourceSnapshot: { headSha: HEAD_SHA, digest: `sha256:${HEAD_SHA}`, mergeBase: 'base' } } as BuildReviewFrozenInputs,
    resolveBuildReviewConfig({ build_review: { enabled: true } } as HarnessConfig),
  );
  return {
    run: async (step): Promise<StepRunResult> => {
      if (step === 'build_review') return runRubricLap();
      downstream.push(step);
      return { success: false, output: `sentinel: advanced beyond build_review to ${step}` };
    },
  };
}

function conductorOptions(fixture: Fixture, runner: StepRunner, events: ConductorEventEmitter): ConductorOptions {
  return {
    stateFilePath: fixture.statePath,
    stepRunner: runner,
    events,
    projectRoot: fixture.worktree,
    mode: 'auto',
    daemon: true,
    fromStep: 'build_review',
    verifyArtifacts: true,
    maxRetries: 1,
    config: {
      build_review: { enabled: true },
      kickback_escalation: { enabled: false },
    },
    buildReviewEffectiveResolver: async (root, aggregate) =>
      resolveEffectiveBuildReviewVerdict(root, aggregate, identityDeps(fixture)),
  };
}

function captureExhausted(events: ConductorEventEmitter): ExhaustedEvent[] {
  const captured: ExhaustedEvent[] = [];
  events.on('build_review_mechanical_allowance_exhausted', (event) => {
    if (event.type === 'build_review_mechanical_allowance_exhausted') captured.push(event);
  });
  return captured;
}

async function runOperatorDecision(fixture: Fixture, lapId: string): Promise<{ exitCode: number; output: string }> {
  const printed: string[] = [];
  const exitCode = await dispatchBuildReviewRecordReducedCoverage({
    kind: 'record-reduced-coverage',
    feature: FEATURE,
    lapId,
    rubric: 'testQuality',
    rationale: 'operator-approved-mechanical-coverage-gap',
  }, {
    cwd: fixture.root,
    isInteractive: true,
    resolveOperator: () => 'local-operator',
    ...identityDeps(fixture),
    print: (line) => printed.push(line),
  });
  return { exitCode, output: printed.join('\n') };
}

afterEach(async () => {
  vi.mocked(coordinateBuildReviewRubrics).mockReset();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Covers: FR-8, S10.1 — an exhausted mechanical build-review fault is operator-recoverable, never build rework', () => {
  it('consumes the allowance without routing to build, halts needs-human with the recovery recipe, and emits the exhausted event', async () => {
    vi.mocked(coordinateBuildReviewRubrics).mockImplementation(async () => infrastructureCoordination());
    const fixture = await seedFixture();
    const downstream: StepName[] = [];
    const events = new ConductorEventEmitter();
    const exhausted = captureExhausted(events);

    await new Conductor(conductorOptions(fixture, makeRunner(fixture, downstream), events)).run();

    const halt = await readFile(join(fixture.worktree, HALT_MARKER), 'utf8');
    const ledger = await readKickbackLedger(fixture.worktree);
    const halted = await readState(fixture.statePath);
    expect({
      downstream,
      haltClass: await readHaltClass(fixture.worktree),
      rubricLaps: vi.mocked(coordinateBuildReviewRubrics).mock.calls.length,
      mechanicalFaults: ledger.gates.build_review?.mechanicalFaults,
      semanticKickbacks: ledger.gates.build_review?.count ?? 0,
      buildReviewState: halted.ok ? halted.value.build_review : 'unreadable',
      exhausted,
    }).toEqual({
      downstream: [],
      haltClass: 'needs-human',
      rubricLaps: MAX_MECHANICAL_FAULTS_BUILD_REVIEW,
      mechanicalFaults: MAX_MECHANICAL_FAULTS_BUILD_REVIEW,
      semanticKickbacks: 0,
      buildReviewState: 'failed',
      exhausted: [{
        type: 'build_review_mechanical_allowance_exhausted',
        lapId: LAP_ID,
        rubric: 'testQuality',
        reason: CLOSED_CAUSE,
        consumed: MAX_MECHANICAL_FAULTS_BUILD_REVIEW,
        allowance: MAX_MECHANICAL_FAULTS_BUILD_REVIEW,
      }],
    });
    // The halt body is the operator's diagnostic and recipe, not a retry summary.
    expect(halt).toContain(
      `build_review mechanical fault allowance exhausted: ${MAX_MECHANICAL_FAULTS_BUILD_REVIEW} of ${MAX_MECHANICAL_FAULTS_BUILD_REVIEW} shared faults consumed.`,
    );
    expect(halt).toContain(`Current lap ${LAP_ID}: testQuality closed cause ${CLOSED_CAUSE}`);
    expect(halt).toContain(`build-review record-reduced-coverage --feature <feature-slug> --lap ${LAP_ID} --rubric testQuality`);
    expect(halt).toContain('rm -f .pipeline/HALT .pipeline/HALT.class');
    expect(halt).not.toContain('retries exhausted');
  });

  it('records reduced coverage through the real command entry point, clears the documented markers, and advances the next dispatch past build_review without hand-editing state', async () => {
    vi.mocked(coordinateBuildReviewRubrics).mockImplementation(async () => infrastructureCoordination());
    const fixture = await seedFixture();
    await new Conductor(conductorOptions(fixture, makeRunner(fixture, []), new ConductorEventEmitter())).run();
    await expect(readHaltClass(fixture.worktree)).resolves.toBe('needs-human');
    const haltedAggregate = JSON.parse(
      await readFile(join(fixture.worktree, '.pipeline', 'build-review.json'), 'utf8'),
    ) as { lapId: string };

    const decision = await runOperatorDecision(fixture, haltedAggregate.lapId);
    expect(decision).toEqual({
      exitCode: 0,
      output: `build-review record-reduced-coverage: recorded testQuality for lap ${LAP_ID}.`,
    });
    const recorded = await new BuildReviewDispositionStore(fixture.worktree).listReducedCoverage({
      version: 'v1', repository: fixture.root, feature: FEATURE,
    });
    expect(recorded.ok && recorded.records.map((record) => record.identity)).toEqual([
      { rubric: 'testQuality', reason: CLOSED_CAUSE },
    ]);

    // The documented clear: exactly the two markers the halt body names.
    await rm(join(fixture.worktree, HALT_MARKER), { force: true });
    await rm(join(fixture.worktree, HALT_CLASS_MARKER), { force: true });

    // The next dispatch re-runs the rubric against a recovered provider.
    // With testQuality the only rubric, a lap that judges nothing can never
    // PASS (deriveEffectiveBuildReviewVerdict requires a judged rubric), so
    // the recovery is the fresh judged lap — reached without any hand edit to
    // the ledger, state, or aggregate.
    vi.mocked(coordinateBuildReviewRubrics).mockImplementation(judgedPassCoordination);
    const downstream: StepName[] = [];
    const events = new ConductorEventEmitter();
    const exhausted = captureExhausted(events);
    await new Conductor(conductorOptions(fixture, makeRunner(fixture, downstream), events)).run();

    const resumed = await readState(fixture.statePath);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) throw new Error(resumed.error.message);
    const ledger = await readKickbackLedger(fixture.worktree);
    expect({
      buildReview: resumed.value.build_review,
      advanced: downstream.length > 0,
      routedToBuild: downstream.includes('build'),
      exhaustedAgain: exhausted.length,
      // The spent allowance and the durable decision both survive untouched.
      mechanicalFaults: ledger.gates.build_review?.mechanicalFaults,
      semanticKickbacks: ledger.gates.build_review?.count ?? 0,
    }).toEqual({
      buildReview: 'done',
      advanced: true,
      routedToBuild: false,
      exhaustedAgain: 0,
      mechanicalFaults: MAX_MECHANICAL_FAULTS_BUILD_REVIEW,
      semanticKickbacks: 0,
    });
  });

  it('withholds the exhausted halt and event when the current lap had no mechanical fault, even with the allowance spent', async () => {
    // A spent ledger and a published infrastructure aggregate are both
    // present, but this lap's failure is an ordinary runner failure (no
    // `currentLapMechanicalFault`). The exhausted recipe would misdirect the
    // operator to record reduced coverage for a fault this lap never had.
    const fixture = await seedFixture();
    const lapId = parseBuildReviewLapId('lap-prior-mechanical')!;
    await writeKickbackLedger(fixture.worktree, {
      version: 1,
      gates: {
        build_review: {
          count: 0,
          cumulative: 0,
          mechanicalFaults: MAX_MECHANICAL_FAULTS_BUILD_REVIEW,
          treeHash: null,
          lastReason: 'prior mechanical laps',
          priorVerdict: true,
          resolvedBefore: 0,
        },
      },
    });
    await writeFile(
      join(fixture.worktree, '.pipeline', 'build-review.json'),
      JSON.stringify(joinBuildReviewRubricOutcomes({
        lapId,
        snapshotDigest: 'sha256:prior',
        results: {
          testQuality: { kind: 'infrastructure-failure', rubric: 'testQuality', reason: 'provider-error', detail: 'offline' },
        },
      })),
    );
    // The planted FAIL aggregate is a prior lap's verdict; any routing it
    // earns is the ordinary semantic path, so the sentinel stops the run at
    // the first step dispatched after build_review.
    const runner: StepRunner = {
      run: async (step) => step === 'build_review'
        ? { success: false, output: 'grader crashed before judging' }
        : { success: false, output: `sentinel: ${step}` },
    };
    const events = new ConductorEventEmitter();
    const exhausted = captureExhausted(events);

    await new Conductor(conductorOptions(fixture, runner, events)).run();

    const halt = await readFile(join(fixture.worktree, HALT_MARKER), 'utf8');
    expect({ exhausted, haltClass: await readHaltClass(fixture.worktree) }).toEqual({
      exhausted: [],
      haltClass: 'needs-human',
    });
    expect(halt).not.toContain('mechanical fault allowance exhausted');
    expect(halt).not.toContain('record-reduced-coverage');
  });
});
