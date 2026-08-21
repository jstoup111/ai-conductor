import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { EventPersister } from '../src/engine/event-persister.js';
import { DefaultStepRunner } from '../src/engine/step-runners.js';
import type { ProviderExecutionResult } from '../src/engine/provider-execution.js';
import type { ProviderStreamObservation } from '../src/execution/llm-provider.js';
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
        invoke: (options: { onProviderStream?: (observation: ProviderStreamObservation) => void }) => Promise<ProviderExecutionResult>,
      ) => Promise<ProviderExecutionResult>;
    }).dispatchProviderWithLifecycleSupervision.bind(runner);
    try {
      await dispatch('build', { prompt: 'test', cwd: projectDir }, async (options) => {
        options.onProviderStream?.({
          childObservability: 'observed', activeChildren: 2, uncachedInputTokens: 220,
          cachedInputTokens: 80, outputTokens: 40,
        });
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
});
