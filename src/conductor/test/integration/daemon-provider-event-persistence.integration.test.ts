import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Conductor } from '../../src/engine/conductor.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
} from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import * as eventPersisterModule from '../../src/engine/event-persister.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { InvokeOptions, LLMProvider } from '../../src/execution/llm-provider.js';
import type {
  ConductorEvent,
  ConductState,
  StepName,
} from '../../src/types/index.js';

type WithFeatureEventPersistence = <T>(input: {
  worktreePath: string;
  globalEvents: ConductorEventEmitter;
  run: (featureEvents: ConductorEventEmitter) => Promise<T>;
}) => Promise<T>;

async function readRelevantEvents(worktreePath: string): Promise<ConductorEvent[]> {
  const raw = await readFile(
    join(worktreePath, '.pipeline', 'events.jsonl'),
    'utf-8',
  ).catch(() => '');
  if (!raw) return [];
  return raw
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as ConductorEvent)
    .filter((event) =>
      ['provider_attempt', 'provider_fallback', 'step_completed'].includes(
        event.type,
      ),
    );
}

describe('daemon feature provider-event persistence', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it('persists a real fallback lifecycle only in its owning feature ledger while forwarding globally', async () => {
    const featureA = await mkdtemp(join(tmpdir(), 'daemon-events-a-'));
    const featureB = await mkdtemp(join(tmpdir(), 'daemon-events-b-'));
    roots.push(featureA, featureB);
    const globalEvents = new ConductorEventEmitter();
    const globallyObserved: ConductorEvent[] = [];
    for (const type of [
      'provider_attempt',
      'provider_fallback',
      'step_completed',
    ] as const) {
      globalEvents.on(type, (event) => {
        globallyObserved.push(event);
      });
    }

    const withFeatureEventPersistence = (
      eventPersisterModule as typeof eventPersisterModule & {
        withFeatureEventPersistence?: WithFeatureEventPersistence;
      }
    ).withFeatureEventPersistence;

    let overlapCount = 0;
    let releaseOverlap!: () => void;
    const bothScopesActive = new Promise<void>((resolve) => {
      releaseOverlap = resolve;
    });
    const enterOverlap = async (): Promise<void> => {
      overlapCount += 1;
      if (overlapCount === 2) releaseOverlap();
      await bothScopesActive;
    };
    let featureAEvents: ConductorEventEmitter | undefined;
    let featureBEvents: ConductorEventEmitter | undefined;
    const codexIntervals = [{ startedAtMs: 1_000, durationMs: 20 }];
    const claudeIntervals = [{ startedAtMs: 2_000, durationMs: 30 }];

    const runA = withFeatureEventPersistence?.({
      worktreePath: featureA,
      globalEvents,
      run: async (featureEvents) => {
        featureAEvents = featureEvents;
        await enterOverlap();
        const provider = (key: 'codex' | 'claude'): LLMProvider => {
          const invoke = vi.fn(async (options: InvokeOptions) => {
            const permit = options.spawnPermit?.();
            if (permit && !permit.permitted) {
              return {
                success: false,
                output: `test provider spawn denied: ${permit.reason}`,
                exitCode: 1,
              };
            }
            return key === 'codex'
              ? {
                  success: false,
                  output: 'codex executable not found',
                  exitCode: 127,
                  providerUnavailable: true,
                  providerUnavailableReason: 'codex executable not found',
                  providerUnavailableScope: 'run' as const,
                  observedIntervals: codexIntervals,
                }
              : {
                  success: true,
                  output: 'completed by claude',
                  exitCode: 0,
                  tokenUsage: { input: 120, output: 30 },
                  observedIntervals: claudeIntervals,
                };
          });
          return {
            lifecycleCapability: { synchronousSpawnPermit: true },
            invoke,
            invokeInteractive: invoke,
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
            attempt: Omit<
              Extract<ConductorEvent, { type: 'provider_attempt' }>,
              'type' | 'step'
            >,
          ) =>
            featureEvents.emit({ type: 'provider_attempt', step, ...attempt }),
          warn: (
            _message: string,
            transition: Extract<
              ConductorEvent,
              { type: 'provider_fallback' | 'session_policy' }
            >,
          ) => featureEvents.emit(transition),
        };
        const statePath = join(featureA, '.pipeline', 'conduct-state.json');
        const state: ConductState = {
          complexity_tier: 'L',
          track: 'technical',
          feature_desc: 'feature-a',
        };
        for (const step of ALL_STEPS) {
          if (step.name !== 'plan') {
            (state as Record<string, unknown>)[step.name] = 'done';
          }
        }
        state.prd = 'skipped';
        await writeState(statePath, state);
        const runner = new DefaultStepRunner(
          runtimes.get('codex').provider,
          'legacy-session',
          featureA,
          {
            config: providerExecution.config,
            modelPolicy: CODEX_MODEL_POLICY,
            mode: 'auto',
            providerExecution,
          },
        );
        const conductor = new Conductor({
          stateFilePath: statePath,
          stepRunner: runner,
          events: featureEvents,
          projectRoot: featureA,
          fromStep: 'plan',
          mode: 'auto',
          config: providerExecution.config,
          modelPolicy: CODEX_MODEL_POLICY,
          providerExecution,
        });
        await conductor.run();
      },
    });

    const runB = withFeatureEventPersistence?.({
      worktreePath: featureB,
      globalEvents,
      run: async (featureEvents) => {
        featureBEvents = featureEvents;
        await enterOverlap();
        await featureEvents.emit({
          type: 'step_completed',
          step: 'build',
          status: 'done',
          preferredProvider: 'claude',
          actualProvider: 'claude',
        });
        throw new Error('feature-b dispatch failed');
      },
    });
    const outcomes = await Promise.allSettled([runA, runB]);

    await featureAEvents?.emit({
      type: 'step_completed',
      step: 'retro',
      status: 'done',
    });
    await featureBEvents?.emit({
      type: 'step_completed',
      step: 'manual_test',
      status: 'done',
    });
    await globalEvents.emit({
      type: 'step_completed',
      step: 'finish',
      status: 'done',
    });

    expect({
      helperDefined: withFeatureEventPersistence !== undefined,
      emittersAreFeatureLocal:
        featureAEvents !== undefined &&
        featureBEvents !== undefined &&
        featureAEvents !== globalEvents &&
        featureBEvents !== globalEvents &&
        featureAEvents !== featureBEvents,
      outcomes: outcomes.map((outcome) =>
        outcome.status === 'fulfilled'
          ? outcome.status
          : `${outcome.status}:${String(outcome.reason)}`,
      ),
      featureA: await readRelevantEvents(featureA),
      featureB: await readRelevantEvents(featureB),
      globalPlan: globallyObserved
        .filter((event) => 'step' in event && event.step === 'plan')
        .map((event) => {
          if (event.type === 'provider_attempt') {
            return {
              type: event.type,
              provider: event.provider,
              outcome: event.outcome,
            };
          }
          if (event.type === 'provider_fallback') {
            return {
              type: event.type,
              failedProvider: event.failedProvider,
              nextProvider: event.nextProvider,
            };
          }
          return event.type === 'step_completed'
            ? {
                type: event.type,
                preferredProvider: event.preferredProvider,
                actualProvider: event.actualProvider,
              }
            : { type: event.type };
        }),
      globalOther: globallyObserved
        .filter((event) => 'step' in event && event.step !== 'plan')
        .map((event) => ({
          type: event.type,
          step: 'step' in event ? event.step : undefined,
        }))
        .sort((left, right) => String(left.step).localeCompare(String(right.step))),
    }).toMatchObject({
      helperDefined: true,
      emittersAreFeatureLocal: true,
      outcomes: ['fulfilled', 'rejected:Error: feature-b dispatch failed'],
      featureA: [
        {
          type: 'provider_attempt',
          step: 'plan',
          provider: 'provider-lifecycle',
          outcome: 'success',
          lifecycle: {
            phase: 'preparing',
            attemptId: 'legacy-session:plan:1',
            recoveryCount: 0,
          },
        },
        {
          type: 'provider_attempt',
          step: 'plan',
          provider: 'provider-lifecycle',
          outcome: 'success',
          lifecycle: {
            phase: 'running',
            attemptId: 'legacy-session:plan:1',
            recoveryCount: 0,
          },
        },
        {
          type: 'provider_attempt',
          step: 'plan',
          provider: 'codex',
          outcome: 'unavailable',
          observedIntervals: codexIntervals,
        },
        {
          type: 'provider_fallback',
          step: 'plan',
          failedProvider: 'codex',
          nextProvider: 'claude',
        },
        {
          type: 'provider_attempt',
          step: 'plan',
          provider: 'claude',
          outcome: 'success',
          observedIntervals: claudeIntervals,
        },
        {
          type: 'provider_attempt',
          step: 'plan',
          provider: 'provider-lifecycle',
          outcome: 'success',
          lifecycle: {
            phase: 'settled',
            attemptId: 'legacy-session:plan:1',
            recoveryCount: 0,
            outcome: 'completed',
          },
        },
        {
          type: 'step_completed',
          step: 'plan',
          preferredProvider: 'codex',
          actualProvider: 'claude',
          observedIntervals: [...codexIntervals, ...claudeIntervals],
        },
      ],
      featureB: [
        {
          type: 'step_completed',
          step: 'build',
          preferredProvider: 'claude',
          actualProvider: 'claude',
        },
      ],
      globalPlan: [
        {
          type: 'provider_attempt',
          provider: 'provider-lifecycle',
          outcome: 'success',
        },
        {
          type: 'provider_attempt',
          provider: 'provider-lifecycle',
          outcome: 'success',
        },
        {
          type: 'provider_attempt',
          provider: 'codex',
          outcome: 'unavailable',
        },
        {
          type: 'provider_fallback',
          failedProvider: 'codex',
          nextProvider: 'claude',
        },
        {
          type: 'provider_attempt',
          provider: 'claude',
          outcome: 'success',
        },
        {
          type: 'provider_attempt',
          provider: 'provider-lifecycle',
          outcome: 'success',
        },
        {
          type: 'step_completed',
          preferredProvider: 'codex',
          actualProvider: 'claude',
        },
      ],
      globalOther: [
        { type: 'step_completed', step: 'build' },
        { type: 'step_completed', step: 'finish' },
        { type: 'step_completed', step: 'manual_test' },
        { type: 'step_completed', step: 'retro' },
      ],
    });
  });

  it('wires the feature-local persistence scope through the real daemon composition root', async () => {
    const daemonSource = await readFile(
      fileURLToPath(new URL('../../src/daemon-cli.ts', import.meta.url)),
      'utf-8',
    );
    const depsSource = await readFile(
      fileURLToPath(new URL('../../src/engine/daemon-deps.ts', import.meta.url)),
      'utf-8',
    );

    expect({
      importsScopeFactory: daemonSource.includes(
        'startFeatureEventPersistence',
      ),
      createsFeatureScope: daemonSource.includes('const beginFeatureRun'),
      bindsProviderSinksToFeatureBus:
        daemonSource.includes('createProviderExecution(featureEvents, featureLog)'),
      passesScopeIntoRunnerDeps: daemonSource.includes('beginFeatureRun,'),
      runConductorAcceptsFeatureBus:
        /const runConductorInWorktree = async \([\s\S]*?featureEvents: ConductorEventEmitter/.test(
          daemonSource,
        ),
      conductorUsesFeatureBus:
        /events:\s*featureEvents/.test(daemonSource),
      auditUsesFeatureBus:
        /auditWriter\.subscribe\(featureEvents\)/.test(daemonSource),
      rebaseUsesFeatureBus:
        /resumeRebaseFirst\(\{[\s\S]*?events:\s*featureEvents/.test(
          daemonSource,
        ),
      depsForwardsScope:
        /beginFeatureRun:\s*cfg\.beginFeatureRun/.test(depsSource),
      depsForwardsFeatureBus:
        /runConductor:\s*\(\s*wt,\s*item,\s*providerExecution,\s*featureEvents,\s*log\s*\)\s*=>\s*cfg\.runConductorInWorktree\(\s*wt,\s*item,\s*providerExecution,\s*featureEvents,\s*log\s*\)/.test(
          depsSource,
        ),
    }).toEqual({
      importsScopeFactory: true,
      createsFeatureScope: true,
      bindsProviderSinksToFeatureBus: true,
      passesScopeIntoRunnerDeps: true,
      runConductorAcceptsFeatureBus: true,
      conductorUsesFeatureBus: true,
      auditUsesFeatureBus: true,
      rebaseUsesFeatureBus: true,
      depsForwardsScope: true,
      depsForwardsFeatureBus: true,
    });
  });
});
