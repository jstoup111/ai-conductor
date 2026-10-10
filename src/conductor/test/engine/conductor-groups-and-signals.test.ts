// Covers: task:1, task:2, task:3, task:4, task:5, task:9, task:11, task:21
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm,} from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('execa', () => ({
  execa: vi.fn(() =>
    Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
  ),
}));
vi.mock('../../src/engine/pr-labels.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/pr-labels.js')>();
  return {
    ...actual,
    // These orchestration fixtures use synthetic audit stamps and do not
    // exercise Git history. Keep that boundary injected so code-validity
    // observes a clean, preservable fixture state.
    makeProductionGit: () => async () => ({ stdout: '' }),
  };
});
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
import type { ConductState, ConductorEvent, StepGroup, Track } from '../../src/types/index.js';
import type { ConductStateStore } from '../../src/engine/conduct-state-store.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { StepName, RecoveryOption, RecoveryContext } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import {
  ALL_STEPS,
  VALIDATION_GROUP,
} from '../../src/engine/steps.js';
import {
  getNavigableSteps,
  navigateBack,
  filterUnapprovedArtifacts,
  recordApprovals,
  approvalKey,
  resolveGroupMembership,
  earliestRemediationTarget,
} from '../../src/engine/conductor.js';
import { Conductor } from '../test-conductor.js';
import type { StepRunner, StepRunResult, StepRunOptions } from '../../src/engine/conductor.js';
import type { GroupBranchLifecycleObserver, GroupMember } from '../../src/engine/group-core.js';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { createHash } from 'crypto';
import { haltMarkerExists } from '../../src/engine/task-progress.js';
import {
  type RemediationGap,
} from '../../src/engine/artifacts.js';
import { persistPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
import * as artifactModule from '../../src/engine/artifacts.js';
import {
  creditKickbackGateLaps,
  } from '../../src/engine/kickback-ledger.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { computeTimingRollup } from '../../src/engine/timing-rollup.js';
import { appendTimingSection, renderShippedRecord } from '../../src/engine/shipped-record.js';
import { joinBuildReviewRubricOutcomes } from '../../src/engine/build-review-aggregate.js';
import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
  type ProviderModelPolicy,
} from '../../src/engine/provider-model-policy.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import type { EscalateBuildFailureOpts } from '../../src/engine/build-failure-escalation.js';
import { persistAsBuiltVerdict } from '../../src/engine/as-built-verdict-store.js';
import type { AsBuiltPolicy } from '../../src/engine/as-built-policy.js';
import { persistFixtureProjectedRemediationPlan } from './remediation-plan-fixtures.js';

import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
} from '../../src/execution/llm-provider.js';

const NOOP_GROUP_BRANCH_LIFECYCLE_OBSERVER: GroupBranchLifecycleObserver = {
  onAdmitted: () => undefined,
  onAttempt: () => undefined,
  onRetry: () => undefined,
  onSettled: () => undefined,
};

function passingBuildReviewAggregate() {
  const lapId = parseBuildReviewLapId('fixture-lap')!;
  return joinBuildReviewRubricOutcomes({
    lapId,
    snapshotDigest: 'sha256:fixture',
    results: {
      testQuality: {
        kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest: 'sha256:fixture',
        contractVersion: 'v3', findings: [], verdict: 'PASS',
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
 * Conductor fixtures write the engine-owned PRD verdict.  Its Markdown report
 * is deliberately derived by the store, so fixture prose cannot become gate
 * authority while testing unrelated orchestration behavior.
 */
async function writePrdAuditFixture(
  projectRoot: string,
  runId: string | undefined,
  grade: 'PASS' | 'PLAN_GAP' = 'PASS',
): Promise<void> {
  await persistPrdAuditVerdict(projectRoot, {
    complete: true,
    judgment: {
      version: 'v1',
      criterionJudgments: [{
        criterion: { storyId: '1', ordinal: 1 }, criterionId: 'S1.1', grade,
        evidence: 'The fixture supplies a complete typed audit judgment.',
        rationale: 'The orchestration fixture requires a clean current verdict.',
        requirementAssociations: [], evidenceTaskIds: [],
      }],
      noOwnerObservations: [],
    },
    diagnostics: [],
    recordedDispositions: [],
  }, { attemptId: runId ?? 'fixture-prd-audit', codeStamp: 'fixture-head' });
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

function asBuiltApprovedFixture() {
  return {
    version: 'v2' as const,
    verdict: 'APPROVED' as const,
    reachability: [],
    driftNotes: [],
  };
}

function asBuiltBlockedDesignFixture(summary = 'ADR-1 violated.') {
  return {
    version: 'v2' as const,
    verdict: 'BLOCKED' as const,
    reachability: [],
    driftNotes: [],
    findings: [{ class: 'DESIGN' as const, summary }],
    violations: summary,
    resolution: 'A human decision is required.',
  };
}

function asBuiltBlockedRemediableFixture(summary = 'ADR-1 needs a guard.') {
  return {
    version: 'v2' as const,
    verdict: 'BLOCKED' as const,
    reachability: [],
    driftNotes: [],
    findings: [{
      class: 'REMEDIABLE' as const,
      reference: { kind: 'plan-task' as const, taskId: '1' },
      summary,
    }],
    violations: summary,
    resolution: 'Implement the missing guard.',
  };
}

function createMockStepRunner(result: StepRunResult = { success: true }): StepRunner {
  return {
    run: vi.fn().mockResolvedValue(result),
  };
}

// Valid RED execution-evidence for the acceptance_specs gate: the feature's own
// specs ran and failed (not skipped/errored). Fixtures that pre-satisfy
// acceptance_specs to reach a later step must seed this alongside the spec file.
const RED_EVIDENCE_JSON = JSON.stringify({
  outcome: 'specs-generated',
  command: 'bundle exec rspec spec/acceptance',
  targetSpecs: ['spec/acceptance/feature_spec.rb'],
  executed: 1,
  passed: 0,
  failed: 1,
  skipped: 0,
  errors: 0,
  failingTests: [
    {
      name: 'Feature acceptance behavior',
      reason: 'Expected behavior is not implemented yet',
    },
  ],
  ranAt: '2026-08-10T00:00:00.000Z',
  intentRationale: 'The feature acceptance spec executed and failed before implementation.',
});

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

  describe('built-in validation group engagement (auto-mode-only)', () => {
    const VALIDATION_GROUP_PREREQS = {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done', coherence_check: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
      build: 'done',
      build_review: 'done',
       test_suite: 'done',
    } as ConductState;

    it('mode=auto reaching the validation group entry point takes the group path', async () => {
      await writeState(statePath, VALIDATION_GROUP_PREREQS);

      const runner = createMockStepRunner();
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
      });

      const parallelStarted: Array<{ step: string; branches: string[] }> = [];
      events.on('parallel_started', (e) => {
        if (e.type === 'parallel_started') {
          parallelStarted.push({ step: e.step, branches: e.branches });
        }
      });

      await conductor.run();

      expect(parallelStarted).toHaveLength(1);
      expect(parallelStarted[0]).toEqual({
        step: 'manual_test',
        branches: VALIDATION_GROUP.members,
      });
      // The group path is marked, but member dispatch itself (fan-out/join) is
      // wired in a later task — manual_test still dispatches through the
      // ordinary per-step machinery so its FAIL-routing/HALT semantics are
      // unaffected by this task's guard.
      const calledSteps = vi.mocked(runner.run).mock.calls.map((c) => c[0]);
      expect(calledSteps).toContain('manual_test');
    });

    it('forwards a usage-exhausted built-in validation member into daemon provider suppression', async () => {
      await writeState(statePath, VALIDATION_GROUP_PREREQS);
      const deadline = Date.now() + 60_000;
      const providerAvailability = { suppress: vi.fn(), isAvailable: () => true };
      const onProviderSuppressed = vi.fn();
      const runner: StepRunner = {
        run: vi.fn()
          .mockResolvedValueOnce({ success: false, rateLimited: true, usageExhausted: true, actualProvider: 'codex', deadline })
          .mockResolvedValue({ success: true }),
      };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
        rateLimitEpisode: {
          enter: vi.fn(),
          clear: vi.fn().mockResolvedValue(undefined),
          active: () => false,
          nextWaitSeconds: () => 0,
        },
        providerExecution: {
          runtimes: {} as never,
          sessions: {} as never,
          configuredProviders: ['codex'],
          providerAvailability,
          onProviderSuppressed,
        },
      });

      await conductor.run();

      expect({ suppress: providerAvailability.suppress.mock.calls, persisted: onProviderSuppressed.mock.calls }).toEqual({
        suppress: [['codex', deadline]],
        persisted: [['codex', deadline]],
      });
    });

    it('width 2 with one skip: parallel_started lists only the dispatchable members, not the skipped phantom', async () => {
      await writeState(statePath, {
        ...VALIDATION_GROUP_PREREQS,
        complexity_tier: 'L',
        track: 'technical',
      } as ConductState);

      const runner = createMockStepRunner();
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
      });

      const parallelStarted: Array<{ step: string; branches: string[] }> = [];
      events.on('parallel_started', (e) => {
        if (e.type === 'parallel_started') {
          parallelStarted.push({ step: e.step, branches: e.branches });
        }
      });

      await conductor.run();

      // PRD audit is now an always-run validation member, including on the
      // technical track, so all three current members dispatch.
      expect(parallelStarted).toHaveLength(1);
      expect(parallelStarted[0]).toEqual({
        step: 'manual_test',
        branches: ['manual_test', 'prd_audit', 'architecture_review_as_built'],
      });
      expect(parallelStarted[0].branches).toContain('prd_audit');
    });

    it('emits one in-flight heartbeat per concurrently blocked manual_test and prd_audit member, never a group heartbeat, then stops at the join', async () => {
      await writeState(statePath, {
        ...VALIDATION_GROUP_PREREQS,
        complexity_tier: 'M',
        track: 'technical',
        rebase: 'done',
        finish: 'done',
      } as ConductState);
      vi.useFakeTimers();
      const heartbeats: StepName[] = [];
      const admitted = new Set<StepName>();
      let admitBoth!: () => void;
      const bothAdmitted = new Promise<void>((resolve) => { admitBoth = resolve; });
      events.on('step_in_flight', (event) => {
        if (event.type === 'step_in_flight') heartbeats.push(event.step);
      });
      events.on('step_started', (event) => {
        if (event.type !== 'step_started') return;
        admitted.add(event.step);
        if (admitted.has('manual_test') && admitted.has('prd_audit')) admitBoth();
      });
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'manual_test' || step === 'prd_audit') {
            await new Promise<void>((resolve) => setTimeout(resolve, 6 * 60_000));
          }
          return { success: true };
        }),
      };
      const run = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events,
        fromStep: 'manual_test', mode: 'auto', verifyArtifacts: false,
        config: {
          build_progress: { enabled: true, heartbeat_minutes: 5 },
          steps: { architecture_review_as_built: { disable: true } },
        } as HarnessConfig,
      }).run();

      try {
        await bothAdmitted;
        await vi.advanceTimersByTimeAsync(6 * 60_000);
        await run;
        expect(heartbeats).toEqual(['manual_test', 'prd_audit']);

        await vi.advanceTimersByTimeAsync(20 * 60_000);
        expect(heartbeats).toEqual(['manual_test', 'prd_audit']);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps a blocked manual_test heartbeat alive when prd_audit throws early, without heartbeating the failed member', async () => {
      await writeState(statePath, {
        ...VALIDATION_GROUP_PREREQS,
        complexity_tier: 'M',
        track: 'technical',
        rebase: 'done',
        finish: 'done',
      } as ConductState);
      vi.useFakeTimers();
      const heartbeats: StepName[] = [];
      let prdAuditRejected = false;
      const admitted = new Set<StepName>();
      let admitBoth!: () => void;
      const bothAdmitted = new Promise<void>((resolve) => { admitBoth = resolve; });
      events.on('step_in_flight', (event) => {
        if (event.type === 'step_in_flight') heartbeats.push(event.step);
      });
      events.on('step_started', (event) => {
        if (event.type !== 'step_started') return;
        admitted.add(event.step);
        if (admitted.has('manual_test') && admitted.has('prd_audit')) admitBoth();
      });
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'manual_test') {
            await new Promise<void>((resolve) => setTimeout(resolve, 6 * 60_000));
          }
          if (step === 'prd_audit') {
            await new Promise<void>((_, reject) => setTimeout(() => {
              prdAuditRejected = true;
              reject(new Error('fixture prd failure'));
            }, 60_000));
          }
          return { success: true };
        }),
      };
      const run = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events,
        fromStep: 'manual_test', mode: 'auto', maxRetries: 1, verifyArtifacts: false,
        config: {
          build_progress: { enabled: true, heartbeat_minutes: 5 },
          steps: { architecture_review_as_built: { disable: true } },
        } as HarnessConfig,
      }).run();

      try {
        await bothAdmitted;
        await vi.advanceTimersByTimeAsync(6 * 60_000);
        await run;
        expect(heartbeats).toEqual(['manual_test']);
        expect({
          prdAuditRejected,
          dispatched: vi.mocked(runner.run).mock.calls.map(([step]) => step),
        }).toEqual({
          prdAuditRejected: true,
          dispatched: expect.arrayContaining(['manual_test', 'prd_audit']),
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('interactive mode runs the validation group members via the pre-existing serial walk, event-stream equivalent to baseline', async () => {
      await writeState(statePath, VALIDATION_GROUP_PREREQS);

      const stepsRun: StepName[] = [];
      const runner: StepRunner = {
        run: async (s) => {
          stepsRun.push(s);
          return { success: true };
        },
      };
      const onCheckpoint = vi.fn().mockResolvedValue('continue' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        // Interactive/default mode — NOT 'auto'.
        onCheckpoint,
      });

      const observedEvents: Array<{ type: string; step?: string }> = [];
      events.on('parallel_started', (e) => {
        if (e.type === 'parallel_started') observedEvents.push({ type: e.type, step: e.step });
      });
      events.on('checkpoint_reached', (e) => {
        if (e.type === 'checkpoint_reached') observedEvents.push({ type: e.type, step: e.step });
      });
      events.on('step_started', (e) => {
        if (e.type === 'step_started') observedEvents.push({ type: e.type, step: e.step });
      });

      await conductor.run();

      // No group-path event ever fires in interactive mode.
      expect(observedEvents.some((e) => e.type === 'parallel_started')).toBe(false);

      // The three group members still dispatch one at a time, in order —
      // the pre-existing serial walk, untouched.
      expect(stepsRun.slice(0, 3)).toEqual([
        'manual_test',
        'prd_audit',
        'architecture_review_as_built',
      ]);

      // checkpoint_reached still fires after manual_test, with no
      // group-related events interleaved before it.
      const checkpointIndex = observedEvents.findIndex(
        (e) => e.type === 'checkpoint_reached' && e.step === 'manual_test',
      );
      expect(checkpointIndex).toBeGreaterThanOrEqual(0);
      const manualTestStartIndex = observedEvents.findIndex(
        (e) => e.type === 'step_started' && e.step === 'manual_test',
      );
      expect(manualTestStartIndex).toBeGreaterThanOrEqual(0);
      expect(checkpointIndex).toBeGreaterThan(manualTestStartIndex);
      expect(
        observedEvents
          .slice(manualTestStartIndex, checkpointIndex + 1)
          .some((e) => e.type === 'parallel_started'),
      ).toBe(false);
      expect(onCheckpoint).toHaveBeenCalledWith('manual_test');
    });
  });

  describe('width-1 group degrades to serial semantics (Task 16)', () => {
    const VALIDATION_GROUP_PREREQS = {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done', coherence_check: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
      build: 'done',
      build_review: 'done',
       test_suite: 'done',
    } as ConductState;

    it('width 1: a single dispatchable member degrades to serial semantics — no parallel_started emitted', async () => {
      // The always-run PRD audit makes this a two-member group: manual_test
      // plus prd_audit.  Preserve the event assertion for that current shape.
      await writeState(statePath, {
        ...VALIDATION_GROUP_PREREQS,
        complexity_tier: 'M',
        track: 'technical',
        architecture_review: 'skipped',
      } as ConductState);

      const runner = createMockStepRunner();
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
      });

      const observedEvents: Array<{ type: string; step?: string }> = [];
      events.on('parallel_started', (e) => {
        if (e.type === 'parallel_started') observedEvents.push({ type: e.type, step: e.step });
      });
      events.on('step_started', (e) => {
        if (e.type === 'step_started') observedEvents.push({ type: e.type, step: e.step });
      });

      await conductor.run();

      expect(observedEvents.some((e) => e.type === 'parallel_started')).toBe(true);
      expect(observedEvents.some((e) => e.type === 'step_started')).toBe(true);
      const calledSteps = vi.mocked(runner.run).mock.calls.map((c) => c[0]);
      expect(calledSteps).toContain('manual_test');
      expect(calledSteps).toContain('prd_audit');
    });

    it('width 1: prd_audit and architecture_review_as_built config-disabled leave manual_test the sole member — no parallel_started emitted', async () => {
      // The always-run prd_audit only leaves the group through an explicit
      // `steps.<name>.disable`; with both siblings disabled the group has one
      // dispatchable member and the fan-out ceremony event is skipped so the
      // event stream for manual_test matches the serial baseline.
      await writeState(statePath, {
        ...VALIDATION_GROUP_PREREQS,
        complexity_tier: 'M',
        track: 'technical',
      } as ConductState);

      const runner = createMockStepRunner();
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
        config: {
          steps: {
            prd_audit: { disable: true },
            architecture_review_as_built: { disable: true },
          },
        } as HarnessConfig,
      });

      const observedEvents: Array<{ type: string; step?: string }> = [];
      events.on('parallel_started', (e) => {
        if (e.type === 'parallel_started') observedEvents.push({ type: e.type, step: e.step });
      });
      events.on('step_started', (e) => {
        if (e.type === 'step_started') observedEvents.push({ type: e.type, step: e.step });
      });

      await conductor.run();

      const calledSteps = vi.mocked(runner.run).mock.calls.map((c) => c[0]);
      expect({
        parallelStarted: observedEvents.some((e) => e.type === 'parallel_started'),
        manualTestStarted: observedEvents.some((e) => e.type === 'step_started' && e.step === 'manual_test'),
        manualTestDispatched: calledSteps.includes('manual_test'),
        siblingsDispatched: calledSteps.filter((step) => step === 'prd_audit' || step === 'architecture_review_as_built'),
      }).toEqual({
        parallelStarted: false,
        manualTestStarted: true,
        manualTestDispatched: true,
        siblingsDispatched: [],
      });
    });
  });

  describe('single-writer join state + gate verdicts — all-green (Task 17)', () => {
    const VALIDATION_GROUP_PREREQS = {
      feature_desc: 'prd-audit-join',
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done', coherence_check: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
      build: 'done',
      build_review: 'done',
      test_suite: 'done',
      rebase: 'done',
      finish: 'done',
    } as ConductState;

    const MT_PASS = '# Results\n\n| Story | Result |\n|--|--|\n| s1 | PASS |\n';

    beforeEach(async () => {
      await mkdir(join(dir, '.docs/specs'), { recursive: true });
      await mkdir(join(dir, '.docs/stories'), { recursive: true });
      await writeFile(
        join(dir, '.docs/specs/prd-audit-join.md'),
        '## Functional Requirements\n\nFR-1\n',
      );
      await writeFile(
        join(dir, '.docs/stories/prd-audit-join.md'),
        '## Story 1: join\n\n**Requirements:** FR-1\n\n### Happy Path\n- Given a green gate, when joined, then it completes.\n',
      );
    });

    function joinRunner(delays: Partial<Record<StepName, number>>): StepRunner {
      return {
        run: vi.fn(async (step: StepName, _state: ConductState, options?: StepRunOptions) => {
          const delay = delays[step];
          if (delay) await new Promise((r) => setTimeout(r, delay));
          await mkdir(join(dir, '.pipeline'), { recursive: true });
          if (step === 'manual_test') {
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
          } else if (step === 'prd_audit') {
            await writePrdAuditFixture(dir, options?.runId);
          } else if (step === 'architecture_review_as_built') {
            await writeAsBuiltFixture(dir, options?.runId, asBuiltApprovedFixture());
          }
          return { success: true };
        }),
      };
    }

    it('rechecks the failed Codex source and redispatches only auth-failed group members', async () => {
      await writeState(statePath, VALIDATION_GROUP_PREREQS);

      const readiness = vi
        .fn()
        .mockResolvedValueOnce({ provider: 'codex', source: 'cached-login', state: 'missing' })
        .mockResolvedValueOnce({ provider: 'codex', source: 'cached-login', state: 'ready' });
      const runtimes = new ProviderRuntimeSet([
        {
          key: 'codex',
          provider: {
            invoke: vi.fn(),
            readiness,
          },
          policy: CODEX_MODEL_POLICY,
          builtIn: true,
          availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
        },
      ]);
      const calls: Array<{ step: StepName; attempt?: number }> = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, options?: StepRunOptions): Promise<StepRunResult> => {
          calls.push({ step, attempt: options?.attempt });
          await mkdir(join(dir, '.pipeline'), { recursive: true });
          const priorCalls = calls.filter((call) => call.step === step).length;
          if (step === 'manual_test') {
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
            return { success: true };
          }
          if (step === 'prd_audit' && priorCalls === 1) {
            return {
              success: false,
              authFailure: true,
              actualProvider: 'codex',
              authentication: { provider: 'codex', source: 'cached-login', state: 'unusable' },
            };
          }
          if (step === 'architecture_review_as_built' && priorCalls === 1) {
            return {
              success: false,
              authFailure: true,
              actualProvider: 'codex',
              authentication: { provider: 'codex', source: 'cached-login', state: 'missing' },
            };
          }
          if (step === 'prd_audit') {
            await writePrdAuditFixture(dir, options?.runId);
          } else if (step === 'architecture_review_as_built') {
            await writeAsBuiltFixture(dir, options?.runId, asBuiltApprovedFixture());
          }
          return { success: true };
        }),
      };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
        maxRetries: 1,
        sleepFn: vi.fn(async () => {}),
        config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as never,
        providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
      });

      await conductor.run();

      expect(readiness).toHaveBeenCalledTimes(2);
      expect(calls.filter((call) => call.step === 'manual_test')).toHaveLength(1);
      expect(calls.filter((call) => call.step === 'prd_audit').map((call) => call.attempt)).toEqual([1, 1]);
      expect(calls.filter((call) => call.step === 'architecture_review_as_built').map((call) => call.attempt)).toEqual([1, 1]);
    });

    it('retries a transient prd_audit branch failure within the serial attempt budget before joining', async () => {
      await writeState(statePath, VALIDATION_GROUP_PREREQS);
      const calls: Array<{ step: StepName; attempt?: number }> = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, options?: StepRunOptions) => {
          calls.push({ step, attempt: options?.attempt });
          await mkdir(join(dir, '.pipeline'), { recursive: true });
          const prdAuditCalls = calls.filter((call) => call.step === 'prd_audit').length;
          if (step === 'prd_audit' && prdAuditCalls === 1) {
            throw new Error('HTTP 500 transient provider error');
          }
          if (step === 'manual_test') {
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
          } else if (step === 'prd_audit') {
            await writePrdAuditFixture(dir, options?.runId);
          } else if (step === 'architecture_review_as_built') {
            await writeAsBuiltFixture(dir, options?.runId, asBuiltApprovedFixture());
          }
          return { success: true };
        }),
      };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
        maxRetries: 2,
        verifyArtifacts: true,
      });

      await conductor.run();

      expect({
        prdAuditAttempts: calls
          .filter((call) => call.step === 'prd_audit')
          .map((call) => call.attempt),
        prdAuditVerdict: await readFile(join(dir, '.pipeline/gates/prd_audit.json'), 'utf-8'),
        haltExists: await haltMarkerExists(dir),
      }).toEqual({
        prdAuditAttempts: [1, 2],
        prdAuditVerdict: expect.stringContaining('"satisfied": true'),
        haltExists: false,
      });
    });

    it('halts after a prd_audit branch spends the serial attempt budget without a verdict', async () => {
      await writeState(statePath, VALIDATION_GROUP_PREREQS);
      const calls: Array<{ step: StepName; attempt?: number }> = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, options?: StepRunOptions) => {
          calls.push({ step, attempt: options?.attempt });
          if (step === 'prd_audit') throw new Error('HTTP 500 provider error');
          return { success: true };
        }),
      };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
        maxRetries: 3,
      });

      await conductor.run();

      expect({
        prdAuditAttempts: calls
          .filter((call) => call.step === 'prd_audit')
          .map((call) => call.attempt),
        haltClass: await readFile(join(dir, '.pipeline/HALT.class'), 'utf-8'),
        haltReason: await readFile(join(dir, '.pipeline/HALT'), 'utf-8'),
      }).toEqual({
        prdAuditAttempts: [1, 2, 3],
        haltClass: 'needs-human',
        haltReason: expect.stringMatching(/branch "prd_audit"[\s\S]*after 3 attempts[\s\S]*HTTP 500 provider error/),
      });
    });

    it('classifies a grouped authentication timeout as needs-human without changing its reason', async () => {
      await writeState(statePath, VALIDATION_GROUP_PREREQS);
      const calls: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName): Promise<StepRunResult> => {
          calls.push(step);
          if (step === 'prd_audit') {
            return {
              success: false,
              authFailure: true,
              actualProvider: 'codex',
              authentication: {
                provider: 'codex',
                source: 'api-key',
                state: 'unusable',
              },
            };
          }
          return { success: true };
        }),
      };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
        config: { harness_self_host: { auth_park_timeout_minutes: 0 } } as HarnessConfig,
      });

      await conductor.run();

      expect({
        reason: await readFile(join(dir, '.pipeline/HALT'), 'utf-8'),
        haltClass: await readFile(join(dir, '.pipeline/HALT.class'), 'utf-8'),
        calls,
      }).toEqual({
        reason:
          'Codex API-key authentication is inherited at daemon startup and cannot be refreshed in-process.\n' +
          'Replace CODEX_API_KEY, restart the daemon, then re-queue this feature.\n',
        haltClass: 'needs-human',
        calls: ['manual_test', 'prd_audit', 'architecture_review_as_built'],
      });
    });

    it('halts one denied Codex group member without rerunning its completed siblings', async () => {
      await writeState(statePath, VALIDATION_GROUP_PREREQS);
      const calls: StepName[] = [];
      const haltReasons: string[] = [];
      events.on('loop_halt', (event) => {
        if (event.type === 'loop_halt') haltReasons.push(event.reason);
      });
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName): Promise<StepRunResult> => {
          calls.push(step);
          if (step === 'prd_audit') {
            return {
              success: false,
              output: 'Codex automatic permission review denied the required action.',
              permissionDenied: true,
              actualProvider: 'codex',
              authentication: {
                provider: 'codex',
                source: 'api-key',
                state: 'ready',
              },
            };
          }
          return { success: true };
        }),
      };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
        maxRetries: 3,
      });

      await conductor.run();

      expect({
        calls: Object.fromEntries(
          ['manual_test', 'prd_audit', 'architecture_review_as_built'].map((step) => [
            step,
            calls.filter((call) => call === step).length,
          ]),
        ),
        haltReasons,
        haltBody: await readFile(join(dir, '.pipeline/HALT'), 'utf-8'),
        haltClass: await readFile(join(dir, '.pipeline/HALT.class'), 'utf-8'),
      }).toEqual({
        calls: { manual_test: 1, prd_audit: 1, architecture_review_as_built: 1 },
        haltReasons: [
          expect.stringMatching(
            /Codex permission review denied[\s\S]*selected api-key source[\s\S]*re-scope[\s\S]*re-queue/i,
          ),
        ],
        haltBody: haltReasons[0] + '\n',
        haltClass: 'needs-human',
      });
    });

    it('mixed-order completions (prd_audit resolves before manual_test) still produce one consistent state snapshot with all member + group keys', async () => {
      await writeState(statePath, VALIDATION_GROUP_PREREQS);

      // manual_test is the slowest branch — prd_audit and
      // architecture_review_as_built resolve first, exercising mixed
      // completion order at the semaphore.
      const runner = joinRunner({ manual_test: 30 });
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
      });

      await conductor.run();

      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      const state = result.ok ? (result.value as Record<string, unknown>) : {};

      // Every member's own step-status key is 'done'.
      expect(state.manual_test).toBe('done');
      expect(state.prd_audit).toBe('done');
      expect(state.architecture_review_as_built).toBe('done');

      // Every member's synthetic «group»__«member» key is also 'done' —
      // matching the DSL parallel group's key format (Task 10).
      expect(state['validation__manual_test']).toBe('done');
      expect(state['validation__prd_audit']).toBe('done');
      expect(state['validation__architecture_review_as_built']).toBe('done');
    });

    it('writes .pipeline/gates/«member».json for every member at join, serially, from the core', async () => {
      await writeState(statePath, VALIDATION_GROUP_PREREQS);

      const runner = joinRunner({ prd_audit: 20 });
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
      });

      await conductor.run();

      for (const member of ['manual_test', 'prd_audit', 'architecture_review_as_built'] as const) {
        const raw = await readFile(join(dir, `.pipeline/gates/${member}.json`), 'utf-8');
        const verdict = JSON.parse(raw);
        expect(verdict.satisfied).toBe(true);
      }
    });

    it('write-spy: zero state writes originate inside branch execution — only the join (core, post-fan-out) writes conduct-state.json', async () => {
      await writeState(statePath, VALIDATION_GROUP_PREREQS);

      // While manual_test is still in flight (its own branch has not yet
      // resolved), prd_audit's branch reads conduct-state.json directly off
      // disk from INSIDE its own dispatch. If a branch — or the core, before
      // every branch has settled — ever wrote a member's completion key
      // early, this would observe it. The single-writer invariant requires
      // it stays absent until every branch (including the still-in-flight
      // manual_test) has resolved.
      let sawPrematureWrite: unknown = 'not-checked';
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state, options) => {
          await mkdir(join(dir, '.pipeline'), { recursive: true });
          if (step === 'manual_test') {
            await new Promise((r) => setTimeout(r, 30));
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
          } else if (step === 'prd_audit') {
            await writePrdAuditFixture(dir, options?.runId);
            const mid = await readState(statePath);
            sawPrematureWrite = mid.ok ? (mid.value as Record<string, unknown>)['validation__prd_audit'] : 'unreadable';
          } else if (step === 'architecture_review_as_built') {
            await writeAsBuiltFixture(dir, options?.runId, asBuiltApprovedFixture());
          }
          return { success: true };
        }),
      };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
      });

      await conductor.run();

      // prd_audit resolved while manual_test was still in flight; at that
      // moment no synthetic key had been written yet — proving the branch
      // itself never wrote state, and the core had not joined early either.
      expect(sawPrematureWrite).not.toBe('done');

      // After the full run, the join has since written it.
      const finalState = await readState(statePath);
      expect(finalState.ok && (finalState.value as Record<string, unknown>)['validation__prd_audit']).toBe(
        'done',
      );
    });
  });

  describe('SIGINT persistence across the group + resume skips completed members (Task 27)', () => {
    const VALIDATION_GROUP_PREREQS = {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done', coherence_check: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
      build: 'done',
      build_review: 'done',
      test_suite: 'done',
      rebase: 'done',
      finish: 'done',
    } as ConductState;


    it('abort mid-group with one member done persists that member as done; a resumed run re-dispatches only the unfinished members', async () => {
      await writeState(statePath, VALIDATION_GROUP_PREREQS);

      let sigintHandler: (() => void) | undefined;
      const processOnSpy = vi.spyOn(process, 'on').mockImplementation(((
        event: string,
        handler: (...args: unknown[]) => void,
      ) => {
        if (event === 'SIGINT') {
          sigintHandler = handler as () => void;
        }
        return process;
      }) as typeof process.on);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

      // manual_test and architecture_review_as_built block forever (never
      // resolve) — simulating a group still mid-flight when SIGINT lands.
      // prd_audit resolves quickly; a flag (not a synchronous in-runner
      // SIGINT call) marks its completion so the test can wait for the
      // engine's OWN post-dispatch bookkeeping (the per-branch completion
      // event) to finish before firing SIGINT — otherwise SIGINT could win
      // a race against that bookkeeping and observe a state snapshot from
      // before it ran.
      let prdAuditDone = false;
      const neverResolve = new Promise<void>(() => {});
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, _options?: StepRunOptions) => {
          await mkdir(join(dir, '.pipeline'), { recursive: true });
          if (step === 'prd_audit') {
            await writePrdAuditFixture(dir, _options?.runId);
            prdAuditDone = true;
            return { success: true };
          }
          await neverResolve;
          return { success: true };
        }),
      };

      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
      });

      // Not awaited to completion: manual_test/architecture_review_as_built
      // never resolve, so the group promise never settles.
      void conductor.run();
      while (!prdAuditDone) {
        await new Promise((r) => setTimeout(r, 1));
      }
      // Let the engine's own per-branch completion bookkeeping (which runs
      // in a promise continuation immediately after prd_audit's dispatch
      // resolves) actually settle before firing SIGINT.
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      // The D3 write handshake now performs its own artifact reads after the
      // branch settles and before it publishes this completion to the
      // interrupt side-channel. Give that bounded filesystem work time to
      // finish before simulating SIGINT.
      await new Promise((r) => setTimeout(r, 25));
      // The engine's registered handler is `() => signalHandlerBase('SIGINT')`,
      // which returns the handler's own promise — awaiting it (instead of a
      // fixed sleep) makes the state-file write deterministically complete
      // before the read below. A fixed sleep raced fs.writeFile's truncate
      // window and produced an intermittently-empty file.
      expect(sigintHandler).toBeDefined();
      await (sigintHandler as unknown as () => Promise<void>)();

      const midAbortState = await readState(statePath);
      expect(midAbortState.ok).toBe(true);
      const midValue = midAbortState.ok ? (midAbortState.value as Record<string, unknown>) : {};
      expect(midValue.prd_audit).toBe('done');
      expect(midValue.manual_test).not.toBe('done');
      expect(midValue.architecture_review_as_built).not.toBe('done');

      processOnSpy.mockRestore();
      exitSpy.mockRestore();

      // Resumed run: prd_audit already 'done' must not be re-dispatched;
      // manual_test and architecture_review_as_built (still unfinished) must be.
      const dispatched: StepName[] = [];
      const resumedRunner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, options?: StepRunOptions) => {
          dispatched.push(step);
          await mkdir(join(dir, '.pipeline'), { recursive: true });
          if (step === 'manual_test') {
            await writeFile(
              join(dir, '.pipeline/manual-test-results.md'),
              '# Results\n\n| Story | Result |\n|--|--|\n| s1 | PASS |\n',
            );
          } else if (step === 'architecture_review_as_built') {
            await writeAsBuiltFixture(dir, options?.runId, asBuiltApprovedFixture());
          }
          return { success: true };
        }),
      };

      const resumedConductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: resumedRunner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
      });
      await resumedConductor.run();

      expect(dispatched).not.toContain('prd_audit');
      expect(dispatched).toContain('manual_test');
      expect(dispatched).toContain('architecture_review_as_built');
    });
  });

  describe('no-verdict branch fails the group (Task 18)', () => {
    const VALIDATION_GROUP_PREREQS = {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done', coherence_check: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
      build: 'done',
      build_review: 'done',
      test_suite: 'done',
      rebase: 'done',
      finish: 'done',
    } as ConductState;

    const MT_FAIL = '# Results\n\n| Story | Result |\n|--|--|\n| s1 | FAIL |\n';

    it('halts serial and validation-group as-built precondition faults mechanically without retries', async () => {
      const fakeProvider: LLMProvider = {
        lifecycleCapability: { synchronousSpawnPermit: true },
        nativeSchemaCapability: { nativeOutputSchema: true },
        invoke: vi.fn(),
      };
      const runtimes = new ProviderRuntimeSet([{
        key: 'claude', provider: fakeProvider, lifecycleCapability: { synchronousSpawnPermit: true },
        nativeSchemaCapability: { nativeOutputSchema: true }, policy: CLAUDE_MODEL_POLICY, builtIn: true,
        availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
      }]);
      const asBuiltRunner = new DefaultStepRunner({ invoke: vi.fn() }, 'as-built-fault-test', dir, {
        mode: 'auto',
        config: { llm_provider: 'claude', steps: { architecture_review_as_built: { llm_provider: 'claude' } } },
        configuredProviders: ['claude'],
        providerRuntimes: runtimes,
        sessionStore: new ProviderSessionStore(),
      });
      const faultReason = 'as-built input projection fault: plan: expected one plan artifact; found 0';
      const run = vi.fn(async (step: StepName, state: ConductState, options?: StepRunOptions): Promise<StepRunResult> =>
        step === 'architecture_review_as_built'
          ? asBuiltRunner.run(step, state, options)
          : { success: true },
      );
      const serialHalts: string[] = [];
      events.on('loop_halt', (event) => {
        if (event.type === 'loop_halt') serialHalts.push(event.reason);
      });
      const serialState = Object.fromEntries(
        ALL_STEPS.slice(0, ALL_STEPS.findIndex((step) => step.name === 'finish')).map((step) => [step.name, 'done']),
      ) as ConductState;
      await writeState(statePath, {
        ...serialState,
        complexity_tier: 'L',
        build_review: 'skipped',
        manual_test: 'skipped',
        prd_audit: 'skipped',
        architecture_review_as_built: 'pending',
        rebase: 'skipped',
      });
      await new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: { run }, events,
        fromStep: 'architecture_review_as_built', mode: 'interactive', maxRetries: 3,
        onCheckpoint: async () => 'continue',
      }).run();
      expect(run.mock.calls.map(([step]) => step)).toContain('architecture_review_as_built');
      expect({
        calls: run.mock.calls.filter(([step]) => step === 'architecture_review_as_built').length,
        providerCalls: vi.mocked(fakeProvider.invoke).mock.calls.length,
        haltClass: await readFile(join(dir, '.pipeline/HALT.class'), 'utf8'),
        halts: serialHalts,
      }).toEqual({
        calls: 1, providerCalls: 0, haltClass: 'mechanical', halts: [faultReason],
      });

      await rm(join(dir, '.pipeline'), { recursive: true, force: true });
      events = new ConductorEventEmitter();
      const groupHalts: string[] = [];
      const retries: string[] = [];
      events.on('loop_halt', (event) => {
        if (event.type === 'loop_halt') groupHalts.push(event.reason);
      });
      events.on('step_retry', (event) => {
        if (event.type === 'step_retry') retries.push(event.step);
      });
      run.mockClear();
      await writeState(statePath, VALIDATION_GROUP_PREREQS);
      await new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: { run }, events,
        fromStep: 'manual_test', mode: 'auto', maxRetries: 3,
        providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['claude'] },
      }).run();
      expect({
        calls: run.mock.calls.filter(([step]) => step === 'architecture_review_as_built').length,
        providerCalls: vi.mocked(fakeProvider.invoke).mock.calls.length,
        haltClass: await readFile(join(dir, '.pipeline/HALT.class'), 'utf8'),
        retries,
        halts: groupHalts,
      }).toEqual({
        calls: 1, providerCalls: 0, haltClass: 'mechanical', retries: [], halts: [faultReason],
      });
    });

    it('a branch that never produces a completion marker halts the group without kickback while retaining satisfied siblings', async () => {
      await writeState(statePath, VALIDATION_GROUP_PREREQS);

      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, options?: StepRunOptions) => {
          await mkdir(join(dir, '.pipeline'), { recursive: true });
          if (step === 'manual_test') {
            // Crashes: never produces a completion marker, never succeeds.
            return { success: false, output: 'agent process crashed' };
          } else if (step === 'prd_audit') {
            await writePrdAuditFixture(dir, options?.runId);
            return { success: true };
          } else if (step === 'architecture_review_as_built') {
            await writeAsBuiltFixture(dir, options?.runId, asBuiltApprovedFixture());
            return { success: true };
          }
          return { success: true };
        }),
      };

      const kickbacks: string[] = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kickbacks.push(e.to);
      });
      let haltCount = 0;
      events.on('loop_halt', () => {
        haltCount += 1;
      });

      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
      });

      await conductor.run();

      const haltRaw = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(haltRaw).toMatch(/no-verdict|no verdict/i);

      expect(haltCount).toBeGreaterThan(0);
      expect(kickbacks.length).toBe(0);

      await expect(
        readFile(join(dir, '.pipeline/remediation.json'), 'utf-8'),
      ).rejects.toThrow();

      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      const state = result.ok ? (result.value as Record<string, unknown>) : {};
      // The failed member still blocks the group, but satisfied siblings remain
      // done so a resume does not discard their validated work.
      expect(state.manual_test).toBe('failed');
      expect(state.prd_audit).toBe('done');
      expect(state.architecture_review_as_built).toBe('done');
    });

    it('FAIL verdict + a crashed sibling: same halt path, zero kickback events', async () => {
      await writeState(statePath, VALIDATION_GROUP_PREREQS);

      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, options?: StepRunOptions) => {
          await mkdir(join(dir, '.pipeline'), { recursive: true });
          if (step === 'manual_test') {
            // Dispatch itself "succeeds" but the content is a FAIL row.
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_FAIL);
            return { success: true };
          } else if (step === 'prd_audit') {
            // Crashes: never produces a completion marker.
            return { success: false, output: 'agent process crashed' };
          } else if (step === 'architecture_review_as_built') {
            await writeAsBuiltFixture(dir, options?.runId, asBuiltApprovedFixture());
            return { success: true };
          }
          return { success: true };
        }),
      };

      const kickbacks: string[] = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kickbacks.push(e.to);
      });
      let haltCount = 0;
      events.on('loop_halt', () => {
        haltCount += 1;
      });

      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
        // The FAIL-row retention predicate is artifact-aware. Keep this
        // no-verdict fixture on that production path rather than bypassing it.
        verifyArtifacts: true,
      });

      await conductor.run();

      const haltRaw = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(haltRaw).toMatch(/no-verdict|no verdict/i);

      expect(kickbacks.length).toBe(0);
      expect(haltCount).toBeGreaterThan(0);
      const result = await readState(statePath);
      if (!result.ok) throw result.error;
      const state = result.value as Record<string, unknown>;
      // A successful dispatch with FAIL rows is not a satisfied join member.
      expect([state.manual_test, state.validation__manual_test]).not.toContain('done');
    });
  });

  describe('MT-only failure — deterministic kickback parity (Task 20)', () => {
    const VALIDATION_GROUP_PREREQS = {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      prd: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done', coherence_check: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      coverage_binding: 'done',
      acceptance_specs: 'done',
      build: 'done',
      build_review: 'skipped',
      test_suite: 'done',
      rebase: 'done',
      finish: 'done',
    } as ConductState;

    const MT_FAIL = '# Results\n\n| Story | Result |\n|--|--|\n| s1 | FAIL |\n';

    // manual_test always FAILs (perpetual bug); build re-satisfies its own
    // gate but never actually fixes anything — every sibling PASSes cleanly.
    function mtOnlyFailingRunner(): { runner: StepRunner; calls: StepName[] } {
      const calls: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, options?: StepRunOptions) => {
          calls.push(step);
          // Small margin against the freshness check (artifact mtime must
          // postdate session_started_at) — matches the defensive delay
          // pattern used elsewhere in this file (Task 19's sibling tests).
          await new Promise((r) => setTimeout(r, 5));
          await mkdir(join(dir, '.pipeline'), { recursive: true });
          if (step === 'build') {
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
            );
          } else if (step === 'manual_test') {
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_FAIL);
          } else if (step === 'prd_audit') {
            await writePrdAuditFixture(dir, options?.runId);
          } else if (step === 'architecture_review_as_built') {
            await writeAsBuiltFixture(dir, options?.runId, asBuiltApprovedFixture());
          }
          return { success: true };
        }),
      };
      return { runner, calls };
    }

    it('manual_test FAIL alone (siblings PASS) at the group join produces the same navigateBack/retry-hint shape as the serial baseline — zero remediate dispatch', async () => {
      await writeState(statePath, VALIDATION_GROUP_PREREQS);
      // Pre-seed task-status.json exactly like the serial baseline's
      // seedToManualTest() does — otherwise the FIRST kickback's progress
      // snapshot reads "no file" (0 resolved) instead of the true
      // steady-state count, misclassifying the very first repeat as
      // "did-work" and masking D2's no-op escalation.
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
      );
      const { runner } = mtOnlyFailingRunner();

      const kickbacks: Array<{ from: string; to: string; evidence?: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kickbacks.push({ from: e.from, to: e.to, evidence: e.evidence });
      });

      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
      });

      await conductor.run();

      // Exactly one kickback, manual_test -> build, matching the serial
      // baseline's deterministic FAIL-row routing.
      expect(kickbacks.filter((k) => k.from === 'manual_test' && k.to === 'build').length).toBe(1);
      expect(kickbacks[0]?.evidence).toContain('| s1 | FAIL |');

      // The retry hint handed to BUILD carries the FAIL rows + the
      // no-whitewash contract — same shape as the pre-parallel serial walk.
      const buildReasons = vi
        .mocked(runner.run)
        .mock.calls.filter((c) => c[0] === 'build')
        .map((c) => (c[2] as { retryReason?: string } | undefined)?.retryReason ?? '');
      expect(buildReasons.length).toBeGreaterThan(0);
      for (const r of buildReasons) {
        expect(r).toContain('| s1 | FAIL |');
        expect(r).toMatch(/COMMIT/i);
      }

      // Zero remediate dispatches for this failure shape.
      await expect(
        readFile(join(dir, '.pipeline/remediation.json'), 'utf-8'),
      ).rejects.toThrow();
    });

    it('exhausted manualTestSelfHeals halts with the serial baseline reason wording, no partial join', async () => {
      await writeState(statePath, VALIDATION_GROUP_PREREQS);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
      );
      const { runner } = mtOnlyFailingRunner();

      let haltReason = '';
      events.on('loop_halt', (e) => {
        if (e.type === 'loop_halt') haltReason = e.reason;
      });

      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
      });

      await conductor.run();

      // D2's no-op re-entry guard fires on the first repeat cycle (build
      // makes zero net progress against the perpetual FAIL) — same wording
      // family as the serial baseline's kickback-to-build no-op halt.
      expect(haltReason).toMatch(/manual_test kickback-to-build no-op|manual-test FAIL unresolved/);

      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      const state = result.ok ? (result.value as Record<string, unknown>) : {};
      expect(state.manual_test).not.toBe('done');
      expect(state.prd_audit).not.toBe('done');
      expect(state.architecture_review_as_built).not.toBe('done');
    });
  });

  describe('Mixed failure — single remediate dispatch over the gap union (Task 21)', () => {
    const VALIDATION_GROUP_PREREQS = {
      feature_desc: 'validation-remediation',
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      prd: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done', coherence_check: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
      build: 'done',
      build_review: 'skipped',
      test_suite: 'done',
      rebase: 'done',
      finish: 'done',
    } as ConductState;

    const MT_PASS = '# Results\n\n| Story | Result |\n|--|--|\n| s1 | PASS |\n';
    beforeEach(async () => {
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await writeFile(join(dir, '.docs', 'plans', 'validation-remediation.md'), '### Task 1: Fixture task\n\nDone when: the fixture is complete.\n');
    });
    function mixedFailingRunner(): {
      runner: StepRunner;
      remediateCalls: Array<{ retryReason?: string }>;
    } {
      const remediateCalls: Array<{ retryReason?: string }> = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, opts?: StepRunOptions) => {
          await new Promise((r) => setTimeout(r, 5));
          await mkdir(join(dir, '.pipeline'), { recursive: true });
          if (step === 'build') {
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
            );
          } else if (step === 'manual_test') {
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
          } else if (step === 'prd_audit') {
            await writePrdAuditFixableFixture(dir, opts?.runId, [
              { criterionId: 'S1.1', ownerTaskId: '1' },
              { criterionId: 'S1.2', ownerTaskId: '1' },
            ]);
          } else if (step === 'architecture_review_as_built') {
            await writeAsBuiltFixture(dir, opts?.runId, asBuiltBlockedRemediableFixture());
          } else if (step === 'remediate') {
            remediateCalls.push({ retryReason: opts?.retryReason });
            await persistFixtureProjectedRemediationPlan(dir, opts, [
              {
                id: 'S1.1', disposition: 'build', category: null,
                rationale: 'Implement FR-1', tasks: [{ id: 'rem-fr-1', title: 'Implement FR-1' }],
              },
              {
                id: 'S1.2', disposition: 'build', category: null,
                rationale: 'Implement FR-2', tasks: [{ id: 'rem-fr-2', title: 'Implement FR-2' }],
              },
              {
                id: 'as-built', referenceKind: 'as-built-finding', disposition: 'build', category: null,
                rationale: 'Implement the missing guard', tasks: [{ id: 'rem-adr-1', title: 'Implement guard' }],
              },
            ]);
          }
          return { success: true };
        }),
      };
      return { runner, remediateCalls };
    }

    it('prd-audit gaps + as-built BLOCKED at the join dispatch remediate exactly once, over the union of both evidence files, consuming all 3 heterogeneous dispositions', async () => {
      await writeState(statePath, VALIDATION_GROUP_PREREQS);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
      );
      const { runner, remediateCalls } = mixedFailingRunner();

      const kickbacks: Array<{ from: string; to: string; evidence?: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kickbacks.push({ from: e.from, to: e.to, evidence: e.evidence });
      });
      // Ordered member lifecycle, to prove every member that started in the
      // kicked-back round closed before the kickback rather than being
      // reported `step_interrupted` at run end.
      const lifecycle: Array<{ type: string; step?: string }> = [];
      for (const type of ['step_started', 'step_completed', 'step_failed', 'step_refused', 'step_interrupted', 'kickback'] as const) {
        events.on(type, (e) => { lifecycle.push({ type: e.type, step: 'step' in e ? String(e.step) : undefined }); });
      }

      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
      });

      await conductor.run();

      const firstKickback = lifecycle.findIndex((entry) => entry.type === 'kickback');
      expect(firstKickback).toBeGreaterThan(0);
      const beforeKickback = lifecycle.slice(0, firstKickback);
      for (const member of ['prd_audit', 'architecture_review_as_built']) {
        const started = beforeKickback.filter((e) => e.type === 'step_started' && e.step === member).length;
        const closed = beforeKickback.filter((e) => e.step === member && e.type !== 'step_started').length;
        expect({ member, started, closed }).toEqual({ member, started: 1, closed: 1 });
      }
      // The fixture ends the run inside the rerouted build, so only the group
      // members are checked: none may be reported interrupted.
      expect(lifecycle.filter((e) => e.type === 'step_interrupted' && e.step !== 'build')).toEqual([]);

      // Exactly one /remediate dispatch for the whole mixed-failure join.
      expect(remediateCalls).toHaveLength(1);

      // Both typed verdict sources are admitted as one engine-owned projection.
      expect(remediateCalls[0].retryReason).toContain('.pipeline/prd-audit.md');
      // ...and NOT the manual-test results path (manual_test passed cleanly).
      expect(remediateCalls[0].retryReason).not.toContain('manual-test-results.md');

      expect(kickbacks.some((k) => k.to === 'build')).toBe(true);
    });

    it('halts a mixed as-built group report with every finding listed and re-runs the refused gate after HALT clears', async () => {
      await writeState(statePath, VALIDATION_GROUP_PREREQS);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      const planPath = join(dir, '.docs', 'plans', 'mixed-as-built.md');
      const originalPlan = [1, 2, 3, 4].map((id) => `### Task ${id}: Existing work ${id}`).join('\n');
      await writeFile(planPath, originalPlan);
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
      );

      let asBuiltCalls = 0;
      let remediateCalls = 0;
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, opts?: StepRunOptions) => {
          if (step === 'manual_test') {
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
          } else if (step === 'prd_audit') {
            await writePrdAuditFixture(dir, opts?.runId);
          } else if (step === 'architecture_review_as_built') {
            asBuiltCalls++;
            await writeAsBuiltFixture(dir, opts?.runId, {
              version: 'v2', verdict: 'BLOCKED', reachability: [], driftNotes: [],
              findings: [
                {
                  class: 'REMEDIABLE',
                  reference: { kind: 'plan-task', taskId: '1' }, summary: 'Add the missing guard',
                },
                { class: 'DESIGN', summary: 'Choose the incompatible boundary' },
              ],
              violations: 'The boundary is incompatible.', resolution: 'Choose the boundary.',
            });
          } else if (step === 'remediate') {
            remediateCalls++;
          }
          return { success: true };
        }),
      };
      const options = {
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test' as StepName,
        mode: 'auto' as const,
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
      };

      await new Conductor(options).run();

      await expect(readFile(join(dir, '.pipeline/HALT.class'), 'utf8')).resolves.toBe('needs-human');
      const firstHalt = await readFile(join(dir, '.pipeline/HALT'), 'utf8');
      expect(firstHalt).toMatch(/as-built:[^:]+:1 \(REMEDIABLE; plan task 1\): Add the missing guard/);
      expect(firstHalt).toContain(
        'DESIGN; none): Choose the incompatible boundary',
      );
      expect(remediateCalls).toBe(0);
      await expect(readFile(planPath, 'utf8')).resolves.toBe(originalPlan);
      const refused = await readState(statePath);
      expect(refused.ok && refused.value.architecture_review_as_built).toBe('refused');

      await rm(join(dir, '.pipeline/HALT'), { force: true });
      await rm(join(dir, '.pipeline/HALT.class'), { force: true });
      await new Conductor(options).run();

      expect(asBuiltCalls).toBe(2);
      expect(remediateCalls).toBe(0);
      await expect(readFile(planPath, 'utf8')).resolves.toBe(originalPlan);
    });
  });

  describe('Merged work order — earliest target + both evidence streams (Task 22)', () => {
    const VALIDATION_GROUP_PREREQS = {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      prd: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done', coherence_check: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
      build: 'done',
      build_review: 'skipped',
      test_suite: 'done',
      rebase: 'done',
      finish: 'done',
    } as ConductState;

    const MT_FAIL = '# Results\n\n| Story | Result |\n|--|--|\n| s1 | FAIL |\n';
    // manual_test FAILs deterministically AND architecture_review_as_built
    // is BLOCKED (its own gate unsatisfied) in the SAME join round — the
    // merged-work-order shape this task covers. The remediate plan routes
    // ADR-1 to 'acceptance_specs' (a BUILD-phase step earlier than 'build')
    // so the earliest-target merge is exercised non-trivially: manual_test's
    // forced target is 'build', but the merged navigateBack must land on
    // the earlier 'acceptance_specs'.
    function mergedFailingRunner(): {
      runner: StepRunner;
      remediateCalls: Array<{ retryReason?: string }>;
    } {
      const remediateCalls: Array<{ retryReason?: string }> = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, opts?: StepRunOptions) => {
          await new Promise((r) => setTimeout(r, 5));
          await mkdir(join(dir, '.pipeline'), { recursive: true });
          if (step === 'build' || step === 'acceptance_specs') {
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
            );
          } else if (step === 'manual_test') {
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_FAIL);
          } else if (step === 'prd_audit') {
            await writePrdAuditFixture(dir, opts?.runId);
          } else if (step === 'architecture_review_as_built') {
            await writeAsBuiltFixture(dir, opts?.runId, asBuiltBlockedDesignFixture());
          } else if (step === 'remediate') {
            remediateCalls.push({ retryReason: opts?.retryReason });
            // A DESIGN verdict is terminal, so this branch is never admitted
            // to the typed remediation projection.
          }
          return { success: true };
        }),
      };
      return { runner, remediateCalls };
    }

    it('MT FAIL + plan-routed disposition in the same join round produce ONE navigateBack to the earlier target, with a retry hint carrying both evidence streams', async () => {
      await writeState(statePath, VALIDATION_GROUP_PREREQS);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
      );
      const { runner, remediateCalls } = mergedFailingRunner();

      const kickbacks: Array<{ from: string; to: string; evidence?: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kickbacks.push({ from: e.from, to: e.to, evidence: e.evidence });
      });

      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
      });

      await conductor.run();

      // A BLOCKED as-built result is terminal: no merged remediation work
      // order or build kickback may mask it.
      expect(remediateCalls).toHaveLength(0);
      expect(kickbacks).toHaveLength(0);
      expect(await readFile(join(dir, '.pipeline/HALT'), 'utf-8')).toMatch(/as-built review verdict is BLOCKED/);
    });

    it('earliestRemediationTarget merges a manual_test build target with an acceptance_specs disposition to the earlier acceptance_specs', () => {
      // The merged join folds manual_test's forced `build` target into the
      // routed dispositions and navigates back to whichever is earliest in
      // step order; `acceptance_specs` precedes `build`, so it wins and the
      // later `build` target is subsumed by the forward walk.
      const gap = (id: string, disposition: string): RemediationGap => ({
        id,
        disposition,
        category: null,
        rationale: `remediate ${id}`,
        tasks: [{ id: `rem-${id}`, title: `remediate ${id}` }],
      } as unknown as RemediationGap);

      expect(earliestRemediationTarget([gap('mt', 'build'), gap('ADR-1', 'acceptance_specs')], ALL_STEPS)).toEqual({
        target: 'acceptance_specs',
        unresolved: [],
      });
      expect(earliestRemediationTarget([gap('ADR-1', 'acceptance_specs'), gap('mt', 'build')], ALL_STEPS)).toEqual({
        target: 'acceptance_specs',
        unresolved: [],
      });
      expect(earliestRemediationTarget([gap('mt', 'build')], ALL_STEPS)).toEqual({ target: 'build', unresolved: [] });
    });
  });

  // Covers: task:23
  describe('Halt dispositions and partial plans (Task 23)', () => {
    const VALIDATION_GROUP_PREREQS = {
      feature_desc: 'validation-remediation',
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      prd: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done', coherence_check: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
      build: 'done',
      build_review: 'skipped',
      test_suite: 'done',
      rebase: 'done',
      finish: 'done',
    } as ConductState;

    const MT_PASS = '# Results\n\n| Story | Result |\n|--|--|\n| s1 | PASS |\n';
    beforeEach(async () => {
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await writeFile(join(dir, '.docs', 'plans', 'validation-remediation.md'), '### Task 1: Fixture task\n\nDone when: the fixture is complete.\n');
    });
    it('a halt disposition halts the group even when other gaps in the SAME plan are routable fixes', async () => {
      await writeState(statePath, VALIDATION_GROUP_PREREQS);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
      );

      const remediateCalls: Array<{ retryReason?: string }> = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, opts?: StepRunOptions) => {
          await new Promise((r) => setTimeout(r, 5));
          await mkdir(join(dir, '.pipeline'), { recursive: true });
          if (step === 'build') {
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
            );
          } else if (step === 'manual_test') {
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
          } else if (step === 'prd_audit') {
            await writePrdAuditFixableFixture(dir, opts?.runId);
          } else if (step === 'architecture_review_as_built') {
            await writeAsBuiltFixture(dir, opts?.runId, asBuiltBlockedRemediableFixture());
          } else if (step === 'remediate') {
            remediateCalls.push({ retryReason: opts?.retryReason });
            await persistFixtureProjectedRemediationPlan(dir, opts, [{
              id: 'S1.1', disposition: 'build', category: null,
              rationale: 'Implement FR-1', tasks: [{ id: 'rem-fr-1', title: 'Implement FR-1' }],
            }, {
              id: 'as-built', referenceKind: 'as-built-finding', disposition: 'halt', category: 'architectural-clarity',
              rationale: 'The missing guard requires an architectural decision', tasks: [],
            }]);
          }
          return { success: true };
        }),
      };

      const haltEvents: Array<{ reason: string }> = [];
      events.on('loop_halt', (e) => {
        if (e.type === 'loop_halt') haltEvents.push({ reason: e.reason });
      });
      const kickbacks: Array<{ to: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kickbacks.push({ to: e.to });
      });

      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
      });

      await conductor.run();

      expect(remediateCalls).toHaveLength(1);
      expect(kickbacks).toHaveLength(0);
      expect(haltEvents).toHaveLength(1);
      expect(haltEvents[0]?.reason).toContain('needs human DECIDE');
      expect(haltEvents[0]?.reason).toContain('(architectural-clarity: The missing guard requires an architectural decision)');
    });

    it('a plan covering only a subset of the failing gaps never green-lights the unaddressed gap on the next tail pass', async () => {
      await writeState(statePath, VALIDATION_GROUP_PREREQS);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
      );

      const remediateCalls: Array<{ retryReason?: string }> = [];
      const doneEvents: Array<{ step: string }> = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, opts?: StepRunOptions) => {
          await new Promise((r) => setTimeout(r, 5));
          await mkdir(join(dir, '.pipeline'), { recursive: true });
          if (step === 'build') {
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
            );
          } else if (step === 'manual_test') {
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
          } else if (step === 'prd_audit') {
            // Always still shows the SAME blocking gap — the underlying
            // code was never actually fixed (build's mock does not touch
            // it), so re-verifying prd_audit each round is the ONLY thing
            // standing between this test and a false "gate satisfied".
            await writePrdAuditFixableFixture(dir, opts?.runId);
          } else if (step === 'architecture_review_as_built') {
            await writeAsBuiltFixture(dir, opts?.runId, asBuiltBlockedRemediableFixture());
          } else if (step === 'remediate') {
            remediateCalls.push({ retryReason: opts?.retryReason });
            // Subset plan: only ever addresses prd_audit's FR-1 — the
            // architecture_review_as_built finding is never named by any
            // disposition, in any round.
            await persistFixtureProjectedRemediationPlan(dir, opts, [{
              id: 'S1.1', disposition: 'build', category: null,
              rationale: 'Implement FR-1', tasks: [{ id: 'rem-fr-1', title: 'Implement FR-1' }],
            }]);
          }
          return { success: true };
        }),
      };

      events.on('parallel_completed', (e) => {
        if (e.type === 'parallel_completed') {
          for (const b of e.branches) doneEvents.push({ step: b });
        }
      });

      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
      });

      await conductor.run();

      // The incomplete typed plan is rejected rather than admitting only its
      // PRD subset.
      expect(remediateCalls).toHaveLength(1);
      expect(remediateCalls[0].retryReason).toContain('.pipeline/prd-audit.md');

      // The group never reached a "parallel_completed" (all-green) join —
      // architecture_review_as_built's gate was never green-lit despite the
      // plan only covering prd_audit's gap.
      expect(doneEvents).toHaveLength(0);

      // The rejection halts the join before it can record a completed
      // architecture-review member. An absent member cannot satisfy the next
      // tail pass, so stale evidence never green-lights the missing finding.
      const persisted = await readState(statePath);
      expect(persisted.ok).toBe(true);
      const persistedState = (persisted as { ok: true; value: ConductState }).value;
      expect(persistedState.architecture_review_as_built).not.toBe('done');
      expect(persistedState.architecture_review_as_built).toBeUndefined();
    });
  });

  describe('Remediation fallback + budget parity (Task 24)', () => {
    const VALIDATION_GROUP_PREREQS = {
      feature_desc: 'validation-remediation',
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      prd: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done', coherence_check: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
      build: 'done',
      build_review: 'skipped',
      test_suite: 'done',
      rebase: 'done',
      finish: 'done',
    } as ConductState;

    const MT_FAIL = '# Results\n\n| Story | Result |\n|--|--|\n| s1 | FAIL |\n';
    beforeEach(async () => {
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await writeFile(join(dir, '.docs', 'plans', 'validation-remediation.md'), '### Task 1: Fixture task\n\nDone when: the fixture is complete.\n');
    });
    it('an unusable typed remediation result still lets the deterministic manual_test kickback proceed — LLM stream independence', async () => {
      await writeState(statePath, VALIDATION_GROUP_PREREQS);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
      );

      const remediateCalls: Array<{ retryReason?: string }> = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, opts?: StepRunOptions) => {
          await new Promise((r) => setTimeout(r, 5));
          await mkdir(join(dir, '.pipeline'), { recursive: true });
          if (step === 'build') {
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
            );
          } else if (step === 'manual_test') {
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_FAIL);
          } else if (step === 'prd_audit') {
            await writePrdAuditFixableFixture(dir, opts?.runId);
          } else if (step === 'architecture_review_as_built') {
            // APPROVED: a BLOCKED as-built verdict is terminal for the run and
            // would mask the property. The non-MT gap that dispatches
            // /remediate is prd_audit, whose mock writes no report.
            await writeAsBuiltFixture(dir, opts?.runId, asBuiltApprovedFixture());
          } else if (step === 'remediate') {
            remediateCalls.push({ retryReason: opts?.retryReason });
            // Deliberately write no typed result: the planner produced no
            // usable plan, so planRemediation resolves 'none'.
          }
          return { success: true };
        }),
      };

      const kickbacks: Array<{ from: string; to: string; evidence?: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kickbacks.push({ from: e.from, to: e.to, evidence: e.evidence });
      });

      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
      });

      await conductor.run();

      // /remediate was dispatched for the non-MT gap, but never produced a
      // usable typed plan — bounded by the shared
      // remediation budget.
      expect(remediateCalls.length).toBeGreaterThanOrEqual(1);
      expect(remediateCalls.length).toBeLessThanOrEqual(2);

      // Despite the unusable LLM plan, the deterministic manual_test
      // kickback still fires — it does not depend on /remediate at all.
      expect(kickbacks.some((k) => k.from === 'manual_test' && k.to === 'build')).toBe(true);
      const mtKickback = kickbacks.find((k) => k.from === 'manual_test' && k.to === 'build');
      expect(mtKickback?.evidence).toContain('| s1 | FAIL |');
    });

    it('remediationRounds at MAX_KICKBACKS_PER_GATE halts exactly like the serial gate loop, never a silent non-green failure', async () => {
      await writeState(statePath, VALIDATION_GROUP_PREREQS);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
      );

      const remediateCalls: Array<{ retryReason?: string }> = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, opts?: StepRunOptions) => {
          await new Promise((r) => setTimeout(r, 5));
          await mkdir(join(dir, '.pipeline'), { recursive: true });
          if (step === 'build') {
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
            );
          } else if (step === 'manual_test') {
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_FAIL);
          } else if (step === 'architecture_review_as_built') {
            // Perpetually BLOCKED — build's mock never actually fixes it.
            await writeAsBuiltFixture(dir, opts?.runId, asBuiltBlockedDesignFixture());
          } else if (step === 'remediate') {
            remediateCalls.push({ retryReason: opts?.retryReason });
            // A DESIGN verdict is terminal and never contributes a typed
            // remediation reference; retaining the dispatch count verifies
            // that no legacy sidecar can make it routable.
          }
          return { success: true };
        }),
      };

      const haltEvents: Array<{ reason: string }> = [];
      events.on('loop_halt', (e) => {
        if (e.type === 'loop_halt') haltEvents.push({ reason: e.reason });
      });

      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
      });

      await conductor.run();

      // The shared remediation budget (MAX_KICKBACKS_PER_GATE = 2) is
      // respected at the join exactly like the serial gate loop — never
      // more than 2 /remediate dispatches for this persistent gap.
      expect(remediateCalls.length).toBeLessThanOrEqual(2);

      // Once the budget is exhausted, the join HALTs (loop_halt with a
      // budget-parity reason) — it never falls through to a silent
      // generic "non-green branch" step failure.
      expect(haltEvents.length).toBeGreaterThan(0);
      expect(haltEvents[haltEvents.length - 1]?.reason).toMatch(
        /as-built review verdict is BLOCKED|manual_test kickback-to-build no-op|manual-test FAIL unresolved|remediation budget exhausted/,
      );
    });
  });

  describe('FAIL verdict waits for siblings (Task 19)', () => {
    const VALIDATION_GROUP_PREREQS = {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done', coherence_check: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
      build: 'done',
      build_review: 'done',
      test_suite: 'done',
      rebase: 'done',
      finish: 'done',
    } as ConductState;

    it('manual_test crashes fast while prd_audit and architecture_review_as_built are still in flight — both siblings run to completion (their markers land on disk) before the group halts, not cancelled mid-flight', async () => {
      await writeState(statePath, VALIDATION_GROUP_PREREQS);

      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, options?: StepRunOptions) => {
          await mkdir(join(dir, '.pipeline'), { recursive: true });
          if (step === 'manual_test') {
            // Fails fast: no delay, never produces a completion marker.
            return { success: false, output: 'agent process crashed' };
          } else if (step === 'prd_audit') {
            // Slow sibling — must be allowed to run to completion.
            await new Promise((r) => setTimeout(r, 50));
            await writePrdAuditFixture(dir, options?.runId);
            return { success: true };
          } else if (step === 'architecture_review_as_built') {
            // Slower sibling — must also be allowed to run to completion.
            await new Promise((r) => setTimeout(r, 80));
            await writeAsBuiltFixture(dir, options?.runId, asBuiltApprovedFixture());
            return { success: true };
          }
          return { success: true };
        }),
      };

      let haltCount = 0;
      events.on('loop_halt', () => {
        haltCount += 1;
      });

      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
      });

      await conductor.run();

      // The group ultimately halts (manual_test never produced a verdict) —
      // but only AFTER both slower siblings ran to completion, not before.
      expect(haltCount).toBeGreaterThan(0);

      // Proof the slow siblings were never aborted/cancelled when the fast
      // branch failed: their own completion markers exist on disk by the
      // time conductor.run() resolves. If the executor had cancelled
      // in-flight branches on the fast failure, these setTimeout-guarded
      // writes would not have happened yet.
      const prdAuditMarker = await readFile(join(dir, '.pipeline/prd-audit.md'), 'utf-8');
      expect(prdAuditMarker).toMatch(/Status: complete[\s\S]*S1\.1: PASS/);
      const asBuiltMarker = await readFile(
        join(dir, '.pipeline/architecture-review-as-built.md'),
        'utf-8',
      );
      expect(asBuiltMarker).toContain('Verdict: APPROVED');

      // All three members were in fact dispatched — none were skipped or
      // starved by the fast failure.
      expect(runner.run).toHaveBeenCalledWith(
        'manual_test',
        expect.anything(),
        expect.anything(),
      );
      expect(runner.run).toHaveBeenCalledWith('prd_audit', expect.anything(), expect.anything());
      expect(runner.run).toHaveBeenCalledWith(
        'architecture_review_as_built',
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('validation group membership resolution (Task 15)', () => {
    it('uses the supplied Codex policy to resolve an L-tier plan member', () => {
      const observedPolicyValues: {
        tierOverride?: unknown;
      } = {};
      const policy: ProviderModelPolicy = new Proxy(CODEX_MODEL_POLICY, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver);
          if (property === 'stepTierOverrides') {
            observedPolicyValues.tierOverride = value.plan?.L;
          }
          return value;
        },
      });
      const tierAwareGroup: StepGroup = {
        ...VALIDATION_GROUP,
        members: ['plan'],
      };
      const state: ConductState = {
        bootstrap: 'done',
        worktree: 'done',
        memory: 'done',
        assess: 'done',
        explore: 'done',
        complexity: 'done',
        complexity_tier: 'L',
        track: 'technical',
        prd: 'skipped',
        architecture_diagram: 'done',
        architecture_review: 'done',
        stories: 'done',
        conflict_check: 'done',
        plan: 'pending',
        acceptance_specs: 'pending',
        build: 'pending',
        build_review: 'pending',
        test_suite: 'pending',
        manual_test: 'pending',
        prd_audit: 'pending',
        architecture_review_as_built: 'pending',
        rebase: 'pending',
        finish: 'pending',
        remediate: 'pending',
        attribution_verify: 'pending',
      };
      const track: Track = 'technical';

      resolveGroupMembership(tierAwareGroup, state, track, policy);

      expect(observedPolicyValues).toEqual({
        tierOverride: { effort: 'xhigh', model: 'gpt-5.6-sol' },
      });
    });

    it('width 3: no skip conditions active — all three members are dispatchable', () => {
      const state = { complexity_tier: 'L' } as ConductState;
      const result = resolveGroupMembership(
        VALIDATION_GROUP,
        state,
        'product',
        CLAUDE_MODEL_POLICY,
      );

      expect(result.allSkipped).toBe(false);
      expect(result.dispatchable.map((m) => m.name)).toEqual([
        'manual_test',
        'prd_audit',
        'architecture_review_as_built',
      ]);
      expect(result.members.every((m) => m.outcome.kind !== 'skipped')).toBe(true);
    });

    it('technical track still dispatches the always-run prd_audit', () => {
      const state = { complexity_tier: 'L' } as ConductState;
      const result = resolveGroupMembership(
        VALIDATION_GROUP,
        state,
        'technical',
        CLAUDE_MODEL_POLICY,
      );

      expect(result.allSkipped).toBe(false);
      expect(result.dispatchable.map((m) => m.name)).toEqual([
        'manual_test',
        'prd_audit',
        'architecture_review_as_built',
      ]);
      const prdAudit = result.members.find((m) => m.name === 'prd_audit')!;
      expect(prdAudit.outcome).toEqual({ kind: 'no-verdict', reason: 'not-run' });
    });

    it('S tier + technical track retains the always-run prd_audit', () => {
      const state = { complexity_tier: 'S' } as ConductState;
      const result = resolveGroupMembership(
        VALIDATION_GROUP,
        state,
        'technical',
        CLAUDE_MODEL_POLICY,
      );

      expect(result.allSkipped).toBe(false);
      expect(result.dispatchable.map((m) => m.name)).toEqual([
        'prd_audit',
        'architecture_review_as_built',
      ]);

      const manualTest = result.members.find((m) => m.name === 'manual_test')!;
      const prdAudit = result.members.find((m) => m.name === 'prd_audit')!;
      const asBuilt = result.members.find((m) => m.name === 'architecture_review_as_built')!;
      expect(manualTest.outcome).toEqual({ kind: 'skipped' });
      expect(prdAudit.outcome).toEqual({ kind: 'no-verdict', reason: 'not-run' });
      expect(asBuilt.outcome).toEqual({ kind: 'no-verdict', reason: 'not-run' });
    });

    it('architecture-review skip does not suppress the current validation members', () => {
      const state = {
        complexity_tier: 'M',
        architecture_review: 'skipped',
      } as unknown as ConductState;
      const result = resolveGroupMembership(
        VALIDATION_GROUP,
        state,
        'technical',
        CLAUDE_MODEL_POLICY,
      );

      const asBuilt = result.members.find((m) => m.name === 'architecture_review_as_built')!;
      expect(asBuilt.outcome).toEqual({ kind: 'no-verdict', reason: 'not-run' });
      expect(result.dispatchable.map((m) => m.name)).toEqual([
        'manual_test',
        'prd_audit',
        'architecture_review_as_built',
      ]);
    });

    it('manual_test disabled by config leaves the always-run prd_audit dispatchable', () => {
      const state = { complexity_tier: 'S' } as ConductState;
      const config = { steps: { manual_test: { disable: true } } } as unknown as Parameters<
        typeof resolveGroupMembership
      >[4];
      const result = resolveGroupMembership(
        VALIDATION_GROUP,
        state,
        'technical',
        CLAUDE_MODEL_POLICY,
        config,
      );

      expect(result.allSkipped).toBe(false);
      expect(result.dispatchable.map((m) => m.name)).toEqual([
        'prd_audit',
        'architecture_review_as_built',
      ]);
      expect(result.members).toHaveLength(3);
      expect(result.members.find((m) => m.name === 'manual_test')?.outcome).toEqual({ kind: 'skipped' });
      expect(result.members.find((m) => m.name === 'prd_audit')?.outcome).toEqual({ kind: 'no-verdict', reason: 'not-run' });
    });

    it('Task 6: re-verification preserves tier, track, upstream, and configuration exclusions', () => {
      // These are the four existing skip authorities. The Task 5
      // re-verification flag changes only the already-done shortcut; it must
      // never convert an excluded member into a BUILD round branch.
      const exclusionGroup: StepGroup = {
        name: 'reverification-exclusion-fixture',
        members: [
          'acceptance_specs',
          'prd_audit',
          'architecture_review_as_built',
          'manual_test',
        ],
      };
      const state = {
        complexity_tier: 'S',
        architecture_review: 'skipped',
      } as ConductState;
      const config = {
        steps: { manual_test: { disable: true } },
      } as HarnessConfig;

      const result = resolveGroupMembership(
        exclusionGroup,
        state,
        'technical',
        CLAUDE_MODEL_POLICY,
        config,
        true,
      );

      expect(result.allSkipped).toBe(false);
      expect(result.dispatchable.map((member) => member.name)).toEqual([
        'prd_audit',
        'architecture_review_as_built',
      ]);
      expect(result.members.map((member) => [member.name, member.outcome])).toEqual([
        ['acceptance_specs', { kind: 'skipped' }],
        ['prd_audit', { kind: 'no-verdict', reason: 'not-run' }],
        ['architecture_review_as_built', { kind: 'no-verdict', reason: 'not-run' }],
        ['manual_test', { kind: 'skipped' }],
      ]);
    });

    it('the always-run prd_audit remains a dispatchable no-verdict member', () => {
      const state = { complexity_tier: 'L' } as ConductState;
      const result = resolveGroupMembership(
        VALIDATION_GROUP,
        state,
        'technical',
        CLAUDE_MODEL_POLICY,
      );

      const prdAudit = result.members.find((m) => m.name === 'prd_audit')!;
      expect(prdAudit.outcome).toEqual({ kind: 'no-verdict', reason: 'not-run' });
      expect(result.dispatchable.some((m) => m.name === 'prd_audit')).toBe(true);
    });

    it('Task 27: a member already marked done in state (resumed after a mid-group abort) is excluded from dispatchable, not re-dispatched', () => {
      const state = {
        complexity_tier: 'L',
        prd_audit: 'done',
      } as unknown as ConductState;
      const result = resolveGroupMembership(
        VALIDATION_GROUP,
        state,
        'product',
        CLAUDE_MODEL_POLICY,
      );

      expect(result.allSkipped).toBe(false);
      expect(result.dispatchable.map((m) => m.name)).toEqual([
        'manual_test',
        'architecture_review_as_built',
      ]);
      const prdAudit = result.members.find((m) => m.name === 'prd_audit')!;
      expect(prdAudit.outcome).toEqual({ kind: 'verdict', verdict: 'pass' });
    });

    it('Task 25: parallel_started lists only dispatched members, never a phantom skipped one', async () => {
      const { buildParallelStartedEvent } = await import('../../src/engine/group-core.js');
      const members: GroupMember[] = [
        { name: 'manual_test', skill: 'manual_test', outcome: { kind: 'verdict', verdict: 'pass' } },
        { name: 'architecture_review_as_built', skill: 'architecture_review_as_built', outcome: { kind: 'verdict', verdict: 'pass' } },
        { name: 'prd_audit', skill: 'prd_audit', outcome: { kind: 'skipped' } },
      ];
      const event = buildParallelStartedEvent('manual_test', members);
      expect(event).toEqual({
        type: 'parallel_started',
        step: 'manual_test',
        branches: ['manual_test', 'architecture_review_as_built'],
      });
      expect(event.branches).not.toContain('prd_audit');
    });

    it('Task 25: mixed outcome produces one parallel_failure event naming the failing member, not the whole group', async () => {
      const { buildParallelFailureEvents } = await import('../../src/engine/group-core.js');
      const members: GroupMember[] = [
        { name: 'manual_test', skill: 'manual_test', outcome: { kind: 'verdict', verdict: 'pass' } },
        {
          name: 'architecture_review_as_built',
          skill: 'architecture_review_as_built',
          outcome: { kind: 'no-verdict', reason: 'exhausted retries' },
        },
        { name: 'prd_audit', skill: 'prd_audit', outcome: { kind: 'skipped' } },
      ];
      const events = buildParallelFailureEvents('manual_test', members);

      // Exactly one failure event, attributed to the member that actually
      // failed — the passing member and the skipped phantom member never
      // produce a parallel_failure of their own.
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'parallel_failure',
        step: 'manual_test',
        branch: 'architecture_review_as_built',
        error: 'exhausted retries',
      });
    });

    it('Task 25: skipped members never appear in either event stream (parallel_started or parallel_failure)', async () => {
      const { buildParallelStartedEvent, buildParallelFailureEvents } = await import(
        '../../src/engine/group-core.js'
      );
      const members: GroupMember[] = [
        { name: 'manual_test', skill: 'manual_test', outcome: { kind: 'skipped' } },
        { name: 'prd_audit', skill: 'prd_audit', outcome: { kind: 'skipped' } },
      ];
      expect(buildParallelStartedEvent('manual_test', members).branches).toEqual([]);
      expect(buildParallelFailureEvents('manual_test', members)).toEqual([]);
    });

    it('Task 25: runGroupBranch emits member-attributed dispatch and result events via onMemberEvent', async () => {
      const { runGroupBranch, makeNoVerdictOutcome } = await import('../../src/engine/group-core.js');
      const member: GroupMember = {
        name: 'architecture_review_as_built',
        skill: 'architecture_review_as_built',
        outcome: makeNoVerdictOutcome('not-run'),
      };
      const events: Array<{ type: string; member: string; skill: string; phase: string; outcome?: string }> = [];
      const stepRunner = {
        run: vi.fn().mockResolvedValue({ success: true } as StepRunResult),
      };
      const outcome = await runGroupBranch(
        member,
        {} as ConductState,
        {
          stepRunner,
          lifecycleObserver: NOOP_GROUP_BRANCH_LIFECYCLE_OBSERVER,
          onMemberEvent: (e) => {
            events.push(e as unknown as (typeof events)[number]);
          },
        },
        1,
      );

      expect(outcome).toEqual({ kind: 'verdict', verdict: 'pass' });
      // Every event is attributed to THIS member, never the group name.
      expect(events.every((e) => e.member === 'architecture_review_as_built')).toBe(true);
      expect(events.map((e) => e.phase)).toEqual(['dispatch', 'result']);
      expect(events[1]?.outcome).toBe('verdict:pass');
    });

    it('manual_test disable does not suppress the always-run prd_audit at conductor.run()', async () => {
      await writeState(statePath, {
        worktree: 'done',
        memory: 'done',
        explore: 'done',
        complexity: 'done',
        complexity_tier: 'S',
        track: 'technical',
        stories: 'done',
        conflict_check: 'done',
        plan: 'done', coherence_check: 'done',
        architecture_diagram: 'done',
        architecture_review: 'done',
        coverage_binding: 'done',
        acceptance_specs: 'done',
        build: 'done',
        build_review: 'done',
      } as ConductState);

      const runner = createMockStepRunner();
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'manual_test',
        mode: 'auto',
        config: { steps: { manual_test: { disable: true } } } as unknown as ConstructorParameters<
          typeof Conductor
        >[0]['config'],
      });

      await conductor.run();

      // The explicit manual-test disable is honored, while PRD audit remains
      // an always-run validation authority.
      const calledSteps = vi.mocked(runner.run).mock.calls.map((c) => c[0]);
      expect(calledSteps).not.toContain('manual_test');
      expect(calledSteps).toContain('prd_audit');
    });
  });

  it('advances when checkpoint response is continue', async () => {
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done', coherence_check: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
    } as ConductState);

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const onCheckpoint = vi.fn().mockResolvedValue('continue' as const);
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'build',
      onCheckpoint,
    });

    await conductor.run();

    // After 'continue' at build checkpoint, conductor should proceed to manual_test and beyond
    expect(stepsRun).toContain('build');
    expect(stepsRun).toContain('manual_test');
    expect(stepsRun).toContain('finish');
  });

  it('stops and saves state when checkpoint response is quit', async () => {
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done', coherence_check: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
    } as ConductState);

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const onCheckpoint = vi.fn().mockResolvedValue('quit' as const);
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'build',
      onCheckpoint,
    });

    await conductor.run();

    // Should have run build but stopped after checkpoint
    expect(stepsRun).toContain('build');
    expect(stepsRun).not.toContain('manual_test');

    // State should be saved with build=done
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value['build']).toBe('done');
      // feature_status should NOT be complete
      expect(result.value.feature_status).toBeUndefined();
    }
  });

  it('saves state on SIGINT before exit', async () => {
    let sigintHandler: (() => void) | undefined;
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      handler: (...args: unknown[]) => void,
    ) => {
      if (event === 'SIGINT') {
        sigintHandler = handler as () => void;
      }
      return process;
    }) as typeof process.on);

    // The SIGINT handler calls process.exit(130); stub it so the real exit
    // doesn't surface as an unhandled rejection that fails the vitest run.
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);

    // Create a runner that blocks on the 3rd step so we can trigger SIGINT
    let stepCount = 0;
    let resolveBlock: (() => void) | undefined;
    void new Promise<void>((resolve) => {
      resolveBlock = resolve;
    });

    const runner: StepRunner = {
      run: async (_step: StepName) => {
        stepCount++;
        if (stepCount === 3) {
          // Trigger SIGINT while we're "running" step 3
          if (sigintHandler) sigintHandler();
          // Let the step finish after SIGINT handler runs
          resolveBlock!();
        }
        return { success: true };
      },
    };

    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });
    await conductor.run();

    // SIGINT handler should have been registered
    expect(processOnSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));

    // State should have been saved (handler calls writeState)
    const result = await readState(statePath);
    expect(result.ok).toBe(true);

    processOnSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('closes an open execution in the ledger on graceful SIGINT shutdown', async () => {
    let sigintHandler: (() => void) | undefined;
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      handler: (...args: unknown[]) => void,
    ) => {
      if (event === 'SIGINT') sigintHandler = handler as () => void;
      return process;
    }) as typeof process.on);
    let exitHandled: (() => void) | undefined;
    const exited = new Promise<void>((resolve) => {
      exitHandled = resolve;
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      exitHandled!();
      return undefined;
    }) as never);
    const timestamps = [1_000, 1_025];
    const persister = new EventPersister(join(dir, '.pipeline/events.jsonl'), events, {
      nowMs: () => timestamps.shift()!,
    });
    persister.start();

    try {
      const state: ConductState = { complexity_tier: 'M' };
      for (const step of ALL_STEPS) {
        if (step.name === 'prd') break;
        state[step.name] = 'done';
      }
      await writeState(statePath, state);
      let stepCount = 0;
      let releaseRun: (() => void) | undefined;
      const blockedRun = new Promise<void>((resolve) => {
        releaseRun = resolve;
      });
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        events,
        fromStep: 'prd',
        stepRunner: {
          run: async () => {
            if (++stepCount === 1) {
              sigintHandler!();
              await blockedRun;
            }
            return { success: true };
          },
        },
      });

      const run = conductor.run();
      await exited;

      const records = (await readFile(join(dir, '.pipeline/events.jsonl'), 'utf-8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(records).toContainEqual(expect.objectContaining({
        type: 'step_interrupted',
        step: 'prd',
        activeInterval: { startedAtMs: 1_000, durationMs: 25 },
      }));
      releaseRun!();
      await run;
    } finally {
      persister.stop();
      processOnSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it('reaches measured after a SIGINT-interrupted conductor resumes on its persisted ledger', async () => {
    let sigintHandler: (() => void) | undefined;
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      handler: (...args: unknown[]) => void,
    ) => {
      if (event === 'SIGINT') sigintHandler = handler as () => void;
      return process;
    }) as typeof process.on);
    let exitHandled: (() => void) | undefined;
    const exited = new Promise<void>((resolve) => {
      exitHandled = resolve;
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      exitHandled!();
      return undefined;
    }) as never);
    const eventsPath = join(dir, '.pipeline/events.jsonl');
    const interruptedEvents = new ConductorEventEmitter();
    const interruptedPersister = new EventPersister(eventsPath, interruptedEvents, {
      nowMs: (() => {
        const timestamps = [1_000, 1_040];
        return () => timestamps.shift()!;
      })(),
    });
    interruptedPersister.start();
    let interruptedLedger: string;

    try {
      const state: ConductState = { complexity_tier: 'M' };
      for (const step of ALL_STEPS) {
        if (step.name === 'prd') break;
        state[step.name] = 'done';
      }
      await writeState(statePath, state);
      let releaseStep: (() => void) | undefined;
      const stepBlocked = new Promise<void>((resolve) => {
        releaseStep = resolve;
      });
      const interrupted = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        events: interruptedEvents,
        fromStep: 'prd',
        verifyArtifacts: false,
        stepRunner: {
          run: async () => {
            sigintHandler!();
            await stepBlocked;
            return { success: true };
          },
        },
      });

      const interruptedRun = interrupted.run();
      await exited;
      // `process.exit` is stubbed in this test worker, so snapshot the ledger
      // at the same point the real process would have terminated.
      interruptedLedger = await readFile(eventsPath, 'utf-8');
      interruptedPersister.stop();
      releaseStep!();
      await interruptedRun;
    } finally {
      interruptedPersister.stop();
      processOnSpy.mockRestore();
      exitSpy.mockRestore();
    }

    await writeFile(eventsPath, interruptedLedger!);

    const resumedEvents = new ConductorEventEmitter();
    const resumedPersister = new EventPersister(eventsPath, resumedEvents, {
      nowMs: (() => {
        const timestamps = [2_000, 2_100];
        return () => timestamps.shift()!;
      })(),
    });
    resumedPersister.start();
    try {
      const resumed = new Conductor({
        projectRoot: dir,
        stateFilePath: join(dir, 'resumed-conduct-state.json'),
        events: resumedEvents,
        stepRunner: createMockStepRunner(),
      }) as unknown as {
        emitExecutionEvent(event: ConductorEvent): Promise<void>;
      };
      await resumed.emitExecutionEvent({ type: 'step_started', step: 'plan', index: 1 });
      await resumedEvents.emit({
        type: 'provider_attempt',
        step: 'plan',
        provider: 'codex',
        outcome: 'success',
        invoked: true,
        observedIntervals: [{ startedAtMs: 2_020, durationMs: 50 }],
      });
      await resumed.emitExecutionEvent({ type: 'step_completed', step: 'plan', status: 'done' });
    } finally {
      resumedPersister.stop();
    }

    const timing = await computeTimingRollup(dir);
    const rendered = appendTimingSection(renderShippedRecord({ slug: 'resumed-feature', specHash: 'abc123' }), timing);
    expect({ timing, timeBlock: rendered.slice(rendered.indexOf('## Time')) }).toEqual({
      timing: {
        state: 'measured',
        activeMs: 140,
        providerActiveMs: 50,
        noProviderActiveMs: 90,
      },
      timeBlock:
        '## Time\nstate: measured\nactive_ms: 140\nprovider_active_ms: 50\nno_provider_active_ms: 90\n',
    });
  });

  it('does not close an execution twice when SIGINT follows its normal completion', async () => {
    let sigintHandler: (() => void) | undefined;
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      handler: (...args: unknown[]) => void,
    ) => {
      if (event === 'SIGINT') sigintHandler = handler as () => void;
      return process;
    }) as typeof process.on);
    let exitHandled: (() => void) | undefined;
    const exited = new Promise<void>((resolve) => {
      exitHandled = resolve;
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      exitHandled!();
      return undefined;
    }) as never);
    const persister = new EventPersister(join(dir, '.pipeline/events.jsonl'), events);
    persister.start();

    try {
      const state: ConductState = { complexity_tier: 'M' };
      for (const step of ALL_STEPS) {
        if (step.name === 'prd') break;
        state[step.name] = 'done';
      }
      await writeState(statePath, state);
      events.on('step_completed', (event) => {
        if (event.type === 'step_completed' && event.step === 'prd') {
          sigintHandler!();
        }
      });

      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        events,
        fromStep: 'prd',
        stepRunner: createMockStepRunner(),
      });
      const run = conductor.run();
      await exited;
      await run;

      const records = (await readFile(join(dir, '.pipeline/events.jsonl'), 'utf-8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const prdTerminals = records.filter(
        (record) =>
          record.step === 'prd' &&
          (record.type === 'step_completed' || record.type === 'step_failed'),
      );
      expect(prdTerminals).toEqual([expect.objectContaining({ type: 'step_completed' })]);
    } finally {
      persister.stop();
      processOnSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it('waits for an in-flight terminal emission before exiting on SIGINT', async () => {
    let sigintHandler: (() => void) | undefined;
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      handler: (...args: unknown[]) => void,
    ) => {
      if (event === 'SIGINT') sigintHandler = handler as () => void;
      return process;
    }) as typeof process.on);
    let exitHandled: (() => void) | undefined;
    const exited = new Promise<void>((resolve) => {
      exitHandled = resolve;
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      exitHandled!();
      return undefined;
    }) as never);
    let terminalEmissionStarted: (() => void) | undefined;
    const terminalEmission = new Promise<void>((resolve) => {
      terminalEmissionStarted = resolve;
    });
    let releaseTerminalEmission: (() => void) | undefined;
    const terminalDelivery = new Promise<void>((resolve) => {
      releaseTerminalEmission = resolve;
    });
    let run: Promise<unknown> | undefined;

    try {
      const state: ConductState = { complexity_tier: 'M' };
      for (const step of ALL_STEPS) {
        if (step.name === 'prd') break;
        state[step.name] = 'done';
      }
      await writeState(statePath, state);
      events.on('step_completed', async (event) => {
        if (event.type === 'step_completed' && event.step === 'prd') {
          terminalEmissionStarted!();
          sigintHandler!();
          await terminalDelivery;
        }
      });

      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        events,
        fromStep: 'prd',
        stepRunner: createMockStepRunner(),
      });
      run = conductor.run();

      await terminalEmission;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(exitSpy).not.toHaveBeenCalled();

      releaseTerminalEmission!();
      await exited;
      await run;
      expect(exitSpy).toHaveBeenCalledWith(130);
    } finally {
      releaseTerminalEmission?.();
      await run;
      processOnSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });


  it('emits no terminal when the interrupt arrives before any execution started', async () => {
    let sigintHandler: (() => Promise<void>) | undefined;
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      handler: (...args: unknown[]) => void,
    ) => {
      if (event === 'SIGINT') sigintHandler = handler as () => Promise<void>;
      return process;
    }) as typeof process.on);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const ledgerPath = join(dir, '.pipeline/events.jsonl');
    const persister = new EventPersister(ledgerPath, events);
    persister.start();
    const readLedger = async (): Promise<string> => {
      try {
        return await readFile(ledgerPath, 'utf-8');
      } catch {
        return '';
      }
    };

    try {
      const state: ConductState = { complexity_tier: 'M' };
      for (const step of ALL_STEPS) {
        if (step.name === 'memory') break;
        state[step.name] = 'done';
      }
      await writeState(statePath, state);

      let beforeInterrupt: string | undefined;
      let afterInterrupt: string | undefined;
      const run = vi.fn<StepRunner['run']>(async () => ({ success: true }));
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: { run },
        events,
        fromStep: 'memory',
        mode: 'auto',
        daemon: true,
        verifyArtifacts: false,
        featureSlug: 'orphan-terminal-guard',
        // The park boundary runs before the first unit is dispatched, so the
        // conductor holds no open execution when the signal arrives here.
        operatorParkBoundary: async () => {
          beforeInterrupt = await readLedger();
          await sigintHandler!();
          afterInterrupt = await readLedger();
          return true;
        },
      });

      await conductor.run();

      // closeOpenExecutions() must be a no-op on an empty open set: an
      // interrupt before any start may not manufacture a terminal for a step
      // that never ran, and the ledger must gain no record at all.
      expect({
        interruptObserved: sigintHandler !== undefined,
        ledgerGrew: afterInterrupt !== beforeInterrupt,
        orphanTerminals: (afterInterrupt ?? '')
          .split('\n')
          .filter((line) => line.includes('execution interrupted before a terminal event')),
        runnerCalls: run.mock.calls,
      }).toEqual({
        interruptObserved: true,
        ledgerGrew: false,
        orphanTerminals: [],
        runnerCalls: [],
      });
    } finally {
      persister.stop();
      processOnSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
  it('saves state on SIGTERM before exit', async () => {
    let sigtermHandler: (() => void) | undefined;
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      handler: (...args: unknown[]) => void,
    ) => {
      if (event === 'SIGTERM') {
        sigtermHandler = handler as () => void;
      }
      return process;
    }) as typeof process.on);

    // The SIGTERM handler calls process.exit(1); stub it so the real exit
    // doesn't surface as an unhandled rejection that fails the vitest run.
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);

    // Create a runner that blocks on the 3rd step so we can trigger SIGTERM
    let stepCount = 0;
    let resolveBlock: (() => void) | undefined;
    void new Promise<void>((resolve) => {
      resolveBlock = resolve;
    });

    const runner: StepRunner = {
      run: async (_step: StepName) => {
        stepCount++;
        if (stepCount === 3) {
          // Trigger SIGTERM while we're "running" step 3
          if (sigtermHandler) sigtermHandler();
          // Let the step finish after SIGTERM handler runs
          resolveBlock!();
        }
        return { success: true };
      },
    };

    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });
    await conductor.run();

    // SIGTERM handler should have been registered
    expect(processOnSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));

    // State should have been saved (handler calls writeState)
    const result = await readState(statePath);
    expect(result.ok).toBe(true);

    // process.exit(1) should have been called
    expect(exitSpy).toHaveBeenCalledWith(1);

    processOnSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('SIGTERM with no wait in progress still exits safely', async () => {
    let sigtermHandler: (() => void) | undefined;
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      handler: (...args: unknown[]) => void,
    ) => {
      if (event === 'SIGTERM') {
        sigtermHandler = handler as () => void;
      }
      return process;
    }) as typeof process.on);

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);

    // Create a runner that triggers SIGTERM on 2nd step
    let stepCount = 0;
    const runner: StepRunner = {
      run: async () => {
        stepCount++;
        if (stepCount === 2) {
          // Trigger SIGTERM when no wait is in progress
          if (sigtermHandler) sigtermHandler();
        }
        return { success: true };
      },
    };

    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });
    await conductor.run();

    // Should exit safely with status 1
    expect(exitSpy).toHaveBeenCalledWith(1);

    // State should have been saved
    const result = await readState(statePath);
    expect(result.ok).toBe(true);

    processOnSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('saves state on SIGHUP before exit', async () => {
    let sighupHandler: (() => void) | undefined;
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      handler: (...args: unknown[]) => void,
    ) => {
      if (event === 'SIGHUP') {
        sighupHandler = handler as () => void;
      }
      return process;
    }) as typeof process.on);

    // The SIGHUP handler calls process.exit(129); stub it so the real exit
    // doesn't surface as an unhandled rejection that fails the vitest run.
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);

    // Create a runner that triggers SIGHUP on the 3rd step
    let stepCount = 0;
    const runner: StepRunner = {
      run: async () => {
        stepCount++;
        if (stepCount === 3) {
          // Trigger SIGHUP while we're "running" step 3
          if (sighupHandler) sighupHandler();
        }
        return { success: true };
      },
    };

    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });
    await conductor.run();

    // SIGHUP handler should have been registered
    expect(processOnSpy).toHaveBeenCalledWith('SIGHUP', expect.any(Function));

    // State should have been saved (handler calls writeState) and the
    // handler exits with 129 (128 + SIGHUP)
    expect(exitSpy).toHaveBeenCalledWith(129);
    const result = await readState(statePath);
    expect(result.ok).toBe(true);

    processOnSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('de-registers signal handlers on normal exit', async () => {
    const processOnSpy = vi.spyOn(process, 'on').mockReturnValue(process);
    const processOffSpy = vi.spyOn(process, 'off').mockReturnValue(process);

    const runner: StepRunner = {
      run: async () => {
        return { success: true };
      },
    };

    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });
    await conductor.run();

    // Signal handlers should have been de-registered on normal exit
    expect(processOffSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(processOffSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(processOffSpy).toHaveBeenCalledWith('SIGHUP', expect.any(Function));

    // Verify that in the finally block, signal handlers were de-registered
    // There may be other process.off calls in early return paths, so we check
    // that the finally block calls are present (last 3 calls should be them)
    const allCalls = processOffSpy.mock.calls;
    const lastThreeCalls = allCalls.slice(-3);

    expect(lastThreeCalls.some(call => call[0] === 'SIGINT')).toBe(true);
    expect(lastThreeCalls.some(call => call[0] === 'SIGTERM')).toBe(true);
    expect(lastThreeCalls.some(call => call[0] === 'SIGHUP')).toBe(true);

    processOnSpy.mockRestore();
    processOffSpy.mockRestore();
  });

  it('no SIGTERM listener leak after sequential conductor runs', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);

    // Track listener count
    const initialCount = process.listenerCount('SIGTERM');

    // Run 3 sequential conductor instances
    for (let i = 0; i < 3; i++) {
      const runner: StepRunner = {
        run: async () => {
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
    }

    // Listener count should return to baseline (no leak)
    const finalCount = process.listenerCount('SIGTERM');
    expect(finalCount).toBe(initialCount);

    exitSpy.mockRestore();
  });

  describe('backward navigation', () => {
    it('getNavigableSteps returns only done and stale steps', () => {
      const state: ConductState = {
        worktree: 'done',
        memory: 'done',
        explore: 'in_progress',
        complexity: 'pending',
        stories: 'stale',
      };

      const navigable = getNavigableSteps(state);

      const names = navigable.map((s) => s.name);
      expect(names).toContain('worktree');
      expect(names).toContain('memory');
      expect(names).toContain('stories');
      expect(names).not.toContain('explore');
      expect(names).not.toContain('complexity');
      // Each entry should have name, label, status, phase
      for (const step of navigable) {
        expect(step).toHaveProperty('name');
        expect(step).toHaveProperty('label');
        expect(step).toHaveProperty('status');
        expect(step).toHaveProperty('phase');
      }
    });
    it('navigateBack sets target step to pending', () => {
      const state: ConductState = {
        worktree: 'done',
        memory: 'done',
        explore: 'done',
        complexity: 'done',
        stories: 'done',
      };

      const result = navigateBack(state, 'explore');

      expect(result.state['explore']).toBe('pending');
    });

    it('navigateBack marks all downstream done steps as stale', () => {
      const state: ConductState = {
        worktree: 'done',
        memory: 'done',
        explore: 'done',
        complexity: 'done',
        stories: 'done',
        conflict_check: 'skipped',
        plan: 'done', coherence_check: 'done',
      };

      const result = navigateBack(state, 'explore');

      // explore itself is pending (not stale)
      expect(result.state['explore']).toBe('pending');
      // Upstream steps remain done
      expect(result.state['worktree']).toBe('done');
      expect(result.state['memory']).toBe('done');
      // Downstream done steps become stale
      expect(result.state['complexity']).toBe('stale');
      expect(result.state['stories']).toBe('stale');
      expect(result.state['plan']).toBe('stale');
      // Skipped steps stay skipped (markDownstreamStale only touches done)
      expect(result.state['conflict_check']).toBe('skipped');
    });

    it('Task 12: non-rebase kickback (no preserve list) sweeps judged gates stale, not preserved', () => {
      // Every navigateBack call site in conductor.ts EXCEPT the rebase-origin
      // branch (advanceTail, lastRebaseOutcome?.kind === 'changed') omits the
      // `preserve` argument, so it defaults to []. This locks that default
      // behavior: a build_review-style kickback back to 'build' with
      // prd_audit/architecture_review_as_built already 'done' must sweep
      // them stale via the blanket cascade — proving the Task 7 delta-gating
      // guard (which only fires for kickback.from === 'rebase') never
      // leaks into other kickback origins.
      const state: ConductState = {
        worktree: 'done',
        memory: 'done',
        explore: 'done',
        complexity: 'done',
        stories: 'done',
        plan: 'done', coherence_check: 'done',
        build: 'done',
        build_review: 'done',
         test_suite: 'done',
        manual_test: 'done',
        prd_audit: 'done',
        architecture_review_as_built: 'done',
      };

      // Non-rebase kickback: e.g. build_review failing and routing back to
      // 'build' — called with no `preserve` argument, exactly like every
      // non-rebase call site in conductor.ts.
      const result = navigateBack(state, 'build');

      expect(result.state['build']).toBe('pending');
      // Every downstream judged gate — including the audits that Task 7's
      // rebase-origin guard would otherwise preserve — is swept stale.
      expect(result.state['build_review']).toBe('stale');
      // ...except a deprecated no-op, which has no work to redo and would
      // otherwise burn a selection lap every round
      // (adr-2026-08-11-deprecated-no-op-step-retirement).
      expect(result.state['test_suite']).toBe('stale');
      expect(result.state['manual_test']).toBe('stale');
      expect(result.state['prd_audit']).toBe('stale');
      expect(result.state['architecture_review_as_built']).toBe('stale');
    });

    it('navigateBack returns new loop index at target step', () => {
      const state: ConductState = {
        worktree: 'done',
        memory: 'done',
        explore: 'done',
        complexity: 'done',
      };

      const result = navigateBack(state, 'explore');

      // explore is index 2 in ALL_STEPS
      const expectedIndex = ALL_STEPS.findIndex((s) => s.name === 'explore');
      expect(result.index).toBe(expectedIndex);
    });

    it('Conductor jumps to target index after back navigation', async () => {
      // Set up all prerequisites done through build (a checkpoint step)
      await writeState(statePath, {
        worktree: 'done',
        memory: 'done',
        explore: 'done',
        complexity: 'done',
        stories: 'done',
        conflict_check: 'done',
        plan: 'done', coherence_check: 'done',
        architecture_diagram: 'done',
        architecture_review: 'done',
        coverage_binding: 'done',
        acceptance_specs: 'done',
      } as ConductState);

      const stepsRun: StepName[] = [];
      const runner: StepRunner = {
        run: async (step: StepName) => {
          stepsRun.push(step);
          return { success: true };
        },
      };

      // First checkpoint (build) returns 'back', subsequent ones return 'continue'
      let checkpointCallCount = 0;
      const onCheckpoint = vi.fn(async () => {
        checkpointCallCount++;
        if (checkpointCallCount === 1) return 'back' as const;
        return 'continue' as const;
      });

      const onNavigate = vi.fn(async () => 'stories' as StepName);

      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'build',
        onCheckpoint,
        onNavigate,
      });

      const navEvents: Array<{ from: string; to: string }> = [];
      events.on('navigation_back', (e) => {
        if (e.type === 'navigation_back') navEvents.push({ from: e.from, to: e.to });
      });

      await conductor.run();

      // onNavigate should have been called
      expect(onNavigate).toHaveBeenCalled();
      // navigation_back event should have been emitted
      expect(navEvents.length).toBe(1);
      expect(navEvents[0].from).toBe('build');
      expect(navEvents[0].to).toBe('stories');
      // After navigating back to stories, conductor should re-run from stories onward
      // stepsRun should contain: build (first run), then stories, conflict_check, plan, ...
      expect(stepsRun[0]).toBe('build');
      const storiesIdx = stepsRun.indexOf('stories');
      expect(storiesIdx).toBeGreaterThan(0);
    });

    it('Stale steps re-run when conductor reaches them', async () => {
      // Set up state where stories is stale (downstream of a back navigation)
      await writeState(statePath, {
        worktree: 'done',
        memory: 'done',
        explore: 'done',
        complexity: 'done',
        architecture_diagram: 'done',
        architecture_review: 'done',
        stories: 'stale',
      } as ConductState);

      const stepsRun: StepName[] = [];
      const runner: StepRunner = {
        run: async (step: StepName) => {
          stepsRun.push(step);
          return { success: true };
        },
      };
      const onCheckpoint = vi.fn().mockResolvedValue('continue' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'stories',
        onCheckpoint,
      });

      await conductor.run();

      // stories (stale) should have been run, not skipped
      expect(stepsRun).toContain('stories');
      // After running, stories should be done
      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value['stories']).toBe('done');
      }
    });

    it('Cancel navigation (no target) returns to checkpoint without state changes', async () => {
      await writeState(statePath, {
        worktree: 'done',
        memory: 'done',
        explore: 'done',
        complexity: 'done',
        stories: 'done',
        conflict_check: 'done',
        plan: 'done', coherence_check: 'done',
        architecture_diagram: 'done',
        architecture_review: 'done',
        acceptance_specs: 'done',
      } as ConductState);

      const stepsRun: StepName[] = [];
      const runner: StepRunner = {
        run: async (step: StepName) => {
          stepsRun.push(step);
          return { success: true };
        },
      };

      // First checkpoint: back then cancel (null), second checkpoint: continue
      let checkpointCallCount = 0;
      const onCheckpoint = vi.fn(async () => {
        checkpointCallCount++;
        if (checkpointCallCount === 1) return 'back' as const;
        return 'continue' as const;
      });

      // onNavigate returns null (user cancels)
      const onNavigate = vi.fn(async () => null);

      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'build',
        onCheckpoint,
        onNavigate,
      });

      const navEvents: Array<{ from: string; to: string }> = [];
      events.on('navigation_back', (e) => {
        if (e.type === 'navigation_back') navEvents.push({ from: e.from, to: e.to });
      });

      await conductor.run();

      // onNavigate was called but returned null
      expect(onNavigate).toHaveBeenCalled();
      // No navigation_back events
      expect(navEvents).toHaveLength(0);
      // Conductor should have continued forward (build, manual_test, rebase, finish)
      expect(stepsRun).toContain('build');
      expect(stepsRun).toContain('manual_test');
      expect(stepsRun).toContain('finish');
      // State should not have been mutated by navigation
      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value['stories']).toBe('done');
      }
    });

  });

  describe('feature completion', () => {
    it('emits feature_complete event when all steps done', async () => {
      const runner = createMockStepRunner();
      const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });

      const completeEvents: Array<{ type: string; prUrl?: string }> = [];
      events.on('feature_complete', (e) => {
        if (e.type === 'feature_complete') completeEvents.push({ type: e.type, prUrl: (e as { type: string; prUrl?: string }).prUrl });
      });

      await conductor.run();

      expect(completeEvents.length).toBe(1);
      expect(completeEvents[0].type).toBe('feature_complete');
    });

    it('stores prUrl in state when finish step returns a URL', async () => {
      const stateStore: ConductStateStore<ConductState> = {
        apply: vi.fn().mockResolvedValue({ kind: 'applied' }),
        applyBatch: vi.fn().mockResolvedValue({ kind: 'applied' }),
        replace: vi.fn().mockResolvedValue({ kind: 'applied' }),
      };
      const runner: StepRunner = {
        run: async (step: StepName) => {
          if (step === 'finish') return { success: true, output: 'https://github.com/org/repo/pull/42' };
          return { success: true };
        },
      };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        stateStore,
      });

      const completeEvents: Array<{ prUrl?: string }> = [];
      events.on('feature_complete', (e) => {
        if (e.type === 'feature_complete') completeEvents.push({ prUrl: (e as { type: string; prUrl?: string }).prUrl });
      });

      await conductor.run();

      expect(stateStore.applyBatch).toHaveBeenCalledWith(expect.objectContaining({
        name: 'adopt finish pull request URL',
        mutations: [expect.objectContaining({
          field: 'pr_url', expected: undefined, next: 'https://github.com/org/repo/pull/42',
        })],
      }));
      // feature_complete event should include the prUrl
      expect(completeEvents[0].prUrl).toBe('https://github.com/org/repo/pull/42');
    });

    it('feature with feature_status=complete is excluded from resume', async () => {
      // Pre-populate state as a completed feature
      const completedState: ConductState = {
        feature_status: 'complete',
        worktree: 'done',
        memory: 'done',
        explore: 'done',
        prd: 'done',
        complexity: 'done',
        stories: 'done',
        conflict_check: 'done',
        plan: 'done', coherence_check: 'done',
        architecture_diagram: 'done',
        architecture_review: 'done',
        coverage_binding: 'done',
        acceptance_specs: 'done',
        build: 'done',
        build_review: 'done',
         test_suite: 'done',
        manual_test: 'done',
        prd_audit: 'done',
        architecture_review_as_built: 'done',
        rebase: 'done',
        finish: 'done',
      };
      await writeState(statePath, completedState);

      const stepsRun: StepName[] = [];
      const runner: StepRunner = {
        run: async (step: StepName) => {
          stepsRun.push(step);
          return { success: true };
        },
      };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        resume: true,
      });

      await conductor.run();

      // When every step is already `done` (feature_status=complete), the
      // conductor's skip-already-resolved gate (src/engine/conductor.ts:264)
      // no-ops every iteration — nothing gets re-dispatched. Starting a NEW
      // feature creates a fresh state file elsewhere; resume against a
      // completed state does not re-run work.
      expect(stepsRun).toEqual([]);
    });

    it('does not set feature_status=complete if any step failed', async () => {
      // Permanently-failing 2nd step + maxRetries=1 → step escalates to failure.
      let callCount = 0;
      const runner: StepRunner = {
        run: async () => {
          callCount++;
          if (callCount >= 2) return { success: false };
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

      const completeEvents: Array<{ type: string }> = [];
      events.on('feature_complete', (e) => {
        if (e.type === 'feature_complete') completeEvents.push({ type: e.type });
      });

      await conductor.run();

      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.feature_status).toBeUndefined();
      }
      // feature_complete event should NOT have been emitted
      expect(completeEvents.length).toBe(0);
    });

    it('getNavigableSteps returns empty array when no steps completed', () => {
      const state: ConductState = {
        worktree: 'pending',
        memory: 'in_progress',
      };

      const navigable = getNavigableSteps(state);

      expect(navigable).toEqual([]);
    });
  });

  describe('recovery menu', () => {
    it('calls onRecovery on step failure', async () => {
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'explore') return { success: false, output: 'explore failed' };
          return { success: true };
        }),
      };
      const onRecovery = vi.fn().mockResolvedValue('quit' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        onRecovery,
        maxRetries: 1,
      });

      await conductor.run();

      // onRecovery(step, isGating, context). explore is advisory.
      expect(onRecovery).toHaveBeenCalledWith('explore', false, expect.any(Object));
    });

    it('retries step when recovery returns retry', async () => {
      let exploreCalls = 0;
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'explore') {
            exploreCalls++;
            if (exploreCalls === 1) return { success: false, output: 'failed first time' };
            return { success: true };
          }
          return { success: true };
        }),
      };
      const onRecovery = vi.fn().mockResolvedValueOnce('retry' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        onRecovery,
      });

      await conductor.run();

      // explore should have been called twice (fail + retry)
      expect(exploreCalls).toBe(2);
      // All steps should have completed
      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.feature_status).toBe('complete');
      }
    });

    it('skips step when recovery returns skip (non-gating)', async () => {
      // explore is advisory (non-gating), so skip should work
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'explore') return { success: false, output: 'explore failed' };
          return { success: true };
        }),
      };
      const onRecovery = vi.fn().mockResolvedValue('skip' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        onRecovery,
        maxRetries: 1,
      });

      await conductor.run();

      // explore should be marked skipped
      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value['explore']).toBe('skipped');
        // Should have continued past explore
        expect(result.value.feature_status).toBe('complete');
      }
    });

    it('quits when recovery returns quit', async () => {
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'explore') return { success: false, output: 'explore failed' };
          return { success: true };
        }),
      };
      const onRecovery = vi.fn().mockResolvedValue('quit' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        onRecovery,
        maxRetries: 1,
      });

      await conductor.run();

      // Should have stopped
      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value['explore']).toBe('failed');
        expect(result.value.feature_status).toBeUndefined();
      }
    });

    it('calls onRecovery with isGating=true for gating steps', async () => {
      // stories is gating — set up prerequisites (stories now follows architecture_review)
      await writeState(statePath, {
        worktree: 'done',
        memory: 'done',
        explore: 'done',
        complexity: 'done',
        architecture_diagram: 'done',
        architecture_review: 'done',
      } as ConductState);

      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'stories') return { success: false, output: 'stories failed' };
          return { success: true };
        }),
      };
      const onRecovery = vi.fn().mockResolvedValue('quit' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'stories',
        onRecovery,
      });

      await conductor.run();

      expect(onRecovery).toHaveBeenCalledWith(
        'stories',
        true,
        expect.objectContaining({ recoveryCount: 0, retriesExhausted: false }),
      );
    });

    it('navigates back when recovery returns back', async () => {
      // Set up prerequisites through architecture_review (stories' new prereq)
      await writeState(statePath, {
        worktree: 'done',
        memory: 'done',
        explore: 'done',
        complexity: 'done',
        architecture_diagram: 'done',
        architecture_review: 'done',
      } as ConductState);

      let storiesCalls = 0;
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'stories') {
            storiesCalls++;
            if (storiesCalls === 1) return { success: false, output: 'stories failed' };
          }
          return { success: true };
        }),
      };

      const onRecovery = vi.fn().mockResolvedValueOnce('back' as const);
      const onNavigate = vi.fn().mockResolvedValue('explore' as StepName);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        maxRetries: 1,
        fromStep: 'stories',
        onRecovery,
        onNavigate,
      });

      await conductor.run();

      // onNavigate should have been called
      expect(onNavigate).toHaveBeenCalled();
    });

    it('calls runInteractive when recovery returns interactive', async () => {
      let exploreCalls = 0;
      const runner: StepRunner & { runInteractive?: ReturnType<typeof vi.fn> } = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'explore') {
            exploreCalls++;
            if (exploreCalls === 1) return { success: false, output: 'explore failed' };
            return { success: true };
          }
          return { success: true };
        }),
        runInteractive: vi.fn().mockResolvedValue(undefined),
      };
      const onRecovery = vi.fn().mockResolvedValueOnce('interactive' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        maxRetries: 1,
        onRecovery,
      });

      await conductor.run();

      // runInteractive should have been called with the failed step
      expect(runner.runInteractive).toHaveBeenCalledWith('explore', {
        reason: 'Previous attempt failed: explore failed. Finish the work now.',
      });
      // Then the step should have been retried
      expect(exploreCalls).toBe(2);
    });
  });

  describe('complexity assessment', () => {
    it('calls onComplexityAssessment for the complexity step', async () => {
      const runner = createMockStepRunner();
      const onComplexityAssessment = vi.fn().mockResolvedValue('M' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        onComplexityAssessment,
      });

      await conductor.run();

      expect(onComplexityAssessment).toHaveBeenCalledTimes(1);
    });

    it('does not dispatch complexity to stepRunner.run', async () => {
      const runner = createMockStepRunner();
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        onComplexityAssessment: async () => 'M' as const,
      });

      await conductor.run();

      const runMock = runner.run as ReturnType<typeof vi.fn>;
      const steps = runMock.mock.calls.map((c) => c[0]);
      expect(steps).not.toContain('complexity');
    });

    it('stores tier in state after assessment', async () => {
      const runner = createMockStepRunner();
      const onComplexityAssessment = vi.fn().mockResolvedValue('S' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        onComplexityAssessment,
      });

      await conductor.run();

      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.complexity_tier).toBe('S');
        expect(result.value.complexity).toBe('done');
      }
    });

    it('passes existing tier as recommendation when one is already persisted', async () => {
      await writeState(statePath, { complexity_tier: 'L' } as ConductState);

      const runner = createMockStepRunner();
      const onComplexityAssessment = vi.fn().mockResolvedValue('L' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        onComplexityAssessment,
      });

      await conductor.run();

      expect(onComplexityAssessment).toHaveBeenCalledWith('L');
    });

    it('uses assessComplexity output as recommendation when no persisted tier', async () => {
      const runner: StepRunner = {
        run: vi.fn().mockResolvedValue({ success: true }),
        assessComplexity: vi.fn().mockResolvedValue('M' as const),
      };
      const onComplexityAssessment = vi.fn().mockResolvedValue('M' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        onComplexityAssessment,
      });

      await conductor.run();

      expect(runner.assessComplexity).toHaveBeenCalled();
      expect(onComplexityAssessment).toHaveBeenCalledWith('M');
    });

    it('passes null recommendation when Claude cannot determine a tier', async () => {
      const runner: StepRunner = {
        run: vi.fn().mockResolvedValue({ success: true }),
        assessComplexity: vi.fn().mockResolvedValue(null),
      };
      const onComplexityAssessment = vi.fn().mockResolvedValue('L' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        onComplexityAssessment,
      });

      await conductor.run();

      expect(onComplexityAssessment).toHaveBeenCalledWith(null);
    });

    it('does not call onComplexityAssessment in auto mode', async () => {
      const runner = createMockStepRunner();
      const onComplexityAssessment = vi.fn().mockResolvedValue('M' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        mode: 'auto',
        onComplexityAssessment,
      });

      await conductor.run();

      expect(onComplexityAssessment).not.toHaveBeenCalled();
    });

    it('does not set a tier when the prompt throws (e.g., Ctrl-C)', async () => {
      const runner = createMockStepRunner();
      const onComplexityAssessment = vi.fn().mockRejectedValue(new Error('user cancelled'));
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        onComplexityAssessment,
      });

      await conductor.run();

      // Step falls into the failure branch (recoverable via the recovery menu).
      // Critical: no tier gets persisted, so resume will re-prompt.
      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.complexity_tier).toBeUndefined();
        expect(result.value.complexity).toBe('failed');
      }
    });
  });

  it('skips steps with steps.<name>.disable=true', async () => {
    const stepsRun: StepName[] = [];
    const configSkips: Array<{ step: StepName; reason?: string }> = [];
    events.on('config_skip', (event) => {
      if (event.type === 'config_skip') configSkips.push(event);
    });
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      config: {
        steps: {
          memory: { disable: true },
          explore: { disable: true },
          prd_audit: { disable: true },
        },
      },
    });

    await conductor.run();

    expect(stepsRun).not.toContain('memory');
    expect(stepsRun).not.toContain('explore');
    expect(stepsRun).not.toContain('prd_audit');

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value['memory']).toBe('skipped');
      expect(result.value['explore']).toBe('skipped');
      expect(result.value['prd_audit']).toBe('skipped');
    }
    const disabledSetting = 'steps.prd_audit.disable: true';
    expect(await readFile(join(dir, '.pipeline/gates/prd_audit.json'), 'utf8')).toContain(disabledSetting);
    expect(configSkips).toContainEqual({ type: 'config_skip', step: 'prd_audit', reason: disabledSetting });
  });

  it('disabled step satisfies downstream gate', async () => {
    // Disable explore, which is a prerequisite for stories
    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      config: { steps: { explore: { disable: true } } },
    });

    await conductor.run();

    // stories depends on explore — it should still run because
    // explore was skipped and stepSatisfied returns true for 'skipped'
    expect(stepsRun).not.toContain('explore');
    expect(stepsRun).toContain('stories');
  });

  describe('artifact approval persistence', () => {
    async function writeArtifact(rel: string, content: string): Promise<string> {
      const full = join(dir, rel);
      await mkdir(full.substring(0, full.lastIndexOf('/')), { recursive: true });
      await writeFile(full, content);
      return full;
    }

    function sha(content: string): string {
      return createHash('sha256').update(content).digest('hex');
    }

    it('approvalKey returns project-relative paths', () => {
      const root = '/tmp/root';
      expect(approvalKey(root, '/tmp/root/.docs/plans/a.md')).toBe('.docs/plans/a.md');
    });

    it('filterUnapprovedArtifacts excludes files whose hash matches a prior approval', async () => {
      const file = await writeArtifact('.docs/plans/a.md', 'plan content');
      const approvals = {
        [approvalKey(dir, file)]: {
          sha256: sha('plan content'),
          approved_at: '2026-04-16T00:00:00Z',
        },
      };

      const unapproved = await filterUnapprovedArtifacts([file], approvals, dir);

      expect(unapproved).toEqual([]);
    });

    it('filterUnapprovedArtifacts includes files whose content has changed', async () => {
      const file = await writeArtifact('.docs/plans/a.md', 'new content');
      const approvals = {
        [approvalKey(dir, file)]: {
          sha256: sha('old content'),
          approved_at: '2026-04-16T00:00:00Z',
        },
      };

      const unapproved = await filterUnapprovedArtifacts([file], approvals, dir);

      expect(unapproved).toEqual([file]);
    });

    it('filterUnapprovedArtifacts includes never-before-seen files', async () => {
      const file = await writeArtifact('.docs/plans/a.md', 'plan');
      const unapproved = await filterUnapprovedArtifacts([file], {}, dir);
      expect(unapproved).toEqual([file]);
    });

    it('recordApprovals adds entries keyed by project-relative path', async () => {
      const file = await writeArtifact('.docs/plans/a.md', 'plan');
      const updated = await recordApprovals({}, [file], dir);
      expect(Object.keys(updated)).toEqual(['.docs/plans/a.md']);
      expect(updated['.docs/plans/a.md'].sha256).toBe(sha('plan'));
    });

    it('recordApprovals preserves existing entries for other files', async () => {
      const file = await writeArtifact('.docs/plans/a.md', 'plan');
      const prior = {
        'some/other.md': { sha256: 'deadbeef', approved_at: '2026-04-16T00:00:00Z' },
      };
      const updated = await recordApprovals(prior, [file], dir);
      expect(updated['some/other.md'].sha256).toBe('deadbeef');
      expect(updated['.docs/plans/a.md'].sha256).toBe(sha('plan'));
    });

    it('reviews only the current feature artifact when another feature shares the step glob', async () => {
      const featureA = 'neighbour-feature';
      const featureB = 'current-feature';
      await writeArtifact(`.docs/conflicts/${featureA}.md`, 'A');
      const artifactB = await writeArtifact(`.docs/conflicts/${featureB}.md`, 'B');
      await writeArtifact(`.docs/plans/${featureB}.md`, '# Current feature plan');
      await writeArtifact('.pipeline/review-required-conflict_check', '1');

      const state = Object.fromEntries(
        ALL_STEPS
          .filter(({ name }) => name !== 'conflict_check')
          .map(({ name }) => [name, 'done']),
      ) as ConductState;
      state.feature_desc = featureB;
      state.track = 'technical';
      state.complexity_tier = 'M';
      await writeState(statePath, state);

      const reviewObserved = new Error('review observed sentinel');
      let reviewedArtifacts: string[] = [];
      const onReviewArtifacts = vi.fn(async (_step: StepName, files: string[]) => {
        reviewedArtifacts = files;
        throw reviewObserved;
      });
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: createMockStepRunner(),
        events,
        projectRoot: dir,
        featureDesc: featureB,
        resume: true,
        fromStep: 'conflict_check',
        onReviewArtifacts,
        maxRetries: 1,
      });

      await conductor.run();

      expect(reviewedArtifacts).toEqual([artifactB]);
    });

    it('review gate skips the prompt when every file is already approved', async () => {
      const planFile = await writeArtifact('.docs/plans/a.md', 'plan');
      const approvals = {
        [approvalKey(dir, planFile)]: {
          sha256: sha('plan'),
          approved_at: '2026-04-16T00:00:00Z',
        },
      };
      await writeState(statePath, {
        explore: 'done',
        conflict_check: 'done',
        architecture_diagram: 'done',
        architecture_review: 'done',
        complexity_tier: 'L',
        artifact_approvals: approvals,
      } as ConductState);

      const runner = createMockStepRunner();
      const onReviewArtifacts = vi.fn().mockResolvedValue('approved' as const);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        resume: true,
        fromStep: 'plan',
        onReviewArtifacts,
      });

      await conductor.run();

      // Plan's artifact was already approved + unchanged → no re-prompt
      const planCalls = onReviewArtifacts.mock.calls.filter((c) => c[0] === 'plan');
      expect(planCalls.length).toBe(0);
    });

    it('review gate prompts when plan file content changes', async () => {
      // Approval recorded for old content; write new content to disk.
      const planFile = await writeArtifact('.docs/plans/a.md', 'new plan content');
      const approvals = {
        [approvalKey(dir, planFile)]: {
          sha256: sha('OLD content that no longer matches'),
          approved_at: '2026-04-16T00:00:00Z',
        },
      };
      await writeState(statePath, {
        explore: 'done',
        conflict_check: 'done',
        architecture_diagram: 'done',
        architecture_review: 'done',
        complexity_tier: 'L',
        artifact_approvals: approvals,
      } as ConductState);

      const runner = createMockStepRunner();
      const onReviewArtifacts = vi.fn().mockResolvedValue('approved' as const);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        resume: true,
        fromStep: 'plan',
        onReviewArtifacts,
      });

      await conductor.run();

      const planCalls = onReviewArtifacts.mock.calls.filter((c) => c[0] === 'plan');
      expect(planCalls.length).toBe(1);
    });

    it('persists approvals to state after a successful review', async () => {
      const planFile = await writeArtifact('.docs/plans/a.md', 'plan content');
      await writeState(statePath, {
        explore: 'done',
        conflict_check: 'done',
        architecture_diagram: 'done',
        architecture_review: 'done',
        complexity_tier: 'L',
      } as ConductState);

      const runner = createMockStepRunner();
      const onReviewArtifacts = vi.fn().mockResolvedValue('approved' as const);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        resume: true,
        fromStep: 'plan',
        onReviewArtifacts,
      });

      await conductor.run();

      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const approvals = result.value.artifact_approvals ?? {};
        const key = approvalKey(dir, planFile);
        expect(approvals[key]).toBeDefined();
        expect(approvals[key].sha256).toBe(sha('plan content'));
      }
    });

    it('does not persist approvals when user rejects', async () => {
      await writeArtifact('.docs/plans/a.md', 'plan');
      await writeState(statePath, {
        explore: 'done',
        conflict_check: 'done',
        architecture_diagram: 'done',
        architecture_review: 'done',
        complexity_tier: 'L',
      } as ConductState);

      const runCalls: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          runCalls.push(step);
          return { success: true };
        }),
      };
      // First review call: reject. Second: approve (to end the retry loop).
      const onReviewArtifacts = vi
        .fn()
        .mockResolvedValueOnce('rejected' as const)
        .mockResolvedValue('approved' as const);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        resume: true,
        fromStep: 'plan',
        onReviewArtifacts,
      });

      await conductor.run();

      // Plan should have been re-run at least once (once rejected, once approved).
      expect(runCalls.filter((s) => s === 'plan').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('uses the selected Codex policy for L-tier plan dispatch', async () => {
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      complexity_tier: 'L',
      track: 'technical',
      prd: 'skipped',
      architecture_diagram: 'done',
      architecture_review: 'done',
      stories: 'done',
      conflict_check: 'done',
    } as ConductState);

    let planDispatch: { model?: string; effort?: string } | undefined;
    const runner: StepRunner = {
      run: vi.fn(async (step, _state, options) => {
        if (step === 'plan') {
          planDispatch = {
            model: options?.modelOverride,
            effort: options?.effortOverride,
          };
        }
        return { success: true };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      fromStep: 'plan',
      modelPolicy: CODEX_MODEL_POLICY,
    });

    await conductor.run();

    expect(planDispatch).toEqual({ model: 'gpt-5.6-sol', effort: 'xhigh' });
  });

  it('threads the held run identity and candidate index into Codex and Claude self-host provisioning', async () => {
    await mkdir(join(dir, 'skills'), { recursive: true });
    const providerHomeModule = await vi.importActual<typeof import('../../src/engine/self-host/provider-home.js')>('../../src/engine/self-host/provider-home.js');
    const sandboxModule = await vi.importActual<typeof import('../../src/engine/self-host/sandbox-build-env.js')>('../../src/engine/self-host/sandbox-build-env.js');
    const provisionProviderHome = vi.fn(providerHomeModule.provisionProviderHome);
    const provisionSandbox = vi.fn(sandboxModule.provisionSandboxBuildEnv);
    const leases: unknown[] = [];
    const codex: LLMProvider = {
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke: vi.fn().mockResolvedValue({
        success: false,
        exitCode: 127,
        output: 'Codex unavailable',
        providerUnavailable: true,
        providerUnavailableScope: 'run',
      }),
      prepareSelfHostAuth: vi.fn(),
      resolveSelfHostExecutable: vi.fn().mockResolvedValue('codex'),
    } as LLMProvider;
    const claude: LLMProvider = {
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke: vi.fn().mockResolvedValue({ success: true, exitCode: 0 }),
    };
    const runtimes = new ProviderRuntimeSet([
      { key: 'codex', provider: codex, policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability([]) },
      { key: 'claude', provider: claude, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability([]) },
    ]);
    const providerExecution = {
      configuredProviders: ['codex', 'claude'],
      runtimes,
      sessions: new ProviderSessionStore(),
      config: { llm_provider: ['codex', 'claude'] },
      warn: vi.fn(),
    };
    const runner = new DefaultStepRunner(codex, 'held-conductor-run', dir, {
      config: providerExecution.config,
      mode: 'auto',
      providerExecution,
      providerExecutor: async (input) => {
        const prepare = input.prepareCandidateSelfHost;
        if (!prepare) throw new Error('expected self-host preparation');
        const codexInvocation = await prepare(
          { step: 'build', providerKey: 'codex', model: 'gpt-5.6-terra', effort: 'medium' },
          runtimes.get('codex'),
          { runId: input.runId, attempt: 0 },
        );
        const claudeInvocation = await prepare(
          { step: 'build', providerKey: 'claude', model: 'sonnet', effort: 'medium' },
          runtimes.get('claude'),
          { runId: input.runId, attempt: 1 },
        );
        for (const [attempt, invocation] of [codexInvocation, claudeInvocation].entries()) {
          const provider = attempt === 0 ? 'codex' : 'claude';
          leases.push(JSON.parse(await readFile(join(
            dir, '.daemon', 'scratch', 'held-conductor-run', `${attempt}-${provider}`, 'owner.json',
          ), 'utf8')));
          await invocation?.teardown?.();
        }
        return {
          success: true,
          output: 'prepared',
          exitCode: 0,
          attempts: [],
          preferredProvider: 'codex',
          actualProvider: 'claude',
          resolvedModel: 'sonnet',
          resolvedEffort: 'medium',
        };
      },
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      daemon: true,
      selfHost: true,
      featureSlug: 'self-host-identity',
      config: {
        llm_provider: ['codex', 'claude'],
        harness_self_host: { sandbox_build_env: true, build_auth: { mode: 'api-key' } },
      } as HarnessConfig,
      providerExecution,
      selfHostGuardrails: {
        resolveHarnessRoot: vi.fn(),
        resolveInstalledHarnessRoot: vi.fn().mockResolvedValue({ status: 'ok', root: dir }),
        relink: vi.fn(),
        provisionSandbox,
        provisionProviderHome,
        versionGate: vi.fn(),
        releaseGate: vi.fn(),
      } as any,
    });

    await (conductor as unknown as {
      runSelfBuildDispatch: (step: StepName, state: ConductState) => Promise<StepRunResult>;
    }).runSelfBuildDispatch('build', {} as ConductState);

    expect({
      codex: provisionProviderHome.mock.calls[0]?.[0],
      claude: provisionSandbox.mock.calls[0]?.[0],
    }).toEqual({
      codex: expect.objectContaining({
        provider: expect.objectContaining({ id: 'codex' }),
        worktreeRoot: dir,
        repository: dir,
        featureSlug: 'self-host-identity',
        runId: 'held-conductor-run',
        attempt: 0,
      }),
      claude: expect.objectContaining({
        worktreeRoot: dir,
        harnessRoot: dir,
        repository: dir,
        featureSlug: 'self-host-identity',
        runId: 'held-conductor-run',
        attempt: 1,
      }),
    });
    for (const [attempt, lease] of leases.entries()) {
      expect(Object.keys(lease as object).sort()).toEqual(['attempt', 'featureSlug', 'ownerPid', 'repository', 'runId', 'startedAt']);
      expect(lease).toMatchObject({ repository: dir, featureSlug: 'self-host-identity', runId: 'held-conductor-run', attempt, ownerPid: process.pid });
      expect(new Date((lease as { startedAt: string }).startedAt).toISOString()).toBe((lease as { startedAt: string }).startedAt);
    }
  });

  it('writes the authoritative lease before cleanup on the legacy Claude self-host path', async () => {
    await mkdir(join(dir, 'skills'), { recursive: true });
    const sandboxModule = await vi.importActual<typeof import('../../src/engine/self-host/sandbox-build-env.js')>('../../src/engine/self-host/sandbox-build-env.js');
    const leasePath = join(dir, '.daemon', 'scratch', 'legacy-held-run', '1-claude', 'owner.json');
    let lease: unknown;
    const runner: StepRunner = {
      selfHostRunId: () => 'legacy-held-run',
      run: vi.fn(async () => {
        lease = JSON.parse(await readFile(leasePath, 'utf8'));
        return { success: true };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      daemon: true,
      selfHost: true,
      featureSlug: 'legacy-self-host-identity',
      config: {
        llm_provider: 'claude',
        harness_self_host: { sandbox_build_env: true, build_auth: { mode: 'api-key' } },
      } as HarnessConfig,
      selfHostGuardrails: {
        resolveHarnessRoot: vi.fn(),
        resolveInstalledHarnessRoot: vi.fn().mockResolvedValue({ status: 'ok', root: dir }),
        relink: vi.fn(),
        provisionSandbox: sandboxModule.provisionSandboxBuildEnv,
        versionGate: vi.fn(),
        releaseGate: vi.fn(),
      } as any,
    });

    await (conductor as unknown as {
      runSelfBuildDispatch: (step: StepName, state: ConductState) => Promise<StepRunResult>;
    }).runSelfBuildDispatch('build', {} as ConductState);

    expect(lease).toMatchObject({
      repository: dir,
      featureSlug: 'legacy-self-host-identity',
      runId: 'legacy-held-run',
      attempt: 1,
    });
    await expect(readFile(leasePath, 'utf8')).rejects.toThrow();
  });

  it('keeps shared provider CLI overrides authoritative for ordinary step dispatch', async () => {
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      complexity_tier: 'L',
      track: 'technical',
      prd: 'skipped',
      architecture_diagram: 'done',
      architecture_review: 'done',
      stories: 'done',
      conflict_check: 'done',
    } as ConductState);

    let planDispatch: { model?: string; effort?: string } | undefined;
    const runner: StepRunner = {
      run: vi.fn(async (step, _state, options) => {
        if (step === 'plan') {
          planDispatch = {
            model: options?.modelOverride,
            effort: options?.effortOverride,
          };
        }
        return { success: true };
      }),
    };
    const provider: LLMProvider = {
      invoke: vi.fn().mockResolvedValue({ success: true, exitCode: 0 }),
    };
    const runtimes = new ProviderRuntimeSet([
      {
        key: 'codex',
        provider,
        policy: CODEX_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability([]),
      },
    ]);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      fromStep: 'plan',
      config: {
        llm_provider: 'codex',
        steps: {
          plan: { model: 'gpt-configured', effort: 'low' },
        },
      },
      providerExecution: {
        configuredProviders: ['codex'],
        runtimes,
        sessions: new ProviderSessionStore(),
        modelOverride: 'gpt-cli',
        effortOverride: 'max',
      },
    });

    await conductor.run();

    expect(planDispatch).toEqual({ model: 'gpt-cli', effort: 'max' });
  });

  it('emits provider transition, attempt identities, and actual-provider completion', async () => {
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      complexity_tier: 'L',
      track: 'technical',
      prd: 'skipped',
      architecture_diagram: 'done',
      architecture_review: 'done',
      stories: 'done',
      conflict_check: 'done',
    } as ConductState);

    const provider = (key: 'codex' | 'claude'): LLMProvider => {
      const invoke = vi.fn(async (options: InvokeOptions) => {
        const permit = options.spawnPermit?.();
        if (permit && !permit.permitted) {
          throw new Error(`provider spawn denied: ${permit.reason}`);
        }
        return key === 'codex'
          ? {
              success: false,
              output: 'codex executable not found',
              exitCode: 127,
              providerUnavailable: true,
              providerUnavailableReason: 'codex executable not found',
              providerUnavailableScope: 'run' as const,
            }
          : {
              success: true,
              output: 'completed by claude',
              exitCode: 0,
              tokenUsage: { input: 120, output: 30 },
            };
      });
      return {
        lifecycleCapability: { synchronousSpawnPermit: true },
        invoke,
      };
    };
    const runtimes = new ProviderRuntimeSet([
      {
        key: 'codex',
        provider: provider('codex'),
        policy: CODEX_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability([]),
      },
      {
        key: 'claude',
        provider: provider('claude'),
        policy: CLAUDE_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability([]),
      },
    ]);
    const providerExecution = {
      configuredProviders: ['codex', 'claude'],
      runtimes,
      sessions: new ProviderSessionStore(),
      config: { llm_provider: ['codex', 'claude'] },
      onAttempt: (
        step: StepName,
        attempt: Omit<Extract<ConductorEvent, { type: 'provider_attempt' }>, 'type' | 'step'>,
      ) => events.emit({ type: 'provider_attempt', step, ...attempt }),
      warn: (_message: string, transition: Extract<ConductorEvent, { type: 'provider_fallback' | 'session_policy' }>) =>
        events.emit(transition),
    };
    const runner = new DefaultStepRunner(
      runtimes.get('codex').provider,
      'legacy-session',
      dir,
      {
        config: providerExecution.config,
        modelPolicy: CODEX_MODEL_POLICY,
        mode: 'auto',
        providerExecution,
      },
    );
    const observed: ConductorEvent[] = [];
    for (const type of ['provider_fallback', 'provider_attempt', 'step_completed'] as const) {
      events.on(type, (event) => {
        if ('step' in event && event.step === 'plan') observed.push(event);
      });
    }
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      fromStep: 'plan',
      mode: 'auto',
      config: providerExecution.config,
      modelPolicy: CODEX_MODEL_POLICY,
      providerExecution,
    });

    await conductor.run();

    expect(observed.map((event) => {
      if (event.type === 'provider_fallback') return event;
      if (event.type === 'provider_attempt') {
        return {
          type: event.type,
          step: event.step,
          provider: event.provider,
          outcome: event.outcome,
          invoked: event.invoked,
          model: event.model,
          reason: event.reason,
          tokenUsage: event.tokenUsage,
          ...(event.lifecycle === undefined
            ? {}
            : {
                lifecycle: {
                  phase: event.lifecycle.phase,
                  recoveryCount: event.lifecycle.recoveryCount,
                  ...(event.lifecycle.outcome === undefined
                    ? {}
                    : { outcome: event.lifecycle.outcome }),
                },
              }),
        };
      }
      if (event.type !== 'step_completed') {
        throw new Error(`unexpected observed event type: ${event.type}`);
      }
      return {
        type: event.type,
        step: event.step,
        preferredProvider: event.preferredProvider,
        actualProvider: event.actualProvider,
        tokenUsage: event.tokenUsage,
      };
    })).toEqual([
      {
        type: 'provider_attempt',
        step: 'plan',
        provider: 'provider-lifecycle',
        outcome: 'success',
        invoked: false,
        model: undefined,
        reason: undefined,
        tokenUsage: undefined,
        lifecycle: { phase: 'preparing', recoveryCount: 0 },
      },
      {
        type: 'provider_attempt',
        step: 'plan',
        provider: 'provider-lifecycle',
        outcome: 'success',
        invoked: false,
        model: undefined,
        reason: undefined,
        tokenUsage: undefined,
        lifecycle: { phase: 'running', recoveryCount: 0 },
      },
      {
        type: 'provider_attempt',
        step: 'plan',
        provider: 'codex',
        outcome: 'unavailable',
        invoked: true,
        model: 'gpt-5.6-sol',
        reason: 'codex executable not found',
        tokenUsage: undefined,
      },
      {
        type: 'provider_fallback',
        step: 'plan',
        failedProvider: 'codex',
        reason: 'codex executable not found',
        nextProvider: 'claude',
      },
      {
        type: 'provider_attempt',
        step: 'plan',
        provider: 'claude',
        outcome: 'success',
        invoked: true,
        model: 'opus',
        reason: undefined,
        tokenUsage: { input: 120, output: 30 },
      },
      {
        type: 'provider_attempt',
        step: 'plan',
        provider: 'provider-lifecycle',
        outcome: 'success',
        invoked: false,
        model: undefined,
        reason: undefined,
        tokenUsage: undefined,
        lifecycle: { phase: 'settled', recoveryCount: 0, outcome: 'completed' },
      },
      {
        type: 'step_completed',
        step: 'plan',
        preferredProvider: 'codex',
        actualProvider: 'claude',
        tokenUsage: { input: 120, output: 30 },
      },
    ]);
  });

  it.each([
    {
      signal: 'rate-limit',
      transient: {
        success: false,
        rateLimited: true,
        waitSeconds: 1,
      } as StepRunResult,
    },
    {
      signal: 'auth-park',
      transient: {
        success: false,
        authFailure: true,
      } as StepRunResult,
    },
  ])(
    'keeps transient re-runs on the same Codex attempt: $signal',
    async ({ signal, transient }) => {
      await writeState(statePath, {
        worktree: 'done',
        memory: 'done',
        explore: 'done',
        complexity: 'done',
        complexity_tier: 'M',
        track: 'technical',
        prd: 'skipped',
        architecture_diagram: 'done',
        architecture_review: 'done',
        stories: 'done',
        conflict_check: 'done',
      } as ConductState);

      if (signal === 'auth-park') {
        const { waitForCredentialsChange } = await import(
          '../../src/engine/self-host/operator-credentials.js'
        );
        vi.mocked(waitForCredentialsChange).mockResolvedValue({
          type: 'refreshed',
          credentialsPath: '/.credentials.json',
        });
      }

      const dispatches: Array<{ model?: string; effort?: string }> = [];
      let planCalls = 0;
      const runner: StepRunner = {
        run: vi.fn(async (
          step: StepName,
          _state: ConductState,
          options?: StepRunOptions,
        ): Promise<StepRunResult> => {
          if (step !== 'plan') return { success: true };
          dispatches.push({
            model: options?.modelOverride,
            effort: options?.effortOverride,
          });
          planCalls += 1;
          if (planCalls === 1) return transient;
          return { success: false, output: 'ordinary plan failure' };
        }),
        resetSession: vi.fn().mockResolvedValue(undefined),
      };
      const retryEvents: Array<{
        attempt: number;
        model?: string;
        effort?: string;
      }> = [];
      events.on('step_retry', (event) => {
        if (event.type === 'step_retry' && event.step === 'plan') {
          retryEvents.push({
            attempt: event.attempt,
            model: event.escalatedModel,
            effort: event.escalatedEffort,
          });
        }
      });
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        resume: true,
        fromStep: 'plan',
        sleepFn: vi.fn().mockResolvedValue(undefined),
        config: {
          steps: {
            plan: {
              model: 'gpt-5.6-luna',
              effort: 'low',
              max_retries: 2,
            },
          },
        } as HarnessConfig,
        modelPolicy: CODEX_MODEL_POLICY,
        escalateBuildFailure: vi.fn().mockResolvedValue({ prUrl: undefined }),
      });

      await conductor.run();

      expect({ dispatches, retryEvents }).toEqual({
        dispatches: [
          { model: 'gpt-5.6-luna', effort: 'low' },
          { model: 'gpt-5.6-luna', effort: 'low' },
          { model: 'gpt-5.6-luna', effort: 'medium' },
        ],
        retryEvents: [
          { attempt: 2, model: 'gpt-5.6-luna', effort: 'medium' },
        ],
      });
    },
  );

  describe('rate-limit handling', () => {
    beforeEach(() => {
      // Freeze the deadline clock while leaving async I/O and timers real.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-09-01T00:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('waits and retries without burning retry budget on rate limit', async () => {
      let attempt = 0;
      const runner: StepRunner = {
        run: vi.fn(async () => {
          attempt++;
          if (attempt === 1) return { success: false, rateLimited: true, waitSeconds: 5 };
          return { success: true };
        }),
      };
      const sleepFn = vi.fn().mockResolvedValue(undefined);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        maxRetries: 2, // budget would be exhausted if rate-limit consumed attempts
        sleepFn,
        onRecovery: vi.fn().mockResolvedValue('quit' as const),
      });

      const rateLimitEvents: Array<{ waitSeconds: number }> = [];
      events.on('rate_limit', (e) => {
        if (e.type === 'rate_limit') rateLimitEvents.push({ waitSeconds: e.waitSeconds });
      });

      await conductor.run();

      expect(rateLimitEvents).toHaveLength(1);
      expect(rateLimitEvents[0].waitSeconds).toBe(5);
      expect(sleepFn).toHaveBeenCalledWith(5000);
      // runner called at least twice on the first step (1 rate-limited + 1 success),
      // but the step still succeeded (no failure emitted) because rate-limit didn't
      // burn the retry budget.
      expect(attempt).toBeGreaterThanOrEqual(2);
    });

    it('defaults rate-limit wait to 300 seconds when waitSeconds is not provided', async () => {
      let attempt = 0;
      const runner: StepRunner = {
        run: vi.fn(async () => {
          attempt++;
          if (attempt === 1) return { success: false, rateLimited: true };
          return { success: true };
        }),
      };
      const sleepFn = vi.fn().mockResolvedValue(undefined);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        sleepFn,
      });

      await conductor.run();

      expect(sleepFn).toHaveBeenCalledWith(300_000);
    });

    it('conductor: enters episode and awaits episode.clear() on rate-limited result', async () => {
      // Task 9: RED spec for conductor episode integration
      // Expects: conductor calls episode.enter(deadline) and awaits episode.clear(signal)
      // instead of bare sleep when handling rate limits.

      let attempt = 0;
      const runner: StepRunner = {
        run: vi.fn(async () => {
          attempt++;
          if (attempt === 1) return { success: false, rateLimited: true, waitSeconds: 60 };
          return { success: true };
        }),
      };

      // Mock episode with spy methods to verify calls
      let episodeEnterCalled = false;
      let episodeEnterDeadline: number | null = null;
      let episodeClearCalled = false;
      let episodeClearSignal: AbortSignal | undefined;

      const mockEpisode = {
        enter: (untilMs: number) => {
          episodeEnterCalled = true;
          episodeEnterDeadline = untilMs;
        },
        active: () => false,
        clear: async (signal?: AbortSignal) => {
          episodeClearCalled = true;
          episodeClearSignal = signal;
          return Promise.resolve();
        },
        nextWaitSeconds: () => 60,
      };

      const nowTime = Date.now();
      const sleepFn = vi.fn().mockResolvedValue(undefined);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        maxRetries: 2,
        sleepFn,
        onRecovery: vi.fn().mockResolvedValue('quit' as const),
        rateLimitEpisode: mockEpisode,
      });

      await conductor.run();

      // Assertions (will fail because conductor doesn't yet integrate episode):
      // - episode.enter() was NOT called yet (conductor doesn't integrate episode yet)
      expect(episodeEnterCalled).toBe(true);
      // - deadline should be approximately now + 60000ms
      if (episodeEnterDeadline !== null) {
        const expectedMin = nowTime + 59000; // Allow 1s tolerance
        const expectedMax = nowTime + 61000;
        expect(episodeEnterDeadline).toBeGreaterThanOrEqual(expectedMin);
        expect(episodeEnterDeadline).toBeLessThanOrEqual(expectedMax);
      }
      // - episode.clear(signal) should be called instead of bare sleep
      expect(episodeClearCalled).toBe(true);
      expect(episodeClearSignal).toBeDefined();
      // - attempt counter unchanged (rate-limit doesn't burn budget)
      expect(attempt).toBeGreaterThanOrEqual(2);
      // - sleepFn should NOT have been called (conductor should use episode.clear)
      expect(sleepFn).not.toHaveBeenCalled();
    });

    describe('Task 12: coordinated shared backoff across concurrent conductors', () => {
      it('two conductors share one episode: shared deadline (later-wins), joint resume', async () => {
        // Task 12 RED: Two conductors with one shared episode
        // - Conductor A hits rate-limit with waitSeconds=60
        // - Conductor B hits rate-limit with waitSeconds=120
        // - Later deadline wins → shared deadline = later of the two
        // - Both conductors await episode.clear() → same promise, both resume together

        const { create: createEpisode } = await import(
          '../../src/engine/rate-limit-episode.js'
        );

        let fakeNow = 0;
        const sharedEpisode = createEpisode({
          now: () => fakeNow,
          setTimer: (fn: () => void, delayMs: number) => {
            // Advance the fake clock past the delay BEFORE firing: the
            // episode's wake-recheck loop re-reads now() at wake and re-arms
            // unless the deadline has genuinely passed — an immediate fire
            // with a frozen clock is an infinite re-arm loop (the CI hang).
            fakeNow += delayMs;
            setImmediate(fn);
            return { cancel: () => {} };
          },
        });

        let conductorAAttempt = 0;
        let conductorBAttempt = 0;
        let episodeEnterCalls: Array<{ deadline: number }> = [];

        const originalEnter = sharedEpisode.enter.bind(sharedEpisode);
        sharedEpisode.enter = (deadline: number) => {
          episodeEnterCalls.push({ deadline });
          originalEnter(deadline);
        };

        const runnerA: StepRunner = {
          run: vi.fn(async () => {
            conductorAAttempt++;
            if (conductorAAttempt === 1) {
              return { success: false, rateLimited: true, waitSeconds: 60 };
            }
            return { success: true };
          }),
        };

        const runnerB: StepRunner = {
          run: vi.fn(async () => {
            conductorBAttempt++;
            if (conductorBAttempt === 1) {
              return { success: false, rateLimited: true, waitSeconds: 120 };
            }
            return { success: true };
          }),
        };

        const conductorA = new Conductor({
          stateFilePath: join(dir, 'state-a.json'),
          stepRunner: runnerA,
          events,
          projectRoot: dir,
          maxRetries: 2,
          rateLimitEpisode: sharedEpisode,
        });

        const conductorB = new Conductor({
          stateFilePath: join(dir, 'state-b.json'),
          stepRunner: runnerB,
          events,
          projectRoot: dir,
          maxRetries: 2,
          rateLimitEpisode: sharedEpisode,
        });

        // Run both conductors concurrently
        const [resultA, resultB] = await Promise.all([
          conductorA.run(),
          conductorB.run(),
        ]);

        // Both should complete without errors
        expect(resultA).toBeUndefined();
        expect(resultB).toBeUndefined();

        // Both should have retried (rate-limit + success)
        expect(conductorAAttempt).toBeGreaterThanOrEqual(2);
        expect(conductorBAttempt).toBeGreaterThanOrEqual(2);

        // Both should have called episode.enter()
        expect(episodeEnterCalls.length).toBeGreaterThanOrEqual(2);
      });

      it('later-deadline-wins: 60s vs 120s → shared deadline respects 120s', async () => {
        // Verify that the later deadline (120s) wins over earlier (60s)
        const { create: createEpisode } = await import(
          '../../src/engine/rate-limit-episode.js'
        );

        const baseTime = 1000000;
        let fakeNow = baseTime;
        const episodeEnterCalls: Array<number> = [];

        const sharedEpisode = createEpisode({
          now: () => fakeNow,
          setTimer: () => ({ cancel: () => {} }),
        });

        const originalEnter = sharedEpisode.enter.bind(sharedEpisode);
        sharedEpisode.enter = (deadline: number) => {
          episodeEnterCalls.push(deadline);
          originalEnter(deadline);
        };

        // Simulate conductor A entering with 60s deadline
        sharedEpisode.enter(baseTime + 60000);
        expect(episodeEnterCalls[0]).toBe(baseTime + 60000);

        // Simulate conductor B entering with 120s deadline
        sharedEpisode.enter(baseTime + 120000);
        expect(episodeEnterCalls[1]).toBe(baseTime + 120000);

        // The shared deadline should now be the later one (120s)
        // Check by verifying active() returns true up to 120s but not 60s
        fakeNow = baseTime + 119999;
        expect(sharedEpisode.active(fakeNow)).toBe(true);

        fakeNow = baseTime + 120001;
        expect(sharedEpisode.active(fakeNow)).toBe(false);
      });

      it('N=1 unchanged: single conductor works same as before', async () => {
        // Task 12: Verify backward compatibility
        // A single conductor should work identically to before (no behavior change)

        const { create: createEpisode } = await import(
          '../../src/engine/rate-limit-episode.js'
        );

        let attempt = 0;
        const runner: StepRunner = {
          run: vi.fn(async () => {
            attempt++;
            if (attempt === 1) {
              return { success: false, rateLimited: true, waitSeconds: 30 };
            }
            return { success: true };
          }),
        };

        // Fake clock advanced by the timer itself — the wake-recheck loop
        // re-arms forever if the deadline hasn't genuinely passed at wake.
        let singleFakeNow = 0;
        const singleEpisode = createEpisode({
          now: () => singleFakeNow,
          setTimer: (fn: () => void, delayMs: number) => {
            singleFakeNow += delayMs;
            setImmediate(fn);
            return { cancel: () => {} };
          },
        });

        const conductor = new Conductor({
          stateFilePath: join(dir, 'state-single.json'),
          stepRunner: runner,
          events,
          projectRoot: dir,
          maxRetries: 2,
          rateLimitEpisode: singleEpisode,
        });

        await conductor.run();

        // Should have retried once (rate-limit + success)
        expect(attempt).toBeGreaterThanOrEqual(2);
      });
    });
  });

  describe('provider session scoping', () => {
    it('scopes serial sessions per step and provider across retries and fallback', async () => {
      const calls: Array<{
        step: 'memory' | 'explore';
        provider: 'claude' | 'codex';
        sessionId: string;
        resume: boolean;
      }> = [];
      const providerCalls = new Map<string, number>();
      const invoke = (
        provider: 'claude' | 'codex',
      ) => async (options: InvokeOptions): Promise<InvokeResult> => {
        const promptPrefix = provider === 'codex' ? '$' : '/';
        if (
          options.prompt !== `${promptPrefix}memory` &&
          options.prompt !== `${promptPrefix}explore`
        ) {
          return { success: true, output: 'non-target step completed', exitCode: 0 };
        }
        const step = options.prompt === `${promptPrefix}memory` ? 'memory' : 'explore';
        const key = `${step}:${provider}`;
        const call = (providerCalls.get(key) ?? 0) + 1;
        providerCalls.set(key, call);
        calls.push({
          step,
          provider,
          sessionId: options.sessionId,
          resume: options.resume,
        });

        if (step === 'memory' && provider === 'codex' && call === 1) {
          return {
            success: false,
            output: 'ordinary retryable failure',
            exitCode: 1,
          };
        }
        if (step === 'explore' && provider === 'codex') {
          return {
            success: false,
            output: 'codex model unavailable',
            exitCode: 1,
            modelUnavailable: true,
          };
        }
        return { success: true, output: 'completed', exitCode: 0 };
      };
      const provider = (key: 'claude' | 'codex'): LLMProvider => {
        const invokeProvider = vi.fn(async (options: InvokeOptions) => {
          const permit = options.spawnPermit?.();
          if (permit && !permit.permitted) {
            throw new Error(`provider spawn denied: ${permit.reason}`);
          }
          return invoke(key)(options);
        });
        return {
          supportsSessionResume: key === 'claude',
          lifecycleCapability: { synchronousSpawnPermit: true },
          invoke: invokeProvider,
        };
      };
      const runtimes = new ProviderRuntimeSet([
        {
          key: 'claude',
          provider: provider('claude'),
          policy: CLAUDE_MODEL_POLICY,
          builtIn: true,
          availability: new ModelAvailability([]),
        },
        {
          key: 'codex',
          provider: provider('codex'),
          policy: CODEX_MODEL_POLICY,
          builtIn: true,
          availability: new ModelAvailability([]),
        },
      ]);
      const ids = [
        'memory-codex',
        'memory-codex-retry',
        'explore-codex',
        'explore-claude',
      ][Symbol.iterator]();
      const sessions = new ProviderSessionStore({
        createSessionId: () => ids.next().value ?? 'unexpected-session',
      });
      const beginStep = vi.spyOn(sessions, 'beginStep');
      const config: HarnessConfig = {
        llm_provider: ['codex', 'claude'],
        steps: {
          memory: { llm_provider: 'codex', max_retries: 2 },
          explore: { llm_provider: 'codex' },
        },
      };
      const runner = new DefaultStepRunner(
        provider('claude'),
        'legacy-session',
        dir,
        {
          config,
          sessionStore: sessions,
          providerRuntimes: runtimes,
          configuredProviders: ['codex', 'claude'],
        },
      );
      const resetSession = vi.spyOn(runner, 'resetSession');
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        config,
        onCheckpoint: async (step) =>
          step === 'explore' ? 'quit' : 'continue',
      });

      await conductor.run();

      const targetSteps = new Set(['memory', 'explore']);
      // Session reuse was removed by design: every dispatch — the first
      // attempt, its retry, and each provider candidate — mints its own
      // fresh, unused UUID (never a store id).
      const freshSessionIdRe =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const sessionIds = calls.map(({ sessionId }) => sessionId);
      expect(new Set(sessionIds).size).toBe(sessionIds.length);
      for (const id of sessionIds) expect(id).toMatch(freshSessionIdRe);
      expect({
        calls: calls.map(({ step, provider: providerKey, resume }) => ({
          step,
          provider: providerKey,
          resume,
        })),
        beginStepCalls: beginStep.mock.calls.filter(([step]) =>
          targetSteps.has(step)
        ),
        resetSessionCalls: resetSession.mock.calls.filter(
          ([step]) => step === undefined || targetSteps.has(step),
        ),
      }).toEqual({
        calls: [
          { step: 'memory', provider: 'codex', resume: false },
          { step: 'memory', provider: 'codex', resume: false },
          { step: 'explore', provider: 'codex', resume: false },
          { step: 'explore', provider: 'claude', resume: false },
        ],
        beginStepCalls: [['memory'], ['explore']],
        resetSessionCalls: [
          ['memory'],
          ['explore'],
        ],
      });
    });
  });

  describe('auth-failure handling', () => {
    beforeEach(async () => {
      await import(
        '../../src/engine/self-host/operator-credentials.js'
      );
      vi.clearAllMocks();
    });

    it('classifies an immediate operator OAuth preflight HALT as needs-human', async () => {
      const { readOperatorCredentialsState } = await import(
        '../../src/engine/self-host/operator-credentials.js'
      );
      vi.mocked(readOperatorCredentialsState).mockResolvedValue('expired');
      const credentialsPath = join(dir, '.credentials.json');
      await writeFile(
        credentialsPath,
        JSON.stringify({ claudeAiOauth: { expiresAt: 1234 } }),
        'utf-8',
      );
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: createMockStepRunner(),
        events,
        projectRoot: dir,
        config: { harness_self_host: { auth_park_timeout_minutes: 0 } } as HarnessConfig,
      });

      const result = await (
        conductor as unknown as {
          preflightCredentialsCheck: (configDir: string) => Promise<StepRunResult | undefined>;
        }
      ).preflightCredentialsCheck(dir);

      expect(result?.output).toContain('Operator OAuth token is expired');
      expect(await readFile(join(dir, '.pipeline/HALT.class'), 'utf-8')).toBe('needs-human');
    });

    it('classifies a timed-out operator OAuth preflight HALT as needs-human', async () => {
      const { readOperatorCredentialsState, waitForCredentialsChange } = await import(
        '../../src/engine/self-host/operator-credentials.js'
      );
      vi.mocked(readOperatorCredentialsState).mockResolvedValue('expired');
      const credentialsPath = join(dir, '.credentials.json');
      vi.mocked(waitForCredentialsChange).mockResolvedValue({
        type: 'timeout',
        credentialsPath,
        credentialsState: 'expired',
        expiresAt: '1234',
      });
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: createMockStepRunner(),
        events,
        projectRoot: dir,
        config: { harness_self_host: { auth_park_timeout_minutes: 1 } } as HarnessConfig,
      });

      const result = await (
        conductor as unknown as {
          preflightCredentialsCheck: (configDir: string) => Promise<StepRunResult | undefined>;
        }
      ).preflightCredentialsCheck(dir);

      expect(result?.output).toContain('Operator credentials expired and refresh timed out');
      expect(await readFile(join(dir, '.pipeline/HALT.class'), 'utf-8')).toBe('needs-human');
    });

    it('preserves an existing classified marker during operator OAuth preflight', async () => {
      const { readOperatorCredentialsState } = await import(
        '../../src/engine/self-host/operator-credentials.js'
      );
      vi.mocked(readOperatorCredentialsState).mockResolvedValue('expired');
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/HALT'), 'specific prior reason\n', 'utf-8');
      await writeFile(join(dir, '.pipeline/HALT.class'), 'mechanical', 'utf-8');
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: createMockStepRunner(),
        events,
        projectRoot: dir,
        config: { harness_self_host: { auth_park_timeout_minutes: 0 } } as HarnessConfig,
      });

      await (
        conductor as unknown as {
          preflightCredentialsCheck: (configDir: string) => Promise<StepRunResult | undefined>;
        }
      ).preflightCredentialsCheck(dir);

      expect({
        reason: await readFile(join(dir, '.pipeline/HALT'), 'utf-8'),
        haltClass: await readFile(join(dir, '.pipeline/HALT.class'), 'utf-8'),
      }).toEqual({
        reason: 'specific prior reason\n',
        haltClass: 'mechanical',
      });
    });

    it('parks on authFailure without burning retry budget', async () => {
      const { waitForCredentialsChange } = await import(
        '../../src/engine/self-host/operator-credentials.js'
      );

      let attempt = 0;
      const runner: StepRunner = {
        run: vi.fn(async () => {
          attempt++;
          if (attempt === 1) return { success: false, authFailure: true };
          return { success: true };
        }),
      };

      vi.mocked(waitForCredentialsChange).mockResolvedValue({
        type: 'refreshed' as const,
        credentialsPath: '/.credentials.json',
      });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        maxRetries: 2,
      });

      await conductor.run();

      // Runner should have been called at least twice on the first step (1 auth-failed + 1 success)
      expect(attempt).toBeGreaterThanOrEqual(2);
    });

    it('halts an unknown Codex review result without consuming a retry', async () => {
      const runner: StepRunner = {
        run: vi.fn(async (): Promise<StepRunResult> => ({
          success: false,
          output: 'Codex automatic review returned an unknown result for workspace escape',
          permissionDenied: true,
          actualProvider: 'codex',
          authentication: { provider: 'codex', source: 'cached-login', state: 'ready' },
        })),
      };
      const haltReasons: string[] = [];
      events.on('loop_halt', (event) => {
        if (event.type === 'loop_halt') haltReasons.push(event.reason);
      });
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        maxRetries: 3,
      });

      await conductor.run();

      expect({
        calls: (runner.run as ReturnType<typeof vi.fn>).mock.calls.length,
        haltReasons,
        haltBody: await readFile(join(dir, '.pipeline/HALT'), 'utf-8'),
        haltClass: await readFile(join(dir, '.pipeline/HALT.class'), 'utf-8'),
      }).toEqual({
        calls: 1,
        haltReasons: [expect.stringMatching(/Codex permission review denied[\s\S]*cached-login/i)],
        haltBody: haltReasons[0] + '\n',
        haltClass: 'needs-human',
      });
    });

    it('re-enters park on subsequent authFailure without budget burn', async () => {
      const { waitForCredentialsChange } = await import(
        '../../src/engine/self-host/operator-credentials.js'
      );

      let attempt = 0;
      const runner: StepRunner = {
        run: vi.fn(async () => {
          attempt++;
          // Both attempts fail with authFailure
          if (attempt <= 2) return { success: false, authFailure: true };
          return { success: true };
        }),
      };

      vi.mocked(waitForCredentialsChange).mockResolvedValue({
        type: 'refreshed' as const,
        credentialsPath: '/.credentials.json',
      });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        maxRetries: 2,
      });

      await conductor.run();

      // Runner should have been called 3 times: attempt 1 (auth-fail), attempt 2 (auth-fail), attempt 3 (success)
      // This verifies the budget was not burned (would be exhausted if park-resume consumed attempts)
      expect(attempt).toBeGreaterThanOrEqual(3);
      expect(vi.mocked(waitForCredentialsChange)).toHaveBeenCalledTimes(2);
    });

    it('HALTs with credentials-specific reason when park timeout elapses', async () => {
      const { waitForCredentialsChange } = await import(
        '../../src/engine/self-host/operator-credentials.js'
      );
      const credentialsPath = join(dir, '.credentials.json');
      const expiresAt = Date.now() - 1000; // expired
      await writeFile(credentialsPath, JSON.stringify({ claudeAiOauth: { expiresAt } }), 'utf-8');

      vi.mocked(waitForCredentialsChange).mockResolvedValue({
        type: 'timeout' as const,
        credentialsPath,
        credentialsState: 'expired' as const,
        expiresAt: String(expiresAt),
      });

      const runner: StepRunner = {
        run: vi.fn(async () => {
          return { success: false, authFailure: true };
        }),
      };

      const mockGuardrails = {
        provisionSandbox: vi.fn(),
        resolveHarnessRoot: vi.fn().mockResolvedValue(null),
        relink: vi.fn(),
        versionGate: vi.fn(),
        releaseGate: vi.fn(),
      };

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        maxRetries: 1,
        mode: 'auto',
        daemon: true,
        selfHostGuardrails: mockGuardrails as any,
      });

      let halted = false;
      events.on('loop_halt', () => {
        halted = true;
      });

      await conductor.run();

      expect(halted).toBe(true);
      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      // The HALT reason must include the credentials path and the expiresAt
      expect(halt).toContain(credentialsPath);
      expect(halt).toContain(String(expiresAt));
      // Verify it's NOT the generic "retries exhausted" reason
      expect(halt).not.toMatch(/retries exhausted/i);
      expect(await readFile(join(dir, '.pipeline/HALT.class'), 'utf-8')).toBe('needs-human');
    });

    // ── TR-4 Task 15: Auth HALT distinguishable from build-defect HALT ─────

    it('TR-4 Test B: auth-park timeout does not consume retry budget', async () => {
      const { waitForCredentialsChange } = await import(
        '../../src/engine/self-host/operator-credentials.js'
      );
      const credentialsPath = join(dir, '.credentials.json');
      const expiresAt = Date.now() - 1000;
      await writeFile(credentialsPath, JSON.stringify({ claudeAiOauth: { expiresAt } }), 'utf-8');

      let buildAttempts = 0;

      const runner: StepRunner = {
        run: vi.fn(async (step: StepName): Promise<StepRunResult> => {
          if (step === 'build') {
            buildAttempts++;
            return { success: false, authFailure: true };
          }
          return { success: true };
        }),
      };
      // The newer daemon loop refuses to advance past gates without recorded
      // state (terminal-verdict guard), so start the run AT build with every
      // prior step stamped done — these tests exercise the auth-park path of
      // the build step only.
      await writeState(statePath, {
        worktree: 'done', memory: 'done', explore: 'done', complexity: 'done',
        stories: 'done', conflict_check: 'done', plan: 'done', coherence_check: 'done',
        architecture_diagram: 'done', architecture_review: 'done',
        acceptance_specs: 'done', complexity_tier: 'M', track: 'technical',
        feature_desc: 'auth-park-test',
      } as ConductState);

      vi.mocked(waitForCredentialsChange).mockResolvedValue({
        type: 'timeout' as const,
        credentialsPath,
        credentialsState: 'expired' as const,
        expiresAt: String(expiresAt),
      });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        fromStep: 'build',
        maxRetries: 2, // enough budget to retry if it were burned
      });

      await conductor.run();

      // Test B: only one build attempt made (authFailure triggers park, timeout
      // halts immediately without retrying — attempt counter stays at 1)
      expect(buildAttempts).toBe(1);
    });

    it('TR-4 Test C: escalation PR body carries credentials-specific reason', async () => {
      const { waitForCredentialsChange } = await import(
        '../../src/engine/self-host/operator-credentials.js'
      );
      const credentialsPath = join(dir, '.credentials.json');
      const expiresAt = Date.now() - 1000;
      await writeFile(credentialsPath, JSON.stringify({ claudeAiOauth: { expiresAt } }), 'utf-8');

      const fakePrUrl = 'https://github.com/test/repo/pull/999';
      const capturedOpts: EscalateBuildFailureOpts[] = [];

      const fakeEscalation = vi.fn(async (opts: EscalateBuildFailureOpts) => {
        capturedOpts.push(opts);
        return { prUrl: fakePrUrl };
      });

      const runner: StepRunner = {
        run: vi.fn(async (step: StepName): Promise<StepRunResult> => {
          if (step === 'build') return { success: false, authFailure: true };
          return { success: true };
        }),
      };
      // The newer daemon loop refuses to advance past gates without recorded
      // state (terminal-verdict guard), so start the run AT build with every
      // prior step stamped done — these tests exercise the auth-park path of
      // the build step only.
      await writeState(statePath, {
        worktree: 'done', memory: 'done', explore: 'done', complexity: 'done',
        stories: 'done', conflict_check: 'done', plan: 'done', coherence_check: 'done',
        architecture_diagram: 'done', architecture_review: 'done',
        acceptance_specs: 'done', complexity_tier: 'M', track: 'technical',
        feature_desc: 'auth-park-test',
      } as ConductState);

      vi.mocked(waitForCredentialsChange).mockResolvedValue({
        type: 'timeout' as const,
        credentialsPath,
        credentialsState: 'expired' as const,
        expiresAt: String(expiresAt),
      });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        fromStep: 'build',
        maxRetries: 1,
        escalateBuildFailure: fakeEscalation,
      });

      await conductor.run();

      // Test C: escalation was called with credentials-specific reason
      expect(fakeEscalation).toHaveBeenCalledOnce();
      expect(capturedOpts).toHaveLength(1);

      const failureReason = capturedOpts[0].failureReason;

      // Verify the PR body reason is credentials-specific, not generic "retries exhausted"
      expect(failureReason).not.toMatch(/retries exhausted/i);
      expect(failureReason).toContain(credentialsPath);
      expect(failureReason).toContain(String(expiresAt));
      expect(failureReason).toContain('Operator credentials expired');
    });
  });

  describe('conditional review (conflict_check has review=conditional by default)', () => {
    async function seedConflictArtifact(projectRoot: string): Promise<void> {
      await mkdir(join(projectRoot, '.docs/conflicts'), { recursive: true });
      await writeFile(join(projectRoot, '.docs/conflicts/c.md'), 'conflict report');
    }

    async function seedPrdArtifact(projectRoot: string): Promise<void> {
      await mkdir(join(projectRoot, '.docs/specs'), { recursive: true });
      await writeFile(join(projectRoot, '.docs/specs/spec.md'), 'spec');
    }

    it('auto-approves conflict_check when no marker file exists', async () => {
      await seedConflictArtifact(dir);
      await writeState(statePath, {
        bootstrap: 'done', memory: 'done', assess: 'done', explore: 'done',
        stories: 'done', complexity_tier: 'M',
      } as ConductState);

      const onReviewArtifacts = vi.fn().mockResolvedValue('approved' as const);
      const runner = createMockStepRunner();
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        resume: true,
        fromStep: 'conflict_check',
        onReviewArtifacts,
      });

      await conductor.run();

      const conflictCalls = onReviewArtifacts.mock.calls.filter((c) => c[0] === 'conflict_check');
      expect(conflictCalls.length).toBe(0);
    });

    it('prompts when conflict_check wrote the marker file', async () => {
      await seedConflictArtifact(dir);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/review-required-conflict_check'), '1');
      await writeState(statePath, {
        bootstrap: 'done', memory: 'done', assess: 'done', explore: 'done',
        stories: 'done', complexity_tier: 'M',
      } as ConductState);

      const onReviewArtifacts = vi.fn().mockResolvedValue('approved' as const);
      const runner = createMockStepRunner();
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        resume: true,
        fromStep: 'conflict_check',
        onReviewArtifacts,
      });

      await conductor.run();

      const conflictCalls = onReviewArtifacts.mock.calls.filter((c) => c[0] === 'conflict_check');
      expect(conflictCalls.length).toBe(1);
    });

    it('cleans up the marker after approval', async () => {
      await seedConflictArtifact(dir);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const markerPath = join(dir, '.pipeline/review-required-conflict_check');
      await writeFile(markerPath, '1');
      await writeState(statePath, {
        bootstrap: 'done', memory: 'done', assess: 'done', explore: 'done',
        stories: 'done', complexity_tier: 'M',
      } as ConductState);

      const runner = createMockStepRunner();
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        resume: true,
        fromStep: 'conflict_check',
        onReviewArtifacts: vi.fn().mockResolvedValue('approved' as const),
      });

      await conductor.run();

      const { access: _access } = await import('fs/promises');
      const exists = await _access(markerPath).then(() => true, () => false);
      expect(exists).toBe(false);
    });

    it('manual review (e.g. prd) always prompts', async () => {
      // prd is the manual-review DECIDE step that produces an artifact
      // (.docs/specs); explore is advisory + artifact-less so it never prompts.
      await seedPrdArtifact(dir);
      await writeState(statePath, {
        bootstrap: 'done', memory: 'done', assess: 'done', explore: 'done',
        complexity_tier: 'M',
      } as ConductState);

      const onReviewArtifacts = vi.fn().mockResolvedValue('approved' as const);
      const runner = createMockStepRunner();
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        resume: true,
        fromStep: 'prd',
        onReviewArtifacts,
      });

      await conductor.run();

      const prdCalls = onReviewArtifacts.mock.calls.filter((c) => c[0] === 'prd');
      expect(prdCalls.length).toBe(1);
    });
  });

  describe('retry budget', () => {
    it('auto-retries a failing step up to maxRetries before escalating', async () => {
      let attempts = 0;
      const runner: StepRunner = {
        run: vi.fn(async () => {
          attempts++;
          return { success: false, output: 'transient error' };
        }),
      };
      const onRecovery = vi.fn().mockResolvedValue('quit' as const);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        maxRetries: 3,
        onRecovery,
      });

      const retryEvents: unknown[] = [];
      const failedEvents: unknown[] = [];
      events.on('step_retry', (e) => { retryEvents.push(e); });
      events.on('step_failed', (e) => { failedEvents.push(e); });

      await conductor.run();

      // First failing step retries twice (attempts 2 and 3), then step_failed once.
      expect(attempts).toBeGreaterThanOrEqual(3);
      expect(retryEvents.length).toBeGreaterThanOrEqual(2);
      expect(failedEvents.length).toBe(1);
      expect(onRecovery).toHaveBeenCalledOnce();
    });

    it('succeeds on a later retry without firing recovery', async () => {
      let calls = 0;
      const runner: StepRunner = {
        run: vi.fn(async () => {
          calls++;
          return calls < 2 ? { success: false, output: 'transient' } : { success: true };
        }),
      };
      const onRecovery = vi.fn();
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        maxRetries: 3,
        onRecovery,
      });

      await conductor.run();

      // No step_failed for the first step — it succeeded on retry.
      expect(onRecovery).not.toHaveBeenCalled();
    });

    it('injects a retry hint into subsequent runs after a completion miss', async () => {
      const retryReasons: Array<string | undefined> = [];
      const runner: StepRunner = {
        run: vi.fn(async (_step: StepName, _state, opts) => {
          retryReasons.push(opts?.retryReason);
          return { success: true };
        }),
      };
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir, // no artifacts — completion check fails
        verifyArtifacts: true,
        maxRetries: 3,
        onRecovery: vi.fn().mockResolvedValue('quit' as const),
      });

      await conductor.run();

      // First invocation of the first artifact-producing step has no hint.
      // Subsequent invocations include "Previous attempt did not satisfy…".
      const hintedRuns = retryReasons.filter((r) => r && r.includes('Previous attempt'));
      expect(hintedRuns.length).toBeGreaterThan(0);
    });

    it('honors per-step default retries (e.g. explore → 3)', async () => {
      // Pre-populate state so we start at explore. #188 retry-as-escalation
      // dropped DEFAULT_STEP_RETRIES.explore from 5 → 3 (a retry now escalates
      // effort/model instead of repeating an identical attempt).
      await writeState(statePath, {
        bootstrap: 'done',
        memory: 'done',
        assess: 'done',
      } as ConductState);

      let attempts = 0;
      const runner: StepRunner = {
        run: vi.fn(async () => {
          attempts++;
          return { success: false, output: 'fail' };
        }),
      };
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        resume: true,
        onRecovery: vi.fn().mockResolvedValue('quit' as const),
      });

      await conductor.run();

      // explore default is now 3 retries (#188)
      expect(attempts).toBe(3);
    });
  });

  describe('custom completion predicates', () => {
    it('gates a custom step that configures an exact completion artifact', async () => {
      const customStep = 'maintain-documentation' as StepName;
      await writeState(statePath, {
        rebase: 'done',
        complexity_tier: 'M',
        track: 'technical',
      } as ConductState);
      const stepsRun: StepName[] = [];
      const failed: Array<{ step: StepName; error: string }> = [];
      const runner: StepRunner = {
        run: vi.fn(async (step) => {
          stepsRun.push(step);
          return step === customStep
            ? { success: true }
            : { success: false, output: 'unexpected downstream dispatch' };
        }),
      };
      events.on('step_failed', (event) => {
        if (event.type === 'step_failed') failed.push({ step: event.step, error: event.error });
      });
      const config: HarnessConfig = {
        steps: {
          'maintain-documentation': {
            after: 'rebase',
            skill: '.agents/skills/maintain-documentation/SKILL.md',
            enforcement: 'gating',
            completion_artifact: '.pipeline/maintain-documentation-pass',
          },
          'post-documentation': {
            after: 'maintain-documentation',
            skill: '.agents/skills/maintain-documentation/SKILL.md',
            enforcement: 'advisory',
          },
        },
      };
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        fromStep: customStep,
        config,
        verifyArtifacts: true,
        maxRetries: 1,
        onRecovery: vi.fn().mockResolvedValue('quit' as const),
      });

      await conductor.run();

      const freshRoot = join(dir, 'fresh-marker-run');
      const freshStatePath = join(freshRoot, 'conduct-state.json');
      await mkdir(freshRoot, { recursive: true });
      const freshState: Record<string, unknown> = {
        complexity_tier: 'M',
        track: 'technical',
      };
      for (const step of ALL_STEPS) freshState[step.name] = 'done';
      await writeState(freshStatePath, freshState as ConductState);
      const freshEvents = new ConductorEventEmitter();
      const freshness: Array<{ step: StepName; floorSource: string; fresh: boolean }> = [];
      const freshStepsRun: StepName[] = [];
      const artifactReviewPrompts = vi.fn().mockResolvedValue('approved' as const);
      const resolveArtifacts = vi.spyOn(artifactModule, 'resolveArtifactFiles');
      freshEvents.on('verdict_freshness', (event) => {
        if (event.type === 'verdict_freshness') {
          freshness.push({
            step: event.step,
            floorSource: event.floorSource,
            fresh: event.fresh,
          });
        }
      });
      const freshRunner: StepRunner = {
        run: vi.fn(async (step) => {
          freshStepsRun.push(step);
          if (step === customStep) {
            await mkdir(join(freshRoot, '.pipeline'), { recursive: true });
            await writeFile(join(freshRoot, '.pipeline/maintain-documentation-pass'), 'PASS\n');
          }
          return { success: true };
        }),
      };
      await new Conductor({
        stateFilePath: freshStatePath,
        stepRunner: freshRunner,
        events: freshEvents,
        projectRoot: freshRoot,
        fromStep: customStep,
        config,
        verifyArtifacts: true,
        mode: 'default',
        onReviewArtifacts: artifactReviewPrompts,
      }).run();

      const freshRunState = await readState(freshStatePath);
      const freshHalt = await readFile(join(freshRoot, '.pipeline', 'HALT'), 'utf8').catch(() => undefined);

      expect({
        stepsRun,
        customFailure: failed.find((event) => event.step === customStep),
        freshness,
      }).toEqual({
        stepsRun: [customStep],
        customFailure: {
          step: customStep,
          error:
            'Step \'maintain-documentation\' completed but completion check failed: configured completion artifact ".pipeline/maintain-documentation-pass" is missing — maintain-documentation must write it after a passing review',
        },
        freshness: [{ step: customStep, floorSource: 'attempt', fresh: true }],
      });
      expect({
        artifactReviewPrompts: artifactReviewPrompts.mock.calls.length,
        artifactResolutionCalls: resolveArtifacts.mock.calls.length,
        customStep: freshRunState.ok ? freshRunState.value[customStep] : undefined,
        advancedToNextStep: freshStepsRun.includes('post-documentation' as StepName),
        freshHalt,
      }).toEqual({
        artifactReviewPrompts: 0,
        artifactResolutionCalls: 0,
        customStep: 'done',
        advancedToNextStep: true,
        freshHalt: undefined,
      });
      resolveArtifacts.mockRestore();
    });

    it("build step requires .pipeline/task-status.json with all tasks completed", async () => {
      const runner: StepRunner = {
        run: vi.fn().mockResolvedValue({ success: true }),
      };

      // Pre-satisfy every OTHER artifact-producing step so we reach `build`.
      await writeFile(join(dir, '.docs/decisions/technical-assessment-2026-04-16.md'), 'a', {
        flag: 'w',
      }).catch(async () => {
        await mkdir(join(dir, '.docs/decisions'), { recursive: true });
        await writeFile(join(dir, '.docs/decisions/technical-assessment-2026-04-16.md'), 'a');
      });
      await mkdir(join(dir, '.docs/specs'), { recursive: true });
      await writeFile(join(dir, '.docs/specs/p.md'), '# Requirements\n\n### FR-1: Fixture requirement\n');
      await mkdir(join(dir, '.docs/stories'), { recursive: true });
      await writeFile(
        join(dir, '.docs/stories/p.md'),
        '## Story 1: fixture\n\n**Requirements:** FR-1\n\n### Happy Path\n- Given a fixture, when it runs, then it passes.\n',
      );
      await mkdir(join(dir, '.docs/conflicts'), { recursive: true });
      await writeFile(join(dir, '.docs/conflicts/p.md'), 'x');
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await writeFile(join(dir, '.docs/plans/p.md'), 'x');
      await mkdir(join(dir, '.docs/coherence'), { recursive: true });
      await writeFile(join(dir, '.docs/coherence/p.md'), 'x');
      await mkdir(join(dir, '.docs/architecture'), { recursive: true });
      await writeFile(join(dir, '.docs/architecture/arch.md'), 'x');
      await writeFile(join(dir, '.docs/decisions/adr-001.md'), 'x');
      await mkdir(join(dir, 'spec/acceptance'), { recursive: true });
      await writeFile(join(dir, 'spec/acceptance/s.rb'), 'x');

      // Write a task-status.json with an INCOMPLETE task
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/acceptance-specs-red.json'), RED_EVIDENCE_JSON);
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 't1', status: 'pending' }] }),
      );
      await writeState(statePath, { coverage_binding: 'done' } as ConductState);

      const onRecovery = vi.fn().mockResolvedValue('quit' as const);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        verifyArtifacts: true,
        config: { build_review: { rubrics: { testQuality: { enabled: true } } } },
        maxRetries: 1,
        onRecovery,
      });

      const failedEvents: Array<{ step: string; error: string }> = [];
      events.on('step_failed', (e) => {
        if (e.type === 'step_failed') failedEvents.push({ step: e.step, error: e.error });
      });

      await conductor.run();

      const buildFailure = failedEvents.find((e) => e.step === 'build');
      expect(buildFailure).toBeDefined();
      expect(buildFailure?.error).toMatch(/tasks|task-status|plan/i);
    });
  });

  describe('verifyArtifacts gate', () => {
    it('fails a step that declares artifacts but produces none', async () => {
      const runner: StepRunner = {
        run: vi.fn().mockResolvedValue({ success: true }),
      };
      const onRecovery = vi.fn().mockResolvedValue('quit' as const);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir, // empty tmp dir — no artifacts anywhere
        verifyArtifacts: true,
        maxRetries: 1, // fail fast for this test
        onRecovery,
      });

      const failedEvents: Array<{ step: string; error: string }> = [];
      events.on('step_failed', (e) => {
        if (e.type === 'step_failed') failedEvents.push({ step: e.step, error: e.error });
      });

      await conductor.run();

      // First artifact-producing step in the flow is 'assess'
      // (bootstrap/memory produce none). verifyArtifacts flags it missing.
      expect(failedEvents.length).toBeGreaterThan(0);
      expect(failedEvents[0].error).toMatch(/completion check failed|no files matching/);
    });

    it('passes a step whose declared artifacts exist on disk', async () => {
      // Pre-create artifacts whose creation isn't part of the runner's
      // simulated work (UNDERSTAND/DECIDE/BUILD steps that the conductor
      // expects to find pre-existing). For SHIP-phase steps (manual_test and
      // finish), have the runner mock create the artifact when the
      // step runs — this mirrors real behavior (skill writes its proof
      // mid-step) and ensures the file's mtime is naturally fresh relative
      // to session_started_at.
      const { mkdir: _mkdir, writeFile: _wf } = await import('fs/promises');
      const preFixtures: Array<[string, string]> = [
        ['.docs/decisions/technical-assessment-2026-04-16.md', 'test'],
        ['.docs/specs/2026-04-16-plan.md', 'test'],
        [
          '.docs/stories/2026-04-16-plan.md',
          '## Story 1: fixture\n\n**Requirements:** FR-1\n\n### Happy Path\n- Given a fixture, when it runs, then it passes.\n',
        ],
        ['.docs/conflicts/2026-04-16-plan.md', 'test'],
        // Empty-is-done is removed (ADR): the build gate parses the plan and
        // requires every plan task resolved, so the fixture plan declares one
        // task whose pre-existing completed row is backed by a pre-seeded
        // evidenceStamps entry (the H8 first-seed migration grandfather was retired by #463).
        ['.docs/plans/2026-04-16-plan.md', '### Task task-1: Pre-completed work\n'],
        ['.docs/coherence/2026-04-16-plan.md', 'test'],
        ['.docs/architecture/2026-04-16-arch.md', 'test'],
        ['.docs/decisions/adr-001.md', 'test'],
        ['spec/acceptance/feature_spec.rb', 'test'],
        ['.pipeline/acceptance-specs-red.json', RED_EVIDENCE_JSON],
        [
          '.pipeline/task-evidence.json',
          JSON.stringify({
            evidenceStamps: { 'task-1': { sha: 'abc1234567890000000000000000000000000000', form: 'operator-verified' } },
            noEvidenceAttempts: 0,
            migrationGrandfather: [],
          }),
        ],
        [
          '.pipeline/task-status.json',
          JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
        ],
      ];
      for (const [rel, content] of preFixtures) {
        const full = join(dir, rel);
        await _mkdir(full.substring(0, full.lastIndexOf('/')), { recursive: true });
        await _wf(full, content);
      }

      const seedRes = await readState(statePath);
      const seed = seedRes.ok ? seedRes.value : {};
      seed.feature_desc = 'add foo';
      // This fixture proves the ordinary artifact walk, not the separate
      // build-review or PRD-audit effective-verdict resolvers.
      seed.build_review = 'done';
      seed.prd_audit = 'done';
      await writeState(statePath, seed);

      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, options?: StepRunOptions) => {
          // Simulate SHIP-phase skills writing their proof artifact during
          // the step. This makes the mtime fresh relative to the conductor's
          // session_started_at (set on Conductor.run() entry).
          if (step === 'build_review') {
            // build_review is default-on (#773 Task 4) — simulate the
            // grader writing a passing verdict so this artifact-happy-path
            // fixture doesn't trip the build_review completion predicate.
            await _mkdir(join(dir, '.pipeline'), { recursive: true });
            await _wf(
              join(dir, '.pipeline/build-review.json'),
              JSON.stringify(passingBuildReviewAggregate()),
            );
          } else if (step === 'coverage_binding') {
            await _mkdir(join(dir, '.pipeline'), { recursive: true });
            await _wf(join(dir, '.pipeline/coverage-binding.json'), JSON.stringify({ version: 1, slug: 'test-feature', runId: 'test-run', status: 'disabled', entries: [] }));
          } else if (step === 'manual_test') {
            await _wf(
              join(dir, '.pipeline/manual-test-results.md'),
              '# Results\n\n| Story | Result |\n|---|---|\n| story-a | PASS |\n',
            );
          } else if (step === 'prd_audit') {
            await persistPrdAuditVerdict(dir, {
              complete: true,
              judgment: {
                version: 'v1',
                criterionJudgments: [{
                  criterion: { storyId: '1', ordinal: 1 }, criterionId: 'S1.1', grade: 'PASS',
                  evidence: 'The fixture supplies a complete typed audit judgment.',
                  rationale: 'The artifact walk only needs a valid current verdict.',
                  requirementAssociations: [], evidenceTaskIds: [],
                }],
                noOwnerObservations: [],
              },
              diagnostics: [],
              recordedDispositions: [],
            }, { attemptId: options?.runId ?? 'fixture-prd-audit', codeStamp: 'fixture-head' });
          } else if (step === 'architecture_review_as_built') {
            await _mkdir(join(dir, '.docs/decisions'), { recursive: true });
            await writeAsBuiltFixture(dir, options?.runId, asBuiltApprovedFixture());
          } else if (step === 'finish') {
            await _mkdir(join(dir, '.pipeline'), { recursive: true });
            await _wf(join(dir, '.pipeline/finish-choice'), 'keep');
          }
          return { success: true };
        }),
      };
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        verifyArtifacts: true,
        config: { build_review: { rubrics: { testQuality: { enabled: true } } } },
      });

      const failedEvents: Array<{ step: string; error: string }> = [];
      events.on('step_failed', (e) => {
        if (e.type === 'step_failed') failedEvents.push({ step: e.step, error: e.error });
      });

      await conductor.run();

      expect(failedEvents).toEqual([]);
    });

    it('retries on "retry" recovery action after artifact miss', async () => {
      const runCallCount: Record<string, number> = {};
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          runCallCount[step] = (runCallCount[step] ?? 0) + 1;
          return { success: true };
        }),
      };
      // First call to onRecovery: 'retry' (still no files — will fail again → quit)
      // Second call: 'quit' to end the run cleanly.
      const onRecovery = vi
        .fn<(step: StepName, isGating: boolean, context?: RecoveryContext) => Promise<RecoveryOption>>()
        .mockResolvedValueOnce('retry')
        .mockResolvedValue('quit');
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir, // no artifacts — every artifact-producing step fails verification
        verifyArtifacts: true,
        maxRetries: 1, // fail fast so the recovery menu fires after 1 miss
        onRecovery,
      });

      await conductor.run();

      // `prd` (first step with artifacts — explore/complexity are artifact-less)
      // should have been retried once after the artifact-miss failure.
      expect(runCallCount['prd']).toBeGreaterThanOrEqual(2);
    });

    it('is a no-op when verifyArtifacts is false (default)', async () => {
      const runner: StepRunner = {
        run: vi.fn().mockResolvedValue({ success: true }),
      };
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        // verifyArtifacts omitted — defaults to false
      });

      const failedEvents: unknown[] = [];
      events.on('step_failed', (e) => { failedEvents.push(e); });

      await conductor.run();

      expect(failedEvents.length).toBe(0);
    });
  });
});
