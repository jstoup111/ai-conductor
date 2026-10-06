// Covers: task:1, task:2, task:3, task:4, task:5, task:9, task:11, task:21
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, utimes } from 'fs/promises';
import { execFile as execFileCb } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';

const execFile = promisify(execFileCb);

vi.mock('execa', () => ({
  execa: vi.fn(() =>
    Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
  ),
}));
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
  return {
    ...actual,
    performRebase: vi.fn().mockResolvedValue({
      kind: 'noop',
    }),
  };
});
vi.mock('../../src/engine/kickback-ledger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/kickback-ledger.js')>();
  return {
    ...actual,
    creditKickbackGateLaps: vi.fn(actual.creditKickbackGateLaps),
  };
});
import { execa } from 'execa';
import type { ConductState, ConductorEvent, Track } from '../../src/types/index.js';
import type { ConductStateStore } from '../../src/engine/conduct-state-store.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { StepName, StepStatus,} from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import {
  ALL_STEPS,
} from '../../src/engine/steps.js';
import {
  resolveExistingTaskBindingsForAdmission,
  recordActivePlanPath,
} from '../../src/engine/conductor.js';
import { Conductor } from '../test-conductor.js';
import type { StepRunner, StepRunResult, StepRunOptions } from '../../src/engine/conductor.js';
import type { GroupBranchLifecycleObserver, GroupMember } from '../../src/engine/group-core.js';
import { runGroupBranch } from '../../src/engine/group-core.js';
import type { GhRunner } from '../../src/engine/owner-gate/identity.js';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { createHash } from 'crypto';
import { writeVerdict, type GateVerdict } from '../../src/engine/gate-verdicts.js';
import { voidCoverageBindingForDecideChange } from '../../src/engine/coverage-binding-void.js';
import { createProtectedArtifactSeal } from '../../src/engine/protected-artifact-seal.js';
import { rewindState } from '../../src/engine/rewind.js';
import { createFilesystemConductStateStore } from '../../src/engine/filesystem-conduct-state-store.js';
import { persistPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
import {
  creditKickbackGateLaps,
  MAX_SUITE_INFRASTRUCTURE_RETRIES,
  readKickbackLedger,
  } from '../../src/engine/kickback-ledger.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { CloseoutEventTail } from '../../src/engine/closeout-tail.js';
import { dispatchTaskCommand } from '../../src/engine/task-cli.js';
import { MetricsListener } from '../../src/engine/otel/metrics-listener.js';
import { MetricsRecorder } from '../../src/engine/otel/metrics.js';
import { computeTimingRollup } from '../../src/engine/timing-rollup.js';
import { joinBuildReviewRubricOutcomes } from '../../src/engine/build-review-aggregate.js';
import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import {
  CODEX_MODEL_POLICY,
} from '../../src/engine/provider-model-policy.js';
import { CoverageBindingPayloadError } from '../../src/engine/step-runners.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { persistAsBuiltVerdict } from '../../src/engine/as-built-verdict-store.js';
import type { AsBuiltFinding } from '../../src/engine/as-built-contract.js';
import type { AsBuiltPolicy } from '../../src/engine/as-built-policy.js';
import { createRepairObligationStore } from '../../src/engine/repair-obligations.js';
import { recordTaskDigests } from '../../src/engine/task-digests.js';
import { planTaskDigests } from '../../src/engine/plan-task-parse.js';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';

const NOOP_GROUP_BRANCH_LIFECYCLE_OBSERVER: GroupBranchLifecycleObserver = {
  onAdmitted: () => undefined,
  onAttempt: () => undefined,
  onRetry: () => undefined,
  onSettled: () => undefined,
};

// These remediation fixtures exercise typed finding admission, not the
// separate code-validity policy. Their persisted audit was reviewed at
// `fixture-head`, and this runner proves that no gate-surface change occurred
// after it.
const PRESERVABLE_PRD_AUDIT_GIT = async () => ({ exitCode: 0, stdout: '', stderr: '' });

function failingBuildReviewAggregate(summary: string) {
  const lapId = parseBuildReviewLapId('fixture-lap')!;
  return joinBuildReviewRubricOutcomes({
    lapId,
    snapshotDigest: 'sha256:fixture',
    results: {
      testQuality: {
        kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest: 'sha256:fixture',
        contractVersion: 'v3', verdict: 'FAIL',
        findings: [{
          concernKind: 'test-insensitive', summary, evidenceLocations: ['test/fixture.test.ts:1'],
          anchor: {
            rubric: 'testQuality',
            locus: {
              path: 'test/fixture.test.ts',
              contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              display: 'fixture test',
            },
          },
        }],
      },
    },
  });
}

const AS_BUILT_FIXTURE_POLICY: AsBuiltPolicy = {
  reachability: { enabled: true, reason: 'fixture' },
  planGap: { enabled: true, reason: 'fixture' },
  adrCompliance: { enabled: false, reason: 'fixture' },
  diagramDrift: { enabled: false, reason: 'fixture' },
};

/**
 * The as-built report is a derived view. Conductor fixtures must write the
 * engine-owned verdict and bind it to the dispatch run rather than spoofing
 * the retired Markdown writer.
 */
async function writeAsBuiltFixture(
  projectRoot: string,
  runId: string | undefined,
  verdict: Parameters<typeof persistAsBuiltVerdict>[1],
): Promise<void> {
  await persistAsBuiltVerdict(projectRoot, verdict, {
    attemptId: runId ?? 'fixture-run',
    codeStamp: null,
    policy: AS_BUILT_FIXTURE_POLICY,
  });
}

/**
 * Remediation fixtures must supply the current typed authority. The derived
 * Markdown report deliberately is not an input to remediation routing.
 */
async function writePrdAuditFixableFixture(
  projectRoot: string,
  runId: string | undefined,
  findings: readonly { criterionId: string; ownerTaskId: string }[] = [{ criterionId: 'S1.1', ownerTaskId: '1' }],
): Promise<void> {
  await persistPrdAuditVerdict(projectRoot, {
    complete: true,
    judgment: {
      version: 'v1',
      criterionJudgments: findings.map(({ criterionId, ownerTaskId }) => {
        const match = /^S(.+)\.(\d+)$/.exec(criterionId);
        if (!match) throw new Error(`Invalid fixture criterion: ${criterionId}`);
        return {
          criterion: { storyId: match[1], ordinal: Number(match[2]) },
          criterionId,
          grade: 'FIXABLE' as const,
          evidence: `Fixture reports ${criterionId} as repairable.`,
          rationale: 'Fixture remediation requires the active owning task.',
          requirementAssociations: [],
          evidenceTaskIds: [ownerTaskId],
          ownerTaskId,
        };
      }),
      noOwnerObservations: [],
    },
    diagnostics: [],
    recordedDispositions: [],
  }, { attemptId: runId ?? 'fixture-prd-audit', codeStamp: 'fixture-head' });
}

function asBuiltBlockedFixture(findings: readonly AsBuiltFinding[]) {
  return {
    version: 'v1' as const,
    verdict: 'BLOCKED' as const,
    reachability: [],
    driftNotes: [],
    findings,
    violations: 'The implementation violates the governing requirement.',
    resolution: 'Apply the required remediation.',
  };
}

function asBuiltRemediableFixture(id: string, taskId: string, summary: string) {
  return asBuiltBlockedFixture([{
    id,
    class: 'REMEDIABLE' as const,
    reference: { kind: 'plan-task' as const, taskId },
    summary,
  }]);
}

function createMockStepRunner(result: StepRunResult = { success: true }): StepRunner {
  return {
    run: vi.fn().mockResolvedValue(result),
  };
}

function buildBoundaryState(featureDesc = 'feature'): ConductState {
  return {
    ...Object.fromEntries(
      ALL_STEPS
        .slice(0, ALL_STEPS.findIndex((step) => step.name === 'build'))
        .map((step) => [step.name, 'done']),
    ),
    feature_desc: featureDesc,
    build: 'pending',
  } as ConductState;
}

function stopAtFirstBuild(hints: string[]): StepRunner {
  return {
    run: vi.fn(async (step, _state, options) => {
      if (step === 'build') {
        hints.push(options?.retryReason ?? '');
        return { success: false, error: 'sentinel: stop after first BUILD prompt' };
      }
      return { success: true };
    }),
  };
}

import { writeKickbackLedger } from '../kickback-ledger-test-support.js';

describe('engine/conductor', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-test-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    vi.mocked(creditKickbackGateLaps).mockClear();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // Covers: rem-prd-audit-rem-prd-audit-t8-restart-prompt
  it('restores every plan-amendment reopen into the first BUILD prompt after a restart without losing a coexisting gate repair', async () => {
    const planPath = '.docs/plans/feature.md';
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await writeFile(join(dir, planPath), [
      '# Plan',
      '',
      '### Task 1: Restore request authorization',
      '',
      '### Task 2: Preserve audit provenance',
      '',
    ].join('\n'));
    await writeState(statePath, buildBoundaryState());

    const repairs = createRepairObligationStore(dir, join(dir, '.pipeline', 'engine-state.json'));
    const admissions = [
      {
        id: 'plan-amendment-1',
        taskIds: ['1'],
        source: {
          findingId: 'digest-1', authority: 'plan_amendment' as const,
          instruction: 'Task 1 (Restore request authorization) plan text changed since it was implemented; reopen it in BUILD.',
        },
      },
      {
        id: 'plan-amendment-2',
        taskIds: ['2'],
        source: {
          findingId: 'digest-2', authority: 'plan_amendment' as const,
          instruction: 'Task 2 (Preserve audit provenance) plan text changed since it was implemented; reopen it in BUILD.',
        },
      },
      {
        id: 'gate-repair-1',
        taskIds: ['1'],
        source: {
          findingId: 'ARCH-1', authority: 'architecture_review_as_built' as const,
          instruction: 'ARCH-1 requires Task 1 to restore the approved authorization guard.',
        },
      },
    ];
    for (const admission of admissions) {
      const result = await repairs.admitOrReplay(admission.id, {
        ...admission,
        planPath,
        baseline: { head: '', tree: 'fixture-tree', resolvedTaskIds: [] },
      });
      if (!result.ok) throw new Error(result.message);
      const settled = await repairs.markSettled({ planPath, obligationId: result.obligation.id });
      if (!settled.ok) throw new Error(settled.message);
    }

    const hints: string[] = [];
    await new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: stopAtFirstBuild(hints),
      events,
      fromStep: 'build',
      mode: 'auto',
      maxRetries: 1,
      verifyArtifacts: false,
    }).run();

    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('Task 1 (Restore request authorization) plan text changed since it was implemented; reopen it in BUILD.');
    expect(hints[0]).toContain('Task 2 (Preserve audit provenance) plan text changed since it was implemented; reopen it in BUILD.');
    expect(hints[0]).toContain('ARCH-1 requires Task 1 to restore the approved authorization guard.');
  });

  // Covers: rem-prd-audit-rem-prd-audit-t8-restart-prompt
  it('adds a plan-amendment reopen seeded before the first BUILD dispatch to that prompt without a restart', async () => {
    const planPath = '.docs/plans/feature.md';
    const originalPlan = '# Plan\n\n### Task 1: Validate callback signatures\n';
    const amendedPlan = '# Plan\n\n### Task 1: Validate signed callback signatures\n';
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await writeFile(join(dir, planPath), originalPlan);
    await recordTaskDigests(dir, planPath, Object.fromEntries(planTaskDigests(originalPlan)));
    await writeFile(join(dir, planPath), amendedPlan);
    await writeState(statePath, buildBoundaryState());

    const hints: string[] = [];
    await new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: stopAtFirstBuild(hints),
      events,
      fromStep: 'build',
      mode: 'auto',
      maxRetries: 1,
      verifyArtifacts: false,
    }).run();

    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('Task 1 (Validate signed callback signatures) plan text changed since it was implemented; reopen it in BUILD.');
  });


  // Covers: task:9
  it('preserves conductor terminal tiers through the metrics listener before daemon dispatch-end', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })],
    });
    const listener = new MetricsListener(
      new MetricsRecorder(provider.getMeter('conductor-terminal-tier'), { project: 'project', worker: 'worker' }),
      undefined,
      'feature',
    );
    listener.start(events);
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: createMockStepRunner(), events });

    try {
      await (conductor as unknown as {
        completeRun(state: ConductState, doneMarkerBody: string): Promise<void>;
      }).completeRun({ complexity_tier: 'M' }, 'complete\n');
      await events.emit({ type: 'feature_dispatch_ended', slug: 'feature', outcome: 'complete', tier: 'L' });
      (conductor as unknown as { haltState: ConductState }).haltState = { complexity_tier: 'S' };
      await (conductor as unknown as { emitLoopHalt(reason: string): Promise<void> }).emitLoopHalt('halted');
      await events.emit({
        type: 'feature_dispatch_ended', slug: 'feature', outcome: 'halted', haltClass: 'mechanical', step: 'build', tier: 'L',
      });
      await provider.forceFlush();

      const outcomes = exporter.getMetrics()
        .flatMap((batch) => batch.scopeMetrics)
        .flatMap((scope) => scope.metrics)
        .filter((metric) => metric.descriptor.name === 'conductor.run.outcomes')
        .flatMap((metric) => metric.dataPoints as Array<{ attributes: Record<string, unknown> }>)
        .map((point) => point.attributes);
      expect(outcomes).toEqual([
        { outcome: 'complete', tier: 'M', project: 'project', worker: 'worker', feature: 'feature' },
        { outcome: 'halted', tier: 'S', project: 'project', worker: 'worker', feature: 'feature' },
      ]);
    } finally {
      listener.stop();
      await provider.shutdown();
    }
  });

  // Covers: task:9, rem-as-built-rem-ab2-2
  it('keeps a plan-gap halt tiered when the centralized halt follows a tail poll', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, 'plan.md'), [
      '### Task 7: Deliver the bounded behavior',
      '**Done when:**',
      '- The approved behavior can be verified without widening the plan.',
      '',
    ].join('\n'));
    await recordActivePlanPath(dir, 'plan.md');
    await writeState(statePath, { complexity_tier: 'M' });
    await writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
      tasks: [{ id: '7', name: 'Task 7', status: 'in_progress' }],
    }));
    await writeFile(join(dir, '.pipeline', 'current-task'), '7');

    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })],
    });
    const listener = new MetricsListener(
      new MetricsRecorder(provider.getMeter('conductor-plan-gap-tier'), { project: 'project', worker: 'worker' }),
      undefined,
      'feature',
    );
    const tail = new CloseoutEventTail({ projectRoot: dir, events });
    listener.start(events);
    const buildProvider: StepRunner = {
      run: async (step) => {
        expect(step).toBe('build');
        await expect(dispatchTaskCommand({
          kind: 'done', id: '7', planGap: { index: 1, reason: 'No approved path.' },
        }, dir)).resolves.toBe(1);
        await tail.poll();
        return { success: false, output: 'plan gap' };
      },
    };
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: buildProvider, events });

    try {
      await buildProvider.run('build', { complexity_tier: 'M' });
      const persistedState = await readState(statePath);
      if (!persistedState.ok) throw new Error(persistedState.error.message);
      (conductor as unknown as { haltState: ConductState }).haltState = persistedState.value;
      await (conductor as unknown as { emitLoopHalt(reason: string): Promise<void> }).emitLoopHalt('centralized halt');
      await events.emit({
        type: 'feature_dispatch_ended', slug: 'feature', outcome: 'halted', haltClass: 'plan-gap', step: 'build', tier: 'M',
      });
      await provider.forceFlush();

      const outcomes = exporter.getMetrics()
        .flatMap((batch) => batch.scopeMetrics)
        .flatMap((scope) => scope.metrics)
        .filter((metric) => metric.descriptor.name === 'conductor.run.outcomes')
        .flatMap((metric) => metric.dataPoints as Array<{ attributes: Record<string, unknown> }>)
        .map((point) => point.attributes);
      expect(outcomes).toEqual([
        { outcome: 'halted', tier: 'M', project: 'project', worker: 'worker', feature: 'feature' },
      ]);
    } finally {
      tail.stop();
      listener.stop();
      await provider.shutdown();
    }
  });

  // Covers: task:9
  it('omits tier from unresolved completion and an early halt', async () => {
    const terminalEvents: Array<Extract<ConductorEvent, { type: 'feature_complete' | 'loop_halt' }>> = [];
    events.on('feature_complete', (event) => { terminalEvents.push(event as (typeof terminalEvents)[number]); });
    const haltEvents = new ConductorEventEmitter();
    haltEvents.on('loop_halt', (event) => { terminalEvents.push(event as (typeof terminalEvents)[number]); });
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })],
    });
    const completionListener = new MetricsListener(
      new MetricsRecorder(provider.getMeter('conductor-terminal-tier'), { project: 'project', worker: 'worker' }), undefined, 'unresolved-complete',
    );
    const haltListener = new MetricsListener(
      new MetricsRecorder(provider.getMeter('conductor-terminal-tier'), { project: 'project', worker: 'worker' }), undefined, 'early-halt',
    );
    completionListener.start(events);
    haltListener.start(haltEvents);
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: createMockStepRunner(), events });
    const haltConductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: createMockStepRunner(), events: haltEvents });

    try {
      await (conductor as unknown as {
        completeRun(state: ConductState, doneMarkerBody: string): Promise<void>;
      }).completeRun({}, 'complete\n');
      await (haltConductor as unknown as { emitLoopHalt(reason: string): Promise<void> }).emitLoopHalt('early halt');
      await provider.forceFlush();

      const outcomes = exporter.getMetrics()
        .flatMap((batch) => batch.scopeMetrics)
        .flatMap((scope) => scope.metrics)
        .filter((metric) => metric.descriptor.name === 'conductor.run.outcomes')
        .flatMap((metric) => metric.dataPoints as Array<{ attributes: Record<string, unknown> }>)
        .map((point) => point.attributes);
      expect({
        eventTiers: terminalEvents.map((event) => Object.hasOwn(event, 'tier')),
        outcomes,
      }).toEqual({
        eventTiers: [false, false],
        outcomes: [
          { outcome: 'complete', project: 'project', worker: 'worker', feature: 'unresolved-complete' },
          { outcome: 'halted', project: 'project', worker: 'worker', feature: 'early-halt' },
        ],
      });
    } finally {
      completionListener.stop();
      haltListener.stop();
      await provider.shutdown();
    }
  });

  // Covers: task:3
  it.each([
    { complexityTier: 'S' as const, expectedTier: 'S' as const },
    { complexityTier: undefined, expectedTier: undefined },
  ])(
    'emits feature_usage_total with the raw finish-close tier $expectedTier',
    async ({ complexityTier, expectedTier }) => {
      const state: ConductState = {};
      for (const step of ALL_STEPS) {
        if (step.name === 'finish') break;
        state[step.name] = 'done';
      }
      Object.assign(state, {
        ...(complexityTier !== undefined && { complexity_tier: complexityTier }),
        build_review: 'skipped',
        manual_test: 'skipped',
        prd_audit: 'skipped',
        architecture_review_as_built: 'skipped',
        rebase: 'skipped',
      });
      await writeState(statePath, state);
      await mkdir(join(dir, '.pipeline'), { recursive: true });

      const usageTotals: Extract<ConductorEvent, { type: 'feature_usage_total' }>[] = [];
      events.on('feature_usage_total', (event) => {
        if (event.type === 'feature_usage_total') usageTotals.push(event);
      });
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: createMockStepRunner(),
        events,
        fromStep: 'finish',
        mode: 'auto',
        daemon: true,
        maxRetries: 1,
        verifyArtifacts: false,
      });

      await conductor.run();

      expect(usageTotals).toHaveLength(1);
      expect(usageTotals[0]?.tier).toBe(expectedTier);
      if (expectedTier === undefined) {
        expect(Object.hasOwn(usageTotals[0]!, 'tier')).toBe(false);
        expect(usageTotals[0]?.tier).not.toBe('L');
      }
    },
  );

  // Covers: task:4
  it.each([
    { type: 'step_completed' as const, tier: 'L' as const, event: { status: 'done' as const } },
    { type: 'step_failed' as const, tier: 'M' as const, event: { error: 'failed', retryCount: 0 } },
  ])('carries the closing $type tier into its feature cost snapshot', async ({ type, tier, event }) => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const persister = new EventPersister(join(dir, '.pipeline/events.jsonl'), events);
    const snapshots: Extract<ConductorEvent, { type: 'feature_cost_snapshot' }>[] = [];
    events.on('feature_cost_snapshot', (emitted) => {
      if (emitted.type === 'feature_cost_snapshot') snapshots.push(emitted);
    });
    persister.start();

    try {
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: createMockStepRunner(), events,
      });
      const executionEvents = conductor as unknown as {
        emitExecutionEvent(event: ConductorEvent): Promise<void>;
      };

      await executionEvents.emitExecutionEvent({ type: 'step_started', step: 'build', index: 0 });
      await executionEvents.emitExecutionEvent({ type, step: 'build', tier, ...event } as ConductorEvent);

      expect(snapshots).toEqual([expect.objectContaining({ tier })]);
    } finally {
      persister.stop();
    }
  });

  // Covers: task:4
  it('omits tier from a cost snapshot when its closing step has no tier', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const persister = new EventPersister(join(dir, '.pipeline/events.jsonl'), events);
    const snapshots: Extract<ConductorEvent, { type: 'feature_cost_snapshot' }>[] = [];
    events.on('feature_cost_snapshot', (emitted) => {
      if (emitted.type === 'feature_cost_snapshot') snapshots.push(emitted);
    });
    persister.start();

    try {
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: createMockStepRunner(), events,
      });
      const executionEvents = conductor as unknown as {
        emitExecutionEvent(event: ConductorEvent): Promise<void>;
      };

      await executionEvents.emitExecutionEvent({ type: 'step_started', step: 'build', index: 0 });
      await executionEvents.emitExecutionEvent({ type: 'step_completed', step: 'build', status: 'done' });

      expect(Object.hasOwn(snapshots[0]!, 'tier')).toBe(false);
    } finally {
      persister.stop();
    }
  });

  // Covers: task:4
  it('suppresses the tiered cost snapshot when the ledger read fails without changing the terminal verdict', async () => {
    const snapshots: Extract<ConductorEvent, { type: 'feature_cost_snapshot' }>[] = [];
    const terminals: Extract<ConductorEvent, { type: 'step_completed' }>[] = [];
    events.on('feature_cost_snapshot', (emitted) => {
      if (emitted.type === 'feature_cost_snapshot') snapshots.push(emitted);
    });
    events.on('step_completed', (emitted) => {
      if (emitted.type === 'step_completed') terminals.push(emitted);
    });
    const conductor = new Conductor({
      projectRoot: dir, stateFilePath: statePath, stepRunner: createMockStepRunner(), events,
    });
    const executionEvents = conductor as unknown as {
      emitExecutionEvent(event: ConductorEvent): Promise<void>;
    };

    await executionEvents.emitExecutionEvent({ type: 'step_started', step: 'build', index: 0 });
    await executionEvents.emitExecutionEvent({
      type: 'step_completed', step: 'build', status: 'done', tier: 'L',
    });

    expect({ snapshots, terminals }).toEqual({
      snapshots: [],
      terminals: [expect.objectContaining({ status: 'done', tier: 'L' })],
    });
  });

  describe('existing-task remediation admission', () => {
    it('resolves bound ids from the active plan through the shared resolver', () => {
      const result = resolveExistingTaskBindingsForAdmission(
        [{ id: '2' }],
        new Set(['1', '2']),
      );

      expect(result).toEqual({ kind: 'resolved', ids: ['2'] });
    });

    it('rejects a bound id absent from the active plan and names it', () => {
      const result = resolveExistingTaskBindingsForAdmission(
        [{ id: 'missing-task' }],
        new Set(['1', '2']),
      );

      expect(result).toEqual({ kind: 'unresolvable', id: 'missing-task' });
    });

    it('drops a non-gate existing-task gap before binding or re-staging it', async () => {
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.docs', 'plans', 'existing-task-bindings.md'), '### Task 1: Existing work\n');
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: {
          run: async (step) => {
            if (step === 'remediate') {
              await writeFile(join(dir, '.pipeline', 'remediation.json'), JSON.stringify({
                dispositions: [{
                  id: 'missing-binding',
                  disposition: 'existing-task',
                  category: null,
                  rationale: 'The existing task owns this repair.',
                  tasks: [{ id: 'missing-task', title: 'Existing task binding' }],
                }],
              }));
            }
            return { success: true };
          },
        },
        events,
        projectRoot: dir,
      });

      const outcome = await (conductor as any).planRemediation(
        { feature_desc: 'existing-task-bindings', session_started_at: Date.now() - 1_000 },
        ALL_STEPS,
        'test admission',
        { source: 'finish' },
      );

      expect(outcome).toMatchObject({ kind: 'halt', haltClass: 'kickback-cap' });
      expect(outcome.detail).toContain('no admitted remediation gap');
    });

    it('fails closed on an unexpected existing-task id in an enforced as-built round', async () => {
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.docs', 'plans', 'existing-task-bindings.md'), '### Task 1: Existing work\n');
      await writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
        tasks: [{ id: '1', status: 'completed' }],
      }));
      await writeAsBuiltFixture(dir, undefined, asBuiltRemediableFixture('ARCH-1', '1', 'Existing work'));
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: { run: async () => {
          await writeFile(join(dir, '.pipeline', 'remediation.json'), JSON.stringify({
            dispositions: [{
              id: 'unexpected-existing', disposition: 'existing-task', category: null,
              rationale: 'Incorrect binding.', tasks: [{ id: '1', title: 'Existing work' }],
            }],
          }));
          return { success: true };
        } },
        events,
        projectRoot: dir,
        config: { architecture_review_as_built: { remediation: { enabled: true } } } as never,
      });

      const outcome = await (conductor as any).planRemediation(
        { feature_desc: 'existing-task-bindings', session_started_at: Date.now() - 1_000 },
        ALL_STEPS,
        'unexpected existing-task',
        { source: 'architecture-review-as-built', evidence: [{ gate: 'architecture_review_as_built', evidenceFile: '.pipeline/architecture-review-as-built.json' }] },
      );

      expect(outcome).toMatchObject({ kind: 'halt', haltClass: 'needs-human' });
      expect(outcome.detail).toContain('unexpected-existing');
      expect(JSON.parse(await readFile(join(dir, '.pipeline', 'task-status.json'), 'utf8')).tasks)
        .toEqual([{ id: '1', status: 'completed' }]);
    });

    it.each([
      ['missing', undefined, false],
      ['unreadable', undefined, true],
    ])('halts needs-human without routing when task-status is %s during re-stage', async (_case, taskStatus, makeUnreadable) => {
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.docs', 'plans', 'existing-task-bindings.md'), '### Task 1: Existing work\n');
      await writeAsBuiltFixture(dir, undefined, asBuiltRemediableFixture('existing-binding', '1', 'Existing work'));
      if (taskStatus !== undefined) {
        await writeFile(join(dir, '.pipeline', 'task-status.json'), taskStatus);
      }
      if (makeUnreadable) {
        await mkdir(join(dir, '.pipeline', 'task-status.json'));
      }
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: {
          run: async (step) => {
            if (step === 'remediate') {
              await writeFile(join(dir, '.pipeline', 'remediation.json'), JSON.stringify({
                dispositions: [{
                  id: 'existing-binding',
                  disposition: 'existing-task',
                  category: null,
                  rationale: 'The existing task owns this repair.',
                  tasks: [{ id: '1', title: 'Existing task binding' }],
                }],
              }));
            }
            return { success: true };
          },
        },
        events,
        projectRoot: dir,
      });

      const outcome = await (conductor as any).planRemediation(
        { feature_desc: 'existing-task-bindings', session_started_at: Date.now() - 1_000, build: 'done' },
        ALL_STEPS,
        'test re-stage failure',
        { source: 'architecture-review-as-built', evidence: [{ gate: 'architecture_review_as_built', evidenceFile: '.pipeline/architecture-review-as-built.json' }] },
      );

      expect(outcome).toMatchObject({ kind: 'halt', haltClass: 'needs-human' });
      expect(outcome.detail).toMatch(/re-stage.*task-status/i);
    });

    it('halts needs-human without routing when a bound id is absent from task-status during re-stage', async () => {
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.docs', 'plans', 'existing-task-bindings.md'), '### Task 1: Existing work\n');
      await writeAsBuiltFixture(dir, undefined, asBuiltRemediableFixture('missing-status-binding', '1', 'Existing work'));
      await writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
        tasks: [{ id: '2', status: 'completed' }],
      }));
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: {
          run: async (step) => {
            if (step === 'remediate') {
              await writeFile(join(dir, '.pipeline', 'remediation.json'), JSON.stringify({
                dispositions: [{
                  id: 'missing-status-binding',
                  disposition: 'existing-task',
                  category: null,
                  rationale: 'The existing task owns this repair.',
                  tasks: [{ id: '1', title: 'Existing task binding' }],
                }],
              }));
            }
            return { success: true };
          },
        },
        events,
        projectRoot: dir,
      });

      const outcome = await (conductor as any).planRemediation(
        { feature_desc: 'existing-task-bindings', session_started_at: Date.now() - 1_000, build: 'done' },
        ALL_STEPS,
        'test missing re-stage id',
        { source: 'architecture-review-as-built', evidence: [{ gate: 'architecture_review_as_built', evidenceFile: '.pipeline/architecture-review-as-built.json' }] },
      );

      expect(outcome).toMatchObject({ kind: 'halt', haltClass: 'needs-human' });
      expect(outcome.detail).toMatch(/re-stage.*'1'/i);
      expect(JSON.parse(await readFile(join(dir, '.pipeline', 'task-status.json'), 'utf8')))
        .toEqual({ tasks: [{ id: '2', status: 'completed' }] });
    });

    it('strips a trailing parenthesized binding annotation through the shared resolver', () => {
      const result = resolveExistingTaskBindingsForAdmission(
        [{ id: '2 (already scoped)' }],
        new Set(['1', '2']),
      );

      expect(result).toEqual({ kind: 'resolved', ids: ['2'] });
    });

    it('routes validated existing-task findings to build without appending or spending growth (#2119)', async () => {
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const planPath = join(dir, '.docs', 'plans', 'existing-task-bindings.md');
      const authoredPlan = Array.from(
        { length: 8 },
        (_, index) => `### Task ${index + 1}: Existing work ${index + 1}`,
      ).join('\n');
      await writeFile(planPath, authoredPlan);
      const git = (args: string[]) => execFile('git', args, { cwd: dir });
      await git(['init', '-b', 'main']);
      await git(['config', 'user.email', 'test@example.com']);
      await git(['config', 'user.name', 'Conductor test']);
      await git(['add', '--', '.docs/plans/existing-task-bindings.md']);
      await git(['commit', '-m', 'test: seed plan']);
      const uncommittedPlan = `${authoredPlan}\n\nOperator edit that must not be staged\n`;
      await writeFile(planPath, uncommittedPlan);
      await writeFile(
        join(dir, '.pipeline', 'task-status.json'),
        JSON.stringify({ tasks: Array.from({ length: 8 }, (_, index) => ({
          id: String(index + 1),
          status: index < 3 ? 'completed' : 'pending',
        })) }),
      );
      await writeKickbackLedger(dir, {
        version: 1,
        gates: {},
        growth: { authored: 8, added: 0, byGate: {} },
      });
      await writeAsBuiltFixture(dir, undefined, asBuiltBlockedFixture([
        { id: 'ARCH-1', class: 'REMEDIABLE', reference: { kind: 'plan-task', taskId: '1' }, summary: 'Repair task one' },
        { id: 'ARCH-2', class: 'REMEDIABLE', reference: { kind: 'plan-task', taskId: '2' }, summary: 'Repair task two' },
      ]));
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: {
          run: async (step) => {
            if (step === 'remediate') {
              await writeFile(join(dir, '.pipeline', 'remediation.json'), JSON.stringify({
                dispositions: [1, 2].map((id) => ({
                  id: `ARCH-${id}`,
                  disposition: 'existing-task',
                  category: null,
                  rationale: `Task ${id} already owns this repair.`,
                  tasks: [{ id: String(id), title: `Existing work ${id}` }],
                })),
              }));
            }
            return { success: true };
          },
        },
        events,
        projectRoot: dir,
        config: { architecture_review_as_built: { remediation: { enabled: true } } } as never,
      });

      const outcome = await (conductor as any).planRemediation(
        { feature_desc: 'existing-task-bindings', session_started_at: Date.now() - 1_000 },
        ALL_STEPS,
        'test #2119',
        {
          source: 'architecture-review-as-built',
          evidence: [{
            gate: 'architecture_review_as_built',
            evidenceFile: '.pipeline/architecture-review-as-built.json',
          }],
        },
      );

      expect(outcome).toMatchObject({ kind: 'route', target: 'build' });
      expect(await readFile(planPath, 'utf8')).toBe(uncommittedPlan);
      await expect(git(['diff', '--cached', '--quiet', '--', '.docs/plans/existing-task-bindings.md']))
        .resolves.toBeDefined();
      const commits = await git(['log', '--format=%s']);
      expect(commits.stdout).not.toContain('chore(plan): record appended remediation tasks');
      // Re-stage every bound task before the caller rewinds to build. Task 3
      // is deliberately completed but unbound: it must stay completed, proving
      // this route does not broadly reset task tracking.
      expect(JSON.parse(await readFile(join(dir, '.pipeline', 'task-status.json'), 'utf8')).tasks)
        .toEqual([
          { id: '1', name: 'Existing work 1', status: 'pending' },
          { id: '2', name: 'Existing work 2', status: 'pending' },
          { id: '3', status: 'completed' },
          { id: '4', name: 'Existing work 4', status: 'pending' },
          { id: '5', name: 'Existing work 5', status: 'pending' },
          { id: '6', name: 'Existing work 6', status: 'pending' },
          { id: '7', name: 'Existing work 7', status: 'pending' },
          { id: '8', name: 'Existing work 8', status: 'pending' },
        ]);
      const ledger = await readKickbackLedger(dir);
      // Existing-task repairs now reserve their lap for the BUILD boundary,
      // rather than charging while the task row is re-staged.
      expect(ledger.gates.architecture_review_as_built?.laps).toBeUndefined();
      expect(ledger.growth).toEqual({ authored: 8, added: 0, byGate: {} });
      expect(ledger.pendingRepair).toMatchObject({
        charges: { architecture_review_as_built: { laps: 1, growth: 0 } },
        taskIds: ['1', '2'],
      });
      // A non-appending binding is still a successful as-built remediation
      // authorization. It must leave the same durable finding record that
      // the next successful as-built projection consumes.
      expect(ledger.pendingAsBuiltRemediationFindings).toEqual([{
        gate: 'architecture_review_as_built',
        finding: 'ARCH-1',
        class: 'REMEDIABLE',
        governingClause: 'Task 1',
        reference: { kind: 'plan-task', taskId: '1' },
        summary: 'Repair task one',
        outcome: 'remediated',
      }, {
        gate: 'architecture_review_as_built',
        finding: 'ARCH-2',
        class: 'REMEDIABLE',
        governingClause: 'Task 2',
        reference: { kind: 'plan-task', taskId: '2' },
        summary: 'Repair task two',
        outcome: 'remediated',
      }]);

      expect(await (conductor as unknown as {
        projectPendingAsBuiltRemediationFindings: () => Promise<string | undefined>;
      }).projectPendingAsBuiltRemediationFindings()).toBeUndefined();
      expect((await readKickbackLedger(dir)).pendingAsBuiltRemediationFindings).toBeUndefined();
    });

    it('refuses pending as-built projection when its ledger is unreadable', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline', 'kickback-ledger.json'), JSON.stringify({
        version: 1,
        gates: {},
        pendingAsBuiltRemediationFindings: [{ finding: 'malformed' }],
      }));
      const conductor = new Conductor({
        stateFilePath: join(dir, '.pipeline', 'conduct-state.json'),
        stepRunner: createMockStepRunner(),
        events: new ConductorEventEmitter(),
        projectRoot: dir,
      });

      await expect((conductor as unknown as {
        projectPendingAsBuiltRemediationFindings: () => Promise<string | undefined>;
      }).projectPendingAsBuiltRemediationFindings()).resolves.toContain('kickback ledger is unreadable');
    });

    it('records an existing-task lap at the as-built cap for build-boundary settlement', async () => {
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.docs', 'plans', 'existing-task-bindings.md'),
        Array.from({ length: 8 }, (_, i) => `### Task ${i + 1}: Existing work ${i + 1}`).join('\n'),
      );
      await writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
        tasks: [{ id: '1', status: 'completed' }],
      }));
      await writeAsBuiltFixture(dir, undefined, asBuiltRemediableFixture('ARCH-1', '1', 'Repair task one'));
      await writeKickbackLedger(dir, {
        version: 1,
        gates: {
          architecture_review_as_built: {
            count: 0, cumulative: 0, treeHash: null, lastReason: '', priorVerdict: true,
            resolvedBefore: 0, laps: 1,
          },
        },
        // Two growth slots remain, but this existing-task binding draws none.
        growth: { authored: 8, added: 0, byGate: {} },
      });
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: {
          run: async (step) => {
            if (step === 'remediate') {
              await writeFile(join(dir, '.pipeline', 'remediation.json'), JSON.stringify({
                dispositions: [{
                  id: 'ARCH-1', disposition: 'existing-task', category: null,
                  rationale: 'Task 1 already owns this repair.',
                  tasks: [{ id: '1', title: 'Existing work' }],
                }],
              }));
            }
            return { success: true };
          },
        },
        events,
        projectRoot: dir,
        config: {
          architecture_review_as_built: { remediation: { enabled: true }, max_remediation_laps: 1 },
        } as never,
      });

      const outcome = await (conductor as any).planRemediation(
        { feature_desc: 'existing-task-bindings', session_started_at: Date.now() - 1_000 },
        ALL_STEPS,
        'test existing-task lap cap',
        {
          source: 'architecture-review-as-built',
          evidence: [{
            gate: 'architecture_review_as_built',
            evidenceFile: '.pipeline/architecture-review-as-built.json',
          }],
        },
      );

      expect(outcome).toMatchObject({ kind: 'route', target: 'build' });
      expect((await readKickbackLedger(dir)).pendingRepair).toMatchObject({
        charges: { architecture_review_as_built: { laps: 1, growth: 0 } },
        taskIds: ['1'],
      });
    });

    it('routes a validated prd_audit FIXABLE existing-task gap without appending', async () => {
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const planPath = join(dir, '.docs', 'plans', 'existing-task-bindings.md');
      const authoredPlan = '### Task 1: Existing work\n';
      await writeFile(planPath, authoredPlan);
      await writeFile(join(dir, '.docs', 'stories', 'existing-task-bindings.md'), '## Story 1: Existing work\n\n### Happy Path\n- Given work, when repaired, then it passes.\n');
      await writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [{ id: '1', status: 'pending' }] }));
      await writePrdAuditFixableFixture(dir, undefined);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: {
          run: async (step) => {
            if (step === 'remediate') {
              await writeFile(join(dir, '.pipeline', 'remediation.json'), JSON.stringify({
                dispositions: [{
                  id: 'S1.1', disposition: 'existing-task', category: null,
                  rationale: 'Task 1 already owns this repair.',
                  tasks: [{ id: '1', title: 'Existing work' }],
                }],
              }));
            }
            return { success: true };
          },
        },
        events,
        projectRoot: dir,
        git: PRESERVABLE_PRD_AUDIT_GIT,
      });

      const outcome = await (conductor as any).planRemediation(
        { feature_desc: 'existing-task-bindings', session_started_at: Date.now() - 1_000 },
        ALL_STEPS,
        'test prd existing-task',
        { source: 'prd_audit', evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }] },
      );

      expect(outcome).toMatchObject({ kind: 'route', target: 'build' });
      expect(await readFile(planPath, 'utf8')).toBe(authoredPlan);
      expect(JSON.parse(await readFile(join(dir, '.pipeline', 'task-status.json'), 'utf8')).tasks)
        .toEqual([{ id: '1', name: 'Existing work', status: 'pending' }]);
      expect((await readKickbackLedger(dir)).pendingRepair).toMatchObject({
        charges: { prd_audit: { laps: 1, growth: 0 } },
        taskIds: ['1'],
      });
    });

    it('records the prd-audit existing-task lap without spending growth', async () => {
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const planPath = join(dir, '.docs', 'plans', 'existing-task-bindings.md');
      await writeFile(planPath, '### Task 1: PRD work\n\n### Task 2: As-built work\n');
      await writeFile(join(dir, '.docs', 'stories', 'existing-task-bindings.md'), '## Story 1: Existing work\n\n### Happy Path\n- Given work, when repaired, then it passes.\n');
      await writePrdAuditFixableFixture(dir, undefined);
      await writeAsBuiltFixture(dir, undefined, asBuiltRemediableFixture('ARCH-1', '2', 'Repair task two'));
      await writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
        tasks: [{ id: '1', status: 'completed' }, { id: '2', status: 'completed' }],
      }));
      await writeKickbackLedger(dir, {
        version: 1,
        gates: {},
        growth: { authored: 2, added: 0, byGate: {} },
      });
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: {
          run: async (step) => {
            if (step === 'remediate') {
              await writeFile(join(dir, '.pipeline', 'remediation.json'), JSON.stringify({
                dispositions: [
                  { id: 'S1.1', disposition: 'existing-task', category: null, rationale: 'Task 1 owns this repair.', tasks: [{ id: '1', title: 'PRD work' }] },
                  { id: 'ARCH-1', disposition: 'existing-task', category: null, rationale: 'Task 2 owns this repair.', tasks: [{ id: '2', title: 'As-built work' }] },
                ],
              }));
            }
            return { success: true };
          },
        },
        events,
        projectRoot: dir,
        git: PRESERVABLE_PRD_AUDIT_GIT,
        config: { architecture_review_as_built: { remediation: { enabled: true } } } as never,
      });

      const outcome = await (conductor as any).planRemediation(
        { feature_desc: 'existing-task-bindings', session_started_at: Date.now() - 1_000 },
        ALL_STEPS,
        'test mixed existing-task laps',
        {
          source: 'prd_audit',
          evidence: [
            { gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' },
            { gate: 'architecture_review_as_built', evidenceFile: '.pipeline/architecture-review-as-built.json' },
          ],
        },
      );

      expect(outcome).toMatchObject({ kind: 'route', target: 'build' });
      const ledger = await readKickbackLedger(dir);
      expect(ledger.pendingRepair).toMatchObject({
        charges: {
          prd_audit: { laps: 1, growth: 0 },
        },
        taskIds: ['1'],
      });
      expect(ledger.growth).toEqual({ authored: 2, added: 0, byGate: {} });
    });

    it('carries an existing-task finding through a consolidated manual-test FAIL round without a lap, pending finding, or re-stage (AB-1)', async () => {
      // Covers: task:8
      // adr-2026-08-25 decision 8/9 + Story 4: when the same validation-group
      // round carries a manual_test FAIL, the consolidated kickback owns the
      // work order. The as-built finding still rides the merged route, but
      // the gate-local existing-task mechanics — lap charge, pending finding,
      // task-status re-stage, no-op baseline — must be unreachable.
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const planPath = join(dir, '.docs', 'plans', 'existing-task-bindings.md');
      await writeFile(planPath, '### Task 1: Existing work 1\n\n### Task 2: Existing work 2\n');
      const taskStatus = JSON.stringify({
        tasks: [{ id: '1', status: 'completed' }, { id: '2', status: 'completed' }],
      });
      await writeFile(join(dir, '.pipeline', 'task-status.json'), taskStatus);
      await writeKickbackLedger(dir, {
        version: 1,
        gates: {},
        growth: { authored: 2, added: 0, byGate: {} },
      });
      await writeAsBuiltFixture(dir, undefined, asBuiltRemediableFixture('ARCH-1', '1', 'Repair task one'));
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: {
          run: async (step) => {
            if (step === 'remediate') {
              await writeFile(join(dir, '.pipeline', 'remediation.json'), JSON.stringify({
                dispositions: [{
                  id: 'ARCH-1',
                  disposition: 'existing-task',
                  category: null,
                  rationale: 'Task 1 already owns this repair.',
                  tasks: [{ id: '1', title: 'Existing work 1' }],
                }],
              }));
            }
            return { success: true };
          },
        },
        events,
        projectRoot: dir,
        config: { architecture_review_as_built: { remediation: { enabled: true } } } as never,
      });

      const outcome = await (conductor as any).planRemediation(
        { feature_desc: 'existing-task-bindings', session_started_at: Date.now() - 1_000 },
        ALL_STEPS,
        'test consolidated existing-task round',
        {
          source: 'validation-group',
          evidence: [{
            gate: 'architecture_review_as_built',
            evidenceFile: '.pipeline/architecture-review-as-built.json',
          }],
          consolidatedManualTestFail: true,
        },
      );

      // The finding is still addressed and rides the merged work order.
      expect(outcome).toMatchObject({ kind: 'route', target: 'build' });
      expect((outcome as { hint: string }).hint).toContain('ARCH-1');
      // ...but none of the gate-local existing-task mechanics ran.
      expect(await readFile(join(dir, '.pipeline', 'task-status.json'), 'utf8')).toBe(taskStatus);
      const ledger = await readKickbackLedger(dir);
      expect(ledger.gates.architecture_review_as_built?.laps).toBeUndefined();
      expect(ledger.pendingAsBuiltRemediationFindings).toBeUndefined();
      expect(ledger.growth).toEqual({ authored: 2, added: 0, byGate: {} });
      expect((conductor as any).pendingNoOpBaselines.size).toBe(0);
    });

    it('keeps an appending PRD-audit remediation on the growth path and halts only when that growth is truly exhausted', async () => {
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const planPath = join(dir, '.docs', 'plans', 'existing-task-bindings.md');
      const authoredPlan = Array.from({ length: 4 }, (_, i) => `### Task ${i + 1}: Authored ${i + 1}`).join('\n');
      await writeFile(planPath, authoredPlan);
      await writeFile(join(dir, '.docs', 'stories', 'existing-task-bindings.md'), '## Story 1: Repair\n\n### Happy Path\n- Given repair work, when it is completed, then it passes.\n');
      await writePrdAuditFixableFixture(dir, undefined);
      await writeKickbackLedger(dir, { version: 1, gates: {}, growth: { authored: 4, added: 0, byGate: {} } });
      const conductor = new Conductor({
        stateFilePath: statePath,
        projectRoot: dir,
        events,
        git: PRESERVABLE_PRD_AUDIT_GIT,
        config: { prd_audit: { max_remediation_laps: 2 } } as never,
        stepRunner: { run: async (step) => {
          if (step === 'remediate') await writeFile(join(dir, '.pipeline', 'remediation.json'), JSON.stringify({ dispositions: [{
            id: 'S1.1', disposition: 'build', category: null, rationale: 'Append the repair.',
            tasks: [{ id: 'rem-fr-1', title: 'Appended repair' }],
          }] }));
          return { success: true };
        } },
      });
      const input = { feature_desc: 'existing-task-bindings', session_started_at: Date.now() - 1_000 };
      const source = { source: 'prd_audit' as const, evidence: [{ gate: 'prd_audit' as const, evidenceFile: '.pipeline/prd-audit.md' }] };

      await expect((conductor as any).planRemediation(input, ALL_STEPS, 'append once', source))
        .resolves.toMatchObject({ kind: 'route', target: 'build' });
      expect(await readFile(planPath, 'utf8')).toContain('### Task rem-prd-audit-rem-fr-1: Appended repair');
      expect((await readKickbackLedger(dir)).growth).toEqual({ authored: 4, added: 0, byGate: {} });
      expect((await readKickbackLedger(dir)).pendingRepair).toMatchObject({
        charges: { prd_audit: { laps: 1, growth: 1 } },
      });
    });

    it('reports only appended PRD-audit tasks as requested when mixed remediation exhausts growth', async () => {
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.docs', 'plans', 'existing-task-bindings.md'),
        Array.from({ length: 4 }, (_, i) => `### Task ${i + 1}: Authored ${i + 1}`).join('\n'),
      );
      await writeFile(join(dir, '.docs', 'stories', 'existing-task-bindings.md'), [
        '## Story 1: Repair', '', '### Happy Path',
        '- Given the first repair, when it is completed, then it passes.',
        '- Given the second repair, when it is completed, then it passes.',
        '- Given the third repair, when it is completed, then it passes.',
      ].join('\n'));
      await writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
        tasks: [{ id: '2', status: 'completed' }, { id: '3', status: 'completed' }],
      }));
      await writePrdAuditFixableFixture(dir, undefined, [
        { criterionId: 'S1.1', ownerTaskId: '1' },
        { criterionId: 'S1.2', ownerTaskId: '2' },
        { criterionId: 'S1.3', ownerTaskId: '3' },
      ]);
      // Four authored tasks permit one appended remediation task. Start with
      // the allowance available so the bound existing tasks can be observed
      // re-staged before the second, exhausted mixed round checks its wording.
      await writeKickbackLedger(dir, {
        version: 1,
        gates: {},
        growth: { authored: 4, added: 0, byGate: {} },
      });
      let mixedRound = false;
      const conductor = new Conductor({
        stateFilePath: statePath,
        projectRoot: dir,
        events,
        git: PRESERVABLE_PRD_AUDIT_GIT,
        config: { prd_audit: { max_remediation_laps: 2 } } as never,
        stepRunner: { run: async (step) => {
          if (step === 'remediate') await writeFile(join(dir, '.pipeline', 'remediation.json'), JSON.stringify({
            dispositions: [
              ...(mixedRound ? [{ id: 'S1.1', disposition: 'build', category: null, rationale: 'Append.', tasks: [{ id: 'rem-s1-1', title: 'Appended repair' }] }] : []),
              { id: 'S1.2', disposition: 'existing-task', category: null, rationale: 'Already owned.', tasks: [{ id: '2', title: 'Authored 2' }] },
              { id: 'S1.3', disposition: 'existing-task', category: null, rationale: 'Already owned.', tasks: [{ id: '3', title: 'Authored 3' }] },
            ],
          }));
          return { success: true };
        } },
      });

      const input = { feature_desc: 'existing-task-bindings', session_started_at: Date.now() - 1_000 };
      const source = { source: 'prd_audit', evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }] };

      await expect((conductor as any).planRemediation(input, ALL_STEPS, 'restage existing work', source))
        .resolves.toMatchObject({ kind: 'route', target: 'build' });
      expect(JSON.parse(await readFile(join(dir, '.pipeline', 'task-status.json'), 'utf8')).tasks)
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ id: '2', status: 'pending' }),
          expect.objectContaining({ id: '3', status: 'pending' }),
        ]));

      // The first route proves existing-task admission. Clear its unspent
      // boundary receipt while modeling an earlier settled append that spent
      // the sole growth slot.
      const restagedLedger = await readKickbackLedger(dir);
      const { pendingRepair: _pendingRepair, ...settledLedger } = restagedLedger;
      await writeKickbackLedger(dir, {
        ...settledLedger,
        growth: { authored: 4, added: 1, byGate: { prd_audit: 1 } },
      });
      mixedRound = true;
      const outcome = await (conductor as any).planRemediation(input, ALL_STEPS, 'mixed growth exhaustion', source);

      expect(outcome).toMatchObject({ kind: 'route', target: 'build' });
      expect((await readKickbackLedger(dir)).pendingRepair).toMatchObject({
        charges: { prd_audit: { laps: 1, growth: 1 } },
      });
    });

    it('charges a mixed appending and existing-task round to growth and laps independently', async () => {
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const planPath = join(dir, '.docs', 'plans', 'existing-task-bindings.md');
      await writeFile(planPath, Array.from({ length: 8 }, (_, i) => `### Task ${i + 1}: Authored ${i + 1}`).join('\n'));
      await writeFile(join(dir, '.docs', 'stories', 'existing-task-bindings.md'), '## Story 1: Repair\n\n### Happy Path\n- Given repair work, when it is completed, then it passes.\n');
      await writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [{ id: '2', status: 'completed' }] }));
      await writePrdAuditFixableFixture(dir, undefined);
      await writeAsBuiltFixture(dir, undefined, asBuiltRemediableFixture('ARCH-1', '2', 'Existing repair'));
      await writeKickbackLedger(dir, { version: 1, gates: {}, growth: { authored: 8, added: 0, byGate: {} } });
      const conductor = new Conductor({
        stateFilePath: statePath, projectRoot: dir, events,
        git: PRESERVABLE_PRD_AUDIT_GIT,
        config: { architecture_review_as_built: { remediation: { enabled: true } } } as never,
        stepRunner: { run: async (step) => {
          if (step === 'remediate') await writeFile(join(dir, '.pipeline', 'remediation.json'), JSON.stringify({ dispositions: [
            { id: 'S1.1', disposition: 'build', category: null, rationale: 'Append.', tasks: [{ id: 'rem-s1-1', title: 'Appended repair' }] },
            { id: 'ARCH-1', disposition: 'existing-task', category: null, rationale: 'Already owned.', tasks: [{ id: '2', title: 'Authored 2' }] },
          ] }));
          return { success: true };
        } },
      });
      const outcome = await (conductor as any).planRemediation(
        { feature_desc: 'existing-task-bindings', session_started_at: Date.now() - 1_000 }, ALL_STEPS, 'mixed attribution',
        { source: 'validation-group', evidence: [
          { gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' },
          { gate: 'architecture_review_as_built', evidenceFile: '.pipeline/architecture-review-as-built.json' },
        ] },
      );

      expect(outcome).toMatchObject({ kind: 'route', target: 'build' });
      const ledger = await readKickbackLedger(dir);
      expect(ledger.growth).toEqual({ authored: 8, added: 0, byGate: {} });
      expect(ledger.pendingRepair).toMatchObject({
        charges: {
          prd_audit: { laps: 1, growth: 1 },
          architecture_review_as_built: { laps: 1, growth: 0 },
        },
      });
    });

  });

  it('re-dispatches a typed coverage-binding payload failure without halting', async () => {
    const state = Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])) as ConductState;
    state.coverage_binding = 'pending';
    await writeState(statePath, state);

    let coverageDispatches = 0;
    const retryReasons: string[] = [];
    const loopHalts: ConductorEvent[] = [];
    events.on('loop_halt', (event) => { loopHalts.push(event); });
    const runner: StepRunner = {
      run: vi.fn().mockImplementation(async (step, _state, options?: StepRunOptions) => {
        if (step !== 'coverage_binding') return { success: true };
        coverageDispatches++;
        if (coverageDispatches === 1) {
          await mkdir(join(dir, '.pipeline'), { recursive: true });
          await writeFile(
            join(dir, '.pipeline', 'coverage-binding.json'),
            JSON.stringify({ version: 1, slug: 'test-feature', runId: 'test-run', status: 'failed', entries: [] }),
          );
          const infrastructureFailure = new CoverageBindingPayloadError('out-of-vocabulary verdict');
          return {
            success: false,
            // Deliberately unrelated to prove the retry consumes the typed
            // classifier rather than routing on arbitrary provider text.
            output: 'provider output that must not select the retry route',
            infrastructureFailure,
          };
        }
        retryReasons.push(options?.retryReason ?? '');
        return { success: true };
      }),
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'coverage_binding',
      verifyArtifacts: false,
      config: { steps: { coverage_binding: { max_retries: 2 } } },
    });

    await conductor.run();

    expect(coverageDispatches).toBe(2);
    expect(retryReasons).toEqual([
      expect.stringContaining('coverage-binding judge infrastructure failure: out-of-vocabulary verdict'),
    ]);
    await expect(readFile(join(dir, '.pipeline', 'HALT'), 'utf8')).rejects.toThrow();
    expect(loopHalts).toEqual([]);
    expect(JSON.parse(await readFile(join(dir, '.pipeline', 'coverage-binding.json'), 'utf8'))).toMatchObject({
      status: 'failed', entries: [],
    });
  });

  it('credits lap counts once immediately before reopening an invalidated build_review after rebase', async () => {
    const state: ConductState = { build_review: 'done' };
    await writeState(statePath, state);
    const rebaseKickback: GateVerdict['kickback'] = {
      from: 'rebase',
      evidence: 'rebase changed a reviewed path',
    };
    await writeVerdict(dir, 'build_review', {
      satisfied: false,
      checkedAt: 1,
      kickback: rebaseKickback,
    });
    await writeKickbackLedger(dir, {
      version: 1,
      gates: {
        build_review: {
          count: 1,
          cumulative: 4,
          mechanicalFaults: 3,
          treeHash: 'before-rebase',
          lastReason: 'prior mechanical lap',
          priorVerdict: true,
          resolvedBefore: 0,
        },
      },
    });

    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
      verifyArtifacts: true,
    });
    (conductor as unknown as { lastRebaseOutcome: { kind: 'changed' } }).lastRebaseOutcome = {
      kind: 'changed',
    };
    const advanceTail = (conductor as unknown as {
      advanceTail: (
        step: (typeof ALL_STEPS)[number],
        state: ConductState,
        stuckGate: Map<StepName, number>,
        steps: typeof ALL_STEPS,
        indexOf: (name: StepName) => number,
      ) => Promise<number | null | 'halt'>;
    }).advanceTail.bind(conductor);

    await advanceTail(
      ALL_STEPS.find((step) => step.name === 'rebase')!,
      state,
      new Map(),
      ALL_STEPS,
      (name) => ALL_STEPS.findIndex((step) => step.name === name),
    );

    expect(creditKickbackGateLaps).toHaveBeenCalledTimes(1);
    expect(creditKickbackGateLaps).toHaveBeenCalledWith(expect.objectContaining({
      cumulative: 4,
      mechanicalFaults: 3,
    }));
    expect((await readKickbackLedger(dir)).gates.build_review).toEqual(expect.objectContaining({
      cumulative: 0,
      mechanicalFaults: 0,
    }));
    expect(state.build_review).toBe('pending');
  });

  it('does not credit build_review lap counts when a changed rebase reopens another gate', async () => {
    const state: ConductState = { manual_test: 'done' };
    await writeState(statePath, state);
    await writeVerdict(dir, 'manual_test', {
      satisfied: false,
      checkedAt: 1,
      kickback: { from: 'rebase', evidence: 'rebase changed test evidence' },
    });
    await writeKickbackLedger(dir, {
      version: 1,
      gates: {
        build_review: {
          count: 1,
          cumulative: 4,
          mechanicalFaults: 3,
          treeHash: 'before-rebase',
          lastReason: 'prior mechanical lap',
          priorVerdict: true,
          resolvedBefore: 0,
        },
      },
    });

    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
      verifyArtifacts: true,
    });
    (conductor as unknown as { lastRebaseOutcome: { kind: 'changed' } }).lastRebaseOutcome = {
      kind: 'changed',
    };
    const advanceTail = (conductor as unknown as {
      advanceTail: (
        step: (typeof ALL_STEPS)[number],
        state: ConductState,
        stuckGate: Map<StepName, number>,
        steps: typeof ALL_STEPS,
        indexOf: (name: StepName) => number,
      ) => Promise<number | null | 'halt'>;
    }).advanceTail.bind(conductor);

    await advanceTail(
      ALL_STEPS.find((step) => step.name === 'rebase')!,
      state,
      new Map(),
      ALL_STEPS,
      (name) => ALL_STEPS.findIndex((step) => step.name === name),
    );

    expect(creditKickbackGateLaps).not.toHaveBeenCalled();
    expect(state.manual_test).toBe('pending');
  });

  // Covers: task:2
  it('does not reopen a decide-change kickback while advancing the rebase step', async () => {
    const state: ConductState = { coverage_binding: 'done' };
    await writeState(statePath, state);
    await writeVerdict(dir, 'coverage_binding', {
      satisfied: false,
      checkedAt: 1,
      kickback: { from: 'decide-change', evidence: 'accepted plan amendment changed coverage' },
    });

    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
      verifyArtifacts: true,
    });
    (conductor as unknown as { lastRebaseOutcome: { kind: 'changed' } }).lastRebaseOutcome = {
      kind: 'changed',
    };
    const advanceTail = (conductor as unknown as {
      advanceTail: (
        step: (typeof ALL_STEPS)[number],
        state: ConductState,
        stuckGate: Map<StepName, number>,
        steps: typeof ALL_STEPS,
        indexOf: (name: StepName) => number,
      ) => Promise<number | null | 'halt'>;
    }).advanceTail.bind(conductor);

    await advanceTail(
      ALL_STEPS.find((step) => step.name === 'rebase')!,
      state,
      new Map(),
      ALL_STEPS,
      (name) => ALL_STEPS.findIndex((step) => step.name === name),
    );

    expect(state.coverage_binding).toBe('done');
  });

  // Covers: task:5
  it('dispatches BUILD without voiding coverage binding for a seal-reported plan self-amendment', async () => {
    const actualExeca = (await vi.importActual<typeof import('execa')>('execa')).execa;
    vi.mocked(execa).mockImplementation(actualExeca as unknown as typeof execa);
    try {
      const planPath = join(dir, '.docs', 'plans', 'feature.md');
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await writeFile(planPath, 'approved plan\n');
      await execa('git', ['init', '-b', 'main'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Test User'], { cwd: dir });
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'test: seal approved plan'], { cwd: dir });
      await createProtectedArtifactSeal({
        projectRoot: dir,
        baselineCommit: (await execa('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout,
      });
      await writeFile(planPath, 'self-amended plan\n');
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline', 'coverage-binding.json'), JSON.stringify({
        version: 1, slug: 'feature', runId: 'coverage-run', status: 'done', entries: [],
      }));
      const state: ConductState = { feature_desc: 'feature', complexity_tier: 'M' };
      for (const step of ALL_STEPS) {
        if (step.name === 'build') break;
        state[step.name] = 'done';
      }
      state.coverage_binding = 'done';
      await writeState(statePath, state);
      const dispatched: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step, _state) => {
          dispatched.push(step);
          return { success: false, output: 'expected test boundary' };
        }),
      };

      await new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'build',
        mode: 'auto',
        verifyArtifacts: false,
        maxRetries: 1,
      }).run();

      expect(dispatched).toContain('build');
      expect(JSON.parse(await readFile(join(dir, '.pipeline', 'coverage-binding.json'), 'utf8'))).toMatchObject({ status: 'done' });
    } finally {
      vi.mocked(execa).mockImplementation(() =>
        Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }) as unknown as ReturnType<typeof execa>,
      );
    }
  });

  // Covers: task:6
  describe('coverage binding re-entry after a DECIDE void', () => {
    const changedDecidePath = '.docs/decisions/adr-governing.md';

    async function voidCompletedCoverageBinding(lastStep: StepName, buildStatus: StepStatus = 'done'): Promise<ConductState> {
      const state = Object.fromEntries(
        ALL_STEPS
          .slice(0, ALL_STEPS.findIndex((step) => step.name === lastStep) + 1)
          .map((step) => [step.name, 'done']),
      ) as ConductState;
      state.last_step = lastStep;
      state.build = buildStatus;
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeState(statePath, state);
      await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({
        tasks: [{ id: '6', status: 'completed' }],
      }) + '\n');
      await writeFile(join(dir, '.pipeline/coverage-binding.json'), JSON.stringify({
        version: 1,
        slug: 'test-feature',
        runId: 'before-decide-change',
        status: 'done',
        entries: [],
      }) + '\n');
      await writeVerdict(dir, 'coverage_binding', {
        satisfied: true,
        checkedAt: 1,
        reason: 'coverage binding complete',
      });

      await voidCoverageBindingForDecideChange({
        projectRoot: dir,
        decideSet: { paths: new Set([changedDecidePath]) },
        rebaselines: [{
          path: changedDecidePath,
          priorFingerprint: 'sha256:before',
          newFingerprint: 'sha256:after',
        }],
        events,
        stateFilePath: statePath,
      });
      const voided = await readState(statePath);
      if (!voided.ok) throw new Error(voided.error.message);
      return voided.value;
    }

    function runnerThatStopsAtBuild(dispatched: StepName[]): StepRunner {
      return {
        run: async (step) => {
          dispatched.push(step);
          return step === 'build'
            ? { success: false, output: 'expected test boundary' }
            : { success: true };
        },
      };
    }

    it('re-runs coverage_binding before BUILD after an operator rewind to build', async () => {
      const voided = await voidCompletedCoverageBinding('build_review');
      const rewindStore = createFilesystemConductStateStore(statePath);
      await rewindState({
        state: voided,
        config: {},
        target: 'build',
        store: rewindStore,
        readCurrentState: async () => {
          const current = await readState(statePath);
          return current.ok ? current.value : {};
        },
      });

      const dispatched: StepName[] = [];
      await new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runnerThatStopsAtBuild(dispatched),
        events,
        resume: true,
        verifyArtifacts: false,
        onRecovery: async () => 'quit',
      }).run();

      expect(dispatched[0]).toBe('coverage_binding');
      expect(dispatched.findIndex((step) => step === 'build')).toBe(1);
    });

    it('re-runs coverage_binding before BUILD when a daemon resumes after the void', async () => {
      await voidCompletedCoverageBinding('acceptance_specs', 'stale');
      const dispatched: StepName[] = [];
      await new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runnerThatStopsAtBuild(dispatched),
        events,
        resume: true,
        daemon: true,
        verifyArtifacts: false,
        onRecovery: async () => 'quit',
      }).run();

      expect(dispatched[0]).toBe('coverage_binding');
      expect(dispatched.findIndex((step) => step === 'build')).toBe(1);
    });
  });

  it('halts build_review for a human when consuming the sixth cumulative kickback', async () => {
    const state: Record<string, unknown> = {};
    for (const step of ALL_STEPS) {
      if (step.name === 'build_review') break;
      state[step.name] = 'done';
    }
    state.complexity_tier = 'M';
    state.feature_desc = 'cumulative-build-review-cap';
    state.run_started_at = Date.now();
    await writeState(statePath, state as ConductState);
    await writeKickbackLedger(dir, {
      version: 1,
      gates: {
        build_review: {
          count: 1,
          cumulative: 5,
          treeHash: 'previous-tree',
          lastReason: 'previous failure',
          priorVerdict: true,
          resolvedBefore: 0,
        },
      },
    });

    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        calls.push(step);
        if (step === 'build_review') {
          await mkdir(join(dir, '.pipeline'), { recursive: true });
          await writeFile(
            join(dir, '.pipeline/build-review.json'),
            JSON.stringify(failingBuildReviewAggregate('fixture failure')),
          );
        }
        return { success: true };
      }),
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      fromStep: 'build_review',
      maxRetries: 1,
      config: { build_review: { enabled: true } },
    });

    const haltReasons: string[] = [];
    events.on('loop_halt', (event) => {
      if (event.type === 'loop_halt') haltReasons.push(event.reason);
    });

    await conductor.run();

    expect(calls).toEqual(['build_review']);
    expect(await readFile(join(dir, '.pipeline/HALT.class'), 'utf-8')).toBe('needs-human');
    expect(haltReasons).toEqual([
      'build_review cumulative kickback cap exceeded:\n' +
        'Kickback budget (build_review): 6/5 consumed; 0 remaining\n' +
        'Latest reason: [testQuality] test-insensitive\n[security] skipped: disabled\n[testQuality] test-insensitive\n[security] skipped: disabled\n' +
        'Adjustment history: unavailable\n' +
        'Resume authorization: none\n' +
        'Mechanical faults: 0',
    ]);
  });

  it('emits one cumulative-cap halt when build_review exhausts both kickback bounds', async () => {
    const state: Record<string, unknown> = {};
    for (const step of ALL_STEPS) {
      if (step.name === 'build_review') break;
      state[step.name] = 'done';
    }
    state.complexity_tier = 'M';
    state.feature_desc = 'both-build-review-kickback-bounds';
    state.run_started_at = Date.now();
    await writeState(statePath, state as ConductState);
    await writeKickbackLedger(dir, {
      version: 1,
      gates: {
        build_review: {
          count: 2,
          cumulative: 5,
          treeHash: null,
          lastReason: 'previous failure',
          priorVerdict: true,
          resolvedBefore: 0,
        },
      },
    });

    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        if (step === 'build_review') {
          await mkdir(join(dir, '.pipeline'), { recursive: true });
          await writeFile(
            join(dir, '.pipeline/build-review.json'),
            JSON.stringify(failingBuildReviewAggregate('unchanged tree')),
          );
        }
        return { success: true };
      }),
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      fromStep: 'build_review',
      maxRetries: 1,
      config: { build_review: { enabled: true } },
    });
    const haltReasons: string[] = [];
    events.on('loop_halt', (event) => {
      if (event.type === 'loop_halt') haltReasons.push(event.reason);
    });

    await conductor.run();

    expect(haltReasons).toEqual([
      'build_review cumulative kickback cap exceeded:\n' +
        'Kickback budget (build_review): 6/5 consumed; 0 remaining\n' +
        'Latest reason: [testQuality] test-insensitive\n[security] skipped: disabled\n[testQuality] test-insensitive\n[security] skipped: disabled\n' +
        'Adjustment history: unavailable\n' +
        'Resume authorization: none\n' +
        'Mechanical faults: 0',
    ]);
    expect(await readFile(join(dir, '.pipeline/HALT'), 'utf-8')).toContain('cumulative kickback cap');
  });

  it('preserves the ordinary per-tree kickback halt reason byte-for-byte for test_suite', async () => {
    const state: Record<string, unknown> = {};
    for (const step of ALL_STEPS) {
      if (step.name === 'test_suite') break;
      state[step.name] = 'done';
    }
    state.complexity_tier = 'M';
    state.feature_desc = 'ordinary-test-suite-kickback-cap';
    state.run_started_at = Date.now();
    await writeState(statePath, state as ConductState);
    await writeKickbackLedger(dir, {
      version: 1,
      gates: {
        test_suite: {
          count: 2,
          cumulative: 2,
          treeHash: null,
          lastReason: 'previous suite failure',
          priorVerdict: true,
          resolvedBefore: 0,
        },
      },
    });

    const suiteFailure = {
      status: 'FAILED' as const,
      reason: 'nonzero_exit' as const,
      message: 'fixture suite failure',
    };
    const haltReasons: string[] = [];
    events.on('loop_halt', (event) => {
      if (event.type === 'loop_halt') haltReasons.push(event.reason);
    });
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
      mode: 'auto',
      fromStep: 'test_suite',
      maxRetries: 1,
      fullSuiteVerifier: {
        inspect: async () => suiteFailure,
        ensure: async () => suiteFailure,
      },
    });

    await conductor.run();

    const expected =
      'test_suite failure unresolved after 2 build kickback(s) (cap 2): ' +
      'full-suite verification failed (nonzero_exit): fixture suite failure\n' +
      'Evidence: .pipeline/test-suite-evidence.json';
    expect(haltReasons).toEqual([expected]);
    expect(await readFile(join(dir, '.pipeline/HALT'), 'utf-8')).toBe(`${expected}\n`);
    expect(await readFile(join(dir, '.pipeline/HALT.class'), 'utf-8')).toBe('needs-human');
  });

  describe('test_suite kickback boundary', () => {
    const preservedEvidence = {
      version: 4 as const,
      outcome: 'PASS' as const,
      reason: 'exit_zero' as const,
      fingerprint: 'sha256:preserved-within-budget',
      categoryFingerprints: {
        additional_inputs: 'sha256:additional-inputs',
        dependencies: 'sha256:dependencies',
        environment: 'sha256:environment',
        migrations: 'sha256:migrations',
        project_config: 'sha256:project-config',
        source: 'sha256:source',
        test_infrastructure: 'sha256:test-infrastructure',
        tests: 'sha256:tests',
      },
      provenanceHeadSha: '0123456789abcdef0123456789abcdef01234567',
      command: 'npm test',
      workingDirectory: 'src/conductor',
      startedAt: '2026-08-29T00:00:00.000Z',
      endedAt: '2026-08-29T00:00:01.000Z',
      durationMs: 1_000,
      exitCode: 0 as const,
      stdout: 'all tests passed\n',
      stderr: '',
    };

    async function writeTestSuiteOnlyState(): Promise<void> {
      const state = Object.fromEntries(
        ALL_STEPS.map((step) => [step.name, step.name === 'test_suite' ? 'stale' : 'done']),
      ) as ConductState;
      state.complexity_tier = 'M';
      state.feature_desc = 'test-suite-kickback-boundary';
      // This evaluation resumes the feature that owns the pre-existing ledger.
      // A fresh feature session correctly clears every prior feature's budget.
      state.run_started_at = Date.now();
      await writeState(statePath, state);
    }

    const ledgerBytes = JSON.stringify({
      version: 1,
      gates: {
        test_suite: {
          count: 1,
          cumulative: 1,
          mechanicalFaults: 0,
          treeHash: '0123456789abcdef0123456789abcdef01234567',
          lastReason: 'previous suite failure',
          priorVerdict: true,
          resolvedBefore: 4,
        },
      },
    }, null, 2) + '\n';

    it('preserves the test_suite ledger bytes and emits no kickback for a within-budget reuse', async () => {
      // Covers: task:12
      await writeTestSuiteOnlyState();
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const ledgerPath = join(dir, '.pipeline/kickback-ledger.json');
      await writeFile(ledgerPath, ledgerBytes);
      const before = await readFile(ledgerPath, 'utf8');
      const beforeHash = createHash('sha256').update(before).digest('hex');
      const kickbacks: ConductorEvent[] = [];
      events.on('kickback', (event) => { kickbacks.push(event); });
      const verifier = {
        inspect: vi.fn().mockResolvedValue({
          status: 'PRESERVED_WITHIN_BUDGET' as const,
          evidence: preservedEvidence,
        }),
        ensure: vi.fn().mockResolvedValue({ status: 'REUSED' as const, evidence: preservedEvidence }),
        recordPreservation: vi.fn().mockResolvedValue(undefined),
      };
      const runner = createMockStepRunner();
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        mode: 'auto',
        fromStep: 'test_suite',
        fullSuiteVerifier: verifier,
      });

      await conductor.run();

      const after = await readFile(ledgerPath, 'utf8');
      expect(createHash('sha256').update(after).digest('hex')).toBe(beforeHash);
      expect(after).toBe(before);
      expect(kickbacks).toEqual([]);
      expect(runner.run).not.toHaveBeenCalled();
      expect(verifier.inspect).toHaveBeenCalledTimes(1);
      expect(verifier.ensure).toHaveBeenCalledTimes(1);
      expect(verifier.recordPreservation).toHaveBeenCalledTimes(1);
      const finalState = await readState(statePath);
      expect(finalState.ok).toBe(true);
      if (!finalState.ok) throw new Error(finalState.error.message);
      expect(finalState.value.test_suite).toBe('done');
    });

    it('consumes exactly one test_suite kickback for a genuine rerun nonzero exit', async () => {
      // Covers: task:3
      await writeTestSuiteOnlyState();
      const kickbacks: ConductorEvent[] = [];
      events.on('kickback', (event) => { kickbacks.push(event); });
      const suiteFailure = {
        status: 'FAILED' as const,
        reason: 'nonzero_exit' as const,
        message: 'fixture suite failure',
      };
      const runner: StepRunner = {
        run: vi.fn().mockResolvedValue({ success: false, output: 'stop after the expected kickback' }),
      };
      const verifier = {
        inspect: vi.fn().mockResolvedValue(suiteFailure),
        ensure: vi.fn().mockResolvedValue(suiteFailure),
      };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        mode: 'auto',
        fromStep: 'test_suite',
        maxRetries: 1,
        fullSuiteVerifier: verifier,
      });

      await conductor.run();

      expect((await readKickbackLedger(dir)).gates.test_suite).toEqual(expect.objectContaining({
        count: 1,
        cumulative: 1,
      }));
      expect((await readKickbackLedger(dir)).gates.test_suite).not.toHaveProperty(
        'suiteInfrastructureRetries',
      );
      expect(kickbacks).toEqual([expect.objectContaining({
        type: 'kickback',
        from: 'test_suite',
        to: 'build',
        count: 1,
      })]);
      expect(verifier.inspect).toHaveBeenCalledTimes(1);
      expect(verifier.ensure).toHaveBeenCalledTimes(1);
      expect(runner.run).toHaveBeenCalledWith('build', expect.anything(), expect.anything());
    });

    it('retries a timeout within test_suite without consuming a code-repair kickback', async () => {
      // Covers: task:3
      await writeTestSuiteOnlyState();
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/kickback-ledger.json'), ledgerBytes);
      const timeoutFailure = {
        status: 'FAILED' as const,
        reason: 'timeout' as const,
        message: 'fixture suite timeout',
      };
      const retryEvents: ConductorEvent[] = [];
      events.on('step_retry', (event) => {
        if (event.type === 'step_retry' && event.step === 'test_suite') retryEvents.push(event);
      });
      const verifier = {
        inspect: vi.fn()
          .mockResolvedValueOnce(timeoutFailure)
          .mockResolvedValueOnce({ status: 'CURRENT' as const, evidence: preservedEvidence }),
        ensure: vi.fn()
          .mockResolvedValueOnce(timeoutFailure)
          .mockResolvedValueOnce({ status: 'REUSED' as const, evidence: preservedEvidence }),
      };
      const runner = createMockStepRunner();
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        mode: 'auto',
        daemon: true,
        fromStep: 'test_suite',
        fullSuiteVerifier: verifier,
      });

      await conductor.run();

      const finalState = await readState(statePath);
      expect(finalState.ok).toBe(true);
      if (!finalState.ok) throw new Error(finalState.error.message);
      expect(finalState.value.test_suite).toBe('done');
      expect(retryEvents).toEqual([expect.objectContaining({
        type: 'step_retry',
        step: 'test_suite',
        attempt: 1,
        reason: expect.stringContaining('infrastructure'),
      })]);
      expect(retryEvents[0]).not.toHaveProperty('progressAttempt');
      expect(retryEvents[0]).not.toHaveProperty('progressAttemptCeiling');
      expect((await readKickbackLedger(dir)).gates.test_suite).toEqual(expect.objectContaining({
        count: 1,
        cumulative: 1,
      }));
      expect(verifier.inspect).toHaveBeenCalledTimes(2);
      expect(verifier.ensure).toHaveBeenCalledTimes(2);
      expect(runner.run).not.toHaveBeenCalled();
    });

    it('halts needs-human when test_suite infrastructure retries are exhausted', async () => {
      // Covers: task:4
      await writeTestSuiteOnlyState();
      const suiteFailure = {
        status: 'FAILED' as const,
        reason: 'spawn_failed' as const,
        message: 'fixture suite process could not start',
      };
      const verifier = {
        inspect: vi.fn().mockResolvedValue(suiteFailure),
        ensure: vi.fn().mockResolvedValue(suiteFailure),
      };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: createMockStepRunner(),
        events,
        mode: 'auto',
        daemon: true,
        fromStep: 'test_suite',
        fullSuiteVerifier: verifier,
      });

      await conductor.run();

      await expect(readFile(join(dir, '.pipeline/HALT.class'), 'utf8')).resolves.toBe('needs-human');
      await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(
        `test_suite infrastructure failure (spawn_failed): ${suiteFailure.message}`,
      );
      await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(
        `retries spent: ${MAX_SUITE_INFRASTRUCTURE_RETRIES}`,
      );
      await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(
        'Evidence: .pipeline/test-suite-evidence.json',
      );
      expect(verifier.inspect).toHaveBeenCalledTimes(MAX_SUITE_INFRASTRUCTURE_RETRIES + 1);
      expect(verifier.ensure).toHaveBeenCalledTimes(MAX_SUITE_INFRASTRUCTURE_RETRIES + 1);
    });

    it('halts needs-human without a test_suite re-run when its durable retry counter is unreadable', async () => {
      // Covers: task:4
      await writeTestSuiteOnlyState();
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/kickback-ledger.json'), JSON.stringify({
        version: 1,
        gates: { test_suite: { suiteInfrastructureRetries: 1.5 } },
      }));
      const suiteFailure = {
        status: 'FAILED' as const,
        reason: 'spawn_failed' as const,
        message: 'fixture suite process could not start',
      };
      const verifier = {
        inspect: vi.fn().mockResolvedValue(suiteFailure),
        ensure: vi.fn().mockResolvedValue(suiteFailure),
      };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: createMockStepRunner(),
        events,
        mode: 'auto',
        daemon: true,
        fromStep: 'test_suite',
        maxRetries: 1,
        fullSuiteVerifier: verifier,
      });

      await conductor.run();

      await expect(readFile(join(dir, '.pipeline/HALT.class'), 'utf8')).resolves.toBe('needs-human');
      await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(
        'test_suite infrastructure retry counter is unreadable',
      );
      expect(verifier.inspect).toHaveBeenCalledTimes(1);
      expect(verifier.ensure).toHaveBeenCalledTimes(1);
    });

    it('continues a persisted test_suite infrastructure retry counter before halting at its allowance', async () => {
      // Covers: task:4
      await writeTestSuiteOnlyState();
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/kickback-ledger.json'), ledgerBytes.replace(
        '"resolvedBefore": 4',
        '"resolvedBefore": 4,\n          "suiteInfrastructureRetries": 1',
      ));
      const suiteFailure = {
        status: 'FAILED' as const,
        reason: 'spawn_failed' as const,
        message: 'fixture suite process could not start',
      };
      const verifier = {
        inspect: vi.fn().mockResolvedValue(suiteFailure),
        ensure: vi.fn().mockResolvedValue(suiteFailure),
      };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: createMockStepRunner(),
        events,
        mode: 'auto',
        daemon: true,
        fromStep: 'test_suite',
        fullSuiteVerifier: verifier,
      });

      await conductor.run();

      expect((await readKickbackLedger(dir)).gates.test_suite.suiteInfrastructureRetries)
        .toBe(MAX_SUITE_INFRASTRUCTURE_RETRIES);
      expect(verifier.inspect).toHaveBeenCalledTimes(2);
      expect(verifier.ensure).toHaveBeenCalledTimes(2);
      await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(
        `retries spent: ${MAX_SUITE_INFRASTRUCTURE_RETRIES}`,
      );
    });

    it.each(['timeout', 'unlaunchable'] as const)(
      'halts %s test_suite infrastructure failures without consuming a kickback',
      async (reason) => {
        // Covers: task:3, task:12
        await writeTestSuiteOnlyState();
        await mkdir(join(dir, '.pipeline'), { recursive: true });
        const ledgerPath = join(dir, '.pipeline/kickback-ledger.json');
        await writeFile(ledgerPath, ledgerBytes);
        const kickbacks: ConductorEvent[] = [];
        events.on('kickback', (event) => { kickbacks.push(event); });
        const suiteFailure = {
          status: 'FAILED' as const,
          reason,
          message: `fixture ${reason} failure`,
        };
        const runner = createMockStepRunner();
        const verifier = {
          inspect: vi.fn().mockResolvedValue(suiteFailure),
          ensure: vi.fn().mockResolvedValue(suiteFailure),
        };
        const conductor = new Conductor({
          projectRoot: dir,
          stateFilePath: statePath,
          stepRunner: runner,
          events,
          mode: 'auto',
          fromStep: 'test_suite',
          maxRetries: 1,
          fullSuiteVerifier: verifier,
        });

        await conductor.run();

        expect((await readKickbackLedger(dir)).gates.test_suite).toEqual(expect.objectContaining({
          count: 1,
          cumulative: 1,
        }));
        expect(kickbacks).toEqual([]);
        expect(verifier.inspect).toHaveBeenCalledTimes(3);
        expect(verifier.ensure).toHaveBeenCalledTimes(3);
        expect(runner.run).not.toHaveBeenCalled();
        await expect(readFile(join(dir, '.pipeline/HALT.class'), 'utf8')).resolves.toBe('needs-human');
        await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(
          `test_suite infrastructure failure (${reason})`,
        );
      },
    );
  });

  it('keeps the interactive CLI constructor free of daemon operator-park options', async () => {
    const source = await readFile(new URL('../../src/index.ts', import.meta.url), 'utf8');
    const constructor = source.match(
      /const conductor = new Conductor\(\{[\s\S]*?\n  \}\);/,
    )?.[0];

    expect(constructor).toBeDefined();
    expect(constructor).not.toMatch(/operatorParkBoundary|featureSlug/);
  });

  it('persists a loop halt stamped with the last advanced manual_test step', async () => {
    const persister = new EventPersister(join(dir, '.pipeline/events.jsonl'), events);
    persister.start();
    const runner: StepRunner = {
      run: vi.fn(async (step) =>
        step === 'manual_test' ? { success: false, output: 'manual test failed' } : { success: true },
      ),
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'manual_test',
      mode: 'auto',
      daemon: true,
      maxRetries: 1,
      verifyArtifacts: false,
    });

    await conductor.run();
    persister.stop();

    const records = (await readFile(join(dir, '.pipeline/events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(records.find((record) => record.type === 'loop_halt')).toMatchObject({
      step: 'manual_test',
    });
  });

  it('closes an open execution before writing the halt marker', async () => {
    const state: ConductState = { complexity_tier: 'M' };
    for (const step of ALL_STEPS) {
      if (step.name === 'build') break;
      state[step.name] = 'done';
    }
    await writeState(statePath, state);

    const persister = new EventPersister(join(dir, '.pipeline/events.jsonl'), events);
    persister.start();
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: {
        run: async () => ({
          success: false,
          output: 'the build command is unavailable',
          commandUnresolved: true,
        }),
      },
      events,
      fromStep: 'build',
      mode: 'auto',
      daemon: true,
      maxRetries: 1,
      verifyArtifacts: false,
    });

    try {
      await conductor.run();

      const records = (await readFile(join(dir, '.pipeline/events.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const starts = records.filter((record) => record.type === 'step_started');
      const terminals = records.filter(
        (record) => record.type === 'step_completed' || record.type === 'step_failed' || record.type === 'step_interrupted',
      );
      const terminalIndex = records.findIndex((record) => record.type === 'step_interrupted');
      const haltIndex = records.findIndex((record) => record.type === 'loop_halt');

      expect({ starts: starts.length, terminals: terminals.length, terminalBeforeHalt: terminalIndex < haltIndex }).toEqual({
        starts: 1,
        terminals: 1,
        terminalBeforeHalt: true,
      });
    } finally {
      persister.stop();
    }
  });

  it('keeps a retryable halt marker from closing an execution before its real terminal', async () => {
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
    });
    const persister = new EventPersister(join(dir, '.pipeline/events.jsonl'), events, {
      nowMs: (() => {
        const timestamps = [1_000, 1_025];
        return () => timestamps.shift()!;
      })(),
    });
    persister.start();

    try {
      const executionEvents = conductor as unknown as {
        emitExecutionEvent(event: ConductorEvent): Promise<void>;
        writeHaltMarker(body: string, haltClass: 'protected-artifact'): Promise<void>;
      };
      await executionEvents.emitExecutionEvent({ type: 'step_started', step: 'build', index: 0 });
      await executionEvents.writeHaltMarker('protected artifact changed\n', 'protected-artifact');
      await executionEvents.emitExecutionEvent({
        type: 'step_failed',
        step: 'build',
        error: 'protected artifact changed',
        retryCount: 2,
      });

      const records = (await readFile(join(dir, '.pipeline/events.jsonl'), 'utf-8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const starts = records.filter((record) => record.type === 'step_started');
      const terminals = records.filter(
        (record) => record.type === 'step_completed' || record.type === 'step_failed',
      );

      expect({
        starts: starts.length,
        terminals: terminals.length,
        interval: terminals[0]?.activeInterval,
        timing: await computeTimingRollup(dir),
      }).toEqual({
        starts: 1,
        terminals: 1,
        interval: { startedAtMs: 1_000, durationMs: 25 },
        timing: {
          state: 'measured',
          activeMs: 25,
          providerActiveMs: 0,
          noProviderActiveMs: 25,
        },
      });
    } finally {
      persister.stop();
    }
  });

  it('stamps valid state and breadcrumb steps while omitting the invalid silent-exit fallback', async () => {
    const halts: Array<Extract<ConductorEvent, { type: 'loop_halt' }>> = [];
    events.on('loop_halt', (event) => {
      if (event.type === 'loop_halt') halts.push(event);
    });
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
      daemon: true,
    });

    const emitLoopHalt = (conductor as unknown as {
      emitLoopHalt(reason: string): Promise<void>;
    }).emitLoopHalt.bind(conductor);

    // `state.last_step` wins when a central halt occurs outside the loop.
    (conductor as unknown as { haltState: ConductState }).haltState = { last_step: 'build' };
    await emitLoopHalt('halt with persisted state');

    // A loop breadcrumb supplies the step when state has not been persisted yet.
    (conductor as unknown as { haltState: ConductState }).haltState = {};
    (conductor as unknown as { _breadcrumb: { lastAdvancedStep?: string } })._breadcrumb = {
      lastAdvancedStep: 'manual_test',
    };
    await emitLoopHalt('halt with breadcrumb');

    // The diagnostic fallback remains in the reason, but is not a StepName and
    // therefore must not cross the typed event boundary as `step`.
    (conductor as unknown as { _breadcrumb: Record<string, never> })._breadcrumb = {};
    await emitLoopHalt(
      'loop exited without a terminal verdict (last step: no step recorded)',
    );

    expect(halts).toEqual([
      expect.objectContaining({ reason: 'halt with persisted state', step: 'build' }),
      expect.objectContaining({ reason: 'halt with breadcrumb', step: 'manual_test' }),
      expect.objectContaining({
        reason: 'loop exited without a terminal verdict (last step: no step recorded)',
      }),
    ]);
    expect(halts[2]).not.toHaveProperty('step');
  });

  it('attributes a halt raised after a step settled before the next dispatch to that settled step', async () => {
    const halts: Array<Extract<ConductorEvent, { type: 'loop_halt' }>> = [];
    events.on('loop_halt', (event) => {
      if (event.type === 'loop_halt') halts.push(event);
    });
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
      daemon: true,
    });
    (conductor as unknown as { haltState: ConductState }).haltState = { manual_test: 'done' };
    const reason = 'deferred boundary halt after manual_test settled';

    await (conductor as unknown as {
      emitLoopHalt(reason: string): Promise<void>;
    }).emitLoopHalt(reason);

    expect(halts).toEqual([expect.objectContaining({ reason, step: 'manual_test' })]);
  });

  it('uses the active breadcrumb for a central halt and state.last_step when no breadcrumb is active', async () => {
    const halts: Array<Extract<ConductorEvent, { type: 'loop_halt' }>> = [];
    events.on('loop_halt', (event) => {
      if (event.type === 'loop_halt') halts.push(event);
    });
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
      daemon: true,
    });
    (conductor as unknown as { haltState: ConductState }).haltState = { last_step: 'build' };
    (conductor as unknown as { _breadcrumb: { lastAdvancedStep?: string } })._breadcrumb = {
      lastAdvancedStep: 'manual_test',
    };
    const reason = 'central halt after state persisted build';

    await (conductor as unknown as {
      emitLoopHalt(reason: string): Promise<void>;
    }).emitLoopHalt(reason);

    (conductor as unknown as { _breadcrumb: Record<string, never> })._breadcrumb = {};
    const deferredReason = 'central halt outside an active step';
    await (conductor as unknown as {
      emitLoopHalt(reason: string): Promise<void>;
    }).emitLoopHalt(deferredReason);

    expect(halts).toEqual([
      expect.objectContaining({ reason, step: 'manual_test' }),
      expect.objectContaining({ reason: deferredReason, step: 'build' }),
    ]);
  });

  it('constructs the persistent filesystem state store by default', () => {
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
    });

    expect((conductor as unknown as { stateStore?: unknown }).stateStore).toEqual(
      expect.objectContaining({
        read: expect.any(Function),
        apply: expect.any(Function),
        applyBatch: expect.any(Function),
        replace: expect.any(Function),
      }),
    );
  });

  it('routes conductor state mutations through a supplied store', async () => {
    const stateStore: ConductStateStore<ConductState> = {
      apply: vi.fn().mockResolvedValue({ kind: 'applied' }),
      applyBatch: vi.fn().mockResolvedValue({ kind: 'applied' }),
      replace: vi.fn().mockResolvedValue({ kind: 'applied' }),
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
      stateStore,
    });

    const step = ALL_STEPS[0];
    await (conductor as unknown as {
      recordStepSkip(
        state: ConductState,
        step: (typeof ALL_STEPS)[number],
        cause: string,
      ): Promise<void>;
    }).recordStepSkip({}, step, 'composition test');

    expect(stateStore.applyBatch).toHaveBeenCalledWith({
      name: 'save step status',
      mutations: [
        expect.objectContaining({ field: step.name, next: 'skipped' }),
        expect.objectContaining({ field: 'last_step', next: step.name }),
      ],
    });
  });

  it('does not advance an in-memory step when its state mutation is refused', async () => {
    const stateStore: ConductStateStore<ConductState> = {
      apply: vi.fn().mockResolvedValue({ kind: 'applied' }),
      applyBatch: vi.fn().mockResolvedValue({ kind: 'lease', message: 'lease held elsewhere' }),
      replace: vi.fn().mockResolvedValue({ kind: 'applied' }),
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
      stateStore,
    });
    const state: ConductState = {};

    await expect((conductor as unknown as {
      saveConductorStepStatus(state: ConductState, step: StepName, status: StepStatus): Promise<void>;
    }).saveConductorStepStatus(state, 'build', 'in_progress')).rejects.toThrow('lease held elsewhere');

    expect(state).toEqual({});
  });

  it('commits terminal completion through the injected store before reporting success', async () => {
    const stateStore: ConductStateStore<ConductState> = {
      apply: vi.fn().mockResolvedValue({ kind: 'applied' }),
      applyBatch: vi.fn().mockResolvedValue({ kind: 'applied' }),
      replace: vi.fn().mockResolvedValue({ kind: 'applied' }),
    };
    const completed: ConductorEvent[] = [];
    events.on('feature_complete', (event) => {
      completed.push(event);
    });
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
      stateStore,
      daemon: true,
    });
    const state: ConductState = { feature_desc: 'terminal-state-store' };

    await (conductor as unknown as {
      completeRun(state: ConductState, doneMarkerBody: string): Promise<void>;
    }).completeRun(state, 'complete\n');

    expect(state.feature_status).toBe('complete');
    expect(stateStore.applyBatch).toHaveBeenCalledWith({
      name: 'complete verified feature run',
      mutations: [expect.objectContaining({
        field: 'feature_status', expected: undefined, next: 'complete',
      })],
    });
    expect(completed).toHaveLength(1);
  });

  it('does not report terminal success when the completion mutation is refused', async () => {
    const stateStore: ConductStateStore<ConductState> = {
      apply: vi.fn().mockResolvedValue({ kind: 'applied' }),
      applyBatch: vi.fn().mockResolvedValue({ kind: 'conflict', message: 'completion changed elsewhere' }),
      replace: vi.fn().mockResolvedValue({ kind: 'applied' }),
    };
    const completed: ConductorEvent[] = [];
    events.on('feature_complete', (event) => {
      completed.push(event);
    });
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
      stateStore,
      daemon: true,
    });

    await expect((conductor as unknown as {
      completeRun(state: ConductState, doneMarkerBody: string): Promise<void>;
    }).completeRun({}, 'complete\n')).rejects.toThrow('completion changed elsewhere');

    expect(completed).toHaveLength(0);
  });

  it('persists only settled signal completions through the store', async () => {
    const stateStore: ConductStateStore<ConductState> = {
      apply: vi.fn().mockResolvedValue({ kind: 'applied' }),
      applyBatch: vi.fn().mockResolvedValue({ kind: 'applied' }),
      replace: vi.fn().mockResolvedValue({ kind: 'applied' }),
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
      stateStore,
    });
    const state: ConductState = { manual_test: 'in_progress' };

    await (conductor as unknown as {
      commitSignalCompletions(
        state: ConductState,
        signal: NodeJS.Signals,
        completions: Record<string, StepStatus>,
      ): Promise<void>;
    }).commitSignalCompletions(state, 'SIGINT', { manual_test: 'done' });

    expect(state.manual_test).toBe('done');
    expect(stateStore.applyBatch).toHaveBeenCalledWith({
      name: 'record SIGINT partial group completion',
      mutations: [expect.objectContaining({
        field: 'manual_test', expected: 'in_progress', next: 'done',
      })],
    });
  });

  it('logs but does not reject when signal persistence is refused', async () => {
    const stateStore: ConductStateStore<ConductState> = {
      apply: vi.fn().mockResolvedValue({ kind: 'applied' }),
      applyBatch: vi.fn().mockResolvedValue({ kind: 'lease', message: 'lease held elsewhere' }),
      replace: vi.fn().mockResolvedValue({ kind: 'applied' }),
    };
    const log = vi.fn();
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
      stateStore,
      log,
    });

    await expect((conductor as unknown as {
      persistSignalCompletionsBestEffort(
        state: ConductState,
        signal: NodeJS.Signals,
        completions: Record<string, StepStatus>,
      ): Promise<void>;
    }).persistSignalCompletionsBestEffort(
      { manual_test: 'in_progress' },
      'SIGTERM',
      { manual_test: 'done' },
    )).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith(expect.stringContaining('SIGTERM could not persist'));
  });

  it('commits checkpoint back-navigation as one guarded state batch', async () => {
    const stateStore: ConductStateStore<ConductState> = {
      apply: vi.fn().mockResolvedValue({ kind: 'applied' }),
      applyBatch: vi.fn().mockResolvedValue({ kind: 'applied' }),
      replace: vi.fn().mockResolvedValue({ kind: 'applied' }),
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
      stateStore,
    });
    const state: ConductState = {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      stories: 'done',
    };

    await (conductor as unknown as {
      navigateStateBack(
        state: ConductState,
        target: StepName,
        steps: typeof ALL_STEPS,
      ): Promise<number>;
    }).navigateStateBack(state, 'explore', ALL_STEPS);

    expect(state.explore).toBe('pending');
    expect(state.complexity).toBe('stale');
    expect(stateStore.applyBatch).toHaveBeenCalledWith(expect.objectContaining({
      name: 'navigate back to explore',
      mutations: expect.arrayContaining([
        expect.objectContaining({ field: 'explore', expected: 'done', next: 'pending' }),
        expect.objectContaining({ field: 'complexity', expected: 'done', next: 'stale' }),
      ]),
    }));
  });

  it('records session/run timestamps and supplied worktree metadata as one initialization batch', async () => {
    const stateStore: ConductStateStore<ConductState> = {
      apply: vi.fn().mockResolvedValue({ kind: 'applied' }),
      applyBatch: vi.fn().mockResolvedValue({ kind: 'applied' }),
      replace: vi.fn().mockResolvedValue({ kind: 'applied' }),
    };
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_725_000_000_000);
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
      stateStore,
      worktreeBranch: 'feature/state-store',
    });
    const state: ConductState = {};

    try {
      const fresh = await (conductor as unknown as {
        initializeRunState(state: ConductState): Promise<boolean>;
      }).initializeRunState(state);

      expect(fresh).toBe(true);
      expect(state).toMatchObject({
        session_started_at: 1_725_000_000_000,
        run_started_at: 1_725_000_000_000,
        worktree_branch: 'feature/state-store',
      });
      expect(stateStore.applyBatch).toHaveBeenCalledWith({
        name: 'initialize conductor run',
        mutations: expect.arrayContaining([
          expect.objectContaining({ field: 'session_started_at', next: 1_725_000_000_000 }),
          expect.objectContaining({ field: 'run_started_at', next: 1_725_000_000_000 }),
          expect.objectContaining({ field: 'worktree_branch', next: 'feature/state-store' }),
        ]),
      });
    } finally {
      now.mockRestore();
    }
  });

  it('records native complexity and worktree DECIDE transitions through invariant batches', async () => {
    const stateStore: ConductStateStore<ConductState> = {
      apply: vi.fn().mockResolvedValue({ kind: 'applied' }),
      applyBatch: vi.fn().mockResolvedValue({ kind: 'applied' }),
      replace: vi.fn().mockResolvedValue({ kind: 'applied' }),
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
      stateStore,
      mode: 'auto',
    });
    const complexityState: ConductState = {};
    const worktreeState: ConductState = {};

    await (conductor as unknown as {
      runComplexityStep(state: ConductState): Promise<StepRunResult>;
    }).runComplexityStep(complexityState);
    await (conductor as unknown as {
      runWorktreeStep(state: ConductState): Promise<StepRunResult>;
    }).runWorktreeStep(worktreeState);

    expect(complexityState).toMatchObject({
      complexity_tier: 'L', complexity: 'done', last_step: 'complexity',
    });
    expect(worktreeState).toMatchObject({ worktree: 'done', last_step: 'worktree' });
    expect(stateStore.applyBatch).toHaveBeenCalledWith(expect.objectContaining({
      name: 'record complexity decision',
      mutations: expect.arrayContaining([
        expect.objectContaining({ field: 'complexity_tier', next: 'L' }),
        expect.objectContaining({ field: 'complexity', next: 'done' }),
        expect.objectContaining({ field: 'last_step', next: 'complexity' }),
      ]),
    }));
    expect(stateStore.applyBatch).toHaveBeenCalledWith(expect.objectContaining({
      name: 'record worktree step completion',
      mutations: expect.arrayContaining([
        expect.objectContaining({ field: 'worktree', next: 'done' }),
        expect.objectContaining({ field: 'last_step', next: 'worktree' }),
      ]),
    }));
  });

  it('caches a committed DECIDE track marker through the recording store', async () => {
    const stateStore: ConductStateStore<ConductState> = {
      apply: vi.fn().mockResolvedValue({ kind: 'applied' }),
      applyBatch: vi.fn().mockResolvedValue({ kind: 'applied' }),
      replace: vi.fn().mockResolvedValue({ kind: 'applied' }),
    };
    await mkdir(join(dir, '.docs', 'track'), { recursive: true });
    await writeFile(join(dir, '.docs', 'track', 'feature.md'), 'Track: technical\n');
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
      stateStore,
    });
    const state: ConductState = {};

    await expect((conductor as unknown as {
      resolveTrack(state: ConductState): Promise<Track>;
    }).resolveTrack(state)).resolves.toBe('technical');

    expect(state).toMatchObject({ track: 'technical' });
    expect(stateStore.apply).toHaveBeenCalledWith(expect.objectContaining({
      field: 'track', expected: undefined, next: 'technical',
    }));
  });

  it('propagates rejected initialization and DECIDE mutations', async () => {
    const stateStore: ConductStateStore<ConductState> = {
      apply: vi.fn().mockResolvedValue({ kind: 'persistence', message: 'track write failed' }),
      applyBatch: vi.fn().mockResolvedValue({ kind: 'persistence', message: 'state write failed' }),
      replace: vi.fn().mockResolvedValue({ kind: 'applied' }),
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
      stateStore,
      mode: 'auto',
    });

    await expect((conductor as unknown as {
      initializeRunState(state: ConductState): Promise<boolean>;
    }).initializeRunState({})).rejects.toThrow('state write failed');
    await expect((conductor as unknown as {
      runComplexityStep(state: ConductState): Promise<StepRunResult>;
    }).runComplexityStep({})).rejects.toThrow('state write failed');
  });

  it('records a BUILD group join as one expected-value batch', async () => {
    const stateStore: ConductStateStore<ConductState> = {
      apply: vi.fn().mockResolvedValue({ kind: 'applied' }),
      applyBatch: vi.fn().mockResolvedValue({ kind: 'applied' }),
      replace: vi.fn().mockResolvedValue({ kind: 'applied' }),
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
      stateStore,
    });
    const state: ConductState = { build: 'in_progress' };

    await (conductor as unknown as {
      commitStateChanges(
        state: ConductState,
        name: string,
        changes: Record<string, unknown>,
      ): Promise<void>;
    }).commitStateChanges(state, 'join BUILD verification group', {
      build: 'done',
      build__test_suite: 'done',
    });

    expect(stateStore.applyBatch).toHaveBeenCalledWith({
      name: 'join BUILD verification group',
      mutations: expect.arrayContaining([
        expect.objectContaining({ field: 'build', expected: 'in_progress', next: 'done' }),
        expect.objectContaining({ field: 'build__test_suite', expected: undefined, next: 'done' }),
      ]),
    });
    expect(state).toMatchObject({ build: 'done' });
  });

  it('uses explicit expected values for navigation invalidation and rejects a refused batch', async () => {
    const stateStore: ConductStateStore<ConductState> = {
      apply: vi.fn().mockResolvedValue({ kind: 'applied' }),
      applyBatch: vi.fn().mockResolvedValue({ kind: 'conflict', message: 'state changed elsewhere' }),
      replace: vi.fn().mockResolvedValue({ kind: 'applied' }),
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
      stateStore,
    });
    const state: ConductState = { build: 'done', build_review: 'done', manual_test: 'done' };

    await expect((conductor as unknown as {
      navigateStateBack(state: ConductState, target: StepName, steps: typeof ALL_STEPS): Promise<number>;
    }).navigateStateBack(state, 'build', ALL_STEPS)).rejects.toThrow('state changed elsewhere');

    expect(stateStore.applyBatch).toHaveBeenCalledWith(expect.objectContaining({
      name: 'navigate back to build',
      mutations: expect.arrayContaining([
        expect.objectContaining({ field: 'build', expected: 'done', next: 'pending' }),
        expect.objectContaining({ field: 'build_review', expected: 'done', next: 'stale' }),
        expect.objectContaining({ field: 'manual_test', expected: 'done', next: 'stale' }),
      ]),
    }));
    expect(state).toMatchObject({ build: 'done', build_review: 'done', manual_test: 'done' });
  });

  it('preserves Codex authentication failure metadata for the spot-audit dispatcher', async () => {
    const module = await import('../../src/engine/conductor.js') as {
      toSpotAuditVerifierResult?: (result: unknown) => unknown;
    };

    expect(module.toSpotAuditVerifierResult?.({
      success: false,
      output: 'selected authentication source rejected',
      authFailure: true,
      authentication: { provider: 'codex', source: 'cached-login', state: 'unusable' },
    })).toEqual({
      success: false,
      output: 'selected authentication source rejected',
      authFailure: true,
      authentication: { provider: 'codex', source: 'cached-login', state: 'unusable' },
    });
  });

  it('preserves observed intervals through the spot-audit verifier adapter', async () => {
    const observedIntervals = [{ startedAtMs: 600, durationMs: 50 }];
    const module = await import('../../src/engine/conductor.js') as {
      toSpotAuditVerifierResult?: (result: unknown) => {
        observedIntervals?: readonly unknown[];
      };
    };

    const result = module.toSpotAuditVerifierResult?.({
      success: false,
      output: 'verifier unavailable',
      observedIntervals,
    });

    expect(result?.observedIntervals?.[0]).toBe(observedIntervals[0]);
  });

  it('preserves observed intervals through a successful grouped validation branch', async () => {
    const observedIntervals = [{ startedAtMs: 700, durationMs: 55 }];
    const stepRunner: StepRunner = {
      run: vi.fn().mockResolvedValue({ success: true, observedIntervals }),
    };
    const member: GroupMember = {
      name: 'manual_test',
      skill: 'manual-test',
      outcome: { kind: 'skipped' },
    };

    const lifecycleObserver = {
      onAdmitted: vi.fn(),
      onAttempt: vi.fn(),
      onRetry: vi.fn(),
      onSettled: vi.fn(),
    } satisfies GroupBranchLifecycleObserver;
    const executionContext = {
      executionId: 'validation-manual-test-1',
      subject: { kind: 'lifecycle-step' as const, step: 'manual_test' as const },
    };
    const attribution = { member: 'manual_test', skill: 'manual-test', executionContext };

    const outcome = await runGroupBranch(member, {}, {
      stepRunner,
      lifecycleObserver,
      executionContext,
    }, 1);

    expect((outcome as { observedIntervals?: readonly unknown[] }).observedIntervals?.[0])
      .toBe(observedIntervals[0]);
    expect(lifecycleObserver.onAdmitted.mock.calls).toEqual([[attribution]]);
    expect(lifecycleObserver.onAttempt.mock.calls).toEqual([[{
      ...attribution,
      attempt: 1,
      result: { success: true, observedIntervals },
    }]]);
    expect(lifecycleObserver.onRetry).not.toHaveBeenCalled();
    expect(lifecycleObserver.onSettled.mock.calls).toEqual([[{
      ...attribution,
      outcome,
      attempts: [{ ...attribution, attempt: 1, result: { success: true, observedIntervals } }],
      observedIntervals,
    }]]);
  });

  it('preserves all ordered intervals across a grouped retry', async () => {
    const firstIntervals = [{ startedAtMs: 800, durationMs: 15 }];
    const terminalIntervals = [{ startedAtMs: 900, durationMs: 60 }];
    const run = vi.fn()
      .mockResolvedValueOnce({
        success: false,
        output: 'first failure',
        observedIntervals: firstIntervals,
      })
      .mockResolvedValueOnce({
        success: false,
        output: 'terminal failure',
        observedIntervals: terminalIntervals,
      });
    const member: GroupMember = {
      name: 'manual_test',
      skill: 'manual-test',
      outcome: { kind: 'skipped' },
    };

    const outcome = await runGroupBranch(member, {}, {
      stepRunner: { run },
      lifecycleObserver: NOOP_GROUP_BRANCH_LIFECYCLE_OBSERVER,
    }, 2);

    expect({
      kind: outcome.kind,
      calls: run.mock.calls.length,
      intervals: (outcome as { observedIntervals?: readonly unknown[] })
        .observedIntervals,
    }).toEqual({
      kind: 'no-verdict',
      calls: 2,
      intervals: [...firstIntervals, ...terminalIntervals],
    });
  });

  it('does not re-open a mocked-success SHIP round at the finish fence', async () => {
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
      projectRoot: dir,
      mode: 'auto',
      // Deliberately omit verifyArtifacts: focused unit flows use runner
      // success as their authority and have no on-disk SHIP verdicts.
    });
    const state = {
      manual_test: 'done',
      prd_audit: 'done',
      architecture_review_as_built: 'done',
    } as ConductState;

    const nonGreen = await (
      conductor as unknown as {
        nonGreenFinishValidators: (value: ConductState) => Promise<unknown[]>;
      }
    ).nonGreenFinishValidators(state);

    expect(nonGreen).toEqual([]);
  });

  it('parks a cached-login audit verifier failure and redispatches only that verifier when ready', async () => {
    const authentication = { provider: 'codex' as const, source: 'cached-login' as const, state: 'unusable' as const };
    const readiness = vi.fn().mockResolvedValue({ ...authentication, state: 'ready' as const });
    const dispatchVerifier = vi.fn()
      .mockResolvedValueOnce({ success: false, output: 'login expired', authFailure: true, authentication })
      .mockResolvedValueOnce({ success: true, output: 'verdict' });
    const runner: StepRunner = { run: vi.fn(), dispatchVerifier };
    const runtimes = new ProviderRuntimeSet([{
      key: 'codex',
      provider: { invoke: vi.fn(), readiness },
      policy: CODEX_MODEL_POLICY,
      builtIn: true,
      availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
    }]);
    const conductor = new Conductor({
      stateFilePath: statePath, stepRunner: runner, events, projectRoot: dir,
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as HarnessConfig,
      providerExecution: { runtimes, sessions: new ProviderSessionStore(), configuredProviders: ['codex'] },
      sleepFn: vi.fn(async () => {}),
    });

    const result = await (conductor as unknown as { dispatchSpotAuditVerifier: (opts: { residueIds: string[]; planPath: string }) => Promise<unknown> })
      .dispatchSpotAuditVerifier({ residueIds: ['8'], planPath: '/tmp/plan.md' });

    expect({
      result,
      readinessCalls: readiness.mock.calls.length,
      verifierCalls: dispatchVerifier.mock.calls.length,
      mainRunnerCalls: vi.mocked(runner.run).mock.calls.length,
    }).toEqual({
      result: { success: true, output: 'verdict' },
      readinessCalls: 1,
      verifierCalls: 2,
      mainRunnerCalls: 0,
    });
  });

  it('returns a timed-out API-key verifier auth failure to the observational audit without redispatching', async () => {
    const authentication = { provider: 'codex' as const, source: 'api-key' as const, state: 'unusable' as const };
    const dispatchVerifier = vi.fn().mockResolvedValue({ success: false, output: 'key rejected', authFailure: true, authentication });
    const runner: StepRunner = { run: vi.fn(), dispatchVerifier };
    const conductor = new Conductor({
      stateFilePath: statePath, stepRunner: runner, events, projectRoot: dir,
      config: { harness_self_host: { auth_park_timeout_minutes: 0 } } as HarnessConfig,
      sleepFn: vi.fn(async () => {}),
    });

    const result = await (conductor as unknown as { dispatchSpotAuditVerifier: (opts: { residueIds: string[]; planPath: string }) => Promise<unknown> })
      .dispatchSpotAuditVerifier({ residueIds: ['8'], planPath: '/tmp/plan.md' });

    expect({ result, verifierCalls: dispatchVerifier.mock.calls.length, mainRunnerCalls: vi.mocked(runner.run).mock.calls.length }).toEqual({
      result: { success: false, output: 'key rejected', authFailure: true, authentication },
      verifierCalls: 1,
      mainRunnerCalls: 0,
    });
  });

  it('loses a repeatedly rejected cached-login audit sample after one in-place recovery cycle', async () => {
    const authentication = { provider: 'codex' as const, source: 'cached-login' as const, state: 'unusable' as const };
    const readiness = vi.fn().mockResolvedValue({ ...authentication, state: 'ready' as const });
    const dispatchVerifier = vi.fn()
      .mockResolvedValueOnce({ success: false, output: 'first rejection', authFailure: true, authentication })
      .mockResolvedValueOnce({ success: false, output: 'second rejection', authFailure: true, authentication });
    const runner: StepRunner = { run: vi.fn(), dispatchVerifier };
    const runtimes = new ProviderRuntimeSet([{
      key: 'codex', provider: { invoke: vi.fn(), readiness },
      policy: CODEX_MODEL_POLICY, builtIn: true,
      availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
    }]);
    const conductor = new Conductor({
      stateFilePath: statePath, stepRunner: runner, events, projectRoot: dir,
      config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as HarnessConfig,
      providerExecution: { runtimes, sessions: new ProviderSessionStore(), configuredProviders: ['codex'] },
      sleepFn: vi.fn(async () => {}),
    });

    const result = await (conductor as unknown as { dispatchSpotAuditVerifier: (opts: { residueIds: string[]; planPath: string }) => Promise<unknown> })
      .dispatchSpotAuditVerifier({ residueIds: ['8'], planPath: '/tmp/plan.md' });

    expect({ result, readinessCalls: readiness.mock.calls.length, verifierCalls: dispatchVerifier.mock.calls.length, mainRunnerCalls: vi.mocked(runner.run).mock.calls.length }).toEqual({
      result: { success: false, output: 'second rejection', authFailure: true, authentication },
      readinessCalls: 1,
      verifierCalls: 2,
      mainRunnerCalls: 0,
    });
  });

  it('keeps a non-auth verifier failure observational with one dispatch', async () => {
    const dispatchVerifier = vi.fn().mockResolvedValue({ success: false, output: 'verdict unavailable' });
    const runner: StepRunner = { run: vi.fn(), dispatchVerifier };
    const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events, projectRoot: dir });

    const result = await (conductor as unknown as { dispatchSpotAuditVerifier: (opts: { residueIds: string[]; planPath: string }) => Promise<unknown> })
      .dispatchSpotAuditVerifier({ residueIds: ['8'], planPath: '/tmp/plan.md' });

    expect({ result, verifierCalls: dispatchVerifier.mock.calls.length, mainRunnerCalls: vi.mocked(runner.run).mock.calls.length }).toEqual({
      result: { success: false, output: 'verdict unavailable' },
      verifierCalls: 1,
      mainRunnerCalls: 0,
    });
  });

  describe('merged shipment terminal guard (Task 7)', () => {
    const terminalState: ConductState = {
      feature_desc: 'feat',
      pr_url: 'https://github.com/owner/repo/pull/916',
    };

    async function stopIfPrMerged(
      conductor: Conductor,
      state: ConductState = terminalState,
    ): Promise<boolean> {
      return (
        conductor as unknown as {
          stopIfPrMerged: (
            current: ConductState,
            onSigint: () => Promise<void>,
            onSigterm: () => Promise<void>,
          ) => Promise<boolean>;
        }
      ).stopIfPrMerged(state, async () => {}, async () => {});
    }

    it('halts a merged evidence refusal without writing synthetic finish or DONE markers', async () => {
      const verifier = vi.fn(async () => ({
        kind: 'halt' as const,
        reason: 'shipped-record-missing',
      }));
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: createMockStepRunner(),
        events,
        daemon: true,
        verifyMergedShipment: verifier,
        escalateBuildFailure: async () => ({}),
      });

      expect(await stopIfPrMerged(conductor)).toBe(true);
      expect(verifier).toHaveBeenCalledWith(terminalState.pr_url, terminalState.feature_desc);
      await expect(readFile(join(dir, '.pipeline', 'HALT'), 'utf-8')).resolves.toContain(
        'durable shipment evidence: shipped-record-missing',
      );
      await expect(readFile(join(dir, '.pipeline', 'HALT.class'), 'utf-8')).resolves.toBe(
        'mechanical',
      );
      await expect(readFile(join(dir, '.pipeline', 'DONE'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(dir, '.pipeline', 'finish-choice'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('lets verified merged evidence continue through the normal state machine without synthetic markers', async () => {
      const verifier = vi.fn(async () => ({ kind: 'verified' as const }));
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: createMockStepRunner(),
        events,
        daemon: true,
        verifyMergedShipment: verifier,
      });

      expect(await stopIfPrMerged(conductor)).toBe(false);
      expect(verifier).toHaveBeenCalledWith(terminalState.pr_url, terminalState.feature_desc);
      await expect(readFile(join(dir, '.pipeline', 'HALT'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(dir, '.pipeline', 'DONE'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(dir, '.pipeline', 'finish-choice'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  describe('track resolution from the committed marker (adr-2026-06-29-explore-prd-split-track-in-explore/adr-2026-06-29-track-marker-location, interactive)', () => {
    it('technical marker → prd is skipped even when state.track is unset', async () => {
      // /explore wrote the marker; state has no `track` (interactive path).
      await mkdir(join(dir, '.docs', 'track'), { recursive: true });
      await writeFile(join(dir, '.docs', 'track', 'feat.md'), '# Track\n\nTrack: technical\n');
      await writeState(statePath, {
        worktree: 'done', memory: 'done', explore: 'done', complexity: 'done',
        complexity_tier: 'M',
      } as ConductState);

      const stepsRun: StepName[] = [];
      const runner: StepRunner = { run: async (s) => { stepsRun.push(s); return { success: true }; } };
      const conductor = new Conductor({
        stateFilePath: statePath, stepRunner: runner, events, projectRoot: dir, fromStep: 'prd',
      });
      await conductor.run();

      expect(stepsRun).not.toContain('prd');
      const r = await readState(statePath);
      if (r.ok) {
        expect(r.value.prd).toBe('skipped');
        expect(r.value.track).toBe('technical'); // resolved from marker + persisted
      }
    });

    it('product marker → prd runs', async () => {
      await mkdir(join(dir, '.docs', 'track'), { recursive: true });
      await writeFile(join(dir, '.docs', 'track', 'feat.md'), '# Track\n\nTrack: product\n');
      await writeState(statePath, {
        worktree: 'done', memory: 'done', explore: 'done', complexity: 'done',
        complexity_tier: 'M',
      } as ConductState);

      const stepsRun: StepName[] = [];
      const runner: StepRunner = { run: async (s) => { stepsRun.push(s); return { success: true }; } };
      const conductor = new Conductor({
        stateFilePath: statePath, stepRunner: runner, events, projectRoot: dir, fromStep: 'prd',
      });
      await conductor.run();

      expect(stepsRun).toContain('prd');
    });
  });

  describe('documentation delivery terminal path (issue #933)', () => {
    const delivery = {
      version: 1,
      branch: 'docs/install-refresh',
      prUrl: 'https://github.com/acme/widgets/pull/42',
      sourceRef: 'acme/widgets#17',
    } as const;

    async function writeDocumentationDelivery(value: unknown): Promise<void> {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline', 'documentation-delivery.json'),
        JSON.stringify(value),
      );
    }

    const verifiedPr = JSON.stringify({
      headRefName: delivery.branch,
      body: `Documentation delivery\n\nCloses ${delivery.sourceRef}`,
    });

    it('stops after explore and records a verified documentation PR', async () => {
      const stepsRun: StepName[] = [];
      const runner: StepRunner = {
        run: async (step) => {
          stepsRun.push(step);
          if (step === 'explore') await writeDocumentationDelivery(delivery);
          return { success: true };
        },
      };
      const gh: GhRunner = vi.fn().mockResolvedValue({ stdout: verifiedPr });
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        gh,
      });

      await conductor.run();

      expect(stepsRun).toEqual(['memory', 'explore']);
      const result = await readState(statePath);
      expect(result.ok && result.value.feature_status).toBe('complete');
      expect(result.ok && result.value.pr_url).toBe(delivery.prUrl);
    });

    it('writes DONE for a verified documentation PR in daemon mode', async () => {
      const stepsRun: StepName[] = [];
      const runner: StepRunner = {
        run: async (step) => {
          stepsRun.push(step);
          if (step === 'explore') await writeDocumentationDelivery(delivery);
          return { success: true };
        },
      };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        mode: 'default',
        daemon: true,
        gh: vi.fn().mockResolvedValue({ stdout: verifiedPr }),
      });

      await conductor.run();

      expect(stepsRun).toEqual(['memory', 'explore']);
      await expect(readFile(join(dir, '.pipeline', 'DONE'), 'utf-8')).resolves.toMatch(/complete/i);
    });

    it('fails closed when explore leaves an invalid delivery marker', async () => {
      const stepsRun: StepName[] = [];
      const runner: StepRunner = {
        run: async (step) => {
          stepsRun.push(step);
          if (step === 'explore') await writeDocumentationDelivery({ ...delivery, sourceRef: 'bad/ref/17' });
          return { success: true };
        },
      };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        gh: vi.fn().mockResolvedValue({ stdout: verifiedPr }),
      });

      await conductor.run();

      expect(stepsRun).toEqual(['memory', 'explore']);
      const result = await readState(statePath);
      expect(result.ok && result.value.feature_status).not.toBe('complete');
    });

    it('fails closed when the delivery PR does not close its source issue', async () => {
      const stepsRun: StepName[] = [];
      const runner: StepRunner = {
        run: async (step) => {
          stepsRun.push(step);
          if (step === 'explore') await writeDocumentationDelivery(delivery);
          return { success: true };
        },
      };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        gh: vi.fn().mockResolvedValue({
          stdout: JSON.stringify({
            headRefName: delivery.branch,
            body: 'Documentation delivery\n\nCloses acme/widgets#18',
          }),
        }),
      });

      await conductor.run();

      expect(stepsRun).toEqual(['memory', 'explore']);
      const result = await readState(statePath);
      expect(result.ok && result.value.feature_status).not.toBe('complete');
    });

    it('fails closed instead of reusing a delivery marker from an earlier run', async () => {
      await writeDocumentationDelivery(delivery);
      await utimes(
        join(dir, '.pipeline', 'documentation-delivery.json'),
        new Date(0),
        new Date(0),
      );
      const stepsRun: StepName[] = [];
      const runner: StepRunner = {
        run: async (step) => {
          stepsRun.push(step);
          return { success: true };
        },
      };
      const gh: GhRunner = vi.fn().mockResolvedValue({ stdout: verifiedPr });
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        gh,
      });

      await conductor.run();

      expect(stepsRun).toEqual(['memory', 'explore']);
      expect(gh).not.toHaveBeenCalled();
      const result = await readState(statePath);
      expect(result.ok && result.value.feature_status).not.toBe('complete');
    });

    it('continues normally when explore creates no delivery marker', async () => {
      const stepsRun: StepName[] = [];
      const runner: StepRunner = {
        run: async (step) => {
          stepsRun.push(step);
          return { success: true };
        },
      };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
      });

      await conductor.run();

      expect(stepsRun).toContain('stories');
      expect(stepsRun).toContain('plan');
    });
  });

  it('starts at step index 0 for new feature', async () => {
    const runner = createMockStepRunner();
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    // `complexity`, `worktree`, `test_suite`, and `rebase` are engine-managed
    // (not runner.run), so
    // the runner is called for every step EXCEPT those, and the first runner
    // dispatch is `memory`.
    const dispatchedSteps = ALL_STEPS.filter(
      (s) =>
        s.name !== 'complexity' &&
        s.name !== 'worktree' &&
        s.name !== 'test_suite' &&
        s.name !== 'rebase',
    ).length;
    expect(runner.run).toHaveBeenCalledTimes(dispatchedSteps);
    expect((runner.run as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('memory');
  });

  it('marks step in_progress before running', async () => {
    const statusesDuringRun: Record<string, string | undefined> = {};
    const runner: StepRunner = {
      run: async (step: StepName, _state: ConductState) => {
        // Capture the state at the time the runner is called
        const stateResult = await readState(statePath);
        if (stateResult.ok) {
          statusesDuringRun[step] = stateResult.value[step] as string | undefined;
        }
        return { success: true };
      },
    };
    // This unit test exercises the dispatch state transition, not the full
    // gate-driven workflow. Pre-resolve the unrelated steps so the test cannot
    // enter the validator convergence loop after proving its single invariant.
    await writeState(
      statePath,
      Object.fromEntries(
        ALL_STEPS.filter((step) => step.name !== 'memory').map((step) => [step.name, 'done']),
      ) as ConductState,
    );
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'memory',
    });

    await conductor.run();

    // `memory` is an ordinary runner-dispatched step (unlike engine-managed
    // worktree, complexity, test_suite, and rebase).
    expect(statusesDuringRun['memory']).toBe('in_progress');
  });

  it('marks step done after success', async () => {
    const runner = createMockStepRunner();
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    // After run completes, all steps should be 'done' in state file
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value['worktree']).toBe('done');
      expect(result.value['explore']).toBe('done');
      expect(result.value['finish']).toBe('done');
    }
  });

  it('advances to next step after success', async () => {
    const callOrder: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        callOrder.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    // Steps should be called in exact ALL_STEPS order, minus the engine-managed
    // steps (complexity / worktree / test_suite / rebase, not runner.run).
    const expectedOrder = ALL_STEPS.filter(
      (s) =>
        s.name !== 'complexity' &&
        s.name !== 'worktree' &&
        s.name !== 'test_suite' &&
        s.name !== 'rebase',
    ).map((s) => s.name);
    expect(callOrder).toEqual(expectedOrder);
  });

  it('sets feature_status=complete when all steps done', async () => {
    const runner = createMockStepRunner();
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.feature_status).toBe('complete');
    }
  });

  it('emits step_started and step_completed events', async () => {
    const runner = createMockStepRunner();
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });

    const emitted: Array<{ type: string; step: string }> = [];
    events.on('step_started', (e) => {
      if (e.type === 'step_started') emitted.push({ type: e.type, step: e.step });
    });
    events.on('step_completed', (e) => {
      if (e.type === 'step_completed') emitted.push({ type: e.type, step: e.step });
    });

    await conductor.run();

    // Should have started + completed events for every step (complexity
    // dispatches via the engine path but still emits the same event pair).
    expect(emitted.length).toBe(ALL_STEPS.length * 2);

    // Check first step events are in correct order
    expect(emitted[0]).toEqual({ type: 'step_started', step: 'worktree' });
    expect(emitted[1]).toEqual({ type: 'step_completed', step: 'worktree' });

    // Check last step
    const lastIdx = (ALL_STEPS.length - 1) * 2;
    expect(emitted[lastIdx]).toEqual({ type: 'step_started', step: 'finish' });
    expect(emitted[lastIdx + 1]).toEqual({ type: 'step_completed', step: 'finish' });
  });

  it('closes conductor-owned open executions through the existing event ledger', async () => {
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
    });
    const timestamps = [1_000, 1_025];
    const persister = new EventPersister(join(dir, '.pipeline/events.jsonl'), events, {
      nowMs: () => timestamps.shift()!,
    });
    persister.start();

    try {
      const executionEvents = conductor as unknown as {
        emitExecutionEvent(event: ConductorEvent): Promise<void>;
        closeOpenExecutions(): Promise<void>;
      };
      await executionEvents.emitExecutionEvent({
        type: 'step_started',
        step: 'build',
        index: 0,
      });

      await executionEvents.closeOpenExecutions();

      const records = (await readFile(join(dir, '.pipeline/events.jsonl'), 'utf-8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const terminal = records.find((record) => record.type === 'step_interrupted');
      expect(terminal).toMatchObject({ type: 'step_interrupted', step: 'build' });
      expect(terminal.activeInterval).toEqual({ startedAtMs: 1_000, durationMs: 25 });
    } finally {
      persister.stop();
    }
  });

  it('registers a start before a daemon shutdown can close its execution', async () => {
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
    });
    const timestamps = [1_000, 1_025];
    const persister = new EventPersister(join(dir, '.pipeline/events.jsonl'), events, {
      nowMs: () => timestamps.shift()!,
    });
    persister.start();

    try {
      const executionEvents = conductor as unknown as {
        emitExecutionEvent(event: ConductorEvent): Promise<void>;
      };
      events.on('step_started', async (event) => {
        if (event.type === 'step_started') await conductor.closeOpenExecutionsForShutdown();
      });

      await executionEvents.emitExecutionEvent({ type: 'step_started', step: 'build', index: 0 });

      const records = (await readFile(join(dir, '.pipeline/events.jsonl'), 'utf-8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(records).toEqual([
        expect.objectContaining({ type: 'step_started', step: 'build' }),
        expect.objectContaining({
          type: 'step_interrupted',
          step: 'build',
          activeInterval: { startedAtMs: 1_000, durationMs: 25 },
        }),
      ]);
    } finally {
      persister.stop();
    }
  });

  it.each(['step_completed', 'step_failed'] as const)(
    'does not let %s close a non-validation parallel execution',
    async (type) => {
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: createMockStepRunner(),
        events,
      });
      const emit = vi.spyOn(events, 'emit');
      const executionEvents = conductor as unknown as {
        emitExecutionEvent(event: ConductorEvent): Promise<void>;
      };
      await executionEvents.emitExecutionEvent({ type: 'parallel_started', step: 'build', branches: [] });
      emit.mockClear();
      const terminal: ConductorEvent = type === 'step_completed'
        ? { type, step: 'build', status: 'done' }
        : { type, step: 'build', error: 'late step failure', retryCount: 0 };
      await executionEvents.emitExecutionEvent(terminal);
      expect(emit).not.toHaveBeenCalled();

      await conductor.closeOpenExecutionsForShutdown();
      expect(emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'parallel_failure', step: 'build',
      }));
    },
  );

  it('suppresses a late validation terminal after daemon SIGTERM closed the execution', async () => {
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
    });
    const timestamps = [1_000, 1_025];
    const persister = new EventPersister(join(dir, '.pipeline/events.jsonl'), events, {
      nowMs: () => timestamps.shift()!,
    });
    persister.start();

    try {
      const executionEvents = conductor as unknown as {
        emitExecutionEvent(event: ConductorEvent): Promise<void>;
      };
      await executionEvents.emitExecutionEvent({ type: 'step_started', step: 'prd_audit', index: 0 });
      await conductor.closeOpenExecutionsForShutdown();

      // A validation member is drained like any other step: its late terminal
      // must not land as a second terminal for the same execution.
      await executionEvents.emitExecutionEvent({ type: 'step_completed', step: 'prd_audit', status: 'done' });
      await executionEvents.emitExecutionEvent({
        type: 'step_failed', step: 'prd_audit', error: 'late validation failure', retryCount: 0,
      });

      const records = (await readFile(join(dir, '.pipeline/events.jsonl'), 'utf-8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const terminals = records.filter((record) =>
        record.type === 'step_completed' || record.type === 'step_failed' || record.type === 'step_interrupted',
      );
      expect(terminals).toEqual([
        expect.objectContaining({
          type: 'step_interrupted',
          step: 'prd_audit',
          activeInterval: { startedAtMs: 1_000, durationMs: 25 },
        }),
      ]);
    } finally {
      persister.stop();
    }
  });

  it('suppresses a late normal terminal after daemon SIGTERM closed the execution', async () => {
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
    });
    const timestamps = [1_000, 1_025];
    const persister = new EventPersister(join(dir, '.pipeline/events.jsonl'), events, {
      nowMs: () => timestamps.shift()!,
    });
    persister.start();

    try {
      const executionEvents = conductor as unknown as {
        emitExecutionEvent(event: ConductorEvent): Promise<void>;
      };
      await executionEvents.emitExecutionEvent({ type: 'step_started', step: 'build', index: 0 });
      await conductor.closeOpenExecutionsForShutdown();

      // The daemon drains instead of cancelling an already-running step, so
      // its runner can resolve after SIGTERM has emitted the shutdown terminal.
      await executionEvents.emitExecutionEvent({ type: 'step_completed', step: 'build', status: 'done' });

      const records = (await readFile(join(dir, '.pipeline/events.jsonl'), 'utf-8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const terminals = records.filter((record) =>
        record.type === 'step_completed' || record.type === 'step_failed' || record.type === 'step_interrupted',
      );
      expect(terminals).toEqual([
        expect.objectContaining({
          type: 'step_interrupted',
          step: 'build',
          activeInterval: { startedAtMs: 1_000, durationMs: 25 },
        }),
      ]);
      await expect(computeTimingRollup(dir)).resolves.toMatchObject({
        state: 'measured',
        activeMs: 25,
      });
    } finally {
      persister.stop();
    }
  });

  it('closes an open execution when a deferred live-boundary halt is consumed', async () => {
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
    });
    const timestamps = [1_000, 1_025];
    const persister = new EventPersister(join(dir, '.pipeline/events.jsonl'), events, {
      nowMs: () => timestamps.shift()!,
    });
    persister.start();

    try {
      const liveBoundary = conductor as unknown as {
        pendingLiveBoundaryHalt?: string;
        emitExecutionEvent(event: ConductorEvent): Promise<void>;
        consumePendingLiveBoundaryHalt(): Promise<string | undefined>;
      };
      await liveBoundary.emitExecutionEvent({
        type: 'step_started',
        step: 'build',
        index: 0,
      });
      liveBoundary.pendingLiveBoundaryHalt = 'live checkout changed during self-host execution';

      await expect(liveBoundary.consumePendingLiveBoundaryHalt()).resolves.toBe(
        'live checkout changed during self-host execution',
      );

      const records = (await readFile(join(dir, '.pipeline/events.jsonl'), 'utf-8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(records).toContainEqual(expect.objectContaining({
        type: 'step_interrupted',
        step: 'build',
        activeInterval: { startedAtMs: 1_000, durationMs: 25 },
      }));
      await expect(readFile(join(dir, '.pipeline/HALT'), 'utf-8')).resolves.toBe(
        'live checkout changed during self-host execution\n',
      );
      await expect(readFile(join(dir, '.pipeline/HALT.class'), 'utf-8')).resolves.toBe('mechanical');
    } finally {
      persister.stop();
    }
  });

  describe('ConductorOptions.runGh injection (Task 3: merged-PR guard plumbing)', () => {
    it('accepts an injected runGh option for the merged-PR guard', async () => {
      const runner = createMockStepRunner();
      const callCount = { value: 0 };
      const fakeRunGh: GhRunner = async () => {
        callCount.value++;
        return { stdout: '' };
      };

      // Should not throw when constructing with runGh option
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        runGh: fakeRunGh,
      });

      expect(conductor).toBeDefined();
    });

    it('uses default makeProductionGh() factory when runGh is omitted', async () => {
      const runner = createMockStepRunner();

      // Should not throw when constructing without runGh option
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
      });

      expect(conductor).toBeDefined();
      // Verify the run completes successfully with default runGh
      await conductor.run();
      const result = await readState(statePath);
      expect(result.ok).toBe(true);
    });
  });

  it('enters recovery flow when step returns failure', async () => {
    // explore (3rd step) permanently fails; maxRetries=0 so the first
    // miss escalates immediately — the retry budget isn't the subject here.
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        if (step === 'explore') return { success: false, output: 'explore failed' };
        return { success: true };
      }),
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      maxRetries: 1,
    });

    const failedEvents: Array<{ step: string; error: string; retryCount: number }> = [];
    events.on('step_failed', (e) => {
      if (e.type === 'step_failed') failedEvents.push({ step: e.step, error: e.error, retryCount: e.retryCount });
    });

    await conductor.run();

    // step_failed should have been emitted
    expect(failedEvents.length).toBe(1);
    expect(failedEvents[0].step).toBe('explore');

    // Should NOT have advanced past the failed step. worktree is engine-managed
    // (not runner-dispatched), so the runner saw memory + explore = 2 calls.
    expect(runner.run).toHaveBeenCalledTimes(2);
  });

  it('does NOT advance to next step on failure', async () => {
    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        if (step === 'explore') return { success: false, output: 'error' };
        return { success: true };
      },
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      maxRetries: 1,
    });

    await conductor.run();

    // worktree is engine-managed, so the runner sees memory → explore, then stops.
    expect(stepsRun).toEqual(['memory', 'explore']);
    // complexity (the step after explore) should NOT have been called
    expect(stepsRun).not.toContain('complexity');
  });

  it('#814: build_review grader-dispatch failure re-dispatches with backoff and a diagnosable reason', async () => {
    // Reproduces the collapse: the grader subprocess dies instantly with EMPTY
    // output (graderDispatchFailed). Pre-fix, all retries burned back-to-back in
    // ms (no backoff) and the reason rendered as "no reason recorded". The fix:
    // each retry re-dispatches, a backoff sleeps between attempts, and the
    // reason is never empty.
    await writeState(statePath, {
      worktree: 'done', memory: 'done', explore: 'done', complexity: 'done',
      complexity_tier: 'M', prd: 'done', architecture_diagram: 'done',
      architecture_review: 'done', stories: 'done', conflict_check: 'done',
      writing_system_tests: 'done', acceptance_specs: 'done', plan: 'done', coherence_check: 'done', build: 'done',
       test_suite: 'done',
    } as ConductState);

    let buildReviewCalls = 0;
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        if (step === 'build_review') {
          buildReviewCalls++;
          return { success: false, output: '', graderDispatchFailed: true };
        }
        return { success: true };
      }),
    };

    const sleeps: number[] = [];
    const retryReasons: string[] = [];
    events.on('step_retry', (e) => {
      if (e.type === 'step_retry' && e.step === 'build_review') retryReasons.push(e.reason);
    });
    const failedErrors: string[] = [];
    events.on('step_failed', (e) => {
      if (e.type === 'step_failed' && e.step === 'build_review') failedErrors.push(e.error);
    });

    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      mode: 'auto',
      fromStep: 'build_review',
      maxRetries: 3,
      sleepFn: async (ms: number) => { sleeps.push(ms); },
    });

    await conductor.run().catch(() => {});

    // Each retry actually re-dispatched the grader (not one predicate-eval burst).
    expect(buildReviewCalls).toBe(3);
    // A backoff was applied between re-dispatches (no ms-collapse).
    expect(sleeps.filter((ms) => ms > 0).length).toBeGreaterThanOrEqual(1);
    // Every retry reason is diagnosable — never empty / "no reason recorded".
    expect(retryReasons.length).toBeGreaterThanOrEqual(1);
    for (const r of retryReasons) {
      expect(r.trim().length).toBeGreaterThan(0);
      expect(r).not.toContain('no reason recorded');
    }
    // The terminal failure error is diagnosable too.
    expect(failedErrors.length).toBe(1);
    expect(failedErrors[0].trim().length).toBeGreaterThan(0);
  });

  it('routes a typed unretryable build_review runner failure on its first attempt', async () => {
    await writeState(statePath, {
      worktree: 'done', memory: 'done', explore: 'done', complexity: 'done',
      complexity_tier: 'M', prd: 'done', architecture_diagram: 'done',
      architecture_review: 'done', stories: 'done', conflict_check: 'done',
      writing_system_tests: 'done', acceptance_specs: 'done', plan: 'done', coherence_check: 'done', build: 'done',
       test_suite: 'done',
    } as ConductState);
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) =>
        step === 'build_review'
          ? {
            success: false,
            output: 'current suite proof is stale',
            unretryableInputs: { retryAfterStep: 'test_suite' as const },
          }
          : { success: true },
      ),
    };
    const retryDecisions: Array<{ step: StepName; attempt: number; decision: string; signal?: string }> = [];
    events.on('retry_decision', (event) => {
      if (event.type === 'retry_decision') retryDecisions.push(event);
    });

    await new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      mode: 'auto',
      daemon: true,
      fromStep: 'build_review',
      maxRetries: 3,
    }).run();

    expect({
      calls: vi.mocked(runner.run).mock.calls.map(([step]) => step),
      retryDecisions,
    }).toEqual({
      calls: ['build_review'],
      retryDecisions: [{ type: 'retry_decision', step: 'build_review', attempt: 1, decision: 'route', signal: 'unretryable-inputs' }],
    });
  });

  it('keeps typed runner failures on the ordinary retry ladder when retry routing is disabled', async () => {
    await writeState(statePath, {
      worktree: 'done', memory: 'done', explore: 'done', complexity: 'done',
      complexity_tier: 'M', prd: 'done', architecture_diagram: 'done',
      architecture_review: 'done', stories: 'done', conflict_check: 'done',
      writing_system_tests: 'done', acceptance_specs: 'done', plan: 'done', coherence_check: 'done', build: 'done',
       test_suite: 'done',
    } as ConductState);
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) =>
        step === 'build_review'
          ? {
            success: false,
            output: 'current suite proof is stale',
            unretryableInputs: { retryAfterStep: 'test_suite' as const },
          }
          : { success: true },
      ),
    };
    const retryDecisions: ConductorEvent[] = [];
    events.on('retry_decision', (event) => {
      if (event.type === 'retry_decision') retryDecisions.push(event);
    });

    await new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      mode: 'auto',
      daemon: true,
      fromStep: 'build_review',
      maxRetries: 3,
      config: { retry_routing: { enabled: false } },
    }).run();

    expect({
      calls: vi.mocked(runner.run).mock.calls.map(([step]) => step),
      retryDecisions,
    }).toEqual({
      calls: ['build_review', 'build_review', 'build_review'],
      retryDecisions: [],
    });
  });

  it('keeps an untyped build_review runner failure on the ordinary retry ladder', async () => {
    await writeState(statePath, {
      worktree: 'done', memory: 'done', explore: 'done', complexity: 'done',
      complexity_tier: 'M', prd: 'done', architecture_diagram: 'done',
      architecture_review: 'done', stories: 'done', conflict_check: 'done',
      writing_system_tests: 'done', acceptance_specs: 'done', plan: 'done', coherence_check: 'done', build: 'done',
       test_suite: 'done',
    } as ConductState);
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) =>
        step === 'build_review' ? { success: false, output: 'transient assembly failure' } : { success: true },
      ),
    };
    const retryDecisions: ConductorEvent[] = [];
    events.on('retry_decision', (event) => {
      if (event.type === 'retry_decision') retryDecisions.push(event);
    });

    await new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      mode: 'auto',
      daemon: true,
      fromStep: 'build_review',
      maxRetries: 3,
    }).run();

    expect({
      calls: vi.mocked(runner.run).mock.calls.map(([step]) => step),
      retryDecisions,
    }).toEqual({
      calls: ['build_review', 'build_review', 'build_review'],
      retryDecisions: [],
    });
  });

  it('#814: an ordinary step failure gets a non-empty reason but no grader backoff (scoping)', async () => {
    // A normal runner failure with EMPTY output must still render a diagnosable
    // reason (the empty-string fix is general), but must NOT incur the
    // grader-dispatch backoff — that is scoped to graderDispatchFailed so
    // ordinary failures keep their existing timing.
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) =>
        step === 'explore' ? { success: false, output: '' } : { success: true },
      ),
    };
    const sleeps: number[] = [];
    const retryReasons: string[] = [];
    events.on('step_retry', (e) => {
      if (e.type === 'step_retry' && e.step === 'explore') retryReasons.push(e.reason);
    });
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      mode: 'auto',
      maxRetries: 3,
      sleepFn: async (ms: number) => { sleeps.push(ms); },
    });

    await conductor.run().catch(() => {});

    // No grader backoff for an ordinary failure.
    expect(sleeps.filter((ms) => ms > 0).length).toBe(0);
    // But the reason is still diagnosable (not empty / "no reason recorded").
    expect(retryReasons.length).toBeGreaterThanOrEqual(1);
    for (const r of retryReasons) {
      expect(r.trim().length).toBeGreaterThan(0);
      expect(r).not.toContain('no reason recorded');
    }
  });

  it('auto mode never prompts: gating-step failure stops without recovery', async () => {
    // `stories` is gating; it permanently fails. In auto mode the conductor must
    // NOT open the recovery menu / a REPL — it stops for a human to inspect.
    const onRecovery = vi.fn().mockResolvedValue('quit' as const);
    const runner: StepRunner = {
      run: async (step: StepName) =>
        step === 'stories' ? { success: false, output: 'boom' } : { success: true },
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      mode: 'auto',
      maxRetries: 1,
      onRecovery,
    });

    await conductor.run();

    expect(onRecovery).not.toHaveBeenCalled();
    const result = await readState(statePath);
    expect(result.ok && result.value.stories).toBe('failed');
    expect(result.ok && result.value.feature_status).toBeUndefined();
  });

  it('auto mode writes a HALT marker on a gating-step failure (daemon-classifiable)', async () => {
    // A supervising daemon reads .pipeline/DONE / .pipeline/HALT to classify the
    // outcome. Before this, an auto hard-failure returned with NO marker, so the
    // daemon reported the opaque "loop ended without DONE or HALT marker" error
    // and couldn't tell halt (retryable) from a crash. Now it writes HALT.
    const runner: StepRunner = {
      run: async (step: StepName) =>
        step === 'stories' ? { success: false, output: 'boom' } : { success: true },
    };
    let halted = false;
    events.on('loop_halt', () => {
      halted = true;
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      maxRetries: 1,
    });

    await conductor.run();

    expect(halted).toBe(true); // loop_halt event emitted
    const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
    expect(halt).toMatch(/stories/);
    expect(await readFile(join(dir, '.pipeline/HALT.class'), 'utf-8')).toBe('needs-human');
    // It HALTed, so it did not also mark the feature complete.
    const result = await readState(statePath);
    expect(result.ok && result.value.feature_status).toBeUndefined();
  });

});
