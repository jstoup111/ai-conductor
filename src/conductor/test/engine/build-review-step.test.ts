// Covers: task:2, task:4
// Covers: task:9, task:10
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultStepRunner, dispatchRubricContract, type StepRunnerOptions } from '../../src/engine/step-runners.js';
import { classifyRetryDecision } from '../../src/engine/artifacts.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';
import { dispatchBuildReviewRecordReducedCoverage } from '../../src/engine/build-review-cli.js';
import { resolveEffectiveBuildReviewVerdict } from '../../src/engine/build-review-effective.js';
import { BuildReviewDispositionStore, type BuildReviewReducedCoverageAppendResult } from '../../src/engine/build-review-dispositions.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';
import { coordinateBuildReviewRubrics } from '../../src/engine/build-review-coordinator.js';
import { BUILD_REVIEW_RUBRIC_REGISTRY } from '../../src/engine/build-review-registry.js';
import { BUILD_REVIEW_CUSTOM_V1_CONTRACT } from '../../src/engine/build-review-policy-resolver.js';
import { renderRubricContractShape } from '../../src/engine/build-review-contract.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import type { ResolvedBuildReviewCustomCatalogEntry } from '../../src/engine/resolved-config.js';

const buildReviewPublication = vi.hoisted(() => ({ count: 0 }));
const buildReviewRegistryOverride = vi.hoisted(() => ({ descriptor: undefined as unknown }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (temporaryPath: string, destination: string): Promise<void> => {
      if (/[/\\]\.pipeline[/\\]build-review\.json$/.test(destination)) {
        buildReviewPublication.count += 1;
      }
      await actual.rename(temporaryPath, destination);
    },
  };
});

vi.mock('../../src/engine/build-review-coordinator.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/build-review-coordinator.js')>(),
  coordinateBuildReviewRubrics: vi.fn(),
}));

vi.mock('../../src/engine/build-review-registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/build-review-registry.js')>();
  return {
    ...actual,
    getBuildReviewRubricDescriptor: (rubric: 'testQuality' | 'security') =>
      buildReviewRegistryOverride.descriptor ?? actual.getBuildReviewRubricDescriptor(rubric),
  };
});

const state = {};
const plan = '# Plan\n\n### Task 1: Cover the thing\n**Files:** src/covered.ts\n';

describe('build_review oversized projection step', () => {
  let projectRoot: string;
  let planPath: string;

  beforeEach(async () => {
    buildReviewPublication.count = 0;
    projectRoot = await mkdtemp(join(tmpdir(), 'build-review-oversize-'));
    planPath = join(projectRoot, 'plan.md');
    await writeFile(planPath, plan, 'utf8');
    await mkdir(join(projectRoot, 'src'), { recursive: true });
    await mkdir(join(projectRoot, 'test'), { recursive: true });
    await writeFile(join(projectRoot, 'src/covered.ts'), 'export const covered = true;\n', 'utf8');
    await writeFile(join(projectRoot, 'test/covered.test.ts'), "// Covers: task:1\nit('covered', () => {});\n", 'utf8');
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('publishes an oversized lap once without consuming a mechanical fault and halts for a human', async () => {
    const runner = createRunner('projection-oversized: measured=1346093 bytes limit=1048576 bytes');
    const mechanicalFaultsBefore = (await readKickbackLedger(projectRoot)).gates.build_review?.mechanicalFaults ?? 0;
    const result = await runner.run('build_review', state);

    expect(result).toMatchObject({
      success: false,
      refusal: { kind: 'needs-human' },
    });
    expect(result.refusal?.reason).toContain('testQuality');
    expect(result.refusal?.reason).toContain('1346093');
    expect(result.refusal?.reason).toContain('1048576');
    const aggregate = JSON.parse(await readFile(join(projectRoot, '.pipeline', 'build-review.json'), 'utf8'));
    expect(aggregate.coverage.testQuality).toBe('infrastructure-failure');
    expect(aggregate.results.testQuality.reason).toBe('projection-oversized');
    expect(aggregate.reducedCoverageEvidence).toBe('reduced coverage recorded');
    expect(buildReviewPublication.count).toBe(1);
    const ledger = await readKickbackLedger(projectRoot);
    expect(ledger.gates.build_review?.mechanicalFaults ?? 0).toBe(mechanicalFaultsBefore);
  });

  it('halts with the reason alone when oversized detail has no measured bytes', async () => {
    const runner = createRunner('projection-oversized');
    const result = await runner.run('build_review', state);

    expect(result).toMatchObject({ success: false, refusal: { kind: 'needs-human' } });
    expect(result.refusal?.reason).toContain('projection-oversized');
    expect(result.refusal?.reason).not.toMatch(/measured=|limit=/);
    expect(buildReviewPublication.count).toBe(1);
  });

  it('keeps transient provider errors on the mechanical retry lane', async () => {
    const runner = createRunner('provider-error: grader transport disconnected', 'provider-error');

    const result = await runner.run('build_review', state);

    expect(result).toMatchObject({ success: false, currentLapMechanicalFault: true });
    const ledger = await readKickbackLedger(projectRoot);
    expect(ledger.gates.build_review?.mechanicalFaults).toBe(1);
  });

  it('routes an oversized refusal before a second build-review dispatch', async () => {
    const runner = createRunner('projection-oversized: measured=1346093 bytes limit=1048576 bytes');
    const dispatchesBefore = vi.mocked(coordinateBuildReviewRubrics).mock.calls.length;
    const result = await runner.run('build_review', state);

    expect(classifyRetryDecision({
      step: 'build_review',
      completion: { done: false },
      attempt: 1,
      inputsUnchanged: false,
      terminalRefusal: result.refusal?.kind,
    })).toEqual({ decision: 'route', signal: 'terminal-refusal' });
    expect(coordinateBuildReviewRubrics).toHaveBeenCalledTimes(dispatchesBefore + 1);
    expect(buildReviewPublication.count).toBe(1);
  });

  it('preserves a sibling judged finding while an oversized projection halts for a human', async () => {
    const runner = createRunner('projection-oversized: measured=1346093 bytes limit=1048576 bytes', 'projection-oversized', 'finding');

    const result = await runner.run('build_review', state);

    expect(result).toMatchObject({ success: false, refusal: { kind: 'needs-human' } });
    expect(result.currentLapMechanicalFault).toBeUndefined();
    const aggregate = JSON.parse(await readFile(join(projectRoot, '.pipeline', 'build-review.json'), 'utf8'));
    expect(aggregate.results.security.findings).toEqual([
      expect.objectContaining({ summary: 'Credential committed to source.' }),
    ]);
    expect(buildReviewPublication.count).toBe(1);
    expect((await readKickbackLedger(projectRoot)).gates.build_review?.mechanicalFaults ?? 0).toBe(0);
  });

  it('records an oversized projection through the real CLI and resolves the next lap through the real disposition store', async () => {
    const detail = 'projection-oversized: measured=1346093 bytes limit=1048576 bytes';
    const firstLap = await createRunner(detail).run('build_review', state);
    const mechanicalFaultsBefore = (await readKickbackLedger(projectRoot)).gates.build_review?.mechanicalFaults ?? 0;
    const cliIdentity = (path: string) => path === '/main'
      ? '/main'
      : path === '/main/.worktrees/feature' || path === projectRoot
        ? '/main/.worktrees/feature'
        : path;
    const firstAggregate = JSON.parse(await readFile(join(projectRoot, '.pipeline', 'build-review.json'), 'utf8'));

    expect(firstLap).toMatchObject({ success: false, refusal: { kind: 'needs-human' } });
    const print = vi.fn();
    const store = new BuildReviewDispositionStore(projectRoot);
    let appendResult: BuildReviewReducedCoverageAppendResult | undefined;
    const recorded = await dispatchBuildReviewRecordReducedCoverage({
      kind: 'record-reduced-coverage', feature: 'feature', lapId: firstAggregate.lapId,
      rubric: 'testQuality', rationale: 'The configured projection bound intentionally excludes this input.',
    }, {
      cwd: '/main', isInteractive: true, resolveOperator: () => 'local-operator',
      resolveMainRoot: async () => '/main', realpath: async (path) => cliIdentity(path),
      readFile: async (path) => readFile(path.replace('/main/.worktrees/feature', projectRoot), 'utf8'),
      readMechanicalFaults: async () => mechanicalFaultsBefore, print, appendEvent: vi.fn(),
      createStore: () => ({ appendReducedCoverageIfCurrent: async (input, validate) => {
        appendResult = await store.appendReducedCoverageIfCurrent(input, validate);
        return appendResult;
      } }),
    });
    expect(recorded).toBe(0);
    expect(appendResult).toMatchObject({
      ok: true,
      record: { identity: { rubric: 'testQuality', reason: 'projection-oversized' } },
    });

    const realEffectiveResolver: NonNullable<StepRunnerOptions['buildReviewEffectiveResolver']> = async (root, aggregate, deps) =>
      resolveEffectiveBuildReviewVerdict(root, aggregate, {
        ...deps,
        resolveMainRoot: async () => '/main',
        realpath: async (path) => cliIdentity(path),
      });
    const runner = createRunner(detail, 'projection-oversized', 'pass', realEffectiveResolver);
    const secondLap = await runner.run('build_review', state);
    const aggregate = JSON.parse(await readFile(join(projectRoot, '.pipeline', 'build-review.json'), 'utf8'));

    expect(secondLap).toMatchObject({ success: true });
    expect(secondLap.refusal).toBeUndefined();
    expect(aggregate.reducedCoverageEvidence).toContain('projection-oversized');
    expect((await readKickbackLedger(projectRoot)).gates.build_review?.mechanicalFaults ?? 0).toBe(mechanicalFaultsBefore);
  });

  function createRunner(
    detail: string,
    reason: 'projection-oversized' | 'provider-error' = 'projection-oversized',
    securityResult: 'none' | 'finding' | 'pass' = 'none',
    effectiveResolver?: StepRunnerOptions['buildReviewEffectiveResolver'],
  ): DefaultStepRunner {
    vi.mocked(coordinateBuildReviewRubrics).mockResolvedValue({
      kind: 'ready',
      branches: [
        { kind: 'infrastructure-failure', rubric: 'testQuality', reason, detail },
        ...(securityResult === 'none' ? [] : [{ kind: 'dispatched', rubric: 'security' }]),
      ],
    } as never);
    const provider: LLMProvider = { invoke: vi.fn() };
    const runner = new DefaultStepRunner(provider, 'run-1', projectRoot, {
      planPath,
      gitRunner: git(),
      config: {
        test_suite: { scoped_command: 'true' },
        build_review: {
          enabled: true,
          rubrics: { testQuality: { enabled: true, max_projection_bytes: 1 } },
        },
      } as HarnessConfig,
      buildReviewInputOptions: {
        inspectTestSuite: async () => ({
          status: 'CURRENT', evidence: { provenanceHeadSha: 'head', outcome: 'PASS' },
        } as never),
      },
      buildReviewEffectiveResolver: effectiveResolver ?? vi.fn(async () => ({
        ok: true as const,
        feature: { version: 'v1' as const, repository: '/repo', feature: 'feature' },
        effective: {
          rawVerdict: 'FAIL' as const, verdict: 'FAIL' as const, acceptedFindingIds: [], unresolvedFindingIds: [],
          suppressedFindingIds: [], skippedRubrics: [], infrastructureFailureRubrics: ['testQuality'] as const,
          uncoveredInfrastructureFailureRubrics: ['testQuality'] as const,
        },
        reducedCoverageEvidence: 'reduced coverage recorded',
      })),
      buildReviewArtifactReader: securityResult === 'none'
        ? undefined
        : async (_root, rubric, lapId, snapshotDigest) => ({
            version: 1,
            rubric,
            lapId,
            snapshotDigest,
            result: {
              kind: 'judged' as const,
              rubric: 'security' as const,
              lapId,
              snapshotDigest,
              contractVersion: 'v3' as const,
              findings: securityResult === 'finding' ? [{
                concernKind: 'committed-secret' as const,
                summary: 'Credential committed to source.',
                evidenceLocations: ['src/covered.ts:1'],
                anchor: {
                  rubric: 'security' as const,
                  locus: {
                    path: 'src/covered.ts',
                    contentHash: `sha256:${'a'.repeat(64)}`,
                    display: 'credential assignment',
                  },
                },
              }] : [],
              verdict: securityResult === 'finding' ? 'FAIL' as const : 'PASS' as const,
            },
            provenance: { kind: 'fresh' as const },
          }),
    });
    vi.spyOn(runner as any, 'runTautologyPreflight').mockResolvedValue({
      classification: 'approved-exception', exception: 'empty-test-set', cacheable: true, cacheProvenance: 'miss',
      changedPaths: [], changedTestSelectors: [], revertedProductionManifest: [],
      sourceIdentities: { mergeBase: 'base', headSha: 'head' },
    } as never);
    vi.spyOn(runner as any, 'resolveBuildReviewEngineIdentity').mockResolvedValue({
      engineStamp: 'dev', skillDigests: { testQuality: { kind: 'resolved', digest: 'sha256:skill' } },
    });
    return runner;
  }

  function git() {
    return async (args: string[]) => {
      if (args[0] === 'symbolic-ref') return { exitCode: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' };
      if (args[0] === 'rev-parse') return { exitCode: 0, stdout: args[1] === 'HEAD' ? 'head\n' : 'base\n', stderr: '' };
      if (args[0] === 'merge-base') return { exitCode: 0, stdout: 'base\n', stderr: '' };
      if (args[0] === 'diff' && args.includes('--name-status')) return { exitCode: 0, stdout: 'M\0src/covered.ts\0M\0test/covered.test.ts\0', stderr: '' };
      if (args[0] === 'diff') return { exitCode: 0, stdout: 'diff --git a/src/covered.ts b/src/covered.ts\ndiff --git a/test/covered.test.ts b/test/covered.test.ts\n', stderr: '' };
      if (args[0] === 'show') {
        if (args[1]?.endsWith('.md')) return { exitCode: 0, stdout: plan, stderr: '' };
        if (args[1]?.endsWith('test/covered.test.ts')) return { exitCode: 0, stdout: "// Covers: task:1\nit('covered', () => {});\n", stderr: '' };
        return { exitCode: 0, stdout: 'export const covered = true;\n', stderr: '' };
      }
      if (args[0] === 'ls-tree') return { exitCode: 0, stdout: '', stderr: '' };
      return { exitCode: 1, stdout: '', stderr: '' };
    };
  }
});

describe('build_review structured rubric dispatch', () => {
  const branch = {
    rubric: 'testQuality' as const,
    skillName: 'build-review-test-quality',
    policy: {
      enabled: true, llm_provider: 'claude' as const, model: 'opus', effort: 'high' as const,
      model_fallback_ladder: ['opus'], max_retries: 1, escalate: false, max_projection_bytes: 1_000_000, min_confidence: 0,
    },
  };
  const projection = {
    rubric: 'testQuality', contractVersion: 'v3', projectionVersion: 'v3',
    lapId: 'lap-a237011e9f263dd47ca1a2c7cfe929865c2e99b8', snapshotDigest: 'sha256:projection',
    digest: 'sha256:projection', mergeBase: 'base', headSha: 'head', changedFiles: [],
    removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] }, changedTestSelectors: [],
    testSuiteProof: {}, revertedProductionManifest: [], preflight: {}, repairContext: [],
  } as unknown as import('../../src/engine/build-review-projections.js').BuildReviewRubricProjection;

  const dispatchBuiltIn = async (invoke: LLMProvider['invoke']) => {
    const runner = new DefaultStepRunner({ invoke }, 'structured-review', '/fixture');
    const proseScrape = vi.spyOn(runner as any, 'validateRubricOutput');
    const result = await (runner as unknown as {
      dispatchBuildReviewRubric: (value: typeof branch, reviewProjection: import('../../src/engine/build-review-projections.js').BuildReviewRubricProjection) => Promise<unknown>;
    }).dispatchBuildReviewRubric(branch, projection);
    return { result, proseScrape };
  };

  it('runs testQuality through the recording provider schema boundary and stamps structured A over prose B', async () => {
    const invoke = vi.fn(async (_options: InvokeOptions) => ({
      success: true,
      output: JSON.stringify({ findings: [{ summary: 'prose B must be ignored' }] }),
      exitCode: 0,
      finalStructuredResult: { findings: [] },
    }));
    const { result, proseScrape } = await dispatchBuiltIn(invoke);

    expect(invoke.mock.calls[0]?.[0]?.nativeSchema).toBe(BUILD_REVIEW_RUBRIC_REGISTRY.testQuality.contract.output.jsonSchema);
    expect(invoke.mock.calls[0]?.[0]?.prompt).toContain(
      renderRubricContractShape(BUILD_REVIEW_RUBRIC_REGISTRY.testQuality.contract),
    );
    expect(result).toMatchObject({ kind: 'judged', verdict: 'PASS', findings: [] });
    expect(proseScrape).not.toHaveBeenCalled();
  });

  it('derives the live nested result guidance from the selected built-in schema fixture', async () => {
    buildReviewRegistryOverride.descriptor = {
      ...BUILD_REVIEW_RUBRIC_REGISTRY.testQuality,
      contract: {
        ...BUILD_REVIEW_RUBRIC_REGISTRY.testQuality.contract,
        output: {
          ...BUILD_REVIEW_RUBRIC_REGISTRY.testQuality.contract.output,
          jsonSchema: {
            type: 'object', additionalProperties: false, required: ['findings'],
            properties: {
              findings: {
                type: 'array', items: {
                  type: 'object', additionalProperties: false, required: ['anchor'],
                  properties: {
                    anchor: {
                      type: 'object', additionalProperties: false, required: ['kind'],
                      properties: { kind: { type: 'string', enum: ['nested-built-in-fixture'] } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const invoke = vi.fn(async (_options: InvokeOptions) => ({
      success: true, output: 'ignored prose', exitCode: 0, finalStructuredResult: { findings: [] },
    }));
    try {
      await dispatchBuiltIn(invoke);
      const prompt = invoke.mock.calls[0]?.[0]?.prompt ?? '';

      expect(prompt).toContain('anchor: { kind: enum(`nested-built-in-fixture`)');
      expect(prompt).toContain('required: findings');
      expect(prompt).not.toContain('anchor values follow the schema below exactly');
      expect(prompt).not.toContain('scopeResolutions has exactly one entry');
    } finally {
      buildReviewRegistryOverride.descriptor = undefined;
    }
  });

  it('rejects a prose-only success at root without a repair or prose finding', async () => {
    const invoke = vi.fn(async (_options: InvokeOptions) => ({
      success: true,
      output: JSON.stringify({ findings: [{ summary: 'prose only must not stamp' }] }),
      exitCode: 0,
    }));
    const { result, proseScrape } = await dispatchBuiltIn(invoke);

    expect(result).toMatchObject({ kind: 'dispatch-failure', detail: 'root: a structured result is required' });
    expect(invoke).toHaveBeenCalledOnce();
    expect(proseScrape).not.toHaveBeenCalled();
  });

  it('refuses an incapable runtime provider before invoking a no-input rubric dispatch', async () => {
    const invoke = vi.fn(async (_options: InvokeOptions) => ({
      success: true, output: 'ignored prose', exitCode: 0, finalStructuredResult: { findings: [] },
    }));
    const provider: LLMProvider = {
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke,
    };
    const runner = new DefaultStepRunner(provider, 'runtime-review', '/fixture', {
      config: { llm_provider: ['claude'] } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([{
        key: 'claude', provider, lifecycleCapability: provider.lifecycleCapability,
        policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
      }]),
      sessionStore: new ProviderSessionStore(),
      configuredProviders: ['claude'],
    });
    const result = await (runner as unknown as {
      dispatchBuildReviewRubric: (value: typeof branch, reviewProjection: typeof projection) => Promise<unknown>;
    }).dispatchBuildReviewRubric(branch, projection);

    expect(invoke).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('carries custom-v1 through the same dispatcher with its policy bundle before skill invocation', async () => {
    const customInvoke = vi.fn(async (_options: Partial<InvokeOptions>) => ({ success: true, output: 'ignored prose', exitCode: 0, finalStructuredResult: { kind: 'custom-findings', version: 'v1', findings: [] } }));
    const custom = await dispatchRubricContract({
      descriptor: BUILD_REVIEW_CUSTOM_V1_CONTRACT,
      invoke: customInvoke,
      options: { prompt: 'bundle text\n\n$portable-policy\n\nreview', cwd: '/fixture' },
    });

    expect(custom).toMatchObject({ kind: 'structured', parsed: { kind: 'custom-findings', findings: [] } });
    expect(customInvoke.mock.calls[0]?.[0]?.prompt).toMatch(/^bundle text\n\n\$portable-policy/);
    expect(customInvoke.mock.calls[0]?.[0]?.nativeSchema).toBe(BUILD_REVIEW_CUSTOM_V1_CONTRACT.output.jsonSchema);
  });

  it('runs a resolved custom member through the recording-provider dispatcher after its policy bundle', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'build-review-custom-dispatch-'));
    const invoke = vi.fn(async (_options: InvokeOptions) => ({
      success: true,
      output: '{"kind":"unsupported-policy","requirement":"prose B"}',
      exitCode: 0,
      finalStructuredResult: { kind: 'custom-findings', version: 'v1', findings: [] },
    }));
    const runtimeProvider: LLMProvider = {
      lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
      invoke,
    };
    const entry: ResolvedBuildReviewCustomCatalogEntry = {
      id: 'custom-policy', kind: 'custom', skill: 'custom-policy', question: 'Review the fixture.', resources: [],
      policy: branch.policy,
      contract: Object.freeze({
        ...BUILD_REVIEW_CUSTOM_V1_CONTRACT,
        output: Object.freeze({
          ...BUILD_REVIEW_CUSTOM_V1_CONTRACT.output,
          jsonSchema: Object.freeze({
            type: 'object', additionalProperties: false, required: ['sentinel'],
            properties: { sentinel: { type: 'string', enum: ['selected-custom-contract'] } },
          }),
        }),
      }),
    };
    const runner = new DefaultStepRunner({ invoke: vi.fn() }, 'custom-review', projectDir, {
      gitRunner: async () => ({ exitCode: 1, stdout: '', stderr: '' }),
      config: { llm_provider: ['claude'] } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([{
        key: 'claude', provider: runtimeProvider, lifecycleCapability: runtimeProvider.lifecycleCapability,
        policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
      }]),
      sessionStore: new ProviderSessionStore(),
      configuredProviders: ['claude'],
      buildReviewPolicyCatalog: async () => [{
        semanticName: 'custom-policy', source: 'project', installationOrigin: '/fixture/policy',
        canonicalSkillPath: '/fixture/policy/SKILL.md', packageRoot: '/fixture/policy', declaredDependencies: [], availability: 'available',
      }],
      buildReviewPolicyCapture: async (policy) => ({
        policy, materialPath: '/fixture/material', definitionPath: '/fixture/material/SKILL.md',
        manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# policy bundle') }],
        metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] },
        digest: `sha256-v1:${'a'.repeat(64)}`,
      }),
    });
    try {
      const outcome = await (runner as unknown as {
        dispatchInstalledBuildReviewPolicy: (entry: ResolvedBuildReviewCustomCatalogEntry, inputs: unknown, lapId: string) => Promise<unknown>;
      }).dispatchInstalledBuildReviewPolicy(entry, {
        sourceSnapshot: { contentDigest: 'sha256:source', mergeBase: 'base', headSha: 'head', digest: 'sha256:snapshot', sourceChanges: [] },
      }, 'lap-a237011e9f263dd47ca1a2c7cfe929865c2e99b8');
      const options = invoke.mock.calls[0]?.[0];

      expect(options?.nativeSchema).toBe(entry.contract.output.jsonSchema);
      expect(options?.prompt.indexOf('# policy bundle')).toBeLessThan(options?.prompt.indexOf('/custom-policy') ?? -1);
      expect(options?.prompt).toContain('`sentinel`');
      expect(options?.prompt).toContain('`selected-custom-contract`');
      expect(outcome).toMatchObject({ success: true, id: 'custom-policy' });
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});
