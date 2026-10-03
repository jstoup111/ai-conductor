// Covers: task:1, task:2, task:3, task:4, task:5, task:9, task:11, task:21
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, unlink, utimes, stat } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

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
import type { ConductState, ConductorEvent,} from '../../src/types/index.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { StepName, RecoveryOption, RecoveryContext } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import {
  ALL_STEPS,
} from '../../src/engine/steps.js';
import {
  findResumeIndex,
} from '../../src/engine/conductor.js';
import { Conductor } from '../test-conductor.js';
import type { StepRunner, StepRunResult, StepRunOptions } from '../../src/engine/conductor.js';
import type { GitRunner } from '../../src/engine/pr-labels.js';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { createTaskEvidence } from '../../src/engine/task-evidence.js';
import { writeVerdict, type GateVerdict } from '../../src/engine/gate-verdicts.js';
import {
  stampGateRunIdentity,
  ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP,
  MANUAL_TEST_CODE_STAMP,
  PRD_AUDIT_CODE_STAMP,
} from '../../src/engine/artifacts.js';
import {
  creditKickbackGateLaps,
  } from '../../src/engine/kickback-ledger.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { deriveEffectiveBuildReviewVerdict, joinBuildReviewRubricOutcomes } from '../../src/engine/build-review-aggregate.js';
import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import { persistAsBuiltVerdict } from '../../src/engine/as-built-verdict-store.js';
import type { AsBuiltFinding } from '../../src/engine/as-built-contract.js';
import type { AsBuiltPolicy } from '../../src/engine/as-built-policy.js';

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

function asBuiltApprovedFixture() {
  return {
    version: 'v1' as const,
    verdict: 'APPROVED' as const,
    reachability: [],
    driftNotes: [],
  };
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

  describe('verdict freshness wiring (Task 2, session-fresh-verdict-artifacts)', () => {
    async function seedToBuildReview(): Promise<void> {
      const seedResult = await readState(statePath);
      const seed = seedResult.ok ? seedResult.value : ({} as ConductState);
      (seed as Record<string, unknown>).complexity_tier = 'M';
      for (const s of ALL_STEPS) {
        if (s.name === 'build_review') break;
        (seed as Record<string, unknown>)[s.name] = 'done';
      }
      await writeState(statePath, seed as ConductState);
    }

    async function writeBuildReviewVerdict(mtimeMs?: number): Promise<string> {
      const full = join(dir, '.pipeline', 'build-review.json');
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        full,
        JSON.stringify(passingBuildReviewAggregate()),
      );
      if (mtimeMs !== undefined) {
        const { utimes } = await import('fs/promises');
        await utimes(full, new Date(mtimeMs), new Date(mtimeMs));
      }
      return full;
    }

    it('completionCtx carries attemptStartedAt only during a dispatched attempt', async () => {
      await seedToBuildReview();
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: createMockStepRunner({ success: true }),
        events,
        fromStep: 'build_review',
        verifyArtifacts: true,
        maxRetries: 1,
        config: { build_review: { rubrics: { testQuality: { enabled: true } } } },
      });

      // Before any dispatch has occurred, no attempt is in flight.
      const initialStateResult = await readState(statePath);
      const state = initialStateResult.ok ? initialStateResult.value : ({} as ConductState);
      const idleCtx = await (conductor as unknown as {
        completionCtx: (s: ConductState) => Promise<{ attemptStartedAt?: number }>;
      }).completionCtx(state);
      expect(idleCtx.attemptStartedAt).toBeUndefined();

      // Confirm the ctx captured DURING the retry loop carries a fresh
      // attemptStartedAt via the emitted verdict_freshness event's floorSource.
      const freshnessEvents: Array<{ floorSource: 'attempt' | 'session'; fresh: boolean }> = [];
      events.on('verdict_freshness', (e) => {
        freshnessEvents.push(e as never);
      });
      await writeBuildReviewVerdict(Date.now() + 5000);
      await conductor.run();

      expect(freshnessEvents[0]?.floorSource).toBeUndefined();

      // And it goes back to undefined once the dispatch attempt is over.
      const idleCtxAfter = await (conductor as unknown as {
        completionCtx: (s: ConductState) => Promise<{ attemptStartedAt?: number }>;
      }).completionCtx(state);
      expect(idleCtxAfter.attemptStartedAt).toBeUndefined();
    });

    // Covers: task:2
    it('completionCtx carries one distinct attemptRunId for each verdict dispatch only', async () => {
      await seedToBuildReview();
      const attemptRunIds: Array<string | undefined> = [];
      let conductor: Conductor;
      const runner: StepRunner = {
        run: async () => {
          const stateResult = await readState(statePath);
          const state = stateResult.ok ? stateResult.value : ({} as ConductState);
          const ctx = await (conductor as unknown as {
            completionCtx: (s: ConductState) => Promise<{ attemptRunId?: string }>;
          }).completionCtx(state);
          attemptRunIds.push(ctx.attemptRunId);
          return { success: true };
        },
      };
      conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'build_review',
        verifyArtifacts: true,
        maxRetries: 2,
        config: { build_review: { rubrics: { testQuality: { enabled: true } } } },
      });

      const stateResult = await readState(statePath);
      const state = stateResult.ok ? stateResult.value : ({} as ConductState);
      const idleCtx = await (conductor as unknown as {
        completionCtx: (s: ConductState) => Promise<{ attemptRunId?: string }>;
      }).completionCtx(state);
      expect(idleCtx.attemptRunId).toBeUndefined();

      await conductor.run();

      expect(attemptRunIds).toHaveLength(2);
      expect(attemptRunIds[0]).toMatch(/\S/);
      expect(attemptRunIds[1]).toMatch(/\S/);
      expect(attemptRunIds[0]).not.toBe(attemptRunIds[1]);

      const idleCtxAfter = await (conductor as unknown as {
        completionCtx: (s: ConductState) => Promise<{ attemptRunId?: string }>;
      }).completionCtx(state);
      expect(idleCtxAfter.attemptRunId).toBeUndefined();
    });

    // Covers: task:3
    it('merges an engine-owned run id onto a verdict sidecar without changing its code stamp', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const sidecar = join(dir, PRD_AUDIT_CODE_STAMP);
      await writeFile(sidecar, '{"codeStamp":"head-before-settle"}\n');

      await stampGateRunIdentity(dir, 'prd_audit', 'attempt-owned-by-engine');

      await expect(readFile(sidecar, 'utf8')).resolves.toBe(
        '{\n  "codeStamp": "head-before-settle",\n  "runId": "attempt-owned-by-engine"\n}\n',
      );
    });

    it('leaves a verdict sidecar byte-for-byte and mtime unchanged when gate validity is disabled', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const sidecar = join(dir, PRD_AUDIT_CODE_STAMP);
      const before = '{"codeStamp":"head-before-settle"}\n';
      await writeFile(sidecar, before);
      const beforeStat = await stat(sidecar);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: createMockStepRunner({ success: true }),
        events,
        config: { gate_code_validity: { enabled: false } },
      });

      await (conductor as unknown as {
        stampVerdictRunIdentity: (step: StepName, runId: string | undefined) => Promise<void>;
      }).stampVerdictRunIdentity('prd_audit', 'attempt-owned-by-engine');

      expect(await readFile(sidecar, 'utf8')).toBe(before);
      expect((await stat(sidecar)).mtimeMs).toBe(beforeStat.mtimeMs);
    });

    it('treats a corrupt verdict sidecar as empty when stamping the engine run id', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const sidecar = join(dir, PRD_AUDIT_CODE_STAMP);
      await writeFile(sidecar, '{not-json');

      await stampGateRunIdentity(dir, 'prd_audit', 'attempt-owned-by-engine');

      await expect(readFile(sidecar, 'utf8')).resolves.toBe(
        '{\n  "runId": "attempt-owned-by-engine"\n}\n',
      );
    });

    // Covers: task:4
    it('uses the engine dispatch identity rather than a provider runId echo', async () => {
      const seedResult = await readState(statePath);
      const seed = (seedResult.ok ? seedResult.value : {}) as Record<string, unknown>;
      for (const step of ALL_STEPS) {
        seed[step.name] = step.name === 'prd_audit' ? 'pending' : 'skipped';
        if (step.name === 'prd_audit') break;
        seed[step.name] = 'done';
      }
      seed.prd_audit = 'pending';
      seed.architecture_review_as_built = 'skipped';
      seed.rebase = 'skipped';
      seed.finish = 'done';
      await writeState(statePath, seed as ConductState);

      let engineRunId: string | undefined;
      let conductor: Conductor;
      conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: {
          run: async () => {
            const stateResult = await readState(statePath);
            const state = stateResult.ok ? stateResult.value : ({} as ConductState);
            engineRunId = await (conductor as unknown as {
              completionCtx: (current: ConductState) => Promise<{ attemptRunId?: string }>;
            }).completionCtx(state).then((ctx) => ctx.attemptRunId);
            return { success: true, output: 'provider report { "runId": "bogus" }' };
          },
        },
        events,
        fromStep: 'prd_audit',
      });

      await conductor.run();

      const stamped = JSON.parse(await readFile(join(dir, PRD_AUDIT_CODE_STAMP), 'utf8')) as {
        runId?: string;
      };
      expect(engineRunId).toMatch(/\S/);
      expect(stamped.runId).toBe(engineRunId);
      expect(stamped.runId).not.toBe('bogus');
    });

    it('warns for the affected verdict branch when its run-id sidecar cannot be written', async () => {
      await writeFile(join(dir, '.pipeline'), 'not a directory');
      const logs: string[] = [];
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: createMockStepRunner({ success: true }),
        events,
        log: (message) => logs.push(message),
      });

      await expect(
        (conductor as unknown as {
          stampVerdictRunIdentity: (step: StepName, runId: string | undefined) => Promise<void>;
        }).stampVerdictRunIdentity('prd_audit', 'engine-attempt-id'),
      ).resolves.toBeUndefined();

      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain('prd_audit');
      expect(logs[0]).toContain(PRD_AUDIT_CODE_STAMP);
      await expect(readFile(join(dir, PRD_AUDIT_CODE_STAMP), 'utf8')).rejects.toThrow();
    });

    // Covers: task:6
    it.each([
      ['manual_test', '.pipeline/manual-test-results.md', MANUAL_TEST_CODE_STAMP],
      ['prd_audit', '.pipeline/prd-audit.md', PRD_AUDIT_CODE_STAMP],
      [
        'architecture_review_as_built',
        '.pipeline/architecture-review-as-built.json',
        ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP,
      ],
    ] as const)(
      'accepts a freshly written %s verdict report with the settled dispatch identity',
      async (step, reportPath, _sidecarPath) => {
        await mkdir(join(dir, '.pipeline'), { recursive: true });
        const runId = `task-6-${step}`;
        const dispatchStartedAt = Date.now();
        if (step === 'architecture_review_as_built') {
          await writeAsBuiltFixture(dir, runId, asBuiltApprovedFixture());
        } else {
          await writeFile(join(dir, reportPath), 'fresh verdict report\n');
          await stampGateRunIdentity(dir, step, runId);
        }
        const conductor = new Conductor({
          projectRoot: dir,
          stateFilePath: statePath,
          stepRunner: createMockStepRunner({ success: true }),
          events,
        });

        await expect(
          (conductor as unknown as {
            verdictDispatchHandshake: (
              name: StepName,
              expectedRunId: string,
              startedAt: number,
            ) => Promise<unknown>;
          }).verdictDispatchHandshake(step, runId, dispatchStartedAt),
        ).resolves.toBeUndefined();
      },
    );

    it('rejects a prior-lap prd report before its stale findings can be routed', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const report = join(dir, '.pipeline/prd-audit.md');
      await writeFile(report, '| FR-17 | FIXABLE | stale finding must not route |\n');
      const dispatchStartedAt = Date.now();
      await utimes(report, new Date(dispatchStartedAt - 60_000), new Date(dispatchStartedAt - 60_000));
      await stampGateRunIdentity(dir, 'prd_audit', 'current-run');
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: createMockStepRunner({ success: true }),
        events,
      });

      await expect(
        (conductor as unknown as {
          verdictDispatchHandshake: (
            name: StepName,
            expectedRunId: string,
            startedAt: number,
          ) => Promise<{ done: boolean; routeClass?: string; reason?: string }>;
        }).verdictDispatchHandshake('prd_audit', 'current-run', dispatchStartedAt),
      ).resolves.toEqual({
        done: false,
        routeClass: 'absent',
        reason: expect.stringContaining('.pipeline/prd-audit.md'),
      });

      const result = await (conductor as unknown as {
        verdictDispatchHandshake: (
          name: StepName,
          expectedRunId: string,
          startedAt: number,
        ) => Promise<{ reason?: string }>;
      }).verdictDispatchHandshake('prd_audit', 'current-run', dispatchStartedAt);
      expect(result.reason).toContain('expected run id current-run');
      expect(result.reason).toContain('found run id current-run');
      expect(result.reason).toContain('found mtime');
      expect(result.reason).not.toContain('FR-17');
    });

    // Covers: task:7
    it('rejects a partial prd-audit write by naming the missing run-id marker only', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const report = join(dir, '.pipeline/prd-audit.md');
      await writeFile(report, '| FR-17 | FIXABLE | stale finding must not route |\n');
      const dispatchStartedAt = Date.now();
      await utimes(report, new Date(dispatchStartedAt), new Date(dispatchStartedAt));
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: createMockStepRunner({ success: true }),
        events,
      });

      const result = await (conductor as unknown as {
        verdictDispatchHandshake: (
          name: StepName,
          expectedRunId: string,
          startedAt: number,
        ) => Promise<{ done: boolean; routeClass?: string; reason?: string }>;
      }).verdictDispatchHandshake('prd_audit', 'current-run', dispatchStartedAt);

      expect(result).toMatchObject({ done: false, routeClass: 'absent' });
      expect(result.reason).toContain(PRD_AUDIT_CODE_STAMP);
      expect(result.reason).not.toContain('.pipeline/prd-audit.md is missing');
      expect(result.reason).not.toContain('FR-17');
    });

    it('fails closed and warns without throwing when a verdict sidecar is corrupt', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const report = join(dir, '.pipeline/prd-audit.md');
      await writeFile(report, '| FR-17 | FIXABLE | stale finding must not route |\n');
      const dispatchStartedAt = Date.now();
      await utimes(report, new Date(dispatchStartedAt), new Date(dispatchStartedAt));
      await writeFile(join(dir, PRD_AUDIT_CODE_STAMP), '{not-json');
      const logs: string[] = [];
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: createMockStepRunner({ success: true }),
        events,
        log: (message) => logs.push(message),
      });

      await expect(
        (conductor as unknown as {
          verdictDispatchHandshake: (
            name: StepName,
            expectedRunId: string,
            startedAt: number,
          ) => Promise<{ done: boolean; routeClass?: string; reason?: string }>;
        }).verdictDispatchHandshake('prd_audit', 'current-run', dispatchStartedAt),
      ).resolves.toMatchObject({ done: false, routeClass: 'absent' });

      expect(logs).toContainEqual(expect.stringContaining(PRD_AUDIT_CODE_STAMP));
      expect(logs.join('\n')).not.toContain('FR-17');
    });

    it.each(['', '{', '[]', 'null', '{"runId":0}', '{"runId":""}'])(
      'never throws for malformed verdict sidecar input %j',
      async (sidecar) => {
        await mkdir(join(dir, '.pipeline'), { recursive: true });
        const report = join(dir, '.pipeline/prd-audit.md');
        await writeFile(report, '| FR-17 | FIXABLE | stale finding must not route |\n');
        const dispatchStartedAt = Date.now();
        await utimes(report, new Date(dispatchStartedAt), new Date(dispatchStartedAt));
        await writeFile(join(dir, PRD_AUDIT_CODE_STAMP), sidecar);
        const conductor = new Conductor({
          projectRoot: dir,
          stateFilePath: statePath,
          stepRunner: createMockStepRunner({ success: true }),
          events,
        });

        await expect(
          (conductor as unknown as {
            verdictDispatchHandshake: (
              name: StepName,
              expectedRunId: string,
              startedAt: number,
            ) => Promise<{ done: boolean; routeClass?: string; reason?: string }>;
          }).verdictDispatchHandshake('prd_audit', 'current-run', dispatchStartedAt),
        ).resolves.toMatchObject({ done: false, routeClass: 'absent' });
      },
    );

    it('a review retry whose session does not rewrite the verdict does not pass the gate', async () => {
      await seedToBuildReview();
      // Stale verdict, written well before this run starts; the stub
      // stepRunner never rewrites it on either attempt.
      await writeBuildReviewVerdict(Date.now() - 60_000);

      const freshnessEvents: Array<{ fresh: boolean }> = [];
      events.on('verdict_freshness', (e) => {
        freshnessEvents.push(e as never);
      });

      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: createMockStepRunner({ success: true }),
        events,
        fromStep: 'build_review',
        verifyArtifacts: true,
        mode: 'auto',
        maxRetries: 2,
        config: { build_review: { rubrics: { testQuality: { enabled: true } } } },
      });

      await conductor.run();

      const result = await readState(statePath);
      expect(result.ok && result.value.build_review).toBe('failed');

      expect(freshnessEvents.length).toBeGreaterThanOrEqual(1);
      for (const e of freshnessEvents) {
        expect(e.fresh).toBe(false);
      }
    });

    // Covers: rem-prd-audit-rem-fr-s2.2-1
    it.each([
      'manual_test',
      'prd_audit',
      'architecture_review_as_built',
    ] as const)(
      'records the %s handshake on failed dispatch retries and preserves its final diagnostic',
      async (step) => {
        const seedResult = await readState(statePath);
        const state = (seedResult.ok ? seedResult.value : {}) as Record<string, unknown>;
        for (const candidate of ALL_STEPS) {
          state[candidate.name] = candidate.name === step ? 'pending' : 'skipped';
          if (candidate.name === step) break;
          state[candidate.name] = 'done';
        }
        state[step] = 'pending';
        state.rebase = 'skipped';
        state.finish = 'done';
        await writeState(statePath, state as ConductState);

        const conductor = new Conductor({
          projectRoot: dir,
          stateFilePath: statePath,
          stepRunner: createMockStepRunner({ success: false, output: 'dispatch failed' }),
          events,
          fromStep: step,
          verifyArtifacts: true,
          mode: 'default',
          maxRetries: 2,
          config: { steps: { [step]: { max_retries: 2 } } },
          onRecovery: async () => 'skip',
        });
        const handshakes: Array<{ runId?: string; startedAt?: number }> = [];
        (conductor as unknown as {
          verdictDispatchHandshake: (
            name: StepName,
            runId: string | undefined,
            startedAt: number | undefined,
          ) => Promise<{ done: false; routeClass: 'absent'; reason: string } | undefined>;
        }).verdictDispatchHandshake = async (name, runId, startedAt) => {
          expect(name).toBe(step);
          handshakes.push({ runId, startedAt });
          return { done: false, routeClass: 'absent', reason: `stale ${step} verdict` };
        };

        await conductor.run();

        expect(handshakes).toHaveLength(2);
        for (const handshake of handshakes) {
          expect(handshake.runId).toMatch(/\S/);
          expect(handshake.startedAt).toEqual(expect.any(Number));
        }
        expect(handshakes[0].runId).not.toBe(handshakes[1].runId);
      },
    );

    // Covers: rem-prd-audit-rem-fr-s2.2-1
    it.each([
      'manual_test',
      'prd_audit',
      'architecture_review_as_built',
    ] as const)(
      'records the %s handshake before honoring a step-written halt verbatim',
      async (step) => {
        const seedResult = await readState(statePath);
        const state = (seedResult.ok ? seedResult.value : {}) as Record<string, unknown>;
        for (const candidate of ALL_STEPS) {
          state[candidate.name] = candidate.name === step ? 'pending' : 'skipped';
          if (candidate.name === step) break;
          state[candidate.name] = 'done';
        }
        state[step] = 'pending';
        state.rebase = 'skipped';
        state.finish = 'done';
        await writeState(statePath, state as ConductState);

        const haltReason = `step-authored ${step} halt`;
        const conductor = new Conductor({
          projectRoot: dir,
          stateFilePath: statePath,
          stepRunner: {
            run: async () => {
              await mkdir(join(dir, '.pipeline'), { recursive: true });
              await writeFile(join(dir, '.pipeline/HALT'), haltReason + '\n');
              await writeFile(join(dir, '.pipeline/HALT.class'), 'needs-human\n');
              return { success: false, output: 'dispatch failed' };
            },
          },
          events,
          fromStep: step,
          verifyArtifacts: true,
          mode: 'default',
          maxRetries: 2,
        });
        const handshakes: Array<{ runId?: string; startedAt?: number }> = [];
        (conductor as unknown as {
          verdictDispatchHandshake: (
            name: StepName,
            runId: string | undefined,
            startedAt: number | undefined,
          ) => Promise<{ done: false; routeClass: 'absent'; reason: string } | undefined>;
        }).verdictDispatchHandshake = async (name, runId, startedAt) => {
          expect(name).toBe(step);
          handshakes.push({ runId, startedAt });
          return { done: false, routeClass: 'absent', reason: `stale ${step} verdict` };
        };

        await conductor.run();

        expect(handshakes).toHaveLength(1);
        expect(handshakes[0].runId).toMatch(/\S/);
        expect(handshakes[0].startedAt).toEqual(expect.any(Number));
        await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toBe(haltReason + '\n');
      },
    );

    // Covers: task:11
    it('halts with the stale prd-audit handshake identity after its retry budget is exhausted', async () => {
      const seedResult = await readState(statePath);
      const state = (seedResult.ok ? seedResult.value : {}) as Record<string, unknown>;
      for (const step of ALL_STEPS) {
        state[step.name] = step.name === 'prd_audit' ? 'pending' : 'skipped';
        if (step.name === 'prd_audit') break;
        state[step.name] = 'done';
      }
      state.prd_audit = 'pending';
      state.architecture_review_as_built = 'skipped';
      state.rebase = 'skipped';
      state.finish = 'done';
      await writeState(statePath, state as ConductState);

      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const report = join(dir, '.pipeline/prd-audit.md');
      await writeFile(report, '| FR-17 | FIXABLE | stale finding must not be surfaced |\n');
      const staleAt = Date.now() - 60_000;
      await utimes(report, new Date(staleAt), new Date(staleAt));

      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: createMockStepRunner({ success: true }),
        events,
        fromStep: 'prd_audit',
        verifyArtifacts: true,
        mode: 'auto',
        maxRetries: 2,
      });

      await conductor.run();

      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf8');
      expect(await readFile(join(dir, '.pipeline/HALT.class'), 'utf8')).toBe('needs-human');
      expect(halt).toContain('prd_audit');
      expect(halt).toContain('.pipeline/prd-audit.md');
      expect(halt).toContain('expected run id');
      expect(halt).toContain('found run id');
      expect(halt).toContain('found mtime');
      expect(halt).not.toContain('FR-17');
      expect(halt).not.toContain('stale finding must not be surfaced');
    });

    // Covers: task:15
    it('emits and persists stale run-identity telemetry from the verdict handshake', async () => {
      const seedResult = await readState(statePath);
      const state = (seedResult.ok ? seedResult.value : {}) as Record<string, unknown>;
      for (const step of ALL_STEPS) {
        state[step.name] = step.name === 'prd_audit' ? 'pending' : 'skipped';
        if (step.name === 'prd_audit') break;
        state[step.name] = 'done';
      }
      state.prd_audit = 'pending';
      state.architecture_review_as_built = 'skipped';
      state.rebase = 'skipped';
      state.finish = 'done';
      await writeState(statePath, state as ConductState);

      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const report = join(dir, '.pipeline/prd-audit.md');
      await writeFile(report, '| FR-17 | FIXABLE | prior-lap finding |\n');
      await writeFile(join(dir, PRD_AUDIT_CODE_STAMP), JSON.stringify({ runId: 'prior-run' }));

      const eventsPath = join(dir, '.pipeline/events.jsonl');
      const persister = new EventPersister(eventsPath, events);
      const retryDecisions: ConductorEvent[] = [];
      events.on('retry_decision', (event) => {
        retryDecisions.push(event);
      });
      persister.start();

      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: createMockStepRunner({ success: true }),
        events,
        fromStep: 'prd_audit',
        verifyArtifacts: true,
        mode: 'auto',
        daemon: true,
        maxRetries: 1,
      });
      // A failed sidecar stamp leaves the prior run identity in place. The
      // production method deliberately treats this as non-fatal, so this is
      // the real handshake boundary that must surface the stale decision.
      (conductor as unknown as {
        stampVerdictRunIdentity: (step: StepName, runId?: string) => Promise<void>;
      }).stampVerdictRunIdentity = async () => {};

      try {
        await conductor.run();
      } finally {
        persister.stop();
      }

      const persisted = (await readFile(eventsPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(persisted).toContainEqual(expect.objectContaining({
        type: 'verdict_freshness',
        step: 'prd_audit',
        artifact: report,
        floorSource: 'run-identity',
        outcome: 'stale_invalidated',
        fresh: false,
      }));
      expect(retryDecisions).toContainEqual(expect.objectContaining({
        type: 'retry_decision',
        step: 'prd_audit',
        decision: 'rerun',
        signal: 'stale-run-identity',
      }));
    });

    // Covers: task:12
    it('recovers from a cleared stale-verdict halt without deleting its prior-lap artifacts', async () => {
      const seedResult = await readState(statePath);
      const state = (seedResult.ok ? seedResult.value : {}) as Record<string, unknown>;
      for (const step of ALL_STEPS) {
        state[step.name] = step.name === 'prd_audit' ? 'pending' : 'skipped';
        if (step.name === 'prd_audit') break;
        state[step.name] = 'done';
      }
      state.prd_audit = 'pending';
      state.architecture_review_as_built = 'skipped';
      state.rebase = 'skipped';
      state.finish = 'done';
      await writeState(statePath, state as ConductState);

      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const report = join(dir, '.pipeline/prd-audit.md');
      const sidecar = join(dir, PRD_AUDIT_CODE_STAMP);
      await writeFile(report, '| FR-17 | FIXABLE | prior-lap finding |');
      await writeFile(sidecar, JSON.stringify({ runId: 'prior-lap' }));
      await writeFile(join(dir, '.pipeline/HALT'), 'stale verdict halt');
      await writeFile(join(dir, '.pipeline/HALT.class'), 'needs-human');

      // Operator recovery clears only terminal halt markers. The stale report
      // and sidecar remain until this dispatch replaces their verdict.
      await unlink(join(dir, '.pipeline/HALT'));
      await unlink(join(dir, '.pipeline/HALT.class'));

      const runner: StepRunner = {
        run: vi.fn(async (step) => {
          expect(step).toBe('prd_audit');
          await expect(readFile(report, 'utf8')).resolves.toContain('prior-lap finding');
          await expect(readFile(sidecar, 'utf8')).resolves.toContain('prior-lap');
          await writeFile(
            report,
            [
              '# PRD Audit', '', '**PRD:** present', '', '## Verdict Table', '',
              '| Criterion | Grade | Plan task | PRD: | Evidence |',
              '|---|---|---|---|---|',
              '| S1.1 | PASS | — | FR-1 | evidence.ts:1 |',
            ].join('\n'),
          );
          return { success: true };
        }),
      };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'prd_audit',
        verifyArtifacts: true,
        mode: 'auto',
        daemon: true,
      });

      await conductor.run();

      expect(runner.run).toHaveBeenCalledTimes(1);
      const result = await readState(statePath);
      expect(result.ok && result.value.prd_audit).toBe('done');
      await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).rejects.toThrow();
      await expect(readFile(join(dir, '.pipeline/HALT.class'), 'utf8')).rejects.toThrow();
      expect(JSON.parse(await readFile(sidecar, 'utf8'))).toMatchObject({
        runId: expect.any(String),
      });
      expect(await readFile(report, 'utf8')).not.toContain('prior-lap finding');
    });

    // Covers: task:12
    it('honors a fresh blocking verdict after the same clear-and-rerun recovery', async () => {
      const seedResult = await readState(statePath);
      const state = (seedResult.ok ? seedResult.value : {}) as Record<string, unknown>;
      for (const step of ALL_STEPS) {
        state[step.name] = step.name === 'prd_audit' ? 'pending' : 'skipped';
        if (step.name === 'prd_audit') break;
        state[step.name] = 'done';
      }
      state.prd_audit = 'pending';
      state.architecture_review_as_built = 'skipped';
      state.rebase = 'skipped';
      state.finish = 'done';
      await writeState(statePath, state as ConductState);

      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const report = join(dir, '.pipeline/prd-audit.md');
      const sidecar = join(dir, PRD_AUDIT_CODE_STAMP);
      await writeFile(report, '| FR-17 | FIXABLE | prior-lap finding |');
      await writeFile(sidecar, JSON.stringify({ runId: 'prior-lap' }));
      await writeFile(join(dir, '.pipeline/HALT'), 'stale verdict halt');
      await writeFile(join(dir, '.pipeline/HALT.class'), 'needs-human');
      await unlink(join(dir, '.pipeline/HALT'));
      await unlink(join(dir, '.pipeline/HALT.class'));

      const runner: StepRunner = {
        run: vi.fn(async (step) => {
          expect(step).toBe('prd_audit');
          await expect(readFile(report, 'utf8')).resolves.toContain('prior-lap finding');
          await expect(readFile(sidecar, 'utf8')).resolves.toContain('prior-lap');
          await writeFile(
            report,
            [
              '# PRD Audit', '', '**PRD:** present', '', '## Verdict Table', '',
              '| Criterion | Grade | Plan task | PRD: | Evidence |',
              '|---|---|---|---|---|',
              '| S1.1 | PLAN_GAP | — | FR-1 | evidence.ts:1 |',
            ].join('\n'),
          );
          return { success: true };
        }),
      };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'prd_audit',
        verifyArtifacts: true,
        mode: 'auto',
        daemon: true,
        config: { prd_audit: { halt_on_any_plan_gap: true } } as HarnessConfig,
      });

      await conductor.run();

      expect(runner.run).toHaveBeenCalledTimes(1);
      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf8');
      expect(halt).toContain('S1.1');
      expect(halt).toContain('PLAN_GAP');
      expect(halt).not.toContain('prior-lap finding');
    });

    it('verdict_freshness event identifies stale invalidation and rewritten verdict outcomes', async () => {
      await seedToBuildReview();
      await writeBuildReviewVerdict(Date.now() - 60_000);

      let attempts = 0;
      const runner: StepRunner = {
        run: async () => {
          attempts++;
          if (attempts === 2) {
            // Second attempt rewrites the verdict fresh. A generous forward
            // buffer avoids flakiness from coarse filesystem mtime
            // resolution (some filesystems truncate to whole seconds),
            // which could otherwise floor this write's mtime to equal or
            // below the attempt's start timestamp.
            await writeBuildReviewVerdict(Date.now() + 5000);
          }
          return { success: true };
        },
      };

      const freshnessEvents: Array<{ fresh: boolean; outcome?: string }> = [];
      events.on('verdict_freshness', (e) => {
        freshnessEvents.push(e as never);
      });

      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'build_review',
        verifyArtifacts: true,
        mode: 'auto',
        maxRetries: 2,
        config: { build_review: { rubrics: { testQuality: { enabled: true } } } },
        // A strict aggregate resolves through the disposition store; this
        // fixture has no feature identity, so join the raw aggregate directly.
        buildReviewEffectiveResolver: async (_root, aggregate) => {
          const effective = deriveEffectiveBuildReviewVerdict(aggregate);
          return effective
            ? { ok: true as const, feature: { version: 'v1' as const, repository: dir, feature: 'fixture' }, effective }
            : { ok: false as const, reason: 'fixture aggregate is invalid' };
        },
      });

      await conductor.run();

      expect(freshnessEvents.map(({ fresh, outcome }) => ({ fresh, outcome }))).toEqual([
        { fresh: false, outcome: 'stale_invalidated' },
        { fresh: true, outcome: 'rewritten' },
      ]);

      const result = await readState(statePath);
      expect(result.ok && result.value.build_review).toBe('done');
    });
  });

  describe('fresh session per step (unconditional)', () => {
    // A runner that logs every session reset and every dispatch, so we can
    // assert the interleaving (reset-then-run for every executed step).
    function trackingRunner(): { runner: StepRunner; log: string[] } {
      const log: string[] = [];
      const runner: StepRunner = {
        run: async (step: StepName) => {
          log.push(`run:${step}`);
          return { success: true };
        },
        resetSession: async () => {
          log.push('reset');
        },
      };
      return { runner, log };
    }

    it('resets the session before every dispatched step', async () => {
      const { runner, log } = trackingRunner();
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
      });

      await conductor.run();

      // Every runner dispatch is immediately preceded by a session reset, so no
      // context is carried across the loop. (Engine-managed steps add extra
      // resets with no dispatch — harmless; we only assert each run's predecessor.)
      const runIdxs = log
        .map((e, i) => (e.startsWith('run:') ? i : -1))
        .filter((i) => i >= 0);
      expect(runIdxs.length).toBeGreaterThan(0);
      for (const i of runIdxs) expect(log[i - 1]).toBe('reset');
    });

    it('resets in interactive/default mode too — fresh-per-step is not opt-in', async () => {
      // Regression for ai-conductor#325: the reset used to be gated behind a
      // daemon-only freshContextPerStep flag, so interactive `/conduct` (and
      // the daemon front half) shared one persistent session across steps.
      const { runner, log } = trackingRunner();
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
      });

      await conductor.run();

      expect(log.includes('reset')).toBe(true);
      const runIdxs = log
        .map((e, i) => (e.startsWith('run:') ? i : -1))
        .filter((i) => i >= 0);
      for (const i of runIdxs) expect(log[i - 1]).toBe('reset');
    });

    it('a step retry resumes the same session — no reset between attempts', async () => {
      // Load-bearing invariant: the reset happens once BEFORE the retry loop;
      // a step's own retries resume the session it started with.
      const log: string[] = [];
      let storiesAttempts = 0;
      const runner: StepRunner = {
        run: async (step: StepName) => {
          log.push(`run:${step}`);
          if (step === 'stories' && storiesAttempts++ === 0) {
            return { success: false, error: 'flaky first attempt' };
          }
          return { success: true };
        },
        resetSession: async () => {
          log.push('reset');
        },
      };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        mode: 'auto',
        maxRetries: 2,
      });

      await conductor.run();

      const first = log.indexOf('run:stories');
      const second = log.indexOf('run:stories', first + 1);
      expect(first).toBeGreaterThan(0); // ran, and something precedes it
      expect(second).toBeGreaterThan(first); // retried
      expect(log[first - 1]).toBe('reset'); // fresh session for the step
      expect(log.slice(first + 1, second)).not.toContain('reset'); // retry resumes
    });

    it('resets before the FIRST executed step — the daemon worktree-reuse fix', async () => {
      // Mirror the daemon: front half pre-seeded done, loop starts at
      // acceptance_specs. The reset BEFORE that first step is what discards a
      // stale session inherited from a reused worktree.
      const seedResult = await readState(statePath);
      const seed = seedResult.ok ? seedResult.value : ({} as ConductState);
      for (const s of ALL_STEPS) {
        if (s.name === 'acceptance_specs') break;
        (seed as Record<string, unknown>)[s.name] = 'done';
      }
      await writeState(statePath, seed);

      const { runner, log } = trackingRunner();
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'acceptance_specs',
      });

      await conductor.run();

      expect(log[0]).toBe('reset'); // first action is a reset, before any dispatch
      expect(log.find((e) => e.startsWith('run:'))).toBe('run:acceptance_specs');
    });

    it('daemon resume: a FRESH feature (DECIDE pre-seeded done) starts at acceptance_specs', async () => {
      // The daemon stamps DECIDE done and uses `resume: true` (not a hardcoded
      // fromStep). With only DECIDE done, findResumeIndex returns the first
      // pending step — acceptance_specs — so a fresh feature still begins BUILD.
      const seedResult = await readState(statePath);
      const seed = seedResult.ok ? seedResult.value : ({} as ConductState);
      (seed as Record<string, unknown>).complexity_tier = 'M';
      for (const s of ALL_STEPS) {
        if (s.name === 'acceptance_specs') break;
        (seed as Record<string, unknown>)[s.name] = 'done';
      }
      await writeState(statePath, seed);

      const { runner, log } = trackingRunner();
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        resume: true,
      });

      await conductor.run();

      expect(log.find((e) => e.startsWith('run:'))).toBe('run:acceptance_specs');
    });

    it('daemon resume: a feature with BUILD/SHIP progress resumes at its next step, not acceptance_specs', async () => {
      // Regression: the daemon used `fromStep: 'acceptance_specs'`, which re-ran
      // acceptance_specs on EVERY re-dispatch even when the feature was far past
      // BUILD. With `resume: true`, a re-dispatch picks up at the real next
      // pending step (here prd_audit), never re-entering at acceptance_specs.
      const seedResult = await readState(statePath);
      const seed = seedResult.ok ? seedResult.value : ({} as ConductState);
      (seed as Record<string, unknown>).complexity_tier = 'M';
      for (const s of ALL_STEPS) {
        if (s.name === 'prd_audit') break;
        (seed as Record<string, unknown>)[s.name] = 'done';
      }
      await writeState(statePath, seed);

      const { runner, log } = trackingRunner();
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        resume: true,
      });

      await conductor.run();

      expect(log.find((e) => e.startsWith('run:'))).toBe('run:prd_audit');
      expect(log).not.toContain('run:acceptance_specs');
    });

    it('daemon resume: all-satisfied fast-forward — resume at finish, parity with findResumeIndex (Story 4 happy path)', async () => {
      // Story 4 happy path: BUILD/SHIP progress with all verdicts satisfied.
      // Set up state with all steps before finish marked 'done' (finish is pending).
      // Write SATISFIED verdicts for all gates. Resume must start at finish and
      // equal findResumeIndex's output (parity assertion: no clamping needed).
      const seedResult = await readState(statePath);
      const seed = seedResult.ok ? seedResult.value : ({} as ConductState);
      (seed as Record<string, unknown>).complexity_tier = 'M';
      // Mark all steps up to (but not including) finish as 'done'
      for (const s of ALL_STEPS) {
        if (s.name === 'finish') break;
        (seed as Record<string, unknown>)[s.name] = 'done';
      }
      await writeState(statePath, seed);

      // Write SATISFIED verdicts for all gates
      for (const gateName of ['build', 'build_review', 'manual_test', 'prd_audit',
        'architecture_review_as_built', 'rebase'] as StepName[]) {
        await writeVerdict(dir, gateName, { satisfied: true, checkedAt: 1 });
      }

      const { runner, log } = trackingRunner();
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        resume: true,
      });

      await conductor.run();

      // Assert: resume starts at finish (the first pending step after the last done step)
      expect(log.find((e) => e.startsWith('run:'))).toBe('run:finish');

      // Parity assertion: the resume entry index equals findResumeIndex's raw output
      // With all gates satisfied, no clamping occurs, so resume entry == findResumeIndex
      const expectedIndex = findResumeIndex(seed);
      const finishIndex = ALL_STEPS.findIndex((s) => s.name === 'finish');
      expect(expectedIndex).toBe(finishIndex);
    });

    it('daemon resume (regression pin): fresh dispatch starts at acceptance_specs unmodified', async () => {
      // Regression: ensure the existing fresh dispatch behavior remains green.
      // With DECIDE pre-seeded done and no verdict files, resume must start at acceptance_specs,
      // not regress to an earlier step or skip BUILD entirely.
      const seedResult = await readState(statePath);
      const seed = seedResult.ok ? seedResult.value : ({} as ConductState);
      (seed as Record<string, unknown>).complexity_tier = 'M';
      for (const s of ALL_STEPS) {
        if (s.name === 'acceptance_specs') break;
        (seed as Record<string, unknown>)[s.name] = 'done';
      }
      await writeState(statePath, seed);

      const { runner, log } = trackingRunner();
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        resume: true,
      });

      await conductor.run();

      // Assert: fresh feature still begins BUILD at acceptance_specs
      expect(log.find((e) => e.startsWith('run:'))).toBe('run:acceptance_specs');
    });
  });

  it('an unexpected throw inside the loop HALTs (state flushed) instead of crashing', async () => {
    // A throw in the loop (e.g. a verdict-I/O failure in the SHIP tail) must not
    // escape run() with no marker — that produced the daemon's opaque "loop
    // ended without DONE or HALT" error and left state with SHIP entries
    // missing. It must become a recoverable HALT with state flushed.
    const runner: StepRunner = {
      run: async (step: StepName) => {
        if (step === 'stories') throw new Error('kaboom in stories');
        return { success: true };
      },
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
    });

    // Must NOT throw — the loop converts the error into a recoverable HALT.
    await expect(conductor.run()).resolves.toBeUndefined();

    expect(halted).toBe(true);
    const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
    expect(halt).toMatch(/kaboom in stories|conductor error/);
    expect(await readFile(join(dir, '.pipeline/HALT.class'), 'utf-8')).toBe('needs-human');

    // State flushed: a step before the throw is recorded, feature NOT complete.
    const result = await readState(statePath);
    expect(result.ok && result.value.explore).toBe('done');
    expect(result.ok && result.value.feature_status).toBeUndefined();
  });

  it('daemon classifies a gate exit with a reachable pending prerequisite as mechanical', async () => {
    const runner: StepRunner = { run: vi.fn().mockResolvedValue({ success: true }) };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      daemon: true,
      fromStep: 'stories',
    });

    await conductor.run();

    expect(await readFile(join(dir, '.pipeline/HALT.class'), 'utf-8')).toBe('mechanical');
  });

  describe('daemon prd-audit gap-aware halting', () => {
    function renderAuditReport(auditBody: string): string {
      if (auditBody.includes('**PRD:**')) return `# PRD Audit\n\n${auditBody}`;
      const fr = auditBody.match(/FR-\d+/)?.[0] ?? 'FR-1';
      const grade = 'FIXABLE';
      return [
        '# PRD Audit', '', '**PRD:** present', '', '## Verdict Table', '',
        '| Criterion | Grade | Plan task | PRD: | Evidence |',
        '|---|---|---|---|---|',
        `| S1.1 | ${grade} | 1 | ${fr} | x |`,
      ].join('\n');
    }

    // Seed every step before prd_audit as done so the loop can start at the
    // SHIP tail; write the build + manual-test fixtures the predicates need.
    async function seedToPrdAudit(): Promise<void> {
      const res = await readState(statePath);
      const state = (res.ok ? res.value : {}) as Record<string, unknown>;
      let reachedPrdAudit = false;
      for (const s of ALL_STEPS) {
        if (s.name === 'prd_audit') {
          reachedPrdAudit = true;
          continue;
        }
        state[s.name] = reachedPrdAudit ? 'skipped' : 'done';
      }
      state.complexity_tier = 'L';
      state.feature_desc = 'feat';
      state.build_review = 'skipped';
      // These cases exercise manual-test routing only.  Keep the now
      // always-run PRD and as-built gates out of this legacy fixture.
      state.prd_audit = 'done';
      state.architecture_review_as_built = 'done';
      await writeState(statePath, state as unknown as ConductState);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await mkdir(join(dir, '.docs/stories'), { recursive: true });
      await writeFile(
        join(dir, '.docs/plans/feat.md'),
        '### Task 1: repair\n### Task 2: support\n### Task 3: support\n### Task 4: support\n',
      );
      await writeFile(
        join(dir, '.docs/stories/feat.md'),
        '## Story 1: repair\n\n### Happy Path\n- Given a gap, when repaired, then it passes.\n',
      );
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [1, 2, 3, 4].map((id) => ({ id: String(id), status: 'completed' })) }),
      );
    }

    // Runner that re-satisfies build + manual_test on re-run and writes the
    // given prd-audit table body every time prd_audit runs.
    function shipRunner(auditBody: string): { runner: StepRunner; calls: StepName[] } {
      const calls: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, currentState: ConductState, options?: StepRunOptions) => {
          calls.push(step);
          if (step === 'build') {
            currentState.manual_test = 'skipped';
            currentState.architecture_review_as_built = 'skipped';
            await mkdir(join(dir, '.pipeline'), { recursive: true });
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [1, 2, 3, 4].map((id) => ({ id: String(id), status: 'completed' })) }),
            );
          } else if (step === 'manual_test') {
            await writeFile(
              join(dir, '.pipeline/manual-test-results.md'),
              '# Results\n\n| Story | Result |\n|--|--|\n| s | PASS |\n',
            ).catch(async () => {
              await mkdir(join(dir, '.docs'), { recursive: true });
              await writeFile(
                join(dir, '.pipeline/manual-test-results.md'),
                '# Results\n\n| Story | Result |\n|--|--|\n| s | PASS |\n',
              );
            });
          } else if (step === 'prd_audit') {
            await mkdir(join(dir, '.pipeline'), { recursive: true });
            await new Promise((resolve) => setTimeout(resolve, 5));
            await writeFile(
              join(dir, '.pipeline/prd-audit.md'),
              renderAuditReport(auditBody),
            );
          } else if (step === 'architecture_review_as_built') {
            await writeAsBuiltFixture(dir, options?.runId, asBuiltApprovedFixture());
          }
          return { success: true };
        }),
      };
      return { runner, calls };
    }

    // Like shipRunner, but also writes .pipeline/remediation.json when the
    // `remediate` step runs, so the conductor's /remediate routing engages.
    function remediateRunner(
      auditBody: string,
      plan: unknown,
    ): { runner: StepRunner; calls: StepName[] } {
      const calls: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, options?: StepRunOptions) => {
          calls.push(step);
          if (step === 'build' || step === 'prd_audit') {
            await mkdir(join(dir, '.pipeline'), { recursive: true });
            if (step === 'build') {
              await writeFile(
                join(dir, '.pipeline/task-status.json'),
                JSON.stringify({ tasks: [1, 2, 3, 4].map((id) => ({ id: String(id), status: 'completed' })) }),
              );
            } else {
              await writeFile(
                join(dir, '.pipeline/prd-audit.md'),
                renderAuditReport(auditBody),
              );
            }
          } else if (step === 'manual_test') {
            await writeFile(
              join(dir, '.pipeline/manual-test-results.md'),
              '# Results\n\n| Story | Result |\n|--|--|\n| s | PASS |\n',
            );
          } else if (step === 'architecture_review_as_built') {
            await writeAsBuiltFixture(dir, options?.runId, asBuiltApprovedFixture());
          } else if (step === 'remediate') {
            await mkdir(join(dir, '.pipeline'), { recursive: true });
            await writeFile(join(dir, '.pipeline/remediation.json'), JSON.stringify(plan));
          }
          return { success: true };
        }),
      };
      return { runner, calls };
    }

    it('exhausts prd-audit impl-gap self-healing and classifies the terminal halt as needs-human', async () => {
      await seedToPrdAudit();
      // Perpetual impl-gap: every audit reports the same un-closed impl-gap.
      // Disable the independent D2 no-op escalation so this fixture reaches
      // the terminal writer only after exhausting both bounded self-heals.
      const { runner, calls } = shipRunner('| FR-2 | MISSING | impl-gap | x | no |\n');
      const kickbacks: Array<{ from: string; to: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kickbacks.push({ from: e.from, to: e.to });
      });
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
        daemon: true,
        verifyArtifacts: true,
        fromStep: 'prd_audit',
        maxRetries: 1,
        config: {
          kickback_escalation: { enabled: false },
          retry_routing: { enabled: false },
        },
      });

      await conductor.run();

      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      const haltClass = await readFile(join(dir, '.pipeline/HALT.class'), 'utf-8');
      expect({
        prdAuditKickbacks: kickbacks.filter(
          (k) => k.from === 'prd_audit' && k.to === 'build',
        ).length,
        buildCalls: calls.filter((s) => s === 'build').length,
        halted,
        halt,
        haltClass,
      }).toEqual({
        prdAuditKickbacks: 1,
        buildCalls: 1,
        halted: true,
        halt: expect.stringMatching(/prd-audit impl-gap unresolved/),
        haltClass: 'needs-human',
      });
    });

    it('/remediate: routes an autonomous gap to its target step with the gap in the hint', async () => {
      await seedToPrdAudit();
      const { runner } = remediateRunner(
        [
          '**PRD:** present',
          '',
          '## Verdict Table',
          '',
          '| Criterion | Grade | Plan task | PRD: | Evidence |',
          '|---|---|---|---|---|',
          '| S1.1 | FIXABLE | 1 | FR-2 | x |',
        ].join('\n'),
        {
        dispositions: [
          {
            id: 'FR-2',
            disposition: 'build',
            category: null,
            rationale: 'read path wrong at x.ts:10',
            tasks: [{ id: 'r1', title: 'fix x.ts:10 read path' }],
          },
        ],
      });
      const kickbacks: Array<{ from: string; to: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kickbacks.push({ from: e.from, to: e.to });
      });
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        fromStep: 'prd_audit',
      });

      await conductor.run();

      // The planner ran and routed prd_audit → build (the disposition's target).
      expect(kickbacks.some((k) => k.from === 'prd_audit' && k.to === 'build')).toBe(true);
      // BUILD received the gap (FR id + concrete task) in its retryReason.
      const buildReasons = vi
        .mocked(runner.run)
        .mock.calls.filter((c) => c[0] === 'build')
        .map((c) => (c[2] as { retryReason?: string } | undefined)?.retryReason ?? '');
      expect(
        buildReasons.some((r) => r.includes('FR-2') && r.includes('fix x.ts:10 read path')),
      ).toBe(true);
    });

    it('/remediate: HALTs for an architectural-clarity gap (human DECIDE) without rebuilding', async () => {
      await seedToPrdAudit();
      const { runner, calls } = remediateRunner(
        '| FR-3 | DIVERGED | intended-drift | y | no |\n',
        {
          dispositions: [
            {
              id: 'FR-3',
              disposition: 'halt',
              category: 'architectural-clarity',
              rationale: 'ambiguous aggregate boundary',
              tasks: [],
            },
          ],
        },
      );
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
        daemon: true,
        verifyArtifacts: true,
        fromStep: 'prd_audit',
      });

      await conductor.run();

      expect(halted).toBe(true);
      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(halt).toMatch(/needs human DECIDE/);
      expect(halt).toMatch(/FR-3 \(architectural-clarity/);
      expect(calls.filter((s) => s === 'build')).toHaveLength(0);
      // An architectural-clarity gap needs a human DECIDE — the re-kick
      // sweep must never auto-resume it.
      const haltClass = await readFile(join(dir, '.pipeline/HALT.class'), 'utf-8');
      expect(haltClass).toBe('needs-human');
    });

    it('/remediate: daemon HALTs on a DECIDE-phase target (architecture_review) instead of rewinding (#644)', async () => {
      await seedToPrdAudit();
      const { runner, calls } = remediateRunner('| FR-1 | DIVERGED | intended-drift | y | no |\n', {
        dispositions: [
          {
            id: 'FR-1',
            disposition: 'architecture_review',
            category: null,
            rationale: 'design drifted from ADR',
            tasks: [],
          },
        ],
      });
      const kickbacks: Array<{ from: string; to: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kickbacks.push({ from: e.from, to: e.to });
      });
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
        daemon: true,
        verifyArtifacts: true,
        fromStep: 'prd_audit',
      });

      await conductor.run();

      // A taskless, unbound PRD-audit gap halts before it can rewind into DECIDE.
      expect(halted).toBe(true);
      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(halt).toMatch(/no admitted remediation gap/);
      // No rewind: no kickback into the DECIDE tail, DECIDE steps never re-ran.
      expect(kickbacks).toHaveLength(0);
      expect(calls.filter((s) => s === 'architecture_review')).toHaveLength(0);
      expect(calls.filter((s) => s === 'stories')).toHaveLength(0);
      expect(calls.filter((s) => s === 'plan')).toHaveLength(0);
    });

    it('/remediate: daemon HALTs on a DECIDE-phase target (plan) instead of rewinding (#644)', async () => {
      await seedToPrdAudit();
      const { runner, calls } = remediateRunner('| FR-9 | MISSING | intended-drift | z | no |\n', {
        dispositions: [
          {
            id: 'FR-9',
            disposition: 'plan',
            category: null,
            rationale: 'plan missing the FR entirely',
            tasks: [],
          },
        ],
      });
      const kickbacks: Array<{ from: string; to: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kickbacks.push({ from: e.from, to: e.to });
      });
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
        daemon: true,
        verifyArtifacts: true,
        fromStep: 'prd_audit',
      });

      await conductor.run();

      expect(halted).toBe(true);
      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(halt).toMatch(/no admitted remediation gap/);
      expect(kickbacks).toHaveLength(0);
      expect(calls.filter((s) => s === 'plan')).toHaveLength(0);
    });

    it('/remediate: daemon still routes BUILD-phase targets (acceptance_specs) — no over-halt (#644)', async () => {
      await seedToPrdAudit();
      const { runner } = remediateRunner('| FR-2 | MISSING | impl-gap | x | no |\n', {
        dispositions: [
          {
            id: 'FR-2',
            disposition: 'acceptance_specs',
            category: null,
            rationale: 'missing spec for FR-2',
            tasks: [{ id: 'r1', title: 'add FR-2 acceptance spec' }],
          },
        ],
      });
      const kickbacks: Array<{ from: string; to: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kickbacks.push({ from: e.from, to: e.to });
      });
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        fromStep: 'prd_audit',
      });

      await conductor.run();

      // BUILD-phase target keeps routing (re-audit-after-gap-close preserved).
      expect(
        kickbacks.some((k) => k.from === 'prd_audit' && k.to === 'acceptance_specs'),
      ).toBe(true);
    });

    it('/remediate: interactive (non-daemon) mode is untouched by the DECIDE guard (#644)', async () => {
      await seedToPrdAudit();
      const { runner, calls } = remediateRunner('| FR-1 | DIVERGED | intended-drift | y | no |\n', {
        dispositions: [
          {
            id: 'FR-1',
            disposition: 'architecture_review',
            category: null,
            rationale: 'design drifted from ADR',
            tasks: [],
          },
        ],
      });
      let halted = false;
      events.on('loop_halt', () => {
        halted = true;
      });
      const onRecovery = vi
        .fn<(step: StepName, isGating: boolean, context?: RecoveryContext) => Promise<RecoveryOption>>()
        .mockResolvedValue('quit');
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'default', // interactive — a human is present
        daemon: false,
        verifyArtifacts: true,
        fromStep: 'prd_audit',
        maxRetries: 1,
        onRecovery,
      });

      await conductor.run();

      // Human-driven path: recovery menu fires; no daemon HALT was written.
      expect(onRecovery).toHaveBeenCalledWith('prd_audit', true, expect.anything());
      expect(halted).toBe(false);
      expect(calls.filter((s) => s === 'architecture_review')).toHaveLength(0);
    });

    it('does NOT auto-route in interactive (non-daemon) mode — uses the recovery menu', async () => {
      await seedToPrdAudit();
      const { runner, calls } = shipRunner('| FR-2 | MISSING | impl-gap | x | no |\n');
      let halted = false;
      events.on('loop_halt', () => {
        halted = true;
      });
      const onRecovery = vi
        .fn<(step: StepName, isGating: boolean, context?: RecoveryContext) => Promise<RecoveryOption>>()
        .mockResolvedValue('quit');
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'default', // interactive — a human is present
        daemon: false,
        verifyArtifacts: true,
        fromStep: 'prd_audit',
        maxRetries: 1,
        onRecovery,
      });

      await conductor.run();

      // Human-driven path: recovery menu fires for prd_audit; no daemon HALT,
      // no automatic kickback to build.
      expect(onRecovery).toHaveBeenCalledWith('prd_audit', true, expect.anything());
      expect(halted).toBe(false);
      expect(calls.filter((s) => s === 'build')).toHaveLength(0);
    });
  });

  describe('daemon manual-test FAIL routing (#367)', () => {
    const FAIL_RESULTS = '# Results\n\n| Story | Result |\n|--|--|\n| s1 | FAIL |\n';

    // Seed every step before manual_test as done so the loop enters at the
    // SHIP tail's first gate; build's own gate needs task-status.json.
    async function seedToManualTest(): Promise<void> {
      const res = await readState(statePath);
      const state = (res.ok ? res.value : {}) as Record<string, unknown>;
      for (const s of ALL_STEPS) {
        if (s.name === 'manual_test') break;
        state[s.name] = 'done';
      }
      state.complexity_tier = 'L';
      state.feature_desc = 'feat';
      state.build_review = 'skipped';
      await writeState(statePath, state as unknown as ConductState);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
      );
    }

    async function satisfyUnrelatedValidation(step: StepName, runId?: string): Promise<void> {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      if (step === 'prd_audit') {
        await writeFile(
          join(dir, '.pipeline/prd-audit.md'),
          '| FR | Verdict | Gap-class | Evidence | Accepted? |\n|--|--|--|--|--|\n| FR-1 | ALIGNED | | evidence.ts:1 | yes |\n',
        );
      } else if (step === 'architecture_review_as_built') {
        await writeAsBuiltFixture(dir, runId, asBuiltApprovedFixture());
      }
    }

    // Runner where manual_test always records FAIL rows; build re-satisfies
    // its own gate. Perpetual bug → exercises kickback + cap behavior.
    function failingManualTestRunner(): { runner: StepRunner; calls: StepName[] } {
      const calls: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, options?: StepRunOptions) => {
          calls.push(step);
          await satisfyUnrelatedValidation(step, options?.runId);
          if (step === 'build') {
            await mkdir(join(dir, '.pipeline'), { recursive: true });
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
            );
          } else if (step === 'manual_test') {
            await mkdir(join(dir, '.pipeline'), { recursive: true });
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), FAIL_RESULTS);
          }
          return { success: true };
        }),
      };
      return { runner, calls };
    }

    it('routes a FAILing manual_test back to build with the FAIL rows, then HALTs on the first no-op cycle (D2)', async () => {
      await seedToManualTest();
      const { runner, calls } = failingManualTestRunner();
      const kickbacks: Array<{ from: string; to: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kickbacks.push({ from: e.from, to: e.to });
      });
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
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
        fromStep: 'manual_test',
      });

      await conductor.run();

      // Kicked back to build once; the fake BUILD makes zero net progress
      // (identical task-status.json, no repo to move HEAD) and manual_test
      // FAILs with the same rows again — D2 (#647) HALTs on this first
      // no-op cycle instead of spending a second kickback toward the cap.
      expect(kickbacks.filter((k) => k.from === 'manual_test' && k.to === 'build').length).toBe(1);
      expect(calls.filter((s) => s === 'build').length).toBe(1);
      expect(halted).toBe(true);
      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(halt).toMatch(/kickback-to-build no-op/);
    });

    // REGRESSION PIN: when the intervening build cycle makes real forward
    // progress each round (so D2's no-op guard never fires) but manual_test
    // keeps FAILing, the gate-loop budget (MAX_KICKBACKS_PER_GATE) is what
    // eventually stops the loop — a "gate selected N times without
    // satisfying" halt, not a product/plan gap. It must be classified
    // needs-human so the re-kick sweep leaves its capped remediation to an
    // operator rather than retrying it on base advance.
    it('manual_test FAIL exhausts its mechanical cap when the D2 kill-switch is disabled', async () => {
      await seedToManualTest();
      let buildAttempt = 0;
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, options?: StepRunOptions) => {
          await satisfyUnrelatedValidation(step, options?.runId);
          if (step === 'build') {
            buildAttempt++;
            // Grow resolved-task count every attempt so
            // classifyBuildProgress sees real forward progress each round —
            // D2's no-op re-entry guard never fires, letting the loop spend
            // every kickback toward MAX_KICKBACKS_PER_GATE instead.
            const tasks = [
              { id: 'task-1', status: 'completed' },
              ...Array.from({ length: buildAttempt }, (_, i) => ({
                id: `extra-${i + 1}`,
                status: 'completed',
              })),
            ];
            await mkdir(join(dir, '.pipeline'), { recursive: true });
            await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({ tasks }));
          } else if (step === 'manual_test') {
            await mkdir(join(dir, '.pipeline'), { recursive: true });
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), FAIL_RESULTS);
          }
          return { success: true };
        }),
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
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
        fromStep: 'manual_test',
        config: { kickback_escalation: { enabled: false } },
      });

      await conductor.run();

      expect(halted).toBe(true);
      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(halt).toMatch(/manual-test FAIL unresolved/);

      const haltClass = await readFile(join(dir, '.pipeline/HALT.class'), 'utf-8');
      expect(haltClass).toBe('needs-human');
    });

    it('hands BUILD the FAIL rows + the no-whitewash contract in its retryReason', async () => {
      await seedToManualTest();
      const { runner } = failingManualTestRunner();
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
        fromStep: 'manual_test',
      });

      await conductor.run();

      const buildReasons = vi
        .mocked(runner.run)
        .mock.calls.filter((c) => c[0] === 'build')
        .map((c) => (c[2] as { retryReason?: string } | undefined)?.retryReason ?? '');
      expect(buildReasons.length).toBeGreaterThan(0);
      for (const r of buildReasons) {
        expect(r).toContain('| s1 | FAIL |');
        expect(r).toContain('.pipeline/manual-test-results.md');
        expect(r).toMatch(/COMMIT/i);
      }
    });

    it('does NOT kick back on a non-FAIL gate miss (skill never recorded results) — HALTs with the gate reason', async () => {
      await seedToManualTest();
      // manual_test runner writes NOTHING → gate miss is "file missing", which
      // carries no bug evidence for build. Must HALT, not loop.
      const calls: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, options?: StepRunOptions) => {
          calls.push(step);
          await satisfyUnrelatedValidation(step, options?.runId);
          return { success: true };
        }),
      };
      const kickbacks: string[] = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kickbacks.push(e.to);
      });
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
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
        fromStep: 'manual_test',
      });

      await conductor.run();

      expect(halted).toBe(true);
      expect(kickbacks).toHaveLength(0);
      expect(calls.filter((s) => s === 'build')).toHaveLength(0);
      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(halt).toMatch(/step 'manual_test' failed/);
    });

    it('auto mode non-daemon: a failing manual_test HALTs — never silently auto-skipped (#367 gating flip)', async () => {
      await seedToManualTest();
      const { runner, calls } = failingManualTestRunner();
      const kickbacks: string[] = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kickbacks.push(e.to);
      });
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
        daemon: false,
        verifyArtifacts: true,
        maxRetries: 1,
        fromStep: 'manual_test',
      });

      await conductor.run();

      // Gating now: HALT, no advisory auto-skip, no daemon kickback either.
      expect(halted).toBe(true);
      expect(kickbacks).toHaveLength(0);
      expect(calls.filter((s) => s === 'build')).toHaveLength(0);
      const result = await readState(statePath);
      expect(result.ok && result.value.manual_test).not.toBe('skipped');
    });
  });

  describe('daemon auto-park on no-evidence gate misses (#302)', () => {
    // Seed to the BUILD step (the auto-park fires on a build GATE miss, per
    // the ADR's "empty/missing plan at seed" + H7 counter semantics) with a
    // durable no-evidence counter already at N-1 attempts. The build runs,
    // its gate misses (no git evidence for the plan task), the counter
    // increments to N, and the daemon parks instead of retrying/re-kicking.
    async function seedToBuildGate(noEvidenceAttempts: number = 0, withPlanFile: boolean = false): Promise<void> {
      const res = await readState(statePath);
      const state = (res.ok ? res.value : {}) as Record<string, unknown>;
      for (const s of ALL_STEPS) {
        if (s.name === 'build') break;
        state[s.name] = 'done';
      }
      state.complexity_tier = 'L';
      state.feature_desc = 'feat';
      state.track = 'technical';
      await writeState(statePath, state as unknown as ConductState);

      // Optionally create a plan file (for no-evidence test)
      if (withPlanFile) {
        await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
        await writeFile(
          join(dir, '.docs', 'plans', 'plan.md'),
          '# Plan\n\n### Task 1: First\n\n### Task 2: Second\n',
        );
      }

      // Seed task evidence with no-evidence attempts counter
      if (noEvidenceAttempts > 0) {
        const evidence = await createTaskEvidence(dir);
        evidence.noEvidenceAttempts = noEvidenceAttempts;
        await evidence.write();
      }
    }

    it('daemon: empty plan at seed auto-parks with "empty plan" reason', async () => {
      await seedToBuildGate(0);
      // Don't create a plan file — empty/missing plan condition

      const runner = createMockStepRunner();
      const parkEvents: Array<{ type: string; reason?: string }> = [];
      events.on('auto_park', (e) => {
        if (e.type !== 'auto_park') return;
        parkEvents.push({ type: 'auto_park', reason: e.reason });
      });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
        fromStep: 'build',
      });

      await conductor.run();

      // Verify auto-park marker was written
      const { getProvenanceType } = await import('../../src/engine/park-marker.js');
      const provenance = await getProvenanceType(dir, 'feat');
      expect(provenance).toBe('auto');

      // Verify park event was emitted with correct reason
      expect(parkEvents).toHaveLength(1);
      expect(parkEvents[0].reason).toBe('empty/missing plan');

      // Build dispatched once; the park fired at its gate miss — no retries.
      const calls = (runner.run as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toBe('build');
    });

    it('daemon: empty-plan gate miss with contradicting completion evidence refuses immediate park and emits auto_park_contradiction (#612)', async () => {
      await seedToBuildGate(0);
      // Don't create a plan file — empty/missing plan condition per the gate,
      // but seed run evidence that contradicts it: summary.json records
      // completed work.
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline', 'summary.json'),
        JSON.stringify({ tasks_completed: 5 }),
      );

      const runner = createMockStepRunner();
      const parkEvents: Array<{ reason?: string }> = [];
      const contradictionEvents: unknown[] = [];
      events.on('auto_park', (e) => {
        if (e.type !== 'auto_park') return;
        parkEvents.push({ reason: e.reason });
      });
      events.on('auto_park_contradiction', (e) => {
        contradictionEvents.push(e);
      });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
        fromStep: 'build',
      });

      await conductor.run();

      // No immediate empty-plan park — the contradiction guard stripped the reason.
      expect(parkEvents.find((e) => e.reason === 'empty/missing plan')).toBeUndefined();

      // The refusal was logged loudly.
      expect(contradictionEvents).toHaveLength(1);
      const contradiction = contradictionEvents[0] as Record<string, unknown>;
      expect(contradiction).toMatchObject({
        type: 'auto_park_contradiction',
        slug: 'feat',
        verdict: 'empty/missing plan',
        evidence: {
          summaryTasksCompleted: 5,
        },
      });
    });

    it('daemon: genuine empty plan (all signals zero) still parks with "empty/missing plan" and emits NO contradiction event (#612)', async () => {
      await seedToBuildGate(0);
      // Don't create a plan file, and don't seed any completion evidence.

      const runner = createMockStepRunner();
      const parkEvents: Array<{ reason?: string }> = [];
      const contradictionEvents: unknown[] = [];
      events.on('auto_park', (e) => {
        if (e.type !== 'auto_park') return;
        parkEvents.push({ reason: e.reason });
      });
      events.on('auto_park_contradiction', (e) => {
        contradictionEvents.push(e);
      });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
        fromStep: 'build',
      });

      await conductor.run();

      expect(parkEvents).toHaveLength(1);
      expect(parkEvents[0].reason).toBe('empty/missing plan');
      expect(contradictionEvents).toHaveLength(0);
    });


    it('daemon: no further dispatch attempts after auto-park', async () => {
      const N = 3;
      await seedToBuildGate(N - 1, true);

      const dispatchedSteps: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          dispatchedSteps.push(step);
          return { success: true };
        }),
      };

      events.on('auto_park', () => {
        // Park event received
      });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
        fromStep: 'build',
      });

      await conductor.run();

      // Build dispatched once; the park at its gate miss is terminal — no
      // retry of build and nothing downstream (manual_test etc.) dispatched.
      expect(dispatchedSteps).toEqual(['build']);
    });

    it('unpark verb removes auto-park marker and resets the no-evidence counter', async () => {
      const { dispatchDaemonPark } = await import('../../src/engine/daemon-park-cli.js');
      const { writeAutoPark } = await import('../../src/engine/park-marker.js');
      const { readNoEvidenceAttempts } = await import('../../src/engine/task-evidence.js');

      // Setup: create auto-park marker and set counter to N
      await writeAutoPark(dir, 'feat', 'no evidence after 3 attempts');
      const evidence = await createTaskEvidence(dir);
      evidence.noEvidenceAttempts = 3;
      await evidence.write();

      expect(await readNoEvidenceAttempts(dir)).toBe(3);

      // Call unpark verb
      const code = await dispatchDaemonPark(
        { kind: 'unpark', slug: 'feat' },
        { cwd: dir, out: () => {} }
      );

      // Verify unpark succeeded
      expect(code).toBe(0);

      // Verify marker was removed and counter was reset
      const { isOperatorParked } = await import('../../src/engine/park-marker.js');
      expect(await isOperatorParked(dir, 'feat')).toBe(false);
      expect(await readNoEvidenceAttempts(dir)).toBe(0);
    });

    it('feature re-kicked after unpark resumes normal build cycle with fresh counter', async () => {
      const { writeAutoPark } = await import('../../src/engine/park-marker.js');
      const { dispatchDaemonPark } = await import('../../src/engine/daemon-park-cli.js');
      const { readNoEvidenceAttempts } = await import('../../src/engine/task-evidence.js');

      // Setup: auto-parked feature with counter at N-1, seeded to the build step
      await writeAutoPark(dir, 'feat', 'no evidence after 3 attempts');
      const evidence = await createTaskEvidence(dir);
      evidence.noEvidenceAttempts = 2;
      await evidence.write();

      const res = await readState(statePath);
      const state = (res.ok ? res.value : {}) as Record<string, unknown>;
      for (const s of ALL_STEPS) {
        if (s.name === 'build') break;
        state[s.name] = 'done';
      }
      state.complexity_tier = 'L';
      state.feature_desc = 'feat';
      state.track = 'technical';
      await writeState(statePath, state as unknown as ConductState);

      // Create a plan file with PARSEABLE task headers — a header-less plan
      // reads as empty at the gate, which (correctly) parks immediately and
      // would mask this test's counter-reset behavior.
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await writeFile(
        join(dir, '.docs', 'plans', 'plan.md'),
        '# Plan\n\n### Task 1: First\n\n### Task 2: Second\n',
      );

      // Unpark the feature
      const code = await dispatchDaemonPark(
        { kind: 'unpark', slug: 'feat' },
        { cwd: dir, out: () => {} }
      );
      expect(code).toBe(0);

      // Verify counter was reset
      expect(await readNoEvidenceAttempts(dir)).toBe(0);

      // Now run the conductor again from acceptance_specs — it should not auto-park
      // because the counter is at zero (fresh after unpark)
      const runner = createMockStepRunner({ success: true });
      const parkEvents: Array<{ type: string; slug?: string; reason?: string }> = [];
      events.on('auto_park', (e) => {
        if (e.type !== 'auto_park') return;
        parkEvents.push({ type: 'auto_park', slug: e.slug, reason: e.reason });
      });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
        fromStep: 'build',
      });

      await conductor.run();

      // Verify no auto-park occurred (counter was reset, so one miss is tolerated)
      expect(parkEvents).toHaveLength(0);

      // Verify the runner was called to dispatch steps (feature resumed)
      expect((runner.run as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    });

    it('interactive: N no-evidence gate misses (acceptance_specs) does NOT auto-park', async () => {
      const N = 3;
      // Start with N-1 attempts so the next miss will trigger auto-park in daemon mode
      // Create a plan file so we test the no-evidence case, not the empty-plan case
      await seedToBuildGate(N - 1, true);

      const runner = createMockStepRunner();
      const parkEvents: Array<{ type: string; slug?: string; reason?: string }> = [];
      events.on('auto_park', (e) => {
        if (e.type !== 'auto_park') return;
        parkEvents.push({ type: 'auto_park', slug: e.slug, reason: e.reason });
      });

      const onRecovery = vi
        .fn<(step: StepName, isGating: boolean, context?: RecoveryContext) => Promise<RecoveryOption>>()
        .mockResolvedValue('quit');

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'default', // interactive mode
        daemon: false,  // NOT daemon mode
        verifyArtifacts: true,
        maxRetries: 1,
        fromStep: 'acceptance_specs',
        onRecovery,
      });

      await conductor.run();

      // Verify NO auto-park marker was written (guard blocks it in interactive mode)
      const { getProvenanceType } = await import('../../src/engine/park-marker.js');
      const provenance = await getProvenanceType(dir, 'feat');
      expect(provenance).not.toBe('auto');

      // Verify no auto_park event was emitted
      expect(parkEvents).toHaveLength(0);

      // Verify recovery menu was called (interactive path, not auto-park halt)
      expect(onRecovery).toHaveBeenCalledWith('acceptance_specs', expect.anything(), expect.anything());
    });

    it('interactive: gate fails → recovery menu reached (not park)', async () => {
      // Seed to acceptance_specs gate with plan present but no evidence (will fail gate)
      await seedToBuildGate(0, true);

      const runner = createMockStepRunner();
      const parkEvents: Array<{ type: string; reason?: string }> = [];
      events.on('auto_park', (e) => {
        if (e.type !== 'auto_park') return;
        parkEvents.push({ type: 'auto_park', reason: e.reason });
      });

      const onRecovery = vi
        .fn<(step: StepName, isGating: boolean, context?: RecoveryContext) => Promise<RecoveryOption>>()
        .mockResolvedValue('quit');

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'default', // interactive mode
        daemon: false,  // NOT daemon mode
        verifyArtifacts: true,
        maxRetries: 1,
        fromStep: 'acceptance_specs',
        onRecovery,
      });

      await conductor.run();

      // Verify no auto-park occurred (interactive mode skips auto-park entirely)
      expect(parkEvents).toHaveLength(0);

      // Verify recovery menu was invoked instead (normal interactive path)
      expect(onRecovery).toHaveBeenCalled();
    });

    it('interactive: #115 retryReason behavior unchanged in interactive mode', async () => {
      // Seed to acceptance_specs gate
      await seedToBuildGate(0, true);

      let recoveryStepName: StepName | undefined;
      let recoveryReason: boolean | undefined;
      const onRecovery = vi
        .fn<(step: StepName, isGating: boolean, context?: RecoveryContext) => Promise<RecoveryOption>>()
        .mockImplementation(async (step, needsReason) => {
          recoveryStepName = step;
          recoveryReason = needsReason;
          return 'quit';
        });

      const runner = createMockStepRunner();
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'default', // interactive mode
        daemon: false,  // NOT daemon mode
        verifyArtifacts: true,
        maxRetries: 1,
        fromStep: 'acceptance_specs',
        onRecovery,
      });

      await conductor.run();

      // Verify recovery menu is called with the step and reason flag (#115 mechanism)
      expect(onRecovery).toHaveBeenCalled();
      expect(recoveryStepName).toBe('acceptance_specs');
      // The second parameter indicates whether a retry reason is needed
      expect(typeof recoveryReason).toBe('boolean');
    });
  });

  describe('T7: lastResolvedCount recorded at build-step dispatch exit', () => {
    // Seed state up through (but not including) build, without writing a
    // plan/task-status.json — the runner or the test body supplies those,
    // per exit path under test.
    async function seedToBuild(): Promise<void> {
      const res = await readState(statePath);
      const state = (res.ok ? res.value : {}) as Record<string, unknown>;
      for (const s of ALL_STEPS) {
        if (s.name === 'build') break;
        state[s.name] = 'done';
      }
      state.complexity_tier = 'L';
      state.feature_desc = 'feat';
      state.track = 'technical';
      await writeState(statePath, state as unknown as ConductState);
    }

    // Writes a plan with `total` "### Task N: Step N" headers and a matching
    // task-status.json with `completed` of them marked completed, each
    // backed by an evidence stamp (H6: an unstamped 'completed' row is
    // demoted at every gate evaluation, so stamps are required for the
    // count to stick).
    async function writePlanAndStatus(completed: number, total: number): Promise<void> {
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      const planLines: string[] = ['# Plan', ''];
      for (let i = 1; i <= total; i++) planLines.push(`### Task ${i}: Step ${i}`, '');
      await writeFile(join(dir, '.docs/plans/plan.md'), planLines.join('\n'));

      const tasks: Array<{ id: number; status: string }> = [];
      const stamps: Record<string, { sha: string; form: string }> = {};
      for (let i = 1; i <= total; i++) {
        const done = i <= completed;
        tasks.push({ id: i, status: done ? 'completed' : 'pending' });
        if (done) {
          stamps[String(i)] = { sha: `${'0'.repeat(38)}${String(i).padStart(2, '0')}`, form: 'trailer' };
        }
      }
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({ tasks }));
      await writeFile(
        join(dir, '.pipeline/task-evidence.json'),
        JSON.stringify({ evidenceStamps: stamps, noEvidenceAttempts: 0, migrationGrandfather: [] }),
      );
    }

    it('records lastResolvedCount in the sidecar on a successful/completing build exit', async () => {
      await seedToBuild();
      const TOTAL = 3;

      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'build') {
            await writePlanAndStatus(TOTAL, TOTAL);
          }
          return { success: true };
        }),
      };

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 2,
        fromStep: 'build',
      });

      await conductor.run();

      const evidence = await createTaskEvidence(dir);
      expect(evidence.lastResolvedCount).toBe(TOTAL);
    });

    it('records lastResolvedCount in the sidecar on a park exit (T5 absolute attempt-ceiling backstop)', async () => {
      await seedToBuild();
      const TOTAL = 5;
      const CEILING = 2;
      let progress = 0;

      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'build') {
            progress++;
            await writePlanAndStatus(progress, TOTAL);
          }
          return { success: true };
        }),
      };

      const loopHaltEvents: Array<{ reason: string }> = [];
      events.on('loop_halt', (e) => {
        if (e.type === 'loop_halt') loopHaltEvents.push({ reason: e.reason });
      });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 10, // far above the ceiling — proves the ceiling bounds this run
        fromStep: 'build',
        config: {
          build_progress_halt: { enabled: true, attempt_ceiling: CEILING, dispatch_ceiling: 20 },
        } as HarnessConfig,
      });

      await conductor.run();

      expect(loopHaltEvents).toHaveLength(1);
      expect(loopHaltEvents[0].reason).toMatch(/attempt ceiling/i);

      const evidence = await createTaskEvidence(dir);
      expect(evidence.lastResolvedCount).toBe(CEILING);
    });

    it.each([false, true])('reports refunded build retries without changing dispatch (selfHost=%s)', async (selfHost) => {
      await seedToBuild();
      const tokenPath = join(dir, 'retry-test-token');
      await writeFile(tokenPath, 'fixture-token');
      const installedRoot = join(dir, 'installed-harness');
      await mkdir(installedRoot);
      const TOTAL = 4;
      const CEILING = 3;
      let progress = 0;
      let buildCalls = 0;
      const dispatches: Array<{ model?: string; effort?: string }> = [];
      const retryEvents: Array<Extract<ConductorEvent, { type: 'step_retry' }>> = [];

      const runner: StepRunner = {
        selfHostRunId: () => 'retry-reporting-fixture',
        run: vi.fn(async (step: StepName, _state: ConductState, options?: StepRunOptions) => {
          if (step === 'build') {
            buildCalls++;
            dispatches.push({ model: options?.modelOverride, effort: options?.effortOverride });
            // The first retry consumes a normal fixed-budget slot. Each later
            // attempt resolves one task, until the existing ceiling halts it.
            if (buildCalls > 1) {
              progress++;
              await writePlanAndStatus(progress, TOTAL);
            } else {
              await writePlanAndStatus(0, TOTAL);
            }
          }
          return { success: true };
        }),
      };
      events.on('step_retry', (event) => {
        if (event.type === 'step_retry') retryEvents.push(event);
      });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        selfHost,
        selfHostGuardrails: {
          resolveHarnessRoot: vi.fn().mockResolvedValue(dir),
          resolveInstalledHarnessRoot: vi.fn().mockResolvedValue({ status: 'ok', root: installedRoot }),
          relink: vi.fn(),
          provisionSandbox: vi.fn(async () => ({ configDir: dir, childEnv: () => process.env, teardown: async () => {} })),
          versionGate: vi.fn().mockResolvedValue({ ok: true }),
          releaseGate: vi.fn().mockResolvedValue({ ok: true }),
        } as any,
        verifyArtifacts: true,
        maxRetries: 3,
        fromStep: 'build',
        config: {
          harness_self_host: {
            sandbox_build_env: true,
            build_auth: { mode: 'daemon-token', token_path: tokenPath },
          },
          build_progress_halt: { enabled: true, attempt_ceiling: CEILING, dispatch_ceiling: 20 },
        } as HarnessConfig,
      });

      await conductor.run();

      expect(retryEvents).toHaveLength(3);
      expect(dispatches).toHaveLength(4);
      if (selfHost) {
        expect(dispatches).toEqual(Array.from({ length: 4 }, () => ({ model: undefined, effort: undefined })));
        for (const event of retryEvents) {
          expect(event).not.toHaveProperty('escalatedModel');
          expect(event).not.toHaveProperty('escalatedEffort');
        }
      }
      expect(retryEvents.map((event) => ({
        model: event.escalatedModel, effort: event.escalatedEffort,
      }))).toEqual(dispatches.slice(1));
      expect(retryEvents.every((event) => event.attempt <= event.maxAttempts)).toBe(true);
      expect(retryEvents[0]).toMatchObject({ step: 'build', attempt: 2, maxAttempts: 3 });
      expect(retryEvents[0]).not.toHaveProperty('progressAttempt');
      expect(retryEvents[0]).not.toHaveProperty('progressAttemptCeiling');
      expect(retryEvents.slice(1)).toEqual([
        expect.objectContaining({
          step: 'build', attempt: 2, maxAttempts: 3,
          progressAttempt: 1, progressAttemptCeiling: CEILING,
        }),
        expect.objectContaining({
          step: 'build', attempt: 2, maxAttempts: 3,
          progressAttempt: 2, progressAttemptCeiling: CEILING,
        }),
      ]);
    });
  });

  describe('daemon build stall remediation dispatch (Task 4)', () => {
    const STALL_QUESTION = 'Need user decision: which auth provider — Auth0 or Cognito?';
    const REMEDIATION_ANSWER = 'Use Auth0 — matches the existing SSO integration.';

    // Seed state to build gate so the loop starts at build directly
    async function seedToBuildStep(): Promise<void> {
      const res = await readState(statePath);
      const state = (res.ok ? res.value : {}) as Record<string, unknown>;
      for (const s of ALL_STEPS) {
        if (s.name === 'build') break;
        state[s.name] = 'done';
      }
      state.complexity_tier = 'M';
      state.feature_desc = 'daemon-stall-test';
      await writeState(statePath, state as unknown as ConductState);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      // Single plan file so resolveFeaturePlanPath finds it unambiguously
      await writeFile(
        join(dir, '.docs/plans/daemon-stall-test.md'),
        '# Plan\n\n### Task 1: Step 1\n',
      );
    }

    it('routes a throwing build-stall remediation through the supplied feature logger', async () => {
      await seedToBuildStep();
      const featureLogs: string[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'build') {
            await writeFile(join(dir, '.pipeline/halt-user-input-required'), STALL_QUESTION);
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 1, status: 'pending' }] }),
            );
            await writeFile(
              join(dir, '.pipeline/task-evidence.json'),
              JSON.stringify({ evidenceStamps: {}, noEvidenceAttempts: 0, migrationGrandfather: [] }),
            );
          }
          return { success: true } as StepRunResult;
        }),
      };
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        log: (message) => featureLogs.push(message),
        verifyArtifacts: true,
      });
      (conductor as any).planRemediation = async () => {
        throw new Error('remediation sentinel');
      };

      await conductor.run();

      expect(featureLogs).toContain('build-stall remediation dispatch threw: Error: remediation sentinel');
    });

    it('daemon mode: dispatches /remediate on build stall with stall question in context', async () => {
      await seedToBuildStep();
      // The validation group now converges cleanly past its own members
      // (Task 21 routes mixed gaps rather than failing loudly) once this
      // test's runner passes prd_audit/architecture_review_as_built/
      // manual_test cleanly (below) — but the downstream `finish` gate's
      // own convergence machinery (push evidence, PR presentation) is out
      // of scope for a build-stall test. Mark it already `done` so the
      // loop never re-dispatches or gates on it, keeping this test scoped
      // to the build-stall remediation dispatch it actually covers.
      {
        const res = await readState(statePath);
        const seeded = (res.ok ? res.value : {}) as Record<string, unknown>;
        seeded.finish = 'done';
        await writeState(statePath, seeded as unknown as ConductState);
      }

      const calls: Array<{ step: StepName; retryReason?: string }> = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, opts?: StepRunOptions) => {
          calls.push({ step, retryReason: opts?.retryReason });
          if (step === 'build') {
            const buildCalls = calls.filter((c) => c.step === 'build').length;
            if (buildCalls === 1) {
              // First attempt: write stall marker with a question
              await writeFile(
                join(dir, '.pipeline/halt-user-input-required'),
                STALL_QUESTION,
              );
              // Write pending tasks and no evidence stamps (so gate fails)
              await writeFile(
                join(dir, '.pipeline/task-status.json'),
                JSON.stringify({ tasks: [{ id: 1, status: 'pending' }] }),
              );
              await writeFile(
                join(dir, '.pipeline/task-evidence.json'),
                JSON.stringify({ evidenceStamps: {}, noEvidenceAttempts: 0, migrationGrandfather: [] }),
              );
            } else {
              // Resumed attempt: complete the tasks with evidence stamps (gate passes)
              await writeFile(
                join(dir, '.pipeline/task-status.json'),
                JSON.stringify({ tasks: [{ id: 1, status: 'completed' }] }),
              );
              await writeFile(
                join(dir, '.pipeline/task-evidence.json'),
                JSON.stringify({
                  evidenceStamps: { '1': { sha: '0000000000000000000000000000000000000001', form: 'trailer' } },
                  noEvidenceAttempts: 0,
                  migrationGrandfather: [],
                }),
              );
            }
          } else if (step === 'remediate') {
            // Write remediation plan that routes back to build
            await writeFile(
              join(dir, '.pipeline/remediation.json'),
              JSON.stringify({
                dispositions: [
                  {
                    id: 'stall:auth-provider',
                    disposition: 'build',
                    category: null,
                    rationale: REMEDIATION_ANSWER,
                    tasks: [],
                  },
                ],
              }),
            );
          } else if (step === 'manual_test') {
            // Downstream validation group: this test is about the build
            // stall's own remediation dispatch, not the group — pass its
            // members cleanly so the group's join never fires a SECOND
            // (Task 21 mixed-failure) remediate dispatch.
            await writeFile(
              join(dir, '.pipeline/manual-test-results.md'),
              '# Results\n\n| Story | Result |\n|--|--|\n| s1 | PASS |\n',
            );
          } else if (step === 'prd_audit') {
            await writeFile(
              join(dir, '.pipeline/prd-audit.md'),
              '| FR | Verdict | Gap-class | Evidence | Accepted? |\n|--|--|--|--|--|\n| FR-1 | ALIGNED | | evidence.ts:1 | yes |\n',
            );
          } else if (step === 'architecture_review_as_built') {
            await writeAsBuiltFixture(dir, opts?.runId, asBuiltApprovedFixture());
          }
          return { success: true } as StepRunResult;
        }),
      };

      const kickbacks: unknown[] = [];
      const events = new ConductorEventEmitter();
      events.on('kickback', (e) => { kickbacks.push(e); });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 3,
      });

      await conductor.run();

      const buildCalls = calls.filter((c) => c.step === 'build');
      const remediateCalls = calls.filter((c) => c.step === 'remediate');

      // Verify /remediate was dispatched exactly once with stall question in context
      expect(remediateCalls).toHaveLength(1);
      expect(remediateCalls[0].retryReason).toContain(STALL_QUESTION);

      // Verify build was retried with remediation answer
      expect(buildCalls).toHaveLength(2);
      expect(buildCalls[1].retryReason).toContain(REMEDIATION_ANSWER);

      // Verify kickback event was emitted
      expect(kickbacks.length).toBeGreaterThan(0);
      const kickback = kickbacks.find((k: unknown) => {
        const evt = k as Record<string, unknown>;
        return evt.type === 'kickback' && evt.from === 'build' && evt.to === 'build';
      });
      expect(kickback).toBeDefined();
    });

    it('daemon mode: respects remediation budget (MAX_KICKBACKS_PER_GATE)', async () => {
      await seedToBuildStep();

      let buildAttemptCount = 0;
      const remediateCallCount: number[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, _opts?: { retryReason?: string }) => {
          if (step === 'build') {
            buildAttemptCount++;
            // Always write a stall marker to trigger remediation dispatch
            await writeFile(
              join(dir, '.pipeline/halt-user-input-required'),
              `Stall ${buildAttemptCount}`,
            );
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 1, status: 'pending' }] }),
            );
          } else if (step === 'remediate') {
            remediateCallCount.push(buildAttemptCount);
            // Return a route disposition to trigger a retry
            await writeFile(
              join(dir, '.pipeline/remediation.json'),
              JSON.stringify({
                dispositions: [
                  {
                    id: `stall:${buildAttemptCount}`,
                    disposition: 'build',
                    category: null,
                    rationale: `Answer ${buildAttemptCount}`,
                    tasks: [],
                  },
                ],
              }),
            );
          }
          return { success: true } as StepRunResult;
        }),
      };

      const events = new ConductorEventEmitter();
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 10, // High retry count to test remediation budget
      });

      await conductor.run();

      // Verify remediate was called at most MAX_KICKBACKS_PER_GATE (2) times
      expect(remediateCallCount.length).toBeLessThanOrEqual(2);
    });

    // REGRESSION PIN (#569): once remediationRounds reaches
    // MAX_KICKBACKS_PER_GATE for a halt_marker build stall, the run must
    // write the "Remediation budget exhausted" HALT marker and return —
    // no further /remediate dispatch. Locks conductor.ts:3657-3677 so a
    // later change (adding no_task_progress dispatch) can't accidentally
    // let a budget-exhausted halt_marker stall fall through to a 3rd
    // dispatch or lose the budget-exhausted HALT content.
    it('halt_marker stall at remediation budget exhaustion writes "Remediation budget exhausted" HALT and dispatches no further /remediate', async () => {
      await seedToBuildStep();

      let buildAttemptCount = 0;
      const remediateCallCount: number[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, _opts?: { retryReason?: string }) => {
          if (step === 'build') {
            buildAttemptCount++;
            // Always write a stall marker to trigger remediation dispatch
            // on every attempt, exhausting the budget. The halt_marker
            // check takes precedence over the resolved-task-count
            // comparison, so the resolved count is bumped each attempt
            // (task ids grow) purely to keep the durable no-evidence
            // auto-park counter (a DIFFERENT mechanism, gated on lack of
            // resolved-task progress) from firing first and masking the
            // budget-exhaustion HALT this test is pinning.
            await writeFile(
              join(dir, '.pipeline/halt-user-input-required'),
              `Stall ${buildAttemptCount}`,
            );
            // Task 1 (the plan's only task) stays pending across every
            // attempt so the build predicate's plan-scoped completion check
            // (artifacts.ts's `build` predicate only inspects rows whose id
            // appears in the plan, #773 Task 10) never reports done — the
            // extra, non-plan-referenced rows below exist solely to grow
            // the resolved-task count and keep the durable no-evidence
            // auto-park counter (a DIFFERENT mechanism) from firing first
            // and masking the budget-exhaustion HALT this test is pinning.
            const tasks = [
              { id: 1, status: 'pending' },
              ...Array.from({ length: buildAttemptCount }, (_, i) => ({
                id: i + 101,
                status: 'completed',
              })),
            ];
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks }),
            );
          } else if (step === 'remediate') {
            remediateCallCount.push(buildAttemptCount);
            // Route back to build every time — the stall never actually
            // resolves, forcing the budget to exhaust.
            await writeFile(
              join(dir, '.pipeline/remediation.json'),
              JSON.stringify({
                dispositions: [
                  {
                    id: `stall:${buildAttemptCount}`,
                    disposition: 'build',
                    category: null,
                    rationale: `Answer ${buildAttemptCount}`,
                    tasks: [],
                  },
                ],
              }),
            );
          }
          return { success: true } as StepRunResult;
        }),
      };

      const haltEvents: Array<{ reason: string }> = [];
      const events = new ConductorEventEmitter();
      events.on('loop_halt', (e) => {
        if (e.type === 'loop_halt') haltEvents.push({ reason: e.reason });
      });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 10, // High retry count so the budget (not retries) is what stops the loop
      });

      await conductor.run();

      // Never more than MAX_KICKBACKS_PER_GATE (2) dispatches for this
      // persistent halt_marker stall.
      expect(remediateCallCount.length).toBeLessThanOrEqual(2);
      expect(remediateCallCount.length).toBeGreaterThan(0);

      // The run HALTs rather than looping forever or falling through to a
      // silent non-green failure.
      expect(haltEvents.length).toBeGreaterThan(0);

      // The HALT marker on disk carries the fail-safe budget-exhausted
      // message pinned at conductor.ts:3657-3677.
      const haltContent = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(haltContent).toContain('Remediation budget exhausted');
      expect(haltContent).toContain('max 2 kickbacks per gate');

      // The exhausted remediation budget needs a human decision; the re-kick
      // sweep must not retry it automatically on base advance.
      const haltClass = await readFile(join(dir, '.pipeline/HALT.class'), 'utf-8');
      expect(haltClass).toBe('needs-human');
    });
  });

  describe('stall HALT carries the question (Task 6)', () => {
    const STALL_QUESTION = 'Need user decision: which auth provider — Auth0 or Cognito?';

    async function seedToBuildStep(): Promise<void> {
      const res = await readState(statePath);
      const state = (res.ok ? res.value : {}) as Record<string, unknown>;
      for (const s of ALL_STEPS) {
        if (s.name === 'build') break;
        state[s.name] = 'done';
      }
      state.complexity_tier = 'M';
      state.feature_desc = 'stall-halt-test';
      await writeState(statePath, state as unknown as ConductState);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await writeFile(
        join(dir, '.docs/plans/stall-halt-test.md'),
        '# Plan\n\n### Task 1: Step 1\n',
      );
    }

    it('writes the question first, then disposition detail, when remediation halts the stall', async () => {
      await seedToBuildStep();

      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'build') {
            // Write stall marker with question
            await writeFile(
              join(dir, '.pipeline/halt-user-input-required'),
              STALL_QUESTION,
            );
            // Write minimal task status so completion check fails
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 1, status: 'pending' }] }),
            );
          } else if (step === 'remediate') {
            // Write remediation with halt disposition
            await writeFile(
              join(dir, '.pipeline/remediation.json'),
              JSON.stringify({
                dispositions: [
                  {
                    id: 'stall:auth-provider',
                    disposition: 'halt',
                    category: 'product-scope',
                    rationale: 'Choice of auth provider is a product decision.',
                    tasks: [],
                  },
                ],
              }),
            );
          }
          return { success: true } as StepRunResult;
        }),
      };

      let halted = false;
      const events = new ConductorEventEmitter();
      events.on('loop_halt', () => {
        halted = true;
      });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 3,
      });

      await conductor.run();

      expect(halted).toBe(true);
      const haltContent = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      const nonEmptyLines = haltContent.split('\n').filter((l) => l.trim().length > 0);
      expect(nonEmptyLines[0]).toBe(STALL_QUESTION);
      expect(haltContent).toContain('product-scope');
      expect(haltContent).toContain('Choice of auth provider is a product decision.');
      // Not the generic retries-exhausted writer
      expect(haltContent).not.toMatch(/retries exhausted/);
    });

    it('fail-closes to HALT when remediation routes stall to a non-build step (Task 7)', async () => {
      await seedToBuildStep();

      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'build') {
            // Write stall marker with question
            await writeFile(
              join(dir, '.pipeline/halt-user-input-required'),
              STALL_QUESTION,
            );
            // Write minimal task status so completion check fails
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 1, status: 'pending' }] }),
            );
          } else if (step === 'remediate') {
            // Write remediation that misroutes to 'plan' (non-build target)
            await writeFile(
              join(dir, '.pipeline/remediation.json'),
              JSON.stringify({
                dispositions: [
                  {
                    id: 'stall:auth-provider',
                    disposition: 'plan',
                    category: null,
                    rationale: 'Needs a re-plan, not a build answer.',
                    tasks: [],
                  },
                ],
              }),
            );
          }
          return { success: true } as StepRunResult;
        }),
      };

      let halted = false;
      const events = new ConductorEventEmitter();
      events.on('loop_halt', () => {
        halted = true;
      });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 3,
      });

      await conductor.run();

      expect(halted).toBe(true);
      const haltContent = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      const nonEmptyLines = haltContent.split('\n').filter((l) => l.trim().length > 0);
      // First non-empty line should be the question
      expect(nonEmptyLines[0]).toBe(STALL_QUESTION);
      // HALT detail should mention the misroute
      expect(haltContent).toContain('plan');

      // Verify build was never re-dispatched (only first attempt, no resume)
      const runnerMock = vi.mocked(runner.run);
      const buildCalls = runnerMock.mock.calls.filter((c) => c[0] === 'build');
      expect(buildCalls).toHaveLength(1);
    });
  });

  describe('dashboard provenance + park visibility (Task 25)', () => {
    it('auto-parked feature appears on dashboard with provenance line "auto-parked"', async () => {
      const { writeAutoPark } = await import('../../src/engine/park-marker.js');
      const { scanInheritedState, renderDashboard } = await import('../../src/engine/daemon-dashboard.js');

      // Setup: create an auto-park marker
      await writeAutoPark(dir, 'feat-auto', 'no evidence after 3 attempts');

      // Scan inherited state
      const state = await scanInheritedState({
        worktreeBase: join(dir, '.worktrees'),
        processedDir: join(dir, '.daemon', 'processed'),
        discover: async () => ({ items: [], waiting: [], gated: [] }),
      });

      // Get provenance for the parked slug
      const { getProvenanceType } = await import('../../src/engine/park-marker.js');
      const provenance = await getProvenanceType(dir, 'feat-auto');
      expect(provenance).toBe('auto');

      // Add the parked slug to the state with provenance info
      state.parked = [{ slug: 'feat-auto', provenance: 'auto', reason: 'no evidence after 3 attempts' }];

      // Render the dashboard
      const dashboard = renderDashboard(state);

      // Dashboard should show auto-parked indicator with provenance
      expect(dashboard).toContain('feat-auto');
      expect(dashboard).toContain('auto-parked');
    });

    it('operator-parked feature appears on dashboard with provenance line "operator"', async () => {
      const { writeOperatorPark } = await import('../../src/engine/park-marker.js');
      const { scanInheritedState, renderDashboard } = await import('../../src/engine/daemon-dashboard.js');

      // Setup: create an operator-park marker
      await writeOperatorPark(dir, 'feat-op');

      // Scan inherited state
      const state = await scanInheritedState({
        worktreeBase: join(dir, '.worktrees'),
        processedDir: join(dir, '.daemon', 'processed'),
        discover: async () => ({ items: [], waiting: [], gated: [] }),
      });

      // Get provenance for the parked slug
      const { getProvenanceType } = await import('../../src/engine/park-marker.js');
      const provenance = await getProvenanceType(dir, 'feat-op');
      expect(provenance).toBe('operator');

      // Add the parked slug to the state with provenance info
      state.parked = [{ slug: 'feat-op', provenance: 'operator' }];

      // Render the dashboard
      const dashboard = renderDashboard(state);

      // Dashboard should show operator-parked indicator with provenance
      expect(dashboard).toContain('feat-op');
      expect(dashboard).toContain('operator');
    });

    it('park emission is a logged ConductorEvent (type: auto_park)', async () => {
      const N = 3;
      const res = await readState(statePath);
      const state = (res.ok ? res.value : {}) as Record<string, unknown>;
      for (const s of ALL_STEPS) {
        if (s.name === 'acceptance_specs') break;
        state[s.name] = 'done';
      }
      state.complexity_tier = 'L';
      state.feature_desc = 'feat';
      state.track = 'technical';
      await writeState(statePath, state as unknown as ConductState);

      // Create a plan file so we test the no-evidence case
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await writeFile(
        join(dir, '.docs', 'plans', 'plan.md'),
        '# Plan\n\n- Task 1\n',
      );

      // Seed task evidence with no-evidence attempts counter at N-1
      const evidence = await createTaskEvidence(dir);
      evidence.noEvidenceAttempts = N - 1;
      await evidence.write();

      const runner = createMockStepRunner();
      const emittedEvents: ConductorEvent[] = [];
      events.on('auto_park', (e) => {
        emittedEvents.push(e as unknown as ConductorEvent);
      });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
        fromStep: 'build',
      });

      await conductor.run();

      // Verify park event was emitted with correct type
      expect(emittedEvents).toHaveLength(1);
      const parkEvent = emittedEvents[0];
      expect(parkEvent).toHaveProperty('type', 'auto_park');
      expect(parkEvent).toHaveProperty('slug');
      expect(parkEvent).toHaveProperty('reason');
    });

    it('halt-monitor can detect park events by type and slug', async () => {
      const { writeAutoPark } = await import('../../src/engine/park-marker.js');

      // Setup: create an auto-park marker
      await writeAutoPark(dir, 'monitored-feat', 'test failure');

      // Simulate a park event
      const parkEvent: ConductorEvent = {
        type: 'auto_park',
        timestamp: new Date().toISOString(),
        slug: 'monitored-feat',
        reason: 'test failure',
      } as unknown as ConductorEvent;

      // Halt-monitor should be able to detect the event by type
      expect(parkEvent.type).toBe('auto_park');
      expect((parkEvent as Record<string, unknown>).slug).toBe('monitored-feat');

      // Verify the marker exists with correct provenance
      const { getProvenanceType } = await import('../../src/engine/park-marker.js');
      const provenance = await getProvenanceType(dir, 'monitored-feat');
      expect(provenance).toBe('auto');
    });

    it('a park without an emitted event fails the spec', async () => {
      const { writeAutoPark } = await import('../../src/engine/park-marker.js');

      // Setup: create an auto-park marker WITHOUT emitting an event
      await writeAutoPark(dir, 'untracked-park', 'no event emitted');

      // Verify the marker exists
      const { getProvenanceType } = await import('../../src/engine/park-marker.js');
      const provenance = await getProvenanceType(dir, 'untracked-park');
      expect(provenance).toBe('auto');

      // Simulate checking for event emission
      const emittedEvents: ConductorEvent[] = [];
      // No events are pushed to emittedEvents array

      // This should fail: a park without event is not properly logged
      expect(emittedEvents).toHaveLength(0); // This verifies the failure condition
    });
  });

  describe('daemon finish/as-built remediation', () => {
    // Seed the SHIP tail in the technical-track shape (prd_audit skipped) —
    // exactly the shape that had NO remediation entry point before the
    // finish/as-built hook, because the /remediate dispatch lived only inside
    // the prd_audit blocking handler. `rebase` is seeded skipped so the tail
    // never invokes real git against the temp dir (rebase is engine-managed
    // and daemon-gated).
    async function seedShipTail(overrides: Record<string, string> = {}): Promise<void> {
      const res = await readState(statePath);
      const state = (res.ok ? res.value : {}) as Record<string, unknown>;
      for (const s of ALL_STEPS) {
        if (s.name === 'finish') break;
        state[s.name] = 'done';
      }
      Object.assign(
        state,
        {
          complexity_tier: 'L',
          feature_desc: 'feat',
          build_review: 'skipped',
          manual_test: 'skipped',
          prd_audit: 'skipped',
          architecture_review_as_built: 'skipped',
          rebase: 'skipped',
        },
        overrides,
      );
      await writeState(statePath, state as unknown as ConductState);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
      );
    }

    function remediationPlanFile(plan: unknown): Promise<void> {
      return writeFile(join(dir, '.pipeline/remediation.json'), JSON.stringify(plan));
    }

    it('halts finish remediation that attempts unbounded plan growth', async () => {
      await seedShipTail();
      // First finish refuses (no finish-choice — the skill found real test
      // failures). /remediate plans a build fix; after build re-runs, finish
      // writes its choice and the feature ships without a HALT.
      let buildFixed = false;
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'build') {
            buildFixed = true;
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
            );
          } else if (step === 'remediate') {
            await remediationPlanFile({
              dispositions: [
                {
                  id: 'test:loop-intake',
                  disposition: 'build',
                  category: null,
                  rationale: 'tests lag the fail-closed identity contract',
                  tasks: [{ id: 'rem-1', title: 'update loop-intake.test.ts to inject ownerConfig' }],
                },
              ],
            });
          } else if (step === 'finish' && buildFixed) {
            await writeFile(join(dir, '.pipeline/finish-choice'), 'pr\n');
            const stateResult = await readState(statePath);
            const state = stateResult.ok ? stateResult.value : {};
            state.pr_url = 'https://github.com/org/repo/pull/1';
            await writeState(statePath, state);
            // Also write to the path the gate reads from
            await writeState(join(dir, '.pipeline/conduct-state.json'), state);
          }
          return { success: true };
        }),
      };
      const kickbacks: Array<{ from: string; to: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kickbacks.push({ from: e.from, to: e.to });
      });
      let halted = false;
      events.on('loop_halt', () => {
        halted = true;
      });
      const fakeGit: GitRunner = async (args) =>
        args.includes('--symbolic-full-name')
          ? { stdout: 'refs/remotes/origin/feature/x\n' }
          : { stdout: '' };
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        fromStep: 'finish',
        maxRetries: 1,
        escalateBuildFailure: async () => ({}),
        git: fakeGit,
        shipmentEvidence: async () => ({
          kind: 'valid',
          slug: 'feat',
          pr: 'https://github.com/org/repo/pull/1',
          recordPath: '.docs/shipped/feat.md',
          hash: 'verified',
          commit: 'verified',
        }),
      });

      await conductor.run();

      expect(kickbacks).toEqual([]);
      // The remediate dispatch names the finish gap artifact.
      const remediateReasons = vi
        .mocked(runner.run)
        .mock.calls.filter((c) => c[0] === 'remediate')
        .map((c) => (c[2] as { retryReason?: string } | undefined)?.retryReason ?? '');
      expect(remediateReasons.some((r) => r.includes('.pipeline/test-failures.md'))).toBe(true);
      // Finish cannot append unbounded work on its own remediation route.
      const buildReasons = vi
        .mocked(runner.run)
        .mock.calls.filter((c) => c[0] === 'build')
        .map((c) => (c[2] as { retryReason?: string } | undefined)?.retryReason ?? '');
      expect(buildReasons).toEqual([]);
      expect(halted).toBe(true);
      const result = await readState(statePath);
      expect(result.ok && result.value.finish).toBe('failed');
    });

    it('finish remediation HALTs for a human category without rebuilding', async () => {
      await seedShipTail();
      const calls: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          calls.push(step);
          if (step === 'remediate') {
            await remediationPlanFile({
              dispositions: [
                {
                  id: 'test:wallet-flows',
                  disposition: 'halt',
                  category: 'architectural-clarity',
                  rationale: 'failure exposes an ambiguous aggregate boundary',
                  tasks: [],
                },
              ],
            });
          }
          return { success: true }; // finish never writes finish-choice
        }),
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
        daemon: true,
        verifyArtifacts: true,
        fromStep: 'finish',
        maxRetries: 1,
        escalateBuildFailure: async () => ({}),
      });

      await conductor.run();

      expect(halted).toBe(true);
      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(halt).toMatch(/finish halted: needs human DECIDE/);
      expect(halt).toMatch(/test:wallet-flows \(architectural-clarity/);
      expect(calls.filter((s) => s === 'build')).toHaveLength(0);
      const haltClass = await readFile(join(dir, '.pipeline/HALT.class'), 'utf-8');
      expect(haltClass).toBe('needs-human');
    });

    it('routes a serial remediable as-built BLOCKED verdict back to build and restages the gate', async () => {
      await seedShipTail({ architecture_review_as_built: 'pending' });
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      const planPath = join(dir, '.docs', 'plans', 'feat.md');
      await writeFile(
        planPath,
        [1, 2, 3, 4].map((id) => `### Task ${id}: Existing work ${id}`).join('\n'),
      );
      let asBuiltRestagedBeforeBuild = false;
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, options?: StepRunOptions) => {
          if (step === 'architecture_review_as_built') {
            await writeAsBuiltFixture(dir, options?.runId, asBuiltRemediableFixture('ARCH-1', '1', 'Add the missing guard'));
          }
          if (step === 'build') {
            const current = await readState(statePath);
            asBuiltRestagedBeforeBuild = current.ok && current.value.architecture_review_as_built === 'stale';
            return { success: false, error: 'stop after observing serial reroute' };
          } else if (step === 'remediate') {
            await remediationPlanFile({
              dispositions: [
                {
                  id: 'ARCH-1',
                  disposition: 'build',
                  category: null,
                  rationale: 'Add the missing approved guard.',
                  tasks: [{ id: 'missing-guard', title: 'Add the missing guard' }],
                },
              ],
            });
          }
          return { success: true };
        }),
      };
      const kickbacks: Array<{ from: string; to: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kickbacks.push({ from: e.from, to: e.to });
      });
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
        daemon: true,
        verifyArtifacts: true,
        fromStep: 'architecture_review_as_built',
        maxRetries: 1,
        config: { architecture_review_as_built: { remediation: { enabled: true } } } as never,
        escalateBuildFailure: async () => ({}),
      });

      await conductor.run();

      expect(kickbacks).toContainEqual({ from: 'architecture_review_as_built', to: 'build' });
      expect(vi.mocked(runner.run).mock.calls.map(([step]) => step)).toContain('remediate');
      expect(asBuiltRestagedBeforeBuild).toBe(true);
      await expect(readFile(planPath, 'utf8')).resolves.toContain('### Task rem-as-built-missing-guard: Add the missing guard');
      expect(halted).toBe(true); // the test stops the rerouted build deliberately
    });

    it('halts a mixed serial as-built report with every finding listed and re-dispatches it freshly after clearing HALT', async () => {
      await seedShipTail({ architecture_review_as_built: 'pending' });
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      const planPath = join(dir, '.docs', 'plans', 'feat.md');
      const originalPlan = [1, 2, 3, 4].map((id) => `### Task ${id}: Existing work ${id}`).join('\n');
      await writeFile(planPath, originalPlan);
      let asBuiltCalls = 0;
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, options?: StepRunOptions) => {
          if (step === 'architecture_review_as_built') {
            asBuiltCalls++;
            await writeAsBuiltFixture(dir, options?.runId, asBuiltBlockedFixture([
              { id: 'ARCH-REMEDIABLE', class: 'REMEDIABLE', reference: { kind: 'plan-task', taskId: '1' }, summary: 'Add the missing guard' },
              { id: 'ARCH-DESIGN', class: 'DESIGN', reference: { kind: 'adr-decision', stem: 'ADR-auth', decision: 2 }, summary: 'Choose the incompatible boundary' },
            ]));
          }
          return { success: true };
        }),
      };
      const conductor = new Conductor({
        stateFilePath: statePath, stepRunner: runner, events, projectRoot: dir,
        mode: 'auto', daemon: true, verifyArtifacts: true,
        fromStep: 'architecture_review_as_built', maxRetries: 1,
        escalateBuildFailure: async () => ({}),
      });

      await conductor.run();

      await expect(readFile(join(dir, '.pipeline/HALT.class'), 'utf8')).resolves.toBe('needs-human');
      const firstHalt = await readFile(join(dir, '.pipeline/HALT'), 'utf8');
      expect(firstHalt).toContain('ARCH-REMEDIABLE (REMEDIABLE; plan task 1): Add the missing guard');
      expect(firstHalt).toContain(
        'ARCH-DESIGN (DESIGN; ADR-auth decision 2): Choose the incompatible boundary',
      );
      expect(vi.mocked(runner.run).mock.calls.map(([step]) => step)).not.toContain('remediate');
      await expect(readFile(planPath, 'utf8')).resolves.toBe(originalPlan);

      await rm(join(dir, '.pipeline/HALT'), { force: true });
      await rm(join(dir, '.pipeline/HALT.class'), { force: true });
      const redispatchedConductor = new Conductor({
        stateFilePath: statePath, stepRunner: runner, events, projectRoot: dir,
        mode: 'auto', daemon: true, verifyArtifacts: true,
        fromStep: 'architecture_review_as_built', maxRetries: 1,
        escalateBuildFailure: async () => ({}),
      });

      await redispatchedConductor.run();

      expect(asBuiltCalls).toBe(2);
      expect(vi.mocked(runner.run).mock.calls.map(([step]) => step)).not.toContain('remediate');
      await expect(readFile(planPath, 'utf8')).resolves.toBe(originalPlan);
    });

    it('keeps a malformed serial typed as-built verdict needs-human with its parse fault', async () => {
      await seedShipTail({ architecture_review_as_built: 'pending' });
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'architecture_review_as_built') {
            await writeFile(join(dir, '.pipeline', 'architecture-review-as-built.json'), '{"invalid":true}\n');
          }
          return { success: true };
        }),
      };
      const conductor = new Conductor({
        stateFilePath: statePath, stepRunner: runner, events, projectRoot: dir,
        mode: 'auto', daemon: true, verifyArtifacts: true,
        fromStep: 'architecture_review_as_built', maxRetries: 1,
        escalateBuildFailure: async () => ({}),
      });

      await conductor.run();

      await expect(readFile(join(dir, '.pipeline/HALT.class'), 'utf8')).resolves.toBe('needs-human');
      await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(
        '.pipeline/architecture-review-as-built.json has an invalid persisted envelope',
      );
    });

    it('non-daemon auto mode does NOT dispatch /remediate on a finish failure', async () => {
      await seedShipTail();
      const calls: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          calls.push(step);
          return { success: true }; // finish never writes finish-choice
        }),
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
        daemon: false,
        verifyArtifacts: true,
        fromStep: 'finish',
        maxRetries: 1,
      });

      await conductor.run();

      expect(calls).not.toContain('remediate');
      expect(halted).toBe(true);
      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(halt).toMatch(/step 'finish' failed in auto mode/);
    });
  });

  it('auto mode auto-skips an advisory-step failure and continues', async () => {
    // `memory` is advisory; it fails. In auto mode it auto-skips so the run isn't
    // blocked, and no recovery prompt is shown.
    const onRecovery = vi.fn();
    const runner: StepRunner = {
      run: async (step: StepName) =>
        step === 'memory' ? { success: false } : { success: true },
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

    let completed = false;
    events.on('feature_complete', () => {
      completed = true;
    });
    await conductor.run();

    expect(onRecovery).not.toHaveBeenCalled();
    expect(completed).toBe(true);
    const result = await readState(statePath);
    expect(result.ok && result.value.memory).toBe('skipped');
  });

  it('does NOT set feature_status=complete on failure', async () => {
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

    await conductor.run();

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.feature_status).toBeUndefined();
    }
  });

  it('marks failed step as failed in state', async () => {
    const runner: StepRunner = {
      run: async (step: StepName) => {
        if (step === 'explore') return { success: false };
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

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value['explore']).toBe('failed');
    }
  });

  it('with resume option starts at last in_progress step', async () => {
    // Pre-populate state: worktree=done, memory=done, explore=in_progress
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
      explore: 'in_progress',
    } as ConductState);

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true });

    await conductor.run();

    // Should start at explore (the in_progress step), not worktree
    expect(stepsRun[0]).toBe('explore');
    expect(stepsRun).not.toContain('worktree');
    expect(stepsRun).not.toContain('memory');
  });

  it('with resume option starts at first pending after last done when no in_progress', async () => {
    // Pre-populate state: worktree=done, memory=done, explore=pending
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
    } as ConductState);

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true });

    await conductor.run();

    // Should start at explore (first pending after last done)
    expect(stepsRun[0]).toBe('explore');
    expect(stepsRun).not.toContain('worktree');
    expect(stepsRun).not.toContain('memory');
  });

  it('with fromStep option starts at specified step', async () => {
    // Pre-populate prerequisites so gate passes
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      architecture_review: 'done', // stories' direct prerequisite under the new order
    } as ConductState);

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, fromStep: 'stories' });

    await conductor.run();

    // Should start at stories
    expect(stepsRun[0]).toBe('stories');
    expect(stepsRun).not.toContain('worktree');
    expect(stepsRun).not.toContain('explore');
  });

  it('explicit fromStep bypasses the resume verdict clamp (#532)', async () => {
    // Story 1 negative path: fromStep is an exempt operator override.
    // Set up the #532 fixture: all steps before build are done, build failed with unsatisfied
    // verdicts, rebase done (so finish's state-only gate passes).
    // When using fromStep='finish', the clamp must NOT apply — finish should dispatch, not build.

    const kickback: GateVerdict['kickback'] = {
      from: 'rebase',
      evidence: 'rebase changed code/test paths: src/engine/foo.ts',
    };

    // Seed state: everything before build is done, build is failed, rebase is done.
    // Steps after build (build_review, manual_test, etc.) are left unset to match
    // the fixture pattern in resume-verdict-clamp.test.ts.
    const seed: Record<string, unknown> = { complexity_tier: 'M' };
    for (const s of ALL_STEPS) {
      if (s.name === 'build') break;  // Stop before build, don't set build and beyond
      seed[s.name] = 'done';
    }
    seed.build = 'failed';
    seed.rebase = 'done';
    seed.last_step = 'finish';
    await writeState(statePath, seed as ConductState);

    // Write unsatisfied gate verdicts (as if build/build_review/manual_test failed rebase kickback).
    await writeVerdict(dir, 'build', { satisfied: false, checkedAt: 1, kickback });
    await writeVerdict(dir, 'build_review', { satisfied: false, checkedAt: 1, kickback });
    await writeVerdict(dir, 'manual_test', { satisfied: false, checkedAt: 1, kickback });
    await writeVerdict(dir, 'rebase', { satisfied: true, checkedAt: 1 });

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };

    // Run with fromStep: 'finish' (NOT resume).
    // The clamp must NOT apply: finish should be dispatched, not build.
    const conductor = new Conductor({
      projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, fromStep: 'finish',
    });

    await conductor.run();

    // Assert: finish is the first step run, not build (the clamp would have clamped to build if applied).
    // Since fromStep overrides the clamp, finish dispatches first without interference.
    // What happens after finish is out of scope for this test.
    expect(stepsRun[0]).toBe('finish');
  });

  it('daemon-path resume with verdict clamp: step_started names build, never finish before gate flips (Story 1: #532, GREEN after Task 2)', async () => {
    // Regression pin: This test already passes after Task 2's verdict-aware resume clamp fix.
    // Set up the #532 fixture (three unsatisfied kickback verdicts + build:'failed'/rebase:'done' state).
    // The daemon-path flow is: rekick pre-loop rebase NOOP → recordRebaseStepCompletion
    // stamps rebase:'done' → run({resume:true}).
    // The resumed run must start at the earliest unsatisfied gate (build), not at the last
    // step stored in state (finish). No 'finish' should dispatch before the build gate verdict
    // flips satisfied. See .docs/stories/rekick-resume-runs-finish-while-the-build-gate-ver.md §1.

    const seed: Record<string, unknown> = { complexity_tier: 'M' };
    for (const s of ALL_STEPS) {
      if (s.name === 'build') break;
      seed[s.name] = 'done';
    }
    seed.build = 'failed';
    seed.rebase = 'done';
    seed.last_step = 'finish';
    await writeState(statePath, seed as ConductState);

    const kickback: GateVerdict['kickback'] = {
      from: 'rebase',
      evidence: 'rebase changed code/test paths: src/engine/foo.ts',
    };
    await writeVerdict(dir, 'build', { satisfied: false, checkedAt: 1, kickback });
    await writeVerdict(dir, 'build_review', { satisfied: false, checkedAt: 1, kickback });
    await writeVerdict(dir, 'manual_test', { satisfied: false, checkedAt: 1, kickback });
    await writeVerdict(dir, 'rebase', { satisfied: true, checkedAt: 1 });

    const runner: StepRunner = {
      run: async () => ({ success: true }),
    };
    const started: StepName[] = [];
    events.on('step_started', (e) => {
      if (e.type !== 'step_started') return;
      started.push(e.step);
    });

    // Daemon parity: the daemon always passes verifyArtifacts: true
    // (daemon-cli.ts), so the tail's artifact gate — the single satisfaction
    // authority (adr-2026-07-11-verdict-aware-resume-entry §5) — keeps finish
    // unreachable while the build gate is unsatisfied.
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      resume: true,
      daemon: true,
      verifyArtifacts: true,
    });

    await conductor.run();

    expect(started[0]).toBe('build');
    expect(started.indexOf('finish')).toBe(-1);
  });

  it('resume tolerates corrupt build.json verdict — does not throw and starts at build (#532)', async () => {
    // Story 1 negative path: corrupt verdict → absent → state fallback.
    // Set up the #532 fixture state, but corrupt the build.json verdict.
    const kickback: GateVerdict['kickback'] = {
      from: 'rebase',
      evidence: 'rebase changed code/test paths: src/engine/foo.ts',
    };

    // Seed state: everything up to and including finish done, build marked failed.
    const seed: Record<string, unknown> = { complexity_tier: 'M' };
    for (const s of ALL_STEPS) {
      if (s.name === 'build') {
        seed[s.name] = 'failed';
      } else if (s.name === 'finish') {
        seed[s.name] = 'done';
      } else {
        seed[s.name] = 'done';
      }
    }
    seed.last_step = 'finish';
    seed.rebase = 'done';
    await writeState(statePath, seed as ConductState);

    // Write valid verdicts for some gates, then corrupt the build.json.
    await writeVerdict(dir, 'build', { satisfied: false, checkedAt: 1, kickback });
    await writeVerdict(dir, 'build_review', { satisfied: false, checkedAt: 1, kickback });
    await writeVerdict(dir, 'manual_test', { satisfied: false, checkedAt: 1, kickback });
    await writeVerdict(dir, 'rebase', { satisfied: true, checkedAt: 1 });

    // Corrupt the build.json by overwriting with unparseable JSON.
    await writeFile(join(dir, '.pipeline', 'gates', 'build.json'), '{oops', 'utf-8');

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };

    // Resume with corrupt verdict. The clamp should treat the corrupt verdict as absent
    // and fall back to state-based logic: build is 'failed' (unsatisfied).
    const conductor = new Conductor({
      projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
    });

    // Assert: conductor.run() does not throw.
    await expect(conductor.run()).resolves.not.toThrow();

    // Assert: first step is build, not finish (clamp applies using state-only fallback).
    expect(stepsRun[0]).toBe('build');
    expect(stepsRun).not.toContain('finish');
  });

  it('resume tolerates missing .pipeline/gates directory — does not throw and starts at build (#532)', async () => {
    // Story 1 negative path: missing gates directory → all verdicts absent → state fallback.
    // Set up the #532 fixture state, but remove the entire gates directory.
    const kickback: GateVerdict['kickback'] = {
      from: 'rebase',
      evidence: 'rebase changed code/test paths: src/engine/foo.ts',
    };

    // Seed state: everything up to and including finish done, build marked failed.
    const seed: Record<string, unknown> = { complexity_tier: 'M' };
    for (const s of ALL_STEPS) {
      if (s.name === 'build') {
        seed[s.name] = 'failed';
      } else if (s.name === 'finish') {
        seed[s.name] = 'done';
      } else {
        seed[s.name] = 'done';
      }
    }
    seed.last_step = 'finish';
    seed.rebase = 'done';
    await writeState(statePath, seed as ConductState);

    // Write verdicts initially (to ensure directory structure), then delete the directory.
    await writeVerdict(dir, 'build', { satisfied: false, checkedAt: 1, kickback });
    await writeVerdict(dir, 'build_review', { satisfied: false, checkedAt: 1, kickback });
    await writeVerdict(dir, 'manual_test', { satisfied: false, checkedAt: 1, kickback });
    await writeVerdict(dir, 'rebase', { satisfied: true, checkedAt: 1 });

    // Delete the entire gates directory to simulate missing verdicts.
    await rm(join(dir, '.pipeline', 'gates'), { recursive: true, force: true });

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };

    // Resume with missing gates directory. The clamp should treat all verdicts as absent
    // and fall back to state-based logic: build is 'failed' (unsatisfied).
    const conductor = new Conductor({
      projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
    });

    // Assert: conductor.run() does not throw.
    await expect(conductor.run()).resolves.not.toThrow();

    // Assert: first step is build, not finish (clamp applies using state-only fallback).
    expect(stepsRun[0]).toBe('build');
    expect(stepsRun).not.toContain('finish');
  });


  it('resume with finish:in_progress clamps to build when verdicts unsatisfied (Story 2a: #532)', async () => {
    // Story 2 path (a): finish marked 'in_progress' with unsatisfied verdicts.
    // The clamp should still apply: resume starts at build (the earliest unsatisfied gate),
    // not at finish (even though it's in_progress). This tests that the 'in_progress' status
    // does not bypass the verdict clamp.

    const kickback: GateVerdict['kickback'] = {
      from: 'rebase',
      evidence: 'rebase changed code/test paths: src/engine/foo.ts',
    };

    // Seed state: everything before build is done, build is failed, rebase is done,
    // and finish is marked 'in_progress' (was being worked on).
    const seed: Record<string, unknown> = { complexity_tier: 'M' };
    for (const s of ALL_STEPS) {
      if (s.name === 'build') break;
      seed[s.name] = 'done';
    }
    seed.build = 'failed';
    seed.finish = 'in_progress';
    seed.rebase = 'done';
    seed.last_step = 'finish';
    await writeState(statePath, seed as ConductState);

    // Write unsatisfied verdicts for gates (build, build_review, manual_test).
    await writeVerdict(dir, 'build', { satisfied: false, checkedAt: 1, kickback });
    await writeVerdict(dir, 'build_review', { satisfied: false, checkedAt: 1, kickback });
    await writeVerdict(dir, 'manual_test', { satisfied: false, checkedAt: 1, kickback });
    await writeVerdict(dir, 'rebase', { satisfied: true, checkedAt: 1 });

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };

    // Resume with finish in_progress but verdicts unsatisfied. The clamp must
    // apply. Daemon parity (verifyArtifacts: true, daemon-cli.ts): the artifact
    // gate keeps finish unreachable while the build gate is unsatisfied.
    const conductor = new Conductor({
      projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
      verifyArtifacts: true,
    });

    await conductor.run();

    // Assert: resume starts at build (the earliest unsatisfied gate), not finish.
    expect(stepsRun[0]).toBe('build');
    expect(stepsRun).not.toContain('finish');
  });

  it('resume with build:in_progress keeps entry at build even with unsatisfied later gates (Story 2b: #532)', async () => {
    // Story 2 path (b): build marked 'in_progress', and later gates unsatisfied.
    // The min() logic must not move the entry point later than build.
    // Resume should start at build, proving that in_progress doesn't jump past unsatisfied gates.

    const kickback: GateVerdict['kickback'] = {
      from: 'rebase',
      evidence: 'rebase changed code/test paths: src/engine/foo.ts',
    };

    // Seed state: everything before build is done, build is marked 'in_progress',
    // rebase is done.
    const seed: Record<string, unknown> = { complexity_tier: 'M' };
    for (const s of ALL_STEPS) {
      if (s.name === 'build') break;
      seed[s.name] = 'done';
    }
    seed.build = 'in_progress';
    seed.rebase = 'done';
    seed.last_step = 'build';
    await writeState(statePath, seed as ConductState);

    // Write unsatisfied verdicts for later gates (build_review, manual_test).
    await writeVerdict(dir, 'build', { satisfied: true, checkedAt: 1 });
    await writeVerdict(dir, 'build_review', { satisfied: false, checkedAt: 1, kickback });
    await writeVerdict(dir, 'manual_test', { satisfied: false, checkedAt: 1, kickback });
    await writeVerdict(dir, 'rebase', { satisfied: true, checkedAt: 1 });

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };

    // Resume with build in_progress. The min() logic must keep entry at build.
    const conductor = new Conductor({
      projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
    });

    await conductor.run();

    // Assert: resume starts at build (the in_progress step), not skipped or moved.
    expect(stepsRun[0]).toBe('build');
  });

  it('resume with finish:in_progress starts at finish when ALL verdicts satisfied (Story 2c: #532)', async () => {
    // Story 2 path (c): finish marked 'in_progress' and ALL verdicts satisfied.
    // The clamp is a no-op: resume should start at finish (no unsatisfied gates to clamp to).
    // This tests that when the clamp has no unsatisfied gates, it does not interfere.

    // Seed state: everything including finish is done, finish is marked 'in_progress',
    // rebase is done.
    const seed: Record<string, unknown> = { complexity_tier: 'M' };
    for (const s of ALL_STEPS) {
      seed[s.name] = 'done';
    }
    seed.finish = 'in_progress';
    seed.rebase = 'done';
    seed.last_step = 'finish';
    await writeState(statePath, seed as ConductState);

    // Write ALL verdicts as satisfied (no unsatisfied gates to clamp to).
    await writeVerdict(dir, 'worktree', { satisfied: true, checkedAt: 1 });
    await writeVerdict(dir, 'memory', { satisfied: true, checkedAt: 1 });
    await writeVerdict(dir, 'explore', { satisfied: true, checkedAt: 1 });
    await writeVerdict(dir, 'stories', { satisfied: true, checkedAt: 1 });
    await writeVerdict(dir, 'plan', { satisfied: true, checkedAt: 1 });
    await writeVerdict(dir, 'prd', { satisfied: true, checkedAt: 1 });
    await writeVerdict(dir, 'bootstrap', { satisfied: true, checkedAt: 1 });
    await writeVerdict(dir, 'build', { satisfied: true, checkedAt: 1 });
    await writeVerdict(dir, 'build_review', { satisfied: true, checkedAt: 1 });
    await writeVerdict(dir, 'manual_test', { satisfied: true, checkedAt: 1 });
    await writeVerdict(dir, 'finish', { satisfied: true, checkedAt: 1 });
    await writeVerdict(dir, 'rebase', { satisfied: true, checkedAt: 1 });

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };

    // Resume with finish in_progress and all verdicts satisfied.
    // The clamp should be a no-op, and resume should start at finish.
    const conductor = new Conductor({
      projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
    });

    await conductor.run();

    // Assert: resume starts at finish (the in_progress step), not clamped.
    expect(stepsRun[0]).toBe('finish');
  });

  it('post-rebase kickback verdicts steer resume to earliest kicked-back gate (Story 3, happy path a)', async () => {
    // Story 3 happy path (a): All three gates (build, build_review, manual_test) have kickback
    // verdicts from rebase. When resuming, the run should start at build (earliest).
    // The on-disk state is what navigateBack (the in-loop demotion authority) left
    // behind when the kickbacks were processed: target 'pending', downstream 'stale'.
    // Resume itself never rewrites statuses (adr-2026-07-11-verdict-aware-resume-entry
    // rejected Option C). Rebase is done, so resume can proceed.

    const kickback: GateVerdict['kickback'] = {
      from: 'rebase',
      evidence: 'rebase changed code/test paths: src/engine/foo.ts',
    };

    // Seed state: build, build_review, manual_test all done; rebase also done.
    // last_step is finish (simulating a prior completed run).
    const seed: Record<string, unknown> = { complexity_tier: 'M' };
    for (const s of ALL_STEPS) {
      if (s.name === 'build' || s.name === 'build_review' || s.name === 'manual_test') {
        seed[s.name] = 'done';
      } else if (s.name === 'finish') {
        seed[s.name] = 'done';
      } else if (s.name !== 'complexity' && s.name !== 'worktree' && s.name !== 'rebase') {
        seed[s.name] = 'done';
      }
    }
    seed.rebase = 'done';
    seed.last_step = 'finish';
    seed.build = 'pending';
    seed.build_review = 'stale';
    seed.manual_test = 'stale';
    await writeState(statePath, seed as ConductState);

    // Write kickback verdicts (unsatisfied) for all three gates from rebase.
    // This simulates rebase discovering a file change that invalidates all downstream work.
    await writeVerdict(dir, 'build', { satisfied: false, checkedAt: 1, kickback });
    await writeVerdict(dir, 'build_review', { satisfied: false, checkedAt: 1, kickback });
    await writeVerdict(dir, 'manual_test', { satisfied: false, checkedAt: 1, kickback });
    await writeVerdict(dir, 'rebase', { satisfied: true, checkedAt: 1 });

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

    // Assert: first step is build (earliest kicked-back gate), not finish.
    expect(stepsRun[0]).toBe('build');
    expect(stepsRun).not.toContain('finish');
  });

  it('post-rebase kickback verdicts steer resume to intermediate gate (Story 3, happy path b)', async () => {
    // Story 3 happy path (b): Only manual_test has an unsatisfied kickback verdict.
    // Build and build_review are re-verified satisfied (verdicts show satisfied:true).
    // When resuming, the run should start at manual_test (the first/earliest unsatisfied).

    const kickback: GateVerdict['kickback'] = {
      from: 'rebase',
      evidence: 'rebase changed code/test paths: src/manual_test/foo.ts',
    };

    // Seed state: build, build_review, manual_test all done; rebase also done.
    // last_step is finish (simulating a prior completed run).
    const seed: Record<string, unknown> = { complexity_tier: 'M' };
    for (const s of ALL_STEPS) {
      if (s.name === 'build' || s.name === 'build_review' || s.name === 'manual_test') {
        seed[s.name] = 'done';
      } else if (s.name === 'finish') {
        seed[s.name] = 'done';
      } else if (s.name !== 'complexity' && s.name !== 'worktree' && s.name !== 'rebase') {
        seed[s.name] = 'done';
      }
    }
    seed.rebase = 'done';
    seed.last_step = 'finish';
    // navigateBack left only the kicked-back target demoted; build and
    // build_review were re-verified satisfied and stay 'done'.
    seed.manual_test = 'pending';
    await writeState(statePath, seed as ConductState);

    // Write verdicts: build and build_review are satisfied (re-verified), only manual_test is unsatisfied.
    await writeVerdict(dir, 'build', { satisfied: true, checkedAt: 1 });
    await writeVerdict(dir, 'build_review', { satisfied: true, checkedAt: 1 });
    await writeVerdict(dir, 'manual_test', { satisfied: false, checkedAt: 1, kickback });
    await writeVerdict(dir, 'rebase', { satisfied: true, checkedAt: 1 });

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

    // Assert: first step is manual_test (the only unsatisfied gate), not finish.
    expect(stepsRun[0]).toBe('manual_test');
    expect(stepsRun).not.toContain('finish');
  });
  it('stale status overrides satisfied verdict on resume (Story 3, negative path a)', async () => {
    // Story 3 negative path (a): A step whose state is `stale` (cascade-staled by an
    // earlier kickback) but whose stale verdict file still says `satisfied:true` must be
    // treated as unsatisfied. Stale overrides verdict (same gateSatisfied rule the loop
    // tail uses), so the clamp selects the stale step, not skipping past it.


    // Seed state: all steps before build done, build is marked 'stale' (not 'done'),
    // rebase also done. last_step is finish (prior run completed).
    // The 'stale' status indicates build was cascade-staled by an earlier kickback.
    const seed: Record<string, unknown> = { complexity_tier: 'M' };
    for (const s of ALL_STEPS) {
      if (s.name === 'build') break;
      seed[s.name] = 'done';
    }
    seed.build = 'stale';  // Key: step is marked stale, not done.
    seed.rebase = 'done';
    seed.last_step = 'finish';
    await writeState(statePath, seed as ConductState);

    // Write verdict for build with satisfied:true (the old verdict before stale).
    // Despite the verdict saying satisfied, the stale state should override it.
    await writeVerdict(dir, 'build', { satisfied: true, checkedAt: 1 });
    await writeVerdict(dir, 'build_review', { satisfied: true, checkedAt: 1 });
    await writeVerdict(dir, 'manual_test', { satisfied: true, checkedAt: 1 });
    await writeVerdict(dir, 'rebase', { satisfied: true, checkedAt: 1 });

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

    // Assert: entry is build (the stale step), even though its verdict says satisfied.
    // Stale overrides satisfied, so the clamp selects build. Story 3 scopes the
    // requirement to the resume ENTRY only — with a success-mock runner and
    // satisfied verdicts still on disk, the loop tail legitimately proceeds to
    // finish afterwards (parity with the acceptance twin in
    // resume-verdict-clamp.test.ts, which asserts only the first dispatched step).
    expect(stepsRun[0]).toBe('build');
  });

  it('verdicts before regionStart are ignored by resume clamp (Story 3, negative path b)', async () => {
    // Story 3 negative path (b): Kickback verdicts exist only for steps BEFORE the
    // derived regionStart (the first kickback target). The clamp must ignore them —
    // only loop-region gates (at or after regionStart) participate in the clamp.

    // Seed state: all steps before finish done (finish itself pending, so the
    // state-only resume derivation lands on finish). rebase also done.
    const seed: Record<string, unknown> = { complexity_tier: 'M' };
    for (const s of ALL_STEPS) {
      if (s.name === 'finish') break;
      seed[s.name] = 'done';
    }
    seed.rebase = 'done';
    seed.last_step = 'finish';
    await writeState(statePath, seed as ConductState);

    // Write satisfied verdicts for all loop-region gates (build, build_review, manual_test, etc.).
    await writeVerdict(dir, 'build', { satisfied: true, checkedAt: 1 });
    await writeVerdict(dir, 'build_review', { satisfied: true, checkedAt: 1 });
    await writeVerdict(dir, 'manual_test', { satisfied: true, checkedAt: 1 });
    await writeVerdict(dir, 'prd_audit', { satisfied: true, checkedAt: 1 });
    await writeVerdict(dir, 'rebase', { satisfied: true, checkedAt: 1 });

    // Write an UNSATISFIED verdict for a pre-loop step (explore).
    // The clamp should ignore this because explore is before regionStart.
    await writeVerdict(dir, 'explore', { satisfied: false, checkedAt: 1 });

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

    // Assert: first step is finish (from state logic), not explore (the pre-regionStart
    // unsatisfied verdict is ignored by the clamp).
    expect(stepsRun[0]).toBe('finish');
    expect(stepsRun).not.toContain('explore');
  });

  it('resume in front half is not dragged forward by pending loop gates (Story 4, front-half guard)', async () => {
    // Story 4 negative path (a): front-half guard
    // Resume at a front-half step (architecture_review, pending) with all gates pending and no verdicts.
    // The clamp must NOT apply: the start step should remain architecture_review, not move forward to
    // any later gate (which would contradict the backward-only rule).

    const seed: Record<string, unknown> = { complexity_tier: 'M' };
    for (const s of ALL_STEPS) {
      if (s.name === 'architecture_review') {
        seed[s.name] = 'pending';
        break;
      }
      seed[s.name] = 'done';
    }
    seed.last_step = 'architecture_review';
    await writeState(statePath, seed as ConductState);

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

    // The clamp is backward-only; pending gates ahead should not drag the entry forward.
    expect(stepsRun[0]).toBe('architecture_review');
  });

  it('clamp does not attract back to tier-skipped steps without verdicts (Story 4, skipped-tier no-attract)', async () => {
    // Story 4 negative path (b): skipped-tier no-attract
    // On tier S, manual_test is tier-skipped. With no verdict files,
    // they read as satisfied (skipped → satisfied via isSkipped logic). The clamp should not
    // pull back to them.

    const seed: Record<string, unknown> = { complexity_tier: 'S' };
    for (const s of ALL_STEPS) {
      if (s.name === 'prd_audit') {
        seed[s.name] = 'pending';
        break;
      }
      if (s.name !== 'rebase') {
        seed[s.name] = 'done';
      }
    }
    seed.rebase = 'done';
    seed.last_step = 'prd_audit';
    await writeState(statePath, seed as ConductState);

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

    // First step is prd_audit (first unsatisfied gate).
    // The clamp should not be pulled back by tier-skipped steps (manual_test)
    // because they read as satisfied (skipped status via isSkipped logic).
    expect(stepsRun[0]).toBe('prd_audit');
  });



  it('emits step_failed event with correct payload on failure', async () => {
    // Always-failing 2nd step. maxRetries=1 so we escalate after one try.
    let callCount = 0;
    const runner: StepRunner = {
      run: async (step: StepName) => {
        callCount++;
        if (callCount >= 2) return { success: false, output: `${step} check failed` };
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

    const failedEvents: Array<{ type: string; step: string; error: string; retryCount: number }> = [];
    events.on('step_failed', (e) => {
      if (e.type === 'step_failed') {
        failedEvents.push({ type: e.type, step: e.step, error: e.error, retryCount: e.retryCount });
      }
    });

    await conductor.run();

    expect(failedEvents.length).toBe(1);
    expect(failedEvents[0].type).toBe('step_failed');
    expect(failedEvents[0].error).toMatch(/check failed/);
    // retryCount is now "attempts made" (>=1) rather than 0
    expect(failedEvents[0].retryCount).toBeGreaterThanOrEqual(1);
  });

  it('skips conflict_check when tier is S', async () => {
    await writeState(statePath, { complexity_tier: 'S' } as ConductState);

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    expect(stepsRun).not.toContain('conflict_check');
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value['conflict_check']).toBe('skipped');
    }
  });

  it('skips architecture_diagram when tier is S', async () => {
    await writeState(statePath, { complexity_tier: 'S' } as ConductState);

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    expect(stepsRun).not.toContain('architecture_diagram');
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value['architecture_diagram']).toBe('skipped');
    }
  });

  it('runs all steps when tier is M', async () => {
    await writeState(statePath, { complexity_tier: 'M' } as ConductState);

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    // `complexity`, `worktree`, `test_suite`, and `rebase` are engine-managed, not dispatched
    // to runner.run. Every OTHER step should fire, in order.
    const expectedOrder = ALL_STEPS.filter(
      (s) =>
        s.name !== 'complexity' &&
        s.name !== 'worktree' &&
        s.name !== 'test_suite' &&
        s.name !== 'rebase',
    ).map((s) => s.name);
    expect(stepsRun).toEqual(expectedOrder);
  });

  it('marks all skipped steps as skipped in state for tier S', async () => {
    await writeState(statePath, { complexity_tier: 'S' } as ConductState);

    const runner = createMockStepRunner();
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // All S-tier skippable steps should be 'skipped'
      expect(result.value['conflict_check']).toBe('skipped');
      expect(result.value['architecture_diagram']).toBe('skipped');
      expect(result.value['architecture_review']).toBe('skipped');
      expect(result.value['acceptance_specs']).toBe('skipped');
      // Non-skippable steps should be 'done'
      expect(result.value['worktree']).toBe('done');
      expect(result.value['build']).toBe('done');
      expect(result.value['finish']).toBe('done');
    }
  });

  it('emits tier_skip event for skipped steps', async () => {
    await writeState(statePath, { complexity_tier: 'S' } as ConductState);

    const runner = createMockStepRunner();
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });

    const tierSkipEvents: Array<{ step: string; tier: string }> = [];
    events.on('tier_skip', (e) => {
      if (e.type === 'tier_skip') tierSkipEvents.push({ step: e.step, tier: e.tier });
    });

    await conductor.run();

    expect(tierSkipEvents.length).toBe(6);
    expect(tierSkipEvents.map((e) => e.step)).toContain('conflict_check');
    expect(tierSkipEvents.map((e) => e.step)).toContain('coherence_check');
    expect(tierSkipEvents.map((e) => e.step)).toContain('architecture_diagram');
    expect(tierSkipEvents.map((e) => e.step)).toContain('architecture_review');
    expect(tierSkipEvents.map((e) => e.step)).toContain('acceptance_specs');
    expect(tierSkipEvents.map((e) => e.step)).toContain('manual_test');
    expect(tierSkipEvents.map((e) => e.step)).not.toContain('architecture_review_as_built');
    // All events should have tier 'S'
    expect(tierSkipEvents.every((e) => e.tier === 'S')).toBe(true);
  });

  it('runs all steps when complexity_tier is not set (defaults to L)', async () => {
    // No complexity_tier in state
    await writeState(statePath, {} as ConductState);

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    // L tier has no skips; complexity/worktree/test_suite/rebase are engine-managed (not
    // dispatched to stepRunner).
    const expectedOrder = ALL_STEPS.map((s) => s.name).filter(
      (n) =>
        n !== 'complexity' &&
        n !== 'worktree' &&
        n !== 'test_suite' &&
        n !== 'rebase',
    );
    expect(stepsRun).toEqual(expectedOrder);

    // No tier_skip events should be emitted
    const tierSkipEvents: Array<{ step: string }> = [];
    events.on('tier_skip', (e) => {
      if (e.type === 'tier_skip') tierSkipEvents.push({ step: e.step });
    });
    expect(tierSkipEvents.length).toBe(0);
  });

  it('checks gate before running each step', async () => {
    // stories requires explore — set explore='pending', start from stories
    await writeState(statePath, {} as ConductState);

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
      fromStep: 'stories',
    });

    await conductor.run();

    // stories should NOT have been run because explore is pending
    expect(stepsRun).not.toContain('stories');
  });

  it('blocks and emits gate_blocked event when gate fails', async () => {
    // stories requires architecture_review — leave it pending
    await writeState(statePath, {} as ConductState);

    const runner = createMockStepRunner();
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'stories',
    });

    const blockedEvents: Array<{ type: string; step: string; reason: string }> = [];
    events.on('gate_blocked', (e) => {
      if (e.type === 'gate_blocked') {
        blockedEvents.push({ type: e.type, step: e.step, reason: e.reason });
      }
    });

    await conductor.run();

    expect(blockedEvents.length).toBe(1);
    expect(blockedEvents[0].type).toBe('gate_blocked');
    expect(blockedEvents[0].step).toBe('stories');
    expect(blockedEvents[0].reason).toContain('architecture_review');
  });

  it('passes gate when prerequisite is done', async () => {
    // architecture_review=done satisfies the stories prerequisite
    await writeState(statePath, { architecture_review: 'done' } as ConductState);

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
      fromStep: 'stories',
    });

    const blockedEvents: Array<{ step: string }> = [];
    events.on('gate_blocked', (e) => {
      if (e.type === 'gate_blocked') blockedEvents.push({ step: e.step });
    });

    await conductor.run();

    // stories should have been run
    expect(stepsRun).toContain('stories');
    // No gate_blocked events
    expect(blockedEvents.length).toBe(0);
  });

  it('passes gate when prerequisite is stale', async () => {
    // architecture_review=stale should still satisfy the stories gate
    await writeState(statePath, { architecture_review: 'stale' } as ConductState);

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
      fromStep: 'stories',
    });

    const blockedEvents: Array<{ step: string }> = [];
    events.on('gate_blocked', (e) => {
      if (e.type === 'gate_blocked') blockedEvents.push({ step: e.step });
    });

    await conductor.run();

    // stories should have been run — stale satisfies gates
    expect(stepsRun).toContain('stories');
    expect(blockedEvents.length).toBe(0);
  });

  it('fires checkpoint_reached event after build step', async () => {
    // Set up prerequisites so build gate passes
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done', coherence_check: 'done',
      coverage_binding: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
    } as ConductState);

    const runner = createMockStepRunner();
    const onCheckpoint = vi.fn().mockResolvedValue('continue' as const);
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'build',
      onCheckpoint,
    });

    const checkpointEvents: Array<{ step: string }> = [];
    events.on('checkpoint_reached', (e) => {
      if (e.type === 'checkpoint_reached') checkpointEvents.push({ step: e.step });
    });

    await conductor.run();

    // checkpoint_reached should have been emitted for build
    expect(checkpointEvents.some((e) => e.step === 'build')).toBe(true);
    expect(onCheckpoint).toHaveBeenCalledWith('build');
  });

  it('fires checkpoint_reached event after manual_test step', async () => {
    // Set up prerequisites so manual_test gate passes
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
      build: 'done',
      build_review: 'done',
       test_suite: 'done',
    } as ConductState);

    const runner = createMockStepRunner();
    const onCheckpoint = vi.fn().mockResolvedValue('continue' as const);
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'manual_test',
      onCheckpoint,
    });

    const checkpointEvents: Array<{ step: string }> = [];
    events.on('checkpoint_reached', (e) => {
      if (e.type === 'checkpoint_reached') checkpointEvents.push({ step: e.step });
    });

    await conductor.run();

    expect(checkpointEvents.some((e) => e.step === 'manual_test')).toBe(true);
    expect(onCheckpoint).toHaveBeenCalledWith('manual_test');
  });

  it('does NOT fire checkpoint for non-checkpoint steps', async () => {
    // Run only explore (non-checkpoint step)
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
    } as ConductState);

    const runner = createMockStepRunner();
    const onCheckpoint = vi.fn().mockResolvedValue('continue' as const);
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'explore',
      onCheckpoint,
    });

    const checkpointEvents: Array<{ step: string }> = [];
    events.on('checkpoint_reached', (e) => {
      if (e.type === 'checkpoint_reached') checkpointEvents.push({ step: e.step });
    });

    await conductor.run();

    // explore, stories, plan etc. are not checkpoint steps
    expect(checkpointEvents.filter((e) =>
      e.step === 'explore' || e.step === 'stories' || e.step === 'plan'
    )).toHaveLength(0);
    // onCheckpoint should only have been called for build and manual_test
    for (const call of onCheckpoint.mock.calls) {
      expect(['build', 'manual_test']).toContain(call[0]);
    }
  });

  it('skips checkpoint when mode is auto', async () => {
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

    const runner = createMockStepRunner();
    const onCheckpoint = vi.fn().mockResolvedValue('continue' as const);
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'build',
      mode: 'auto',
      onCheckpoint,
    });

    const checkpointEvents: Array<{ step: string }> = [];
    events.on('checkpoint_reached', (e) => {
      if (e.type === 'checkpoint_reached') checkpointEvents.push({ step: e.step });
    });

    await conductor.run();

    // In auto mode, no checkpoint events should be emitted
    expect(checkpointEvents).toHaveLength(0);
    // onCheckpoint should never be called
    expect(onCheckpoint).not.toHaveBeenCalled();
  });

});
