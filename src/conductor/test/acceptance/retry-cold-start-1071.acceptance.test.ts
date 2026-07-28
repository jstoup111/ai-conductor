import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
} from '../../src/execution/llm-provider.js';
import type { ConductState } from '../../src/types/index.js';

describe('ST-1071-5 — cold retry reconstructs context from durable artifacts', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it('completes from committed partial work and RETRY context without prior conversation', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'cold-retry-artifacts-'));
    tempDirs.push(projectDir);
    const pipelineDir = join(projectDir, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });
    await writeFile(join(pipelineDir, 'conduct-session-id'), 'stable-feature-run', 'utf-8');
    const artifactPath = join(projectDir, 'partial-work.txt');
    const firstFailure = 'private first-attempt conversation output';
    const invocations: InvokeOptions[] = [];
    let committed = false;

    const invoke = vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => {
      invocations.push(options);
      if (invocations.length === 1) {
        await writeFile(artifactPath, 'durable partial implementation', 'utf-8');
        committed = true;
        return { success: false, output: firstFailure, exitCode: 1 };
      }

      const artifact = await readFile(artifactPath, 'utf-8');
      const retryHasEnoughContext =
        committed &&
        artifact === 'durable partial implementation' &&
        options.systemPrompt?.includes('RETRY: tests failed after partial implementation') === true &&
        !options.systemPrompt.includes(firstFailure);
      return retryHasEnoughContext
        ? { success: true, output: 'completed from durable state', exitCode: 0 }
        : { success: false, output: 'missing durable retry context', exitCode: 1 };
    });
    const provider: LLMProvider = {
      supportsSessionResume: false,
      invoke,
      invokeInteractive: invoke,
    };
    const runner = new DefaultStepRunner(
      provider,
      'stable-feature-run',
      projectDir,
      { pipelineDir },
    );

    const first = await runner.run('build', {} as ConductState, { attempt: 1 });
    const retry = await runner.run('build', {} as ConductState, {
      attempt: 2,
      retryReason: 'tests failed after partial implementation',
    });

    expect({
      first: first.success,
      retry,
      resumes: invocations.map(({ resume }) => resume),
      distinctProviderSessions: new Set(invocations.map(({ sessionId }) => sessionId)).size,
      runId: await readFile(join(pipelineDir, 'conduct-session-id'), 'utf-8'),
    }).toEqual({
      first: false,
      retry: expect.objectContaining({
        success: true,
        output: 'completed from durable state',
      }),
      resumes: [false, false],
      distinctProviderSessions: 2,
      runId: 'stable-feature-run',
    });
  });
});
