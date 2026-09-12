// Covers: task:16, task:26
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY, CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(process.env.TMPDIR!, 'custom-policy-runner-'));
  roots.push(root);
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await writeFile(join(root, '.docs', 'plans', 'feature.md'), '# Plan\n\n### Task 1: review\n**Files:** src/a.ts\n');
  await writeFile(join(root, 'src', 'a.ts'), 'export const value = 1;\n').catch(async () => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'a.ts'), 'export const value = 1;\n');
  });
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

const failingEffectiveResolver = async () => ({
  ok: true,
  feature: { version: 'v1', repository: '/repo', feature: 'feature' },
  effective: {
    rawVerdict: 'FAIL', verdict: 'FAIL', acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [],
    skippedRubrics: ['testQuality'], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [], uncoveredScopeIncompleteRubrics: [],
  },
}) as never;

describe('custom build-review policy runner', () => {
  it.each([
    ['claude', 'project'], ['claude', 'global'], ['claude', 'plugin'],
    ['codex', 'project'], ['codex', 'global'], ['codex', 'plugin'],
  ] as const)('runs an installed %s %s policy through a prepared candidate', async (providerKey, source) => {
    const root = await fixture();
    const invoke = vi.fn(async () => ({ success: true, exitCode: 0, output: JSON.stringify({ kind: 'custom-findings', version: 'v1', findings: [] }) }));
    const provider: LLMProvider = { invoke, supportsSessionResume: false, lifecycleCapability: { synchronousSpawnPermit: true } };
    const policy = providerKey === 'claude' ? CLAUDE_MODEL_POLICY : CODEX_MODEL_POLICY;
    const runner = new DefaultStepRunner(provider, 'custom-policy', root, {
      featureDesc: 'feature', planPath: join(root, '.docs', 'plans', 'feature.md'), gitRunner: git(),
      config: {
        llm_provider: providerKey,
        build_review: { enabled: true, rubrics: { testQuality: { enabled: false } }, custom_rubrics: {
          portable: { enabled: true, skill: source === 'plugin' ? 'policy-plugin:portable-policy' : 'portable-policy', question: 'Check the selected policy.', source, llm_provider: providerKey },
        } },
      } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([{ key: providerKey, provider, policy, builtIn: true, availability: new ModelAvailability(policy.modelFallbackLadder) }]),
      sessionStore: new ProviderSessionStore(),
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never) },
      buildReviewEffectiveResolver: passingEffectiveResolver,
      buildReviewPolicyCatalog: async () => [{
        semanticName: 'portable-policy', source, ...(source === 'plugin' ? { plugin: { id: 'policy-plugin', version: '1.0.0' } } : {}), installationOrigin: `/fixture/${source}`, canonicalSkillPath: `/fixture/${source}/SKILL.md`, packageRoot: `/fixture/${source}`, declaredDependencies: [], availability: 'available',
      }],
      buildReviewPolicyCapture: async (policy) => ({
        policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md',
        manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Portable policy\n') }],
        metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] },
        digest: `sha256-v1:${'a'.repeat(64)}`,
      }),
    });

    const result = await runner.run('build_review', { complexity_tier: 'M' } as never);
    expect(result.success, result.output).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    const firstInvocation = (invoke.mock.calls as unknown as Array<[Parameters<LLMProvider['invoke']>[0]]>)[0]?.[0];
    expect(firstInvocation?.prompt).toContain('Portable policy');
  });

  it('refuses an ambiguous installed selection without invoking a provider', async () => {
    const root = await fixture();
    const invoke = vi.fn(async () => ({ success: true, exitCode: 0, output: '{}' }));
    const provider: LLMProvider = { invoke, supportsSessionResume: false, lifecycleCapability: { synchronousSpawnPermit: true } };
    const runner = new DefaultStepRunner(provider, 'custom-policy', root, {
      featureDesc: 'feature', planPath: join(root, '.docs', 'plans', 'feature.md'), gitRunner: git(),
      config: { llm_provider: 'claude', build_review: { enabled: true, rubrics: { testQuality: { enabled: false } }, custom_rubrics: {
        portable: { enabled: true, skill: 'portable-policy', question: 'Check policy.', llm_provider: 'claude' },
      } } } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([{ key: 'claude', provider, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) }]),
      sessionStore: new ProviderSessionStore(),
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never) },
      buildReviewPolicyCatalog: async () => ['project', 'global'].map((source) => ({
        semanticName: 'portable-policy', source: source as 'project' | 'global', installationOrigin: `/fixture/${source}`, canonicalSkillPath: `/fixture/${source}/SKILL.md`, packageRoot: `/fixture/${source}`, declaredDependencies: [], availability: 'available' as const,
      })),
    });
    const result = await runner.run('build_review', { complexity_tier: 'M' } as never);
    expect(result.success).toBe(false);
    expect(result.output).toContain('ambiguous');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('publishes a first-use custom loading failure with its declaration and no invented content', async () => {
    const root = await fixture();
    const invoke = vi.fn(async () => ({ success: true, exitCode: 0, output: '{}' }));
    const provider: LLMProvider = { invoke, supportsSessionResume: false, lifecycleCapability: { synchronousSpawnPermit: true } };
    const runner = new DefaultStepRunner(provider, 'custom-policy-failure', root, {
      featureDesc: 'feature', planPath: join(root, '.docs', 'plans', 'feature.md'), gitRunner: git(),
      config: { llm_provider: 'codex', build_review: { enabled: true, rubrics: { testQuality: { enabled: false } }, custom_rubrics: {
        portable: { enabled: true, skill: 'portable-policy', question: 'Check the selected policy.', source: 'project', resources: ['criteria.md'], llm_provider: 'codex' },
      } } } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([{ key: 'codex', provider, policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder) }]),
      sessionStore: new ProviderSessionStore(),
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never) },
      buildReviewEffectiveResolver: failingEffectiveResolver,
      buildReviewPolicyCatalog: async () => [{
        semanticName: 'portable-policy', source: 'project', installationOrigin: '/fixture/project', canonicalSkillPath: '/fixture/project/SKILL.md', packageRoot: '/fixture/project', declaredDependencies: [], availability: 'available',
      }],
      buildReviewPolicyCapture: async () => { throw new Error('missing criteria.md'); },
    });

    const result = await runner.run('build_review', { complexity_tier: 'M' } as never);
    const aggregate = JSON.parse(await readFile(join(root, '.pipeline', 'build-review.json'), 'utf8'));

    expect({ result, aggregate, calls: invoke.mock.calls.length }).toMatchObject({
      result: { success: false }, calls: 0,
      aggregate: {
        currentCustomRubrics: ['portable'],
        customResults: { portable: {
          declaration: { rubricId: 'portable', semanticSkill: 'portable-policy', question: 'Check the selected policy.', source: 'project', resources: ['criteria.md'] },
          result: { kind: 'infrastructure-failure', reason: 'policy-load-failed' },
        } },
      },
    });
    expect(aggregate.customResults.portable).not.toHaveProperty('descriptor');
  });
});
