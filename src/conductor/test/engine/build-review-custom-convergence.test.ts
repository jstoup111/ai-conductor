// Covers: task:37, task:14
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { reduceBuildReviewAdjudication } from '../../src/engine/build-review-adjudication.js';
import { coordinateBuildReviewAdjudication } from '../../src/engine/build-review-adjudication-coordinator.js';
import { buildReviewAdjudicationSourceId } from '../../src/engine/build-review-adjudication-context.js';
import { joinBuildReviewRubricOutcomes, projectBuildReviewAggregateSources } from '../../src/engine/build-review-aggregate.js';
import { stampBuildReviewCustomJudgedResult } from '../../src/engine/build-review-finding-identity.js';
import { reconcileRemediationCases } from '../../src/engine/remediation-case-reconciler.js';
import { RemediationCaseStore } from '../../src/engine/remediation-case-store.js';
import type { RemediationCaseGraph } from '../../src/engine/remediation-case-validator.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';
import { resolveBuildReviewConfig } from '../../src/engine/resolved-config.js';
import { CLAUDE_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { Conductor } from '../test-conductor.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { dispatchBuildReviewRecordReducedCoverage } from '../../src/engine/build-review-cli.js';
import { resolveEffectiveBuildReviewVerdict } from '../../src/engine/build-review-effective.js';

const roots: string[] = [];
const feature = { version: 'v1' as const, repository: 'acme/conductor', feature: 'custom-convergence' };
const dependencyDeclaration = {
  version: 'v1' as const,
  rubricId: 'dependencyHygiene',
  semanticSkill: 'dependency-hygiene',
  question: 'Review dependency changes.',
  source: 'project' as const,
  resources: [],
};
const dependencyDescriptor = {
  version: 'v1' as const,
  semanticSkill: 'dependency-hygiene',
  declaration: dependencyDeclaration,
  installation: { source: 'project' as const },
  effectivePolicy: { version: 'v1' as const, bundleDigest: `sha256:${'d'.repeat(64)}` },
  reviewedInput: { version: 'v1' as const, contentDigest: `sha256:${'e'.repeat(64)}` },
  producer: { provider: 'claude', model: 'opus', effort: 'high' as const },
};
const packageRegion = {
  path: 'package.json', startLine: 1, endLine: 1,
  contentHash: `sha256:${'f'.repeat(64)}`, display: 'dependency declaration',
};

function dependencyAggregate(lapId: string, finding: boolean, current: readonly string[]) {
  const result = stampBuildReviewCustomJudgedResult({
    kind: 'custom-findings', version: 'v2', findings: finding ? [{
      concernId: 'unnecessary-dependency', summary: 'The dependency duplicates an existing module.',
      confidence: 95, severity: 'major', evidenceLocations: ['package.json:1'], sourceRegions: [packageRegion],
    }] : [],
  }, {
    rubric: 'dependencyHygiene', lapId, declaration: dependencyDeclaration,
    policy: dependencyDescriptor.effectivePolicy, candidate: dependencyDescriptor.producer,
    reviewedInput: dependencyDescriptor.reviewedInput,
  }, { sourceRegions: [packageRegion] });
  if (!result) throw new Error('fixture custom finding must stamp');
  return joinBuildReviewRubricOutcomes({
    lapId: lapId as never, snapshotDigest: `snapshot-${lapId}`,
    results: { testQuality: { kind: 'skipped', rubric: 'testQuality', reason: 'disabled' } },
    customResults: { dependencyHygiene: { descriptor: dependencyDescriptor, result } },
    currentCustomRubrics: current,
  } as never);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('custom build-review convergence', () => {
  // Covers: task:7
  it('settles a withheld dependency finding as absent, then dispatches its later matching lap afresh', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR!, 'build-review-withheld-convergence-'));
    roots.push(projectRoot);
    const provider = { invoke: vi.fn() };
    const lap1 = dependencyAggregate('lap-dependency-1', true, ['dependencyHygiene']);
    const lap1Source = projectBuildReviewAggregateSources(lap1)![0]!;
    const sourceId = buildReviewAdjudicationSourceId(lap1Source);

    await provider.invoke({ lap: 1 });
    expect(projectBuildReviewAggregateSources(lap1)).toEqual([expect.objectContaining({
      rubric: 'dependencyHygiene', evidenceLocations: ['package.json:1'],
    })]);

    const store = new RemediationCaseStore(projectRoot, feature);
    const seeded = await reconcileRemediationCases(store, {
      graph: {
        sourceOutcomes: [{ sourceId, outcome: 'acted', caseRef: 'dependency-case' }],
        cases: [{
          case: {
            caseRef: 'dependency-case', disposition: 'act', priority: 'high', confidence: 'high',
            rationale: 'The blocking dependency finding needs a repair.',
            effect: { kind: 'action', route: 'build', tasks: [{ title: 'Remove the duplicate dependency.' }] },
          },
          sources: [{ sourceId, outcome: 'acted', caseRef: 'dependency-case' }],
        }],
      },
      recordedAt: '2026-11-08T00:00:00.000Z', generateId: () => 'dependency-case', lapId: 'lap-dependency-1' as never,
    });
    expect(seeded).toMatchObject({ ok: true });

    // The custom evidence remains readable, but this lap's catalog deliberately
    // omits the member after package.json was restored.
    const lap2 = dependencyAggregate('lap-dependency-2', true, []);
    expect(projectBuildReviewAggregateSources(lap2)).toEqual([]);
    const judge = vi.fn();
    const settled = await coordinateBuildReviewAdjudication({
      projectRoot, feature, aggregate: lap2, operatorResolvedFindingIds: new Set(), mechanical: 'healthy', judge,
      chargeInput: { treeHash: 'tree-lap-2', resolvedCount: 0, reason: 'fixture' },
      readPlanContract: async () => ({ path: null, pointers: [], admittedTaskContracts: [] }),
      readTaskStatus: async () => ({ path: null, tasks: [] }),
      generateId: () => 'unused',
    });

    expect(settled).toMatchObject({ ok: true, route: 'pass', dispatchSkipped: true });
    expect(judge).not.toHaveBeenCalled();
    await expect(store.read()).resolves.toMatchObject({ ok: true, state: {
      cases: [expect.objectContaining({ id: 'dependency-case', resolution: 'resolved' })],
    } });
    await expect(readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    const lap3 = dependencyAggregate('lap-dependency-3', false, ['dependencyHygiene']);
    await provider.invoke({ lap: 3 });
    expect(projectBuildReviewAggregateSources(lap3)).toEqual([]);
    expect(provider.invoke).toHaveBeenCalledTimes(2);
  });

  it('settles all read-only setup skips as a closed custom cause without launching a provider', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR!, 'build-review-read-only-exhaustion-'));
    roots.push(projectRoot);
    const invoke = vi.fn();
    const provider: LLMProvider = {
      lifecycleCapability: { synchronousSpawnPermit: true }, nativeSchemaCapability: { nativeOutputSchema: true }, invoke,
    };
    const config = { llm_provider: ['codex', 'claude'], build_review: {
      enabled: true, rubrics: { testQuality: { enabled: false }, security: { enabled: false }, implementationQuality: { enabled: false } },
      custom_rubrics: { portable: { enabled: true, skill: 'portable-policy', question: 'Review.', source: 'project', llm_provider: ['codex', 'claude'] } },
    } } as HarnessConfig;
    const resolved = resolveBuildReviewConfig(config, CLAUDE_MODEL_POLICY);
    const entry = resolved.catalog[0]!;
    const source = {
      identity: { snapshotDigest: 'sha256:snapshot', contentDigest: 'sha256:content', mergeBase: 'base', headSha: 'head' },
      baselinePath: join(projectRoot, 'baseline'), headPath: join(projectRoot, 'head'),
    };
    await Promise.all([mkdir(source.baselinePath, { recursive: true }), mkdir(source.headPath, { recursive: true })]);
    const events = new ConductorEventEmitter();
    const infrastructureFailures: unknown[] = [];
    events.on('build_review_rubric_infrastructure_failure', (event) => { infrastructureFailures.push(event); });
    const runner = new DefaultStepRunner(provider, 'read-only-exhaustion', projectRoot, {
      config,
      providerRuntimes: new ProviderRuntimeSet(['codex', 'claude'].map((key) => ({
        key, provider, lifecycleCapability: provider.lifecycleCapability!, nativeSchemaCapability: provider.nativeSchemaCapability!,
        policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
      }))),
      sessionStore: new ProviderSessionStore(),
      buildReviewPolicyCatalog: async ({ skill }) => [{ semanticName: skill, source: 'project', installationOrigin: '/fixture/project', canonicalSkillPath: `/fixture/project/${skill}/SKILL.md`, packageRoot: `/fixture/project/${skill}`, declaredDependencies: [], availability: 'available' as const }],
      buildReviewPolicyCapture: async (policy) => ({ policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md', manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Policy\n') }], metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] }, digest: `sha256-v1:${'a'.repeat(64)}` }),
      events,
    });
    const outcome = await (runner as unknown as {
      dispatchInstalledBuildReviewPolicy(entry: unknown, inputs: unknown, lapId: string, tier: 'M', capture?: unknown, capability?: (provider: string) => Promise<unknown>): Promise<{ member?: unknown }>;
    }).dispatchInstalledBuildReviewPolicy(entry, {
      sourceSnapshot: { digest: 'sha256:snapshot', contentDigest: 'sha256:content', mergeBase: 'base', headSha: 'head', sourceChanges: [] },
      sourceMaterialization: { source, contextFor: (memberId: string) => ({ memberId, source }), settle: async () => {} },
    }, 'lap-read-only', 'M', undefined, async (candidate) => ({ provider: candidate, platform: 'darwin', status: 'unavailable', reason: `${candidate} read-only mode is unavailable` }));

    expect(invoke).not.toHaveBeenCalled();
    expect(outcome.member).toMatchObject({ result: { reason: 'read-only-review-unavailable', detail: expect.stringMatching(/darwin[\s\S]*codex[\s\S]*claude/) } });
    expect(infrastructureFailures).toEqual([expect.objectContaining({
      cause: 'read-only-review-unavailable', platform: 'darwin',
    })]);
  });

  it('refuses an all-read-only-unavailable custom lap without charging the mechanical ledger', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR!, 'build-review-read-only-refusal-'));
    roots.push(projectRoot);
    const provider: LLMProvider = { lifecycleCapability: { synchronousSpawnPermit: true }, invoke: async () => {
      throw new Error('a read-only-unavailable candidate must not launch');
    } };
    const runner = new DefaultStepRunner(provider, 'read-only-refusal', projectRoot);
    const result = await (runner as unknown as {
      publishCustomOnlyBuildReview(input: unknown): Promise<{ success: boolean; output: string; refusal?: { kind: string }; currentLapMechanicalFault?: boolean }>;
    }).publishCustomOnlyBuildReview({
      lapId: 'lap-read-only',
      inputs: { sourceSnapshot: { digest: 'sha256:snapshot' } },
      customResults: {
        portable: {
          declaration: { version: 'v1', rubricId: 'portable', semanticSkill: 'portable-policy', question: 'Review.', resources: [] },
          result: {
            kind: 'infrastructure-failure', rubric: 'portable', reason: 'read-only-review-unavailable',
            detail: 'Provider codex read-only review mode is unavailable on darwin: sandbox helper is unavailable; Provider claude read-only review mode is unavailable on darwin: restricted mode is unavailable',
          },
        },
      },
      currentCustomRubrics: ['portable'],
      config: resolveBuildReviewConfig({ llm_provider: 'claude', build_review: {
        enabled: true,
        custom_rubrics: { portable: { enabled: true, skill: 'portable-policy', question: 'Review.', source: 'project' } },
      } } as HarnessConfig, CLAUDE_MODEL_POLICY),
    });

    expect(result).toMatchObject({ success: false, refusal: { kind: 'needs-human' } });
    expect(result.currentLapMechanicalFault).toBeUndefined();
    expect(result.output).toContain('read-only-review-unavailable');
    expect(result.output).toContain('darwin');
    expect(result.output).toContain('codex');
    expect(result.output).toContain('claude');
    expect((await readKickbackLedger(projectRoot)).gates.build_review?.mechanicalFaults ?? 0).toBe(0);
    await expect(readFile(join(projectRoot, '.pipeline', 'build-review.json'), 'utf8')).resolves.toContain('read-only-review-unavailable');
  });

  // Covers: rem-as-built-rem-ab14-1
  it('records a real read-only halt and resolves that same rubric through the stored reduced-coverage disposition', async () => {
    const main = await mkdtemp(join(process.env.TMPDIR!, 'build-review-read-only-roundtrip-'));
    roots.push(main);
    const slug = 'read-only-roundtrip';
    const projectRoot = join(main, '.worktrees', slug);
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    const config = { llm_provider: 'claude', build_review: {
      enabled: true, rubrics: { testQuality: { enabled: false }, security: { enabled: false }, implementationQuality: { enabled: false } },
      custom_rubrics: { portable: { enabled: true, skill: 'portable-policy', question: 'Review.', source: 'project', llm_provider: 'claude' } },
    } } as HarnessConfig;
    let useStoredDisposition = false;
    const provider: LLMProvider = { lifecycleCapability: { synchronousSpawnPermit: true }, nativeSchemaCapability: { nativeOutputSchema: true }, invoke: async () => {
      throw new Error('unavailable review candidates must not invoke');
    } };
    const runner = new DefaultStepRunner(provider, slug, projectRoot, {
      config, providerRuntimes: new ProviderRuntimeSet([{ key: 'claude', provider, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) }]),
      sessionStore: new ProviderSessionStore(),
      buildReviewPolicyCatalog: async ({ skill }) => [{ semanticName: skill, source: 'project', installationOrigin: '/fixture/project', canonicalSkillPath: `/fixture/project/${skill}/SKILL.md`, packageRoot: `/fixture/project/${skill}`, declaredDependencies: [], availability: 'available' as const }],
      buildReviewPolicyCapture: async (policy) => ({ policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md', manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Policy\n') }], metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] }, digest: `sha256-v1:${'a'.repeat(64)}` }),
      probeReadOnlyReviewCapability: async ({ provider: providerKey, platform }) => ({ provider: providerKey, platform, status: 'unavailable' as const, reason: 'fixture unavailable' }),
      buildReviewEffectiveResolver: async (root, aggregate) => useStoredDisposition
        ? resolveEffectiveBuildReviewVerdict(root, aggregate, { resolveMainRoot: async () => main, realpath: async (path) => path, child: undefined, adjudicationEnabled: true })
        : ({ ok: true, feature: { version: 'v1', repository: main, feature: slug }, effective: { rawVerdict: 'PASS', verdict: 'PASS', acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [], skippedRubrics: ['testQuality'], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [], uncoveredScopeIncompleteRubrics: [] } } as never),
    });
    const source = { identity: { snapshotDigest: 'sha256:roundtrip', contentDigest: 'sha256:roundtrip-content', mergeBase: 'base', headSha: 'head' }, baselinePath: join(projectRoot, 'baseline'), headPath: join(projectRoot, 'head') };
    await Promise.all([mkdir(source.baselinePath, { recursive: true }), mkdir(source.headPath, { recursive: true })]);
    const inputs = { sourceSnapshot: { digest: 'sha256:roundtrip', contentDigest: 'sha256:roundtrip-content', mergeBase: 'base', headSha: 'head', diff: '', sourceChanges: [] }, sourceMaterialization: { source, contextFor: (memberId: string) => ({ memberId, source }), settle: async () => {} } };
    const resolved = resolveBuildReviewConfig(config, CLAUDE_MODEL_POLICY);
    const first = await (runner as unknown as { runRubricBuildReview(inputs: unknown, config: unknown, tier: 'M'): Promise<{ success: boolean; output: string }> }).runRubricBuildReview(inputs, resolved, 'M');
    expect(first).toMatchObject({ success: false, output: expect.stringContaining('read-only-review-unavailable') });
    await expect(readFile(join(projectRoot, '.pipeline', 'build-review.json'), 'utf8')).resolves.toContain('read-only-review-unavailable');

    await expect(dispatchBuildReviewRecordReducedCoverage({ kind: 'record-reduced-coverage', feature: slug, lapId: 'lap-head', rubric: 'portable', rationale: 'No provider can enforce read-only review.' }, {
      cwd: projectRoot, isInteractive: true, resolveOperator: () => 'local-operator', resolveMainRoot: async () => main, realpath: async (path) => path,
      readMechanicalFaults: async () => 0, print: vi.fn(), appendEvent: vi.fn(),
    })).resolves.toBe(0);
    await expect(readFile(join(projectRoot, '.pipeline', 'build-review-dispositions.json'), 'utf8')).resolves.toContain('read-only-review-unavailable');

    useStoredDisposition = true;
    const rerun = await (runner as unknown as { runRubricBuildReview(inputs: unknown, config: unknown, tier: 'M'): Promise<{ output: string }> }).runRubricBuildReview(inputs, resolved, 'M');
    expect(rerun.output).not.toContain('disposition state cannot resolve');
    await expect(readFile(join(projectRoot, '.pipeline', 'build-review.json'), 'utf8')).resolves.toContain('## Reduced build-review coverage');
  });

  it('renders the immediate read-only refusal as a needs-human halt', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR!, 'build-review-read-only-halt-'));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    const state = Object.fromEntries(ALL_STEPS.map((step) => [step.name, step.name === 'build_review' ? 'pending' : 'done'])) as ConductState;
    state.complexity_tier = 'M';
    await writeState(join(projectRoot, '.pipeline', 'state.json'), state);
    const runner: StepRunner = { run: async (step: StepName) => step === 'build_review'
      ? {
          success: false,
          output: 'build_review read-only-review-unavailable on darwin: codex: sandbox helper is unavailable; claude: restricted mode is unavailable',
          refusal: { kind: 'needs-human', reason: 'read-only-review-unavailable' },
          buildReviewReadOnlyReviewUnavailable: true,
        }
      : { success: true } };
    await new Conductor({
      projectRoot, stateFilePath: join(projectRoot, '.pipeline', 'state.json'), stepRunner: runner,
      events: new ConductorEventEmitter(), fromStep: 'build_review', mode: 'auto', daemon: true,
    }).run();

    await expect(readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8')).resolves.toMatch(/read-only-review-unavailable[\s\S]*darwin[\s\S]*codex[\s\S]*claude/);
    await expect(readFile(join(projectRoot, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
  });

  it('keeps a current custom policy decision-owner escalation out of the deferral lane', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR!, 'build-review-custom-convergence-'));
    roots.push(projectRoot);
    const sourceId = 'portable-policy:sha256:updated-content:finding-1';
    const graph: RemediationCaseGraph = {
      sourceOutcomes: [{ sourceId, outcome: 'escalate', caseRef: 'architecture-stop' }],
      cases: [{
        case: {
          caseRef: 'architecture-stop', disposition: 'escalate', priority: 'high', confidence: 'high',
          rationale: 'The portable build policy requires an architecture decision.',
          effect: { kind: 'none' }, escalation: { owner: 'architecture' },
        },
        sources: [{ sourceId, outcome: 'escalate', caseRef: 'architecture-stop' }],
      }],
    };
    const ids = ['case-architecture-stop', 'unexpected-effect'];
    const reconciled = await reconcileRemediationCases(new RemediationCaseStore(projectRoot, feature), {
      graph, recordedAt: '2026-09-11T00:00:00.000Z', generateId: () => ids.shift()!,
    });

    expect(reconciled).toMatchObject({ ok: true });
    if (!reconciled.ok) return;

    const transition = reduceBuildReviewAdjudication({
      currentSourceIds: [sourceId], feature: 'custom-convergence', child: undefined, cases: reconciled.state.cases, mechanical: 'retry',
    });

    expect({ record: reconciled.state.cases[0], transition }).toMatchObject({
      record: {
        disposition: 'escalate', resolution: 'open', effect: { kind: 'none' },
        escalation: { owner: 'architecture' },
      },
      transition: {
        route: 'halt', remainingMechanical: true,
        reason: 'architecture decision is required for current remediation sources',
      },
    });
  });

  it('refuses empty restart settlement while a decision-owner escalation awaits an approved-baseline change', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR!, 'build-review-custom-convergence-'));
    roots.push(projectRoot);
    const store = new RemediationCaseStore(projectRoot, feature);
    const sourceId = 'portable-policy:sha256:old-baseline:finding-1';
    const graph: RemediationCaseGraph = {
      sourceOutcomes: [{ sourceId, outcome: 'escalate', caseRef: 'architecture-stop' }],
      cases: [{
        case: {
          caseRef: 'architecture-stop', disposition: 'escalate', priority: 'high', confidence: 'high',
          rationale: 'The portable build policy requires an architecture decision.',
          effect: { kind: 'none' }, escalation: { owner: 'architecture' },
        },
        sources: [{ sourceId, outcome: 'escalate', caseRef: 'architecture-stop' }],
      }],
    };
    await reconcileRemediationCases(store, {
      graph, recordedAt: '2026-09-11T00:00:00.000Z', generateId: () => 'case-architecture-stop',
    });

    const restarted = await reconcileRemediationCases(store, {
      graph: { sourceOutcomes: [], cases: [] }, recordedAt: '2026-09-11T00:01:00.000Z',
      generateId: () => 'must-not-be-used', resolveAbsentOpenNonActionCases: true,
    });

    expect(restarted).toEqual({ ok: false, reason: 'decision-stop-pending' });
    await expect(store.read()).resolves.toMatchObject({
      ok: true,
      state: {
        cases: [{
          id: 'case-architecture-stop', disposition: 'escalate', resolution: 'open',
          effect: { kind: 'none' }, escalation: { owner: 'architecture' },
        }],
      },
    });
  });
});
