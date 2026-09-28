// Covers: task:17
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { resolveBuildReviewConfig } from '../../src/engine/resolved-config.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY, CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { HarnessConfig } from '../../src/types/config.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const effectivePass = async () => ({
  ok: true,
  feature: { version: 'v1', repository: '/fixture', feature: 'feature' },
  effective: {
    rawVerdict: 'PASS', verdict: 'PASS', acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [],
    skippedRubrics: [], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [], uncoveredScopeIncompleteRubrics: [],
  },
}) as never;

function policyBundle(skill: string) {
  return {
    policy: { semanticName: skill, source: 'project' as const, installationOrigin: '/fixture', canonicalSkillPath: `/fixture/${skill}/SKILL.md`, packageRoot: `/fixture/${skill}`, declaredDependencies: [], availability: 'available' as const },
    materialPath: `/fixture/${skill}`, definitionPath: `/fixture/${skill}/SKILL.md`, manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Policy\n') }],
    metadata: { version: 1, semanticName: skill, source: 'project', declaredDependencies: [] }, digest: `sha256-v1:${'a'.repeat(64)}`,
  };
}

function invocationProfile(launch: Record<string, unknown>) {
  return {
    dangerouslySkipPermissions: launch.dangerouslySkipPermissions,
    interactive: launch.interactive,
    model: launch.model,
    effort: launch.effort,
    readOnlyReview: launch.readOnlyReview,
    nativeSchema: launch.nativeSchema,
  };
}

async function runBuiltinLap(providerKey: 'claude' | 'codex', disabledCustom = false) {
  const root = await mkdtemp(join(process.env.TMPDIR!, 'build-review-builtin-invariance-'));
  roots.push(root);
  await mkdir(join(root, '.pipeline', 'build-review', 'lap-head'), { recursive: true });
  await writeFile(join(root, '.pipeline', 'build-review', 'lap-head', 'prior-branch.json'), '{}\n');
  const catalogCalls: Array<Record<string, unknown>> = [];
  const launches: Array<Record<string, unknown>> = [];
  const provider: LLMProvider = {
    invoke: vi.fn(async (options) => {
      launches.push({ ...options });
      return { success: true, exitCode: 0, output: '{"findings":[]}', finalStructuredResult: { findings: [] } };
    }),
    lifecycleCapability: { synchronousSpawnPermit: true },
    nativeSchemaCapability: { nativeOutputSchema: true },
  };
  const policy = providerKey === 'claude' ? CLAUDE_MODEL_POLICY : CODEX_MODEL_POLICY;
  const config = {
    llm_provider: providerKey,
    build_review: {
      enabled: true,
      rubrics: { testQuality: { enabled: false }, security: { enabled: true, llm_provider: providerKey } },
      ...(disabledCustom ? { custom_rubrics: { portable: { enabled: false, skill: 'portable-policy', question: 'Review.' } } } : {}),
    },
  } as HarnessConfig;
  const capabilityProbe = vi.fn();
  const runner = new DefaultStepRunner(provider, `builtin-${providerKey}`, root, {
    featureDesc: 'feature', config,
    providerRuntimes: new ProviderRuntimeSet([{ key: providerKey, provider, policy, builtIn: true, availability: new ModelAvailability(policy.modelFallbackLadder) }]),
    sessionStore: new ProviderSessionStore(),
    buildReviewEffectiveResolver: effectivePass,
    probeReadOnlyReviewCapability: capabilityProbe as never,
    buildReviewPolicyCatalog: async (request) => {
      catalogCalls.push({ ...request, launchesBefore: launches.length });
      return [policyBundle(request.skill).policy];
    },
    buildReviewPolicyCapture: async (installed) => policyBundle(installed.semanticName) as never,
  });
  const inputs = {
    diff: 'diff --git a/src/a.ts b/src/a.ts', planBody: '# Plan', mergeBase: 'base', baseRef: 'origin/main', baseKind: 'remote', trackingRefSha: 'base', remoteHeadSha: 'base', fresh: true,
    testSuiteProof: {}, sourceSnapshot: { digest: 'sha256:snapshot', contentDigest: 'sha256:content', baseRef: 'origin/main', mergeBase: 'base', headSha: 'head', diff: 'diff', planBody: '# Plan', repairContext: [], removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] }, sourceChanges: [] },
  } as never;
  const result = await (runner as unknown as { runRubricBuildReview: (value: unknown, resolved: unknown, tier: 'M') => Promise<{ success: boolean; output: string }> }).runRubricBuildReview(inputs, resolveBuildReviewConfig(config), 'M');
  return { root, launches, result, capabilityProbe, catalogCalls };
}

describe('built-in-only build-review invocation invariance', () => {
  it.each(['claude', 'codex'] as const)('keeps the %s built-in invocation on its literal ordinary profile', async (providerKey) => {
    const { root, launches, result, capabilityProbe, catalogCalls } = await runBuiltinLap(providerKey);

    expect(result.success).toBe(true);
    expect(launches).toHaveLength(1);
    expect(invocationProfile(launches[0]!)).toEqual({
      dangerouslySkipPermissions: true,
      interactive: false,
      model: providerKey === 'claude' ? 'opus' : 'gpt-5.6-sol',
      effort: 'high',
      readOnlyReview: undefined,
      nativeSchema: expect.any(Object),
    });
    expect(capabilityProbe).not.toHaveBeenCalled();
    await expect(readFile(join(root, '.pipeline', 'build-review', 'lap-head', 'input-digest.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(result.output).not.toContain('read-only-review-unavailable');
    // No lap-level policy pre-capture: the only resolution is the actual
    // candidate's own, bounded by that candidate's deadline.
    expect(catalogCalls).toHaveLength(1);
    expect(catalogCalls[0]).toMatchObject({ provider: providerKey, deadlineAt: expect.any(Number) });
    await expect(readFile(join(root, '.pipeline', 'build-review', 'lap-head', 'prior-branch.json'), 'utf8')).resolves.toBe('{}\n');
  });

  it.each(['claude', 'codex'] as const)('treats a declared but disabled custom rubric as built-in-only for %s', async (providerKey) => {
    const ordinary = await runBuiltinLap(providerKey);
    const disabled = await runBuiltinLap(providerKey, true);

    expect(disabled.result.success).toBe(true);
    expect(disabled.launches.map(invocationProfile)).toEqual(ordinary.launches.map(invocationProfile));
    expect(disabled.capabilityProbe).not.toHaveBeenCalled();
    expect(disabled.catalogCalls).toEqual([expect.objectContaining({ provider: providerKey, deadlineAt: expect.any(Number) })]);
    await expect(readFile(join(disabled.root, '.pipeline', 'build-review', 'lap-head', 'prior-branch.json'), 'utf8')).resolves.toBe('{}\n');
    await expect(readFile(join(disabled.root, '.pipeline', 'build-review', 'lap-head', 'input-digest.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
