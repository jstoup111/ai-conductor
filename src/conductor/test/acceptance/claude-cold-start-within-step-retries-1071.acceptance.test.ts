/**
 * Acceptance coverage for #1071's durable run-identity boundary. Direct
 * provider argv, session-scope, candidate-gate, group-core, and scalar-runner
 * behavior belongs to their narrow unit suites.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import {
  ProviderRuntimeSet,
  type ProviderRuntime,
} from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
} from '../../src/execution/llm-provider.js';
import type { ConductState, HarnessConfig } from '../../src/types/index.js';

const ok = (output: string): InvokeResult => ({
  success: true,
  output,
  exitCode: 0,
});

function countingMint(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function claudeRuntimes(provider: LLMProvider): ProviderRuntimeSet {
  const runtime: ProviderRuntime = {
    key: 'claude',
    provider,
    policy: CLAUDE_MODEL_POLICY,
    builtIn: true,
    availability: new ModelAvailability(
      CLAUDE_MODEL_POLICY.modelFallbackLadder,
    ),
  };
  return new ProviderRuntimeSet([runtime]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ST-1071 cross-component cold-start contracts', () => {
  it('keeps the durable conduct run id stable while provider session ids churn', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cold-start-runid-'));
    const pipelineDir = join(dir, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });
    await writeFile(
      join(pipelineDir, 'conduct-session-id'),
      'feature-run-identity',
      'utf-8',
    );

    try {
      const invocations: InvokeOptions[] = [];
      const provider: LLMProvider = {
        supportsSessionResume: false,
        lifecycleCapability: { synchronousSpawnPermit: true },
        invoke: vi.fn(async (options: InvokeOptions) => {
          const permit = options.spawnPermit?.();
          if (permit && !permit.permitted) {
            return { success: false, output: `test provider spawn denied: ${permit.reason}`, exitCode: 1 };
          }
          invocations.push(options);
          return ok('attempt completed');
        }),
        invokeInteractive: vi.fn(),
      };
      const runner = new DefaultStepRunner(
        provider,
        'feature-run-identity',
        dir,
        {
          pipelineDir,
          mode: 'auto',
          config: {
            llm_provider: 'claude',
            steps: { memory: { llm_provider: 'claude' } },
          } as HarnessConfig,
          sessionStore: new ProviderSessionStore({
            createSessionId: countingMint('provider-session'),
          }),
          providerRuntimes: claudeRuntimes(provider),
          configuredProviders: ['claude'],
        } as never,
      );

      const observedRunIds: string[] = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await runner.resetSession('memory');
        await runner.run('memory', {} as ConductState);
        observedRunIds.push(
          await readFile(join(pipelineDir, 'conduct-session-id'), 'utf-8'),
        );
      }

      expect({
        runIds: [...new Set(observedRunIds)],
        providerIds: invocations.map(({ sessionId }) => sessionId),
        resumeFlags: invocations.map(({ resume }) => resume),
      }).toEqual({
        runIds: ['feature-run-identity'],
        providerIds: [
          'provider-session-1',
          'provider-session-2',
          'provider-session-3',
        ],
        resumeFlags: [false, false, false],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
