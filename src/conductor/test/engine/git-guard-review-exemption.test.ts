// Covers: task:11
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY, CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import type { BuildReviewRubricProjection } from '../../src/engine/build-review-projections.js';
import { prepareWorktree } from '../../src/engine/worktree-prepare.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const projection = {
  rubric: 'security', contractVersion: 'v3', projectionVersion: 'v3',
  lapId: 'lap-a237011e9f263dd47ca1a2c7cfe929865c2e99b8', snapshotDigest: 'sha256:projection',
  digest: 'sha256:projection', mergeBase: 'base', headSha: 'head', changedFiles: [],
  removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] }, changedTestSelectors: [],
  testSuiteProof: {}, revertedProductionManifest: [], preflight: {}, repairContext: [],
} as unknown as BuildReviewRubricProjection;

const branch = (provider: 'claude' | 'codex') => ({
  rubric: 'security' as const,
  skillName: 'build-review-security',
  policy: {
    enabled: true, llm_provider: provider, model: provider === 'claude' ? 'opus' : 'gpt-5.6-sol',
    effort: 'high' as const,
    model_fallback_ladder: [provider === 'claude' ? 'opus' : 'gpt-5.6-sol'],
    max_retries: 1, escalate: false,
    max_projection_bytes: 1_000_000, min_confidence: 0,
  },
});

type CapturedSpawn = { env?: NodeJS.ProcessEnv };

describe('build_review git-guard exemption', () => {
  it.each(['claude', 'codex'] as const)(
    'launches %s from a prepared materialized review checkout without a git guard PATH prefix',
    async (providerKey) => {
      const root = await mkdtemp(join(tmpdir(), 'git-guard-review-exemption-'));
      roots.push(root);
      const headPath = join(root, '.pipeline', 'build-review-materialized', 'head');
      await mkdir(headPath, { recursive: true });
      // A prepared review worktree would normally prepend the guard. The
      // review marker, rather than an unprepared-cwd early return, must be
      // what keeps this built-in rubric dispatch unguarded.
      await initTestRepo(headPath);
      await prepareWorktree(headPath);

      const calls: CapturedSpawn[] = [];
      const subprocess = vi.fn((_file: string, _args: readonly string[], options: CapturedSpawn) => {
        calls.push(options);
        if (providerKey === 'claude') {
          return Promise.resolve({
            stdout: JSON.stringify({ type: 'result', result: 'review complete', structured_output: JSON.stringify({ findings: [] }) }),
            stderr: '', exitCode: 0,
          }) as never;
        }
        return Promise.resolve({
          stdout: [
            JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({ findings: [] }) } }),
            JSON.stringify({ type: 'turn.completed' }),
          ].join('\n'),
          stderr: '', exitCode: 0,
        }) as never;
      });
      const provider: LLMProvider = providerKey === 'claude'
        ? new ClaudeProvider(undefined, subprocess as never)
        : new CodexProvider(
          vi.fn(async () => ({
            stdout: JSON.stringify({
              schemaVersion: 1,
              auth: { selectedMode: 'cached-login', configured: true },
              transport: { authenticated: true },
            }),
            exitCode: 0,
          })),
          'codex',
          undefined,
          subprocess as never,
        );
      const policy = providerKey === 'claude' ? CLAUDE_MODEL_POLICY : CODEX_MODEL_POLICY;
      const runner = new DefaultStepRunner(provider, 'review-exemption', root, {
        providerRuntimes: new ProviderRuntimeSet([{
          key: providerKey,
          provider,
          lifecycleCapability: provider.lifecycleCapability,
          nativeSchemaCapability: provider.nativeSchemaCapability,
          policy,
          builtIn: true,
          availability: new ModelAvailability(policy.modelFallbackLadder),
        }]),
        configuredProviders: [providerKey],
        sessionStore: new ProviderSessionStore(),
      });

      const dispatch = (runner as unknown as {
        dispatchBuildReviewRubric: (
          reviewBranch: ReturnType<typeof branch>,
          reviewProjection: BuildReviewRubricProjection,
          tier?: undefined,
          executionContext?: undefined,
          inputs?: { sourceMaterialization: { contextFor: () => { source: { headPath: string } } } },
        ) => Promise<unknown>;
      }).dispatchBuildReviewRubric.bind(runner);
      await dispatch(branch(providerKey), projection, undefined, undefined, {
        sourceMaterialization: { contextFor: () => ({ source: { headPath } }) },
      });

      expect(calls).toHaveLength(1);
      const guardBin = join(headPath, '.pipeline', 'bin');
      expect(calls[0]?.env?.PATH?.split(':') ?? []).not.toContain(guardBin);

      await initTestRepo(root);
      await prepareWorktree(root);
      await runner.run('build', { complexity_tier: 'S' });

      expect(calls).toHaveLength(2);
      expect(calls[1]?.env?.PATH?.split(':')[0]).toBe(join(root, '.pipeline', 'bin'));
    },
  );
});
