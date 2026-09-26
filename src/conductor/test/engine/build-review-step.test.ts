// Covers: task:2, task:4
// Covers: task:9, task:10
// Covers: task:5
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultStepRunner, cachedRubricInvocation, dispatchRubricContract, type StepRunnerOptions } from '../../src/engine/step-runners.js';
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
import { stampBuildReviewCustomJudgedResult } from '../../src/engine/build-review-finding-identity.js';
import { diagnoseBuildReviewCustomReviewerPayloadRejection } from '../../src/engine/build-review-domain.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY, CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import type { ResolvedBuildReviewCustomCatalogEntry } from '../../src/engine/resolved-config.js';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';

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

  it('keeps an invalid structured result out of the aggregate and semantic budgets', async () => {
    const runner = createRunner(
      'findings[0].concernKind must be one of "test-insensitive"',
      'invalid-structured-result',
    );

    const result = await runner.run('build_review', state);

    expect(result).toMatchObject({
      success: false,
      currentLapMechanicalFault: true,
      output: expect.stringContaining('invalid-structured-result'),
    });
    await expect(access(join(projectRoot, '.pipeline', 'build-review.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    const ledger = await readKickbackLedger(projectRoot);
    expect(ledger.gates.build_review).toMatchObject({ mechanicalFaults: 1 });
    expect(ledger.gates.build_review?.count ?? 0).toBe(0);
    expect(ledger.gates.build_review?.cumulative ?? 0).toBe(0);
    expect(buildReviewPublication.count).toBe(0);
  });

  it('halts needs-human after three invalid structured-result laps without publishing an aggregate', async () => {
    const runner = createRunner('findings must be an array', 'invalid-structured-result');
    const dispatchesBefore = vi.mocked(coordinateBuildReviewRubrics).mock.calls.length;

    await expect(runner.run('build_review', state)).resolves.toMatchObject({ currentLapMechanicalFault: true });
    await expect(runner.run('build_review', state)).resolves.toMatchObject({ currentLapMechanicalFault: true });
    await expect(runner.run('build_review', state)).resolves.toMatchObject({
      success: false,
      refusal: { kind: 'needs-human' },
      output: expect.stringContaining('invalid-structured-result'),
    });
    expect((await readKickbackLedger(projectRoot)).gates.build_review?.mechanicalFaults).toBe(3);
    await expect(access(join(projectRoot, '.pipeline', 'build-review.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(buildReviewPublication.count).toBe(0);
    expect(vi.mocked(coordinateBuildReviewRubrics)).toHaveBeenCalledTimes(dispatchesBefore + 3);
  });

  it('halts a custom-only invalid structured-result after its third mechanical lap without publishing an aggregate', async () => {
    const runner = new DefaultStepRunner({ invoke: vi.fn() }, 'custom-only-retry', projectRoot);
    const publish = (runner as unknown as {
      publishCustomOnlyBuildReview: (input: unknown) => Promise<unknown>;
    }).publishCustomOnlyBuildReview.bind(runner);
    const input = {
      lapId: 'lap-a237011e9f263dd47ca1a2c7cfe929865c2e99b8',
      inputs: { sourceSnapshot: { digest: 'sha256:snapshot' } },
      customResults: {
        'custom-policy': {
          result: {
            kind: 'infrastructure-failure', rubric: 'custom-policy',
            reason: 'invalid-structured-result', detail: 'findings[0].confidence must be an integer from 0 to 100',
          },
        },
      },
      currentCustomRubrics: ['custom-policy'],
      config: {} as ReturnType<typeof import('../../src/engine/resolved-config.js').resolveBuildReviewConfig>,
    };

    await expect(publish(input)).resolves.toMatchObject({ currentLapMechanicalFault: true });
    await expect(publish(input)).resolves.toMatchObject({ currentLapMechanicalFault: true });
    await expect(publish(input)).resolves.toMatchObject({
      success: false,
      refusal: { kind: 'needs-human' },
      output: expect.stringContaining('invalid-structured-result'),
    });
    await expect(access(join(projectRoot, '.pipeline', 'build-review.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readKickbackLedger(projectRoot)).gates.build_review?.mechanicalFaults).toBe(3);
  });

  it('charges native-schema-unsupported once per lap and records the same candidate-set lever on a later lap', async () => {
    const detail = 'candidate set [claude, codex] has no provider declaring nativeSchemaCapability.nativeOutputSchema. Recovery action: update the candidate set.';
    const runner = createRunner(detail, 'native-schema-unsupported');
    const dispatchesBefore = vi.mocked(coordinateBuildReviewRubrics).mock.calls.length;

    await expect(runner.run('build_review', state)).resolves.toMatchObject({
      success: false,
      currentLapMechanicalFault: true,
      output: expect.stringContaining('candidate set [claude, codex]'),
    });
    const firstLedger = await readKickbackLedger(projectRoot);
    await expect(runner.run('build_review', state)).resolves.toMatchObject({
      success: false,
      currentLapMechanicalFault: true,
      output: expect.stringContaining('candidate set [claude, codex]'),
    });
    const secondLedger = await readKickbackLedger(projectRoot);

    expect(vi.mocked(coordinateBuildReviewRubrics)).toHaveBeenCalledTimes(dispatchesBefore + 2);
    expect(firstLedger.gates.build_review).toMatchObject({ mechanicalFaults: 1, lastMechanicalFault: { reason: 'native-schema-unsupported', detail: `native-schema-unsupported: ${detail}` } });
    expect(secondLedger.gates.build_review).toMatchObject({ mechanicalFaults: 2, lastMechanicalFault: { reason: 'native-schema-unsupported', detail: `native-schema-unsupported: ${detail}` } });
    await expect(access(join(projectRoot, '.pipeline', 'build-review.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('publishes a clean sibling finding while retaining the rejected structured-result branch as absent coverage', async () => {
    const runner = createRunner(
      'findings[0].anchor.locus.contentHash must equal a projected hash',
      'invalid-structured-result',
      'finding',
    );

    const result = await runner.run('build_review', state);

    expect(result).toMatchObject({ success: true });
    const aggregate = JSON.parse(await readFile(join(projectRoot, '.pipeline', 'build-review.json'), 'utf8'));
    expect(aggregate.results.testQuality).toMatchObject({
      kind: 'infrastructure-failure',
      reason: 'invalid-structured-result',
    });
    expect(aggregate.results.security.findings).toEqual([
      expect.objectContaining({ summary: 'Credential committed to source.' }),
    ]);
    expect((await readKickbackLedger(projectRoot)).gates.build_review?.mechanicalFaults ?? 0).toBe(0);
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
    reason: 'projection-oversized' | 'provider-error' | 'invalid-structured-result' | 'native-schema-unsupported' = 'projection-oversized',
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

  it('never imports a prose-scrape result helper into the native build_review dispatch path', async () => {
    const source = await readFile(new URL('../../src/engine/step-runners.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/(?:import\s+[^;]*\bextractJudgedResultCandidate\b|\bextractJudgedResultCandidate\s*\()/);
  });

  const dispatchBuiltIn = async (
    invoke: LLMProvider['invoke'],
    mode?: 'interactive',
    rubricBranch: typeof branch | { readonly rubric: 'security'; readonly skillName: string; readonly policy: typeof branch.policy } = branch,
  ) => {
    const runner = new DefaultStepRunner({ invoke }, 'structured-review', '/fixture', mode ? { mode } : {});
    const result = await (runner as unknown as {
      dispatchBuildReviewRubric: (value: typeof rubricBranch, reviewProjection: import('../../src/engine/build-review-projections.js').BuildReviewRubricProjection) => Promise<unknown>;
    }).dispatchBuildReviewRubric(rubricBranch, projection);
    return { result };
  };

  it('runs testQuality through the recording provider schema boundary and stamps structured A over prose B', async () => {
    const invoke = vi.fn(async (_options: InvokeOptions) => ({
      success: true,
      output: JSON.stringify({ findings: [{ summary: 'prose B must be ignored' }] }),
      exitCode: 0,
      finalStructuredResult: { findings: [] },
    }));
    const { result } = await dispatchBuiltIn(invoke);

    expect(invoke.mock.calls[0]?.[0]?.nativeSchema).toBe(BUILD_REVIEW_RUBRIC_REGISTRY.testQuality.contract.output.jsonSchema);
    expect(invoke.mock.calls[0]?.[0]?.prompt).toContain(
      renderRubricContractShape(BUILD_REVIEW_RUBRIC_REGISTRY.testQuality.contract),
    );
    expect(result).toMatchObject({ kind: 'judged', verdict: 'PASS', findings: [] });
  });

  it('carries the testQuality descriptor from generic dispatch into Claude --json-schema argv', async () => {
    const subprocess = vi.fn(async (_file: string, _args: string[]) => ({
      stdout: JSON.stringify({
        type: 'result',
        result: 'Human-readable prose is not the judgment.',
        structured_output: JSON.stringify({ findings: [] }),
      }),
      stderr: '',
      exitCode: 0,
    }));
    const provider = new ClaudeProvider(undefined, subprocess as never);

    const { result } = await dispatchBuiltIn(provider.invoke.bind(provider));

    const [, args] = subprocess.mock.calls[0] ?? [];
    const schemaIndex = (args as string[]).indexOf('--json-schema');
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(JSON.parse((args as string[])[schemaIndex + 1]!)).toEqual(
      BUILD_REVIEW_RUBRIC_REGISTRY.testQuality.contract.output.jsonSchema,
    );
    expect(result).toMatchObject({ kind: 'judged', verdict: 'PASS', findings: [] });
  });

  it.each([
    branch,
    { ...branch, rubric: 'security' as const, skillName: 'build-review-security' },
  ])('pins $rubric to a non-interactive schema invocation while the conductor is interactive', async (rubricBranch) => {
    const invoke = vi.fn(async (_options: InvokeOptions) => ({
      success: true, output: 'ignored prose', exitCode: 0, finalStructuredResult: { findings: [] },
    }));

    const { result } = await dispatchBuiltIn(invoke, 'interactive', rubricBranch);

    expect(invoke).toHaveBeenCalledOnce();
    for (const [options] of invoke.mock.calls) {
      expect(options).toMatchObject({
        interactive: false,
        nativeSchema: BUILD_REVIEW_RUBRIC_REGISTRY[rubricBranch.rubric].contract.output.jsonSchema,
      });
    }
    expect(result).toMatchObject({ kind: 'judged', verdict: 'PASS' });
  });

  it.each([
    [branch, 'scopeResolutions: [{ candidateId: string'],
    [{ ...branch, rubric: 'security' as const, skillName: 'build-review-security' }, 'contentHash: "sha256:" + 64 lowercase hex characters'],
  ] as const)('renders the $0.rubric prompt from its descriptor rather than the retired prose shape', async (rubricBranch, retiredShapeText) => {
    const invoke = vi.fn(async (_options: InvokeOptions) => ({
      success: true, output: 'ignored prose', exitCode: 0, finalStructuredResult: { findings: [] },
    }));

    await dispatchBuiltIn(invoke, undefined, rubricBranch);

    const prompt = invoke.mock.calls[0]?.[0]?.prompt ?? '';
    expect(prompt).toContain(renderRubricContractShape(BUILD_REVIEW_RUBRIC_REGISTRY[rubricBranch.rubric].contract));
    expect(prompt).not.toContain(retiredShapeText);
  });

  it('judges a cached rubric verdict as a structured result instead of root-rejecting it', async () => {
    // A lap re-run at an unchanged snapshot serves a rubric from cache. The
    // shortcut invocation must carry the cached verdict as the structured
    // result, or every re-lap burns a mechanical fault on the cached rubric.
    const cachedVerdict = { findings: [] };
    const dispatched = await dispatchRubricContract({
      descriptor: { output: { ...BUILD_REVIEW_RUBRIC_REGISTRY.testQuality.contract.output, parse: (value: unknown) => value } },
      options: { prompt: 'judge', cwd: '/fixture' },
      invoke: async () => cachedRubricInvocation(cachedVerdict),
    });

    expect(dispatched).toMatchObject({ kind: 'structured', prepared: cachedVerdict, parsed: cachedVerdict });
  });

  it('makes a forced interactive Claude rubric schema refusal observable to the coordinator lane', async () => {
    const provider = new ClaudeProvider();
    const dispatched = await dispatchRubricContract({
      descriptor: BUILD_REVIEW_RUBRIC_REGISTRY.testQuality.contract,
      options: { prompt: 'judge', cwd: '/fixture', interactive: true },
      invoke: (options) => provider.invoke({ ...options, sessionId: 'forced-interactive', resume: false }),
    });

    expect(dispatched).toMatchObject({
      kind: 'provider-failure',
      invocation: { nativeSchemaUnsupported: true },
    });
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

  it('rejects a prose-only success at the native structured-result boundary', async () => {
    const invoke = vi.fn(async (_options: InvokeOptions) => ({
      success: true,
      output: JSON.stringify({ findings: [{ summary: 'prose only must not stamp' }] }),
      exitCode: 0,
    }));
    const { result } = await dispatchBuiltIn(invoke);

    expect(result).toMatchObject({ kind: 'dispatch-failure', detail: 'root: a structured result is required' });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('settles a rejected structured result after its first provider invocation', async () => {
    const invoke = vi.fn(async (_options: InvokeOptions) => ({
      success: true,
      output: 'ignored prose',
      exitCode: 0,
      finalStructuredResult: { findings: [{ concernKind: 'test-insensitive' }] },
    }));
    const { result } = await dispatchBuiltIn(invoke);

    expect(result).toMatchObject({ kind: 'dispatch-failure' });
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls.slice(1).some(([options]) => options.prompt.includes('repair'))).toBe(false);
  });

  // D6: the rejection is diagnosed on the stamped value the parser judged, so
  // engine-owned envelope fields are never attributed to the provider payload.
  it('diagnoses a rejected built-in payload by its own defect and never as absent engine-stamped envelope fields', async () => {
    const invoke = vi.fn(async (_options: InvokeOptions) => ({
      success: true,
      output: 'ignored prose',
      exitCode: 0,
      finalStructuredResult: { findings: [{ concernKind: 'test-insensitive' }] },
    }));
    const { result } = await dispatchBuiltIn(invoke);
    const failure = result as { kind: string; cause?: string; detail: string; rejection?: { kind: string; problems: readonly { field: string }[] } };

    expect(failure).toMatchObject({ kind: 'dispatch-failure', cause: 'invalid-structured-result', rejection: { kind: 'explained' } });
    const fields = failure.rejection!.problems.map((problem) => problem.field);
    expect(fields).toEqual(expect.arrayContaining(['findings[0].summary', 'findings[0].evidenceLocations', 'findings[0].anchor']));
    for (const envelopeField of ['kind', 'rubric', 'lapId', 'contractVersion', 'snapshotDigest']) {
      expect(fields, `envelope field ${envelopeField} attributed to the provider`).not.toContain(envelopeField);
      expect(failure.detail).not.toMatch(new RegExp(`"${envelopeField}" must`));
    }
  });

  it('settles an incapable-only runtime candidate set as native-schema-unsupported without launching a provider', async () => {
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
    expect(result).toMatchObject({
      kind: 'dispatch-failure',
      cause: 'native-schema-unsupported',
      detail: expect.stringContaining('candidate set [claude]'),
    });
    expect((result as { detail: string }).detail).toContain('Recovery action:');
    expect((result as { detail: string }).detail).toContain('claude');
  });

  it('skips an incapable candidate and invokes a schema-capable sibling', async () => {
    const incapableInvoke = vi.fn(async (): Promise<never> => {
      throw new Error('incapable candidate must not be launched');
    });
    const capableInvoke = vi.fn(async (options: InvokeOptions) => ({
      success: true, output: 'structured result', exitCode: 0, finalStructuredResult: { findings: [] },
    }));
    const incapable: LLMProvider = { lifecycleCapability: { synchronousSpawnPermit: true }, invoke: incapableInvoke };
    const capable: LLMProvider = {
      lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
      invoke: capableInvoke,
    };
    const runner = new DefaultStepRunner(incapable, 'runtime-review', '/fixture', {
      config: { llm_provider: ['codex', 'claude'] } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([
        { key: 'codex', provider: incapable, lifecycleCapability: incapable.lifecycleCapability, policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder) },
        { key: 'claude', provider: capable, lifecycleCapability: capable.lifecycleCapability, nativeSchemaCapability: capable.nativeSchemaCapability, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) },
      ]),
      sessionStore: new ProviderSessionStore(),
      configuredProviders: ['codex', 'claude'],
    });
    const mixedBranch = { ...branch, policy: { ...branch.policy, llm_provider: ['codex', 'claude'] } };

    const result = await (runner as unknown as {
      dispatchBuildReviewRubric: (value: typeof mixedBranch, reviewProjection: typeof projection) => Promise<unknown>;
    }).dispatchBuildReviewRubric(mixedBranch, projection);

    expect(incapableInvoke).not.toHaveBeenCalled();
    expect(capableInvoke).toHaveBeenCalledOnce();
    expect(capableInvoke.mock.calls[0]?.[0]?.nativeSchema).toBe(BUILD_REVIEW_RUBRIC_REGISTRY.testQuality.contract.output.jsonSchema);
    expect(result).toMatchObject({ kind: 'judged', verdict: 'PASS', findings: [] });
  });

  it('keeps an adapter-reported native schema refusal on the native-schema-unsupported lane', async () => {
    const invoke = vi.fn(async (): Promise<import('../../src/execution/llm-provider.js').InvokeResult> => ({
      success: false,
      output: 'adapter could not apply the output schema',
      exitCode: 1,
      nativeSchemaUnsupported: true,
    }));
    const provider: LLMProvider = {
      lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
      invoke,
    };
    const runner = new DefaultStepRunner(provider, 'runtime-review', '/fixture', {
      config: { llm_provider: ['claude'] } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([{
        key: 'claude', provider, lifecycleCapability: provider.lifecycleCapability, nativeSchemaCapability: provider.nativeSchemaCapability,
        policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
      }]),
      sessionStore: new ProviderSessionStore(),
      configuredProviders: ['claude'],
    });

    const result = await (runner as unknown as {
      dispatchBuildReviewRubric: (value: typeof branch, reviewProjection: typeof projection) => Promise<unknown>;
    }).dispatchBuildReviewRubric(branch, projection);

    expect(invoke).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ kind: 'dispatch-failure', cause: 'native-schema-unsupported', detail: 'adapter could not apply the output schema' });
  });

  it('gives a Codex rubric invocation an engine-owned schema scratch home and settles it', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'build-review-codex-schema-scratch-'));
    let scratchHome: string | undefined;
    const invoke = vi.fn(async (options: InvokeOptions) => {
      scratchHome = options.nativeSchemaScratchHome;
      return { success: true, output: 'ignored prose', exitCode: 0, finalStructuredResult: { findings: [] } };
    });
    const provider: LLMProvider = {
      lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
      invoke,
    };
    const codexBranch = {
      ...branch,
      policy: { ...branch.policy, llm_provider: 'codex' as const, model: 'gpt-5.6-sol' },
    };
    const runner = new DefaultStepRunner(provider, 'runtime-review', projectDir, {
      config: { llm_provider: ['codex'] } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([{
        key: 'codex', provider, lifecycleCapability: provider.lifecycleCapability,
        nativeSchemaCapability: provider.nativeSchemaCapability,
        policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
      }]),
      sessionStore: new ProviderSessionStore(),
      configuredProviders: ['codex'],
    });

    try {
      await (runner as unknown as {
        dispatchBuildReviewRubric: (value: typeof codexBranch, reviewProjection: typeof projection) => Promise<unknown>;
      }).dispatchBuildReviewRubric(codexBranch, projection);

      expect(scratchHome).toMatch(new RegExp(`^${projectDir.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}/\\.daemon/scratch/`));
      await expect(access(scratchHome!)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('preserves a Codex native-schema scratch failure as a named build_review dispatch fault', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'build-review-codex-schema-failure-'));
    const provider: LLMProvider = {
      lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
      invoke: vi.fn(async () => ({
        success: false,
        output: 'Codex native schema scratch home failed: EACCES: permission denied',
        exitCode: 1,
      })),
    };
    const codexBranch = {
      ...branch,
      policy: { ...branch.policy, llm_provider: 'codex' as const, model: 'gpt-5.6-sol' },
    };
    const runner = new DefaultStepRunner(provider, 'runtime-review', projectDir, {
      config: { llm_provider: ['codex'] } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([{
        key: 'codex', provider, lifecycleCapability: provider.lifecycleCapability,
        nativeSchemaCapability: provider.nativeSchemaCapability,
        policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
      }]),
      sessionStore: new ProviderSessionStore(),
      configuredProviders: ['codex'],
    });

    try {
      const result = await (runner as unknown as {
        dispatchBuildReviewRubric: (value: typeof codexBranch, reviewProjection: typeof projection) => Promise<unknown>;
      }).dispatchBuildReviewRubric(codexBranch, projection);

      expect(result).toMatchObject({
        kind: 'dispatch-failure',
        detail: 'Codex native schema scratch home failed: EACCES: permission denied',
      });
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
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

  it.each(['missing', 'malformed'] as const)('routes an adapter %s structured-result marker to the root rejection', async (structuredResultFailure) => {
    const dispatched = await dispatchRubricContract({
      descriptor: BUILD_REVIEW_CUSTOM_V1_CONTRACT,
      invoke: async () => ({ success: false, output: 'adapter retained transcript', exitCode: 0, structuredResultFailure }),
      options: { prompt: 'review', cwd: '/fixture', interactive: false },
    });

    expect(dispatched).toMatchObject({
      kind: 'root-rejection',
      rejection: { field: 'root', problem: 'a structured result is required' },
    });
  });

  it('settles a built-in adapter structured-result marker as invalid-structured-result', async () => {
    const { result } = await dispatchBuiltIn(async () => ({
      success: false, output: 'terminal result record is missing its structured result', exitCode: 0,
      structuredResultFailure: 'missing',
    }));

    expect(result).toMatchObject({
      kind: 'dispatch-failure',
      detail: 'root: a structured result is required',
      cause: 'invalid-structured-result',
    });
  });

  it('uses only final structured custom-v1 results for engine stamps, refusals, and field-named rejection', async () => {
    const source = {
      path: 'src/widget.ts', startLine: 8, endLine: 12,
      contentHash: `sha256:${'a'.repeat(64)}`, display: 'public boundary',
    };
    const engineStamp = {
      rubric: 'portablePolicy', lapId: 'lap-engine',
      declaration: { version: 'v1' as const, rubricId: 'portablePolicy', semanticSkill: 'portable-policy', question: 'Check the frozen input.', resources: [] },
      policy: { version: 'v1' as const, bundleDigest: `sha256:${'b'.repeat(64)}` },
      candidate: { provider: 'codex', model: 'gpt-5.6-sol', effort: 'medium' },
      reviewedInput: { version: 'v1' as const, contentDigest: `sha256:${'c'.repeat(64)}` },
    };
    const finding = {
      concernId: 'portable-policy-gap', summary: 'The changed boundary lacks compatibility evidence.',
      confidence: 72, evidenceLocations: ['src/widget.ts:8'], sourceRegions: [source],
    };
    const structuredFinding = {
      kind: 'custom-findings', version: 'v1', findings: [finding],
      rubric: 'provider-rubric', lapId: 'provider-lap',
    };
    const invoke = vi.fn(async (_options: Pick<InvokeOptions, 'nativeSchema'>) => ({
      success: true, output: 'provider prose is not the contract', exitCode: 0,
      finalStructuredResult: structuredFinding,
    }));

    const dispatched = await dispatchRubricContract({
      descriptor: BUILD_REVIEW_CUSTOM_V1_CONTRACT,
      invoke,
      options: { prompt: 'review', cwd: '/fixture', interactive: false },
    });
    const golden = stampBuildReviewCustomJudgedResult(
      { kind: 'custom-findings', version: 'v1', findings: [finding] }, engineStamp, { sourceRegions: [source] },
    );
    const stamped = dispatched.kind === 'structured'
      ? stampBuildReviewCustomJudgedResult(dispatched.parsed, engineStamp, { sourceRegions: [source] })
      : undefined;

    expect(invoke.mock.calls[0]?.[0]?.nativeSchema).toBe(BUILD_REVIEW_CUSTOM_V1_CONTRACT.output.jsonSchema);
    expect(stamped).toEqual(golden);
    expect(stamped).toMatchObject({
      rubric: 'portablePolicy', lapId: 'lap-engine', policy: engineStamp.policy,
      candidate: engineStamp.candidate, verdict: 'FAIL',
      findings: [{ identity: golden?.findings[0]?.identity }],
    });

    const unsupported = await dispatchRubricContract({
      descriptor: BUILD_REVIEW_CUSTOM_V1_CONTRACT,
      invoke: async () => ({ success: true, output: '', exitCode: 0, finalStructuredResult: { kind: 'unsupported-policy', requirement: 'requires deployment credentials' } }),
      options: { prompt: 'review', cwd: '/fixture', interactive: false },
    });
    expect(unsupported).toMatchObject({ kind: 'structured', parsed: { kind: 'unsupported-policy', requirement: 'requires deployment credentials' } });

    const fractional = { ...structuredFinding, findings: [{ ...finding, confidence: 85.5 }] };
    const outsideRegion = { ...structuredFinding, findings: [{ ...finding, sourceRegions: [{ ...source, startLine: 13, endLine: 13 }] }] };
    expect(diagnoseBuildReviewCustomReviewerPayloadRejection(fractional, { sourceRegions: [source] })).toMatchObject({
      kind: 'explained', problems: [{ field: 'findings[0].confidence', required: 'must be an integer from 0 to 100' }],
    });
    expect(diagnoseBuildReviewCustomReviewerPayloadRejection(outsideRegion, { sourceRegions: [source] })).toMatchObject({
      kind: 'explained', problems: [{ field: 'findings[0].sourceRegions[0]' }],
    });
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
    const buildProjection = vi.fn((scope) => scope);
    const entry: ResolvedBuildReviewCustomCatalogEntry = {
      id: 'custom-policy', kind: 'custom', skill: 'custom-policy', question: 'Review the fixture.', resources: [],
      policy: branch.policy,
      contract: Object.freeze({
        ...BUILD_REVIEW_CUSTOM_V1_CONTRACT,
        projection: Object.freeze({ ...BUILD_REVIEW_CUSTOM_V1_CONTRACT.projection, build: buildProjection }),
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
        dispatchInstalledBuildReviewPolicy: (
          entry: ResolvedBuildReviewCustomCatalogEntry,
          inputs: unknown,
          lapId: string,
          tier?: unknown,
          lapGate?: unknown,
          readOnlyReviewCapabilityFor?: (provider: string) => Promise<unknown>,
        ) => Promise<unknown>;
      }).dispatchInstalledBuildReviewPolicy(entry, {
        sourceSnapshot: { contentDigest: 'sha256:source', mergeBase: 'base', headSha: 'head', digest: 'sha256:snapshot', sourceChanges: [] },
      }, 'lap-a237011e9f263dd47ca1a2c7cfe929865c2e99b8', undefined, undefined, async (provider) => ({
        provider, platform: process.platform, status: 'available' as const,
      }));
      const options = invoke.mock.calls[0]?.[0];

      expect(options?.nativeSchema).toBe(entry.contract.output.jsonSchema);
      expect(options?.prompt.indexOf('# policy bundle')).toBeLessThan(options?.prompt.indexOf('/custom-policy') ?? -1);
      expect(options?.prompt).toContain('`sentinel`');
      expect(options?.prompt).toContain('`selected-custom-contract`');
      expect(buildProjection).toHaveBeenCalledWith({
        contentDigest: 'sha256:source', mergeBase: 'base', headSha: 'head', changes: [],
      });
      expect(outcome).toMatchObject({ success: true, id: 'custom-policy' });
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('settles a custom adapter structured-result marker as invalid-structured-result', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'build-review-custom-structured-failure-'));
    const runtimeProvider: LLMProvider = {
      lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
      invoke: vi.fn(async () => ({
        success: false, output: 'terminal result record is missing its structured result', exitCode: 0,
        structuredResultFailure: 'missing' as const,
      })),
    };
    const entry: ResolvedBuildReviewCustomCatalogEntry = {
      id: 'custom-policy', kind: 'custom', skill: 'custom-policy', question: 'Review the fixture.', resources: [],
      policy: branch.policy, contract: BUILD_REVIEW_CUSTOM_V1_CONTRACT,
    };
    const runner = new DefaultStepRunner({ invoke: vi.fn() }, 'custom-structured-failure', projectDir, {
      gitRunner: async () => ({ exitCode: 1, stdout: '', stderr: '' }),
      config: { llm_provider: ['claude'] } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([{
        key: 'claude', provider: runtimeProvider, lifecycleCapability: runtimeProvider.lifecycleCapability,
        nativeSchemaCapability: runtimeProvider.nativeSchemaCapability,
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
        dispatchInstalledBuildReviewPolicy: (
          entry: ResolvedBuildReviewCustomCatalogEntry,
          inputs: unknown,
          lapId: string,
          tier?: unknown,
          lapGate?: unknown,
          readOnlyReviewCapabilityFor?: (provider: string) => Promise<unknown>,
        ) => Promise<unknown>;
      }).dispatchInstalledBuildReviewPolicy(entry, {
        sourceSnapshot: { contentDigest: 'sha256:source', mergeBase: 'base', headSha: 'head', digest: 'sha256:snapshot', sourceChanges: [] },
      }, 'lap-a237011e9f263dd47ca1a2c7cfe929865c2e99b8', undefined, undefined, async (provider) => ({
        provider, platform: process.platform, status: 'available' as const,
      }));

      expect(outcome).toMatchObject({
        success: true,
        member: { result: { kind: 'infrastructure-failure', reason: 'invalid-structured-result' } },
      });
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});
