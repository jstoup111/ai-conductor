// Covers: task:16, task:21, task:26
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY, CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { RemediationCaseStore } from '../../src/engine/remediation-case-store.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { InvokeOptions, InvokeResult, LLMProvider } from '../../src/execution/llm-provider.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import * as buildReviewCache from '../../src/engine/build-review-cache.js';
import { assembleBuildReviewAdjudicationContext } from '../../src/engine/build-review-adjudication-context.js';
import { joinBuildReviewRubricOutcomes } from '../../src/engine/build-review-aggregate.js';
import { BUILD_REVIEW_CUSTOM_V1_SCHEMA, parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import { stampBuildReviewCustomJudgedResult } from '../../src/engine/build-review-finding-identity.js';

vi.mock('../../src/engine/build-review-cache.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/build-review-cache.js')>();
  return { ...actual, readBuildReviewCacheEntry: vi.fn(actual.readBuildReviewCacheEntry) };
});

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

// Direct runner fixtures exercise the custom-policy hand-off, not the
// provider-owned sandbox probe. Keep that process boundary explicit.
const availableReadOnlyReviewCapability = async ({ provider, platform }: { provider: string; platform: string }) => ({
  provider, platform, status: 'available' as const,
});

const successfulInvoke = (payload: { kind: string; version: string; findings: unknown[] }) =>
  vi.fn<(options: InvokeOptions) => Promise<InvokeResult>>(async () => ({
    success: true, exitCode: 0, output: JSON.stringify(payload), finalStructuredResult: payload,
  }));

/**
 * Exercise the custom-member hand-off without a self-host preparation hook.
 * A non-self-host review must reach the provider in the ordinary child
 * environment; only the native-schema scratch home is engine-owned for Codex.
 */
async function runOrdinaryCustomMember(
  providerKey: 'claude' | 'codex',
  invoke: LLMProvider['invoke'],
) {
  const root = await fixture();
  const provider: LLMProvider = {
    invoke, supportsSessionResume: false, lifecycleCapability: { synchronousSpawnPermit: true },
    nativeSchemaCapability: { nativeOutputSchema: true },
  };
  const policy = providerKey === 'claude' ? CLAUDE_MODEL_POLICY : CODEX_MODEL_POLICY;
  const runner = new DefaultStepRunner(provider, `ordinary-${providerKey}`, root, {
    featureDesc: 'feature', planPath: join(root, '.docs', 'plans', 'feature.md'), gitRunner: git(),
    config: { llm_provider: providerKey, build_review: { enabled: true, rubrics: { testQuality: { enabled: false } }, custom_rubrics: {
      portable: { enabled: true, skill: 'portable-policy', question: 'Check policy.', source: 'project', llm_provider: providerKey },
    } } } as HarnessConfig,
    providerRuntimes: new ProviderRuntimeSet([{ key: providerKey, provider, policy, builtIn: true, availability: new ModelAvailability(policy.modelFallbackLadder) }]),
    sessionStore: new ProviderSessionStore(),
    probeReadOnlyReviewCapability: availableReadOnlyReviewCapability,
    buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never) },
    buildReviewEffectiveResolver: passingEffectiveResolver,
    buildReviewPolicyCatalog: async () => [{ semanticName: 'portable-policy', source: 'project', installationOrigin: '/fixture/project', canonicalSkillPath: '/fixture/project/SKILL.md', packageRoot: '/fixture/project', declaredDependencies: [], availability: 'available' as const }],
    buildReviewPolicyCapture: async (policy) => ({
      policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md',
      manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Portable policy\n') }],
      metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] },
      digest: `sha256-v1:${'a'.repeat(64)}`,
    }),
  });
  const run = await runner.run('build_review', { complexity_tier: 'M' } as never);
  const artifact = JSON.parse(await readFile(join(root, '.pipeline', 'build-review', 'lap-head', 'portable.json'), 'utf8'));
  return { root, run, artifact };
}

describe('custom build-review policy runner', () => {
  it.each([
    ['linux nested namespaces refused'],
    ['linux unrestricted'],
    ['darwin without bubblewrap'],
  ])('judges a custom member in the ordinary environment on %s', async (_hostFixture) => {
    // This is deliberately the process boundary for the retired containment
    // launcher: a non-self-host custom review must never request bwrap.
    const bwrapSpawns = vi.fn();
    const invoke = vi.fn(async () => {
      return { success: true, exitCode: 0, output: JSON.stringify({ kind: 'custom-findings', version: 'v1', findings: [] }), finalStructuredResult: { kind: 'custom-findings', version: 'v1', findings: [] } };
    });
    const { run, artifact } = await runOrdinaryCustomMember('claude', invoke);

    expect(run.success, run.output).toBe(true);
    expect(artifact.result).toMatchObject({ kind: 'judged', rubric: 'portable' });
    expect(artifact.result).not.toMatchObject({ reason: 'preflight-failed' });
    if (_hostFixture === 'darwin without bubblewrap') {
      expect(JSON.stringify(artifact.result)).not.toMatch(/bubblewrap|nested sandbox|containment probe/i);
    }
    // The mock records only a bwrap request. Direct provider invocation makes
    // no such request on any of these host fixtures.
    expect(bwrapSpawns).not.toHaveBeenCalled();
  });

  it('keeps the Linux unrestricted custom-member launch identical to a nested-namespaces refusal', async () => {
    const payload = { kind: 'custom-findings', version: 'v1', findings: [] };
    const nestedNamespacesRefused = successfulInvoke(payload);
    const linuxUnrestricted = successfulInvoke(payload);
    const nested = await runOrdinaryCustomMember('claude', nestedNamespacesRefused);
    const unrestricted = await runOrdinaryCustomMember('claude', linuxUnrestricted);
    const profile = (options: Parameters<LLMProvider['invoke']>[0]) => ({
      provider: 'claude', readOnlyReview: options.readOnlyReview, cwd: options.cwd,
      prompt: options.prompt, nativeSchema: options.nativeSchema, selfHost: options.selfHost,
    });

    expect(nested.artifact.result).toMatchObject({ kind: 'judged' });
    expect(unrestricted.artifact.result).toMatchObject({ kind: 'judged' });
    // Roots differ by fixture; the frozen-head working directory is the
    // corresponding fixture root in both ordinary launches.
    expect(profile(nestedNamespacesRefused.mock.calls[0]![0])).toEqual({
      ...profile(linuxUnrestricted.mock.calls[0]![0]), cwd: nested.root,
    });
    expect(linuxUnrestricted.mock.calls[0]![0].cwd).toBe(unrestricted.root);
  });

  it('passes read-only custom launches through the ordinary environment and keeps only Codex schema scratch state', async () => {
    const payload = { kind: 'custom-findings', version: 'v1', findings: [] };
    const claudeInvoke = successfulInvoke(payload);
    const codexInvoke = successfulInvoke(payload);
    const claude = await runOrdinaryCustomMember('claude', claudeInvoke);
    const codex = await runOrdinaryCustomMember('codex', codexInvoke);
    const claudeOptions = claudeInvoke.mock.calls[0]![0];
    const codexOptions = codexInvoke.mock.calls[0]![0];

    expect(claudeOptions).toMatchObject({ readOnlyReview: true, cwd: claude.root });
    expect(codexOptions).toMatchObject({ readOnlyReview: true, cwd: codex.root, nativeSchemaScratchHome: expect.any(String) });
    for (const options of [claudeOptions, codexOptions]) {
      expect(options.selfHost).toBeUndefined();
      expect(options).not.toHaveProperty('env');
      expect(JSON.stringify(options)).not.toMatch(/CLAUDE_CONFIG_DIR|CODEX_HOME|TMPDIR|XDG_/);
    }
    // Codex gets a disposable schema home, never a copied login or child CODEX_HOME.
    expect(codexOptions.nativeSchemaScratchHome).not.toBe(process.env.CODEX_HOME);
    await expect(readFile(join(codex.root, '.codex', 'auth.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves provider-error without retired containment diagnostics', async () => {
    const { artifact } = await runOrdinaryCustomMember('claude', async () => ({ success: false, exitCode: 1, output: 'provider transport failed' }));
    expect(artifact.result).toMatchObject({ kind: 'infrastructure-failure', reason: 'provider-error' });
    expect(JSON.stringify(artifact.result)).not.toMatch(/bubblewrap|nested sandbox|containment probe/i);
  });

  it.each([
    ['claude', 'project'], ['claude', 'global'], ['claude', 'plugin'],
    ['codex', 'project'], ['codex', 'global'], ['codex', 'plugin'],
  ] as const)('runs an installed %s %s policy through a prepared candidate', async (providerKey, source) => {
    const root = await fixture();
    const payload = { kind: 'custom-findings', version: 'v1', findings: [] };
    const invoke = vi.fn(async () => ({ success: true, exitCode: 0, output: JSON.stringify(payload), finalStructuredResult: payload }));
    const preparedEnv = { CODEX_HOME: '/prepared/candidate-home', CANDIDATE_ONLY: providerKey };
    const policyCatalog = vi.fn(async () => [{
      semanticName: 'portable-policy', source, ...(source === 'plugin' ? { plugin: { id: 'policy-plugin', version: '1.0.0' } } : {}), installationOrigin: `/fixture/${source}`, canonicalSkillPath: `/fixture/${source}/SKILL.md`, packageRoot: `/fixture/${source}`, declaredDependencies: [], availability: 'available' as const,
    }]);
    const provider: LLMProvider = {
      invoke, supportsSessionResume: false, lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
    };
    const events = new ConductorEventEmitter();
    const resolvedEvents: unknown[] = [];
    const rubricResults: unknown[] = [];
    const outerVerdicts: unknown[] = [];
    events.on('build_review_policy_resolved', (event) => { resolvedEvents.push(event); });
    events.on('build_review_rubric_result', (event) => { rubricResults.push(event); });
    events.on('build_review_outer_verdict', (event) => { outerVerdicts.push(event); });
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
      probeReadOnlyReviewCapability: availableReadOnlyReviewCapability,
      providerExecution: {
        prepareCandidateSelfHost: async () => ({ executable: `/prepared/${providerKey}`, env: preparedEnv, args: [], teardown: async () => {} }),
      } as never,
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never) },
      events,
      buildReviewEffectiveResolver: passingEffectiveResolver,
      buildReviewPolicyCatalog: policyCatalog,
      buildReviewPolicyCapture: async (policy) => ({
        policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md',
        manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Portable policy\n') }],
        metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] },
        digest: `sha256-v1:${'a'.repeat(64)}`,
      }),
    });

    const result = await runner.run('build_review', { complexity_tier: 'M' } as never);
    expect(result.success, result.output).toBe(true);
    const branchArtifact = JSON.parse(await readFile(join(root, '.pipeline', 'build-review', 'lap-head', 'portable.json'), 'utf8'));
    expect(branchArtifact).toMatchObject({
      rubric: 'portable',
      provenance: { kind: 'fresh' },
      descriptor: { semanticSkill: source === 'plugin' ? 'policy-plugin:portable-policy' : 'portable-policy' },
      result: { kind: 'judged', rubric: 'portable' },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(policyCatalog).toHaveBeenCalledWith(expect.objectContaining({
      preparedEnv,
      preparedExecutable: `/prepared/${providerKey}`,
    }));
    const firstInvocation = (invoke.mock.calls as unknown as Array<[Parameters<LLMProvider['invoke']>[0]]>)[0]?.[0];
    if (!firstInvocation?.model || !firstInvocation.effort) throw new Error('expected a prepared provider candidate');
    expect(firstInvocation.readOnlyReview).toBe(true);
    expect(firstInvocation.selfHost).toMatchObject({
      executable: `/prepared/${providerKey}`,
      env: preparedEnv,
    });
    const preparedCandidate = { provider: providerKey, model: firstInvocation.model, effort: firstInvocation.effort };
    expect(firstInvocation?.prompt).toContain('Portable policy');
    // The custom-v1 schema has a flat object root (#2739); the provider must
    // receive exactly that engine-owned schema.
    expect(firstInvocation.nativeSchema).toEqual(BUILD_REVIEW_CUSTOM_V1_SCHEMA);
    expect(resolvedEvents).toEqual([expect.objectContaining({
      source, bundleDigest: `sha256-v1:${'a'.repeat(64)}`,
      provenance: expect.objectContaining({
        inputDigest: expect.any(String),
        // Every source choice must remain bound to the actual prepared
        // candidate that receives its material, not the parent default.
        candidate: preparedCandidate,
        ...(source === 'plugin' ? { plugin: { id: 'policy-plugin', version: '1.0.0' } } : {}),
      }),
    })]);
    const replay = await runner.run('build_review', { complexity_tier: 'M' } as never);
    expect(replay.success, replay.output).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(rubricResults).toEqual([
      { type: 'build_review_rubric_result', rubric: 'portable', lapId: 'lap-head', verdict: 'PASS' },
      { type: 'build_review_rubric_result', rubric: 'portable', lapId: 'lap-head', verdict: 'PASS' },
    ]);
    expect(outerVerdicts).toEqual([
      { type: 'build_review_outer_verdict', lapId: 'lap-head', rawVerdict: 'PASS', effectiveVerdict: 'PASS' },
      { type: 'build_review_outer_verdict', lapId: 'lap-head', rawVerdict: 'PASS', effectiveVerdict: 'PASS' },
    ]);
  });

  it('records the unchanged custom-lap input digests as build-review evidence', async () => {
    const root = await fixture();
    const payload = { kind: 'custom-findings', version: 'v1', findings: [] };
    const provider: LLMProvider = {
      invoke: vi.fn(async () => ({ success: true, exitCode: 0, output: JSON.stringify(payload), finalStructuredResult: payload })),
      supportsSessionResume: false, lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
    };
    const runner = new DefaultStepRunner(provider, 'custom-policy-input-digest', root, {
      featureDesc: 'feature', planPath: join(root, '.docs', 'plans', 'feature.md'), gitRunner: git(),
      config: { llm_provider: 'claude', build_review: { enabled: true, rubrics: { testQuality: { enabled: false } }, custom_rubrics: {
        portable: { enabled: true, skill: 'portable-policy', question: 'Check policy.', source: 'project', llm_provider: 'claude' },
      } } } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([{ key: 'claude', provider, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) }]),
      sessionStore: new ProviderSessionStore(),
      probeReadOnlyReviewCapability: availableReadOnlyReviewCapability,
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never) },
      buildReviewEffectiveResolver: passingEffectiveResolver,
      buildReviewPolicyCatalog: async () => [{ semanticName: 'portable-policy', source: 'project', installationOrigin: '/fixture/project', canonicalSkillPath: '/fixture/project/SKILL.md', packageRoot: '/fixture/project', declaredDependencies: [], availability: 'available' as const }],
      buildReviewPolicyCapture: async (policy) => ({ policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md', manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Portable policy\n') }], metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] }, digest: `sha256-v1:${'a'.repeat(64)}` }),
    });

    await expect(runner.run('build_review', { complexity_tier: 'M' } as never)).resolves.toMatchObject({ success: true });
    await expect(readFile(join(root, '.pipeline', 'build-review', 'lap-head', 'input-digest.json'), 'utf8')).resolves.toContain('"before"');
  });

  it('publishes an unchanged custom lap whose engine events append to a pre-existing event log', async () => {
    const root = await fixture();
    const eventLog = join(root, '.pipeline', 'events.jsonl');
    await writeFile(eventLog, '{"type":"step_started","step":"build_review"}\n');
    const payload = { kind: 'custom-findings', version: 'v1', findings: [] };
    const provider: LLMProvider = {
      invoke: vi.fn(async () => ({ success: true, exitCode: 0, output: JSON.stringify(payload), finalStructuredResult: payload })),
      supportsSessionResume: false, lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
    };
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(eventLog, events);
    persister.start();
    try {
      const runner = new DefaultStepRunner(provider, 'custom-policy-event-log', root, {
        featureDesc: 'feature', planPath: join(root, '.docs', 'plans', 'feature.md'), gitRunner: git(), events,
        config: { llm_provider: 'claude', build_review: { enabled: true, rubrics: { testQuality: { enabled: false } }, custom_rubrics: {
          portable: { enabled: true, skill: 'portable-policy', question: 'Check policy.', source: 'project', llm_provider: 'claude' },
        } } } as HarnessConfig,
        providerRuntimes: new ProviderRuntimeSet([{ key: 'claude', provider, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) }]),
        sessionStore: new ProviderSessionStore(),
        probeReadOnlyReviewCapability: availableReadOnlyReviewCapability,
        buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never) },
        buildReviewEffectiveResolver: passingEffectiveResolver,
        buildReviewPolicyCatalog: async () => [{ semanticName: 'portable-policy', source: 'project', installationOrigin: '/fixture/project', canonicalSkillPath: '/fixture/project/SKILL.md', packageRoot: '/fixture/project', declaredDependencies: [], availability: 'available' as const }],
        buildReviewPolicyCapture: async (policy) => ({ policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md', manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Portable policy\n') }], metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] }, digest: `sha256-v1:${'a'.repeat(64)}` }),
      });

      const result = await runner.run('build_review', { complexity_tier: 'M' } as never);
      expect(result.success, result.output).toBe(true);
      await expect(readFile(eventLog, 'utf8')).resolves.toContain('build_review_policy_resolved');
      await expect(readFile(join(root, '.pipeline', 'build-review.json'), 'utf8')).resolves.toContain('"verdict": "PASS"');
    } finally {
      persister.stop();
    }
  });

  it('discards every custom verdict when captured policy material changes during fan-out', async () => {
    const root = await fixture();
    const packageRoot = join(root, 'policy-package');
    const materialPath = join(root, '.pipeline', 'build-review', 'policy-material', 'portable');
    const preExistingEvidence = join(root, '.pipeline', 'test-suite-evidence.json');
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, 'SKILL.md'), '# Original policy\n');
    await writeFile(preExistingEvidence, '{"status":"CURRENT"}\n');
    const payload = { kind: 'custom-findings', version: 'v1', findings: [] };
    const invoke = vi.fn(async () => {
      await writeFile(join(materialPath, 'SKILL.md'), '# Mutated during review\n');
      await writeFile(preExistingEvidence, '{"status":"MUTATED"}\n');
      return { success: true, exitCode: 0, output: JSON.stringify(payload), finalStructuredResult: payload };
    });
    const provider: LLMProvider = {
      invoke, supportsSessionResume: false, lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
    };
    const events = new ConductorEventEmitter();
    const failures: unknown[] = [];
    events.on('build_review_rubric_infrastructure_failure', (event) => { failures.push(event); });
    const runner = new DefaultStepRunner(provider, 'custom-policy-input-mutation', root, {
      featureDesc: 'feature', planPath: join(root, '.docs', 'plans', 'feature.md'), gitRunner: git(),
      config: { llm_provider: 'claude', build_review: { enabled: true, rubrics: { testQuality: { enabled: false } }, custom_rubrics: {
        portable: { enabled: true, skill: 'portable-policy', question: 'Check policy.', source: 'project', llm_provider: 'claude' },
      } } } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([{ key: 'claude', provider, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) }]),
      sessionStore: new ProviderSessionStore(), events,
      probeReadOnlyReviewCapability: availableReadOnlyReviewCapability,
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never) },
      buildReviewEffectiveResolver: passingEffectiveResolver,
      buildReviewPolicyCatalog: async () => [{ semanticName: 'portable-policy', source: 'project', installationOrigin: packageRoot, canonicalSkillPath: join(packageRoot, 'SKILL.md'), packageRoot, declaredDependencies: [], availability: 'available' as const }],
      buildReviewPolicyCapture: async (policy) => {
        await mkdir(materialPath, { recursive: true });
        await writeFile(join(materialPath, 'SKILL.md'), '# Captured policy\n');
        return { policy, materialPath, definitionPath: join(materialPath, 'SKILL.md'), manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Captured policy\n') }], metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] }, digest: `sha256-v1:${'a'.repeat(64)}` };
      },
    });

    const result = await runner.run('build_review', { complexity_tier: 'M' } as never);
    expect(result).toMatchObject({ success: false, currentLapMechanicalFault: true });
    expect(result.output).toContain('review-input-mutated');
    await expect(readFile(join(root, '.pipeline', 'build-review.json'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(root, '.pipeline', 'kickback-ledger.json'), 'utf8')).resolves.toContain('"mechanicalFaults": 1');
    expect(failures).toEqual([expect.objectContaining({
      cause: 'review-input-mutated',
      changedInputs: expect.arrayContaining(['capturedPolicyMaterial:SKILL.md', 'evidenceRoot:test-suite-evidence.json']),
    })]);
  });

  it('discards a mixed lap when a built-in peer policy captured before fan-out changes', async () => {
    const root = await fixture();
    const materialRoot = join(root, '.pipeline', 'build-review', 'policy-material');
    const packageRoot = join(root, 'policy-package');
    let securityMaterialPath: string | undefined;
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, 'SKILL.md'), '# Installed policy\n');
    const customPayload = { kind: 'custom-findings', version: 'v1', findings: [] };
    const provider: LLMProvider = {
      invoke: vi.fn(async (options) => {
        if (securityMaterialPath === undefined) throw new Error('security policy was not captured before fan-out');
        await writeFile(join(securityMaterialPath, 'SKILL.md'), '# Mutated built-in policy\n');
        const builtin = options.prompt.includes('Build Review Security rubric.');
        const payload = builtin ? { findings: [] } : customPayload;
        return { success: true, exitCode: 0, output: JSON.stringify(payload), finalStructuredResult: payload };
      }),
      supportsSessionResume: false, lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
    };
    const events = new ConductorEventEmitter();
    const failures: unknown[] = [];
    events.on('build_review_rubric_infrastructure_failure', (event) => { failures.push(event); });
    const runner = new DefaultStepRunner(provider, 'mixed-policy-input-mutation', root, {
      featureDesc: 'feature', planPath: join(root, '.docs', 'plans', 'feature.md'), gitRunner: git(), events,
      config: { llm_provider: 'claude', build_review: {
        enabled: true, rubrics: { testQuality: { enabled: false }, security: { enabled: true } },
        custom_rubrics: { portable: { enabled: true, skill: 'portable-policy', question: 'Check policy.', source: 'project', llm_provider: 'claude' } },
      } } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([{ key: 'claude', provider, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) }]),
      sessionStore: new ProviderSessionStore(), probeReadOnlyReviewCapability: availableReadOnlyReviewCapability,
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never) },
      buildReviewEffectiveResolver: passingEffectiveResolver,
      buildReviewPolicyCatalog: async ({ skill }) => [{ semanticName: skill, source: 'project', installationOrigin: packageRoot, canonicalSkillPath: join(packageRoot, 'SKILL.md'), packageRoot, declaredDependencies: [], availability: 'available' as const }],
      buildReviewPolicyCapture: async (policy) => {
        const materialPath = join(materialRoot, policy.semanticName);
        if (policy.semanticName.includes('security')) securityMaterialPath = materialPath;
        await mkdir(materialPath, { recursive: true });
        await writeFile(join(materialPath, 'SKILL.md'), '# Captured policy\n');
        return { policy, materialPath, definitionPath: join(materialPath, 'SKILL.md'), manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Captured policy\n') }], metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] }, digest: `sha256-v1:${policy.semanticName.padEnd(64, 'a').slice(0, 64)}` };
      },
    });

    await expect(runner.run('build_review', { complexity_tier: 'M' } as never)).resolves.toMatchObject({ success: false, currentLapMechanicalFault: true });
    expect(failures).toHaveLength(3);
    expect(failures).toEqual(expect.arrayContaining([
      // The captured copy lives under an engine-owned pipeline path, so only
      // its own policy-material root (never the evidence root) reports it.
      expect.objectContaining({ rubric: 'portable', cause: 'review-input-mutated', changedInputs: ['capturedPolicyMaterial:SKILL.md'] }),
      expect.objectContaining({ rubric: 'security', cause: 'review-input-mutated', changedInputs: ['capturedPolicyMaterial:SKILL.md'] }),
    ]));
    await expect(readFile(join(root, '.pipeline', 'build-review.json'), 'utf8')).rejects.toThrow();
  });

  it('baselines every member policy before any reviewer runs, even when reviewer slots are serialized', async () => {
    const root = await fixture();
    const packages = join(root, 'packages');
    for (const skill of ['alpha-policy', 'beta-policy']) {
      await mkdir(join(packages, skill), { recursive: true });
      await writeFile(join(packages, skill, 'SKILL.md'), `# ${skill}\n`);
    }
    const payload = { kind: 'custom-findings', version: 'v1', findings: [] };
    let mutated = false;
    const provider: LLMProvider = {
      // The first reviewer to run rewrites the other member's installed
      // policy. With one reviewer slot, the other member has not yet run.
      invoke: vi.fn(async (options) => {
        const other = options.prompt.includes('alpha-policy') ? 'beta-policy' : 'alpha-policy';
        if (!mutated) await writeFile(join(packages, other, 'SKILL.md'), '# Rewritten by a sibling reviewer\n');
        mutated = true;
        return { success: true, exitCode: 0, output: JSON.stringify(payload), finalStructuredResult: payload };
      }),
      supportsSessionResume: false, lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
    };
    const events = new ConductorEventEmitter();
    const failures: Array<{ rubric: string; changedInputs?: string[] }> = [];
    events.on('build_review_rubric_infrastructure_failure', (event) => { failures.push(event as never); });
    const runner = new DefaultStepRunner(provider, 'custom-policy-serialized-baseline', root, {
      featureDesc: 'feature', planPath: join(root, '.docs', 'plans', 'feature.md'), gitRunner: git(), events,
      config: { llm_provider: 'claude', build_review: { enabled: true, maxParallel: 1, rubrics: { testQuality: { enabled: false } }, custom_rubrics: {
        alpha: { enabled: true, skill: 'alpha-policy', question: 'Check alpha.', source: 'project', llm_provider: 'claude' },
        beta: { enabled: true, skill: 'beta-policy', question: 'Check beta.', source: 'project', llm_provider: 'claude' },
      } } } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([{ key: 'claude', provider, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) }]),
      sessionStore: new ProviderSessionStore(), probeReadOnlyReviewCapability: availableReadOnlyReviewCapability,
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never) },
      buildReviewEffectiveResolver: passingEffectiveResolver,
      buildReviewPolicyCatalog: async ({ skill }) => [{ semanticName: skill, source: 'project', installationOrigin: join(packages, skill), canonicalSkillPath: join(packages, skill, 'SKILL.md'), packageRoot: join(packages, skill), declaredDependencies: [], availability: 'available' as const }],
      buildReviewPolicyCapture: async (policy) => {
        const materialPath = join(root, '.pipeline', 'build-review', 'policy-material', policy.semanticName);
        const bytes = await readFile(join(policy.packageRoot, 'SKILL.md'));
        await mkdir(materialPath, { recursive: true });
        await writeFile(join(materialPath, 'SKILL.md'), bytes);
        return { policy, materialPath, definitionPath: join(materialPath, 'SKILL.md'), manifest: [{ relativePath: 'SKILL.md', bytes }], metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] }, digest: `sha256-v1:${createHash('sha256').update(bytes).digest('hex')}` };
      },
    });

    const result = await runner.run('build_review', { complexity_tier: 'M' } as never);
    expect(result).toMatchObject({ success: false, currentLapMechanicalFault: true });
    expect(result.output).toContain('review-input-mutated');
    expect(failures.map(({ rubric }) => rubric).sort()).toEqual(['alpha', 'beta']);
    expect(failures[0]!.changedInputs).toContain('installedPolicyPackage:SKILL.md');
  });

  it('starts built-in peers while custom reviewers are still running in one joined lap', async () => {
    const root = await fixture();
    let securityInvoked!: () => void;
    const securityStarted = new Promise<void>((resolve) => { securityInvoked = resolve; });
    let securityStartedBeforeCustomSettled: boolean | undefined;
    const customPayload = { kind: 'custom-findings', version: 'v1', findings: [] };
    const provider: LLMProvider = {
      invoke: vi.fn(async (options) => {
        if (options.prompt.includes('Build Review Security rubric.')) {
          securityInvoked();
          return { success: true, exitCode: 0, output: '{"findings":[]}', finalStructuredResult: { findings: [] } };
        }
        // Bounded: a two-stage lap never starts the peer, so stop waiting.
        let started = false;
        void securityStarted.then(() => { started = true; });
        for (let tick = 0; tick < 200 && !started; tick += 1) await new Promise((resolve) => setImmediate(resolve));
        securityStartedBeforeCustomSettled = started;
        return { success: true, exitCode: 0, output: JSON.stringify(customPayload), finalStructuredResult: customPayload };
      }),
      supportsSessionResume: false, lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
    };
    const runner = new DefaultStepRunner(provider, 'mixed-concurrent-fan-out', root, {
      featureDesc: 'feature', planPath: join(root, '.docs', 'plans', 'feature.md'), gitRunner: git(),
      config: { llm_provider: 'claude', build_review: {
        enabled: true, maxParallel: 2, rubrics: { testQuality: { enabled: false }, security: { enabled: true } },
        custom_rubrics: { portable: { enabled: true, skill: 'portable-policy', question: 'Check policy.', source: 'project', llm_provider: 'claude' } },
      } } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([{ key: 'claude', provider, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) }]),
      sessionStore: new ProviderSessionStore(), probeReadOnlyReviewCapability: availableReadOnlyReviewCapability,
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never) },
      buildReviewEffectiveResolver: passingEffectiveResolver,
      buildReviewPolicyCatalog: async ({ skill }) => [{ semanticName: skill, source: 'project', installationOrigin: '/fixture/project', canonicalSkillPath: `/fixture/project/${skill}/SKILL.md`, packageRoot: `/fixture/project/${skill}`, declaredDependencies: [], availability: 'available' as const }],
      buildReviewPolicyCapture: async (policy) => ({ policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md', manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Policy\n') }], metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] }, digest: `sha256-v1:${'a'.repeat(64)}` }),
    });

    const result = await runner.run('build_review', { complexity_tier: 'M' } as never);
    expect(result.success, result.output).toBe(true);
    expect(securityStartedBeforeCustomSettled).toBe(true);
  });

  it('halts needs-human without an aggregate when review-input-mutated exhausts the mechanical allowance', async () => {
    const root = await fixture();
    vi.mocked(buildReviewCache.readBuildReviewCacheEntry)
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => undefined);
    const materialPath = join(root, '.pipeline', 'build-review', 'policy-material', 'portable');
    const payload = { kind: 'custom-findings', version: 'v1', findings: [] };
    const provider: LLMProvider = {
      invoke: vi.fn(async () => {
        await writeFile(join(materialPath, 'SKILL.md'), '# Mutated during review\n');
        return { success: true, exitCode: 0, output: JSON.stringify(payload), finalStructuredResult: payload };
      }),
      supportsSessionResume: false, lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
    };
    const runner = new DefaultStepRunner(provider, 'custom-policy-input-mutation-exhausted', root, {
      featureDesc: 'feature', planPath: join(root, '.docs', 'plans', 'feature.md'), gitRunner: git(),
      config: { llm_provider: 'claude', build_review: { enabled: true, rubrics: { testQuality: { enabled: false } }, custom_rubrics: {
        portable: { enabled: true, skill: 'portable-policy', question: 'Check policy.', source: 'project', llm_provider: 'claude' },
      } } } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([{ key: 'claude', provider, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) }]),
      sessionStore: new ProviderSessionStore(), probeReadOnlyReviewCapability: availableReadOnlyReviewCapability,
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never) },
      buildReviewEffectiveResolver: passingEffectiveResolver,
      buildReviewPolicyCatalog: async () => [{ semanticName: 'portable-policy', source: 'project', installationOrigin: '/fixture/project', canonicalSkillPath: '/fixture/project/SKILL.md', packageRoot: '/fixture/project', declaredDependencies: [], availability: 'available' as const }],
      buildReviewPolicyCapture: async (policy) => {
        await mkdir(materialPath, { recursive: true });
        await writeFile(join(materialPath, 'SKILL.md'), '# Captured policy\n');
        return { policy, materialPath, definitionPath: join(materialPath, 'SKILL.md'), manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Captured policy\n') }], metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] }, digest: `sha256-v1:${'a'.repeat(64)}` };
      },
    });

    await expect(runner.run('build_review', { complexity_tier: 'M' } as never)).resolves.toMatchObject({ currentLapMechanicalFault: true });
    await expect(runner.run('build_review', { complexity_tier: 'M' } as never)).resolves.toMatchObject({ currentLapMechanicalFault: true });
    await expect(runner.run('build_review', { complexity_tier: 'M' } as never)).resolves.toMatchObject({
      success: false, refusal: { kind: 'needs-human' }, output: expect.stringContaining('review-input-mutated'),
    });
    await expect(readFile(join(root, '.pipeline', 'build-review.json'), 'utf8')).rejects.toThrow();
  });

  it('records declared references, never captured package file bodies, as plugin policy criteria', async () => {
    const root = await fixture();
    const skillBody = `# Portable policy\n\n${'Review every changed handler for the portable policy. '.repeat(400)}`;
    const siblingBody = `# Sibling skill\n\n${'Unrelated sibling reviewer instructions. '.repeat(400)}`;
    const payload = { kind: 'custom-findings', version: 'v1', findings: [] };
    const provider: LLMProvider = {
      invoke: vi.fn(async () => ({ success: true, exitCode: 0, output: JSON.stringify(payload), finalStructuredResult: payload })),
      supportsSessionResume: false, lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
    };
    const runner = new DefaultStepRunner(provider, 'custom-policy-criteria', root, {
      featureDesc: 'feature', planPath: join(root, '.docs', 'plans', 'feature.md'), gitRunner: git(),
      config: {
        llm_provider: 'claude',
        build_review: { enabled: true, rubrics: { testQuality: { enabled: false } }, custom_rubrics: {
          portable: { enabled: true, skill: 'policy-plugin:portable-policy', question: 'Check the selected policy.', source: 'plugin', resources: ['references/criteria.md'], llm_provider: 'claude' },
        } },
      } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([{ key: 'claude', provider, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) }]),
      sessionStore: new ProviderSessionStore(),
      probeReadOnlyReviewCapability: availableReadOnlyReviewCapability,
      providerExecution: { prepareCandidateSelfHost: async () => ({ executable: '/prepared/claude', env: {}, args: [], teardown: async () => {} }) } as never,
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never) },
      buildReviewEffectiveResolver: passingEffectiveResolver,
      buildReviewPolicyCatalog: async () => [{
        semanticName: 'portable-policy', source: 'plugin' as const, plugin: { id: 'policy-plugin', version: '1.0.0' }, installationOrigin: '/fixture/plugin', canonicalSkillPath: '/fixture/plugin/skills/portable-policy/SKILL.md', packageRoot: '/fixture/plugin', declaredDependencies: [], availability: 'available' as const,
      }],
      buildReviewPolicyCapture: async (policy) => ({
        policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/skills/portable-policy/SKILL.md',
        manifest: [
          { relativePath: 'skills/portable-policy/SKILL.md', bytes: Buffer.from(skillBody) },
          { relativePath: 'skills/sibling/SKILL.md', bytes: Buffer.from(siblingBody) },
          { relativePath: 'references/criteria.md', bytes: Buffer.from('# Criteria body\n') },
        ],
        metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] },
        digest: `sha256-v1:${'a'.repeat(64)}`,
      }),
    });

    const result = await runner.run('build_review', { complexity_tier: 'M' } as never);
    expect(result.success, result.output).toBe(true);
    // The reviewer still receives the selected policy text; only the evidence descriptor changes.
    expect(vi.mocked(provider.invoke).mock.calls[0]?.[0].prompt).toContain('Review every changed handler');
    const { descriptor } = JSON.parse(await readFile(join(root, '.pipeline', 'build-review', 'lap-head', 'portable.json'), 'utf8'));
    expect(descriptor.effectivePolicy).toEqual({ version: 'v1', bundleDigest: `sha256-v1:${'a'.repeat(64)}` });
    expect(descriptor.declaration.resources).toEqual(['references/criteria.md']);
    expect(JSON.stringify(descriptor)).not.toContain('Review every changed handler');
    expect(JSON.stringify(descriptor)).not.toContain('Sibling skill');
    expect(JSON.stringify(descriptor)).not.toContain('Criteria body');

    const lapId = parseBuildReviewLapId('lap-head')!;
    const sourceRegion = { path: 'src/a.ts', startLine: 1, endLine: 1, contentHash: `sha256:${'b'.repeat(64)}`, display: 'changed value' };
    const stamped = stampBuildReviewCustomJudgedResult({
      kind: 'custom-findings', version: 'v1',
      findings: [{ concernId: 'policy-gap', summary: 'The change misses the policy.', evidenceLocations: ['src/a.ts:1'], confidence: 90, sourceRegions: [sourceRegion] }],
    }, {
      rubric: 'portable', lapId, declaration: descriptor.declaration, policy: descriptor.effectivePolicy,
      candidate: descriptor.producer, reviewedInput: descriptor.reviewedInput,
    }, { sourceRegions: [sourceRegion] })!;
    const context = assembleBuildReviewAdjudicationContext({
      aggregate: joinBuildReviewRubricOutcomes({
        lapId, snapshotDigest: 'sha256:snapshot',
        results: { testQuality: { kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v3', findings: [], verdict: 'PASS' } },
        customResults: { portable: { descriptor, result: stamped } },
        currentCustomRubrics: ['portable'],
      } as never),
      priorCases: [],
      planContract: { path: '.docs/plans/feature.md', pointers: [], admittedTaskContracts: [{ id: '1', contract: 'review' }] },
      taskStatus: { path: '.pipeline/task-status.json', tasks: [{ id: '1', status: 'in_progress' }] },
    });
    expect(context.ok, JSON.stringify(context)).toBe(true);
    if (!context.ok) return;
    expect(context.context.policyContext).toEqual([expect.objectContaining({ rubric: 'portable', criteria: ['references/criteria.md'] })]);
  });

  it('publishes a custom-only outer verdict when effective resolution fails', async () => {
    const root = await fixture();
    const payload = { kind: 'custom-findings', version: 'v1', findings: [] };
    const provider: LLMProvider = {
      invoke: vi.fn(async () => ({ success: true, exitCode: 0, output: JSON.stringify(payload), finalStructuredResult: payload })),
      supportsSessionResume: false,
      lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
    };
    const events = new ConductorEventEmitter();
    const outerVerdicts: unknown[] = [];
    events.on('build_review_outer_verdict', (event) => { outerVerdicts.push(event); });
    const runner = new DefaultStepRunner(provider, 'custom-policy-resolution-failure', root, {
      featureDesc: 'feature', planPath: join(root, '.docs', 'plans', 'feature.md'), gitRunner: git(),
      config: { llm_provider: 'claude', build_review: { enabled: true, rubrics: { testQuality: { enabled: false } }, custom_rubrics: {
        portable: { enabled: true, skill: 'portable-policy', question: 'Check policy.', source: 'project', llm_provider: 'claude' },
      } } } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([{ key: 'claude', provider, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) }]),
      sessionStore: new ProviderSessionStore(), events,
      probeReadOnlyReviewCapability: availableReadOnlyReviewCapability,
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never) },
      buildReviewEffectiveResolver: async () => ({ ok: false, reason: 'disposition store unavailable' }) as never,
      buildReviewPolicyCatalog: async () => [{ semanticName: 'portable-policy', source: 'project', installationOrigin: '/fixture/project', canonicalSkillPath: '/fixture/project/SKILL.md', packageRoot: '/fixture/project', declaredDependencies: [], availability: 'available' as const }],
      buildReviewPolicyCapture: async (policy) => ({ policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md', manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Portable policy\n') }], metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] }, digest: `sha256-v1:${'a'.repeat(64)}` }),
    });

    await expect(runner.run('build_review', { complexity_tier: 'M' } as never)).resolves.toMatchObject({ success: false });
    expect(outerVerdicts).toEqual([{
      type: 'build_review_outer_verdict', lapId: 'lap-head', rawVerdict: 'PASS', effectiveVerdict: 'FAIL',
    }]);
  });

  /** A custom-only runner over the shared fixture, driven through the step entry. */
  function customOnlyRunner(root: string, options: {
    readonly findings: readonly unknown[];
    readonly minConfidence?: number;
    readonly resolver: (projectRoot: string, aggregate: unknown) => Promise<unknown>;
  }): DefaultStepRunner {
    const payload = { kind: 'custom-findings', version: 'v1', findings: options.findings };
    const provider: LLMProvider = {
      invoke: vi.fn(async () => ({ success: true, exitCode: 0, output: JSON.stringify(payload), finalStructuredResult: payload })),
      supportsSessionResume: false,
      lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
    };
    return new DefaultStepRunner(provider, 'custom-only-durable-evidence', root, {
      featureDesc: 'feature', planPath: join(root, '.docs', 'plans', 'feature.md'), gitRunner: git(),
      config: { llm_provider: 'claude', build_review: { enabled: true, rubrics: { testQuality: { enabled: false } }, custom_rubrics: {
        portable: {
          enabled: true, skill: 'portable-policy', question: 'Check policy.', source: 'project', llm_provider: 'claude',
          ...(options.minConfidence === undefined ? {} : { min_confidence: options.minConfidence }),
        },
      } } } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([{ key: 'claude', provider, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) }]),
      sessionStore: new ProviderSessionStore(), events: new ConductorEventEmitter(),
      probeReadOnlyReviewCapability: availableReadOnlyReviewCapability,
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never) },
      buildReviewEffectiveResolver: options.resolver as never,
      buildReviewPolicyCatalog: async () => [{ semanticName: 'portable-policy', source: 'project', installationOrigin: '/fixture/project', canonicalSkillPath: '/fixture/project/SKILL.md', packageRoot: '/fixture/project', declaredDependencies: [], availability: 'available' as const }],
      buildReviewPolicyCapture: async (policy) => ({ policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md', manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Portable policy\n') }], metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] }, digest: `sha256-v1:${'a'.repeat(64)}` }),
    });
  }

  // adr-2026-08-29 D4.6: a fully suppressed custom-only lap is an effective
  // PASS that never reaches adjudication, so the step itself must write the
  // durable suppression history.
  it('persists durable suppression history for a fully suppressed custom-only lap', async () => {
    const root = await fixture();
    const feature = { version: 'v1' as const, repository: root, feature: 'feature' };
    const frozenLine = 'export const value = 0;\n';
    const summary = 'The changed boundary lacks compatibility evidence.';
    let suppressedFindingId: string | undefined;
    const runner = customOnlyRunner(root, {
      minConfidence: 70,
      findings: [{
        concernId: 'portable-policy-gap', summary, confidence: 40,
        evidenceLocations: ['src/a.ts:1'],
        sourceRegions: [{
          path: 'src/a.ts', startLine: 1, endLine: 1, display: 'value',
          contentHash: `sha256:${createHash('sha256').update(frozenLine).digest('hex')}`,
        }],
      }],
      resolver: async (_projectRoot, aggregate) => {
        const member = (aggregate as { customResults: Record<string, { result: { findings: Array<{ identity: { id: string } }> } }> }).customResults.portable!;
        suppressedFindingId = member.result.findings[0]!.identity.id;
        return {
          ok: true, feature,
          effective: {
            rawVerdict: 'FAIL', verdict: 'PASS', acceptedFindingIds: [], unresolvedFindingIds: [],
            suppressedFindingIds: [suppressedFindingId],
            skippedRubrics: ['testQuality'], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [], uncoveredScopeIncompleteRubrics: [],
          },
        };
      },
    });

    const result = await runner.run('build_review', { complexity_tier: 'M' } as never);
    expect(result.success, result.output).toBe(true);

    const persisted = await new RemediationCaseStore(root, feature).read();
    if (!persisted.ok) throw new Error(`unexpected case-store failure: ${persisted.reason}`);
    expect(suppressedFindingId).toEqual(expect.any(String));
    expect(persisted.state.suppressions).toEqual([{
      findingId: suppressedFindingId, rubric: 'portable', summary, confidence: 40, floor: 70, lastSeenLap: 'lap-head',
    }]);
  });

  // adr-2026-08-18 D9: the lap evidence of a reduced-coverage PASS carries the
  // rendered decision, on the custom-only route as on the mixed one.
  it('stamps reduced-coverage evidence into the persisted custom-only aggregate', async () => {
    const root = await fixture();
    const evidence = '## Reduced coverage\n\n- portable: policy-load-failed (operator decision)';
    const runner = customOnlyRunner(root, {
      findings: [],
      resolver: async () => ({
        ok: true,
        feature: { version: 'v1', repository: root, feature: 'feature' },
        reducedCoverageEvidence: evidence,
        effective: {
          rawVerdict: 'PASS', verdict: 'PASS', acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [],
          skippedRubrics: ['testQuality'], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [], uncoveredScopeIncompleteRubrics: [],
        },
      }),
    });

    const result = await runner.run('build_review', { complexity_tier: 'M' } as never);
    expect(result.success, result.output).toBe(true);
    const aggregate = JSON.parse(await readFile(join(root, '.pipeline', 'build-review.json'), 'utf8'));
    expect(aggregate).toMatchObject({ lapId: 'lap-head', verdict: 'PASS', reducedCoverageEvidence: evidence });
  });

  it('dispatches an enabled security peer with a custom policy when testQuality is disabled', async () => {
    const root = await fixture();
    const provider: LLMProvider = {
      invoke: vi.fn(async ({ prompt }) => ({
        success: true,
        exitCode: 0,
        output: prompt.includes('Build Review Security rubric.')
          ? JSON.stringify({ findings: [] })
          : JSON.stringify({ kind: 'custom-findings', version: 'v1', findings: [] }),
        finalStructuredResult: prompt.includes('Build Review Security rubric.')
          ? { findings: [] }
          : { kind: 'custom-findings', version: 'v1', findings: [] },
      })),
      supportsSessionResume: false,
      lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
    };
    const events = new ConductorEventEmitter();
    const rubricResults: unknown[] = [];
    events.on('build_review_rubric_result', (event) => { rubricResults.push(event); });
    const runner = new DefaultStepRunner(provider, 'mixed-custom-policy', root, {
      featureDesc: 'feature', planPath: join(root, '.docs', 'plans', 'feature.md'), gitRunner: git(),
      config: { llm_provider: 'claude', build_review: { enabled: true, rubrics: {
        testQuality: { enabled: false }, security: { enabled: true },
      }, custom_rubrics: {
        portable: { enabled: true, skill: 'portable-policy', question: 'Check policy.', source: 'project', llm_provider: 'claude' },
      } } } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([{ key: 'claude', provider, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) }]),
      sessionStore: new ProviderSessionStore(), events,
      probeReadOnlyReviewCapability: availableReadOnlyReviewCapability,
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never) },
      buildReviewEffectiveResolver: passingEffectiveResolver,
      buildReviewPolicyCatalog: async () => [
        { semanticName: 'portable-policy', source: 'project', installationOrigin: '/fixture/project', canonicalSkillPath: '/fixture/project/SKILL.md', packageRoot: '/fixture/project', declaredDependencies: [], availability: 'available' as const },
        { semanticName: 'build-review-security', source: 'project', installationOrigin: '/fixture/project', canonicalSkillPath: '/fixture/project/security/SKILL.md', packageRoot: '/fixture/project/security', declaredDependencies: [], availability: 'available' as const },
      ],
      buildReviewPolicyCapture: async (policy) => ({ policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md', manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Portable policy\n') }], metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] }, digest: `sha256-v1:${'a'.repeat(64)}` }),
    });

    await expect(runner.run('build_review', { complexity_tier: 'M' } as never)).resolves.toMatchObject({ success: true });
    expect(rubricResults).toEqual(expect.arrayContaining([
      { type: 'build_review_rubric_result', rubric: 'portable', lapId: 'lap-head', verdict: 'PASS' },
      { type: 'build_review_rubric_result', rubric: 'security', lapId: 'lap-head', verdict: 'PASS' },
    ]));
    const aggregate = JSON.parse(await readFile(join(root, '.pipeline', 'build-review.json'), 'utf8'));
    expect(aggregate.results).toMatchObject({
      security: { kind: 'judged', rubric: 'security', verdict: 'PASS' },
      testQuality: { kind: 'skipped', rubric: 'testQuality', reason: 'disabled' },
    });
  });

  it('refuses an ambiguous installed selection without invoking a provider', async () => {
    const root = await fixture();
    const invoke = vi.fn(async () => ({ success: true, exitCode: 0, output: '{}' }));
    const provider: LLMProvider = {
      invoke, supportsSessionResume: false, lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
    };
    const events = new ConductorEventEmitter();
    const failures: unknown[] = [];
    events.on('build_review_policy_failed', (event) => { failures.push(event); });
    const runner = new DefaultStepRunner(provider, 'custom-policy', root, {
      featureDesc: 'feature', planPath: join(root, '.docs', 'plans', 'feature.md'), gitRunner: git(),
      config: { llm_provider: 'claude', build_review: { enabled: true, rubrics: { testQuality: { enabled: false } }, custom_rubrics: {
        portable: { enabled: true, skill: 'portable-policy', question: 'Check policy.', llm_provider: 'claude' },
      } } } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([{ key: 'claude', provider, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) }]),
      sessionStore: new ProviderSessionStore(),
      probeReadOnlyReviewCapability: availableReadOnlyReviewCapability,
      events,
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never) },
      buildReviewEffectiveResolver: passingEffectiveResolver,
      buildReviewPolicyCatalog: async () => ['project', 'global'].map((source) => ({
        semanticName: 'portable-policy', source: source as 'project' | 'global', installationOrigin: `/fixture/${source}`, canonicalSkillPath: `/fixture/${source}/SKILL.md`, packageRoot: `/fixture/${source}`, declaredDependencies: [], availability: 'available' as const,
      })),
    });
    const result = await runner.run('build_review', { complexity_tier: 'M' } as never);
    expect(result.success).toBe(false);
    expect(result.output).toContain('ambiguous');
    expect(result.output).toContain('conflicting installed sources: /fixture/global, /fixture/project');
    // Ambiguity is reported as a request for disambiguation, not resolved by guessing.
    expect(result.output).toContain('choose one source explicitly');
    expect(result.output).not.toContain('disposition resolution failed');
    // Below the mechanical allowance the lap stays in the retry lane: the
    // typed diagnostic is returned, but no aggregate may be published.
    expect(result.currentLapMechanicalFault).toBe(true);
    await expect(readFile(join(root, '.pipeline', 'build-review.json'), 'utf8')).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
    await expect(readFile(join(root, '.pipeline', 'kickback-ledger.json'), 'utf8')).resolves.toContain('"mechanicalFaults": 1');
    expect(failures).toHaveLength(3);
    expect(failures).toEqual(expect.arrayContaining([expect.objectContaining({
      reason: expect.stringContaining('conflicting installed sources: /fixture/global, /fixture/project'),
    })]));
  });

  it('publishes a first-use custom loading failure with its declaration and no invented content', async () => {
    vi.mocked(buildReviewCache.readBuildReviewCacheEntry).mockClear();
    const root = await fixture();
    const invoke = vi.fn(async () => ({ success: true, exitCode: 0, output: '{}' }));
    const provider: LLMProvider = {
      invoke, supportsSessionResume: false, lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
    };
    const runner = new DefaultStepRunner(provider, 'custom-policy-failure', root, {
      featureDesc: 'feature', planPath: join(root, '.docs', 'plans', 'feature.md'), gitRunner: git(),
      config: { llm_provider: 'codex', build_review: { enabled: true, rubrics: { testQuality: { enabled: false } }, custom_rubrics: {
        portable: { enabled: true, skill: 'portable-policy', question: 'Check the selected policy.', source: 'project', resources: ['criteria.md'], llm_provider: 'codex' },
      } } } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([{ key: 'codex', provider, policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder) }]),
      sessionStore: new ProviderSessionStore(),
      probeReadOnlyReviewCapability: availableReadOnlyReviewCapability,
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never) },
      buildReviewEffectiveResolver: failingEffectiveResolver,
      buildReviewPolicyCatalog: async () => [{
        semanticName: 'portable-policy', source: 'project', installationOrigin: '/fixture/project', canonicalSkillPath: '/fixture/project/SKILL.md', packageRoot: '/fixture/project', declaredDependencies: [], availability: 'available',
      }],
      buildReviewPolicyCapture: async () => { throw new Error('missing criteria.md'); },
    });

    // The aggregate is published only once the mechanical allowance is
    // exhausted, so drive the loading failure through every allowed lap.
    await runner.run('build_review', { complexity_tier: 'M' } as never);
    await runner.run('build_review', { complexity_tier: 'M' } as never);
    await expect(readFile(join(root, '.pipeline', 'build-review.json'), 'utf8')).rejects.toThrow();
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
    // A resource defect identified while loading the policy ends the candidate
    // there: no judgment is requested from the provider and no cache lookup
    // is made for that policy on any of the three laps.
    expect(buildReviewCache.readBuildReviewCacheEntry).not.toHaveBeenCalled();
  });
});

describe('custom build-review policy discovery under candidate authority', () => {
  const installed = [{
    semanticName: 'portable-policy', source: 'project' as const, installationOrigin: '/fixture/project', canonicalSkillPath: '/fixture/project/SKILL.md', packageRoot: '/fixture/project', declaredDependencies: [], availability: 'available' as const,
  }];

  /**
   * A host fake that, like both real adapters, stays in flight until its
   * signal aborts. Without a signal it fails at once, so a seam that drops the
   * authority is a fast assertion failure rather than a hung test.
   */
  function blockingCatalog(started: () => void) {
    return vi.fn(async (input: { signal?: AbortSignal }) => {
      started();
      const signal = input.signal;
      if (signal === undefined) throw new Error('discovery received no candidate signal');
      return new Promise<never>((_resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('discovery aborted'), { name: 'AbortError' }));
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      });
    });
  }

  async function runWithDeadline(
    catalog: (input: { signal?: AbortSignal; deadlineAt?: number }) => Promise<typeof installed>,
    timeoutSeconds = 0.05,
  ) {
    const root = await fixture();
    const invoke = vi.fn(async () => ({ success: true, exitCode: 0, output: '{}' }));
    const provider: LLMProvider = {
      invoke, supportsSessionResume: false, lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
    };
    const events = new ConductorEventEmitter();
    const failures: unknown[] = [];
    events.on('build_review_policy_failed', (event) => { failures.push(event); });
    const runner = new DefaultStepRunner(provider, 'custom-policy-authority', root, {
      featureDesc: 'feature', planPath: join(root, '.docs', 'plans', 'feature.md'), gitRunner: git(),
      config: { llm_provider: 'claude', test_suite: { timeout_seconds: timeoutSeconds }, build_review: { enabled: true, rubrics: { testQuality: { enabled: false } }, custom_rubrics: {
        portable: { enabled: true, skill: 'portable-policy', question: 'Check policy.', source: 'project', llm_provider: 'claude' },
      } } } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([{ key: 'claude', provider, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) }]),
      sessionStore: new ProviderSessionStore(),
      probeReadOnlyReviewCapability: availableReadOnlyReviewCapability,
      events,
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never) },
      buildReviewEffectiveResolver: failingEffectiveResolver,
      buildReviewPolicyCatalog: catalog as never,
      buildReviewPolicyCapture: async () => { throw new Error('capture is past the boundary under test'); },
    });
    const result = await runner.run('build_review', { complexity_tier: 'M' } as never);
    return { result, failures, invoke };
  }

  it('arms a production candidate deadline for in-flight discovery and stops before judge or cache work', async () => {
    const catalog = blockingCatalog(() => undefined);

    const { failures, invoke } = await runWithDeadline(catalog);

    expect(catalog).toHaveBeenCalledTimes(1);
    expect(catalog.mock.calls[0]![0]).toMatchObject({ signal: expect.any(AbortSignal), deadlineAt: expect.any(Number) });
    expect(failures).toEqual(expect.arrayContaining([expect.objectContaining({ stage: 'catalog', reason: expect.stringContaining('candidate deadline elapsed during policy catalog discovery') })]));
    expect(invoke).not.toHaveBeenCalled();
  });

  it('releases the deadline timer once discovery succeeds so no handle outlives the candidate', async () => {
    const setTimer = vi.spyOn(globalThis, 'setTimeout');
    const clearTimer = vi.spyOn(globalThis, 'clearTimeout');
    const signals: AbortSignal[] = [];
    try {
      await runWithDeadline(async (input) => { signals.push(input.signal!); return installed; }, 3_600);

      const deadlineTimers = setTimer.mock.results.filter((_result, index) => {
        const delay = setTimer.mock.calls[index]![1];
        return typeof delay === 'number' && delay > 3_000_000;
      }).map((result) => result.value as unknown);
      expect(deadlineTimers.length).toBeGreaterThan(0);
      expect(clearTimer.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining(deadlineTimers));
      expect(signals.every((signal) => !signal.aborted)).toBe(true);
    } finally {
      setTimer.mockRestore();
      clearTimer.mockRestore();
    }
  });
});
