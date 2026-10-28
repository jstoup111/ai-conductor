// Covers: task:6
// Covers: task:10
// Covers: task:11
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InvokeOptions, InvokeResult, LLMProvider } from '../../src/execution/llm-provider.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY, CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import * as providerScratch from '../../src/engine/self-host/provider-scratch.js';
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
  readonly reviewProviders?: string[];
  readonly prepareCandidateSelfHost?: (candidate: unknown, runtime: unknown, capture: unknown) => Promise<{
    executable: string;
    env: NodeJS.ProcessEnv;
    args: readonly string[];
    scratchRoot: string;
    teardown: () => Promise<void>;
  }>;
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
      ...(options.prepareCandidateSelfHost === undefined
        ? {}
        : { providerExecution: { prepareCandidateSelfHost: options.prepareCandidateSelfHost } }),
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

  it('gives a non-self-host Codex closure judgement an owned worktree scratch home and records its interval', async () => {
    const interval = { startedAtMs: 100, durationMs: 25 };
    const { runner, codexInvoke, lifecycle, projectDir } = await subject({
      reviewProviders: ['codex'],
      codexResults: [{ success: true, output: 'done', exitCode: 0, finalStructuredResult: valid, observedIntervals: [interval] }],
    });

    await expect(runner.dispatchRemediationClosureJudgement(input)).resolves.toMatchObject({ kind: 'valid' });

    expect(codexInvoke).toHaveBeenCalledWith(expect.objectContaining({
      nativeSchemaScratchRoot: projectDir,
      nativeSchemaScratchHome: expect.stringMatching(new RegExp(`^${projectDir.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}/\\.daemon/scratch/`)),
    }));
    expect(lifecycle).toHaveBeenCalledWith('build', expect.objectContaining({
      provider: 'codex', invoked: true, observedIntervals: [interval],
    }));
  });

  it('uses the self-host Codex home instead of an engine scratch home', async () => {
    const { runner, codexInvoke, projectDir } = await subject({
      reviewProviders: ['codex'],
      prepareCandidateSelfHost: async () => ({
        executable: 'codex', env: { CODEX_HOME: join(projectDir, '.daemon', 'scratch', 'self-host-codex') }, args: [],
        scratchRoot: projectDir, teardown: async () => {},
      }),
    });

    await expect(runner.dispatchRemediationClosureJudgement(input)).resolves.toMatchObject({ kind: 'valid' });

    const invocation = codexInvoke.mock.calls[0]?.[0];
    expect(invocation).not.toHaveProperty('nativeSchemaScratchHome');
    expect(invocation).toEqual(expect.objectContaining({
      selfHost: expect.objectContaining({ env: expect.objectContaining({ CODEX_HOME: join(projectDir, '.daemon', 'scratch', 'self-host-codex') }) }),
    }));
  });

  it('isolates concurrent Codex closure-judgement scratch homes by feature worktree', async () => {
    const first = await subject({ reviewProviders: ['codex'] });
    const second = await subject({ reviewProviders: ['codex'] });

    await expect(Promise.all([
      first.runner.dispatchRemediationClosureJudgement(input),
      second.runner.dispatchRemediationClosureJudgement(input),
    ])).resolves.toEqual([
      expect.objectContaining({ kind: 'valid' }),
      expect.objectContaining({ kind: 'valid' }),
    ]);

    const firstOptions = first.codexInvoke.mock.calls[0]?.[0];
    const secondOptions = second.codexInvoke.mock.calls[0]?.[0];
    expect(firstOptions?.nativeSchemaScratchHome).toMatch(new RegExp(`^${first.projectDir.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}/\\.daemon/scratch/`));
    expect(secondOptions?.nativeSchemaScratchHome).toMatch(new RegExp(`^${second.projectDir.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}/\\.daemon/scratch/`));
    expect(firstOptions?.nativeSchemaScratchHome).not.toBe(secondOptions?.nativeSchemaScratchHome);
    expect(firstOptions?.nativeSchemaScratchRoot).toBe(first.projectDir);
    expect(secondOptions?.nativeSchemaScratchRoot).toBe(second.projectDir);
  });

  it('leaves the closure unjudged after scratch acquisition fails twice without starting Codex', async () => {
    const { runner, codexInvoke, lifecycle } = await subject({ reviewProviders: ['codex'] });
    const acquire = vi.spyOn(providerScratch, 'acquireScratchHome')
      .mockRejectedValue(new Error('scratch permission denied'));

    try {
      await expect(runner.dispatchRemediationClosureJudgement(input)).resolves.toMatchObject({
        kind: 'unavailable', attempts: 2, cause: expect.stringContaining('scratch permission denied'),
      });

      expect(acquire).toHaveBeenCalledTimes(2);
      expect(codexInvoke).not.toHaveBeenCalled();
      const attempts = lifecycle.mock.calls
        .filter(([, metadata]) => (metadata as { provider?: string }).provider === 'codex');
      expect(attempts).toEqual([
        ['build', expect.objectContaining({ provider: 'codex', invoked: false })],
        ['build', expect.objectContaining({ provider: 'codex', invoked: false })],
      ]);
    } finally {
      acquire.mockRestore();
    }
  });
});
