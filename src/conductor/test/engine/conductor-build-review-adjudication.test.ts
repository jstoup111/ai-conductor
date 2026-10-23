// Covers: task:1, task:4, task:5, task:7, task:8, task:15, task:18, task:16, task:19, task:20, task:rem-as-built-rem-ab1-4, task:rem-as-built-rem-ab2-4, task:rem-as-built-rem-ab3-1, task:rem-as-built-rem-as-built-r12-2
//
// Task 18's production-wiring clauses. Three build laps closed the components
// and left the seam open: the coordinator was reachable, but the deferral
// dependencies, the durable BUILD handoff, and the covered/uncovered
// infrastructure distinction were not. Done-when 7 makes a bounded fixture
// necessary but not sufficient, so every assertion below observes the
// PRODUCTION call path — the real `Conductor` branch, the real coordinator, the
// real effects, with fakes only at the provider and `gh` boundaries.
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CompletionContext } from '../../src/engine/artifacts.js';
import type { StepRunner, StepRunResult, StepRunOptions } from '../../src/engine/conductor.js';
import type { chargeBuildReviewEffectInLedger } from '../../src/engine/kickback-ledger.js';
import { joinBuildReviewRubricOutcomes, projectBuildReviewAggregateSources } from '../../src/engine/build-review-aggregate.js';
import { buildReviewAdjudicationSourceId } from '../../src/engine/build-review-adjudication-context.js';
import { BuildReviewDispositionStore } from '../../src/engine/build-review-dispositions.js';
import { parseChildId, pipelinePathFor } from '../../src/engine/child-context.js';
import { parseBuildReviewLapId, type BuildReviewFinding } from '../../src/engine/build-review-domain.js';
import { canonicalizeBuildReviewFindingIdentity } from '../../src/engine/build-review-finding-identity.js';
import { stampBuildReviewCustomJudgedResult } from '../../src/engine/build-review-finding-identity.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import * as remediationCaseReconciler from '../../src/engine/remediation-case-reconciler.js';
import { RemediationCaseStore } from '../../src/engine/remediation-case-store.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import type { ConductorEvent } from '../../src/types/events.js';
import { Conductor } from '../test-conductor.js';

const LAP_ID = parseBuildReviewLapId('lap-adjudication')!;
const SNAPSHOT = 'sha256:snapshot';
const HASH = `sha256:${'b'.repeat(64)}`;
const CUSTOM_DIGEST = `sha256:${'c'.repeat(64)}`;

const FINDING: BuildReviewFinding = {
  concernKind: 'test-insensitive',
  summary: 'The changed assertion passes against reverted production.',
  evidenceLocations: ['test/example.test.ts:8'],
  anchor: { rubric: 'testQuality', locus: { path: 'test/example.test.ts', contentHash: HASH, display: 'example behavior' } },
};

const FINDING_ID = canonicalizeBuildReviewFindingIdentity({
  rubric: 'testQuality', contractVersion: 'v3', concernKind: FINDING.concernKind, anchor: FINDING.anchor,
})!.id;
const SOURCE_ID = `testQuality:${FINDING_ID}`;

const RE_RAISED_FINDING: BuildReviewFinding = {
  concernKind: 'test-insensitive',
  summary: 'A second changed assertion still passes against reverted production.',
  evidenceLocations: ['test/another-example.test.ts:12'],
  anchor: { rubric: 'testQuality', locus: { path: 'test/another-example.test.ts', contentHash: `sha256:${'d'.repeat(64)}`, display: 'another example behavior' } },
};
const RE_RAISED_FINDING_ID = canonicalizeBuildReviewFindingIdentity({
  rubric: 'testQuality', contractVersion: 'v3', concernKind: RE_RAISED_FINDING.concernKind, anchor: RE_RAISED_FINDING.anchor,
})!.id;
const RE_RAISED_SOURCE_ID = `testQuality:${RE_RAISED_FINDING_ID}`;

function failOnlyDecisionStopMutation() {
  const originalMutate = RemediationCaseStore.prototype.mutate;
  return vi.spyOn(RemediationCaseStore.prototype, 'mutate').mockImplementation(async function (this: RemediationCaseStore, callback) {
    const probe = await callback({ version: 'v1', feature: { version: 'v1', repository: 'probe', feature: 'probe' }, cases: [] });
    const value = (probe as { value?: unknown }).value;
    if (typeof value === 'object' && value !== null && 'status' in value &&
      ['persisted', 'already-persisted', 'already-resolved'].includes((value as { status?: string }).status ?? '')) {
      return { ok: false, reason: 'malformed-state' } as never;
    }
    return originalMutate.call(this, callback);
  });
}

function aggregate(kind: 'judged' | 'mixed'): unknown {
  return joinBuildReviewRubricOutcomes({
    lapId: LAP_ID, snapshotDigest: SNAPSHOT,
    results: kind === 'judged'
      ? { testQuality: { kind: 'judged', rubric: 'testQuality', lapId: LAP_ID, snapshotDigest: SNAPSHOT, contractVersion: 'v3', findings: [FINDING], verdict: 'FAIL' } }
      : { testQuality: { kind: 'infrastructure-failure', rubric: 'testQuality', reason: 'provider-error', detail: 'provider unavailable' } },
  });
}

/** Incident 1: S was attempted and failed under R; a new judgement merges S into N with fresh live work. */
function reRaisedAggregate(): unknown {
  return joinBuildReviewRubricOutcomes({
    lapId: LAP_ID, snapshotDigest: SNAPSHOT,
    results: {
      testQuality: {
        kind: 'judged', rubric: 'testQuality', lapId: LAP_ID, snapshotDigest: SNAPSHOT,
        contractVersion: 'v3', findings: [FINDING, RE_RAISED_FINDING], verdict: 'FAIL',
      },
    },
  });
}

/** A mechanically clean lap: the current content set is empty by construction. */
function passAggregate(): unknown {
  return joinBuildReviewRubricOutcomes({
    lapId: LAP_ID, snapshotDigest: SNAPSHOT,
    results: {
      testQuality: {
        kind: 'judged', rubric: 'testQuality', lapId: LAP_ID, snapshotDigest: SNAPSHOT,
        contractVersion: 'v3', findings: [], verdict: 'PASS',
      },
      security: {
        kind: 'judged', rubric: 'security', lapId: LAP_ID, snapshotDigest: SNAPSHOT,
        contractVersion: 'v3', findings: [], verdict: 'PASS',
      },
      implementationQuality: {
        kind: 'judged', rubric: 'implementationQuality', lapId: LAP_ID, snapshotDigest: SNAPSHOT,
        contractVersion: 'v3', findings: [], verdict: 'PASS',
      },
    },
  });
}

/** A built-in-only raw FAIL whose sole finding is below the configured floor. */
function advisoryAggregate({ infrastructure = false }: { readonly infrastructure?: boolean } = {}): unknown {
  return joinBuildReviewRubricOutcomes({
    lapId: LAP_ID, snapshotDigest: SNAPSHOT,
    results: {
      testQuality: {
        kind: 'judged', rubric: 'testQuality', lapId: LAP_ID, snapshotDigest: SNAPSHOT,
        contractVersion: 'v4', findings: [{ ...FINDING, severity: 'minor' }], verdict: 'FAIL',
      },
      security: infrastructure
        ? { kind: 'infrastructure-failure', rubric: 'security', reason: 'provider-error', detail: 'provider unavailable' }
        : { kind: 'judged', rubric: 'security', lapId: LAP_ID, snapshotDigest: SNAPSHOT, contractVersion: 'v4', findings: [], verdict: 'PASS' },
      implementationQuality: {
        kind: 'judged', rubric: 'implementationQuality', lapId: LAP_ID, snapshotDigest: SNAPSHOT,
        contractVersion: 'v4', findings: [], verdict: 'PASS',
      },
    },
  });
}

function customAggregate() {
  const declaration = {
    version: 'v1' as const, rubricId: 'portable', semanticSkill: 'portable-policy',
    question: 'Does this preserve the portable policy boundary?', source: 'project' as const, resources: [],
  };
  const sourceRegion = {
    path: 'src/portable.ts', startLine: 4, endLine: 8, contentHash: HASH, display: 'portable boundary',
  };
  const result = stampBuildReviewCustomJudgedResult({
    kind: 'custom-findings', version: 'v2', findings: [{
      concernId: 'portable-boundary-gap', summary: 'The changed portable boundary lacks its required proof.',
      evidenceLocations: ['src/portable.ts:4'], sourceRegions: [sourceRegion], confidence: 91, severity: 'major',
    }],
  }, {
    rubric: 'portable', lapId: LAP_ID, declaration,
    policy: { version: 'v1', bundleDigest: CUSTOM_DIGEST },
    candidate: { provider: 'codex', model: 'gpt-5.6-sol', effort: 'medium' },
    reviewedInput: { version: 'v1', contentDigest: CUSTOM_DIGEST },
  }, { sourceRegions: [sourceRegion] })!;
  return joinBuildReviewRubricOutcomes({
    lapId: LAP_ID, snapshotDigest: SNAPSHOT,
    results: {
      testQuality: {
        kind: 'judged', rubric: 'testQuality', lapId: LAP_ID, snapshotDigest: SNAPSHOT,
        contractVersion: 'v3', findings: [], verdict: 'PASS',
      },
    },
    customResults: {
      portable: {
        descriptor: {
          version: 'v1', semanticSkill: 'portable-policy', declaration,
          installation: { source: 'project' }, effectivePolicy: result.policy,
          reviewedInput: result.reviewedInput, producer: result.candidate,
        },
        result,
      },
    },
    currentCustomRubrics: ['portable'],
  } as never);
}

function customInfrastructureAggregate() {
  const declaration = {
    version: 'v1' as const, rubricId: 'portable', semanticSkill: 'portable-policy',
    question: 'Does this preserve the portable policy boundary?', source: 'project' as const, resources: [],
  };
  return joinBuildReviewRubricOutcomes({
    lapId: LAP_ID, snapshotDigest: SNAPSHOT,
    results: {
      testQuality: {
        kind: 'judged', rubric: 'testQuality', lapId: LAP_ID, snapshotDigest: SNAPSHOT,
        contractVersion: 'v3', findings: [], verdict: 'PASS',
      },
    },
    customResults: {
      portable: {
        declaration,
        result: {
          kind: 'infrastructure-failure' as const, rubric: 'portable',
          reason: 'policy-load-failed' as const, detail: 'policy could not be loaded',
        },
      },
    },
    currentCustomRubrics: ['portable'],
  } as never);
}

/** A valid judged lap whose only blocker is retained scope incompleteness. */
function scopeIncompleteAggregate(): unknown {
  return joinBuildReviewRubricOutcomes({
    lapId: LAP_ID, snapshotDigest: SNAPSHOT,
    results: {
      testQuality: {
        kind: 'judged', rubric: 'testQuality', lapId: LAP_ID, snapshotDigest: SNAPSHOT,
        contractVersion: 'v3', findings: [], verdict: 'PASS',
        scopeResolutions: [{
          candidateId: 'candidate:setup', status: 'indeterminate',
          sourceRegion: { path: 'test/example.test.ts', startLine: 2, endLine: 3, contentHash: HASH, display: 'example setup' },
          obligationReferences: ['story:S6.2'], missingEvidenceReason: 'the pinned binding is incomplete',
        }],
      },
    },
  });
}

function actionJudgement(): unknown {
  return {
    mode: 'case-v1', domain: 'build_review',
    sourceOutcomes: [{ sourceId: SOURCE_ID, outcome: 'acted', caseRef: 'case-1' }],
    cases: [{
      caseRef: 'case-1', disposition: 'act', priority: 'high', confidence: 'high',
      rationale: 'The changed test needs a focused assertion.',
      effect: { kind: 'action', route: 'build', tasks: [{ title: 'test/example.test.ts:8 — assert the rejection path' }] },
    }],
  };
}

function reRaisedActionJudgement(): unknown {
  return {
    mode: 'case-v1', domain: 'build_review',
    sourceOutcomes: [
      { sourceId: SOURCE_ID, outcome: 'merged', caseRef: 'case-N' },
      { sourceId: RE_RAISED_SOURCE_ID, outcome: 'acted', caseRef: 'case-N' },
    ],
    cases: [{
      caseRef: 'case-N', disposition: 'act', priority: 'high', confidence: 'high',
      rationale: 'The re-raised evidence and the new assertion need one focused repair.',
      effect: { kind: 'action', route: 'build', tasks: [{ title: 'test/another-example.test.ts:12 — assert the rejection path' }] },
    }],
  };
}

function deferralJudgement(): unknown {
  return {
    mode: 'case-v1', domain: 'build_review',
    sourceOutcomes: [{ sourceId: SOURCE_ID, outcome: 'deferred', caseRef: 'case-1' }],
    cases: [{
      caseRef: 'case-1', disposition: 'defer', priority: 'low', confidence: 'high',
      rationale: 'The repair belongs to a separately planned change.',
      effect: { kind: 'deferral', title: 'Deferred build-review finding', body: 'The changed assertion is insensitive.', exclusionRationale: 'Outside this feature plan.' },
    }],
  };
}

function customActionJudgement(sourceId: string): unknown {
  return {
    mode: 'case-v2', domain: 'build_review',
    sourceOutcomes: [{ sourceId, outcome: 'acted', caseRef: 'portable-case' }],
    cases: [{
      caseRef: 'portable-case', disposition: 'act', priority: 'high', confidence: 'high',
      rationale: 'The admitted task repairs the portable policy boundary.',
      effect: { kind: 'action', route: 'build', tasks: [{
        title: 'Repair the portable policy boundary.', admittedTaskIds: ['32'],
        admissionRationale: 'Task 32 owns the shared custom outcome.',
      }] },
    }],
    consistency: {
      verdict: 'consistent', sourceIds: [sourceId], caseRefs: ['portable-case'],
      rationale: 'One admitted repair covers the complete custom source set.',
    },
  };
}

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface FixtureOptions {
  readonly judgement?: unknown;
  /** Rubric ids the operator has covered with an exact reduced-coverage decision. */
  readonly infrastructure?: 'none' | 'covered' | 'uncovered';
  /**
   * Report uncovered infrastructure alongside a judged content finding.
   * Today's registry holds one rubric, so a genuinely mixed aggregate cannot be
   * built in production; the effective projection is the seam the conductor
   * actually reads for its mechanical state, so drive it there.
   */
  readonly reportUncoveredInfrastructure?: boolean;
  /** Models the scope-only mechanical route after an indeterminate candidate. */
  readonly scopeIncomplete?: 'covered' | 'uncovered';
  /** Writes durable `.pipeline` artifacts a previous process would have left. */
  readonly seedPipeline?: (projectRoot: string) => Promise<void>;
  readonly startFrom?: StepName;
  readonly adjudicationEnabled?: boolean;
  /** Forces an actual BUILD entry without relying on durable retry recovery. */
  readonly buildPending?: boolean;
  readonly chargeEffect?: typeof chargeBuildReviewEffectInLedger;
  /** A clean lap. The adjudication coordinator never runs for one. */
  readonly rawVerdict?: 'PASS' | 'FAIL';
  /** Drives the built-in-only effective-PASS advisory path. */
  readonly advisory?: boolean;
  /** Adds an infrastructure failure to the advisory-only aggregate. */
  readonly advisoryInfrastructure?: boolean;
  /** Attended mode must share the settlement seam with daemon execution. */
  readonly attended?: boolean;
  /** Models an operator disposition arriving through the event spine mid-lap. */
  readonly acceptedFindingIds?: () => readonly string[];
  /** Models the effective-verdict projection of sub-floor findings. */
  readonly suppressedFindingIds?: readonly string[];
  /** Models sources an earlier remediate case already settled. */
  readonly settledFindingIds?: readonly string[];
  readonly onLifecycleEvent?: (event: ConductorEvent) => void;
  /** A real custom aggregate must route through the case-v2 production branch. */
  readonly custom?: boolean;
  /** Models a current custom-rubric infrastructure failure. */
  readonly customInfrastructure?: boolean;
  /** A feature-owned creation capability is available unless this fake denies it. */
  readonly featureCreationAuthorized?: boolean;
  /** Replays incident 1: an action already failed on S and a judgement re-raises it with new work. */
  readonly reRaised?: boolean;
  /** Attach the production event-spine persister when a test observes durable event order. */
  readonly persistEvents?: boolean;
}

async function fixture(options: FixtureOptions = {}) {
  const projectRoot = await mkdtemp(join(tmpdir(), 'conductor-build-review-adjudication-'));
  roots.push(projectRoot);
  const feature = { version: 'v1' as const, repository: projectRoot, feature: 'adjudicated-feature' };
  await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
  await mkdir(join(projectRoot, '.docs', 'plans'), { recursive: true });
  await writeFile(join(projectRoot, '.docs', 'plans', 'feature.md'), '# Plan\n\n### Task 32: shared outcome\n**Files:** src/portable.ts\n', 'utf8');
  await writeFile(join(projectRoot, '.pipeline/task-status.json'), JSON.stringify({ tasks: [{ id: '1', status: 'completed' }, { id: '32', status: 'in_progress' }] }), 'utf8');
  await options.seedPipeline?.(projectRoot);

  const statePath = join(projectRoot, '.pipeline', 'state.json');
  const state: Record<string, unknown> = {
    complexity_tier: 'M', run_started_at: 1,
    feature_desc: 'adjudicated-feature', worktree_branch: 'feature/adjudicated-feature',
  };
  for (const step of ALL_STEPS) if (step.name !== 'build_review') state[step.name] = 'done';
  if (options.startFrom === 'build') state.build_review = 'done';
  if (options.buildPending) state.build = 'pending';
  await writeState(statePath, state as ConductState);

  const mixed = options.infrastructure && options.infrastructure !== 'none';
  const scopeIncomplete = options.scopeIncomplete !== undefined;
  const clean = options.rawVerdict === 'PASS';
  const raw = clean ? passAggregate() : options.advisory ? advisoryAggregate({ infrastructure: options.advisoryInfrastructure }) : options.reRaised ? reRaisedAggregate() : options.customInfrastructure ? customInfrastructureAggregate() : options.custom ? customAggregate() : scopeIncomplete ? scopeIncompleteAggregate() : aggregate(mixed ? 'mixed' : 'judged');

  const dispatched: StepName[] = [];
  const artifactMtimes = new Map<string, number>();
  const retryReasons = new Map<StepName, string>();
  let remediateDispatches = 0;
  const runner: StepRunner = {
    run: async (step: StepName, _state: ConductState, opts?: StepRunOptions): Promise<StepRunResult> => {
      dispatched.push(step);
      if (opts?.retryReason !== undefined) retryReasons.set(step, opts.retryReason);
      if (step === 'build') throw new Error('stop after BUILD dispatch');
      if (step === 'remediate') {
        remediateDispatches += 1;
        await writeFile(join(projectRoot, '.pipeline/remediation.json'), JSON.stringify(options.judgement ?? (options.reRaised ? reRaisedActionJudgement() : actionJudgement())), 'utf8');
        return { success: true };
      }
      if (step === 'build_review') {
        await writeFile(join(projectRoot, '.pipeline/build-review.json'), JSON.stringify(raw), 'utf8');
        return { success: true };
      }
      return { success: true };
    },
  };

  const infrastructureRubrics = mixed || options.reportUncoveredInfrastructure
    ? (['testQuality'] as const)
    : options.advisoryInfrastructure ? (['security'] as const)
    : options.customInfrastructure ? (['portable'] as const) : ([] as const);
  const uncovered = options.infrastructure === 'uncovered' || options.reportUncoveredInfrastructure
    ? (['testQuality'] as const)
    : options.advisoryInfrastructure ? (['security'] as const)
    : options.customInfrastructure ? (['portable'] as const) : ([] as const);
  const uncoveredScopeIncomplete = options.scopeIncomplete === 'uncovered'
    ? (['testQuality'] as const) : ([] as const);
  const resolver: NonNullable<CompletionContext['buildReviewEffectiveResolver']> = vi.fn(async () => {
    const acceptedFindingIds = [...(options.acceptedFindingIds?.() ?? [])];
    const suppressedFindingIds = [...(options.suppressedFindingIds ?? [])];
    const settledFindingIds = [...(options.settledFindingIds ?? [])];
    const advisoryFindingIds = options.advisory ? [FINDING_ID] : [];
    const effectivePass = clean || suppressedFindingIds.includes(FINDING_ID) || options.advisory === true;
    return {
      ok: true as const,
      feature,
      effective: {
        rawVerdict: clean ? ('PASS' as const) : ('FAIL' as const),
        verdict: effectivePass ? ('PASS' as const) : ('FAIL' as const),
        acceptedFindingIds,
        unresolvedFindingIds: mixed || scopeIncomplete || effectivePass || acceptedFindingIds.includes(FINDING_ID)
          ? [] : options.reRaised ? [FINDING_ID, RE_RAISED_FINDING_ID] : [FINDING_ID],
        suppressedFindingIds,
        settledFindingIds,
        ...(advisoryFindingIds.length === 0 ? {} : { advisoryFindingIds }),
        skippedRubrics: [],
        infrastructureFailureRubrics: [...infrastructureRubrics],
        uncoveredInfrastructureFailureRubrics: [...uncovered],
        uncoveredScopeIncompleteRubrics: [...uncoveredScopeIncomplete],
        ...(scopeIncomplete ? { scopeIncompleteRubrics: ['testQuality'] } : {}),
        ...(options.infrastructure === 'covered' || options.scopeIncomplete === 'covered'
          ? { hasRecordedReducedCoverage: true }
          : {}),
      },
    };
  }) as never;

  const ghCalls: string[][] = [];
  const gh = vi.fn(async (args: string[]) => {
    ghCalls.push(args);
    if (args[0] === 'repo' && args[1] === 'view') return { stdout: JSON.stringify({ nameWithOwner: 'acme/conductor' }) };
    if (args[0] === 'issue' && args[1] === 'list') return { stdout: '[]' };
    if (args[0] === 'issue' && args[1] === 'create') return { stdout: 'https://github.com/acme/conductor/issues/77\n' };
    return { stdout: '{}' };
  });

  const events = new ConductorEventEmitter();
  const persister = options.persistEvents
    ? new EventPersister(join(projectRoot, '.pipeline', 'events.jsonl'), events)
    : undefined;
  persister?.start();
  const kickbacks: Array<{ from: string; to: string }> = [];
  const kickbackEvidence: string[] = [];
  const gateVerdicts: Array<{ step: StepName; satisfied: boolean }> = [];
  const lifecycle: ConductorEvent[] = [];
  const loopHalts: ConductorEvent[] = [];
  events.on('kickback', (event) => { if (event.type === 'kickback') { kickbacks.push({ from: event.from, to: event.to }); kickbackEvidence.push(event.evidence ?? ''); } });
  events.on('gate_verdict', (event) => {
    if (event.type === 'gate_verdict') gateVerdicts.push({ step: event.step, satisfied: event.satisfied });
  });
  events.on('loop_halt', (event) => { loopHalts.push(event); });
  for (const type of [
    'remediation_adjudication_started', 'remediation_adjudication_completed', 'remediation_adjudication_failed',
    'remediation_effect_applied', 'remediation_case_reconciled', 'remediation_case_operator_resolved',
    'build_review_acceptance_carried',
  ] as const) {
    events.on(type, (event) => {
      lifecycle.push(event);
      options.onLifecycleEvent?.(event);
    });
  }

  const conductor = new Conductor({
    projectRoot,
    stateFilePath: statePath,
    stepRunner: runner,
    events,
    fromStep: options.startFrom ?? 'build_review',
    verifyArtifacts: true,
    mode: options.attended ? 'default' : 'auto',
    daemon: !options.attended,
    config: {
      kickback_escalation: { enabled: false },
      build_review: {
        adjudication: { enabled: options.adjudicationEnabled ?? true },
        rubrics: { testQuality: { enabled: true, min_confidence: 70, ...(options.advisory ? { min_severity: 'major' as const } : {}) } },
        ...(options.custom ? { custom_rubrics: {
          portable: { enabled: true, skill: 'portable-policy', question: 'Does this preserve the portable policy boundary?', source: 'project' },
        } } : {}),
      },
    },
    buildReviewEffectiveResolver: resolver,
    buildReviewChargeEffect: options.chargeEffect,
    resolveFeatureCreationMutation: async () => options.featureCreationAuthorized === false ? undefined : ({
      provenance: {
        repository: 'acme/conductor', defaultBranch: 'origin/main', specBranch: 'feature/adjudicated-feature',
        featureMarker: '.docs/intake/adjudicated-feature.md', publication: 'initial',
      },
      dependencies: {
        resolveMachineOwner: async () => ({ resolved: true as const, id: 'alice' }),
        provenanceDiscovery: {
          readCommittedRecords: async () => [{ path: '.docs/intake/adjudicated-feature.md', content: 'Owner: alice\n' }],
        },
      },
    }),
    gh,
  } as never);
  for (const relative of ['.pipeline/remediation-cases.json', '.pipeline/build-review-work-order.json']) {
    await stat(join(projectRoot, relative)).then((metadata) => artifactMtimes.set(relative, metadata.mtimeMs)).catch(() => {});
  }

  try {
    await conductor.run().catch((error: unknown) => {
      if (!(error instanceof Error) || !error.message.startsWith('stop after')) throw error;
    });
  } finally {
    persister?.stop();
  }

  return {
    projectRoot, feature, dispatched, retryReasons, kickbacks, kickbackEvidence, gateVerdicts, lifecycle, loopHalts, ghCalls, resolver,
    remediateDispatches: () => remediateDispatches, artifactMtimes,
    readJson: async (relative: string): Promise<unknown> =>
      JSON.parse(await readFile(join(projectRoot, relative), 'utf8')) as unknown,
    state: async (): Promise<ConductState> =>
      JSON.parse(await readFile(statePath, 'utf8')) as ConductState,
    events: async (): Promise<ConductorEvent[]> => (await readFile(join(projectRoot, '.pipeline', 'events.jsonl'), 'utf8'))
      .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as ConductorEvent),
    haltMarker: async (): Promise<string> => readFile(join(projectRoot, '.pipeline/HALT'), 'utf8').catch(() => ''),
  };
}

describe('engine/conductor — build_review post-join adjudication wiring', () => {
  async function expectRefusedDecisionStopHalt(blockedConsistency: boolean) {
    const customSource = projectBuildReviewAggregateSources(customAggregate())![0]!;
    const sourceId = buildReviewAdjudicationSourceId(customSource);
    const run = await fixture({
      custom: true,
      seedPipeline: async (root) => {
        await writeFile(join(root, '.pipeline', 'remediation-cases.json'), JSON.stringify({
          version: 'v1', feature: { version: 'v1', repository: root, feature: 'adjudicated-feature' },
          cases: [{
            id: 'case-owner', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
            rationale: 'The existing repair remains open.', resolution: 'open',
            sources: [{ sourceId, outcome: 'acted', recordedAt: '2026-10-20T00:00:00.000Z' }],
            effect: { id: 'effect-owner', kind: 'action', status: 'applied', workOrderId: 'order-owner' },
          }],
        }), 'utf8');
      },
      judgement: {
        mode: 'case-v2', domain: 'build_review',
        sourceOutcomes: [{ sourceId, outcome: 'escalate', caseRef: 'case-stop' }],
        cases: [{
          caseRef: 'case-stop', disposition: 'escalate', priority: 'high', confidence: 'high',
          rationale: 'The owner must decide.', effect: { kind: 'none' }, escalation: { owner: 'architecture' },
        }],
        consistency: blockedConsistency
          ? { verdict: 'blocked', sourceIds: [sourceId], caseRefs: ['case-stop'], rationale: 'The proposals conflict.' }
          : { verdict: 'consistent', sourceIds: [sourceId], caseRefs: ['case-stop'], rationale: 'The owner stop is the only outcome.' },
      },
    });
    const halt = await run.haltMarker();
    const failed = run.lifecycle.find((event) => event.type === 'remediation_adjudication_failed');
    if (!failed || failed.type !== 'remediation_adjudication_failed' || !failed.rejectedTransition) {
      throw new Error('expected the refused decision-stop transition event');
    }
    const proposedStopId = failed.rejectedTransition.caseIds.find((caseId) => caseId !== 'case-owner');

    expect(await readFile(join(run.projectRoot, '.pipeline', 'HALT.class'), 'utf8')).toBe('needs-human');
    expect(halt).toContain('case transition rejected: source-linked-by-multiple-cases');
    expect(halt).toContain('case-owner');
    expect(halt).toContain(proposedStopId ?? 'missing-proposed-stop');
    expect(halt).toContain(sourceId);
    expect(halt).toContain('persisted case history is valid and unchanged');
  }

  // Covers: task:7
  it('through build_review writes a needs-human HALT for the refused explicit-escalation lap', async () => {
    await expectRefusedDecisionStopHalt(false);
  });

  // Covers: task:7
  it('through build_review writes a needs-human HALT for the refused blocked-consistency lap', async () => {
    await expectRefusedDecisionStopHalt(true);
  });

  // Covers: task:9
  it('halts an at-limit undeclared recurrence through the real build_review step before BUILD dispatch', async () => {
    const run = await fixture({
      seedPipeline: async (root) => {
        const feature = { version: 'v1', repository: root, feature: 'adjudicated-feature' };
        await writeFile(join(root, '.pipeline', 'remediation-cases.json'), JSON.stringify({
          version: 'v1', feature,
          cases: [
            {
              id: 'R', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high', rationale: 'First repair.', resolution: 'resolved',
              sources: [{ sourceId: SOURCE_ID, outcome: 'acted', recordedAt: '2026-10-01T00:00:00.000Z' }],
              effect: { id: 'effect-R', kind: 'action', status: 'applied', workOrderId: 'order-R' },
            },
            {
              id: 'N', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high', rationale: 'Second repair.', resolution: 'resolved', recurrenceOf: ['R'],
              sources: [{ sourceId: SOURCE_ID, outcome: 'acted', recordedAt: '2026-10-02T00:00:00.000Z' }],
              effect: { id: 'effect-N', kind: 'action', status: 'applied', workOrderId: 'order-N' },
            },
            {
              id: 'N2', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high', rationale: 'Third repair.', resolution: 'resolved', recurrenceOf: ['N'],
              sources: [{ sourceId: SOURCE_ID, outcome: 'acted', recordedAt: '2030-10-03T00:00:00.000Z' }],
              effect: { id: 'effect-N2', kind: 'action', status: 'applied', workOrderId: 'order-N2' },
            },
          ],
        }), 'utf8');
      },
    });
    const halt = await run.haltMarker();
    expect(await readFile(join(run.projectRoot, '.pipeline', 'HALT.class'), 'utf8')).toBe('needs-human');
    expect(halt).toContain('semantic remediation case recurrence limit N2: lineage R, N, N2 has 3 applied attempts (limit 3)');
    expect(run.dispatched).not.toContain('build');
  });

  it('writes a decision-stop malformed-state HALT without rejected-transition recovery guidance', async () => {
    const customSource = projectBuildReviewAggregateSources(customAggregate())![0]!;
    const sourceId = buildReviewAdjudicationSourceId(customSource);
    const mutation = failOnlyDecisionStopMutation();
    try {
      const run = await fixture({
        custom: true,
        judgement: {
          mode: 'case-v2', domain: 'build_review',
          sourceOutcomes: [{ sourceId, outcome: 'escalate', caseRef: 'case-stop' }],
          cases: [{
            caseRef: 'case-stop', disposition: 'escalate', priority: 'high', confidence: 'high',
            rationale: 'The owner must decide.', effect: { kind: 'none' }, escalation: { owner: 'architecture' },
          }],
          consistency: { verdict: 'consistent', sourceIds: [sourceId], caseRefs: ['case-stop'], rationale: 'One owner decision is needed.' },
        },
      });
      const halt = await run.haltMarker();
      const failed = run.lifecycle.find((event) => event.type === 'remediation_adjudication_failed');

      expect(await readFile(join(run.projectRoot, '.pipeline', 'HALT.class'), 'utf8')).toBe('needs-human');
      expect(halt).toContain('decision stop case store malformed-state');
      expect(halt).not.toMatch(/case transition rejected|source-linked-by-multiple-cases|persisted case history is valid/);
      expect(failed).toMatchObject({ type: 'remediation_adjudication_failed', reason: 'decision stop case store malformed-state' });
      expect(failed).not.toHaveProperty('rejectedTransition');
    } finally {
      mutation.mockRestore();
    }
  });

  it('halts a rejected transition with trusted-history recovery guidance before BUILD dispatch', async () => {
    let persisted = '';
    const run = await fixture({
      seedPipeline: async (root) => {
        persisted = JSON.stringify({
          version: 'v1',
          feature: { version: 'v1', repository: root, feature: 'adjudicated-feature' },
          cases: [{
            id: 'case-O', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
            rationale: 'The earlier repair was applied.', resolution: 'open',
            sources: [
              { sourceId: SOURCE_ID, outcome: 'acted', recordedAt: '2026-10-10T12:00:00.000Z' },
              { sourceId: 'testQuality:prior-finding', outcome: 'acted', recordedAt: '2026-10-10T12:00:00.000Z' },
            ],
            effect: { id: 'effect-O', kind: 'action', status: 'applied', workOrderId: 'work-order-O' },
          }],
        });
        await writeFile(join(root, '.pipeline', 'remediation-cases.json'), persisted, 'utf8');
      },
    });
    const rejection = run.lifecycle.find((event) => event.type === 'remediation_adjudication_failed');
    if (!rejection || rejection.type !== 'remediation_adjudication_failed') throw new Error('expected a rejected-transition event');
    const halt = await run.haltMarker();

    expect({
      halt,
      haltClass: await readFile(join(run.projectRoot, '.pipeline', 'HALT.class'), 'utf8'),
      store: await readFile(join(run.projectRoot, '.pipeline', 'remediation-cases.json'), 'utf8'),
      dispatchedBuild: run.dispatched.includes('build'),
      rejectedTransition: rejection.rejectedTransition,
    }).toMatchObject({
      halt: expect.stringContaining('build_review adjudication halted: case transition rejected: source-linked-by-multiple-cases'),
      haltClass: 'needs-human',
      store: persisted,
      dispatchedBuild: false,
      rejectedTransition: expect.objectContaining({ caseIds: expect.arrayContaining(['case-O']), sourceIds: [SOURCE_ID] }),
    });
    expect(halt).toContain(rejection.rejectedTransition?.caseIds[1] ?? 'missing-new-case-id');
    expect(halt).toContain('persisted case history is valid and unchanged');
    expect(halt).toContain('ai-conductor build-review findings --feature adjudicated-feature');
    expect(halt).toContain('ai-conductor halt clear --feature adjudicated-feature');
    expect(halt).not.toMatch(/build-review accept|delete|remove.*remediation-cases\.json/i);
  });

  it('keeps a corrupt persisted case store malformed without trusted-history recovery guidance', async () => {
    const run = await fixture({
      seedPipeline: async (root) => {
        const feature = { version: 'v1', repository: root, feature: 'adjudicated-feature' };
        await writeFile(join(root, '.pipeline', 'remediation-cases.json'), JSON.stringify({
          version: 'v1', feature,
          cases: [{
            id: 'case-O', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
            rationale: 'The earlier repair was applied.', resolution: 'open',
            sources: [{ sourceId: SOURCE_ID, outcome: 'acted', recordedAt: '2026-10-10T12:00:00.000Z' }],
            effect: { id: 'effect-O', kind: 'action', status: 'applied', workOrderId: 'work-order-O' },
          }, {
            id: 'case-N', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
            rationale: 'The duplicate source is persisted corruption.', resolution: 'open',
            sources: [{ sourceId: SOURCE_ID, outcome: 'acted', recordedAt: '2026-10-10T12:00:00.000Z' }],
            effect: { id: 'effect-N', kind: 'action', status: 'reserved' },
          }],
        }), 'utf8');
      },
    });
    const halt = await run.haltMarker();

    expect({
      halt,
      haltClass: await readFile(join(run.projectRoot, '.pipeline', 'HALT.class'), 'utf8'),
      dispatchedBuild: run.dispatched.includes('build'),
    }).toMatchObject({
      halt: expect.stringContaining('build_review adjudication halted: suppression store malformed-state'),
      haltClass: 'needs-human',
      dispatchedBuild: false,
    });
    expect(halt).not.toContain('case transition rejected');
    expect(halt).not.toContain('persisted case history is valid');
  });

  it('passes a fully suppressed lap without adjudication or a kickback', async () => {
    const run = await fixture({ suppressedFindingIds: [FINDING_ID] });

    expect(run.remediateDispatches()).toBe(0);
    expect(run.kickbacks).toEqual([]);
    expect((await run.state()).build_review).toBe('done');
    expect(vi.mocked(run.resolver).mock.calls.map((call) => call[2])).toContainEqual(expect.objectContaining({
      minConfidence: { testQuality: 70, security: 0, implementationQuality: 0 },
    }));
  });

  it('routes one adjudicated action through one dispatch, one charge, and a durable BUILD handoff', async () => {
    const run = await fixture();

    expect(run.remediateDispatches()).toBe(1);
    expect(run.kickbacks).toEqual([{ from: 'build_review', to: 'build' }]);
    expect(run.dispatched).toContain('build');
    // Done-when 1: exactly one first action charge, keyed by the stable effect id.
    const ledger = await run.readJson('.pipeline/kickback-ledger.json') as { gates: { build_review: { count: number; chargedEffectIds: string[] } } };
    expect(ledger.gates.build_review.count).toBe(1);
    expect(ledger.gates.build_review.chargedEffectIds).toHaveLength(1);
    // Done-when 5: the BUILD retry context comes from the DURABLE order.
    const order = await run.readJson('.pipeline/build-review-work-order.json') as { effectId: string; attemptedCaseIds?: string[] };
    expect(order.effectId).toBe(ledger.gates.build_review.chargedEffectIds[0]);
    expect(run.retryReasons.get('build')).toContain(`Build-review remediation work order (effect: ${order.effectId})`);
    expect(run.retryReasons.get('build')).toContain('test/example.test.ts:8 — assert the rejection path');
    // BUILD attempt evidence is stamped before provider work, durably.
    expect(order.attemptedCaseIds).toHaveLength(1);
  });

  // Covers: task:5
  it('charges one re-raised action effect and dispatches BUILD with its durable case N work order', async () => {
    const resolvedR = {
      id: 'case-R', domain: 'build_review', disposition: 'act', priority: 'high',
      rationale: 'The earlier repair was attempted but did not settle S.', confidence: 'high', resolution: 'resolved',
      sources: [{ sourceId: SOURCE_ID, outcome: 'acted', recordedAt: '2026-10-18T00:00:00.000Z' }],
      effect: { id: 'effect-R', kind: 'action', status: 'failed', diagnostic: 'BUILD did not close the finding.' },
    };
    const charge = vi.fn(async (..._args: unknown[]) => ({
      status: 'charged' as const, exhausted: false, cumulativeExhausted: false,
      entry: { count: 2, cumulative: 5 },
    }));
    const run = await fixture({
      reRaised: true,
      chargeEffect: charge as never,
      seedPipeline: async (root) => {
        await writeFile(join(root, '.pipeline', 'remediation-cases.json'), JSON.stringify({
          version: 'v1', feature: { version: 'v1', repository: root, feature: 'adjudicated-feature' }, cases: [resolvedR],
        }), 'utf8');
      },
    });
    const cases = await run.readJson('.pipeline/remediation-cases.json') as { cases: Array<{ id: string; effect: { id: string } }> };
    const reRaisedN = cases.cases.find((record) => record.id !== 'case-R')!;
    const order = await run.readJson('.pipeline/build-review-work-order.json') as { effectId: string; cases: Array<{ caseId: string }> };

    expect(charge).toHaveBeenCalledTimes(1);
    expect(charge.mock.calls[0]![1]).toBe(reRaisedN.effect.id);
    expect(run.dispatched).toContain('build');
    expect(order).toMatchObject({ effectId: reRaisedN.effect.id, cases: [expect.objectContaining({ caseId: reRaisedN.id })] });
    expect(JSON.stringify(cases.cases.find((record) => record.id === 'case-R'))).toBe(JSON.stringify(resolvedR));
  });

  // Covers: task:5, task:9
  it('halts a re-raised action at the cumulative cap without a rejected case-store transition', async () => {
    const resolvedR = {
      id: 'case-R', domain: 'build_review', disposition: 'act', priority: 'high',
      rationale: 'The earlier repair was attempted but did not settle S.', confidence: 'high', resolution: 'resolved',
      sources: [{ sourceId: SOURCE_ID, outcome: 'acted', recordedAt: '2026-10-18T00:00:00.000Z' }],
      effect: { id: 'effect-R', kind: 'action', status: 'failed', diagnostic: 'BUILD did not close the finding.' },
    };
    const charge = vi.fn(async () => ({
      status: 'charged' as const, exhausted: false, cumulativeExhausted: true,
      entry: { count: 3, cumulative: 6 },
    }));
    const run = await fixture({
      reRaised: true,
      chargeEffect: charge as never,
      seedPipeline: async (root) => {
        await writeFile(join(root, '.pipeline', 'remediation-cases.json'), JSON.stringify({
          version: 'v1', feature: { version: 'v1', repository: root, feature: 'adjudicated-feature' }, cases: [resolvedR],
        }), 'utf8');
      },
    });
    const cases = await run.readJson('.pipeline/remediation-cases.json') as { cases: Array<{ id: string; effect: { id: string } }> };
    const reRaisedN = cases.cases.find((record) => record.id !== 'case-R')!;
    const halt = await run.haltMarker();
    const forbidden = /case transition rejected|source-linked-by-multiple-cases|duplicate-case-id|duplicate-effect-id|invalid-next-state/;

    expect(charge).toHaveBeenCalledTimes(1);
    expect(run.dispatched).not.toContain('build');
    expect(halt).toContain(`build-review kickback budget exhausted (cumulative): blocked cases ${reRaisedN.id} (effect ${reRaisedN.effect.id})`);
    expect(halt).not.toContain('recurrence limit');
    expect(halt).not.toMatch(forbidden);
    expect(run.lifecycle).not.toContainEqual(expect.objectContaining({ rejectedTransition: expect.anything() }));
    expect(run.lifecycle.map((event) => JSON.stringify(event)).join('\n')).not.toMatch(forbidden);
    expect(JSON.stringify(cases.cases.find((record) => record.id === 'case-R'))).toBe(JSON.stringify(resolvedR));
  });

  it('selects case-v2 for a custom source and releases only its shared authorized action after settlement', async () => {
    const customSource = projectBuildReviewAggregateSources(customAggregate())![0]!;
    const run = await fixture({
      custom: true,
      judgement: customActionJudgement(buildReviewAdjudicationSourceId(customSource)),
    });

    // This is the actual Conductor prompt boundary: case-v2 is derived from
    // the assembled custom context, not a test-only judgement fixture.
    expect(run.retryReasons.get('remediate')).toContain('write case-v2 remediation output');
    // The shared outcome first validates/settles the v2 graph, then exposes
    // its one admitted action as the durable BUILD work order.
    expect(run.dispatched).toContain('build');
    await expect(run.readJson('.pipeline/remediation-cases.json')).resolves.toMatchObject({
      cases: [expect.objectContaining({ disposition: 'act', effect: expect.objectContaining({ kind: 'action', status: 'applied' }) })],
    });
    await expect(run.readJson('.pipeline/build-review-work-order.json')).resolves.toMatchObject({
      cases: [expect.objectContaining({ tasks: [expect.objectContaining({ admittedTaskIds: ['32'] })] })],
    });
  });

  it('names every structured decision stop — case, owner, sources, rationale — in the needs-human halt', async () => {
    const customSource = projectBuildReviewAggregateSources(customAggregate())![0]!;
    const sourceId = buildReviewAdjudicationSourceId(customSource);
    const run = await fixture({
      custom: true,
      judgement: {
        mode: 'case-v2', domain: 'build_review',
        sourceOutcomes: [{ sourceId, outcome: 'escalate', caseRef: 'plan-stop' }],
        cases: [{
          caseRef: 'plan-stop', disposition: 'escalate', priority: 'high', confidence: 'high',
          rationale: 'The approved plan needs an owner decision before repair.',
          effect: { kind: 'none' }, escalation: { owner: 'plan' },
        }],
        consistency: {
          verdict: 'blocked', sourceIds: [sourceId], caseRefs: ['plan-stop'],
          rationale: 'The source cannot be repaired under the current approved plan.',
        },
      },
    });

    expect(run.dispatched).not.toContain('build');
    const halt = await run.haltMarker();
    expect(halt).toMatch(new RegExp(
      `decision stop \\S+ \\(owner: plan; sources: ${sourceId}\\): The source cannot be repaired under the current approved plan\\.`,
    ));
    expect(run.loopHalts).toEqual([expect.objectContaining({ reason: expect.stringContaining('owner: plan') })]);
  });

  it('persists an unbound architecture decision stop over resolved applied history and leaves that history byte-identical', async () => {
    const customSourceId = buildReviewAdjudicationSourceId(projectBuildReviewAggregateSources(customAggregate())![0]!);
    const resolvedR = {
      id: 'case-R', domain: 'build_review', disposition: 'act', priority: 'high',
      rationale: 'The earlier repair was applied.', confidence: 'high', resolution: 'resolved',
      sources: [{ sourceId: customSourceId, outcome: 'acted', recordedAt: '2026-10-18T00:00:00.000Z' }],
      effect: { id: 'effect-R', kind: 'action', status: 'applied', workOrderId: 'order-R' },
    };
    const run = await fixture({
      custom: true,
      seedPipeline: async (root) => {
        await writeFile(join(root, '.pipeline', 'remediation-cases.json'), JSON.stringify({
          version: 'v1', feature: { version: 'v1', repository: root, feature: 'adjudicated-feature' }, cases: [resolvedR],
        }), 'utf8');
      },
      judgement: {
        mode: 'case-v2', domain: 'build_review',
        sourceOutcomes: [{ sourceId: customSourceId, outcome: 'escalate', caseRef: 'architecture-stop' }],
        cases: [{
          caseRef: 'architecture-stop', disposition: 'escalate', priority: 'high', confidence: 'high',
          rationale: 'Architecture must decide the re-raised boundary.', effect: { kind: 'none' }, escalation: { owner: 'architecture' },
        }], consistency: { verdict: 'blocked', sourceIds: [customSourceId], caseRefs: ['architecture-stop'], rationale: 'Architecture must decide.' },
      },
    });
    const cases = await run.readJson('.pipeline/remediation-cases.json') as { cases: typeof resolvedR[] };
    const stop = cases.cases.find((record) => record.id !== 'case-R')!;
    const halt = await run.haltMarker();

    expect(stop).toMatchObject({ disposition: 'escalate', resolution: 'open', escalation: { owner: 'architecture' } });
    expect(JSON.stringify(cases.cases.find((record) => record.id === 'case-R'))).toBe(JSON.stringify(resolvedR));
    expect(halt).toContain(`decision stop ${stop.id}`);
    expect(halt).toContain('owner: architecture');
    expect(halt).toContain(customSourceId);
  });

  it('persists a bound resolved action escalation with different sources as a fresh decision stop', async () => {
    const customSourceId = buildReviewAdjudicationSourceId(projectBuildReviewAggregateSources(customAggregate())![0]!);
    const resolvedR = {
      id: 'case-R', domain: 'build_review', disposition: 'act', priority: 'high',
      rationale: 'The earlier repair was applied.', confidence: 'high', resolution: 'resolved',
      sources: [{ sourceId: SOURCE_ID, outcome: 'acted', recordedAt: '2026-10-18T00:00:00.000Z' }],
      effect: { id: 'effect-R', kind: 'action', status: 'applied', workOrderId: 'order-R' },
    };
    const run = await fixture({
      seedPipeline: async (root) => {
        await writeFile(join(root, '.pipeline', 'remediation-cases.json'), JSON.stringify({
          version: 'v1', feature: { version: 'v1', repository: root, feature: 'adjudicated-feature' }, cases: [resolvedR],
        }), 'utf8');
      },
      custom: true,
      judgement: {
        mode: 'case-v2', domain: 'build_review',
        sourceOutcomes: [{ sourceId: customSourceId, outcome: 'escalate', caseRef: 'architecture-stop' }],
        cases: [{
          caseRef: 'architecture-stop', existingCaseId: 'case-R', disposition: 'escalate', priority: 'high', confidence: 'high',
          rationale: 'Architecture must decide the different re-raised boundary.', effect: { kind: 'none' }, escalation: { owner: 'architecture' },
        }], consistency: { verdict: 'blocked', sourceIds: [customSourceId], caseRefs: ['architecture-stop'], rationale: 'Architecture must decide.' },
      },
    });
    const cases = await run.readJson('.pipeline/remediation-cases.json') as { cases: typeof resolvedR[] };
    const stop = cases.cases.find((record) => record.id !== 'case-R')!;

    expect(stop).toMatchObject({ disposition: 'escalate', resolution: 'open', sources: [{ sourceId: customSourceId }] });
    expect(stop.id).not.toBe('case-R');
    expect(JSON.stringify(cases.cases.find((record) => record.id === 'case-R'))).toBe(JSON.stringify(resolvedR));
  });

  it('carries a remaining infrastructure fault into the admitted-repair kickback and BUILD hint', async () => {
    const run = await fixture({ reportUncoveredInfrastructure: true });

    expect(run.kickbacks).toEqual([{ from: 'build_review', to: 'build' }]);
    expect(run.kickbackEvidence[0]).toContain('review infrastructure faults remain uncovered');
    const clean = await fixture();
    expect(clean.kickbackEvidence[0]).not.toContain('review infrastructure faults remain uncovered');
  });

  it.each([
    ['charge throws', async () => { throw new Error('ledger unavailable'); }],
    ['per-gate cap is exhausted', async () => ({ status: 'charged' as const, exhausted: true, cumulativeExhausted: false, entry: { count: 3, cumulative: 3 } })],
    ['cumulative cap is exhausted', async () => ({ status: 'charged' as const, exhausted: false, cumulativeExhausted: true, entry: { count: 3, cumulative: 6 } })],
  ])('halts needs-human without dispatching BUILD when %s', async (_name, chargeEffect) => {
    const charge = vi.fn(chargeEffect);
    const run = await fixture({ chargeEffect: charge as never });

    expect({ dispatched: run.dispatched, charges: charge.mock.calls.length }).toEqual({ dispatched: ['build_review', 'remediate'], charges: 1 });
    expect(await run.haltMarker()).toContain('build_review adjudication halted:');
  });

  it('does not convert an action failure accepted during failure delivery into a needs-human HALT', async () => {
    let accepted = false;
    const charge = vi.fn(async () => ({ status: 'unreadable' as const, reason: 'ledger unavailable' }));
    const run = await fixture({
      chargeEffect: charge as never,
      acceptedFindingIds: () => accepted ? [FINDING_ID] : [],
      onLifecycleEvent: (event) => { if (event.type === 'remediation_adjudication_failed') accepted = true; },
    });

    expect(run.dispatched).toEqual(['build_review', 'remediate']);
    expect(run.kickbacks).toEqual([]);
    expect(charge).toHaveBeenCalledTimes(1);
    expect(await run.haltMarker()).toBe('');
    await expect(run.readJson('.pipeline/remediation-cases.json')).resolves.toMatchObject({
      cases: [expect.objectContaining({ resolution: 'resolved', effect: expect.objectContaining({ status: 'failed' }) })],
    });
    expect(run.lifecycle.filter((event) => event.type === 'remediation_adjudication_completed' || event.type === 'remediation_adjudication_failed')).toHaveLength(1);
  });

  it('recovers the accepted work order and BUILD navigation point from disk alone after a restart', async () => {
    const first = await fixture();
    const order = await first.readJson('.pipeline/build-review-work-order.json') as { effectId: string; attemptedCaseIds?: string[] };
    const cases = await first.readJson('.pipeline/remediation-cases.json');

    // A genuinely fresh process: a new conductor, a new project root, no
    // `pendingRetryHints`, no memory of the lap that adjudicated the route.
    // Only the two durable artifacts travel, exactly as they would survive a
    // daemon restart.
    const restart = await fixture({
      startFrom: 'build',
      seedPipeline: async (root) => {
        await writeFile(join(root, '.pipeline/build-review-work-order.json'), JSON.stringify(order), 'utf8');
        await writeFile(join(root, '.pipeline/remediation-cases.json'), JSON.stringify(cases), 'utf8');
      },
    });

    expect(restart.dispatched).toContain('build');
    expect(restart.retryReasons.get('build')).toContain(`Build-review remediation work order (effect: ${order.effectId})`);
    expect(restart.retryReasons.get('build')).toContain('test/example.test.ts:8 — assert the rejection path');
    // The restarted process re-stamps the attempt against the same durable id.
    const restartedOrder = await restart.readJson('.pipeline/build-review-work-order.json') as { effectId: string; attemptedCaseIds?: string[] };
    expect(restartedOrder.effectId).toBe(order.effectId);
    expect(restartedOrder.attemptedCaseIds).toEqual(order.attemptedCaseIds);
  });

  it('treats an all-resolved durable action order as absent on a fresh BUILD entry', async () => {
    const first = await fixture();
    const order = await first.readJson('.pipeline/build-review-work-order.json');
    const cases = await first.readJson('.pipeline/remediation-cases.json') as { cases: Array<{ resolution: string }> };
    const restart = await fixture({
      startFrom: 'build',
      seedPipeline: async (root) => {
        await writeFile(join(root, '.pipeline/build-review-work-order.json'), JSON.stringify(order), 'utf8');
        await writeFile(join(root, '.pipeline/remediation-cases.json'), JSON.stringify({
          ...(cases as object), cases: cases.cases.map((record) => ({ ...record, resolution: 'resolved' })),
        }), 'utf8');
      },
    });

    expect(restart.dispatched).toEqual(['build']);
    expect(restart.retryReasons.get('build')).toBeUndefined();
  });

  it('halts before BUILD when a durable work order is malformed rather than falling back to a stale hint', async () => {
    const first = await fixture();
    const cases = await first.readJson('.pipeline/remediation-cases.json');
    const restart = await fixture({
      startFrom: 'build',
      seedPipeline: async (root) => {
        await writeFile(join(root, '.pipeline/build-review-work-order.json'), '{not json', 'utf8');
        await writeFile(join(root, '.pipeline/remediation-cases.json'), JSON.stringify(cases), 'utf8');
      },
    });

    expect(restart.dispatched).not.toContain('build');
    expect(await restart.haltMarker()).toContain('BUILD durable remediation recovery halted: work order malformed-json');
  });

  it.each(['work order', 'case store'] as const)('does not read a durable adjudication %s when adjudication is disabled', async (artifact) => {
    const first = await fixture();
    const order = await first.readJson('.pipeline/build-review-work-order.json');
    const cases = await first.readJson('.pipeline/remediation-cases.json');
    const disabled = await fixture({
      startFrom: 'build', buildPending: true, adjudicationEnabled: false,
      seedPipeline: async (root) => {
        await writeFile(join(root, '.pipeline/build-review-work-order.json'), artifact === 'work order' ? '{not json' : JSON.stringify(order), 'utf8');
        await writeFile(join(root, '.pipeline/remediation-cases.json'), artifact === 'case store' ? '{not json' : JSON.stringify(cases), 'utf8');
      },
    });

    // A malformed artifact is an observable read spy: the disabled route must
    // remain on the pre-feature BUILD path rather than parsing or stamping it.
    expect(disabled.dispatched).toEqual(['build']);
    expect(disabled.retryReasons.get('build')).toBeUndefined();
    expect(await disabled.haltMarker()).not.toContain('BUILD durable remediation recovery halted');
    for (const [relative, before] of disabled.artifactMtimes) {
      expect((await stat(join(disabled.projectRoot, relative))).mtimeMs).toBe(before);
    }
  });

  it('halts before BUILD when a durable order names an effect the case store never recorded', async () => {
    const first = await fixture();
    const order = await first.readJson('.pipeline/build-review-work-order.json') as { effectId: string };
    const cases = await first.readJson('.pipeline/remediation-cases.json');

    // The order still names an OPEN action case of THIS feature, so openness
    // and feature identity both pass; only its stable effect is foreign. Under
    // a feature-only read that order reached BUILD prompt construction.
    const restart = await fixture({
      startFrom: 'build',
      seedPipeline: async (root) => {
        await writeFile(
          join(root, '.pipeline/build-review-work-order.json'),
          JSON.stringify({ ...order, effectId: 'effect-from-another-route' }),
          'utf8',
        );
        await writeFile(join(root, '.pipeline/remediation-cases.json'), JSON.stringify(cases), 'utf8');
      },
    });

    expect(restart.dispatched).not.toContain('build');
    expect(restart.retryReasons.get('build')).toBeUndefined();
    expect(await restart.haltMarker()).toContain('BUILD durable remediation recovery halted: work order foreign-effect');
  });

  it('files a deferred case through the production tracker and intake dependencies', async () => {
    const run = await fixture({ judgement: deferralJudgement() });

    // The real Conductor composition supplies authorized-feature creation to
    // fileIntakeIssue. The transaction returns #77, then both labels target
    // only that returned identity — no coordinator-local filing fake is used.
    expect(run.ghCalls.some((args) => args[0] === 'issue' && args[1] === 'list' && args.includes('--state') && args.includes('all'))).toBe(true);
    expect(run.ghCalls.some((args) => args[0] === 'issue' && args[1] === 'create')).toBe(true);
    expect(run.ghCalls.filter((args) => args.some((arg) => arg === 'repos/acme/conductor/issues/77/labels'))).toEqual([
      expect.arrayContaining(['labels[]=priority: low']),
      expect.arrayContaining(['labels[]=size: M']),
    ]);
    const cases = await run.readJson('.pipeline/remediation-cases.json') as { cases: Array<{ effect: { status: string; issueUrl?: string } }> };
    expect(cases.cases[0]!.effect).toMatchObject({ status: 'applied', issueUrl: 'https://github.com/acme/conductor/issues/77' });
    // A finalized non-action outcome performs no BUILD navigation.
    expect(run.dispatched).not.toContain('build');
    expect(run.kickbacks).toEqual([]);
  });

  it('does not file a deferred issue when current feature provenance cannot authorize creation', async () => {
    const run = await fixture({ judgement: deferralJudgement(), featureCreationAuthorized: false });

    expect(run.ghCalls.some((args) => args[0] === 'issue' && args[1] === 'create')).toBe(false);
    expect(await run.haltMarker()).toContain('build_review adjudication halted:');
  });

  it('lets an exactly covered infrastructure branch settle instead of pinning the mechanical lane', async () => {
    const covered = await fixture({ infrastructure: 'covered' });

    // Done-when 6: covered infrastructure is not uncovered infrastructure. With
    // no unresolved content source the lap settles; it never fabricates PASS
    // from an uncovered fault, which the next case proves.
    expect(covered.dispatched).not.toContain('build');
    expect(await covered.haltMarker()).toBe('');
    expect(covered.remediateDispatches()).toBe(0);
  });

  // Covers: S9.5, task:rem-prd-audit-rem-prd-audit-R17d
  it.each(['failed', 'reserved'] as const)(
    'does not retire an absent %s action case on a reduced-coverage lap',
    async (status) => {
      const caseId = `case-covered-${status}`;
      const run = await fixture({
        infrastructure: 'covered',
        seedPipeline: async (root) => {
          await writeFile(join(root, '.pipeline', 'remediation-cases.json'), JSON.stringify({
            version: 'v3', feature: { version: 'v1', repository: root, feature: 'adjudicated-feature' },
            cases: [{
              id: caseId, domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
              rationale: 'The prior action was not completed.', resolution: 'open',
              sources: [{ sourceId: SOURCE_ID, outcome: 'acted', recordedAt: '2026-10-20T00:00:00.000Z' }],
              effect: status === 'failed'
                ? { id: `effect-covered-${status}`, kind: 'action', status, diagnostic: 'prior effect failed' }
                : { id: `effect-covered-${status}`, kind: 'action', status },
            }],
            prdWideningCases: [], suppressions: [], outbox: [],
          }), 'utf8');
        },
      });

      const cases = await run.readJson('.pipeline/remediation-cases.json') as {
        cases: Array<{ id: string; resolution: string; effect: { status: string } }>;
      };
      expect(cases.cases.find((record) => record.id === caseId)).toMatchObject({
        resolution: 'open', effect: { status },
      });
      expect(run.lifecycle.filter((event) =>
        event.type === 'remediation_case_reconciled' && event.caseId === caseId,
      )).toEqual([]);
    },
  );

  // Covers: task:rem-prd-audit-rem-prd-audit-R17f
  it('retires an absent failed action after an earlier reduced-coverage decision and publishes clean PASS', async () => {
    const caseId = 'case-earlier-covered';
    const run = await fixture({
      rawVerdict: 'PASS',
      seedPipeline: async (root) => {
        const feature = { version: 'v1' as const, repository: root, feature: 'adjudicated-feature' };
        const store = new RemediationCaseStore(root, feature);
        const seeded = await store.mutate(async (state) => ({
          value: undefined,
          nextState: {
            ...state,
            cases: [{
              id: caseId, domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
              rationale: 'A prior action failed.', resolution: 'open',
              sources: [{ sourceId: SOURCE_ID, outcome: 'acted', recordedAt: '2026-10-20T00:00:00.000Z' }],
              effect: { id: 'effect-earlier-covered', kind: 'action', status: 'failed', diagnostic: 'prior effect failed' },
            }],
          },
        }));
        if (!seeded.ok) throw new Error(`case-store seed failed: ${seeded.reason}`);
        const reduced = await new BuildReviewDispositionStore(root).appendReducedCoverageIfCurrent({
          feature, rubric: 'testQuality', reason: 'provider-error', rationale: 'Prior lap provider outage.', operator: 'operator',
        }, async () => true);
        if (!reduced.ok) throw new Error(reduced.message);
      },
    });

    expect(await run.haltMarker()).toBe('');
    expect((await run.state()).build_review).toBe('done');
    expect(await run.readJson('.pipeline/remediation-cases.json')).toMatchObject({
      cases: [expect.objectContaining({ id: caseId, resolution: 'resolved' })],
    });
    expect(run.lifecycle.filter((event) => event.type === 'remediation_case_reconciled' && event.caseId === caseId)).toEqual([
      expect.objectContaining({ resolution: 'resolved', eventId: expect.any(String) }),
    ]);
  });

  // Covers: task:rem-as-built-rem-as-built-R17g
  it('keeps absent failed and reserved action cases open for a current custom infrastructure failure', async () => {
    const run = await fixture({
      custom: true,
      customInfrastructure: true,
      seedPipeline: async (root) => {
        const feature = { version: 'v1' as const, repository: root, feature: 'adjudicated-feature' };
        const store = new RemediationCaseStore(root, feature);
        const seeded = await store.mutate(async (state) => ({
          value: undefined,
          nextState: {
            ...state,
            cases: (['failed', 'reserved'] as const).map((status, index) => ({
              id: `case-custom-${status}`, domain: 'build_review' as const, disposition: 'act' as const, priority: 'high' as const, confidence: 'high' as const,
              rationale: 'The absent action remains open while review infrastructure is faulty.', resolution: 'open' as const,
              sources: [{ sourceId: index === 0 ? SOURCE_ID : RE_RAISED_SOURCE_ID, outcome: 'acted' as const, recordedAt: '2026-10-20T00:00:00.000Z' }],
              effect: status === 'failed'
                ? { id: `effect-custom-${status}`, kind: 'action' as const, status, diagnostic: 'prior effect failed' }
                : { id: `effect-custom-${status}`, kind: 'action' as const, status },
            })),
          },
        }));
        if (!seeded.ok) throw new Error(`case-store seed failed: ${seeded.reason}`);
      },
    });

    const cases = await run.readJson('.pipeline/remediation-cases.json') as {
      cases: Array<{ id: string; resolution: string; effect: { status: string } }>;
    };
    expect(cases.cases.find((record) => record.id === 'case-custom-failed')).toMatchObject({
      resolution: 'open', effect: { status: 'failed' },
    });
    expect(cases.cases.find((record) => record.id === 'case-custom-reserved')).toMatchObject({
      resolution: 'open', effect: { status: 'reserved' },
    });
    expect(run.lifecycle.filter((event) => event.type === 'remediation_case_reconciled')).toEqual([]);
  });

  // Covers: task:5
  it('keeps an uncovered infrastructure branch in the mechanical lane without a semantic kickback', async () => {
    const uncovered = await fixture({ infrastructure: 'uncovered' });

    expect(uncovered.dispatched).not.toContain('build');
    expect(uncovered.kickbacks).toEqual([]);
    expect(uncovered.gateVerdicts.filter((event) =>
      event.step === 'build_review' && !event.satisfied,
    )).toEqual([]);
    expect(uncovered.remediateDispatches()).toBe(0);
    // An uncovered fault is not PASS: it exhausts the bounded mechanical
    // allowance, preserves the source diagnostic, and then writes the
    // conductor HALT marker. These are the durable outputs of the production
    // mechanical lane, rather than merely the absence of a semantic route.
    const ledger = await uncovered.readJson('.pipeline/kickback-ledger.json') as {
      gates: { build_review?: {
        count?: number;
        mechanicalFaults?: number;
        lastMechanicalFault?: { rubric: string; reason: string; detail: string; lapId: string };
      } };
    };
    expect(ledger.gates.build_review?.count ?? 0).toBe(0);
    expect(ledger.gates.build_review?.mechanicalFaults).toBe(3);
    expect(ledger.gates.build_review?.lastMechanicalFault).toEqual({
      rubric: 'testQuality',
      reason: 'provider-error',
      detail: 'provider unavailable',
      lapId: LAP_ID,
    });
    expect(await uncovered.haltMarker()).toContain('build_review adjudication halted');
    expect(await uncovered.haltMarker()).not.toContain('scope-incomplete testQuality');
  });

  it.each([
    ['malformed ledger', 'not valid json {', "kickback ledger gate 'build_review' is unreadable"],
    ['version-incompatible ledger', JSON.stringify({ version: 2, gates: {} }), "kickback ledger gate 'build_review' is unreadable"],
  ])('halts before adjudication when the mechanical ledger is %s', async (_name, rawLedger, reason) => {
    const charge = vi.fn(async () => ({
      status: 'charged' as const,
      exhausted: false,
      cumulativeExhausted: false,
      entry: { count: 1, cumulative: 1 },
    }));
    const run = await fixture({
      infrastructure: 'uncovered', chargeEffect: charge as never,
      seedPipeline: async (root) => {
        await writeFile(join(root, '.pipeline/kickback-ledger.json'), rawLedger, 'utf8');
      },
    });

    expect(await run.haltMarker()).toContain(reason);
    expect(run.remediateDispatches()).toBe(0);
    expect(run.dispatched).not.toContain('build');
    expect(charge).not.toHaveBeenCalled();
    await expect(readFile(join(run.projectRoot, '.pipeline/kickback-ledger.json'), 'utf8')).resolves.toBe(rawLedger);
  });
  it('does not leak a settled work order into a later unrelated BUILD dispatch', async () => {
    const first = await fixture();
    const order = await first.readJson('.pipeline/build-review-work-order.json');
    const settled = await first.readJson('.pipeline/remediation-cases.json') as {
      version: string; feature: unknown; cases: Array<Record<string, unknown>>;
    };

    // BUILD repaired the case and the next lap resolved it. The order artifact
    // is still on disk and still parses — it must not keep re-entering BUILD
    // prompts, and it must not be re-stamped as attempted again.
    const resolved = { ...settled, cases: settled.cases.map((record) => ({ ...record, resolution: 'resolved' })) };
    const later = await fixture({
      startFrom: 'build',
      seedPipeline: async (root) => {
        await writeFile(join(root, '.pipeline/build-review-work-order.json'), JSON.stringify(order), 'utf8');
        await writeFile(join(root, '.pipeline/remediation-cases.json'), JSON.stringify(resolved), 'utf8');
      },
    });

    expect(later.dispatched).toContain('build');
    expect(later.retryReasons.get('build')).toBeUndefined();
  });
  it('settles a prior attempted action case when a later lap passes cleanly', async () => {
    const first = await fixture();
    const order = await first.readJson('.pipeline/build-review-work-order.json');
    const attempted = await first.readJson('.pipeline/remediation-cases.json') as {
      version: string; feature: unknown; cases: Array<Record<string, unknown>>;
    };
    expect(attempted.cases.map((record) => record.resolution)).toEqual(['open']);

    // The adjudication coordinator runs only on a raw FAIL, so before this a
    // clean lap left the repaired case open with its applied effect — and every
    // later BUILD entry, for any gate, read its stale order back.
    const later = await fixture({
      rawVerdict: 'PASS',
      seedPipeline: async (root) => {
        await writeFile(join(root, '.pipeline/build-review-work-order.json'), JSON.stringify(order), 'utf8');
        await writeFile(join(root, '.pipeline/remediation-cases.json'), JSON.stringify(attempted), 'utf8');
      },
    });

    expect(later.remediateDispatches()).toBe(0);
    const settled = await later.readJson('.pipeline/remediation-cases.json') as {
      cases: Array<{ id: string; resolution: string }>;
    };
    expect(settled.cases.map((record) => record.resolution)).toEqual(['resolved']);
    expect(later.lifecycle).toContainEqual(expect.objectContaining({
      type: 'remediation_case_reconciled', caseId: settled.cases[0]!.id, resolution: 'resolved',
    }));
  });

  // Covers: task:12, task:rem-as-built-r12-1
  it.each([
    ['mechanically healthy', false, 'resolved'],
    ['an infrastructure-failure lap', true, 'open'],
  ] as const)('settles an absent prior action on an attended built-in-only advisory PASS only when %s', async (_label, advisoryInfrastructure, expectedResolution) => {
    const caseId = `case-advisory-${advisoryInfrastructure ? 'infra' : 'healthy'}`;
    const run = await fixture({
      attended: true,
      advisory: true,
      advisoryInfrastructure,
      seedPipeline: async (root) => {
        const feature = { version: 'v1' as const, repository: root, feature: 'adjudicated-feature' };
        const store = new RemediationCaseStore(root, feature);
        const seeded = await store.mutate(async (state) => ({
          value: undefined,
          nextState: {
            ...state,
            cases: [{
              id: caseId, domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
              rationale: 'The earlier action is absent from this advisory-only lap.', resolution: 'open',
              sources: [{ sourceId: SOURCE_ID, outcome: 'acted', recordedAt: '2026-10-20T00:00:00.000Z' }],
              effect: { id: `effect-${caseId}`, kind: 'action', status: 'failed', diagnostic: 'previous effect failed' },
            }],
          },
        }));
        if (!seeded.ok) throw new Error(`case-store seed failed: ${seeded.reason}`);
      },
    });

    const settled = await run.readJson('.pipeline/remediation-cases.json') as {
      cases: Array<{ id: string; resolution: string; effect: { status: string } }>;
    };
    expect(settled.cases.find((record) => record.id === caseId)).toMatchObject({
      resolution: expectedResolution,
      effect: { status: 'failed' },
    });
    expect(run.lifecycle.filter((event) =>
      event.type === 'remediation_case_reconciled' && event.caseId === caseId,
    )).toHaveLength(expectedResolution === 'resolved' ? 1 : 0);
  });

  // Covers: task:rem-as-built-rem-as-built-r12-2
  it.each([
    ['accepted', { acceptedFindingIds: () => ['unrelated-accepted'] }, false, 'resolved'],
    ['suppressed', { suppressedFindingIds: ['unrelated-suppressed'] }, false, 'resolved'],
    ['settled', { settledFindingIds: ['unrelated-settled'] }, false, 'resolved'],
    ['accepted on an infrastructure-failure lap', { acceptedFindingIds: () => ['unrelated-accepted'] }, true, 'open'],
  ] as const)('retires an absent advisory action despite an unrelated %s peer only when mechanically healthy', async (_peer, peer, advisoryInfrastructure, expectedResolution) => {
    const caseId = `case-advisory-unrelated-${_peer.replaceAll(' ', '-')}`;
    const run = await fixture({
      attended: true,
      advisory: true,
      advisoryInfrastructure,
      ...peer,
      seedPipeline: async (root) => {
        const feature = { version: 'v1' as const, repository: root, feature: 'adjudicated-feature' };
        const store = new RemediationCaseStore(root, feature);
        const seeded = await store.mutate(async (state) => ({
          value: undefined,
          nextState: {
            ...state,
            cases: [{
              id: caseId, domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
              rationale: 'The earlier action is absent from this advisory-only lap.', resolution: 'open',
              sources: [{ sourceId: SOURCE_ID, outcome: 'acted', recordedAt: '2026-10-20T00:00:00.000Z' }],
              effect: { id: `effect-${caseId}`, kind: 'action', status: 'failed', diagnostic: 'previous effect failed' },
            }],
          },
        }));
        if (!seeded.ok) throw new Error(`case-store seed failed: ${seeded.reason}`);
      },
    });

    const cases = await run.readJson('.pipeline/remediation-cases.json') as {
      cases: Array<{ id: string; resolution: string }>;
    };
    expect(cases.cases.find((record) => record.id === caseId)?.resolution).toBe(expectedResolution);
  });

  it('keeps a clean PASS terminal when there is no durable case store', async () => {
    const run = await fixture({ rawVerdict: 'PASS' });

    expect(await run.haltMarker()).toBe('');
    expect((await run.state()).build_review).toBe('done');
  });

  it('settles an open non-action case without an order before terminal PASS', async () => {
    const first = await fixture({ judgement: deferralJudgement() });
    const cases = await first.readJson('.pipeline/remediation-cases.json');
    const run = await fixture({
      rawVerdict: 'PASS',
      seedPipeline: async (root) => writeFile(join(root, '.pipeline/remediation-cases.json'), JSON.stringify(cases), 'utf8'),
    });

    expect(await run.haltMarker()).toBe('');
    expect((await run.state()).build_review).toBe('done');
    const settled = await run.readJson('.pipeline/remediation-cases.json') as { cases: Array<{ id: string; resolution: string }> };
    expect(settled.cases).toEqual([expect.objectContaining({ resolution: 'resolved' })]);
    expect(run.lifecycle).toContainEqual(expect.objectContaining({
      type: 'remediation_case_reconciled', caseId: settled.cases[0]!.id, resolution: 'resolved',
    }));
  });

  it.each(['reserved', 'applied', 'failed'] as const)('settles eligible clean-PASS action state and halts only the applied missing-order obligation (%s)', async (status) => {
    const first = await fixture();
    const cases = await first.readJson('.pipeline/remediation-cases.json') as {
      cases: Array<{ id: string; effect: { id: string; kind: string; status: string; workOrderId?: string; diagnostic?: string } }>;
    };
    const seeded = {
      ...cases,
      cases: cases.cases.map((record) => ({
        ...record,
        effect: {
          ...record.effect,
          status,
          ...(status === 'reserved' || status === 'failed' ? { workOrderId: undefined } : {}),
          ...(status === 'failed' ? { diagnostic: 'previous effect failure' } : {}),
        },
      })),
    };
    const caseId = seeded.cases[0]!.id;
    const run = await fixture({
      rawVerdict: 'PASS',
      seedPipeline: async (root) => writeFile(join(root, '.pipeline/remediation-cases.json'), JSON.stringify(seeded), 'utf8'),
    });

    if (status === 'applied') {
      expect(await run.haltMarker()).toContain(`clean PASS cannot settle open action case ${caseId} (${status}); resolve with ai-conductor build-review resolve-case --feature adjudicated-feature --case ${caseId} --rationale "<why>"`);
      expect((await run.state()).build_review).not.toBe('done');
    } else {
      expect(await run.haltMarker()).toBe('');
      expect((await run.state()).build_review).toBe('done');
      const settled = await run.readJson('.pipeline/remediation-cases.json') as {
        cases: Array<{ id: string; resolution: string; effect: { status: string; diagnostic?: string } }>;
      };
      expect(settled.cases).toEqual([expect.objectContaining({ resolution: 'resolved', effect: expect.objectContaining({
        status: 'failed', diagnostic: status === 'reserved' ? 'retired: every source operator-accepted or no longer raised' : 'previous effect failure',
      }) })]);
      expect(run.lifecycle.filter((event) => event.type === 'remediation_case_reconciled' && event.caseId === caseId)).toEqual([
        expect.objectContaining({ eventId: expect.any(String), resolution: 'resolved' }),
      ]);
    }
  });

  // Covers: task:16, task:17, task:rem-as-built-R16a, task:rem-as-built-R17a
  it.each(['reserved', 'failed'] as const)('settles an accepted missing-order %s action before testing obligations', async (status) => {
    const run = await fixture({
      rawVerdict: 'PASS',
      seedPipeline: async (root) => {
        const feature = { version: 'v1' as const, repository: root, feature: 'adjudicated-feature' };
        const store = new RemediationCaseStore(root, feature);
        const seeded = await store.mutate(async (state) => ({
          value: undefined,
          nextState: {
            ...state,
            cases: [{
              id: 'case-accepted', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
              rationale: 'The accepted finding has no remaining work order.', resolution: 'open',
              sources: [{ sourceId: SOURCE_ID, outcome: 'acted', recordedAt: '2026-10-20T00:00:00.000Z' }],
              effect: status === 'reserved'
                ? { id: 'effect-accepted', kind: 'action', status }
                : { id: 'effect-accepted', kind: 'action', status, diagnostic: 'previous effect failure' },
            }],
          },
        }));
        if (!seeded.ok) throw new Error(`case-store seed failed: ${seeded.reason}`);
        const accepted = await new BuildReviewDispositionStore(root).append({
          feature,
          finding: canonicalizeBuildReviewFindingIdentity({
            rubric: 'testQuality', contractVersion: 'v3', concernKind: FINDING.concernKind, anchor: FINDING.anchor,
          })!,
          sourceLapId: LAP_ID, summary: 'Accepted current finding.', rationale: 'Operator accepts this risk.', operator: 'operator',
        });
        if (!accepted.ok) throw new Error(accepted.message);
      },
    });

    expect(await run.haltMarker()).toBe('');
    expect((await run.state()).build_review).toBe('done');
    const settled = await run.readJson('.pipeline/remediation-cases.json') as {
      cases: Array<{ id: string; resolution: string; effect: { status: string; diagnostic?: string } }>;
    };
    expect(settled).toMatchObject({ cases: [expect.objectContaining({
      resolution: 'resolved', effect: expect.objectContaining({
        status: 'failed', diagnostic: status === 'reserved'
          ? 'retired: every source operator-accepted or no longer raised'
          : 'previous effect failure',
      }),
    })] });
    expect(run.lifecycle.filter((event) => event.type === 'remediation_case_reconciled' && event.caseId === 'case-accepted')).toEqual([
      expect.objectContaining({ eventId: expect.any(String), resolution: 'resolved' }),
    ]);
  });

  // Covers: task:20, task:rem-prd-audit-rem-prd-audit-R20a
  it('carries a same-id re-raise of an operator-resolved action case before any new effect', async () => {
    const charge = vi.fn(async () => ({
      status: 'charged' as const, exhausted: false, cumulativeExhausted: false, entry: { count: 1, cumulative: 1 },
    }));
    const run = await fixture({
      persistEvents: true,
      chargeEffect: charge as never,
      judgement: {
        mode: 'case-v1', domain: 'build_review',
        sourceOutcomes: [{ sourceId: SOURCE_ID, outcome: 'acted', caseRef: 'operator-resolved-O' }],
        cases: [{
          caseRef: 'operator-resolved-O', existingCaseId: 'case-O', disposition: 'act', priority: 'high', confidence: 'high',
          rationale: 'The same finding was re-raised after operator resolution.',
          effect: { kind: 'action', route: 'build', tasks: [{ title: 'This carry must not create a work order.' }] },
        }],
      },
      seedPipeline: async (root) => {
        const feature = { version: 'v1' as const, repository: root, feature: 'adjudicated-feature' };
        const store = new RemediationCaseStore(root, feature);
        const seeded = await store.mutate(async (state) => ({
          value: undefined,
          nextState: {
            ...state,
            cases: [{
              id: 'case-O', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
              rationale: 'The original repair failed and needs an operator decision.', resolution: 'open',
              sources: [{ sourceId: SOURCE_ID, outcome: 'acted', recordedAt: '2026-10-20T00:00:00.000Z' }],
              effect: { id: 'effect-O', kind: 'action', status: 'failed', diagnostic: 'original attempt failed' },
            }],
          },
        }));
        if (!seeded.ok) throw new Error(`case-store seed failed: ${seeded.reason}`);
        const resolved = await store.resolveByOperator({
          caseId: 'case-O', operator: 'operator', rationale: 'The operator accepts this known risk.', resolvedAt: '2026-10-21T00:00:00.000Z',
        });
        if (!resolved.ok || resolved.value.kind !== 'resolved') throw new Error('operator resolution seed failed');
      },
    });

    expect(await run.haltMarker()).toBe('');
    expect(run.dispatched).not.toContain('build');
    expect(charge).not.toHaveBeenCalled();
    await expect(readFile(join(run.projectRoot, '.pipeline/build-review-work-order.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await run.readJson('.pipeline/remediation-cases.json')).toMatchObject({
      cases: [expect.objectContaining({
        id: 'case-O', resolution: 'resolved', operatorResolution: expect.any(Object),
        sources: [expect.objectContaining({ sourceId: SOURCE_ID, outcome: 'carried' })],
      })],
    });
    const caseEvents = run.lifecycle.filter((event) =>
      event.type === 'remediation_case_operator_resolved' || event.type === 'build_review_acceptance_carried');
    expect(caseEvents.map((event) => event.type)).toEqual([
      'remediation_case_operator_resolved',
      'build_review_acceptance_carried',
    ]);
    expect(caseEvents.filter((event) => event.type === 'remediation_case_operator_resolved')).toHaveLength(1);
    expect(caseEvents.filter((event) => event.type === 'build_review_acceptance_carried')).toHaveLength(1);
    const persistedCaseEvents = (await run.events()).filter((event) =>
      event.type === 'remediation_case_operator_resolved' || event.type === 'build_review_acceptance_carried');
    expect(persistedCaseEvents.map((event) => event.type)).toEqual([
      'remediation_case_operator_resolved',
      'build_review_acceptance_carried',
    ]);
  });

  // Covers: task:20, task:rem-prd-audit-rem-prd-audit-R20a
  it('also carries a new source bound to an operator-resolved action case', async () => {
    const charge = vi.fn(async () => ({
      status: 'charged' as const, exhausted: false, cumulativeExhausted: false, entry: { count: 1, cumulative: 1 },
    }));
    const run = await fixture({
      reRaised: true,
      chargeEffect: charge as never,
      judgement: {
        mode: 'case-v1', domain: 'build_review',
        sourceOutcomes: [
          { sourceId: SOURCE_ID, outcome: 'acted', caseRef: 'operator-resolved-O' },
          { sourceId: RE_RAISED_SOURCE_ID, outcome: 'acted', caseRef: 'operator-resolved-O' },
        ],
        cases: [{
          caseRef: 'operator-resolved-O', existingCaseId: 'case-O', disposition: 'act', priority: 'high', confidence: 'high',
          rationale: 'The new source is the same accepted risk.',
          effect: { kind: 'action', route: 'build', tasks: [{ title: 'This carry must not create a work order.' }] },
        }],
      },
      seedPipeline: async (root) => {
        const feature = { version: 'v1' as const, repository: root, feature: 'adjudicated-feature' };
        const store = new RemediationCaseStore(root, feature);
        const seeded = await store.mutate(async (state) => ({
          value: undefined,
          nextState: {
            ...state,
            cases: [{
              id: 'case-O', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
              rationale: 'The original repair failed and needs an operator decision.', resolution: 'open',
              sources: [{ sourceId: SOURCE_ID, outcome: 'acted', recordedAt: '2026-10-20T00:00:00.000Z' }],
              effect: { id: 'effect-O', kind: 'action', status: 'failed', diagnostic: 'original attempt failed' },
            }],
          },
        }));
        if (!seeded.ok) throw new Error(`case-store seed failed: ${seeded.reason}`);
        const resolved = await store.resolveByOperator({
          caseId: 'case-O', operator: 'operator', rationale: 'The operator accepts this known risk.', resolvedAt: '2026-10-21T00:00:00.000Z',
        });
        if (!resolved.ok || resolved.value.kind !== 'resolved') throw new Error('operator resolution seed failed');
      },
    });

    expect(await run.haltMarker()).toBe('');
    expect(run.dispatched).not.toContain('build');
    expect(charge).not.toHaveBeenCalled();
    expect(await run.readJson('.pipeline/remediation-cases.json')).toMatchObject({
      cases: [expect.objectContaining({
        id: 'case-O',
        sources: expect.arrayContaining([
          expect.objectContaining({ sourceId: SOURCE_ID, outcome: 'carried' }),
          expect.objectContaining({ sourceId: RE_RAISED_SOURCE_ID, outcome: 'carried' }),
        ]),
      })],
    });
  });

  // Covers: task:rem-prd-audit-R16c
  it('keeps an accepted failed deferral open on clean PASS', async () => {
    const run = await fixture({
      rawVerdict: 'PASS',
      seedPipeline: async (root) => {
        const feature = { version: 'v1' as const, repository: root, feature: 'adjudicated-feature' };
        const store = new RemediationCaseStore(root, feature);
        const seeded = await store.mutate(async (state) => ({
          value: undefined,
          nextState: {
            ...state,
            cases: [{
              id: 'case-accepted-deferral', domain: 'build_review', disposition: 'defer', priority: 'low', confidence: 'high',
              rationale: 'The accepted deferral filing failed.', resolution: 'open',
              sources: [{ sourceId: SOURCE_ID, outcome: 'deferred', recordedAt: '2026-10-20T00:00:00.000Z' }],
              effect: { id: 'effect-accepted-deferral', kind: 'deferral', status: 'failed', diagnostic: 'tracker unavailable' },
            }],
          },
        }));
        if (!seeded.ok) throw new Error(`case-store seed failed: ${seeded.reason}`);
        const accepted = await new BuildReviewDispositionStore(root).append({
          feature,
          finding: canonicalizeBuildReviewFindingIdentity({ rubric: 'testQuality', contractVersion: 'v3', concernKind: FINDING.concernKind, anchor: FINDING.anchor })!,
          sourceLapId: LAP_ID, summary: 'Accepted current finding.', rationale: 'Operator accepts this risk.', operator: 'operator',
        });
        if (!accepted.ok) throw new Error(accepted.message);
      },
    });

    expect(await run.haltMarker()).toContain('clean PASS cannot settle open deferral case case-accepted-deferral (failed)');
    const settled = await run.readJson('.pipeline/remediation-cases.json') as { cases: Array<{ id: string; resolution: string; effect: { status: string; diagnostic?: string } }> };
    expect(settled.cases.find((record) => record.id === 'case-accepted-deferral')).toMatchObject({
      resolution: 'open', effect: expect.objectContaining({ status: 'failed', diagnostic: 'tracker unavailable' }),
    });
  });

  // Covers: task:rem-prd-audit-R16c
  it('keeps an accepted open decision stop pending on clean PASS', async () => {
    const run = await fixture({
      rawVerdict: 'PASS',
      seedPipeline: async (root) => {
        const feature = { version: 'v1' as const, repository: root, feature: 'adjudicated-feature' };
        const store = new RemediationCaseStore(root, feature);
        const seeded = await store.mutate(async (state) => ({
          value: undefined,
          nextState: {
            ...state,
            cases: [{
              id: 'case-accepted-stop', domain: 'build_review', disposition: 'escalate', priority: 'high', confidence: 'high',
              rationale: 'An approved decision is still required.', resolution: 'open',
              sources: [{ sourceId: SOURCE_ID, outcome: 'escalate', recordedAt: '2026-10-20T00:00:00.000Z' }],
              escalation: { owner: 'architecture' }, effect: { kind: 'none' },
            }],
          },
        }));
        if (!seeded.ok) throw new Error(`case-store seed failed: ${seeded.reason}`);
        const accepted = await new BuildReviewDispositionStore(root).append({
          feature,
          finding: canonicalizeBuildReviewFindingIdentity({ rubric: 'testQuality', contractVersion: 'v3', concernKind: FINDING.concernKind, anchor: FINDING.anchor })!,
          sourceLapId: LAP_ID, summary: 'Accepted current finding.', rationale: 'Operator accepts this risk.', operator: 'operator',
        });
        if (!accepted.ok) throw new Error(accepted.message);
      },
    });

    expect(await run.haltMarker()).toContain('case reconciliation decision-stop-pending');
    await expect(run.readJson('.pipeline/remediation-cases.json')).resolves.toMatchObject({ cases: [expect.objectContaining({
      id: 'case-accepted-stop', resolution: 'open', effect: { kind: 'none' },
    })] });
  });

  // Covers: task:17, task:rem-as-built-R17b
  it('includes child scope in the missing-work-order action resolution command', async () => {
    const child = parseChildId(2)!;
    const root = await mkdtemp(join(tmpdir(), 'conductor-build-review-child-settlement-'));
    roots.push(root);
    const feature = { version: 'v1' as const, repository: root, feature: 'adjudicated-feature' };
    const verdictPath = pipelinePathFor(root, 'build-review.json', child);
    await mkdir(dirname(verdictPath), { recursive: true });
    await writeFile(verdictPath, JSON.stringify(passAggregate()), 'utf8');
    const store = new RemediationCaseStore(root, feature, { child });
    const seeded = await store.mutate(async (state) => ({
      value: undefined,
      nextState: {
        ...state,
        cases: [{
          id: 'case-child', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
          rationale: 'The child action has no published work order.', resolution: 'open',
          sources: [{ sourceId: SOURCE_ID, outcome: 'acted', recordedAt: '2026-10-20T00:00:00.000Z' }],
          effect: { id: 'effect-child', kind: 'action', status: 'applied', workOrderId: 'order-child' },
        }],
      },
    }));
    if (!seeded.ok) throw new Error(`case-store seed failed: ${seeded.reason}`);
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'state.json'),
      stepRunner: { run: async () => ({ success: true }) },
      events: new ConductorEventEmitter(),
      config: { build_review: { adjudication: { enabled: true } } },
    } as never);
    (conductor as unknown as { activeRegionChild: typeof child; activeRegionIsLeaf: boolean }).activeRegionChild = child;
    (conductor as unknown as { activeRegionChild: typeof child; activeRegionIsLeaf: boolean }).activeRegionIsLeaf = true;

    await expect((conductor as unknown as {
      settleRemediationCasesOnCleanBuildReview: () => Promise<{ kind: string; reason?: string }>;
    }).settleRemediationCasesOnCleanBuildReview()).resolves.toEqual(expect.objectContaining({
      kind: 'invalid',
      reason: expect.stringContaining('resolve with ai-conductor build-review resolve-case --feature adjudicated-feature --child 2 --case case-child --rationale "<why>"'),
    }));
  });

  it.each(['reserved', 'failed'] as const)('halts a clean PASS when an open %s deferral effect has no order', async (status) => {
    const first = await fixture({ judgement: deferralJudgement() });
    const cases = await first.readJson('.pipeline/remediation-cases.json') as {
      cases: Array<{ id: string; effect: { id: string; kind: string; status: string; issueUrl?: string; diagnostic?: string } }>;
    };
    const seeded = {
      ...cases,
      cases: cases.cases.map((record) => ({
        ...record,
        effect: {
          id: record.effect.id,
          kind: record.effect.kind,
          status,
          ...(status === 'failed' ? { diagnostic: 'previous deferral failure' } : {}),
        },
      })),
    };
    const caseId = seeded.cases[0]!.id;
    const run = await fixture({
      rawVerdict: 'PASS',
      seedPipeline: async (root) => writeFile(join(root, '.pipeline/remediation-cases.json'), JSON.stringify(seeded), 'utf8'),
    });

    // A reserved/failed deferral is durable unfinished evidence: it must never
    // resolve by benign absence into a terminal PASS.
    expect(await run.haltMarker()).toContain(`build_review clean-PASS durable settlement halted: clean PASS cannot settle open deferral case ${caseId} (${status})`);
    expect((await run.state()).build_review).not.toBe('done');
    const settled = await run.readJson('.pipeline/remediation-cases.json') as { cases: Array<{ resolution: string }> };
    expect(settled.cases).toEqual([expect.objectContaining({ resolution: 'open' })]);
  });

  it('halts BUILD recovery when an open applied action case has no work order', async () => {
    const first = await fixture();
    const cases = await first.readJson('.pipeline/remediation-cases.json') as { cases: Array<{ id: string; effect: { status: string } }> };
    const caseId = cases.cases[0]!.id;
    const restart = await fixture({
      startFrom: 'build',
      seedPipeline: async (root) => writeFile(join(root, '.pipeline/remediation-cases.json'), JSON.stringify(cases), 'utf8'),
    });

    expect(restart.dispatched).not.toContain('build');
    expect(await restart.haltMarker()).toContain(`BUILD durable remediation recovery halted: work order missing-work-order with open action case ${caseId} (applied)`);
  });

  it.each([
    ['malformed', async (root: string) => {
      await writeFile(join(root, '.pipeline/remediation-cases.json'), '{not json', 'utf8');
    }, 'malformed-json'],
    ['foreign-domain', async (root: string) => {
      const first = await fixture();
      const cases = await first.readJson('.pipeline/remediation-cases.json') as { cases: Array<Record<string, unknown>> };
      await writeFile(join(root, '.pipeline/remediation-cases.json'), JSON.stringify({
        ...cases,
        cases: cases.cases.map((record, index) => index === 0 ? { ...record, domain: 'foreign-domain' } : record),
      }), 'utf8');
    }, 'foreign-domain'],
  ])('halts a clean PASS when the durable case store is %s', async (_name, seedPipeline, reason) => {
    const run = await fixture({ rawVerdict: 'PASS', seedPipeline });

    expect(await run.haltMarker()).toContain(`build_review clean-PASS durable settlement halted: case store ${reason}`);
    expect((await run.state()).build_review).not.toBe('done');
    // adr-2026-08-11 decision 1: the marker is not the halt. A halt reaches the
    // operator on the persisted spine, and the daemon's fallback emitter is
    // suppressed once a marker exists — so a bare marker write is silent.
    expect(run.loopHalts).toContainEqual(expect.objectContaining({
      type: 'loop_halt',
      reason: expect.stringContaining('build_review clean-PASS durable settlement halted'),
    }));
  });

  it.each(['reserved', 'failed'] as const)('halts a clean PASS on an open %s deferral even when a stale work order exists', async (status) => {
    // A deferral whose intake create failed keeps its effect reserved/failed.
    // With an earlier lap's work order still on disk the settlement guard used
    // to be skipped entirely, so this settled into a terminal PASS with its
    // intake unfiled (AB-4 / S10.1).
    const first = await fixture({ judgement: deferralJudgement() });
    const cases = await first.readJson('.pipeline/remediation-cases.json') as {
      cases: Array<{ id: string; effect: { id: string; kind: string; status: string; issueUrl?: string } }>;
    };
    const seeded = {
      ...cases,
      cases: cases.cases.map((record) => ({
        ...record,
        effect: {
          id: record.effect.id,
          kind: record.effect.kind,
          status,
          ...(status === 'failed' ? { diagnostic: 'deferred intake failed: tracker down' } : {}),
        },
      })),
    };
    const caseId = seeded.cases[0]!.id;
    // An earlier action lap's order, rebound to this fixture's feature
    // identity so it reads as this feature's own stale attempt evidence.
    const earlierOrder = await (await fixture()).readJson('.pipeline/build-review-work-order.json') as Record<string, unknown>;
    const staleOrder = { ...earlierOrder, feature: (cases as unknown as { feature: unknown }).feature };
    const run = await fixture({
      rawVerdict: 'PASS',
      seedPipeline: async (root) => {
        await writeFile(join(root, '.pipeline/remediation-cases.json'), JSON.stringify(seeded), 'utf8');
        await writeFile(join(root, '.pipeline/build-review-work-order.json'), JSON.stringify(staleOrder), 'utf8');
      },
    });

    expect(await run.haltMarker()).toContain(`build_review clean-PASS durable settlement halted: clean PASS cannot settle open deferral case ${caseId} (${status})`);
    expect((await run.state()).build_review).not.toBe('done');
    const settled = await run.readJson('.pipeline/remediation-cases.json') as { cases: Array<{ resolution: string }> };
    expect(settled.cases).toEqual([expect.objectContaining({ resolution: 'open' })]);
  });

  it('halts a clean PASS when durable work-order attempt evidence is invalid', async () => {
    const first = await fixture();
    const cases = await first.readJson('.pipeline/remediation-cases.json');
    const run = await fixture({
      rawVerdict: 'PASS',
      seedPipeline: async (root) => {
        await writeFile(join(root, '.pipeline/remediation-cases.json'), JSON.stringify(cases), 'utf8');
        await mkdir(join(root, '.pipeline/build-review-work-order.json'));
      },
    });

    expect(await run.haltMarker()).toContain('build_review clean-PASS durable settlement halted: work order attempt unreadable-work-order');
    expect((await run.state()).build_review).not.toBe('done');
  });

  it('halts a clean PASS when durable case reconciliation cannot persist', async () => {
    const first = await fixture();
    const [cases, order] = await Promise.all([
      first.readJson('.pipeline/remediation-cases.json'),
      first.readJson('.pipeline/build-review-work-order.json'),
    ]);
    const reconcile = vi.spyOn(remediationCaseReconciler, 'reconcileRemediationCases').mockResolvedValue({
      ok: false,
      reason: 'store-failure',
      storeReason: 'atomic-replace-failed',
    });
    try {
      const run = await fixture({
        rawVerdict: 'PASS',
        seedPipeline: async (root) => {
          await writeFile(join(root, '.pipeline/remediation-cases.json'), JSON.stringify(cases), 'utf8');
          await writeFile(join(root, '.pipeline/build-review-work-order.json'), JSON.stringify(order), 'utf8');
        },
      });

      expect(await run.haltMarker()).toContain('build_review clean-PASS durable settlement halted: case reconciliation store-failure');
      expect((await run.state()).build_review).not.toBe('done');
    } finally {
      reconcile.mockRestore();
    }
  });

  it('takes the mechanical lane for a non-action lap with uncovered infrastructure, spending no semantic kickback', async () => {
    const run = await fixture({ judgement: deferralJudgement(), reportUncoveredInfrastructure: true });

    // adr-2026-08-29 D3.2: the content was adjudicated and finalized, so the
    // legacy raw kickback would have re-sent settled content to BUILD and
    // charged a semantic route for it.
    expect(run.remediateDispatches()).toBeGreaterThanOrEqual(1);
    expect(run.dispatched).not.toContain('build');
    expect(run.kickbacks).toEqual([]);
    const ledger = await run.readJson('.pipeline/kickback-ledger.json') as { gates: { build_review?: { count?: number; mechanicalFaults?: number } } };
    expect(ledger.gates.build_review?.count ?? 0).toBe(0);
    // The mechanical allowance bounds the re-land loop and then halts.
    expect(ledger.gates.build_review?.mechanicalFaults).toBe(3);
    expect(await run.haltMarker()).toContain('build_review adjudication halted');
  });

  it('takes the bounded mechanical lane for an uncovered indeterminate-only scope fault', async () => {
    const run = await fixture({ scopeIncomplete: 'uncovered' });

    expect(run.remediateDispatches()).toBe(0);
    expect(run.dispatched).not.toContain('build');
    expect(run.kickbacks).toEqual([]);
    const ledger = await run.readJson('.pipeline/kickback-ledger.json') as {
      gates: { build_review?: { count?: number; mechanicalFaults?: number; lastMechanicalFault?: { reason?: string } } };
    };
    expect(ledger.gates.build_review).toMatchObject({ count: 0, mechanicalFaults: 3, lastMechanicalFault: { reason: 'scope-incomplete' } });
    expect(await run.haltMarker()).toContain('uncovered build-review coverage failure');
    expect(await run.haltMarker()).toContain('scope-incomplete testQuality test/example.test.ts:2');
    expect(await run.haltMarker()).toContain('the pinned binding is incomplete');
  });
});
