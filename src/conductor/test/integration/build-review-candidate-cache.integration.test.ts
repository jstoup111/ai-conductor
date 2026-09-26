// Covers: task:19
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { coordinateBuildReviewRubrics } from '../../src/engine/build-review-coordinator.js';
import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY, CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { HarnessConfig } from '../../src/types/config.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(process.env.TMPDIR!, 'candidate-cache-runner-'));
  roots.push(root);
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'test'), { recursive: true });
  await writeFile(join(root, '.docs', 'plans', 'feature.md'), '# Plan\n\n### Task 1: review\n**Files:** src/a.ts\n');
  await writeFile(join(root, 'src', 'a.ts'), 'export const value = 1;\n');
  await writeFile(join(root, 'test', 'a.test.ts'), 'export const value = 1;\n');
  return root;
}

function git() {
  return async (args: string[]) => {
    if (args[0] === 'symbolic-ref') return { exitCode: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' };
    if (args[0] === 'rev-parse') return { exitCode: 0, stdout: 'head\n', stderr: '' };
    if (args[0] === 'merge-base') return { exitCode: 0, stdout: 'base\n', stderr: '' };
    if (args[0] === 'diff' && args.includes('--name-status')) return { exitCode: 0, stdout: 'M\u0000src/a.ts\u0000M\u0000test/a.test.ts\u0000', stderr: '' };
    if (args[0] === 'diff') return { exitCode: 0, stdout: 'diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts\n', stderr: '' };
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

function builtInInputs() {
  const source = {
    diff: 'diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts',
    planBody: '# Plan\n', repairContext: [], removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] },
  };
  return {
    ...source, mergeBase: 'base', baseRef: 'origin/main', baseKind: 'remote', trackingRefSha: 'base', remoteHeadSha: 'base', fresh: true,
    testSuiteProof: { provenanceHeadSha: 'head', outcome: 'PASS' },
    sourceSnapshot: {
      digest: 'sha256:snapshot',
      contentDigest: `sha256:${createHash('sha256').update(JSON.stringify(source)).digest('hex')}`,
      baseRef: 'origin/main', mergeBase: 'base', headSha: 'head', ...source,
      testQuality: { inScopeTests: ['test/a.test.ts'], counterfactualFileSelectors: ['test/a.test.ts'], unresolvedMarkers: [] },
    },
  } as never;
}

describe('build-review candidate cache runner ordering', () => {
  it('publishes a cache-write-failed built-in outcome rather than discarding a judged member', async () => {
    const lapId = parseBuildReviewLapId('lap-cache-write-failure')!;
    const events: string[] = [];
    const coordination = await coordinateBuildReviewRubrics({
      config: {
        enabled: true, maxParallel: 1,
        rubrics: { testQuality: { enabled: true, llm_provider: 'codex', model: 'gpt-5.6-sol', model_fallback_ladder: ['gpt-5.6-sol'], max_retries: 1, escalate: false } },
        catalog: [{ id: 'testQuality', kind: 'builtin', skillName: 'build-review-test-quality', policy: { enabled: true, llm_provider: 'codex', model: 'gpt-5.6-sol', model_fallback_ladder: ['gpt-5.6-sol'], max_retries: 1, escalate: false } }],
      } as never,
      inputs: builtInInputs(),
      lapId,
      engineIdentity: { engineStamp: 'stamp', skillDigests: { testQuality: { kind: 'resolved', digest: 'sha256:skill' } } },
      preflight: async () => undefined as never,
      projections: {
        testQuality: {
          rubric: 'testQuality', contractVersion: 'v3', projectionVersion: 'v3', lapId,
          snapshotDigest: 'sha256:snapshot', digest: 'sha256:projection', mergeBase: 'base', headSha: 'head',
          changedFiles: [], removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] },
          changedTestSelectors: [], testSuiteProof: {}, revertedProductionManifest: [], preflight: {}, repairContext: [],
        },
      } as never,
      readCache: async () => undefined,
      dispatchModel: async () => ({ kind: 'cache-write-failed', detail: 'rename denied' }),
      writeArtifact: async () => { throw new Error('a cache failure must not publish a judged artifact'); },
      writeCache: async () => { throw new Error('candidate cache owns this write'); },
      emit: async (event) => { if (event.type === 'build_review_rubric_infrastructure_failure') events.push(event.reason); },
    });

    expect(coordination).toMatchObject({
      kind: 'ready',
      branches: [
        { kind: 'infrastructure-failure', rubric: 'testQuality', reason: 'cache-write-failed', detail: 'rename denied' },
        { kind: 'skipped', rubric: 'security', reason: 'disabled' },
      ],
    });
    expect(events).toEqual(['cache-write-failed']);
  });

  it('resolves the prepared provider candidate before its model ladder judges', async () => {
    const root = await fixture();
    const preparedHome = join(root, 'prepared-codex-home');
    const catalogHomes: string[] = [];
    const payload = { kind: 'custom-findings', version: 'v1', findings: [] };
    const invoke = vi.fn(async (options: { model?: string }) => options.model === 'gpt-5.6-sol'
      ? { success: false, exitCode: 1, output: 'model unavailable', modelUnavailable: true }
      : { success: true, exitCode: 0, output: JSON.stringify(payload), finalStructuredResult: payload });
    const provider: LLMProvider = {
      invoke, supportsSessionResume: false, lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
    };
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
      probeReadOnlyReviewCapability: async ({ provider: providerKey, platform }) => ({ provider: providerKey, platform, status: 'available' as const }),
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
    // The fallback candidate that actually judged reports its own producing
    // identity, and it reviewed under the same declaration as the preferred
    // candidate would have, not a borrowed or re-resolved one.
    const branchArtifact = JSON.parse(await readFile(join(root, '.pipeline', 'build-review', 'lap-head', 'portable.json'), 'utf8'));
    expect(branchArtifact).toMatchObject({
      descriptor: {
        semanticSkill: 'portable-policy',
        declaration: { rubricId: 'portable', semanticSkill: 'portable-policy', question: 'Check the selected policy.' },
        producer: { provider: 'codex', model: 'gpt-5.6-terra' },
      },
      result: { kind: 'judged', candidate: { provider: 'codex', model: 'gpt-5.6-terra' } },
    });
    expect(branchArtifact.descriptor.producer.model).not.toBe('gpt-5.6-sol');

    // The preferred model still proves unavailable, then the fallback rung
    // independently reuses only its own warm judgment.
    const replay = await runner.run('build_review', { complexity_tier: 'M' } as never);
    expect(replay.success, replay.output).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(invoke.mock.calls.map(([options]) => options.model)).toEqual([
      'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-sol',
    ]);
  });

  it.each([
    ['lacks the selected policy', [] as const, 'absent'],
    ['resolves the selected policy ambiguously', ['project', 'global'] as const, 'ambiguous'],
  ])('reports failed policy coverage when the fallback provider %s instead of borrowing the preferred policy', async (_label, fallbackSources, code) => {
    const root = await fixture();
    const codexInvoke = vi.fn(async () => ({ success: false, exitCode: 127, output: 'codex unavailable', providerUnavailable: true, providerUnavailableScope: 'run' as const, providerUnavailableReason: 'codex unavailable' }));
    const claudeInvoke = vi.fn(async () => ({ success: true, exitCode: 0, output: JSON.stringify({ kind: 'custom-findings', version: 'v1', findings: [] }) }));
    const codex: LLMProvider = {
      invoke: codexInvoke, supportsSessionResume: false, lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
    };
    const claude: LLMProvider = {
      invoke: claudeInvoke, supportsSessionResume: false, lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
    };
    const runtimes = new ProviderRuntimeSet([
      { key: 'codex', provider: codex, policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder) },
      { key: 'claude', provider: claude, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) },
    ]);
    const events = new ConductorEventEmitter();
    const failures: unknown[] = [];
    events.on('build_review_policy_failed', (event) => { failures.push(event); });
    const installed = (source: 'project' | 'global') => ({
      semanticName: 'portable-policy', source, installationOrigin: `/fixture/${source}`, canonicalSkillPath: `/fixture/${source}/SKILL.md`, packageRoot: `/fixture/${source}`, declaredDependencies: [], availability: 'available' as const,
    });
    const catalog = vi.fn(async ({ provider }: { provider: string }) => provider === 'codex'
      ? [installed('project')]
      : fallbackSources.map((source) => installed(source)));
    const runner = new DefaultStepRunner(codex, 'candidate-fallback-coverage', root, {
      featureDesc: 'feature', planPath: join(root, '.docs', 'plans', 'feature.md'), gitRunner: git(),
      config: { llm_provider: ['codex', 'claude'], build_review: { enabled: true, rubrics: { testQuality: { enabled: false } }, custom_rubrics: {
        portable: { enabled: true, skill: 'portable-policy', question: 'Check the selected policy.', llm_provider: ['codex', 'claude'] },
      } } } as HarnessConfig,
      providerRuntimes: runtimes, sessionStore: new ProviderSessionStore(), events,
      probeReadOnlyReviewCapability: async ({ provider: providerKey, platform }) => ({ provider: providerKey, platform, status: 'available' as const }),
      providerExecution: { configuredProviders: ['codex', 'claude'], runtimes, sessions: new ProviderSessionStore(), prepareCandidateSelfHost: async () => ({ executable: 'provider', env: {}, args: [], teardown: async () => {} }) },
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never) },
      buildReviewEffectiveResolver: passingEffectiveResolver,
      buildReviewPolicyCatalog: catalog as never,
      buildReviewPolicyCapture: async (policy) => ({ policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md', manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Portable policy\n') }], metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] }, digest: `sha256-v1:${'a'.repeat(64)}` }),
    });

    const result = await runner.run('build_review', { complexity_tier: 'M' } as never);

    // The fallback resolves the policy for itself and reports its own failed
    // coverage; it never judges under the preferred provider's resolution.
    expect(new Set(catalog.mock.calls.map(([input]) => input.provider))).toEqual(new Set(['codex', 'claude']));
    expect(result.success).toBe(false);
    expect(result.output).toContain(`Installed build-review policy portable-policy is unavailable: ${code}`);
    expect(failures).toEqual(expect.arrayContaining([expect.objectContaining({ provider: 'claude', stage: 'catalog', reason: expect.stringContaining(code) })]));
    expect(claudeInvoke).not.toHaveBeenCalled();
    const branchArtifact = JSON.parse(await readFile(join(root, '.pipeline', 'build-review', 'lap-head', 'portable.json'), 'utf8'));
    expect(branchArtifact).toMatchObject({ rubric: 'portable', result: { kind: 'infrastructure-failure', reason: 'policy-load-failed' } });
    expect(branchArtifact).not.toHaveProperty('descriptor');
  });

  it('publishes one discard when an actual candidate reloads the policy under a new bundle digest', async () => {
    const root = await fixture();
    const payload = { kind: 'custom-findings', version: 'v1', findings: [] };
    const invoke = vi.fn(async () => ({ success: true, exitCode: 0, output: JSON.stringify(payload), finalStructuredResult: payload }));
    const provider: LLMProvider = {
      invoke, supportsSessionResume: false, lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
    };
    const runtimes = new ProviderRuntimeSet([{ key: 'codex', provider, policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder) }]);
    const events = new ConductorEventEmitter();
    const discarded: unknown[] = [];
    events.on('build_review_cache_discarded', (event) => { discarded.push(event); });
    let digest = `sha256-v1:${'a'.repeat(64)}`;
    const runner = new DefaultStepRunner(provider, 'candidate-cache-discard', root, {
      featureDesc: 'feature', planPath: join(root, '.docs', 'plans', 'feature.md'), gitRunner: git(),
      config: { llm_provider: 'codex', build_review: { enabled: true, rubrics: { testQuality: { enabled: false } }, custom_rubrics: {
        portable: { enabled: true, skill: 'portable-policy', question: 'Check the selected policy.', source: 'project', llm_provider: 'codex' },
      } } } as HarnessConfig,
      providerRuntimes: runtimes, sessionStore: new ProviderSessionStore(), events,
      probeReadOnlyReviewCapability: async ({ provider: providerKey, platform }) => ({ provider: providerKey, platform, status: 'available' as const }),
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never) },
      buildReviewEffectiveResolver: passingEffectiveResolver,
      buildReviewPolicyCatalog: async () => [{ semanticName: 'portable-policy', source: 'project', installationOrigin: '/fixture/project', canonicalSkillPath: '/fixture/project/SKILL.md', packageRoot: '/fixture/project', declaredDependencies: [], availability: 'available' as const }],
      buildReviewPolicyCapture: async (policy) => ({ policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md', manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Portable policy\n') }], metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] }, digest }),
    });

    await expect(runner.run('build_review', { complexity_tier: 'M' } as never)).resolves.toMatchObject({ success: true });
    digest = `sha256-v1:${'b'.repeat(64)}`;
    await expect(runner.run('build_review', { complexity_tier: 'M' } as never)).resolves.toMatchObject({ success: true });

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(discarded).toEqual([expect.objectContaining({ rubric: 'portable', reason: 'skill-digest-mismatch' })]);
  });

  it('bounds built-in installed-policy discovery at the production candidate deadline', async () => {
    const root = await fixture();
    const invoke = vi.fn(async () => ({ success: true, exitCode: 0, output: '{}' }));
    const provider: LLMProvider = {
      invoke, supportsSessionResume: false, lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
    };
    const runtimes = new ProviderRuntimeSet([{ key: 'codex', provider, policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder) }]);
    const catalog = vi.fn(async ({ signal }: { signal?: AbortSignal }) => new Promise<never>((_resolve, reject) => {
      if (signal === undefined) throw new Error('built-in discovery received no candidate signal');
      signal.addEventListener('abort', () => reject(new Error('built-in discovery aborted')), { once: true });
    }));
    const runner = new DefaultStepRunner(provider, 'builtin-policy-deadline', root, {
      featureDesc: 'feature', planPath: join(root, '.docs', 'plans', 'feature.md'), gitRunner: git(),
      config: { llm_provider: 'codex', test_suite: { timeout_seconds: 0.05 }, build_review: { enabled: true, rubrics: { testQuality: { enabled: true, llm_provider: 'codex' } } } } as HarnessConfig,
      providerRuntimes: runtimes, sessionStore: new ProviderSessionStore(),
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never) },
      buildReviewEffectiveResolver: passingEffectiveResolver, buildReviewPolicyCatalog: catalog as never,
    });

    await (runner as never as { dispatchBuildReviewRubric: (...args: unknown[]) => Promise<unknown> }).dispatchBuildReviewRubric(
      { rubric: 'testQuality', skillName: 'build-review-test-quality', policy: { enabled: true, llm_provider: 'codex', model: 'gpt-5.6-sol', effort: 'medium', model_fallback_ladder: ['gpt-5.6-sol'], max_retries: 1, escalate: false, min_confidence: 0 } },
      { rubric: 'testQuality', contractVersion: 'v3', projectionVersion: 'v3', lapId: 'lap-deadline', snapshotDigest: 'sha256:snapshot', digest: 'sha256:projection', mergeBase: 'base', headSha: 'head', changedFiles: [], repairContext: [], removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] }, changedTestSelectors: [], testSuiteProof: {}, revertedProductionManifest: [], preflight: {} },
      'M', {}, builtInInputs(), { engineStamp: 'stamp', skillDigests: { testQuality: { kind: 'unavailable', path: 'skills/build-review-test-quality/SKILL.md' } } },
    );

    expect(catalog).toHaveBeenCalledOnce();
    expect(catalog.mock.calls[0]![0]).toMatchObject({ signal: expect.any(AbortSignal), deadlineAt: expect.any(Number) });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('loads, captures, judges, and caches the actual built-in candidate policy despite unavailable harness-root evidence', async () => {
    const root = await fixture();
    const payload = { findings: [], scopeResolutions: [], counterfactualSensitivity: 'indeterminate' };
    const invoke = vi.fn(async () => ({ success: true, exitCode: 0, output: JSON.stringify(payload), finalStructuredResult: payload }));
    const provider: LLMProvider = {
      invoke, supportsSessionResume: false, lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
    };
    const runtimes = new ProviderRuntimeSet([{ key: 'codex', provider, policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder) }]);
    const catalog = vi.fn(async () => [{ semanticName: 'build-review-test-quality', source: 'project', installationOrigin: '/fixture/project', canonicalSkillPath: '/fixture/project/SKILL.md', packageRoot: '/fixture/project', declaredDependencies: [], availability: 'available' as const }]);
    const capture = vi.fn(async (policy) => ({ policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md', manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Built-in policy\n') }], metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] }, digest: `sha256-v1:${'a'.repeat(64)}` }));
    const runner = new DefaultStepRunner(provider, 'builtin-policy-local', root, {
      featureDesc: 'feature', planPath: join(root, '.docs', 'plans', 'feature.md'), gitRunner: git(), config: { llm_provider: 'codex' } as HarnessConfig,
      providerRuntimes: runtimes, sessionStore: new ProviderSessionStore(), buildReviewPolicyCatalog: catalog as never, buildReviewPolicyCapture: capture as never,
    });

    const settled = await (runner as never as { dispatchBuildReviewRubric: (...args: unknown[]) => Promise<unknown> }).dispatchBuildReviewRubric(
      { rubric: 'testQuality', skillName: 'build-review-test-quality', policy: { enabled: true, llm_provider: 'codex', model: 'gpt-5.6-sol', effort: 'medium', model_fallback_ladder: ['gpt-5.6-sol'], max_retries: 1, escalate: false, min_confidence: 0 } },
      { rubric: 'testQuality', contractVersion: 'v3', projectionVersion: 'v3', lapId: 'lap-local-policy', snapshotDigest: 'sha256:snapshot', digest: 'sha256:projection', mergeBase: 'base', headSha: 'head', changedFiles: [], repairContext: [], removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] }, changedTestSelectors: [], testSuiteProof: {}, revertedProductionManifest: [], preflight: {} },
      'M', {}, builtInInputs(), { engineStamp: 'stamp', skillDigests: { testQuality: { kind: 'unavailable', path: 'skills/build-review-test-quality/SKILL.md' } } },
    );

    expect(settled).toMatchObject({ kind: 'judged' });
    expect(catalog).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledOnce();
  });
});
