/**
 * Acceptance coverage for the two #1071 outcomes that cross multiple internal
 * components. Direct provider argv, session-scope, candidate-gate, group-core,
 * and scalar-runner behavior belongs to their narrow unit suites.
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
import {
  makeSkippedOutcome,
  runGroupBranch,
} from '../../src/engine/group-core.js';
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

const fail = (output: string): InvokeResult => ({
  success: false,
  output,
  exitCode: 1,
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
  it('cold-starts a concurrent-group retry through the real provider-aware step runner', async () => {
    const observed: Array<{ sessionId: string; resume: boolean }> = [];
    let call = 0;
    const provider: LLMProvider = {
      supportsSessionResume: false,
      invoke: vi.fn(),
      invokeInteractive: vi.fn(async (options: InvokeOptions) => {
        observed.push({ sessionId: options.sessionId, resume: options.resume });
        call += 1;
        return call === 1 ? fail('first branch attempt failed') : ok('passed');
      }),
    };
    const runner = new DefaultStepRunner(
      provider,
      'run-identity',
      '/tmp/project',
      {
        mode: 'interactive',
        config: {
          llm_provider: 'claude',
          steps: { manual_test: { llm_provider: 'claude' } },
        } as HarnessConfig,
        sessionStore: new ProviderSessionStore({
          createSessionId: countingMint('group-provider'),
        }),
        providerRuntimes: claudeRuntimes(provider),
        configuredProviders: ['claude'],
      } as never,
    );

    await runGroupBranch(
      {
        name: 'manual_test',
        skill: 'manual-test',
        outcome: makeSkippedOutcome(),
      },
      {} as ConductState,
      { stepRunner: runner },
      2,
    );

    expect(observed).toEqual([
      { sessionId: 'group-provider-1', resume: false },
      { sessionId: 'group-provider-2', resume: false },
    ]);
  });

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
        invoke: vi.fn(async (options: InvokeOptions) => {
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
