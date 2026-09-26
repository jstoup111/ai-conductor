// Covers: task:37, task:14
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { reduceBuildReviewAdjudication } from '../../src/engine/build-review-adjudication.js';
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

const roots: string[] = [];
const feature = { version: 'v1' as const, repository: 'acme/conductor', feature: 'custom-convergence' };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('custom build-review convergence', () => {
  it('settles all read-only setup skips as a closed custom cause without launching a provider', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR!, 'build-review-read-only-exhaustion-'));
    roots.push(projectRoot);
    const invoke = vi.fn();
    const provider: LLMProvider = {
      lifecycleCapability: { synchronousSpawnPermit: true }, nativeSchemaCapability: { nativeOutputSchema: true }, invoke,
    };
    const config = { llm_provider: ['codex', 'claude'], build_review: {
      enabled: true, rubrics: { testQuality: { enabled: false }, security: { enabled: false } },
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
      currentSourceIds: [sourceId], cases: reconciled.state.cases, mechanical: 'retry',
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
