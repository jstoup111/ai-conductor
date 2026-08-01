/**
 * RED acceptance specs for bounded provider preparation lifecycle (#1141).
 *
 * Stories: .docs/stories/daemon-build-review-can-wedge-before-provider-laun.md
 * ADR: .docs/decisions/adr-2026-07-30-provider-preparation-lifecycle-supervision.md
 * Plan: .docs/plans/daemon-build-review-can-wedge-before-provider-laun.md
 * Track: technical (no PRD / FR coverage).
 *
 * WHY ACCEPTANCE-LEVEL: these scenarios cross the real DefaultStepRunner
 * provider-dispatch boundary, candidate execution, activity watchdog, durable
 * HALT output, and feature-scoped diagnostics. Provider executors and provider
 * adapters are deterministic fakes; no Claude, Codex, network, or host process
 * discovery is used.
 *
 * REAL PRODUCTION CALL SITES:
 *   1. src/engine/step-runners.ts#runProviderAwareNormal
 *   2. src/engine/step-runners.ts#executeProviderAwareOneShotCore
 *   3. src/engine/step-runners.ts#dispatchProviderWithWatchdog
 *   4. src/engine/provider-execution.ts#executeProviderCandidates
 *
 * Existing-overlap check: lower-layer tests already cover heartbeat parsing,
 * stale heartbeats from a different step, provider fallback ordering, config
 * validation for the legacy heartbeat key, and needs-human re-kick retention.
 * These specs do not duplicate those helpers. They prove the missing story
 * flows: shared phase visibility, pre-spawn timeout/replacement, stale-result
 * fencing, persisted exhaustion, quiet-running authority, unsupported-provider
 * failure, and separation from the legacy heartbeat policy.
 *
 * PRE-IMPLEMENTATION RED: the live boundary has only a post-spawn heartbeat
 * watchdog. It emits no preparing/running/recovering lifecycle diagnostics,
 * never replaces a heartbeat-less preparation wedge, still kills a quiet
 * spawned provider after stale activity, and invokes custom providers without
 * a spawn-fencing capability check. Failures are assertion failures against
 * those missing behaviors, not collection, syntax, or infrastructure errors.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelAvailability } from '../../src/engine/model-availability.js';
import { executeProviderCandidates } from '../../src/engine/provider-execution.js';
import type {
  ExecuteProviderCandidatesInput,
  ProviderExecutionResult,
} from '../../src/engine/provider-execution.js';
import { CLAUDE_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { writeStepHeartbeat } from '../../src/engine/step-heartbeat.js';
import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
} from '../../src/execution/llm-provider.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { ConductState, StepName } from '../../src/types/index.js';

const FIVE_MINUTES_MS = 5 * 60_000;
const state: ConductState = { complexity_tier: 'L' };

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

function providerResult(output = 'done'): ProviderExecutionResult {
  return {
    success: true,
    output,
    exitCode: 0,
    preferredProvider: 'claude',
    actualProvider: 'claude',
    attempts: [],
  };
}

function invokeResult(output = 'done'): InvokeResult {
  return { success: true, output, exitCode: 0 };
}

function inertProvider(invoke = vi.fn(async () => invokeResult())): LLMProvider {
  return {
    supportsSessionResume: false,
    invoke,
    invokeInteractive: vi.fn(async () => undefined),
  };
}

function runtime(key: string, provider: LLMProvider, builtIn: boolean) {
  return {
    key,
    provider,
    policy: CLAUDE_MODEL_POLICY,
    builtIn,
    availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
  };
}

interface RunnerFixture {
  runner: DefaultStepRunner;
  sessions: ProviderSessionStore;
  logs: string[];
}

function makeRunner(
  root: string,
  executor: typeof executeProviderCandidates,
  rawConfig: Record<string, unknown> = {},
  heartbeatWatchdog?: { pollIntervalMs?: number; now?: () => number },
): RunnerFixture {
  const logs: string[] = [];
  const provider = inertProvider();
  const sessions = new ProviderSessionStore({
    createSessionId: () => `session-${crypto.randomUUID()}`,
  });
  const config = {
    llm_provider: ['claude'],
    ...rawConfig,
  } as unknown as HarnessConfig;
  const runner = new DefaultStepRunner(provider, 'acceptance-session', root, {
    mode: 'auto',
    config,
    log: (message) => logs.push(message),
    heartbeatWatchdog,
    providerExecution: {
      configuredProviders: ['claude'],
      runtimes: new ProviderRuntimeSet([runtime('claude', provider, true)]),
      sessions,
      executor,
      diagnosticLog: (message) => logs.push(message),
    },
  });
  return { runner, sessions, logs };
}

async function runStep(
  fixture: RunnerFixture,
  step: StepName,
): Promise<Awaited<ReturnType<DefaultStepRunner['run']>>> {
  await fixture.sessions.beginStep(step);
  return fixture.runner.run(step, state);
}

async function flushDispatch(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function lifecycleLine(logs: readonly string[], step: StepName, phase: string): string | undefined {
  return logs.find((line) =>
    line.includes(step) && new RegExp(`\\b${phase}\\b`, 'i').test(line),
  );
}

function attemptIdentity(line: string): string | undefined {
  return /attempt(?:_id)?[=:\s]+([a-z0-9_-]+)/i.exec(line)?.[1];
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'provider-preparation-lifecycle-'));
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('TI-1: every daemon provider step exposes one authoritative lifecycle', () => {
  it.each<StepName>(['plan', 'acceptance_specs', 'manual_test'])(
    '%s crosses preparing -> running with one attempt identity',
    async (step) => {
      const executor = vi.fn(async (input: ExecuteProviderCandidatesInput) => {
        input.options.onSpawn?.({ kill: () => undefined });
        return providerResult(step);
      });
      const fixture = makeRunner(root, executor);

      expect((await runStep(fixture, step)).success).toBe(true);

      const preparing = lifecycleLine(fixture.logs, step, 'preparing');
      const running = lifecycleLine(fixture.logs, step, 'running');
      expect(preparing).toBeDefined();
      expect(running).toBeDefined();
      expect(attemptIdentity(preparing ?? '')).toBeDefined();
      expect(attemptIdentity(running ?? '')).toBe(attemptIdentity(preparing ?? ''));
    },
  );

  it('does not label a not-yet-spawned attempt running from an older same-step heartbeat', async () => {
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(
      join(root, '.pipeline', 'step-heartbeat'),
      JSON.stringify({ step: 'build', ts: new Date(Date.now() - 60_000).toISOString() }),
    );
    const pending = deferred<ProviderExecutionResult>();
    const executor = vi.fn(() => pending.promise);
    const fixture = makeRunner(root, executor, {
      step_heartbeat_stall_minutes: 0,
      provider_preparation_timeout_minutes: 5,
    });

    const run = runStep(fixture, 'build');
    await flushDispatch();
    const beforeSpawn = [...fixture.logs];
    pending.resolve(providerResult());
    await run;

    expect(lifecycleLine(beforeSpawn, 'build', 'preparing')).toBeDefined();
    expect(lifecycleLine(beforeSpawn, 'build', 'running')).toBeUndefined();
  });
});

describe('TI-2: a pre-spawn wedge has one bounded replacement', () => {
  it('revokes the timed-out attempt, accepts one replacement, and ignores the stale late result', async () => {
    vi.useFakeTimers();
    const first = deferred<ProviderExecutionResult>();
    let calls = 0;
    const executor = vi.fn(() => {
      calls += 1;
      return calls === 1
        ? first.promise
        : Promise.resolve(providerResult('replacement-result'));
    });
    const fixture = makeRunner(root, executor as typeof executeProviderCandidates, {
      step_heartbeat_stall_minutes: 0,
      provider_preparation_timeout_minutes: 5,
    });

    const run = runStep(fixture, 'build');
    await flushDispatch();
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES_MS + 1);
    first.resolve(providerResult('superseded-result'));
    const result = await run;

    expect(executor).toHaveBeenCalledTimes(2);
    expect(result.output).toContain('replacement-result');
    expect(result.output).not.toContain('superseded-result');
    expect(lifecycleLine(fixture.logs, 'build', 'recovering')).toMatch(/timeout/i);
  });

  it('lets spawn authorization win the deadline race without launching a replacement', async () => {
    vi.useFakeTimers();
    const running = deferred<ProviderExecutionResult>();
    const executor = vi.fn((input: ExecuteProviderCandidatesInput) => {
      input.options.onSpawn?.({ kill: () => undefined });
      return running.promise;
    });
    const fixture = makeRunner(root, executor as typeof executeProviderCandidates, {
      step_heartbeat_stall_minutes: 0,
      provider_preparation_timeout_minutes: 5,
    });

    const run = runStep(fixture, 'build');
    await flushDispatch();
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES_MS * 2);
    running.resolve(providerResult('quiet-success'));
    const result = await run;

    expect(result.success).toBe(true);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(lifecycleLine(fixture.logs, 'build', 'running')).toBeDefined();
    expect(lifecycleLine(fixture.logs, 'build', 'recovering')).toBeUndefined();
  });

  it('keeps provider/model fallback candidates inside one lifecycle attempt', async () => {
    const executor = vi.fn(async () => ({
      ...providerResult('fallback-success'),
      preferredProvider: 'claude',
      actualProvider: 'codex',
      attempts: [
        { provider: 'claude', outcome: 'unavailable' as const, invoked: true },
        { provider: 'codex', outcome: 'success' as const, invoked: true },
      ],
    }));
    const fixture = makeRunner(root, executor, {
      step_heartbeat_stall_minutes: 0,
      provider_preparation_timeout_minutes: 5,
    });

    expect((await runStep(fixture, 'build')).success).toBe(true);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(lifecycleLine(fixture.logs, 'build', 'recovering')).toBeUndefined();
  });
});

describe('TI-3: repeated preparation failure halts durably', () => {
  it('persists one recovery and turns the second timeout into a needs-human HALT', async () => {
    vi.useFakeTimers();
    const attempts: Array<Deferred<ProviderExecutionResult>> = [];
    const executor = vi.fn(() => {
      const attempt = deferred<ProviderExecutionResult>();
      attempts.push(attempt);
      return attempt.promise;
    });
    const fixture = makeRunner(root, executor as typeof executeProviderCandidates, {
      step_heartbeat_stall_minutes: 0,
      provider_preparation_timeout_minutes: 5,
    });
    let settled = false;
    const run = runStep(fixture, 'build').then((result) => {
      settled = true;
      return result;
    });

    await flushDispatch();
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES_MS * 2 + 2);
    const settledBeforeCleanup = settled;
    for (const attempt of attempts) attempt.resolve(providerResult('late-result'));
    const result = await run;
    const halt = await readFile(join(root, '.pipeline', 'HALT'), 'utf8').catch(() => '');
    const haltClass = await readFile(join(root, '.pipeline', 'HALT.class'), 'utf8').catch(() => '');

    expect(settledBeforeCleanup).toBe(true);
    expect(result.success).toBe(false);
    expect(haltClass.trim()).toBe('needs-human');
    expect(halt).toMatch(/build/i);
    expect(halt).toMatch(/preparing/i);
    expect(halt).toMatch(/attempt/i);
    expect(halt).toMatch(/elapsed/i);
    expect(halt).toMatch(/recovery(?: count)?[=: ]+1/i);
  });
});

describe('TI-4: provider activity is telemetry, never post-spawn authority', () => {
  it.each([undefined, 0, -1, 1])(
    'a spawned quiet provider succeeds with step_heartbeat_stall_minutes=%s',
    async (heartbeatMinutes) => {
      vi.useFakeTimers();
      const completion = deferred<ProviderExecutionResult>();
      const started = deferred<void>();
      let killCalls = 0;
      const base = Date.now();
      let now = base;
      const executor = vi.fn(async (input: ExecuteProviderCandidatesInput) => {
        await writeStepHeartbeat(root, 'build');
        input.options.onSpawn?.({ kill: () => { killCalls += 1; } });
        started.resolve();
        return completion.promise;
      });
      const rawConfig: Record<string, unknown> = {
        provider_preparation_timeout_minutes: 5,
      };
      if (heartbeatMinutes !== undefined) {
        rawConfig.step_heartbeat_stall_minutes = heartbeatMinutes;
      }
      const fixture = makeRunner(
        root,
        executor as typeof executeProviderCandidates,
        rawConfig,
        { pollIntervalMs: 5, now: () => now },
      );

      const run = runStep(fixture, 'build');
      await started.promise;
      now = base + 60 * 60_000;
      await vi.advanceTimersByTimeAsync(20);
      completion.resolve(providerResult('quiet-provider-finished'));
      const result = await run;

      expect(result.success).toBe(true);
      expect(result.output).toContain('quiet-provider-finished');
      expect(killCalls).toBe(0);
      expect(lifecycleLine(fixture.logs, 'build', 'running')).toBeDefined();
    },
  );
});

describe('TI-5: lifecycle capability fails closed before provider invocation', () => {
  it('rejects an unsupported custom provider with a recovery action and creates no worker', async () => {
    const invoke = vi.fn(async () => invokeResult('must-not-run'));
    const custom = inertProvider(invoke);
    const sessions = new ProviderSessionStore({ createSessionId: () => 'custom-session' });
    await sessions.beginStep('build');

    const result = await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['custom-unfenced'],
      runtimes: new ProviderRuntimeSet([
        runtime('custom-unfenced', custom, false),
      ]),
      sessions,
      config: { llm_provider: 'custom-unfenced' },
      options: {
        prompt: 'bounded fixture',
        cwd: root,
      } as Omit<InvokeOptions, 'sessionId' | 'resume' | 'model' | 'effort'>,
    });

    expect(result.success).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    expect(result.output).toMatch(/custom-unfenced/i);
    expect(result.output).toMatch(/lifecycle|spawn.*(?:permit|fenc)/i);
    expect(result.output).toMatch(/recover|upgrade|install|configure/i);
  });
});

describe('TI-6: preparation timeout is independent from heartbeat policy', () => {
  it('uses the five-minute preparation default when legacy config contains only heartbeat policy', async () => {
    vi.useFakeTimers();
    const first = deferred<ProviderExecutionResult>();
    let calls = 0;
    const executor = vi.fn(() => {
      calls += 1;
      return calls === 1 ? first.promise : Promise.resolve(providerResult('replacement'));
    });
    const fixture = makeRunner(root, executor as typeof executeProviderCandidates, {
      step_heartbeat_stall_minutes: 30,
    });

    const run = runStep(fixture, 'build');
    await flushDispatch();
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES_MS + 1);
    first.resolve(providerResult('late-legacy-attempt'));
    const result = await run;

    expect(executor).toHaveBeenCalledTimes(2);
    expect(result.output).toContain('replacement');
    expect(result.output).not.toContain('late-legacy-attempt');
  });

  it('applies an explicit preparation override only to the pre-spawn phase', async () => {
    vi.useFakeTimers();
    const first = deferred<ProviderExecutionResult>();
    let calls = 0;
    const executor = vi.fn(() => {
      calls += 1;
      return calls === 1 ? first.promise : Promise.resolve(providerResult('seven-minute-replacement'));
    });
    const fixture = makeRunner(root, executor as typeof executeProviderCandidates, {
      step_heartbeat_stall_minutes: 0,
      provider_preparation_timeout_minutes: 7,
    });

    const run = runStep(fixture, 'build');
    await flushDispatch();
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(executor).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_001);
    first.resolve(providerResult('late-seven-minute-attempt'));
    const result = await run;

    expect(executor).toHaveBeenCalledTimes(2);
    expect(result.output).toContain('seven-minute-replacement');
  });
});
