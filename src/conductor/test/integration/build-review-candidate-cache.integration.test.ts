// Covers: task:19
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { HarnessConfig } from '../../src/types/config.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(process.env.TMPDIR!, 'candidate-cache-runner-'));
  roots.push(root);
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, '.docs', 'plans', 'feature.md'), '# Plan\n\n### Task 1: review\n**Files:** src/a.ts\n');
  await writeFile(join(root, 'src', 'a.ts'), 'export const value = 1;\n');
  return root;
}

function git() {
  return async (args: string[]) => {
    if (args[0] === 'symbolic-ref') return { exitCode: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' };
    if (args[0] === 'rev-parse') return { exitCode: 0, stdout: 'head\n', stderr: '' };
    if (args[0] === 'merge-base') return { exitCode: 0, stdout: 'base\n', stderr: '' };
    if (args[0] === 'diff' && args.includes('--name-status')) return { exitCode: 0, stdout: 'M\u0000src/a.ts\u0000', stderr: '' };
    if (args[0] === 'diff') return { exitCode: 0, stdout: 'diff --git a/src/a.ts b/src/a.ts\n', stderr: '' };
    if (args[0] === 'show') return { exitCode: 0, stdout: 'export const value = 0;\n', stderr: '' };
    return { exitCode: 1, stdout: '', stderr: '' };
  };
}

const passingEffectiveResolver = async () => ({
  ok: true,
  feature: { version: 'v1', repository: '/repo', feature: 'feature' },
  effective: {
    rawVerdict: 'PASS', verdict: 'PASS', acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [],
    skippedRubrics: ['testQuality'], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [], uncoveredScopeIncompleteRubrics: [],
  },
}) as never;

describe('build-review candidate cache runner ordering', () => {
  it('resolves the prepared provider candidate before its model ladder judges', async () => {
    const root = await fixture();
    const preparedHome = join(root, 'prepared-codex-home');
    const catalogHomes: string[] = [];
    const invoke = vi.fn(async (options: { model?: string }) => options.model === 'gpt-5.6-sol'
      ? { success: false, exitCode: 1, output: 'model unavailable', modelUnavailable: true }
      : { success: true, exitCode: 0, output: JSON.stringify({ kind: 'custom-findings', version: 'v1', findings: [] }) });
    const provider: LLMProvider = { invoke, supportsSessionResume: false, lifecycleCapability: { synchronousSpawnPermit: true } };
    const providerRuntimes = new ProviderRuntimeSet([{
      key: 'codex', provider, policy: CODEX_MODEL_POLICY, builtIn: true,
      availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
    }]);
    const sessionStore = new ProviderSessionStore();
    const runner = new DefaultStepRunner(provider, 'candidate-cache', root, {
      featureDesc: 'feature', planPath: join(root, '.docs', 'plans', 'feature.md'), gitRunner: git(),
      config: {
        llm_provider: 'codex',
        build_review: { enabled: true, rubrics: { testQuality: { enabled: false } }, custom_rubrics: {
          portable: {
            enabled: true, skill: 'portable-policy', question: 'Check the selected policy.', llm_provider: 'codex',
            model: 'gpt-5.6-sol', model_fallback_ladder: ['gpt-5.6-sol', 'gpt-5.6-terra'], max_retries: 1,
          },
        } },
      } as HarnessConfig,
      providerRuntimes,
      sessionStore,
      providerExecution: {
        configuredProviders: ['codex'],
        runtimes: providerRuntimes,
        sessions: sessionStore,
        prepareCandidateSelfHost: async () => ({
          executable: 'codex',
          env: { CODEX_HOME: preparedHome },
          args: [],
          teardown: async () => {},
        }),
      },
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never) },
      buildReviewEffectiveResolver: passingEffectiveResolver,
      buildReviewPolicyCatalog: async ({ preparedEnv }) => {
        catalogHomes.push(preparedEnv?.CODEX_HOME ?? 'unprepared');
        return [{
          semanticName: 'portable-policy', source: 'project', installationOrigin: '/fixture/project',
          canonicalSkillPath: '/fixture/project/SKILL.md', packageRoot: '/fixture/project', declaredDependencies: [], availability: 'available' as const,
        }];
      },
      buildReviewPolicyCapture: async (policy) => ({
        policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md',
        manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Portable policy\n') }],
        metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] },
        digest: `sha256-v1:${'a'.repeat(64)}`,
      }),
    });

    const result = await runner.run('build_review', { complexity_tier: 'M' } as never);

    expect(result.success, result.output).toBe(true);
    expect(catalogHomes).toEqual([preparedHome]);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls.map(([options]) => options.model)).toEqual(['gpt-5.6-sol', 'gpt-5.6-terra']);

    // The preferred model still proves unavailable, then the fallback rung
    // independently reuses only its own warm judgment.
    const replay = await runner.run('build_review', { complexity_tier: 'M' } as never);
    expect(replay.success, replay.output).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(invoke.mock.calls.map(([options]) => options.model)).toEqual([
      'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-sol',
    ]);
  });
});
