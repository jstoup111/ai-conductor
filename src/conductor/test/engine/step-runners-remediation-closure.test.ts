// Covers: task:6
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InvokeOptions, InvokeResult, LLMProvider } from '../../src/execution/llm-provider.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY, CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import {
  REMEDIATION_CLOSURE_JUDGEMENT_SCHEMA,
  type RemediationClosureInput,
} from '../../src/engine/remediation-closure-judgement.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';

const input: RemediationClosureInput = {
  instruction: 'Judge the repair.',
  candidates: [{
    taskId: 'rem-prd-audit-1-r1', closeIdentity: 'close-identity',
    planBlock: { title: 'Repair', body: 'Repair the defect.' }, closeRecords: [],
    citedCommits: [], diff: '', truncated: false,
  }],
};

const valid = {
  verdicts: [{ taskId: 'rem-prd-audit-1-r1', verdict: 'resolved', rationale: 'The repair is present.' }],
};

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function subject(options: {
  readonly claudeResults?: readonly InvokeResult[];
  readonly codexResults?: readonly InvokeResult[];
  readonly native?: boolean;
  readonly heads?: readonly (string | null)[];
  readonly reviewModel?: string | null;
  readonly reviewEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  readonly globalDefaultModel?: string;
  readonly reviewProviders?: readonly string[];
} = {}) {
  const claudeResults = options.claudeResults ?? [{ success: true, output: 'done', exitCode: 0, finalStructuredResult: valid }];
  const codexResults = options.codexResults ?? [{ success: true, output: 'done', exitCode: 0, finalStructuredResult: valid }];
  const claudeInvoke = vi.fn(async (_options: InvokeOptions) => claudeResults[Math.min(claudeInvoke.mock.calls.length - 1, claudeResults.length - 1)]!);
  const codexInvoke = vi.fn(async (_options: InvokeOptions) => codexResults[Math.min(codexInvoke.mock.calls.length - 1, codexResults.length - 1)]!);
  const heads = [...(options.heads ?? ['head', 'head'])];
  const readHead = vi.fn(async () => heads.shift() ?? 'head');
  const lifecycle = vi.fn();
  const reviewModel = options.reviewModel === undefined ? 'review-model' : options.reviewModel;
  const reviewEffort = options.reviewEffort ?? 'high';
  const runtimes = new ProviderRuntimeSet([
    {
      key: 'claude', provider: { name: 'claude', invoke: claudeInvoke } as unknown as LLMProvider,
      lifecycleCapability: { synchronousSpawnPermit: true },
      ...(options.native === false ? {} : { nativeSchemaCapability: { nativeOutputSchema: true as const } }),
      policy: CLAUDE_MODEL_POLICY, builtIn: true,
      availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
    },
    {
      key: 'codex', provider: { name: 'codex', invoke: codexInvoke } as unknown as LLMProvider,
      lifecycleCapability: { synchronousSpawnPermit: true },
      ...(options.native === false ? {} : { nativeSchemaCapability: { nativeOutputSchema: true as const } }),
      policy: CODEX_MODEL_POLICY, builtIn: false,
      availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
    },
  ]);
  const projectDir = await mkdtemp(join(tmpdir(), 'remediation-closure-judgement-'));
  dirs.push(projectDir);
  return {
    claudeInvoke, codexInvoke, readHead, lifecycle, projectDir,
    runner: new DefaultStepRunner({ name: 'claude', invoke: vi.fn() } as unknown as LLMProvider, 'remediation-closure', projectDir, {
      config: {
        llm_provider: 'claude',
        ...(options.globalDefaultModel === undefined
          ? {}
          : { defaults: { model: options.globalDefaultModel } }),
        steps: {
          build: { llm_provider: 'claude' },
          build_review: {
            llm_provider: options.reviewProviders ?? ['claude', 'codex'],
            ...(reviewModel === null ? {} : { model: reviewModel }),
            effort: reviewEffort,
          },
        },
      },
      configuredProviders: ['claude'], providerRuntimes: runtimes, sessionStore: new ProviderSessionStore(),
      providerAttempt: lifecycle, remediationClosureHeadReader: readHead,
    }),
  };
}

describe('DefaultStepRunner.dispatchRemediationClosureJudgement', () => {
  it('passes explicit build_review model and effort to the preferred candidate while supervised as BUILD', async () => {
    const { runner, claudeInvoke, codexInvoke, lifecycle, projectDir } = await subject();

    await expect(runner.dispatchRemediationClosureJudgement(input)).resolves.toEqual({
      kind: 'valid', verdicts: valid.verdicts, attempts: 1,
    });

    expect(claudeInvoke).toHaveBeenCalledTimes(1);
    expect(codexInvoke).not.toHaveBeenCalled();
    expect(claudeInvoke).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining(JSON.stringify(input)), model: 'review-model', effort: 'high',
      cwd: projectDir, interactive: false, readOnlyReview: true, nativeSchema: REMEDIATION_CLOSURE_JUDGEMENT_SCHEMA,
    }));
    expect(lifecycle).toHaveBeenCalledWith('build', expect.anything());
  });

  it('does not inherit the global Claude default model into a Codex build_review selection', async () => {
    const { runner, claudeInvoke, codexInvoke } = await subject({
      reviewModel: null,
      globalDefaultModel: 'opus',
      reviewProviders: ['codex'],
    });

    await runner.dispatchRemediationClosureJudgement(input);

    expect(claudeInvoke).not.toHaveBeenCalled();
    expect(codexInvoke).toHaveBeenCalledWith(expect.objectContaining({
      model: CODEX_MODEL_POLICY.stepModels.build_review,
    }));
    expect(codexInvoke).not.toHaveBeenCalledWith(expect.objectContaining({ model: 'opus' }));
  });

  it('resolves the fallback candidate model and effort under build_review while supervised as BUILD', async () => {
    const { runner, claudeInvoke, codexInvoke, lifecycle } = await subject({
      claudeResults: [{
        success: false, output: 'claude unavailable', exitCode: 127,
        providerUnavailable: true, providerUnavailableScope: 'run', providerUnavailableReason: 'claude unavailable',
      }],
    });

    await expect(runner.dispatchRemediationClosureJudgement(input)).resolves.toEqual({
      kind: 'valid', verdicts: valid.verdicts, attempts: 1,
    });

    expect(claudeInvoke).toHaveBeenCalledTimes(1);
    expect(codexInvoke).toHaveBeenCalledWith(expect.objectContaining({
      model: CODEX_MODEL_POLICY.stepModels.build_review,
      effort: CODEX_MODEL_POLICY.stepEfforts.build_review,
    }));
    expect(lifecycle).toHaveBeenCalledWith('build', expect.anything());
  });

  it('returns unavailable without a provider invocation when no build_review provider supports schemas', async () => {
    const { runner, claudeInvoke, codexInvoke } = await subject({ native: false });

    await expect(runner.dispatchRemediationClosureJudgement(input)).resolves.toMatchObject({
      kind: 'unavailable', attempts: 0, cause: expect.stringContaining('native output schema'),
    });
    expect(claudeInvoke).not.toHaveBeenCalled();
    expect(codexInvoke).not.toHaveBeenCalled();
  });

  it('retries once after a schema-invalid result and returns the valid retry', async () => {
    const { runner, claudeInvoke } = await subject({
      claudeResults: [
        { success: true, output: 'bad', exitCode: 0, finalStructuredResult: { verdicts: [] } },
        { success: true, output: 'done', exitCode: 0, finalStructuredResult: valid },
      ],
      heads: ['head-one', 'head-one', 'head-two', 'head-two'],
    });

    await expect(runner.dispatchRemediationClosureJudgement(input)).resolves.toEqual({
      kind: 'valid', verdicts: valid.verdicts, attempts: 2,
    });
    expect(claudeInvoke).toHaveBeenCalledTimes(2);
  });

  it('retries once after an invalid result and discards an attempt whose HEAD changes', async () => {
    const { runner, claudeInvoke } = await subject({
      claudeResults: [
        { success: true, output: 'bad', exitCode: 0, finalStructuredResult: { verdicts: [] } },
        { success: true, output: 'done', exitCode: 0, finalStructuredResult: valid },
      ],
      heads: ['before-one', 'before-one', 'before-two', 'after-two'],
    });

    await expect(runner.dispatchRemediationClosureJudgement(input)).resolves.toMatchObject({
      kind: 'unavailable', attempts: 2, cause: expect.stringContaining('HEAD changed'),
    });
    expect(claudeInvoke).toHaveBeenCalledTimes(2);
  });
});
