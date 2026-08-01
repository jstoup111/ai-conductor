import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import type { ProviderLifecycleTimer } from '../../src/engine/provider-lifecycle.js';
import {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
} from '../../src/engine/provider-model-policy.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { withFeatureEventPersistence } from '../../src/engine/event-persister.js';
import type { ConductorEvent } from '../../src/types/events.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const FIVE_MINUTES_MS = 5 * 60_000;

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((resolvePromise) => {
      resolve = resolvePromise;
    }),
    resolve,
  };
}

function createLifecycleClock(): ProviderLifecycleTimer & {
  advance(milliseconds: number): void;
} {
  let now = 0;
  const timers = new Map<object, { at: number; callback: () => void }>();
  return {
    now: () => now,
    schedule: (callback, delayMilliseconds) => {
      const handle = {};
      timers.set(handle, { at: now + delayMilliseconds, callback });
      return handle;
    },
    cancel: (handle) => {
      timers.delete(handle as object);
    },
    advance: (milliseconds) => {
      now += milliseconds;
      for (const [handle, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(handle);
          timer.callback();
        }
      }
    },
  };
}

async function flushDispatch(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function readyCodexDoctorResult() {
  return {
    stdout: JSON.stringify({
      schemaVersion: 1,
      auth: { selectedMode: 'cached-login', configured: true },
      transport: { authenticated: true },
    }),
    exitCode: 0,
  };
}

async function readLifecycleEvents(
  root: string,
): Promise<Extract<ConductorEvent, { type: 'provider_attempt' }>[]> {
  const raw = await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8');
  return raw
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as ConductorEvent)
    .filter(
      (event): event is Extract<ConductorEvent, { type: 'provider_attempt' }> =>
        event.type === 'provider_attempt' && event.lifecycle !== undefined,
    );
}

describe('provider lifecycle supervision at the real provider boundary', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it('replaces a five-minute preparation wedge while rejecting its late Codex spawn and allowing quiet fallback completion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'provider-lifecycle-supervision-'));
    roots.push(root);
    const clock = createLifecycleClock();
    const firstDoctorStarted = deferred<void>();
    const firstDoctor = deferred<ReturnType<typeof readyCodexDoctorResult>>();
    const quietClaudeCompletion = deferred<{ stdout: string; exitCode: number }>();
    const claudeStarted = deferred<void>();
    let doctorCalls = 0;

    const codexDoctor = vi.fn(async () => {
      doctorCalls += 1;
      if (doctorCalls === 1) {
        firstDoctorStarted.resolve();
        return firstDoctor.promise;
      }
      return readyCodexDoctorResult();
    });
    const codexProcessFactory = vi.fn(() =>
      Promise.resolve({ stdout: 'codex unavailable', exitCode: 127 }) as any,
    );
    const claudeProcessFactory = vi.fn(() => {
      claudeStarted.resolve();
      return quietClaudeCompletion.promise as any;
    });
    const codex = new CodexProvider(codexDoctor, 'codex', undefined, codexProcessFactory);
    const claude = new ClaudeProvider(undefined, claudeProcessFactory);
    const sessions = new ProviderSessionStore({
      createSessionId: () => 'provider-lifecycle-session',
    });
    await sessions.beginStep('build');
    const runtimes = new ProviderRuntimeSet([
      {
        key: 'codex',
        provider: codex,
        lifecycleCapability: codex.lifecycleCapability,
        policy: CODEX_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
      },
      {
        key: 'claude',
        provider: claude,
        lifecycleCapability: claude.lifecycleCapability,
        policy: CLAUDE_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
      },
    ]);
    const globalEvents = new ConductorEventEmitter();

    const run = withFeatureEventPersistence({
      worktreePath: root,
      globalEvents,
      run: async (events) => {
        const runner = new DefaultStepRunner(codex, 'legacy-session', root, {
          mode: 'auto',
          config: {
            llm_provider: ['codex', 'claude'],
            // This legacy heartbeat policy must not become preparation authority.
            step_heartbeat_stall_minutes: 30,
          },
          providerExecution: {
            configuredProviders: ['codex', 'claude'],
            runtimes,
            sessions,
            onAttempt: (step, attempt) =>
              events.emit({ type: 'provider_attempt', step, ...attempt }),
          },
          // This test injects its lifecycle clock through DefaultStepRunner;
          // production defaults to systemProviderLifecycleTimer.
          providerLifecycleTimer: clock,
        });
        return runner.run('build', { complexity_tier: 'L' });
      },
    });

    await firstDoctorStarted.promise;
    clock.advance(FIVE_MINUTES_MS);
    await flushDispatch();
    // The timed-out doctor may finish late, but its second spawn-permit check
    // must deny the old attempt before its injected process factory is reached.
    firstDoctor.resolve(readyCodexDoctorResult());
    await claudeStarted.promise;
    clock.advance(60 * 60_000);
    quietClaudeCompletion.resolve({
      stdout: 'quiet-running-success',
      exitCode: 0,
    });

    const result = await run;
    const lifecycle = await readLifecycleEvents(root);

    expect({
      result: { success: result.success, output: result.output },
      lifecycle: lifecycle.map((event) => ({
        phase: event.lifecycle?.phase,
        recoveryCount: event.lifecycle?.recoveryCount,
      })),
      doctorCalls,
      codexProcessStarts: codexProcessFactory.mock.calls.length,
      claudeProcessStarts: claudeProcessFactory.mock.calls.length,
    }).toEqual({
      result: { success: true, output: 'quiet-running-success' },
      lifecycle: [
        { phase: 'preparing', recoveryCount: 0 },
        { phase: 'recovering', recoveryCount: 1 },
        { phase: 'preparing', recoveryCount: 1 },
        { phase: 'running', recoveryCount: 1 },
        { phase: 'settled', recoveryCount: 1 },
      ],
      doctorCalls: 2,
      codexProcessStarts: 1,
      claudeProcessStarts: 1,
    });
  });
});
