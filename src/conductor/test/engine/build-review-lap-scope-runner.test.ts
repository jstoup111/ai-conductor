// Covers: task:6, task:25
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, mkdtemp, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { parseChildId, type ChildId } from '../../src/engine/child-context.js';
import { coordinateBuildReviewRubrics } from '../../src/engine/build-review-coordinator.js';
import { BuildReviewDispositionStore } from '../../src/engine/build-review-dispositions.js';
import { canonicalizeBuildReviewFindingIdentity } from '../../src/engine/build-review-finding-identity.js';
import { deriveEffectiveBuildReviewVerdict, isBuildReviewFindingOutOfDelta } from '../../src/engine/build-review-aggregate.js';
import { deriveChangedFileReferences } from '../../src/engine/build-review-projections.js';
import { joinBuildReviewRubricOutcomes, projectBuildReviewAggregateSources } from '../../src/engine/build-review-aggregate.js';
import { buildReviewAdjudicationSourceId } from '../../src/engine/build-review-adjudication-context.js';
import { readBuildReviewAdjudicationArtifactFacts } from '../../src/engine/conductor.js';
import { writeBuildReviewBranchArtifact } from '../../src/engine/build-review-artifacts.js';
import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import { decideBuildReviewReviewScope, settledBuildReviewHunks } from '../../src/engine/build-review-review-frontier.js';
import { resolveBuildReviewConfig } from '../../src/engine/resolved-config.js';
import { CLAUDE_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { InvokeResult, LLMProvider } from '../../src/execution/llm-provider.js';
import type { ConductorEvent } from '../../src/types/events.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { BUILD_REVIEW_CUSTOM_V1_CONTRACT } from '../../src/engine/build-review-policy-resolver.js';
import type { ResolvedBuildReviewCustomCatalogEntry } from '../../src/engine/resolved-config.js';

vi.mock('../../src/engine/build-review-coordinator.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/build-review-coordinator.js')>(),
  coordinateBuildReviewRubrics: vi.fn(),
}));

vi.mock('../../src/engine/build-review-review-frontier.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/build-review-review-frontier.js')>();
  return { ...actual, settledBuildReviewHunks: vi.fn(actual.settledBuildReviewHunks) };
});

const IMPLEMENTATION_QUALITY = 'implementationQuality' as const;
const DIFF = [
  'diff --git a/src/example.ts b/src/example.ts',
  '@@ -1 +1 @@',
  '-export const example = false;',
  '+export const example = true;',
].join('\n');
const engineIdentity = {
  engineStamp: 'scope-runner-fixture',
  skillDigests: { implementationQuality: { kind: 'resolved' as const, digest: 'sha256:scope-runner-policy' } },
};

describe('build_review lap scope runner', () => {
  let projectDir: string;
  let events: ConductorEvent[];
  let emitter: ConductorEventEmitter;
  let runner: DefaultStepRunner;
  let config: ReturnType<typeof resolveBuildReviewConfig>;
  let effectiveResolverCalls: unknown[][];

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'build-review-lap-scope-runner-'));
    events = [];
    effectiveResolverCalls = [];
    emitter = new ConductorEventEmitter();
    emitter.on('build_review_review_scope', (event) => { events.push(event); });
    config = resolveBuildReviewConfig({
      build_review: {
        enabled: true,
        rubrics: {
          testQuality: { enabled: false },
          security: { enabled: false },
          implementationQuality: { enabled: true },
        },
      },
    } as HarnessConfig, CLAUDE_MODEL_POLICY);
    const provider: LLMProvider = { invoke: vi.fn() };
    runner = new DefaultStepRunner(provider, 'scope-runner', projectDir, {
      config: {} as HarnessConfig,
      events: emitter,
      buildReviewEffectiveResolver: async (...args) => {
        effectiveResolverCalls.push(args);
        return {
        ok: true as const,
        feature: { version: 'v1' as const, repository: projectDir, feature: 'scope-runner' },
        effective: {
          rawVerdict: 'PASS' as const, verdict: 'PASS' as const,
          acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [],
          skippedRubrics: [], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [],
          uncoveredScopeIncompleteRubrics: [],
        },
        };
      },
    });
    vi.spyOn(runner as any, 'resolveBuildReviewEngineIdentity').mockResolvedValue(engineIdentity as never);
    vi.spyOn(runner as any, 'resolvedAppliedBuildReviewActSourceIds').mockResolvedValue(new Set());
    vi.spyOn(runner as any, 'liveBuildReviewActSourceIds').mockResolvedValue({
      unappliedLiveSourceIds: new Set(), appliedLiveSourceIds: new Set(),
    });
    vi.mocked(coordinateBuildReviewRubrics).mockReset();
    vi.mocked(settledBuildReviewHunks).mockClear();
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  function installJudgedDispatch(): void {
    vi.mocked(coordinateBuildReviewRubrics).mockImplementation(async (input) => {
      const scope = input.reviewScopes?.[IMPLEMENTATION_QUALITY]!;
      const result = {
        kind: 'judged' as const,
        rubric: IMPLEMENTATION_QUALITY,
        lapId: input.lapId,
        snapshotDigest: input.inputs.sourceSnapshot.digest,
        contractVersion: 'v4' as const,
        findings: [],
        verdict: 'PASS' as const,
      };
      await input.writeArtifact({
        rubric: IMPLEMENTATION_QUALITY,
        lapId: input.lapId,
        snapshotDigest: input.inputs.sourceSnapshot.digest,
        result,
        provenance: { kind: 'fresh' },
        reviewScope: scope,
      });
      return {
        kind: 'ready',
        branches: [
          { kind: 'skipped', rubric: 'testQuality', reason: 'disabled' },
          { kind: 'skipped', rubric: 'security', reason: 'disabled' },
          { kind: 'dispatched', rubric: IMPLEMENTATION_QUALITY, result },
        ],
      } as never;
    });
  }

  function installInfrastructureFailure(): void {
    vi.mocked(coordinateBuildReviewRubrics).mockResolvedValue({
      kind: 'ready',
      branches: [
        { kind: 'skipped', rubric: 'testQuality', reason: 'disabled' },
        { kind: 'skipped', rubric: 'security', reason: 'disabled' },
        { kind: 'infrastructure-failure', rubric: IMPLEMENTATION_QUALITY, reason: 'provider-error', detail: 'fixture outage' },
      ],
    } as never);
  }

  async function run(headSha: string, mergeBase = 'a'.repeat(40), child?: ChildId): Promise<void> {
    await expect((runner as never as { runRubricBuildReviewInner: (...args: unknown[]) => Promise<unknown> })
      .runRubricBuildReviewInner({
        sourceSnapshot: { digest: `sha256:${headSha}`, mergeBase, headSha, diff: DIFF },
      }, config, 'M', 'plan.md', undefined, undefined, child)).resolves.toMatchObject({ success: true });
  }

  function artifactPath(headSha: string, child?: ChildId): string {
    return child === undefined
      ? join(projectDir, '.pipeline', 'build-review', `lap-${headSha}`, `${IMPLEMENTATION_QUALITY}.json`)
      : join(projectDir, '.pipeline', 'children', String(child), 'build-review', `lap-${headSha}`, `${IMPLEMENTATION_QUALITY}.json`);
  }

  async function artifact(headSha: string, child?: ChildId): Promise<any> {
    return JSON.parse(await readFile(artifactPath(headSha, child), 'utf8'));
  }

  it('records and announces a full first lap followed by a delta lap', async () => {
    installJudgedDispatch();
    const firstHead = '1'.repeat(40);
    const secondHead = '2'.repeat(40);

    await run(firstHead);
    await run(secondHead);

    expect((await artifact(firstHead)).reviewScope).toMatchObject({ mode: 'full', reason: 'first-lap', sequence: 1 });
    expect((await artifact(secondHead)).reviewScope).toMatchObject({
      mode: 'delta', reason: 'delta', sequence: 2, predecessorLapId: `lap-${firstHead}`,
    });
    expect(events).toEqual([
      expect.objectContaining({ type: 'build_review_review_scope', rubric: IMPLEMENTATION_QUALITY, lapId: `lap-${firstHead}`, mode: 'full', reason: 'first-lap' }),
      expect.objectContaining({ type: 'build_review_review_scope', rubric: IMPLEMENTATION_QUALITY, lapId: `lap-${secondHead}`, mode: 'delta', reason: 'delta' }),
    ]);
  });

  it('uses a full scope when a restacked child has a new merge base', async () => {
    installJudgedDispatch();
    const child = parseChildId(1)!;
    await run('3'.repeat(40), 'a'.repeat(40), child);
    // The restack's feature-repair kickback presents the child runner with a
    // new merge base; child-local artifacts must not borrow root-lap scope.
    await run('4'.repeat(40), 'b'.repeat(40), child);

    expect((await artifact('4'.repeat(40), child)).reviewScope).toMatchObject({
      mode: 'full', reason: 'merge-base-changed', sequence: 2, mergeBase: 'b'.repeat(40),
    });
  });

  // Covers: S1.1, task:rem-prd-audit-6.r1
  it('uses the whole-feature snapshot for a stacked leaf security scope without widening other rubrics', async () => {
    const child = parseChildId(1)!;
    const childHead = 'c'.repeat(40);
    const wholeFeatureHead = 'd'.repeat(40);
    const childMergeBase = 'a'.repeat(40);
    const wholeFeatureMergeBase = 'b'.repeat(40);
    const wholeFeatureDiff = [
      DIFF,
      'diff --git a/src/earlier.ts b/src/earlier.ts',
      '@@ -1 +1 @@',
      '-export const earlier = false;',
      '+export const earlier = true;',
    ].join('\n');
    config = resolveBuildReviewConfig({
      build_review: {
        enabled: true,
        rubrics: {
          testQuality: { enabled: false },
          security: { enabled: true },
          implementationQuality: { enabled: true },
        },
      },
    } as HarnessConfig, CLAUDE_MODEL_POLICY);
    vi.mocked(coordinateBuildReviewRubrics).mockImplementation(async (input) => {
      const branches = await Promise.all((["security", IMPLEMENTATION_QUALITY] as const).map(async (rubric) => {
        const snapshotDigest = rubric === 'security'
          ? input.inputs.securitySourceSnapshot!.digest
          : input.inputs.sourceSnapshot.digest;
        const result = {
          kind: 'judged' as const, rubric, lapId: input.lapId, snapshotDigest,
          contractVersion: 'v4' as const, findings: [], verdict: 'PASS' as const,
        };
        await input.writeArtifact({
          rubric, lapId: input.lapId, snapshotDigest, result,
          provenance: { kind: 'fresh' }, reviewScope: input.reviewScopes![rubric]!,
        });
        return { kind: 'dispatched' as const, rubric, result };
      }));
      return {
        kind: 'ready',
        branches: [{ kind: 'skipped', rubric: 'testQuality', reason: 'disabled' }, ...branches],
      } as never;
    });

    await expect((runner as never as { runRubricBuildReviewInner: (...args: unknown[]) => Promise<unknown> })
      .runRubricBuildReviewInner({
        sourceSnapshot: {
          digest: `sha256:${childHead}`, mergeBase: childMergeBase, headSha: childHead, diff: DIFF,
        },
        securitySourceSnapshot: {
          digest: `sha256:${wholeFeatureHead}`, mergeBase: wholeFeatureMergeBase, headSha: wholeFeatureHead, diff: wholeFeatureDiff,
        },
      }, config, 'M', 'plan.md', undefined, undefined, child)).resolves.toMatchObject({ success: true });

    const readScope = async (rubric: typeof IMPLEMENTATION_QUALITY | 'security') => JSON.parse(await readFile(
      join(projectDir, '.pipeline', 'children', String(child), 'build-review', `lap-${childHead}`, `${rubric}.json`),
      'utf8',
    )).reviewScope;
    const wholeFeatureHunks = deriveChangedFileReferences(wholeFeatureDiff).flatMap((file) =>
      file.hunks.map((hunk) => ({ path: file.path, contentHash: hunk.contentHash })),
    );
    const childHunks = deriveChangedFileReferences(DIFF).flatMap((file) =>
      file.hunks.map((hunk) => ({ path: file.path, contentHash: hunk.contentHash })),
    );

    await expect(readScope('security')).resolves.toMatchObject({
      mode: 'full', reason: 'first-lap', mergeBase: wholeFeatureMergeBase, headSha: wholeFeatureHead,
      reviewedHunks: wholeFeatureHunks, deltaHunks: wholeFeatureHunks,
    });
    await expect(readScope(IMPLEMENTATION_QUALITY)).resolves.toMatchObject({
      mode: 'full', reason: 'first-lap', mergeBase: childMergeBase, headSha: childHead,
      reviewedHunks: childHunks, deltaHunks: childHunks,
    });
    expect(vi.mocked(settledBuildReviewHunks)).toHaveBeenCalledWith(expect.objectContaining({
      mergeBase: wholeFeatureMergeBase,
      changedFiles: deriveChangedFileReferences(wholeFeatureDiff),
    }));
    const effectiveScopes = (effectiveResolverCalls[0]![2] as { scopes: Record<string, { changedFiles: unknown }> }).scopes;
    expect(effectiveScopes.security!.changedFiles).toEqual(deriveChangedFileReferences(wholeFeatureDiff));
    expect(effectiveScopes.implementationQuality!.changedFiles).toEqual(deriveChangedFileReferences(DIFF));
  });

  it('records an unreadable prior scope once without altering the corrupt artifact', async () => {
    installJudgedDispatch();
    const corruptHead = '5'.repeat(40);
    const corruptPath = artifactPath(corruptHead);
    await mkdir(join(projectDir, '.pipeline', 'build-review', `lap-${corruptHead}`), { recursive: true });
    const corrupt = JSON.stringify({
      version: 2, rubric: IMPLEMENTATION_QUALITY, lapId: `lap-${corruptHead}`, snapshotDigest: `sha256:${corruptHead}`,
      result: { kind: 'judged', rubric: IMPLEMENTATION_QUALITY, lapId: `lap-${corruptHead}`, snapshotDigest: `sha256:${corruptHead}`, contractVersion: 'v4', findings: [], verdict: 'PASS' },
      provenance: { kind: 'fresh' }, reviewScope: { mode: 'unknown' },
    });
    await writeFile(corruptPath, corrupt, 'utf8');

    await run('6'.repeat(40));

    expect(await readFile(corruptPath, 'utf8')).toBe(corrupt);
    expect((await artifact('6'.repeat(40))).reviewScope).toMatchObject({
      mode: 'full', reason: 'record-unreadable', unreadableLapIds: [`lap-${corruptHead}`],
    });
  });

  it('rewrites the current-lap hunk evidence unchanged for a disposition-only rejoin', async () => {
    installJudgedDispatch();
    const head = '7'.repeat(40);
    await run(head);
    const firstScope = (await artifact(head)).reviewScope;

    await run(head);

    const replayScope = (await artifact(head)).reviewScope;
    expect(replayScope).toEqual(firstScope);
    expect(replayScope).toMatchObject({
      sequence: 1, mode: 'full', reason: 'first-lap',
      reviewedHunks: firstScope.reviewedHunks,
      deltaHunks: firstScope.deltaHunks,
    });
  });

  it('rewrites the current-lap hunk evidence unchanged after a mechanical-fault rejoin', async () => {
    const head = 'b'.repeat(40);
    installJudgedDispatch();
    await run(head);
    const firstScope = (await artifact(head)).reviewScope;

    installInfrastructureFailure();
    await expect((runner as never as { runRubricBuildReviewInner: (...args: unknown[]) => Promise<unknown> })
      .runRubricBuildReviewInner({ sourceSnapshot: {
        digest: `sha256:${head}`, mergeBase: 'a'.repeat(40), headSha: head, diff: DIFF,
      } }, config, 'M', 'plan.md')).resolves.toMatchObject({ success: false, currentLapMechanicalFault: true });

    installJudgedDispatch();
    await run(head);

    expect((await artifact(head)).reviewScope).toMatchObject({
      sequence: firstScope.sequence,
      reviewedHunks: firstScope.reviewedHunks,
      deltaHunks: firstScope.deltaHunks,
    });
  });

  it('does not persist a scope or settle hunks when a custom dispatch ends in infrastructure failure', async () => {
    const failedHead = '8'.repeat(40);
    installInfrastructureFailure();

    await expect((runner as never as { runRubricBuildReviewInner: (...args: unknown[]) => Promise<unknown> })
      .runRubricBuildReviewInner({ sourceSnapshot: {
        digest: `sha256:${failedHead}`, mergeBase: 'a'.repeat(40), headSha: failedHead, diff: DIFF,
      } }, config, 'M', 'plan.md')).resolves.toMatchObject({ success: false, currentLapMechanicalFault: true });
    await expect(readFile(artifactPath(failedHead), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    installJudgedDispatch();
    vi.mocked(settledBuildReviewHunks).mockClear();
    await run('9'.repeat(40));
    expect(vi.mocked(settledBuildReviewHunks)).toHaveBeenCalledOnce();
    expect(vi.mocked(settledBuildReviewHunks).mock.calls[0]![0].laps).toEqual([]);
    expect(vi.mocked(settledBuildReviewHunks).mock.results[0]!.value).toEqual([]);
    expect((await artifact('9'.repeat(40))).reviewScope).toMatchObject({
      mode: 'full', reason: 'first-lap', sequence: 1,
    });
  });

  it('records the fallback judge identity and fully re-reviews when the configured candidate would otherwise settle the lap', async () => {
    const rubric = 'portable';
    const candidateModel = 'candidate-a';
    const fallbackModel = 'fallback-b';
    const policyRoot = join(projectDir, 'policy');
    const source = {
      identity: { snapshotDigest: `sha256:${'e'.repeat(64)}`, contentDigest: `sha256:${'f'.repeat(64)}`, mergeBase: 'a'.repeat(40), headSha: 'ignored' },
      baselinePath: join(projectDir, 'baseline'),
      headPath: join(projectDir, 'head'),
    };
    await Promise.all([mkdir(policyRoot, { recursive: true }), mkdir(source.baselinePath, { recursive: true }), mkdir(source.headPath, { recursive: true })]);
    let candidateUnavailable = true;
    const invoke = vi.fn<LLMProvider['invoke']>(async (options): Promise<InvokeResult> => options.model === candidateModel && candidateUnavailable
      ? (candidateUnavailable = false, { success: false, exitCode: 1, output: '', modelUnavailable: true })
      : {
          success: true, exitCode: 0, output: 'fixture judgment',
          finalStructuredResult: { kind: 'custom-findings', version: 'v2', findings: [] },
        });
    const provider: LLMProvider = {
      lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
      invoke,
    };
    const customConfig = resolveBuildReviewConfig({
      build_review: {
        enabled: true,
        rubrics: { testQuality: { enabled: false }, security: { enabled: false }, implementationQuality: { enabled: false } },
        custom_rubrics: {
          [rubric]: {
            enabled: true, skill: 'portable-policy', question: 'Review the fixture.', source: 'project',
            llm_provider: 'claude', model: candidateModel, model_fallback_ladder: [candidateModel, fallbackModel],
          },
        },
      },
    } as HarnessConfig, CLAUDE_MODEL_POLICY);
    const availability = new ModelAvailability([candidateModel, fallbackModel]);
    const customRunner = new DefaultStepRunner(provider, 'scope-runner', projectDir, {
      config: { build_review: { enabled: true } } as HarnessConfig,
      events: emitter,
      providerRuntimes: new ProviderRuntimeSet([{
        key: 'claude', provider, lifecycleCapability: provider.lifecycleCapability,
        nativeSchemaCapability: provider.nativeSchemaCapability, policy: CLAUDE_MODEL_POLICY, builtIn: true,
        availability,
      }]),
      sessionStore: new ProviderSessionStore(),
      buildReviewPolicyCatalog: async ({ skill }) => [{
        semanticName: skill, source: 'project', installationOrigin: policyRoot,
        canonicalSkillPath: join(policyRoot, 'SKILL.md'), packageRoot: policyRoot,
        declaredDependencies: [], availability: 'available' as const,
      }],
      buildReviewPolicyCapture: async (policy) => ({
        policy, materialPath: policyRoot, definitionPath: join(policyRoot, 'SKILL.md'),
        manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Policy\n') }],
        metadata: { version: 1 as const, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] },
        digest: `sha256:${'c'.repeat(64)}`,
      }),
      buildReviewEffectiveResolver: async () => ({
        ok: true as const,
        feature: { version: 'v1' as const, repository: projectDir, feature: 'scope-runner' },
        effective: {
          rawVerdict: 'PASS' as const, verdict: 'PASS' as const,
          acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [],
          skippedRubrics: [], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [],
          uncoveredScopeIncompleteRubrics: [],
        },
      }),
    });
    vi.spyOn(customRunner as any, 'resolveBuildReviewEngineIdentity').mockResolvedValue(engineIdentity as never);
    vi.spyOn(customRunner as any, 'resolvedAppliedBuildReviewActSourceIds').mockResolvedValue(new Set());
    vi.spyOn(customRunner as any, 'liveBuildReviewActSourceIds').mockResolvedValue({
      unappliedLiveSourceIds: new Set(), appliedLiveSourceIds: new Set(),
    });
    const runCustom = async (headSha: string) => {
      const result = await (customRunner as never as {
        runRubricBuildReviewInner: (...args: unknown[]) => Promise<unknown>;
      }).runRubricBuildReviewInner({
        sourceSnapshot: {
          digest: `sha256:${headSha}`, contentDigest: `sha256:${'f'.repeat(64)}`, mergeBase: 'a'.repeat(40), headSha, diff: DIFF,
          sourceChanges: [],
        },
        sourceMaterialization: {
          source, contextFor: (memberId: string) => ({ memberId, source }), settle: async () => {},
        },
      }, customConfig, 'M', 'plan.md');
      expect(result).toMatchObject({ success: true });
    };
    const scopeFor = async (headSha: string) => JSON.parse(await readFile(
      join(projectDir, '.pipeline', 'build-review', `lap-${headSha}`, `${rubric}.json`), 'utf8',
    )).reviewScope;

    const firstHead = 'c'.repeat(40);
    const secondHead = 'd'.repeat(40);
    await runCustom(firstHead);
    availability.dead.clear();
    await runCustom(secondHead);

    expect(await scopeFor(firstHead)).toMatchObject({ mode: 'full', policyIdentity: expect.any(String) });
    expect(await scopeFor(secondHead)).toMatchObject({ mode: 'full', reason: 'version-changed' });
    expect((await scopeFor(firstHead)).policyIdentity).not.toBe((await scopeFor(secondHead)).policyIdentity);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(invoke.mock.calls.map(([options]) => options.model)).toEqual([candidateModel, fallbackModel, candidateModel]);
  });
});

const provider: LLMProvider = {
  lifecycleCapability: { synchronousSpawnPermit: true },
  invoke: async () => ({ success: true, output: '', exitCode: 0 }),
};

const scopeConfig = resolveBuildReviewConfig({
  llm_provider: 'claude',
  build_review: {
    enabled: true,
    rubrics: {
      testQuality: { enabled: false },
      security: { enabled: false },
      implementationQuality: { enabled: true },
    },
  },
} as HarnessConfig);

const scopeDiff = [
  'diff --git a/src/scope.ts b/src/scope.ts',
  '@@ -0,0 +1 @@',
  '+export const scope = true;',
].join('\n');

function scopeInput(headSha: string, mergeBase = 'base') {
  return {
    sourceSnapshot: {
      digest: `sha256:${headSha}`,
      contentDigest: 'sha256:scope-content',
      mergeBase,
      headSha,
      diff: scopeDiff,
      sourceChanges: [],
    },
  };
}

function scopeRunner(dir: string, events?: ConductorEventEmitter) {
  const runner = new DefaultStepRunner(provider, 'scope-runner', dir, {
    events,
    buildReviewEffectiveResolver: async (_root, aggregate, deps) => ({
      ok: true as const,
      feature: { version: 'v1', repository: dir, feature: 'scope-runner' },
      effective: deriveEffectiveBuildReviewVerdict(
        aggregate,
        new Set(),
        [],
        {},
        new Set(),
        {},
        deps.scopes as never,
      )!,
    }),
  });
  vi.spyOn(runner as any, 'resolveBuildReviewEngineIdentity').mockResolvedValue({
    engineStamp: 'scope-engine',
    skillDigests: { implementationQuality: { kind: 'resolved', digest: 'sha256:scope-policy' } },
  });
  vi.spyOn(runner as any, 'dispatchBuildReviewRubric').mockImplementation(async (_branch: unknown, projection: any) => ({
    kind: 'judged',
    rubric: 'implementationQuality',
    lapId: projection.lapId,
    snapshotDigest: projection.snapshotDigest,
    contractVersion: 'v4',
    findings: [],
    verdict: 'PASS',
  }));
  return runner;
}

async function runScopeLap(runner: DefaultStepRunner, input: ReturnType<typeof scopeInput>) {
  return (runner as unknown as {
    runRubricBuildReview(inputs: unknown, config: unknown, tier: 'S'): Promise<unknown>;
  }).runRubricBuildReview(input, scopeConfig, 'S');
}

function artifactPath(root: string, headSha: string) {
  return join(root, '.pipeline', 'build-review', `lap-${headSha}`, 'implementationQuality.json');
}

describe('build-review lap scope runner', () => {
  beforeEach(async () => {
    // This suite drives the real coordinator; the module mock above belongs to
    // the scope-decision suite, which installs its own dispatch per test.
    const actual = await vi.importActual<typeof import('../../src/engine/build-review-coordinator.js')>('../../src/engine/build-review-coordinator.js');
    vi.mocked(coordinateBuildReviewRubrics).mockImplementation(actual.coordinateBuildReviewRubrics);
  });

  it('supplies per-source predecessor provenance and historical finding digests from conductor-owned artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'build-review-conductor-artifacts-'));
    try {
      const l1 = parseBuildReviewLapId('lap-artifact-l1')!;
      const l2 = parseBuildReviewLapId('lap-artifact-l2')!;
      const h1 = `sha256:${'1'.repeat(64)}`;
      const h2 = `sha256:${'2'.repeat(64)}`;
      const first = {
        concernKind: 'obscured-intent', severity: 'major' as const, summary: 'Original repair target.', evidenceLocations: ['src/feature.ts:1'],
        anchor: { rubric: 'implementationQuality' as const, locus: { path: 'src/feature.ts', contentHash: h1, display: 'src/feature.ts:1' } },
      };
      const recurrence = {
        concernKind: 'duplication', severity: 'major' as const, summary: 'Repair introduced a new defect.', evidenceLocations: ['src/feature.ts:2'],
        anchor: { rubric: 'implementationQuality' as const, locus: { path: 'src/feature.ts', contentHash: h2, display: 'src/feature.ts:2' } },
      };
      const filesystem = {
        readFile: (path: string) => readFile(path, 'utf8'),
        mkdir: async (path: string) => { await mkdir(path, { recursive: true }); },
        writeFile,
        rename,
      };
      await writeBuildReviewBranchArtifact(root, {
        rubric: 'implementationQuality', lapId: l1, snapshotDigest: 'sha256:l1',
        result: { kind: 'judged', rubric: 'implementationQuality', lapId: l1, snapshotDigest: 'sha256:l1', contractVersion: 'v4', findings: [first], verdict: 'FAIL' },
        provenance: { kind: 'fresh' },
        reviewScope: { mode: 'full', reason: 'first-lap', sequence: 1, unreadableLapIds: [], mergeBase: 'base', headSha: 'l1', policyIdentity: 'policy', reviewedHunks: [{ path: 'src/feature.ts', contentHash: h1 }], deltaHunks: [{ path: 'src/feature.ts', contentHash: h1 }], outOfDeltaSourceIds: [] },
      }, filesystem);
      await writeBuildReviewBranchArtifact(root, {
        rubric: 'implementationQuality', lapId: l2, snapshotDigest: 'sha256:l2',
        result: { kind: 'judged', rubric: 'implementationQuality', lapId: l2, snapshotDigest: 'sha256:l2', contractVersion: 'v4', findings: [recurrence], verdict: 'FAIL' },
        provenance: { kind: 'fresh' },
        reviewScope: { mode: 'delta', reason: 'delta', sequence: 2, unreadableLapIds: [], mergeBase: 'base', headSha: 'l2', policyIdentity: 'policy', predecessorLapId: l1, reviewedHunks: [{ path: 'src/feature.ts', contentHash: h1 }, { path: 'src/feature.ts', contentHash: h2 }], deltaHunks: [{ path: 'src/feature.ts', contentHash: h2 }], outOfDeltaSourceIds: [] },
      }, filesystem);
      const aggregate = joinBuildReviewRubricOutcomes({
        lapId: l2, snapshotDigest: 'sha256:l2',
        results: { implementationQuality: { kind: 'judged', rubric: 'implementationQuality', lapId: l2, snapshotDigest: 'sha256:l2', contractVersion: 'v4', findings: [recurrence], verdict: 'FAIL' }, testQuality: { kind: 'skipped', rubric: 'testQuality', reason: 'disabled' } },
      });

      const facts = await readBuildReviewAdjudicationArtifactFacts(root, aggregate, {
        changedFilesForArtifact: async () => [{
          path: 'src/feature.ts', changeKind: 'modified', hunks: [{
            oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, contentHash: h2,
          }],
        }],
      });
      const [firstSource] = projectBuildReviewAggregateSources(joinBuildReviewRubricOutcomes({
        lapId: l1, snapshotDigest: 'sha256:l1',
        results: { implementationQuality: { kind: 'judged', rubric: 'implementationQuality', lapId: l1, snapshotDigest: 'sha256:l1', contractVersion: 'v4', findings: [first], verdict: 'FAIL' }, testQuality: { kind: 'skipped', rubric: 'testQuality', reason: 'disabled' } },
      }))!.filter((source) => source.rubric === 'implementationQuality');
      const [currentSource] = projectBuildReviewAggregateSources(aggregate)!.filter((source) => source.rubric === 'implementationQuality');

      expect(facts.priorFindingDigests.get(buildReviewAdjudicationSourceId(firstSource!))).toMatchObject({ summary: first.summary, lapId: l1 });
      expect(facts.provenance?.sources[buildReviewAdjudicationSourceId(currentSource!)]).toMatchObject({
        deltaHunks: [{ path: 'src/feature.ts', contentHash: h2 }],
        predecessorArtifacts: [expect.objectContaining({ lapId: l1 })],
        targets: [{ kind: 'hunks', hunks: [{ path: 'src/feature.ts', contentHash: h2 }] }],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // Covers: task:20, task:26
  it('maps a test-quality region to its frozen diff hunk before selecting provenance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'build-review-region-provenance-'));
    try {
      const l1 = parseBuildReviewLapId('lap-region-l1')!;
      const l2 = parseBuildReviewLapId('lap-region-l2')!;
      const hunk = `sha256:${'7'.repeat(64)}`;
      const finding = {
        concernKind: 'test-insensitive', severity: 'major' as const, summary: 'The changed test accepts a reverted implementation.',
        evidenceLocations: ['test/feature.test.ts:12'],
        anchor: { rubric: 'testQuality' as const, locus: {
          path: 'test/feature.test.ts', contentHash: 'sha256:test-title', display: 'preserves feature behavior', startLine: 12, endLine: 12,
        } },
      };
      const filesystem = { readFile: (path: string) => readFile(path, 'utf8'), mkdir: async (path: string) => { await mkdir(path, { recursive: true }); }, writeFile, rename };
      await writeBuildReviewBranchArtifact(root, {
        rubric: 'testQuality', lapId: l1, snapshotDigest: 'sha256:region-l1',
        result: { kind: 'judged', rubric: 'testQuality', lapId: l1, snapshotDigest: 'sha256:region-l1', contractVersion: 'v4', findings: [], verdict: 'PASS' },
        provenance: { kind: 'fresh' },
        reviewScope: { mode: 'full', reason: 'first-lap', sequence: 1, unreadableLapIds: [], mergeBase: 'base', headSha: 'l1', policyIdentity: 'policy', reviewedHunks: [], deltaHunks: [], outOfDeltaSourceIds: [] },
      }, filesystem);
      await writeBuildReviewBranchArtifact(root, {
        rubric: 'testQuality', lapId: l2, snapshotDigest: 'sha256:region-l2',
        result: { kind: 'judged', rubric: 'testQuality', lapId: l2, snapshotDigest: 'sha256:region-l2', contractVersion: 'v4', findings: [finding], verdict: 'FAIL' },
        provenance: { kind: 'fresh' },
        reviewScope: { mode: 'delta', reason: 'delta', sequence: 2, unreadableLapIds: [], mergeBase: 'base', headSha: 'l2', policyIdentity: 'policy', predecessorLapId: l1, reviewedHunks: [{ path: 'test/feature.test.ts', contentHash: hunk }], deltaHunks: [{ path: 'test/feature.test.ts', contentHash: hunk }], outOfDeltaSourceIds: [] },
      }, filesystem);
      const aggregate = joinBuildReviewRubricOutcomes({
        lapId: l2, snapshotDigest: 'sha256:region-l2',
        results: { testQuality: { kind: 'judged', rubric: 'testQuality', lapId: l2, snapshotDigest: 'sha256:region-l2', contractVersion: 'v4', findings: [finding], verdict: 'FAIL' }, security: { kind: 'skipped', rubric: 'security', reason: 'disabled' } },
      });
      const [source] = projectBuildReviewAggregateSources(aggregate)!.filter((candidate) => candidate.rubric === 'testQuality');
      const facts = await readBuildReviewAdjudicationArtifactFacts(root, aggregate, {
        changedFilesForArtifact: async () => [{ path: 'test/feature.test.ts', changeKind: 'modified', hunks: [{ oldStart: 10, oldCount: 1, newStart: 10, newCount: 4, contentHash: hunk }] }],
      });

      expect(facts.provenance?.sources[buildReviewAdjudicationSourceId(source!)]?.targets).toEqual([
        { kind: 'hunks', hunks: [{ path: 'test/feature.test.ts', contentHash: hunk }] },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps an exactly operator-accepted hunk out of later laps, records a differently worded re-raise as out of delta, and does not charge remediation', async () => {
    const main = await mkdtemp(join(tmpdir(), 'build-review-lap-scope-main-'));
    const projectRoot = join(main, '.worktrees', 'feature');
    try {
      await execa('git', ['init', '--initial-branch=main'], { cwd: main });
      await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: main });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: main });
      await execa('git', ['commit', '--allow-empty', '-m', 'initial'], { cwd: main });
      await execa('git', ['worktree', 'add', '-b', 'feature', projectRoot], { cwd: main });

      const config = resolveBuildReviewConfig({
        llm_provider: 'claude',
        build_review: {
          enabled: true,
          rubrics: { testQuality: { enabled: false }, security: { enabled: false }, implementationQuality: { enabled: true } },
        },
      } as HarnessConfig);
      const runner = new DefaultStepRunner(provider, 'lap-scope', projectRoot, {
        buildReviewEffectiveResolver: async (_root, aggregate, deps) => ({
          ok: true,
          feature: { version: 'v1', repository: await realpath(main), feature: 'feature' },
          effective: deriveEffectiveBuildReviewVerdict(aggregate, new Set(), [], {}, new Set(), {}, deps.scopes as never)!,
        }),
      });
      vi.spyOn(runner as any, 'resolveBuildReviewEngineIdentity').mockResolvedValue({
        engineStamp: 'engine', skillDigests: { implementationQuality: { kind: 'resolved', digest: 'sha256:skill' } },
      });
      const calls: unknown[] = [];
      vi.spyOn(runner as any, 'dispatchBuildReviewRubric').mockImplementation(async (_branch: any, projection: any) => {
        calls.push(projection);
        const hunk = projection.changedFiles.find((file: any) => file.path === 'src/feature.ts').hunks[0];
        const repairHunk = projection.changedFiles.find((file: any) => file.path === 'src/repair.ts').hunks[0];
        const l1 = projection.lapId === 'lap-head-l1';
        return {
          kind: 'judged', rubric: 'implementationQuality', lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
          contractVersion: 'v4', findings: l1 ? [{
            concernKind: 'obscured-intent', severity: 'major',
            summary: 'The unchanged implementation needs attention.', evidenceLocations: ['src/feature.ts:1'],
            anchor: { rubric: 'implementationQuality', locus: { path: 'src/feature.ts', contentHash: hunk.contentHash, display: 'src/feature.ts:1' } },
          }, {
            concernKind: 'duplication', severity: 'major', summary: 'The repair still needs work.', evidenceLocations: ['src/repair.ts:1'],
            anchor: { rubric: 'implementationQuality', locus: { path: 'src/repair.ts', contentHash: repairHunk.contentHash, display: 'src/repair.ts:1' } },
          }] : projection.lapId === 'lap-head-l2' ? [{
            concernKind: 'non-semantic-name', severity: 'major', summary: 'A reworded complaint about settled code.', evidenceLocations: ['src/feature.ts:1'],
            anchor: { rubric: 'implementationQuality', locus: { path: 'src/feature.ts', contentHash: hunk.contentHash, display: 'src/feature.ts:1' } },
          }] : [], verdict: l1 || projection.lapId === 'lap-head-l2' ? 'FAIL' : 'PASS',
        };
      });
      const inputs = (headSha: string) => ({ sourceSnapshot: {
        digest: `sha256:${headSha}`, contentDigest: 'sha256:content', mergeBase: 'base', headSha,
        diff: [
          'diff --git a/src/feature.ts b/src/feature.ts\n@@ -0,0 +1 @@\n+export const feature = true;',
          'diff --git a/src/repair.ts b/src/repair.ts\n@@ -0,0 +1 @@\n+export const repair = true;',
        ].join('\n'), sourceChanges: [],
      } });
      const run = (value: unknown) => (runner as unknown as {
        runRubricBuildReview(inputs: unknown, config: unknown, tier: 'S', planPath?: string): Promise<unknown>;
      }).runRubricBuildReview(value, config, 'S');

      await expect(run(inputs('head-l1'))).resolves.toMatchObject({ success: true });
      const first = calls[0] as any;
      const finding = {
        rubric: 'implementationQuality' as const,
        contractVersion: 'v4' as const,
        concernKind: 'obscured-intent',
        anchor: { rubric: 'implementationQuality' as const, locus: { path: 'src/feature.ts', contentHash: first.changedFiles[0].hunks[0].contentHash, display: 'src/feature.ts:1' } },
      };
      const identity = canonicalizeBuildReviewFindingIdentity(finding)!;
      await expect(new BuildReviewDispositionStore(projectRoot).append({
        feature: { version: 'v1', repository: await realpath(main), feature: 'feature' }, finding: identity,
        sourceLapId: parseBuildReviewLapId('lap-head-l1')!, summary: 'accepted', rationale: 'operator decision', operator: 'test',
      })).resolves.toMatchObject({ ok: true });

      await expect(run(inputs('head-l2'))).resolves.toMatchObject({ success: true });
      await expect(run(inputs('head-l3'))).resolves.toMatchObject({ success: true });

      expect(calls).toHaveLength(3);
      expect((calls[1] as any).reviewScope).toMatchObject({
        mode: 'delta', deltaHunks: [{ path: 'src/repair.ts' }],
      });
      expect((calls[2] as any).reviewScope).toMatchObject({
        mode: 'delta', deltaHunks: [{ path: 'src/repair.ts' }],
      });
      const l2 = JSON.parse(await readFile(join(projectRoot, '.pipeline/build-review/lap-head-l2/implementationQuality.json'), 'utf8'));
      expect(l2.result.findings).toMatchObject([{ concernKind: 'non-semantic-name', summary: 'A reworded complaint about settled code.' }]);
      expect(l2.reviewScope).toMatchObject({
        mode: 'delta', deltaHunks: [{ path: 'src/repair.ts' }], outOfDeltaSourceIds: [expect.stringMatching(/^sha256:/)],
      });
      await expect(new BuildReviewDispositionStore(projectRoot).list({
        version: 'v1', repository: await realpath(main), feature: 'feature',
      })).resolves.toMatchObject({ ok: true, records: [expect.any(Object)] });
      await expect(access(join(projectRoot, '.pipeline', 'HALT'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(join(projectRoot, '.pipeline', 'kickback-ledger.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(main, { recursive: true, force: true });
    }
  });

  it('uses a finalized reject case to keep an unchanged hunk out of the next delta lap', () => {
    const h1 = `sha256:${'1'.repeat(64)}`;
    const h2 = `sha256:${'2'.repeat(64)}`;
    const first = {
      concernKind: 'obscured-intent', severity: 'major' as const, summary: 'First wording.', evidenceLocations: ['src/feature.ts:1'],
      anchor: { rubric: 'implementationQuality' as const, locus: { path: 'src/feature.ts', contentHash: h1, display: 'src/feature.ts:1' } },
    };
    const sourceId = canonicalizeBuildReviewFindingIdentity({ rubric: 'implementationQuality', contractVersion: 'v4', concernKind: first.concernKind, anchor: first.anchor })!.id;
    const changedFiles = [{ path: 'src/feature.ts', changeKind: 'modified' as const, hunks: [
      { oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, contentHash: h1 },
      { oldStart: 2, oldCount: 1, newStart: 2, newCount: 1, contentHash: h2 },
    ] }];
    const priorScope = {
      mode: 'full' as const, reason: 'first-lap' as const, sequence: 1, unreadableLapIds: [], mergeBase: 'base', headSha: 'head-l1', policyIdentity: 'policy',
      reviewedHunks: [{ path: 'src/feature.ts', contentHash: h1 }],
      deltaHunks: [{ path: 'src/feature.ts', contentHash: h1 }], outOfDeltaSourceIds: [],
    };
    const settled = settledBuildReviewHunks({
      changedFiles, mergeBase: 'base', policyIdentity: 'policy',
      laps: [{ reviewScope: priorScope, findings: [{ sourceId, finding: first }] }],
      // This is the runner's projection of a judge-finalized `reject` case.
      nonBlockingSourceIds: new Set([sourceId]),
    });
    const l2Scope = decideBuildReviewReviewScope({
      lapId: parseBuildReviewLapId('lap-head-l2')!, changedFiles, mergeBase: 'base', headSha: 'head-l2', policyIdentity: 'policy',
      priorLaps: [{ lapId: parseBuildReviewLapId('lap-head-l1')!, reviewScope: priorScope }], settledHunks: settled, openSourceUnmapped: false,
    })!;
    const reRaise = { ...first, concernKind: 'non-semantic-name', summary: 'Different concern and wording.' };
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId: parseBuildReviewLapId('lap-head-l2')!, snapshotDigest: 'sha256:l2',
      results: {
        implementationQuality: { kind: 'judged', rubric: 'implementationQuality', lapId: parseBuildReviewLapId('lap-head-l2')!, snapshotDigest: 'sha256:l2', contractVersion: 'v4', findings: [reRaise], verdict: 'FAIL' },
        testQuality: { kind: 'skipped', rubric: 'testQuality', reason: 'disabled' },
      },
    });

    expect(l2Scope).toMatchObject({ mode: 'delta', deltaHunks: [{ path: 'src/feature.ts', contentHash: h2 }] });
    expect(deriveEffectiveBuildReviewVerdict(aggregate, new Set(), [], {}, new Set(), {}, {
      implementationQuality: { reviewScope: l2Scope, changedFiles },
    })!).toMatchObject({ verdict: 'PASS', outOfDeltaFindingIds: [expect.stringMatching(/^sha256:/)] });
  });

  it('keeps a judge-rejected hunk out of L2 and L3 without a halt or kickback charge', async () => {
    const main = await mkdtemp(join(tmpdir(), 'build-review-rejected-scope-'));
    const projectRoot = join(main, '.worktrees', 'feature');
    try {
      await execa('git', ['init', '--initial-branch=main'], { cwd: main });
      await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: main });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: main });
      await execa('git', ['commit', '--allow-empty', '-m', 'initial'], { cwd: main });
      await execa('git', ['worktree', 'add', '-b', 'feature', projectRoot], { cwd: main });
      const config = resolveBuildReviewConfig({ llm_provider: 'claude', build_review: { enabled: true, rubrics: { testQuality: { enabled: false }, security: { enabled: false }, implementationQuality: { enabled: true } } } } as HarnessConfig);
      const runner = new DefaultStepRunner(provider, 'rejected-scope', projectRoot, {
        buildReviewEffectiveResolver: async (_root, aggregate, deps) => ({ ok: true, feature: { version: 'v1', repository: await realpath(main), feature: 'feature' }, effective: deriveEffectiveBuildReviewVerdict(aggregate, new Set(), [], {}, new Set(), {}, deps.scopes as never)! }),
      });
      vi.spyOn(runner as any, 'resolveBuildReviewEngineIdentity').mockResolvedValue({ engineStamp: 'engine', skillDigests: { implementationQuality: { kind: 'resolved', digest: 'sha256:skill' } } });
      const calls: any[] = [];
      vi.spyOn(runner as any, 'dispatchBuildReviewRubric').mockImplementation(async (_branch: any, projection: any) => {
        calls.push(projection);
        const h1 = projection.changedFiles.find((file: any) => file.path === 'src/feature.ts').hunks[0];
        const h2 = projection.changedFiles.find((file: any) => file.path === 'src/repair.ts').hunks[0];
        const l1 = projection.lapId === 'lap-reject-l1';
        return { kind: 'judged', rubric: 'implementationQuality', lapId: projection.lapId, snapshotDigest: projection.snapshotDigest, contractVersion: 'v4', verdict: l1 ? 'FAIL' : 'FAIL', findings: l1 ? [
          { concernKind: 'obscured-intent', severity: 'major', summary: 'Original hunk.', evidenceLocations: ['src/feature.ts:1'], anchor: { rubric: 'implementationQuality', locus: { path: 'src/feature.ts', contentHash: h1.contentHash, display: 'src/feature.ts:1' } } },
          { concernKind: 'duplication', severity: 'major', summary: 'Repair hunk.', evidenceLocations: ['src/repair.ts:1'], anchor: { rubric: 'implementationQuality', locus: { path: 'src/repair.ts', contentHash: h2.contentHash, display: 'src/repair.ts:1' } } },
        ] : [{ concernKind: 'non-semantic-name', severity: 'major', summary: 'Different wording after rejection.', evidenceLocations: ['src/feature.ts:1'], anchor: { rubric: 'implementationQuality', locus: { path: 'src/feature.ts', contentHash: h1.contentHash, display: 'src/feature.ts:1' } } }] };
      });
      const input = (headSha: string) => ({ sourceSnapshot: { digest: `sha256:${headSha}`, contentDigest: 'sha256:content', mergeBase: 'base', headSha, diff: [
        'diff --git a/src/feature.ts b/src/feature.ts\n@@ -0,0 +1 @@\n+export const feature = true;',
        'diff --git a/src/repair.ts b/src/repair.ts\n@@ -0,0 +1 @@\n+export const repair = true;',
      ].join('\n'), sourceChanges: [] } });
      const run = (value: unknown) => (runner as unknown as { runRubricBuildReview(inputs: unknown, config: unknown, tier: 'S'): Promise<unknown> }).runRubricBuildReview(value, config, 'S');

      await expect(run(input('reject-l1'))).resolves.toMatchObject({ success: true });
      const first = calls[0];
      const id = canonicalizeBuildReviewFindingIdentity({ rubric: 'implementationQuality', contractVersion: 'v4', concernKind: 'obscured-intent', anchor: { rubric: 'implementationQuality', locus: { path: 'src/feature.ts', contentHash: first.changedFiles[0].hunks[0].contentHash, display: 'src/feature.ts:1' } } })!.id;
      await writeFile(join(projectRoot, '.pipeline', 'remediation-cases.json'), JSON.stringify({
        version: 'v3', feature: { version: 'v1', repository: await realpath(main), feature: 'feature' },
        cases: [{ id: 'case-reject', domain: 'build_review', disposition: 'reject', priority: 'high', rationale: 'Judge rejected the finding.', confidence: 'high', resolution: 'resolved', sources: [{ sourceId: `implementationQuality:${id}`, outcome: 'rejected', recordedAt: '2026-10-25T00:00:00.000Z' }], effect: { kind: 'none' } }], prdWideningCases: [], suppressions: [], outbox: [],
      }), 'utf8');
      await expect(run(input('reject-l2'))).resolves.toMatchObject({ success: true });
      await expect(run(input('reject-l3'))).resolves.toMatchObject({ success: true });
      expect(calls.slice(1).map((call) => call.reviewScope.deltaHunks)).toEqual([
        [expect.objectContaining({ path: 'src/repair.ts' })], [expect.objectContaining({ path: 'src/repair.ts' })],
      ]);
      const l2 = JSON.parse(await readFile(join(projectRoot, '.pipeline/build-review/lap-reject-l2/implementationQuality.json'), 'utf8'));
      expect(l2.reviewScope.outOfDeltaSourceIds).toHaveLength(1);
      await expect(access(join(projectRoot, '.pipeline', 'HALT'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(join(projectRoot, '.pipeline', 'kickback-ledger.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(main, { recursive: true, force: true }); }
  });

  it('runs a full lap after a base refresh, while an unchanged exact finding remains settleable by its existing id', () => {
    const h1 = `sha256:${'1'.repeat(64)}`;
    const finding = {
      concernKind: 'obscured-intent', severity: 'major' as const, summary: 'Same finding.', evidenceLocations: ['src/feature.ts:1'],
      anchor: { rubric: 'implementationQuality' as const, locus: { path: 'src/feature.ts', contentHash: h1, display: 'src/feature.ts:1' } },
    };
    const changedFiles = [{ path: 'src/feature.ts', changeKind: 'modified' as const, hunks: [{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, contentHash: h1 }] }];
    const l1Scope = { mode: 'full' as const, reason: 'first-lap' as const, sequence: 1, unreadableLapIds: [], mergeBase: 'base-l1', headSha: 'head-l1', policyIdentity: 'policy', reviewedHunks: [{ path: 'src/feature.ts', contentHash: h1 }], deltaHunks: [{ path: 'src/feature.ts', contentHash: h1 }], outOfDeltaSourceIds: [] };
    const l2Scope = decideBuildReviewReviewScope({ lapId: parseBuildReviewLapId('lap-head-l2')!, changedFiles, mergeBase: 'base-l2', headSha: 'head-l2', policyIdentity: 'policy', priorLaps: [{ lapId: parseBuildReviewLapId('lap-head-l1')!, reviewScope: l1Scope }], openSourceUnmapped: false })!;
    const id = canonicalizeBuildReviewFindingIdentity({ rubric: 'implementationQuality', contractVersion: 'v4', concernKind: finding.concernKind, anchor: finding.anchor })!.id;
    const aggregate = joinBuildReviewRubricOutcomes({ lapId: parseBuildReviewLapId('lap-head-l2')!, snapshotDigest: 'sha256:l2', results: {
      implementationQuality: { kind: 'judged', rubric: 'implementationQuality', lapId: parseBuildReviewLapId('lap-head-l2')!, snapshotDigest: 'sha256:l2', contractVersion: 'v4', findings: [finding], verdict: 'FAIL' },
      testQuality: { kind: 'skipped', rubric: 'testQuality', reason: 'disabled' },
    } });

    expect(l2Scope).toMatchObject({ mode: 'full', reason: 'merge-base-changed', deltaHunks: [{ path: 'src/feature.ts', contentHash: h1 }] });
    expect(deriveEffectiveBuildReviewVerdict(aggregate, new Set([id]))).toMatchObject({ verdict: 'PASS', acceptedFindingIds: [id] });
  });

  it("does not let a custom rubric's changing finding ids re-block a settled hunk outside another file's delta", () => {
    const h1 = `sha256:${'1'.repeat(64)}`;
    const h2 = `sha256:${'2'.repeat(64)}`;
    const finding = (concernId: string) => ({
      concernId, summary: `Lap-specific ${concernId}.`, severity: 'major' as const, evidenceLocations: ['src/settled.ts:1'],
      sourceRegions: [{ path: 'src/settled.ts', startLine: 1, endLine: 1, contentHash: h1, display: 'src/settled.ts:1' }],
    });
    const scope = {
      reviewScope: { mode: 'delta' as const, deltaHunks: [{ path: 'src/changed.ts', contentHash: h2 }] },
      changedFiles: [
        { path: 'src/settled.ts', changeKind: 'modified' as const, hunks: [{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, contentHash: h1 }] },
        { path: 'src/changed.ts', changeKind: 'modified' as const, hunks: [{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, contentHash: h2 }] },
      ],
    };

    expect(isBuildReviewFindingOutOfDelta(finding('lap-2-random-id'), scope)).toBe(true);
    expect(isBuildReviewFindingOutOfDelta(finding('lap-3-other-random-id'), scope)).toBe(true);
  });
});

// Covers: task:6
describe('build_review runner scope decisions', () => {
  beforeEach(async () => {
    // These runner-level laps drive the real coordinator beneath the module mock.
    const actual = await vi.importActual<typeof import('../../src/engine/build-review-coordinator.js')>('../../src/engine/build-review-coordinator.js');
    vi.mocked(coordinateBuildReviewRubrics).mockImplementation(actual.coordinateBuildReviewRubrics);
  });

  it('records and announces a full first lap followed by a delta lap', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'build-review-runner-scope-'));
    const events = new ConductorEventEmitter();
    const scopes: Array<Extract<ConductorEvent, { type: 'build_review_review_scope' }>> = [];
    events.on('build_review_review_scope', (event) => {
      if (event.type === 'build_review_review_scope') scopes.push(event);
    });
    try {
      const runner = scopeRunner(dir, events);
      await expect(runScopeLap(runner, scopeInput('scope-l1'))).resolves.toMatchObject({ success: true });
      await expect(runScopeLap(runner, scopeInput('scope-l2'))).resolves.toMatchObject({ success: true });

      const first = JSON.parse(await readFile(artifactPath(dir, 'scope-l1'), 'utf8'));
      const second = JSON.parse(await readFile(artifactPath(dir, 'scope-l2'), 'utf8'));
      expect(first.reviewScope).toMatchObject({ mode: 'full', reason: 'first-lap', sequence: 1 });
      expect(second).toMatchObject({
        result: { kind: 'scope-empty', rubric: 'implementationQuality' },
        reviewScope: { mode: 'delta', reason: 'delta', sequence: 2, predecessorLapId: 'lap-scope-l1' },
      });
      expect(scopes).toEqual([
        expect.objectContaining({ rubric: 'implementationQuality', lapId: 'lap-scope-l1', mode: 'full', reason: 'first-lap' }),
        expect.objectContaining({ rubric: 'implementationQuality', lapId: 'lap-scope-l2', mode: 'delta', reason: 'delta' }),
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses a full scope when a restacked child has a new merge base', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'build-review-runner-restack-'));
    try {
      const runner = scopeRunner(dir);
      await expect(runScopeLap(runner, scopeInput('restack-l1', 'parent-before'))).resolves.toMatchObject({ success: true });
      await expect(runScopeLap(runner, scopeInput('restack-l2', 'parent-after'))).resolves.toMatchObject({ success: true });

      expect(JSON.parse(await readFile(artifactPath(dir, 'restack-l2'), 'utf8')).reviewScope).toMatchObject({
        mode: 'full', reason: 'merge-base-changed', predecessorLapId: 'lap-restack-l1', mergeBase: 'parent-after',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('records an unreadable prior scope once without altering the corrupt artifact', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'build-review-runner-unreadable-'));
    try {
      const runner = scopeRunner(dir);
      await expect(runScopeLap(runner, scopeInput('unreadable-l1'))).resolves.toMatchObject({ success: true });
      const priorPath = artifactPath(dir, 'unreadable-l1');
      const corrupt = JSON.parse(await readFile(priorPath, 'utf8'));
      corrupt.reviewScope = { mode: 'not-a-scope' };
      await writeFile(priorPath, JSON.stringify(corrupt), 'utf8');
      const bytesBefore = await readFile(priorPath, 'utf8');

      await expect(runScopeLap(runner, scopeInput('unreadable-l2'))).resolves.toMatchObject({ success: true });

      expect(await readFile(priorPath, 'utf8')).toBe(bytesBefore);
      expect(JSON.parse(await readFile(artifactPath(dir, 'unreadable-l2'), 'utf8')).reviewScope).toMatchObject({
        mode: 'full', reason: 'record-unreadable', unreadableLapIds: ['lap-unreadable-l1'],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reuses the current-lap scope unchanged for a disposition-only rejoin', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'build-review-runner-rejoin-'));
    try {
      const runner = scopeRunner(dir);
      const input = scopeInput('rejoin');
      await expect(runScopeLap(runner, input)).resolves.toMatchObject({ success: true });
      const first = JSON.parse(await readFile(artifactPath(dir, 'rejoin'), 'utf8')).reviewScope;

      await expect(runScopeLap(runner, input)).resolves.toMatchObject({ success: true });
      const second = JSON.parse(await readFile(artifactPath(dir, 'rejoin'), 'utf8')).reviewScope;

      expect(second.sequence).toBe(first.sequence);
      expect(second.reviewedHunks).toEqual(first.reviewedHunks);
      expect(second.deltaHunks).toEqual(first.deltaHunks);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not persist a scope or settle hunks when a custom dispatch ends in infrastructure failure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'build-review-runner-infrastructure-'));
    const runtimeProvider: LLMProvider = {
      lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
      invoke: async () => ({ success: false, output: 'missing structured result', exitCode: 0, structuredResultFailure: 'missing' }),
    };
    const entry: ResolvedBuildReviewCustomCatalogEntry = {
      id: 'custom-policy', kind: 'custom', skill: 'custom-policy', question: 'Review the fixture.', resources: [],
      policy: {
        enabled: true, llm_provider: 'claude', model: 'opus', effort: 'high',
        model_fallback_ladder: ['opus'], max_retries: 1, escalate: false,
        max_projection_bytes: 1_000_000, min_confidence: 0, timeout_seconds: 60,
      },
      contract: BUILD_REVIEW_CUSTOM_V1_CONTRACT,
    };
    const reviewScope = {
      mode: 'full' as const, reason: 'first-lap' as const, sequence: 1, unreadableLapIds: [], mergeBase: 'base', headSha: 'failed',
      policyIdentity: 'sha256:policy', reviewedHunks: [{ path: 'src/scope.ts', contentHash: 'sha256:hunk' }], deltaHunks: [{ path: 'src/scope.ts', contentHash: 'sha256:hunk' }], outOfDeltaSourceIds: [],
    };
    const runner = new DefaultStepRunner(provider, 'scope-infrastructure', dir, {
      gitRunner: async () => ({ exitCode: 1, stdout: '', stderr: '' }),
      config: { llm_provider: ['claude'] } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([{
        key: 'claude', provider: runtimeProvider, lifecycleCapability: runtimeProvider.lifecycleCapability,
        nativeSchemaCapability: runtimeProvider.nativeSchemaCapability, policy: CLAUDE_MODEL_POLICY,
        builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
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
        digest: `sha256:${'a'.repeat(64)}`,
      }),
    });
    try {
      const outcome = await (runner as unknown as {
        dispatchInstalledBuildReviewPolicy(
          entry: ResolvedBuildReviewCustomCatalogEntry, inputs: unknown, lapId: string, tier?: unknown, lapGate?: unknown,
          readOnlyReviewCapabilityFor?: (provider: string) => Promise<unknown>, pipelineDir?: string, executionContext?: unknown,
          reviewScope?: unknown,
        ): Promise<unknown>;
      }).dispatchInstalledBuildReviewPolicy(entry, {
        sourceSnapshot: { contentDigest: 'sha256:source', mergeBase: 'base', headSha: 'failed', digest: 'sha256:snapshot', sourceChanges: [] },
      }, 'lap-failed', undefined, undefined, async (provider) => ({ provider, platform: process.platform, status: 'available' as const }), undefined, undefined, reviewScope);

      expect(outcome).toMatchObject({ member: { result: { kind: 'infrastructure-failure' } } });
      const failedArtifact = JSON.parse(await readFile(join(dir, '.pipeline', 'build-review', 'lap-failed', 'custom-policy.json'), 'utf8'));
      expect(failedArtifact).not.toHaveProperty('reviewScope');
      expect(settledBuildReviewHunks({
        changedFiles: [{ path: 'src/scope.ts', changeKind: 'modified', hunks: [{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, contentHash: 'sha256:hunk' }] }],
        mergeBase: 'base', policyIdentity: 'sha256:policy', laps: [],
      })).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
