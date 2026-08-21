import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { EventPersister } from '../src/engine/event-persister.js';
import { DefaultStepRunner } from '../src/engine/step-runners.js';
import { ModelAvailability } from '../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY, CODEX_MODEL_POLICY } from '../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../src/engine/provider-session.js';
import type { ProviderExecutionResult } from '../src/engine/provider-execution.js';
import type { InvokeOptions, LLMProvider, ProviderStreamObservation } from '../src/execution/llm-provider.js';
import type { StepName } from '../src/types/index.js';
import { ConductorEventEmitter } from '../src/ui/events.js';

describe('provider stream progress emission', () => {
  it('persists one dispatch observation through the event spine without a parallel telemetry file', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'provider-stream-emission-'));
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(projectDir, '.pipeline', 'events.jsonl'), events);
    persister.start();
    const runner = new DefaultStepRunner({ invoke: vi.fn(), invokeInteractive: vi.fn() }, 'emission-test', projectDir, {
      events,
      configuredProviders: ['claude'],
    });
    const dispatch = (runner as unknown as {
      dispatchProviderWithLifecycleSupervision: (
        step: StepName,
        options: { prompt: string; cwd: string },
        invoke: (options: Pick<InvokeOptions, 'onProviderStream' | 'providerStreamObserverForCandidate'>) => Promise<ProviderExecutionResult>,
      ) => Promise<ProviderExecutionResult>;
    }).dispatchProviderWithLifecycleSupervision.bind(runner);
    try {
      await dispatch('build', { prompt: 'test', cwd: projectDir }, async (options) => {
        const observer = options.providerStreamObserverForCandidate?.('claude');
        observer?.onProviderStream({
          childObservability: 'observed', activeChildren: 2, uncachedInputTokens: 220,
          cachedInputTokens: 80, outputTokens: 40,
        });
        observer?.close();
        return { success: true, output: 'done', exitCode: 0, preferredProvider: 'claude', attempts: [] };
      });

      const records = (await readFile(join(projectDir, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line));
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        type: 'provider_stream_progress', step: 'build', provider: 'claude',
        childObservability: 'observed', activeChildren: 2, uncachedInputTokens: 220,
        cachedInputTokens: 80, outputTokens: 40,
      });
      expect(records[0].ts).toEqual(expect.any(String));
      expect(await readdir(projectDir)).toEqual(['.pipeline']);
      expect(await readdir(join(projectDir, '.pipeline'))).toEqual(['events.jsonl']);
    } finally {
      persister.stop();
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('keeps fallback stream state candidate-scoped and attributes each persisted record to its invoked provider', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'provider-stream-fallback-'));
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(projectDir, '.pipeline', 'events.jsonl'), events);
    persister.start();
    const claude: LLMProvider = {
      supportsSessionResume: false,
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke: async (options) => {
        options.onProviderStream?.({ childObservability: 'observed', activeChildren: 1, uncachedInputTokens: 99, outputTokens: 9 });
        return { success: false, output: 'Claude unavailable', exitCode: 1, providerUnavailable: true, providerUnavailableScope: 'run' };
      },
      invokeInteractive: async () => ({ success: false, output: 'not used', exitCode: 1 }),
    };
    const codex: LLMProvider = {
      supportsSessionResume: false,
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke: async (options) => {
        options.onProviderStream?.({ childObservability: 'unsupported', uncachedInputTokens: 1, outputTokens: 2 });
        return { success: true, output: 'done', exitCode: 0 };
      },
      invokeInteractive: async () => ({ success: false, output: 'not used', exitCode: 1 }),
    };
    const runtimes = new ProviderRuntimeSet([
      { key: 'claude', provider: claude, lifecycleCapability: claude.lifecycleCapability, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) },
      { key: 'codex', provider: codex, lifecycleCapability: codex.lifecycleCapability, policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder) },
    ]);
    const runner = new DefaultStepRunner(claude, 'fallback-test', projectDir, {
      events,
      mode: 'auto',
      config: { llm_provider: ['claude', 'codex'] },
      configuredProviders: ['claude', 'codex'],
      providerRuntimes: runtimes,
      sessionStore: new ProviderSessionStore({ createSessionId: () => 'candidate-session' }),
    });
    try {
      await expect(runner.run('build', { complexity_tier: 'S' })).resolves.toMatchObject({ success: true, output: 'done' });
      const records = (await readFile(join(projectDir, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line));
      expect(records.filter((record) => record.type === 'provider_stream_progress')).toEqual(expect.arrayContaining([
        expect.objectContaining({ provider: 'claude', activeChildren: 1, uncachedInputTokens: 99, outputTokens: 9 }),
        expect.objectContaining({ provider: 'codex', childObservability: 'unsupported', uncachedInputTokens: 1, outputTokens: 2 }),
      ]));
      const fallbackRecords = records.filter((record) => record.type === 'provider_stream_progress' && record.provider === 'codex');
      expect(fallbackRecords).toEqual([expect.objectContaining({ uncachedInputTokens: 1, outputTokens: 2 })]);
      expect(fallbackRecords[0]).not.toHaveProperty('activeChildren');
    } finally {
      persister.stop();
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});
