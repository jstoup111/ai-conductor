// Covers: task:8
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InvokeOptions, InvokeResult, LLMProvider } from '../../src/execution/llm-provider.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { DONE_WHEN_CITATION_JUDGEMENT_SCHEMA, type CitationJudgementInput } from '../../src/engine/done-when-citation-judgement.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';

const input: CitationJudgementInput = {
  citations: [{
    taskId: '7', checkIndex: 1, check: 'A cited test proves the behavior.',
    path: 'test/citation.test.ts', title: 'proves the behavior',
    taskText: '### Task 7: prove the behavior', citedFileContent: "it('proves the behavior', () => {});",
  }],
};

const valid = {
  verdicts: [{ taskId: '7', checkIndex: 1, verdict: 'asserts', reason: 'The assertion covers the check.' }],
};

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function subject(results: readonly InvokeResult[], native = true) {
  const invoke = vi.fn(async (_options: InvokeOptions) => results[invoke.mock.calls.length - 1]!);
  const provider = { name: 'claude', invoke } as unknown as LLMProvider;
  const runtimes = new ProviderRuntimeSet([{
    key: 'claude', provider, lifecycleCapability: { synchronousSpawnPermit: true },
    ...(native ? { nativeSchemaCapability: { nativeOutputSchema: true as const } } : {}),
    policy: CLAUDE_MODEL_POLICY, builtIn: true,
    availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
  }]);
  const projectDir = await mkdtemp(join(tmpdir(), 'citation-judgement-'));
  dirs.push(projectDir);
  return {
    invoke,
    runner: new DefaultStepRunner({ name: 'claude', invoke: vi.fn() } as unknown as LLMProvider, 'citation-judgement', projectDir, {
      config: { llm_provider: 'claude' }, configuredProviders: ['claude'], providerRuntimes: runtimes,
      sessionStore: new ProviderSessionStore(),
    }),
  };
}

describe('DefaultStepRunner.dispatchDoneWhenCitationJudgement', () => {
  it('dispatches one read-only, non-interactive native-schema judgement and returns validated verdicts', async () => {
    const { runner, invoke } = await subject([{ success: true, output: 'done', finalStructuredResult: valid }]);

    await expect(runner.dispatchDoneWhenCitationJudgement(input)).resolves.toEqual({ kind: 'valid', verdicts: valid.verdicts });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      interactive: false, readOnlyReview: true, nativeSchema: DONE_WHEN_CITATION_JUDGEMENT_SCHEMA,
      prompt: expect.stringContaining(JSON.stringify(input)),
    }));
  });

  it('retries one schema-invalid result and returns the valid retry without a refusal', async () => {
    const { runner, invoke } = await subject([
      { success: true, output: 'bad', finalStructuredResult: { verdicts: [] } },
      { success: true, output: 'done', finalStructuredResult: valid },
    ]);

    await expect(runner.dispatchDoneWhenCitationJudgement(input)).resolves.toEqual({ kind: 'valid', verdicts: valid.verdicts });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('returns unavailable without dispatching when no configured candidate supports native output schemas', async () => {
    const { runner, invoke } = await subject([{ success: true, output: 'unreachable', finalStructuredResult: valid }], false);

    await expect(runner.dispatchDoneWhenCitationJudgement(input)).resolves.toMatchObject({
      kind: 'unavailable', cause: expect.stringContaining('native output schema'),
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('returns unavailable after two failed dispatches', async () => {
    const { runner, invoke } = await subject([
      { success: false, output: 'first provider failure' },
      { success: false, output: 'second provider failure' },
    ]);

    await expect(runner.dispatchDoneWhenCitationJudgement(input)).resolves.toMatchObject({
      kind: 'unavailable', cause: expect.stringContaining('second provider failure'),
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
