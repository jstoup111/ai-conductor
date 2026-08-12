import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  Conductor,
  type ConductorOptions,
  type StepRunner,
} from '../../src/engine/conductor.js';
import { runDaemon, type DaemonDeps, type FeatureOutcome } from '../../src/engine/daemon.js';
import {
  makeRunFeature,
  type FeatureRunnerDeps,
} from '../../src/engine/daemon-runner.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS, STEP_GROUPS } from '../../src/engine/steps.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import type { HarnessConfig } from '../../src/types/config.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { renderReport } from '../../src/engine/report-renderer.js';

const FEATURE_SLUG = 'boundary-aware-operator-parking';

type SchedulingUnitRef =
  | { kind: 'step'; name: StepName }
  | { kind: 'group'; name: string }
  | { kind: 'pre-first-unit' };

interface OperatorParkedTermination {
  kind: 'operator-parked';
  boundary: SchedulingUnitRef;
}

type BoundaryAwareConductorOptions = ConductorOptions & {
  featureSlug: string;
  operatorParkBoundary: () => Promise<boolean>;
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const roots: string[] = [];

async function makeRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function seedPending(
  statePath: string,
  pending: StepName[],
): Promise<void> {
  const state: Record<string, unknown> = {
    complexity_tier: 'M',
    track: 'product',
    feature_desc: FEATURE_SLUG,
  };
  for (const step of ALL_STEPS) {
    if (!pending.includes(step.name)) state[step.name] = 'done';
  }
  await writeState(statePath, state as ConductState);
}

function noExternalIo(): Pick<ConductorOptions, 'gh' | 'git' | 'runGh'> {
  const result = { stdout: '', stderr: '', exitCode: 0 };
  return {
    gh: vi.fn(async () => result),
    git: vi.fn(async () => result),
    runGh: vi.fn(async () => result),
  };
}

function makeConductor(
  root: string,
  statePath: string,
  runner: StepRunner,
  extra: Partial<BoundaryAwareConductorOptions> = {},
): Conductor {
  const options = {
    projectRoot: root,
    stateFilePath: statePath,
    stepRunner: runner,
    events: new ConductorEventEmitter(),
    mode: 'auto',
    daemon: true,
    verifyArtifacts: false,
    maxRetries: 1,
    featureSlug: FEATURE_SLUG,
    operatorParkBoundary: async () => false,
    ...noExternalIo(),
    ...extra,
  } satisfies BoundaryAwareConductorOptions;
  return new Conductor(options);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('boundary-aware operator parking acceptance', () => {
  it('FR-1/FR-3/FR-4/FR-10: drains one serial step, persists its normal result, and stops before the next step', async () => {
    const root = await makeRoot('operator-park-serial-');
    const statePath = join(root, 'conduct-state.json');
    await seedPending(statePath, ['memory', 'explore']);

    let parked = false;
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        calls.push(step);
        if (step === 'memory') parked = true;
        return { success: true };
      }),
    };
    const conductor = makeConductor(root, statePath, runner, {
      operatorParkBoundary: async () => parked,
    });

    const result = await conductor.run() as unknown as OperatorParkedTermination;
    const state = await readState(statePath);

    expect(calls).toEqual(['memory']);
    expect(state.ok && state.value.memory).toBe('done');
    expect(state.ok && state.value.explore).not.toBe('in_progress');
    expect(result).toMatchObject({
      kind: 'operator-parked',
      boundary: { kind: 'step', name: 'memory' },
    });
  });

  it('FR-2/FR-3/FR-4/FR-8/FR-10: settles every configured-group member and joins once before parking', async () => {
    const root = await makeRoot('operator-park-group-');
    const statePath = join(root, 'conduct-state.json');
    await seedPending(statePath, ['memory', 'explore']);

    const alpha = deferred<void>();
    const beta = deferred<void>();
    const bothStarted = deferred<void>();
    const alphaSettled = deferred<void>();
    const timeline: string[] = [];
    let parked = false;
    let started = 0;
    const runner: StepRunner = {
      run: vi.fn(async (step: string) => {
        if (step === 'alpha' || step === 'beta') {
          timeline.push(`${step}:start`);
          started += 1;
          if (started === 2) bothStarted.resolve();
          await (step === 'alpha' ? alpha.promise : beta.promise);
          timeline.push(`${step}:end`);
          if (step === 'alpha') alphaSettled.resolve();
          return { success: true };
        }
        timeline.push(`${step}:unexpected`);
        return { success: true };
      }),
    };
    const config: HarnessConfig = {
      validation_concurrency: 2,
      steps: {
        memory: {
          parallel: [{ name: 'alpha' }, { name: 'beta' }],
        },
      },
    };
    const conductor = makeConductor(root, statePath, runner, {
      config,
      operatorParkBoundary: async () => parked,
    });

    const running = conductor.run() as unknown as Promise<OperatorParkedTermination>;
    await bothStarted.promise;
    alpha.resolve();
    await alphaSettled.promise;
    parked = true;
    beta.resolve();
    const result = await running;
    const state = await readState(statePath);

    expect(timeline).toEqual(['alpha:start', 'beta:start', 'alpha:end', 'beta:end']);
    expect(state.ok && state.value.memory).toBe('done');
    expect(state.ok && (state.value as Record<string, unknown>).memory__alpha).toBe('done');
    expect(state.ok && (state.value as Record<string, unknown>).memory__beta).toBe('done');
    expect(result).toMatchObject({
      kind: 'operator-parked',
      boundary: { kind: 'group', name: 'memory' },
    });
  });

  it('FR-7/FR-10: fails toward a visible pre-first-unit park when the boundary read is indeterminate', async () => {
    const root = await makeRoot('operator-park-read-error-');
    const statePath = join(root, 'conduct-state.json');
    await seedPending(statePath, ['memory']);
    const runner: StepRunner = {
      run: vi.fn(async () => ({ success: true })),
    };
    const conductor = makeConductor(root, statePath, runner, {
      operatorParkBoundary: async () => {
        throw new Error('EACCES reading repo-root park marker');
      },
    });

    const result = await conductor.run() as unknown as OperatorParkedTermination;

    expect(runner.run).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      kind: 'operator-parked',
      boundary: { kind: 'pre-first-unit' },
    });
  });

  it('FR-8: inventories configured, SHIP, and deterministic BUILD groups through the shared scheduler registry', () => {
    const groups = Object.values(STEP_GROUPS).map((group) => group.members);

    expect(groups).toContainEqual([
      'manual_test',
      'prd_audit',
      'architecture_review_as_built',
    ]);
    expect(groups).toContainEqual(['wiring_check', 'test_suite']);
  });

  it.each([
    {
      label: 'SHIP',
      pending: [
        'manual_test',
        'prd_audit',
        'architecture_review_as_built',
        'rebase',
      ] as StepName[],
      expectedMembers: [
        'manual_test',
        'prd_audit',
        'architecture_review_as_built',
      ] as StepName[],
      expectedCalls: [
        'manual_test',
        'prd_audit',
        'architecture_review_as_built',
      ] as StepName[],
      expectedGroup: 'validation',
      later: 'rebase' as StepName,
    },
    {
      label: 'BUILD',
      pending: [
        'wiring_check',
        'test_suite',
        'build_review',
      ] as StepName[],
      expectedMembers: ['wiring_check', 'test_suite'] as StepName[],
      // wiring_check is a deprecated no-op: it is still a group member and
      // still settles 'done' at the join, but it settles in-process and never
      // reaches a dispatch.
      expectedCalls: ['test_suite'] as StepName[],
      expectedGroup: 'build_verification',
      later: 'build_review' as StepName,
    },
  ])('FR-8: $label built-in group joins before the accepted park boundary', async ({
    pending,
    expectedMembers,
    expectedCalls,
    expectedGroup,
    later,
  }) => {
    const root = await makeRoot(`operator-park-${expectedGroup}-`);
    const statePath = join(root, 'conduct-state.json');
    await seedPending(statePath, pending);
    const calls: StepName[] = [];
    let parked = false;
    const ensure = vi.fn(async () => {
      calls.push('test_suite');
      parked = true;
      return {
        status: 'EXECUTED',
        freshness: { status: 'STALE', reason: 'missing' },
        evidence: {} as never,
      } as const;
    });
    const conductor = makeConductor(
      root,
      statePath,
      {
        run: vi.fn(async (step: StepName) => {
          calls.push(step);
          parked = true;
          return { success: true };
        }),
      },
      {
        fromStep: expectedMembers[0],
        config: { validation_concurrency: 2 },
        operatorParkBoundary: async () => parked,
        ...(expectedGroup === 'build_verification'
          ? {
              fullSuiteVerifier: {
                ensure,
                inspect: async () => ({ status: 'STALE' as const, reason: 'missing' }),
              },
            }
          : {}),
      },
    );

    const result = await conductor.run();
    const state = await readState(statePath);

    expect(new Set(calls)).toEqual(new Set(expectedCalls));
    expect(calls).not.toContain(later);
    expect(ensure).toHaveBeenCalledTimes(
      expectedGroup === 'build_verification' ? 1 : 0,
    );
    expect(result).toMatchObject({
      kind: 'operator-parked',
      boundary: { kind: 'group', name: expectedGroup },
    });
    expect(
      expectedMembers.every(
        (member) => state.ok && state.value[member] === 'done',
      ),
    ).toBe(true);
  });

  it('FR-10: persisted reporting names the exact accepted scheduling boundary', async () => {
    const root = await makeRoot('operator-park-report-');
    const eventsPath = join(root, 'events.jsonl');
    await writeFile(
      eventsPath,
      `${JSON.stringify({
        type: 'operator_park_boundary',
        featureSlug: FEATURE_SLUG,
        boundary: { kind: 'group', name: 'build_verification' },
        timestamp: '2026-07-30T00:00:00.000Z',
      })}\n`,
      'utf8',
    );

    const report = renderReport(eventsPath);

    expect(report).toContain(FEATURE_SLUG);
    expect(report).toContain('build_verification');
    expect(report).toContain('group');
    expect(report).not.toMatch(/\bDONE\b|\bHALT\b|generic error/i);
  });

  it('FR-5: classifies the typed conductor stop before marker inference and forbidden completion side effects', async () => {
    const worktreeRoot = await makeRoot('operator-park-runner-');
    const termination: OperatorParkedTermination = {
      kind: 'operator-parked',
      boundary: { kind: 'step', name: 'memory' },
    };
    const readOutcome = vi.fn(async () => {
      throw new Error('marker inference must not run for an intentional park');
    });
    const teardownWorktree = vi.fn(async () => {});
    const markProcessed = vi.fn(async () => {});
    const featureDeps = {
      createWorktree: async () => ({ path: worktreeRoot, branch: 'feat/boundary' }),
      runConductor: async () => termination,
      readOutcome,
      teardownWorktree,
      markProcessed,
      daemon: false,
      project: 'ai-conductor',
      projectRoot: '/tmp/project',
      runGh: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    } as unknown as FeatureRunnerDeps;

    const outcome = await makeRunFeature(featureDeps)({ slug: FEATURE_SLUG });

    expect(outcome).toMatchObject({ slug: FEATURE_SLUG, status: 'parked' });
    expect(readOutcome).not.toHaveBeenCalled();
    expect(markProcessed).not.toHaveBeenCalled();
    expect(teardownWorktree).not.toHaveBeenCalled();
  });

  it('FR-6: same-process unpark resumes from durable state without rerunning the settled unit', async () => {
    let durablePark = false;
    let settled = false;
    let featureRuns = 0;
    let settledDispatches = 0;
    let idlePolls = 0;
    const item = { slug: FEATURE_SLUG };
    const parkedOutcome = {
      slug: FEATURE_SLUG,
      status: 'parked',
    } as unknown as FeatureOutcome;
    const deps: DaemonDeps = {
      discoverBacklog: async () => [item],
      isParked: async () => durablePark,
      isHalted: async () => false,
      runFeature: async () => {
        featureRuns += 1;
        if (!settled) {
          settledDispatches += 1;
          settled = true;
          durablePark = true;
          return parkedOutcome;
        }
        return { slug: FEATURE_SLUG, status: 'done' };
      },
      sleep: async () => {
        idlePolls += 1;
        durablePark = false;
      },
    };

    const result = await runDaemon(deps, {
      concurrency: 1,
      once: false,
      idlePollMs: 0,
      maxIdlePolls: 3,
    });

    expect(idlePolls).toBeGreaterThanOrEqual(1);
    expect(featureRuns).toBe(2);
    expect(settledDispatches).toBe(1);
    expect(result.processed.map((outcome) => outcome.status)).toEqual(['parked', 'done']);
  });

  it('FR-6: a restarted pool remains parked, then resumes the next unit after durable unpark', async () => {
    let durablePark = false;
    let settled = false;
    let settledDispatches = 0;
    const item = { slug: FEATURE_SLUG };
    const parkedOutcome = {
      slug: FEATURE_SLUG,
      status: 'parked',
    } as unknown as FeatureOutcome;

    const firstRun = await runDaemon(
      {
        discoverBacklog: async () => [item],
        isParked: async () => durablePark,
        runFeature: async () => {
          settledDispatches += 1;
          settled = true;
          durablePark = true;
          return parkedOutcome;
        },
      },
      { concurrency: 1, once: true },
    );

    let resumedRuns = 0;
    const restartedRun = await runDaemon(
      {
        discoverBacklog: async () => [item],
        isParked: async () => durablePark,
        runFeature: async () => {
          resumedRuns += 1;
          expect(settled).toBe(true);
          return { slug: FEATURE_SLUG, status: 'done' };
        },
        sleep: async () => {
          durablePark = false;
        },
      },
      { concurrency: 1, once: false, idlePollMs: 0, maxIdlePolls: 3 },
    );

    expect(firstRun.processed.map((outcome) => outcome.status)).toEqual(['parked']);
    expect(resumedRuns).toBe(1);
    expect(settledDispatches).toBe(1);
    expect(restartedRun.processed.map((outcome) => outcome.status)).toEqual(['done']);
  });

  it('FR-6: resume preserves done/skipped state while failed and stale units remain selectable', async () => {
    const root = await makeRoot('operator-park-state-resume-');
    const statePath = join(root, 'conduct-state.json');
    const state = {
      complexity_tier: 'M',
      track: 'product',
      feature_desc: FEATURE_SLUG,
    } as ConductState;
    const resolvedBeforeBuild: StepName[] = [
      'worktree',
      'memory',
      'explore',
      'complexity',
      'prd',
      'architecture_diagram',
      'architecture_review',
      'stories',
      'conflict_check',
      'plan',
      'coherence_check',
    ];
    for (const step of resolvedBeforeBuild) state[step] = 'done';
    state.acceptance_specs = 'failed';
    state.build = 'stale';
    state.wiring_check = 'skipped';
    await writeState(statePath, state);

    const calls: StepName[] = [];
    const conductor = makeConductor(
      root,
      statePath,
      {
        run: vi.fn(async (step: StepName) => {
          calls.push(step);
          return { success: true };
        }),
      },
      { resume: true },
    );

    await conductor.run();

    expect(calls[0]).toBe('acceptance_specs');
    expect(calls).toContain('build');
    expect(calls).not.toContain('memory');
    expect(calls).not.toContain('wiring_check');
  });

  it('FR-9: an interactive run ignores the same repo-root park marker and preserves its ordinary sequence', async () => {
    const root = await makeRoot('operator-park-interactive-');
    const statePath = join(root, 'conduct-state.json');
    await seedPending(statePath, ['memory', 'explore']);
    await mkdir(join(root, '.daemon', 'parked'), { recursive: true });
    await writeFile(
      join(root, '.daemon', 'parked', FEATURE_SLUG),
      'parked by operator\n',
      'utf-8',
    );
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        calls.push(step);
        return { success: true };
      }),
    };
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      mode: 'default',
      daemon: false,
      verifyArtifacts: false,
      maxRetries: 1,
      ...noExternalIo(),
    });

    const result = await conductor.run();

    expect(calls).toEqual(['memory', 'explore']);
    expect(result).toBeUndefined();
  });
});
