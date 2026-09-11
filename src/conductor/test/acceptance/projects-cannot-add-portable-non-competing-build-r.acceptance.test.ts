/**
 * Acceptance RED for portable, non-competing custom build-review policies.
 *
 * Flow A stops when attended/daemon review has produced one aggregate route.
 * Flow B stops at the post-repair verification/progression decision. The real
 * DefaultStepRunner build-review entry, Conductor navigation, durable state,
 * and local filesystem are exercised. Provider judgment is a faithful fake;
 * no host CLI, model, network service, or package installer is invoked.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CompletionContext } from '../../src/engine/artifacts.js';
import type { StepRunner, StepRunOptions, StepRunResult } from '../../src/engine/conductor.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import type { InvokeOptions, InvokeResult, LLMProvider } from '../../src/execution/llm-provider.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { Conductor } from '../test-conductor.js';

const SLUG = 'projects-cannot-add-portable-non-competing-build-r';
const PLAN_PATH = `.docs/plans/${SLUG}.md`;
const STORY_PATH = `.docs/stories/${SLUG}.md`;
const HASH = `sha256:${'a'.repeat(64)}`;
const roots: string[] = [];

const PASS_EVIDENCE = {
  version: 4 as const,
  outcome: 'PASS' as const,
  reason: 'exit_zero' as const,
  fingerprint: 'sha256:post-repair',
  categoryFingerprints: {
    additional_inputs: 'sha256:additional-inputs',
    dependencies: 'sha256:dependencies',
    environment: 'sha256:environment',
    migrations: 'sha256:migrations',
    project_config: 'sha256:project-config',
    source: 'sha256:source',
    test_infrastructure: 'sha256:test-infrastructure',
    tests: 'sha256:tests',
  },
  provenanceHeadSha: 'head-after-repair',
  command: 'npm test',
  workingDirectory: 'src/conductor',
  startedAt: '2026-09-11T00:00:00.000Z',
  endedAt: '2026-09-11T00:00:01.000Z',
  durationMs: 1_000,
  exitCode: 0 as const,
  stdout: 'all tests passed\n',
  stderr: '',
};

type ProofState = 'current' | 'missing' | 'failing';

interface FlowRun {
  buildDispatches: number;
  customReviewCalls: number;
  kickbacks: Array<{ from: string; to: string }>;
  manualTestReached: boolean;
  remediateDispatches: number;
  suiteEnsures: number;
  halt: string;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function customConfig(): HarnessConfig {
  return {
    llm_provider: ['claude'],
    test_suite: { command: 'npm test', working_directory: 'src/conductor' },
    build_review: {
      enabled: true,
      adjudication: { enabled: true },
      rubrics: { testQuality: { enabled: false } },
      custom_rubrics: {
        portablePolicy: {
          enabled: true,
          skill: 'portable-policy',
          question: 'Does the changed cache behavior preserve the approved policy identity?',
          source: 'project',
          llm_provider: 'claude',
          model: 'sonnet',
        },
      },
    },
  } as unknown as HarnessConfig;
}

async function seedProject(): Promise<{ root: string; statePath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'portable-review-acceptance-'));
  roots.push(root);
  const statePath = join(root, '.pipeline', 'conduct-state.json');
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await mkdir(join(root, '.docs', 'stories'), { recursive: true });
  await mkdir(join(root, '.claude', 'skills', 'portable-policy'), { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'feature.ts'), 'export const cacheKey = "legacy";\n');
  await writeFile(join(root, PLAN_PATH), [
    '# Plan',
    '',
    '### Task 33: route custom review through one shared outcome',
    '**Done when:** one aggregate route is observed.',
    '**Files:** src/feature.ts',
    '',
    '### Task 36: require current post-repair verification',
    '**Done when:** progression uses current repaired-input evidence.',
    '**Files:** src/feature.ts',
    '',
  ].join('\n'));
  await writeFile(join(root, STORY_PATH), [
    '**Status:** Accepted',
    '',
    '# Stories',
    '',
    '## Story 11: one aggregate authority',
    '### Acceptance Criteria',
    '#### Happy Path',
    '- Given custom findings, when all branches settle, then one aggregate route is used.',
    '',
    '## Story 15: verify repair again',
    '### Acceptance Criteria',
    '#### Happy Path',
    '- Given custom repair, when BUILD completes, then current verification is required.',
    '#### Negative Paths',
    '- Given stale proof, when progression is attempted, then it remains blocked.',
    '',
  ].join('\n'));
  await writeFile(join(root, '.claude', 'skills', 'portable-policy', 'SKILL.md'), [
    '---',
    'name: portable-policy',
    'description: Review cache identity without changing the project.',
    '---',
    '',
    '# Portable policy',
    '',
    'Report cache identity defects as findings against the supplied frozen input.',
    '',
  ].join('\n'));
  await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({
    tasks: [{ id: '33', status: 'completed' }, { id: '36', status: 'completed' }],
  }));

  const state = Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])) as ConductState;
  state.feature_desc = SLUG;
  state.complexity_tier = 'L';
  state.track = 'product';
  state.run_started_at = Date.now() - 1_000;
  state.build_review = 'pending';
  await writeState(statePath, state);
  return { root, statePath };
}

function scriptedGit(head: () => string) {
  return async (args: string[]) => {
    if (args[0] === 'symbolic-ref') return { exitCode: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' };
    if (args[0] === 'rev-parse') return { exitCode: 0, stdout: args[1] === 'HEAD' ? `${head()}\n` : 'base-tip\n', stderr: '' };
    if (args[0] === 'merge-base') return { exitCode: 0, stdout: 'base\n', stderr: '' };
    if (args[0] === 'diff' && args.includes('--name-status')) return { exitCode: 0, stdout: 'M\u0000src/feature.ts\u0000', stderr: '' };
    if (args[0] === 'diff') return { exitCode: 0, stdout: 'diff --git a/src/feature.ts b/src/feature.ts\n', stderr: '' };
    if (args[0] === 'show' && args[1] === `${head()}:${PLAN_PATH}`) return { exitCode: 0, stdout: '# Plan\n', stderr: '' };
    if (args[0] === 'show' && args[1] === `${head()}:${STORY_PATH}`) return { exitCode: 0, stdout: '# Stories\n', stderr: '' };
    if (args[0] === 'show' && args[1] === `${head()}:src/feature.ts`) return { exitCode: 0, stdout: 'export const cacheKey = "legacy";\n', stderr: '' };
    if (args[0] === 'ls-tree') return { exitCode: 0, stdout: '', stderr: '' };
    return { exitCode: 1, stdout: '', stderr: '' };
  };
}

async function runFlow(input: {
  daemon: boolean;
  stopAfterRoute?: boolean;
  proof?: ProofState;
}): Promise<FlowRun> {
  const { root, statePath } = await seedProject();
  let head = 'head-before-repair';
  let customReviewCalls = 0;
  const invoke = vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => {
    customReviewCalls += 1;
    const findings = customReviewCalls === 1 ? [{
      concernId: 'stale-policy-cache',
      summary: 'The cache key does not bind the effective installed policy.',
      confidence: 95,
      evidenceLocations: ['src/feature.ts:1'],
      sourceRegions: [{
        path: 'src/feature.ts', startLine: 1, endLine: 1, contentHash: HASH, display: 'cache key',
      }],
    }] : [];
    expect(options.prompt).toContain('Portable policy');
    return { success: true, output: JSON.stringify({ findings }), exitCode: 0 };
  });
  const provider: LLMProvider = {
    supportsSessionResume: true,
    lifecycleCapability: { synchronousSpawnPermit: true },
    invoke,
  };
  const runtime = {
    key: 'claude' as const,
    provider,
    lifecycleCapability: { synchronousSpawnPermit: true } as const,
    policy: CLAUDE_MODEL_POLICY,
    builtIn: true,
    availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
  };
  const events = new ConductorEventEmitter();
  const kickbacks: Array<{ from: string; to: string }> = [];
  events.on('kickback', (event) => {
    if (event.type === 'kickback') kickbacks.push({ from: event.from, to: event.to });
  });
  const config = customConfig();
  const buildReviewRunner = new DefaultStepRunner(provider, 'acceptance-session', root, {
    featureDesc: SLUG,
    pipelineDir: join(root, '.pipeline'),
    planPath: join(root, PLAN_PATH),
    gitRunner: scriptedGit(() => head),
    config,
    mode: 'auto',
    events,
    providerRuntimes: new ProviderRuntimeSet([runtime]),
    configuredProviders: ['claude'],
    sessionStore: new ProviderSessionStore(),
    buildReviewInputOptions: {
      inspectTestSuite: async () => ({ status: 'CURRENT', evidence: PASS_EVIDENCE } as never),
    },
  });

  let buildDispatches = 0;
  let remediateDispatches = 0;
  let manualTestReached = false;
  const runner: StepRunner = {
    resetSession: (step) => buildReviewRunner.resetSession(step),
    run: async (step: StepName, state: ConductState, options?: StepRunOptions): Promise<StepRunResult> => {
      if (step === 'build_review') return buildReviewRunner.run(step, state, options);
      if (step === 'remediate') {
        remediateDispatches += 1;
        const aggregate = JSON.parse(await readFile(join(root, '.pipeline', 'build-review.json'), 'utf8')) as {
          results: Record<string, { findings?: Array<{ findingId?: string; id?: string }> }>;
        };
        const custom = aggregate.results.portablePolicy;
        const stampedFinding = custom?.findings?.[0];
        const sourceId = `portablePolicy:${stampedFinding?.findingId ?? stampedFinding?.id ?? 'stale-policy-cache'}`;
        await writeFile(join(root, '.pipeline', 'remediation.json'), JSON.stringify({
          mode: 'case-v1',
          domain: 'build_review',
          sourceOutcomes: [{ sourceId, outcome: 'acted', caseRef: 'case-portable-policy' }],
          cases: [{
            caseRef: 'case-portable-policy',
            disposition: 'act',
            priority: 'high',
            confidence: 'high',
            rationale: 'Task 36 admits repair of the effective-policy cache binding.',
            effect: { kind: 'action', route: 'build', tasks: [{ title: 'Task 36: bind cache identity to the effective policy' }] },
          }],
        }));
        return { success: true };
      }
      if (step === 'build') {
        buildDispatches += 1;
        if (input.stopAfterRoute || buildDispatches > 1) throw new Error('acceptance boundary reached');
        head = 'head-after-repair';
        await writeFile(join(root, 'src', 'feature.ts'), 'export const cacheKey = "effective-policy";\n');
        await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({
          tasks: [{ id: '33', status: 'completed' }, { id: '36', status: 'completed' }],
        }));
        return { success: true };
      }
      if (step === 'manual_test') {
        manualTestReached = true;
        throw new Error('acceptance boundary reached');
      }
      return { success: true };
    },
  };

  const proof = input.proof ?? 'current';
  const inspect = vi.fn(async () => proof === 'current'
    ? { status: 'CURRENT' as const, evidence: PASS_EVIDENCE }
    : { status: 'STALE' as const, reason: proof === 'missing' ? 'missing' as const : 'not_pass' as const });
  const ensure = vi.fn(async () => proof === 'current'
    ? { status: 'REUSED' as const, evidence: PASS_EVIDENCE }
    : {
        status: 'FAILED' as const,
        reason: proof === 'missing' ? 'preflight_failed' as const : 'nonzero_exit' as const,
        message: proof === 'missing' ? 'post-repair evidence is missing' : 'post-repair verification failed',
      });
  const effectiveResolver: NonNullable<CompletionContext['buildReviewEffectiveResolver']> = vi.fn(async (_root, aggregate) => {
    const candidate = aggregate as unknown as { results?: Record<string, { findings?: Array<{ findingId?: string; id?: string }> }> };
    const finding = candidate.results?.portablePolicy?.findings?.[0];
    return {
      ok: true as const,
      feature: { version: 'v1' as const, repository: 'acme/conductor', feature: SLUG },
      effective: {
        rawVerdict: finding ? 'FAIL' as const : 'PASS' as const,
        verdict: finding ? 'FAIL' as const : 'PASS' as const,
        acceptedFindingIds: [],
        unresolvedFindingIds: finding ? [finding.findingId ?? finding.id ?? 'stale-policy-cache'] : [],
        suppressedFindingIds: [],
        skippedRubrics: [],
        infrastructureFailureRubrics: [],
        uncoveredInfrastructureFailureRubrics: [],
      },
    };
  }) as never;

  const conductor = new Conductor({
    projectRoot: root,
    stateFilePath: statePath,
    stepRunner: runner,
    events,
    fromStep: 'build_review',
    verifyArtifacts: true,
    mode: 'auto',
    daemon: input.daemon,
    config,
    maxRetries: 1,
    buildReviewEffectiveResolver: effectiveResolver,
    fullSuiteVerifier: { inspect, ensure },
    git: scriptedGit(() => head),
  } as never);
  await conductor.run().catch((error: unknown) => {
    if (!(error instanceof Error) || error.message !== 'acceptance boundary reached') throw error;
  });

  return {
    buildDispatches,
    customReviewCalls,
    kickbacks,
    manualTestReached,
    remediateDispatches,
    suiteEnsures: ensure.mock.calls.length,
    halt: await readFile(join(root, '.pipeline', 'HALT'), 'utf8').catch(() => ''),
  };
}

describe('portable custom build-review policy acceptance', () => {
  // Covers: S11.1, FR-9, task:33
  it.each([
    { label: 'attended', daemon: false },
    { label: 'daemon', daemon: true },
  ])('routes one settled custom-policy lap through one aggregate authority in $label mode', async ({ daemon }) => {
    const run = await runFlow({ daemon, stopAfterRoute: true });

    expect(run.customReviewCalls).toBe(1);
    expect(run.remediateDispatches).toBe(1);
    expect(run.buildDispatches).toBe(1);
    expect(run.kickbacks).toEqual([{ from: 'build_review', to: 'build' }]);
    expect(run.halt).toBe('');
  });

  // Covers: S15.1, S15.5, FR-13, task:36
  it.each([
    { proof: 'current' as const, progresses: true },
    { proof: 'missing' as const, progresses: false },
    { proof: 'failing' as const, progresses: false },
  ])('requires $proof evidence after one custom repair before progression', async ({ proof, progresses }) => {
    const run = await runFlow({ daemon: true, proof });

    expect(run.customReviewCalls).toBe(proof === 'current' ? 2 : 1);
    expect(run.remediateDispatches).toBe(1);
    expect(run.suiteEnsures).toBeGreaterThanOrEqual(1);
    expect(run.manualTestReached).toBe(progresses);
    expect(run.kickbacks.filter((event) => event.from === 'build_review')).toHaveLength(1);
    expect(run.kickbacks.filter((event) => event.from === 'test_suite')).toHaveLength(progresses ? 0 : 1);
  });
});
