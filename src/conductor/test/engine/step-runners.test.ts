// Covers: task:1, task:2, task:3, task:4, task:5, task:7, task:8, task:9, task:10, task:11, task:12, task:17, task:rem-prd-audit-9, task:rem-prd-audit-9-2, task:rem-prd-audit-9-R1, task:rem-prd-audit-9-R2, task:rem-prd-audit-9-R3, task:rem-as-built-6-r7
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, access, mkdir, lstat, realpath, readdir, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { execa } from 'execa';
import { WorktreeLifecycleQueue } from '../../src/engine/worktree.js';
import type { LLMProvider, InvokeOptions, InvokeResult } from '../../src/execution/llm-provider.js';
import type { ConductState, ConductorEvent, ExecutionContext, ProviderAttemptEvent, StepName } from '../../src/types/index.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { StepRunnerOptions } from '../../src/engine/step-runners.js';
import {
  DefaultStepRunner,
  parseTierFromOutput,
  parseSignalCountsFromOutput,
  scoreComplexityFromCounts,
} from '../../src/engine/step-runners.js';
import {
  CLAUDE_MODEL_POLICY as CLAUDE_POLICY,
  CODEX_MODEL_POLICY,
} from '../../src/engine/provider-model-policy.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { scanInheritedState } from '../../src/engine/daemon-dashboard.js';
import { executeProviderCandidates, providerExecutionEventCallbacks } from '../../src/engine/provider-execution.js';
import type { ExecuteProviderCandidatesInput, ProviderExecutionResult } from '../../src/engine/provider-execution.js';
import type { ProviderLifecycleEpisodeStore } from '../../src/engine/provider-lifecycle-store.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { OtelVisualizer } from '../../src/engine/otel/otel-visualizer.js';
import { resolveOtelConfig } from '../../src/engine/otel/otel-config.js';
import { CapturingSpanExporter } from '../fixtures/capturing-span-exporter.js';
import { RemediationCaseStore } from '../../src/engine/remediation-case-store.js';
import { deriveEffectiveBuildReviewVerdict, projectBuildReviewAggregateSources } from '../../src/engine/build-review-aggregate.js';
import { canonicalizeBuildReviewFindingIdentity, stampBuildReviewCustomJudgedResult } from '../../src/engine/build-review-finding-identity.js';
import { buildReviewPolicyIdentity } from '../../src/engine/build-review-review-frontier.js';
import { deriveChangedFileReferences } from '../../src/engine/build-review-projections.js';
import { getBuildReviewRubricDescriptor } from '../../src/engine/build-review-registry.js';
import { coordinateBuildReviewRubrics } from '../../src/engine/build-review-coordinator.js';
import { scopedRunFailure } from '../../src/engine/build-review-test-quality-preflight.js';
import type { BuildReviewScopedLauncher } from '../../src/engine/build-review-scoped-run.js';
import { renderBuildReviewUnresolvedSkillRemedy } from '../../src/engine/build-review-domain.js';
import { resolveBuildReviewConfig } from '../../src/engine/resolved-config.js';
import { parseChildId } from '../../src/engine/child-context.js';

const { buildPrdAuditProjection } = vi.hoisted(() => ({
  buildPrdAuditProjection: vi.fn(),
}));

vi.mock('../../src/engine/prd-audit-projection.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/prd-audit-projection.js')>(),
  buildPrdAuditProjection,
}));

vi.mock('../../src/engine/build-review-coordinator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/build-review-coordinator.js')>();
  return { ...actual, coordinateBuildReviewRubrics: vi.fn(actual.coordinateBuildReviewRubrics) };
});

function prdAuditProjectionFixture() {
  return {
    ok: true as const,
    projection: {
      version: 1 as const,
      plan: { intent: 'Audit the typed verdict.' },
      criteria: [{ id: 'S1.1', storyId: '1', kind: 'happy' as const, text: 'The audit returns a typed verdict.' }],
      tasks: [], prd: { kind: 'absent' as const }, coherence: { kind: 'absent' as const },
      changes: { base: 'base', head: 'head', changedFiles: [], excerpts: [], omittedFiles: [] },
      history: { kind: 'absent' as const },
    },
  };
}

function prdAuditPassResult(): InvokeResult {
  return {
    success: true,
    output: 'typed PRD-audit judgment',
    exitCode: 0,
    finalStructuredResult: {
      version: 'v1',
      criterionJudgments: [{
        criterion: { storyId: '1', ordinal: 1 }, grade: 'PASS',
        evidence: 'The fixture returns a valid terminal judgment.',
        rationale: 'The only active criterion is satisfied.',
        requirementAssociations: [], evidenceTaskIds: [],
      }],
      noOwnerObservations: [],
    },
  };
}

function createMockProvider(): LLMProvider {
  return {
    lifecycleCapability: { synchronousSpawnPermit: true },
    invoke: vi.fn().mockResolvedValue({
      success: true,
      output: 'done',
      exitCode: 0,
    }),
  };
}

function customCatalogEntry(config: ReturnType<typeof resolveBuildReviewConfig>, id = 'portable') {
  const entry = config.catalog.find((candidate) => candidate.id === id);
  if (!entry || entry.kind !== 'custom') throw new Error(`expected custom ${id} rubric`);
  return entry;
}

describe('build_review declared replication suppressions', () => {
  const sourcePath = 'src/source-widget.ts';
  const targetPath = 'src/target-widget.ts';
  const duplication = (path = targetPath, evidence = `${sourcePath}:8`) => ({
    concernKind: 'duplication' as const, severity: 'minor' as const, summary: 'The declared copy repeats the source implementation.',
    evidenceLocations: [evidence],
    anchor: { rubric: 'implementationQuality' as const, locus: { path, contentHash: `sha256:${'a'.repeat(64)}`, display: 'declared target copy' } },
  });
  const otherPath = 'src/other-widget.ts';
  const declaredPlanBody = `# Plan\n\n**Pattern-source:** ${sourcePath}\n**Rename-map:** source-widget -> target-widget\n`;
  const runDeclaredReplication = async (
    makeFinding: (loci: { target: any; other: any }) => ReturnType<typeof duplication>,
    planBody = declaredPlanBody,
  ) => {
    const projectDir = await mkdtemp(join(tmpdir(), 'declared-replication-runner-'));
    const planPath = join(projectDir, '.docs/plans/feature.md');
    let effective!: ReturnType<typeof deriveEffectiveBuildReviewVerdict>;
    let finding: ReturnType<typeof duplication> | undefined;

    try {
      await mkdir(join(projectDir, '.docs/plans'), { recursive: true });
      await mkdir(join(projectDir, 'src'), { recursive: true });
      await writeFile(planPath, planBody, 'utf8');
      await writeFile(join(projectDir, sourcePath), 'export const widget = true;\n', 'utf8');
      await writeFile(join(projectDir, targetPath), 'export const widget = true;\n', 'utf8');
      const gitRunner = async (args: string[]) => {
        if (args[0] === 'symbolic-ref') return { exitCode: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' };
        if (args[0] === 'rev-parse') return { exitCode: 0, stdout: args[1] === 'HEAD' ? 'head\n' : 'base-tip\n', stderr: '' };
        if (args[0] === 'merge-base') return { exitCode: 0, stdout: 'base\n', stderr: '' };
        if (args[0] === 'diff' && args.includes('--name-status')) return { exitCode: 0, stdout: `M\0${targetPath}\0M\0${otherPath}\0`, stderr: '' };
        if (args[0] === 'diff') return { exitCode: 0, stdout: [
          `diff --git a/${targetPath} b/${targetPath}\n@@ -1 +1 @@\n-export const widget = false;\n+export const widget = true;`,
          `diff --git a/${otherPath} b/${otherPath}\n@@ -1 +1 @@\n-export const other = false;\n+export const other = true;`,
        ].join('\n') + '\n', stderr: '' };
        if (args[0] === 'show' && args[1] === 'head:.docs/plans/feature.md') return { exitCode: 0, stdout: planBody, stderr: '' };
        if (args[0] === 'show' && args[1] === `head:${targetPath}`) return { exitCode: 0, stdout: 'export const widget = true;\n', stderr: '' };
        if (args[0] === 'show' && args[1] === `base:${targetPath}`) return { exitCode: 0, stdout: 'export const widget = false;\n', stderr: '' };
        if (args[0] === 'show' && args[1] === `head:${otherPath}`) return { exitCode: 0, stdout: 'export const other = true;\n', stderr: '' };
        if (args[0] === 'show' && args[1] === `base:${otherPath}`) return { exitCode: 0, stdout: 'export const other = false;\n', stderr: '' };
        if (args[0] === 'ls-tree') return { exitCode: 0, stdout: '', stderr: '' };
        return { exitCode: 1, stdout: '', stderr: '' };
      };
      const runner = new DefaultStepRunner(createMockProvider(), 'replication', projectDir, {
        gitRunner,
        planPath,
        config: {
          build_review: {
            enabled: true,
            rubrics: { testQuality: { enabled: false }, security: { enabled: false }, implementationQuality: { enabled: true } },
          },
        } as HarnessConfig,
        buildReviewInputOptions: {
          inspectTestSuite: async () => ({ status: 'CURRENT', evidence: { provenanceHeadSha: 'head', outcome: 'PASS' } } as never),
        },
        buildReviewEffectiveResolver: async (_projectRoot, result) => {
          const resolved = deriveEffectiveBuildReviewVerdict(result);
          if (!resolved) throw new Error('expected build_review aggregate to yield an effective verdict');
          effective = resolved;
          return { ok: true, feature: { version: 'v1', repository: projectDir, feature: 'replication' }, effective };
        },
      });
      vi.spyOn(runner as any, 'fileExists').mockImplementation(async (...args: any[]) => args[0] === join(projectDir, sourcePath));
      vi.spyOn(runner as any, 'dispatchBuildReviewRubric').mockImplementation(async (branch: any, projection: any) => {
        const loci = Object.fromEntries(projection.changedFiles.map((file: any) => [file.path, {
          path: file.path,
          contentHash: file.hunks[0].contentHash,
          display: `${file.path}:1`,
        }]));
        return {
          kind: 'judged', rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
          contractVersion: 'v4', findings: [finding = makeFinding({ target: loci[targetPath], other: loci[otherPath] })], verdict: 'FAIL',
        };
      });

      const runResult = await runner.run('build_review', emptyState);
      expect(runResult).toMatchObject({ success: true });

      const persisted = JSON.parse(await readFile(join(projectDir, '.pipeline/build-review.json'), 'utf8'));
      const identity = canonicalizeBuildReviewFindingIdentity({ rubric: 'implementationQuality', contractVersion: 'v4', concernKind: finding!.concernKind, anchor: finding!.anchor })!;
      return { persisted, effective, identity };
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  };

  it('persists a target-anchored source-only-evidence duplication from the active plan as a declaredReplicationSuppression', async () => {
    const { persisted, effective, identity } = await runDeclaredReplication(({ target }) => ({
      ...duplication(),
      anchor: { rubric: 'implementationQuality', locus: target },
    }));

    expect(persisted.declaredReplicationSuppressions).toEqual([{ findingId: identity.id, sourcePath, targetPath }]);
    expect(effective).toMatchObject({ verdict: 'PASS', suppressedFindingIds: [identity.id] });
  });

  it.each([
    ['an off-target anchor', ({ other }: any) => ({
      ...duplication(otherPath),
      anchor: { rubric: 'implementationQuality' as const, locus: other },
    })],
    ['mixed source and foreign evidence', ({ target }: any) => ({
      ...duplication(),
      evidenceLocations: [`${sourcePath}:8`, `${otherPath}:8`],
      anchor: { rubric: 'implementationQuality' as const, locus: target },
    })],
  ])('does not suppress declared replication with %s', async (_label, makeFinding) => {
    const { persisted, effective, identity } = await runDeclaredReplication(makeFinding);

    expect(persisted.declaredReplicationSuppressions).toEqual([]);
    expect(effective).toMatchObject({ verdict: 'FAIL', unresolvedFindingIds: [identity.id] });
  });

  it('does not suppress a source-only duplication when the plan has no Pattern-source declaration', async () => {
    const { persisted, effective, identity } = await runDeclaredReplication(({ target }) => ({
      ...duplication(),
      anchor: { rubric: 'implementationQuality', locus: target },
    }), '# Plan\n\nThis plan declares no replication source.\n');

    expect(persisted.declaredReplicationSuppressions).toEqual([]);
    expect(effective).toMatchObject({ verdict: 'FAIL', unresolvedFindingIds: [identity.id] });
  });
});

function interactiveRuntime(
  key: 'claude' | 'codex',
  invokeResponse: LLMProvider['invoke'],
) {
  const policy =
    key === 'claude' ? CLAUDE_POLICY : CODEX_MODEL_POLICY;
  const lifecycleCapability = { synchronousSpawnPermit: true } as const;
  const nativeSchemaCapability = { nativeOutputSchema: true } as const;
  return {
    key,
    provider: {
      supportsSessionResume: key === 'claude',
      lifecycleCapability,
      nativeSchemaCapability,
      invoke: async (options: InvokeOptions): Promise<InvokeResult> =>
        (await invokeResponse(options)) ?? { success: true, output: '', exitCode: 0 },
    },
    lifecycleCapability,
    nativeSchemaCapability,
    policy,
    builtIn: true,
    availability: new ModelAvailability(policy.modelFallbackLadder),
  };
}

const emptyState: ConductState = {};

// Session reuse was removed by design: every provider invocation mints its
// own fresh UUID (never a store-derived id) and never resumes. Tests assert
// uniqueness + UUID shape instead of pinning store-supplied session names.
const FRESH_SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function expectUniqueFreshSessionIds(sessionIds: ReadonlyArray<string | undefined>): void {
  expect(sessionIds.length).toBeGreaterThan(0);
  expect(new Set(sessionIds).size).toBe(sessionIds.length);
  for (const id of sessionIds) expect(id).toMatch(FRESH_SESSION_ID_RE);
}

describe('DefaultStepRunner', () => {
  it('carries the provider that produced provider exit facts onto the step result', () => {
    const runner = new DefaultStepRunner(createMockProvider(), 'session-1', '/tmp/project');
    const toStepRunResult = (runner as unknown as {
      toStepRunResult(step: StepName, result: ProviderExecutionResult): unknown;
    }).toStepRunResult.bind(runner);

    expect(toStepRunResult('remediate', {
      success: false,
      output: 'provider failed',
      exitCode: 1,
      preferredProvider: 'codex',
      actualProvider: 'claude',
      exitFacts: { processErrorCode: 'E2BIG' },
      attempts: [],
    })).toMatchObject({
      provider: 'claude',
      exitFacts: { processErrorCode: 'E2BIG' },
    });

    const preferredProviderResult = toStepRunResult('remediate', {
      success: false,
      output: 'provider unavailable',
      exitCode: 1,
      preferredProvider: 'codex',
      attempts: [],
    });
    expect(preferredProviderResult).toMatchObject({ provider: 'codex' });
    expect(preferredProviderResult).not.toHaveProperty('exitFacts');
  });

  it('settles every shared source member after a custom-only early exit', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'build-review-materialization-settlement-'));
    const settle = vi.fn(async (_memberId: string) => {});
    const source = {
      identity: {
        snapshotDigest: 'sha256:snapshot', contentDigest: 'sha256:content',
        mergeBase: 'a'.repeat(40), headSha: 'b'.repeat(40),
      },
      baselinePath: join(projectDir, 'baseline'),
      headPath: join(projectDir, 'head'),
    };
    const runner = new DefaultStepRunner(createMockProvider(), 'materialization-settlement', projectDir, {
      buildReviewEffectiveResolver: async () => ({
        ok: true,
        feature: { version: 'v1', repository: projectDir, feature: 'materialization-settlement' },
        effective: {
          rawVerdict: 'FAIL', verdict: 'FAIL', acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [],
          skippedRubrics: ['testQuality'], infrastructureFailureRubrics: ['portable'],
          uncoveredInfrastructureFailureRubrics: ['portable'], uncoveredScopeIncompleteRubrics: [],
        },
      }) as never,
    });
    const config = resolveBuildReviewConfig({
      llm_provider: 'claude',
      build_review: {
        enabled: true,
        rubrics: { testQuality: { enabled: false }, security: { enabled: false }, implementationQuality: { enabled: false } },
        custom_rubrics: {
          portable: { enabled: true, skill: 'portable-policy', question: 'Check the frozen input.', llm_provider: 'claude' },
          portableTwo: { enabled: true, skill: 'portable-two-policy', question: 'Check the frozen input again.', llm_provider: 'claude' },
        },
      },
    } as HarnessConfig, CLAUDE_POLICY);
    expect(config.catalog).toHaveLength(2);
    const inputs = {
      sourceSnapshot: {
        digest: 'sha256:snapshot', contentDigest: 'sha256:content', baseRef: 'origin/main',
        mergeBase: 'a'.repeat(40), headSha: 'b'.repeat(40), diff: '', planBody: '', repairContext: [],
        removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] }, sourceChanges: [],
      },
      sourceMaterialization: {
        source,
        contextFor: (memberId: string) => ({ memberId, source }),
        settle,
      },
    } as never;

    try {
      await (runner as unknown as {
        runRubricBuildReview(value: unknown, resolved: typeof config, tier: ConductState['complexity_tier']): Promise<unknown>;
      }).runRubricBuildReview(inputs, config, 'S');

      expect(settle.mock.calls.map(([memberId]) => memberId).sort()).toEqual(
        ['portable', 'portableTwo'],
      );
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('refuses Pi by the review-policy catalog owner in an unmutated custom-policy lap before dispatching Claude', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'build-review-custom-policy-catalog-'));
    const baselinePath = join(projectDir, 'baseline');
    const headPath = join(projectDir, 'head');
    await Promise.all([mkdir(baselinePath), mkdir(headPath)]);
    const attempts: ProviderAttemptEvent[] = [];
    const piInvoke = vi.fn();
    const claudeInvoke = vi.fn(async (_options: InvokeOptions): Promise<InvokeResult> => ({
      success: true,
      output: JSON.stringify({ kind: 'custom-findings', version: 'v2', findings: [] }),
      exitCode: 0,
      finalStructuredResult: { kind: 'custom-findings', version: 'v2', findings: [] },
    }));
    const lifecycleCapability = { synchronousSpawnPermit: true } as const;
    const nativeSchemaCapability = { nativeOutputSchema: true } as const;
    const runtime = (key: 'pi' | 'claude', invoke: LLMProvider['invoke']) => ({
      key,
      provider: { lifecycleCapability, nativeSchemaCapability, invoke },
      lifecycleCapability,
      nativeSchemaCapability,
      policy: CLAUDE_POLICY,
      builtIn: true,
      availability: new ModelAvailability(CLAUDE_POLICY.modelFallbackLadder),
    });
    const source = {
      identity: {
        snapshotDigest: 'sha256:snapshot', contentDigest: 'sha256:content',
        mergeBase: 'a'.repeat(40), headSha: 'b'.repeat(40),
      },
      baselinePath,
      headPath,
    };
    const config = resolveBuildReviewConfig({
      llm_provider: 'claude',
      build_review: {
        enabled: true,
        rubrics: { testQuality: { enabled: false }, security: { enabled: false }, implementationQuality: { enabled: false } },
        custom_rubrics: {
          portable: {
            enabled: true, skill: 'portable-policy', question: 'Check the frozen input.',
            llm_provider: ['pi', 'claude'], max_retries: 1,
          },
        },
      },
    } as HarnessConfig, CLAUDE_POLICY);
    const runner = new DefaultStepRunner(createMockProvider(), 'custom-policy-catalog', projectDir, {
      providerRuntimes: new ProviderRuntimeSet([
        runtime('pi', piInvoke),
        runtime('claude', claudeInvoke),
      ]),
      sessionStore: new ProviderSessionStore(),
      configuredProviders: ['pi', 'claude'],
      providerAttempt: (step, attempt) => { attempts.push({ type: 'provider_attempt', step, ...attempt }); },
      buildReviewPolicyCatalog: async () => [{
        semanticName: 'portable-policy', source: 'project', installationOrigin: '/fixture/project',
        canonicalSkillPath: '/fixture/project/SKILL.md', packageRoot: '/fixture/project',
        declaredDependencies: [], availability: 'available',
      }],
      buildReviewPolicyCapture: async (policy) => ({
        policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md',
        manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Portable policy\n') }],
        metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] },
        digest: `sha256-v1:${'a'.repeat(64)}`,
      }),
      buildReviewEffectiveResolver: async () => ({
        ok: true,
        feature: { version: 'v1', repository: projectDir, feature: 'custom-policy-catalog' },
        effective: {
          rawVerdict: 'PASS', verdict: 'PASS', acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [],
          skippedRubrics: ['testQuality'], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [],
          uncoveredScopeIncompleteRubrics: [],
        },
      }) as never,
    });
    const inputs = {
      sourceSnapshot: {
        digest: 'sha256:snapshot', contentDigest: 'sha256:content', baseRef: 'origin/main',
        mergeBase: 'a'.repeat(40), headSha: 'b'.repeat(40), diff: '', planBody: '', repairContext: [],
        removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] }, sourceChanges: [],
      },
      sourceMaterialization: {
        source,
        contextFor: (memberId: string) => ({ memberId, source }),
        settle: async () => {},
        finish: async () => {},
      },
    } as never;

    try {
      await (runner as unknown as {
        runRubricBuildReview(value: unknown, resolved: typeof config, tier: ConductState['complexity_tier'], planPath: undefined, context: undefined, capabilities: unknown): Promise<unknown>;
      }).runRubricBuildReview(inputs, config, 'S', undefined, undefined, {
        claude: { provider: 'claude', platform: process.platform, status: 'available' },
      });

      expect(piInvoke).not.toHaveBeenCalled();
      expect(claudeInvoke).toHaveBeenCalledOnce();
      const durableScope = {
        mode: 'delta' as const,
        reason: 'delta' as const,
        sequence: 2,
        predecessorLapId: 'lap-predecessor',
        unreadableLapIds: [],
        mergeBase: 'a'.repeat(40),
        headSha: 'b'.repeat(40),
        policyIdentity: `sha256:${'c'.repeat(64)}`,
        reviewedHunks: [{ path: 'src/reviewed.ts', contentHash: `sha256:${'d'.repeat(64)}` }],
        deltaHunks: [{ path: 'src/current.ts', contentHash: `sha256:${'e'.repeat(64)}` }],
        outOfDeltaSourceIds: ['portable:prior-finding'],
      };
      await (runner as unknown as {
        dispatchInstalledBuildReviewPolicy(...args: readonly unknown[]): Promise<unknown>;
      }).dispatchInstalledBuildReviewPolicy(
        config.catalog[0], inputs, 'lap-scope-projection', 'S', undefined,
        async () => ({ provider: 'claude', platform: process.platform, status: 'available' }),
        join(projectDir, '.pipeline'), undefined, durableScope, undefined, undefined,
        async (policyIdentity: string) => ({ ...durableScope, policyIdentity }),
      );
      // Covers: task:rem-as-built-6-r2
      const serializedCustomInput = (claudeInvoke.mock.calls[1]![0] as InvokeOptions).prompt
        .match(/Frozen build-review input [^\n]+\.\nReview scope: (.+)\n/)?.[1];
      expect(serializedCustomInput).toBeDefined();
      expect(JSON.parse(serializedCustomInput!)).toEqual({
        reviewScope: {
          mode: 'delta',
          deltaHunks: [{ path: 'src/current.ts', contentHash: `sha256:${'e'.repeat(64)}` }],
        },
      });
      expect(serializedCustomInput).not.toContain('predecessorLapId');
      expect(serializedCustomInput).not.toContain('reviewedHunks');
      expect(serializedCustomInput).not.toContain('outOfDeltaSourceIds');
      expect(attempts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          provider: 'pi', outcome: 'unavailable', invoked: false,
          skipReason: 'setup-unavailable', reason: expect.stringContaining('#2852'),
        }),
        expect.objectContaining({ provider: 'claude', invoked: true }),
      ]));
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('withholds the custom-only aggregate, resolution, and verdict until the mechanical allowance is exhausted', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'build-review-custom-only-allowance-'));
    const resolver = vi.fn(async () => ({
      ok: true,
      feature: { version: 'v1', repository: projectDir, feature: 'custom-only-allowance' },
      effective: {
        rawVerdict: 'FAIL', verdict: 'FAIL', acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [],
        skippedRubrics: ['testQuality'], infrastructureFailureRubrics: ['portable'],
        uncoveredInfrastructureFailureRubrics: ['portable'], uncoveredScopeIncompleteRubrics: [],
      },
    }));
    const runner = new DefaultStepRunner(createMockProvider(), 'custom-only-allowance', projectDir, {
      buildReviewEffectiveResolver: resolver as never,
    });
    const declaration = {
      version: 'v1' as const, rubricId: 'portable', semanticSkill: 'portable-policy',
      question: 'Check the frozen input.', resources: [],
    };
    const publish = (lap: number) => (runner as unknown as {
      publishCustomOnlyBuildReview(input: unknown): Promise<{ success: boolean; output: string; currentLapMechanicalFault?: boolean }>;
    }).publishCustomOnlyBuildReview({
      lapId: `lap-${lap}`,
      inputs: { sourceSnapshot: { digest: 'sha256:snapshot' } },
      customResults: {
        portable: {
          declaration,
          result: { kind: 'infrastructure-failure', rubric: 'portable', reason: 'policy-load-failed', detail: 'catalog unavailable' },
        },
      },
      currentCustomRubrics: ['portable'],
      config: resolveBuildReviewConfig({ llm_provider: 'claude', build_review: { enabled: true } } as HarnessConfig, CLAUDE_POLICY),
    });
    const aggregatePath = join(projectDir, '.pipeline', 'build-review.json');

    try {
      for (const lap of [1, 2]) {
        const belowCap = await publish(lap);
        expect(belowCap).toMatchObject({ success: false, currentLapMechanicalFault: true });
        expect(belowCap.output).toContain('catalog unavailable');
        await expect(access(aggregatePath)).rejects.toThrow();
        expect(resolver).not.toHaveBeenCalled();
      }

      const exhausted = await publish(3);
      expect(exhausted.currentLapMechanicalFault).toBe(true);
      expect(JSON.parse(await readFile(aggregatePath, 'utf-8'))).toMatchObject({ lapId: 'lap-3' });
      expect(resolver).toHaveBeenCalledTimes(1);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  async function exhaustLifecycle(projectDir: string) {
    let now = 0;
    const episodeStore: ProviderLifecycleEpisodeStore = {
      readProviderLifecycleEpisode: vi.fn().mockResolvedValue({ recoveryAuthority: 'fresh' }),
      writeProviderLifecycleEpisode: vi.fn(),
    };
    const runner = new DefaultStepRunner(createMockProvider(), 'session', projectDir, {
      configuredProviders: ['codex'],
      providerLifecycleTimer: {
        now: () => now,
        schedule: (callback) => {
          queueMicrotask(() => { now += 1; callback(); });
          return {};
        },
        cancel: () => undefined,
      },
      providerLifecycleEpisodeStore: episodeStore,
    });
    const dispatch = (runner as unknown as {
      dispatchProviderWithLifecycleSupervision: (
        step: StepName,
        options: ExecuteProviderCandidatesInput['options'],
        run: () => Promise<never>,
      ) => Promise<ProviderExecutionResult>;
    }).dispatchProviderWithLifecycleSupervision.bind(runner);
    return dispatch('build', { prompt: 'prepare provider', cwd: projectDir }, () => new Promise<never>(() => undefined));
  }

  it('preserves a failed lifecycle halt-marker write for the provider caller', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'lifecycle-halt-failure-'));
    const projectFile = join(temporaryDirectory, 'not-a-directory');
    await writeFile(projectFile, 'not a directory');
    try {
      const result = await exhaustLifecycle(projectFile);
      const expectedMarkerPath = join(projectFile, '.pipeline/HALT');
      const expectedReason = /ENOTDIR|not a directory/i;
      expect(result).toMatchObject({
        success: false,
        haltMarkerWrite: {
          status: 'failed',
          path: expectedMarkerPath,
          reason: expect.stringMatching(expectedReason),
        },
      });
      expect(result.output).toContain(`Halt marker write failed at ${expectedMarkerPath}:`);
      expect(result.output).toMatch(expectedReason);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('keeps the successful lifecycle halt-marker message unchanged', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'lifecycle-halt-success-'));
    try {
      expect(await exhaustLifecycle(projectDir)).toMatchObject({
        output: 'Provider preparation timed out twice. See .pipeline/HALT.',
        haltMarkerWrite: { status: 'written' },
      });
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: 'autonomous scalar conversion',
      run: async () => {
        const observedIntervals = [{ startedAtMs: 100, durationMs: 25 }];
        const provider: LLMProvider = {
          invoke: vi.fn(async (): Promise<InvokeResult> => ({
            success: true,
            output: 'done',
            exitCode: 0,
            observedIntervals,
          })),
        };
        const runner = new DefaultStepRunner(provider, 'session', '/tmp/project');

        return { observedIntervals, result: await runner.run('build', emptyState) };
      },
    },
    {
      name: 'provider-aware success conversion',
      run: async () => {
        const observedIntervals = [{ startedAtMs: 200, durationMs: 30 }];
        const providerExecutor = vi.fn(async (_input: ExecuteProviderCandidatesInput) => ({
          success: true,
          output: 'done',
          exitCode: 0,
          observedIntervals,
          preferredProvider: 'codex',
          actualProvider: 'codex',
          attempts: [],
        }));
        const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', {
          providerExecution: {
            configuredProviders: ['codex'],
            runtimes: new ProviderRuntimeSet([
              interactiveRuntime('codex', vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: '', exitCode: 0 }))),
            ]),
            sessions: new ProviderSessionStore(),
            executor: providerExecutor,
          },
        });

        return { observedIntervals, result: await runner.run('build', emptyState) };
      },
    },
    {
      name: 'provider-aware failure conversion',
      run: async () => {
        const observedIntervals = [{ startedAtMs: 300, durationMs: 35 }];
        const providerExecutor = vi.fn(async (_input: ExecuteProviderCandidatesInput) => ({
          success: false,
          output: 'failed',
          exitCode: 1,
          observedIntervals,
          preferredProvider: 'claude',
          attempts: [],
        }));
        const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', {
          providerExecution: {
            configuredProviders: ['claude'],
            runtimes: new ProviderRuntimeSet([
              interactiveRuntime('claude', vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: '', exitCode: 0 }))),
            ]),
            sessions: new ProviderSessionStore(),
            executor: providerExecutor,
          },
        });

        return { observedIntervals, result: await runner.run('build', emptyState) };
      },
    },
    {
      name: 'streaming conversion',
      run: async () => {
        const observedIntervals = [{ startedAtMs: 400, durationMs: 40 }];
        const runtime = interactiveRuntime(
          'claude',
          vi.fn(async (): Promise<InvokeResult> => ({
            success: true,
            output: 'streamed',
            exitCode: 0,
            observedIntervals,
          })),
        );
        const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', {
          providerExecution: {
            configuredProviders: ['claude'],
            runtimes: new ProviderRuntimeSet([runtime]),
            sessions: new ProviderSessionStore(),
          },
        });
        await runner.resetSession('explore');

        return { observedIntervals, result: await runner.run('explore', emptyState) };
      },
    },
  ])('preserves observed intervals through $name', async ({ run }) => {
    const { observedIntervals, result } = await run();

    expect(result.observedIntervals?.[0]).toBe(observedIntervals[0]);
  });

  it('forwards resolved effort only when the provider-aware result resolves it', async () => {
    const providerExecutor = vi.fn()
      .mockResolvedValueOnce({
        success: true,
        output: 'done',
        exitCode: 0,
        resolvedEffort: 'high',
        preferredProvider: 'codex',
        actualProvider: 'codex',
        attempts: [],
      })
      .mockResolvedValueOnce({
        success: true,
        output: 'done',
        exitCode: 0,
        preferredProvider: 'codex',
        actualProvider: 'codex',
        attempts: [],
      });
    const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', {
      providerExecution: {
        configuredProviders: ['codex'],
        runtimes: new ProviderRuntimeSet([
          interactiveRuntime('codex', vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: '', exitCode: 0 }))),
        ]),
        sessions: new ProviderSessionStore(),
        executor: providerExecutor,
      },
    });

    const results = [
      await runner.run('build', emptyState),
      await runner.run('build', emptyState),
    ];

    expect(results.map((result) => ({
      hasEffort: Object.hasOwn(result, 'effort'),
      effort: (result as { effort?: string }).effort,
    }))).toEqual([
      { hasEffort: true, effort: 'high' },
      { hasEffort: false, effort: undefined },
    ]);
  });

  it('forwards task-local attribution to provider-aware normal dispatch', async () => {
    const providerExecutor = vi.fn(async (_input: ExecuteProviderCandidatesInput) => ({
      success: true,
      output: 'done',
      exitCode: 0,
      preferredProvider: 'codex',
      actualProvider: 'codex',
      attempts: [],
    }));
    const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', {
      providerExecution: {
        configuredProviders: ['codex'],
        runtimes: new ProviderRuntimeSet([interactiveRuntime('codex', vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: '', exitCode: 0 })))]),
        sessions: new ProviderSessionStore(),
        executor: providerExecutor,
        taskAttribution: {
          taskId: '2',
          seededTaskIds: ['1', '2'],
          expectedTaskId: '2',
        },
      },
    });

    await runner.run('build', emptyState);

    expect(providerExecutor.mock.calls[0]?.[0].taskAttribution).toEqual({
      taskId: '2',
      seededTaskIds: ['1', '2'],
      expectedTaskId: '2',
    });
  });

  it('forwards provider-aware lifecycle transitions to the provider-attempt sink before settlement', async () => {
    const providerAttempt = vi.fn();
    const providerExecutor = vi.fn(async (input: ExecuteProviderCandidatesInput) => {
      input.options.spawnPermit?.();
      return {
        success: true,
        output: 'done',
        exitCode: 0,
        preferredProvider: 'claude' as const,
        actualProvider: 'claude' as const,
        attempts: [],
      };
    });
    const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', {
      providerExecution: {
        configuredProviders: ['claude'],
        runtimes: new ProviderRuntimeSet([interactiveRuntime('claude', vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: '', exitCode: 0 })))]),
        sessions: new ProviderSessionStore(),
        executor: providerExecutor,
      },
      providerAttempt,
    });

    const result = await runner.run('build', emptyState);
    const lifecyclePhases = providerAttempt.mock.calls.flatMap(([, metadata]) => {
      const lifecycle = (metadata as { lifecycle?: { phase?: string } }).lifecycle;
      return lifecycle?.phase ? [lifecycle.phase] : [];
    });

    expect({ lifecyclePhases, settled: result.success }).toEqual({
      lifecyclePhases: ['preparing', 'running', 'settled'],
      settled: true,
    });
  });

  it('makes the engine-supplied dispatch run id the provider-lifecycle attempt id', async () => {
    const providerAttempt = vi.fn();
    const providerExecutor = vi.fn(async (input: ExecuteProviderCandidatesInput) => {
      input.options.spawnPermit?.();
      return {
        success: true,
        output: 'done',
        exitCode: 0,
        preferredProvider: 'claude' as const,
        actualProvider: 'claude' as const,
        attempts: [],
      };
    });
    const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', {
      providerExecution: {
        configuredProviders: ['claude'],
        runtimes: new ProviderRuntimeSet([interactiveRuntime('claude', vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: '', exitCode: 0 })))]),
        sessions: new ProviderSessionStore(),
        executor: providerExecutor,
      },
      providerAttempt,
    });

    await runner.run('build', emptyState, { runId: 'engine-dispatch-identity' });

    const attemptIds = providerAttempt.mock.calls.flatMap(([, metadata]) => {
      const lifecycle = (metadata as { lifecycle?: { attemptId?: string } }).lifecycle;
      return lifecycle?.attemptId ? [lifecycle.attemptId] : [];
    });

    // One identity authority per dispatch: the id the engine stamps into the
    // verdict sidecar is the id the lifecycle logs, not a second UUID.
    expect(attemptIds.length).toBeGreaterThan(0);
    expect(new Set(attemptIds)).toEqual(new Set(['engine-dispatch-identity']));
  });

  it('keeps its own run-scoped attempt id when no dispatch run id is supplied', async () => {
    const providerAttempt = vi.fn();
    const providerExecutor = vi.fn(async (input: ExecuteProviderCandidatesInput) => {
      input.options.spawnPermit?.();
      return {
        success: true,
        output: 'done',
        exitCode: 0,
        preferredProvider: 'claude' as const,
        actualProvider: 'claude' as const,
        attempts: [],
      };
    });
    const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', {
      providerExecution: {
        configuredProviders: ['claude'],
        runtimes: new ProviderRuntimeSet([interactiveRuntime('claude', vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: '', exitCode: 0 })))]),
        sessions: new ProviderSessionStore(),
        executor: providerExecutor,
      },
      providerAttempt,
    });

    await runner.run('build', emptyState);

    const attemptIds = providerAttempt.mock.calls.flatMap(([, metadata]) => {
      const lifecycle = (metadata as { lifecycle?: { attemptId?: string } }).lifecycle;
      return lifecycle?.attemptId ? [lifecycle.attemptId] : [];
    });
    expect(new Set(attemptIds)).toEqual(new Set(['session:build:1']));
  });

  it('forwards the daemon feature diagnostic logger to a streaming provider invocation', async () => {
    const featureLog = vi.fn();
    const providerExecutor = vi.fn(async (_input: ExecuteProviderCandidatesInput) => ({
      success: true,
      output: 'done',
      exitCode: 0,
      preferredProvider: 'claude',
      actualProvider: 'claude',
      attempts: [],
    }));
    const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', {
      providerExecution: {
        configuredProviders: ['claude'],
        runtimes: new ProviderRuntimeSet([interactiveRuntime('claude', vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: '', exitCode: 0 })))]),
        sessions: new ProviderSessionStore(),
        executor: providerExecutor,
        diagnosticLog: featureLog,
      },
    });

    await runner.run('build', emptyState);

    expect(providerExecutor.mock.calls[0]?.[0].options.diagnosticLog).toBe(featureLog);
  });

  it('forwards the daemon feature diagnostic logger to a one-shot skill provider invocation', async () => {
    const featureLog = vi.fn();
    const invoke = vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => {
      // Stand in for the provider subprocess diagnostics that claude-provider
      // and codex-provider route to `options.diagnosticLog`.
      options.diagnosticLog?.('claude: subprocess diagnostic');
      return { success: true, output: 'remediated', exitCode: 0 };
    });
    const policy = CLAUDE_POLICY;
    const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', {
      providerExecution: {
        configuredProviders: ['claude'],
        // The real executeProviderCandidates runs here on purpose: the
        // scoped-options -> candidate-options precedence is the behavior
        // under test, so it must not be stubbed out by an injected executor.
        runtimes: new ProviderRuntimeSet([
          {
            key: 'claude',
            provider: {
              lifecycleCapability: { synchronousSpawnPermit: true },
              invoke,
            },
            policy,
            builtIn: true,
            availability: new ModelAvailability(policy.modelFallbackLadder),
          },
        ]),
        sessions: new ProviderSessionStore(),
        diagnosticLog: featureLog,
      },
    });

    await runner.run('remediate', emptyState);

    const candidatePrompt = invoke.mock.calls[0]?.[0].prompt;
    expect({
      // Proves the candidate-specific (skill-rendered) options were the ones
      // delivered, and that the feature-scoped logger survived into them.
      renderedSkillInvocation: candidatePrompt?.startsWith('/remediate') ?? false,
      diagnosticLogForwarded: invoke.mock.calls[0]?.[0].diagnosticLog === featureLog,
      scopedLogLines: featureLog.mock.calls.map(([line]) => line),
    }).toEqual({
      renderedSkillInvocation: true,
      diagnosticLogForwarded: true,
      scopedLogLines: ['claude: subprocess diagnostic'],
    });
  });

  it.each(['claude', 'codex'] as const)(
    'forwards one native reconciliation invocation and its terminal structured result to %s',
    async (providerKey) => {
      const nativeSchema = { type: 'object', required: ['version', 'results'] };
      const terminalResult = {
        version: 'v1',
        results: [{ sourceId: 'current-1', kind: 'different', reason: 'The lease duration changed.' }],
      };
      const invoke = vi.fn(async (): Promise<InvokeResult> => ({
        success: true,
        output: '```json\nnot the terminal contract result\n```',
        exitCode: 0,
        finalStructuredResult: terminalResult,
      }));
      const provider: LLMProvider = {
        lifecycleCapability: { synchronousSpawnPermit: true },
        nativeSchemaCapability: { nativeOutputSchema: true },
        invoke,
      };
      const policy = providerKey === 'claude' ? CLAUDE_POLICY : CODEX_MODEL_POLICY;
      const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', {
        config: { llm_provider: providerKey, steps: { remediate: { llm_provider: providerKey } } },
        configuredProviders: [providerKey],
        providerRuntimes: new ProviderRuntimeSet([{
          key: providerKey,
          provider,
          policy,
          builtIn: true,
          availability: new ModelAvailability(policy.modelFallbackLadder),
        }]),
        sessionStore: new ProviderSessionStore(),
      });

      const result = await runner.run('remediate', emptyState, {
        remediationRequest: {
          mode: 'prd-widening-reconciliation',
          projection: '{"currentSources":[{"id":"current-1"}],"priorCases":[]}',
          nativeSchema,
        },
      });

      const options = (invoke.mock.calls as unknown as [InvokeOptions][])[0]?.[0];
      expect({
        prompt: options.prompt,
        nativeSchema: options.nativeSchema,
        terminalResult: result.finalStructuredResult,
      }).toEqual({
        prompt: `${providerKey === 'claude' ? '/' : '$'}remediate\n\nPRD WIDENING RECONCILIATION INPUT (engine-owned):\n{"currentSources":[{"id":"current-1"}],"priorCases":[]}`,
        nativeSchema,
        terminalResult,
      });
    },
  );

  it('fails closed only for reconciliation when the selected provider lacks native schema capability', async () => {
    const invoke = vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: 'gap plan', exitCode: 0 }));
    const provider: LLMProvider = {
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke,
    };
    const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', {
      config: { llm_provider: 'claude', steps: { remediate: { llm_provider: 'claude' } } },
      configuredProviders: ['claude'],
      providerRuntimes: new ProviderRuntimeSet([{
        key: 'claude',
        provider,
        policy: CLAUDE_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CLAUDE_POLICY.modelFallbackLadder),
      }]),
      sessionStore: new ProviderSessionStore(),
    });

    const ordinary = await runner.run('remediate', emptyState);
    const reconciliation = await runner.run('remediate', emptyState, {
      remediationRequest: {
        mode: 'prd-widening-reconciliation',
        projection: '{"currentSources":[],"priorCases":[]}',
        nativeSchema: { type: 'object' },
      },
    });

    const ordinaryInvocation = (invoke.mock.calls as unknown as [InvokeOptions][])[0]?.[0];
    expect({
      ordinary,
      reconciliation,
      invokeCalls: invoke.mock.calls.length,
      ordinaryInvocation,
      ordinaryNativeSchema: ordinaryInvocation?.nativeSchema,
    }).toEqual({
      ordinary: expect.objectContaining({ success: true, output: 'gap plan' }),
      reconciliation: expect.objectContaining({
        success: false,
        output: expect.stringContaining('cannot enforce the requested native output schema'),
      }),
      invokeCalls: 1,
      ordinaryInvocation: expect.objectContaining({ prompt: '/remediate' }),
      ordinaryNativeSchema: undefined,
    });
  });

  describe('step-heartbeat telemetry wiring', () => {
    let projectDir: string;

    beforeEach(async () => {
      projectDir = await mkdtemp(join(tmpdir(), 'step-runner-heartbeat-'));
    });
    afterEach(async () => {
      await rm(projectDir, { recursive: true, force: true });
    });

    it('touches .pipeline/step-heartbeat when the provider dispatch reports activity', async () => {
      const providerExecutor = vi.fn(async (input: ExecuteProviderCandidatesInput) => {
        // Simulate a streamed provider event boundary firing onActivity.
        (input.options as InvokeOptions & { onActivity?: () => void }).onActivity?.();
        return {
          success: true,
          output: 'done',
          exitCode: 0,
          preferredProvider: 'claude',
          actualProvider: 'claude',
          attempts: [],
        };
      });
      const runner = new DefaultStepRunner(createMockProvider(), 'session', projectDir, {
        providerExecution: {
          configuredProviders: ['claude'],
          runtimes: new ProviderRuntimeSet([interactiveRuntime('claude', vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: '', exitCode: 0 })))]),
          sessions: new ProviderSessionStore(),
          executor: providerExecutor,
        },
      });

      await runner.run('build', emptyState);
      // The activity pulse writes fire-and-forget; give the IO queue a tick.
      await new Promise((r) => setTimeout(r, 20));

      const raw = await readFile(join(projectDir, '.pipeline', 'step-heartbeat'), 'utf-8');
      const heartbeat = JSON.parse(raw);
      expect(heartbeat.step).toBe('build');
      expect(Number.isFinite(Date.parse(heartbeat.ts))).toBe(true);
    });

    it('allows a quiet spawned provider to succeed beyond the former heartbeat threshold', async () => {
      const base = Date.now();
      let silent = false;
      const providerExecutor = vi.fn(async (input: ExecuteProviderCandidatesInput) => {
        input.options.onSpawn?.();
        (input.options as InvokeOptions & { onActivity?: () => void }).onActivity?.();
        // Let the initial pulse settle, then advance the old watchdog's
        // injected clock beyond its threshold and grace period.
        await new Promise((resolve) => setTimeout(resolve, 10));
        silent = true;
        await new Promise((r) => setTimeout(r, 60));
        return {
          success: true,
          output: 'reviewed',
          exitCode: 0,
          preferredProvider: 'claude',
          actualProvider: 'claude',
          attempts: [],
        };
      });
      const config: HarnessConfig = { step_heartbeat_stall_minutes: 1 };
      const runner = new DefaultStepRunner(createMockProvider(), 'session', projectDir, {
        config,
        heartbeatWatchdog: {
          pollIntervalMs: 5,
          now: () => (silent ? base + 60 * 60_000 : base),
        },
        providerExecution: {
          configuredProviders: ['claude'],
          runtimes: new ProviderRuntimeSet([interactiveRuntime('claude', vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: '', exitCode: 0 })))]),
          sessions: new ProviderSessionStore(),
          executor: providerExecutor as unknown as typeof executeProviderCandidates,
        },
      });

      const result = await runner.run('build', emptyState);

      expect(result.success).toBe(true);
      expect(providerExecutor).toHaveBeenCalledTimes(1);
      await expect(readFile(join(projectDir, '.pipeline', 'HALT'), 'utf-8')).rejects.toThrow();
    });

    it.each([
      {
        name: 'absent',
        setup: async () => {},
      },
      {
        name: 'malformed',
        setup: async () => {
          await mkdir(join(projectDir, '.pipeline'), { recursive: true });
          await writeFile(join(projectDir, '.pipeline', 'step-heartbeat'), 'not json', 'utf-8');
        },
      },
      {
        name: 'prior-dispatch',
        setup: async () => {
          await mkdir(join(projectDir, '.pipeline'), { recursive: true });
          await writeFile(
            join(projectDir, '.pipeline', 'step-heartbeat'),
            JSON.stringify({ step: 'architecture_review_as_built', ts: new Date(0).toISOString() }),
            'utf-8',
          );
        },
      },
    ])('keeps $name heartbeat data observational for a quiet spawned provider', async ({ setup }) => {
      await setup();
      const providerExecutor = vi.fn(async (input: ExecuteProviderCandidatesInput) => {
        input.options.onSpawn?.();
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          success: true,
          output: 'reviewed',
          exitCode: 0,
          preferredProvider: 'claude',
          actualProvider: 'claude',
          attempts: [],
        };
      });
      const runner = new DefaultStepRunner(createMockProvider(), 'session', projectDir, {
        config: { step_heartbeat_stall_minutes: 1 },
        heartbeatWatchdog: { pollIntervalMs: 5, now: () => Date.now() + 60 * 60_000 },
        providerExecution: {
          configuredProviders: ['claude'],
          runtimes: new ProviderRuntimeSet([interactiveRuntime('claude', vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: '', exitCode: 0 })))]),
          sessions: new ProviderSessionStore(),
          executor: providerExecutor as unknown as typeof executeProviderCandidates,
        },
      });

      const result = await runner.run('build', emptyState);

      expect(result.success).toBe(true);
      expect(providerExecutor).toHaveBeenCalledTimes(1);
      await expect(readFile(join(projectDir, '.pipeline', 'HALT'), 'utf-8')).rejects.toThrow();
    });

    it('treats a disabled heartbeat threshold as telemetry configuration without halting', async () => {
      const providerExecutor = vi.fn(async () => ({
        success: true,
        output: 'done',
        exitCode: 0,
        preferredProvider: 'claude',
        actualProvider: 'claude',
        attempts: [],
      }));
      const config: HarnessConfig = { step_heartbeat_stall_minutes: 0 };
      const runner = new DefaultStepRunner(createMockProvider(), 'session', projectDir, {
        config,
        providerExecution: {
          configuredProviders: ['claude'],
          runtimes: new ProviderRuntimeSet([interactiveRuntime('claude', vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: '', exitCode: 0 })))]),
          sessions: new ProviderSessionStore(),
          executor: providerExecutor,
        },
      });

      const result = await runner.run('build', emptyState);

      expect(result.success).toBe(true);
      await expect(readFile(join(projectDir, '.pipeline', 'HALT'), 'utf-8')).rejects.toThrow();
    });
  });

  it('routes representative DECIDE, BUILD, and SHIP dispatches through lifecycle supervision', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'step-runner-lifecycle-'));
    const permits: Array<ReturnType<NonNullable<InvokeOptions['spawnPermit']>> | undefined> = [];
    const invoke = vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => {
      permits.push(options.spawnPermit?.());
      if (options.nativeSchema !== undefined) return prdAuditPassResult();
      return {
        success: true,
        output: 'MODELS: 1\nINTEGRATIONS: 0\nAUTH: 0\nSTATE_MACHINES: 0\nSTORIES: 1\nTIER: S',
        exitCode: 0,
      };
    });
    const provider: LLMProvider = {
      lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
      invoke,
    };
    const sessions = new ProviderSessionStore();
    const runner = new DefaultStepRunner(provider, 'session', projectDir, {
      gitRunner: async (args) => args[0] === 'rev-parse' && args[1] === 'HEAD'
        ? { exitCode: 0, stdout: 'head\n', stderr: '' }
        : { exitCode: 1, stdout: '', stderr: 'unexpected git command' },
      providerExecution: {
        configuredProviders: ['claude'],
        runtimes: new ProviderRuntimeSet([{
          key: 'claude',
          provider,
          lifecycleCapability: provider.lifecycleCapability,
          nativeSchemaCapability: { nativeOutputSchema: true },
          policy: CLAUDE_POLICY,
          builtIn: true,
          availability: new ModelAvailability(CLAUDE_POLICY.modelFallbackLadder),
        }]),
        sessions,
      },
    });

    try {
      buildPrdAuditProjection.mockResolvedValue(prdAuditProjectionFixture());
      await runner.assessComplexity();
      await sessions.beginStep('build');
      await runner.run('build', emptyState);
      await sessions.beginStep('prd_audit');
      const ship = await runner.run('prd_audit', emptyState);

      expect(ship).toMatchObject({ success: true });
      expect(permits).toEqual([
        { permitted: true },
        { permitted: true },
        { permitted: true },
      ]);
    } finally {
      buildPrdAuditProjection.mockReset();
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('reads self-host candidate hooks from the live context after construction', async () => {
    const executor = vi.fn(async (input: any) => {
      const candidate = { step: 'build', providerKey: 'codex', model: 'gpt', effort: 'medium' };
      await input.prepareCandidateSelfHost(candidate, {});
      await input.withCandidateSafety(candidate, async () => ({ success: true, output: 'done', exitCode: 0 }));
      return { success: true, output: 'done', exitCode: 0, preferredProvider: 'codex', actualProvider: 'codex', attempts: [] };
    });
    const context: any = {
      configuredProviders: ['codex'],
      runtimes: new ProviderRuntimeSet([interactiveRuntime('codex', vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: '', exitCode: 0 })))]),
      sessions: new ProviderSessionStore(), executor,
    };
    const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', { providerExecution: context });
    const prepared = vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: '', exitCode: 0 }));
    const safety = vi.fn(async (_candidate, invoke) => invoke());
    context.prepareCandidateSelfHost = prepared;
    context.withCandidateSafety = safety;

    await runner.run('build', emptyState);

    expect(prepared).toHaveBeenCalledOnce();
    expect(safety).toHaveBeenCalledOnce();
  });

  it('forwards the live candidate-start callback through provider-aware dispatch', async () => {
    const onCandidateStart = vi.fn();
    const executor = vi.fn(async (input: any) => {
      input.onCandidateStart('build', {
        provider: { kind: 'known', id: 'codex' },
        executionContext: { executionId: 'configured-run', subject: { kind: 'configured-member', parentGroup: 'review', member: 'security' } },
      });
      return { success: true, output: 'done', exitCode: 0, preferredProvider: 'codex', actualProvider: 'codex', attempts: [] };
    });
    const context: any = {
      configuredProviders: ['codex'],
      runtimes: new ProviderRuntimeSet([interactiveRuntime('codex', vi.fn())]),
      sessions: new ProviderSessionStore(), executor, onCandidateStart,
    };
    const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', { providerExecution: context });

    await runner.run('build', emptyState, {
      executionContext: { executionId: 'configured-run', subject: { kind: 'configured-member', parentGroup: 'review', member: 'security' } },
    });

    expect(onCandidateStart).toHaveBeenCalledWith('build', expect.objectContaining({
      executionContext: { executionId: 'configured-run', subject: { kind: 'configured-member', parentGroup: 'review', member: 'security' } },
    }));
  });

  it('does not await a candidate-start listener before entering the provider runtime', async () => {
    const events = new ConductorEventEmitter();
    events.on('provider_attempt_started', async () => {
      await new Promise<void>(() => {});
    });
    const invoke = vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: 'done', exitCode: 0 }));
    const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', {
      providerExecution: {
        configuredProviders: ['codex'],
        runtimes: new ProviderRuntimeSet([interactiveRuntime('codex', invoke)]),
        sessions: new ProviderSessionStore(),
        ...providerExecutionEventCallbacks(events),
      },
    });

    await expect(runner.run('build', emptyState)).resolves.toMatchObject({ success: true });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('retains terminal setup exhaustion when the real build runner maps an executor result', async () => {
    const executor = vi.fn(async () => ({
      success: false,
      output: 'all setup unavailable',
      preferredProvider: 'codex',
      attempts: [],
      providerSetupExhaustion: {
        candidates: [{ provider: 'codex', reason: 'missing isolation', recoveryAction: 'update Codex' }],
      },
    }));
    const context: any = {
      configuredProviders: ['codex'],
      runtimes: new ProviderRuntimeSet([interactiveRuntime('codex', vi.fn())]),
      sessions: new ProviderSessionStore(),
      executor,
    };
    const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', { providerExecution: context });

    await expect(runner.run('build', emptyState)).resolves.toMatchObject({
      success: false,
      providerSetupExhaustion: { candidates: [{ provider: 'codex', reason: 'missing isolation' }] },
    });
  });

  it('forwards the live self-host preparation hook through build_review one-shot dispatch', async () => {
    const executor = vi.fn(async (input: any) => {
      const candidate = { step: 'build_review', providerKey: 'claude', model: 'sonnet', effort: 'medium' };
      const selfHost = await input.prepareCandidateSelfHost(candidate, {});
      await selfHost.teardown();
      return { success: true, output: 'reviewed', exitCode: 0, preferredProvider: 'claude', actualProvider: 'claude', attempts: [] };
    });
    const teardown = vi.fn(async () => {});
    const prepared = vi.fn(async () => ({ executable: 'claude', env: {}, args: [], teardown }));
    const context: any = {
      configuredProviders: ['claude'],
      runtimes: new ProviderRuntimeSet([interactiveRuntime('claude', vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: '', exitCode: 0 })))]),
      sessions: new ProviderSessionStore(), executor, prepareCandidateSelfHost: prepared,
      withCandidateSafety: async (_candidate: unknown, invoke: () => Promise<InvokeResult>) => invoke(),
    };
    const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', { providerExecution: context });
    const execute = (runner as any).executeProviderAwareOneShot.bind(runner);

    await execute('build_review', { prompt: 'review', cwd: '/tmp/project', dangerouslySkipPermissions: true });

    expect(prepared).toHaveBeenCalledOnce();
    expect(teardown).toHaveBeenCalledOnce();
  });

  it('routes complexity and recovery dispatches through provider-native fresh one-shot scopes', async () => {
    const capturedInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'captured provider must not run',
      exitCode: 0,
    }));
    const capturedInteractive = vi.fn().mockResolvedValue(undefined);
    const claudeInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'wrong Claude path',
      exitCode: 0,
    }));
    const claudeInteractive = vi.fn().mockResolvedValue(undefined);
    const codexInvoke = vi.fn(
      async (options: InvokeOptions): Promise<InvokeResult> => ({
        success: true,
        output: options.prompt.endsWith('conduct complexity')
          ? [
              'MODELS: 6',
              'INTEGRATIONS: 1',
              'AUTH: 0',
              'STATE_MACHINES: 1',
              'STORIES: 8',
              'TIER: M',
            ].join('\n')
          : options.prompt.endsWith('rebase')
            ? '{"resolved": true}'
            : 'done',
        exitCode: 0,
      }),
    );
    const provider = (
      invoke: LLMProvider['invoke'],
      _invokeInteractive: LLMProvider['invoke'] =
        vi.fn().mockResolvedValue(undefined),
    ): LLMProvider => ({
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke,
    });
    const runtimes = new ProviderRuntimeSet([
      {
        key: 'claude',
        provider: provider(claudeInvoke, claudeInteractive),
        policy: CLAUDE_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CLAUDE_POLICY.modelFallbackLadder),
      },
      {
        key: 'codex',
        provider: provider(codexInvoke),
        policy: CODEX_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
      },
    ]);
    const ids = [
      'complexity-codex-session',
      'remediate-codex-session',
      'rebase-codex-session',
      'setup-codex-session',
      'ci-codex-session',
      'attribution-codex-session',
      'build-review-codex-session',
    ][Symbol.iterator]();
    const sessions = new ProviderSessionStore({
      createSessionId: () => ids.next().value ?? 'unexpected-session',
    });
    const beginBranch = vi.spyOn(sessions, 'beginBranch');
    const providerExecutor = vi.fn(executeProviderCandidates);
    const runner = new DefaultStepRunner(
      provider(capturedInvoke, capturedInteractive),
      'captured-session',
      '/tmp/project',
      {
        config: {
          llm_provider: ['claude', 'codex'],
          steps: {
            complexity: { llm_provider: 'codex' },
            remediate: { llm_provider: 'codex' },
            rebase: { llm_provider: 'codex' },
            worktree: { llm_provider: 'codex' },
            build: { llm_provider: 'codex' },
            attribution_verify: { llm_provider: 'codex' },
            build_review: { llm_provider: 'codex' },
          },
        },
        sessionStore: sessions,
        providerRuntimes: runtimes,
        configuredProviders: ['claude', 'codex'],
        providerExecutor,
      },
    );

    const complexity = await runner.assessComplexity();
    const remediate = await runner.run('remediate', emptyState, {
      attempt: 3,
      escalate: false,
      modelOverride: 'gpt-5.6-terra',
      effortOverride: 'max',
    });
    const rebase = await runner.resolveRebaseConflict({
      conflicts: ['src/example.ts'],
      projectRoot: '/wt/rebase',
      baseRef: 'origin/main',
    });
    const setup = await runner.resolveSetupFailure({
      worktreePath: '/wt/setup',
      outputTail: 'install failed',
      slug: 'setup-feature',
    });
    const ci = await runner.resolveCiFailure({
      worktreePath: '/wt/ci',
      prUrl: 'https://github.com/org/repo/pull/42',
      hint: 'typecheck failed',
      slug: 'ci-feature',
    });
    const executeOneShot = (runner as unknown as {
      executeProviderAwareOneShot: (
        step: StepName,
        options: ExecuteProviderCandidatesInput['options'],
      ) => Promise<InvokeResult>;
    }).executeProviderAwareOneShot.bind(runner);
    await executeOneShot('attribution_verify', {
      prompt: 'Judge attribution exactly as supplied.\nTask: runtime-07',
      cwd: '/wt/attribution',
    });
    await executeOneShot('build_review', {
      prompt: 'Grade this assembled plan and diff exactly as supplied.',
      cwd: '/wt/build-review',
    });

    const executionInputs = providerExecutor.mock.calls.map(([input]) => input);
    const transportedOptions = codexInvoke.mock.calls.map(([options]) => options);
    const freeFormDispatches = [3, 4, 5, 6].map((index) => ({
      step: executionInputs[index]?.step,
      byteIdentical:
        executionInputs[index]?.options.prompt === transportedOptions[index]?.prompt,
      hasCandidateFactory: executionInputs[index]?.optionsForCandidate !== undefined,
    }));
    const claudeSkillInvoke = vi.fn(
      async (options: InvokeOptions): Promise<InvokeResult> => ({
        success: true,
        output: options.prompt.endsWith('conduct complexity')
          ? 'MODELS: 0\nINTEGRATIONS: 0\nAUTH: 0\nSTATE_MACHINES: 0\nSTORIES: 1\nTIER: S'
          : options.prompt.endsWith('rebase')
            ? '{"resolved": true}'
            : 'done',
        exitCode: 0,
      }),
    );
    const claudeSkillRunner = new DefaultStepRunner(
      provider(claudeSkillInvoke),
      'claude-session',
      '/tmp/project',
      {
        config: {
          llm_provider: 'claude',
          steps: {
            complexity: { llm_provider: 'claude' },
            remediate: { llm_provider: 'claude' },
            rebase: { llm_provider: 'claude' },
          },
        },
        providerRuntimes: new ProviderRuntimeSet([{
          key: 'claude',
          provider: provider(claudeSkillInvoke),
          policy: CLAUDE_POLICY,
          builtIn: true,
          availability: new ModelAvailability(CLAUDE_POLICY.modelFallbackLadder),
        }]),
        sessionStore: new ProviderSessionStore(),
        configuredProviders: ['claude'],
      },
    );
    await claudeSkillRunner.assessComplexity();
    await claudeSkillRunner.run('remediate', emptyState);
    await claudeSkillRunner.resolveRebaseConflict({
      conflicts: ['src/example.ts'],
      projectRoot: '/wt/rebase',
      baseRef: 'origin/main',
    });
    const claudeSkillPrompts = claudeSkillInvoke.mock.calls.map(
      ([options]) => options.prompt,
    );
    const codexSessionIds = codexInvoke.mock.calls.map(
      ([options]) => options.sessionId,
    );
    expectUniqueFreshSessionIds(codexSessionIds);

    expect({
      capturedCalls: {
        invoke: capturedInvoke.mock.calls,
        interactive: capturedInteractive.mock.calls,
      },
      claudeRuntimeCalls: {
        invoke: claudeInvoke.mock.calls,
        interactive: claudeInteractive.mock.calls,
      },
      beginBranchCalls: beginBranch.mock.calls,
      remediateRetryInput: providerExecutor.mock.calls
        .map(([input]) => input)
        .find(({ step }) => step === 'remediate'),
      codexCalls: codexInvoke.mock.calls.map(([options]) => ({
        prompt: options.prompt,
        sessionId: options.sessionId,
        resume: options.resume,
        cwd: options.cwd,
        model: options.model,
        effort: options.effort,
      })),
      complexity,
      remediate,
      rebase,
      setup,
      ci,
      freeFormDispatches,
      claudeSkillPrompts,
    }).toEqual({
      capturedCalls: { invoke: [], interactive: [] },
      claudeRuntimeCalls: { invoke: [], interactive: [] },
      claudeSkillPrompts: ['/conduct complexity', '/remediate', '/rebase'],
      beginBranchCalls: [
        ['complexity'],
        ['remediate'],
        ['rebase'],
        ['worktree'],
        ['build'],
        ['attribution_verify'],
        ['build_review'],
      ],
      remediateRetryInput: expect.objectContaining({
        attempt: 3,
        escalate: false,
        modelOverride: 'gpt-5.6-terra',
        effortOverride: 'max',
      }),
      codexCalls: [
        {
          prompt: '$conduct complexity',
          sessionId: codexSessionIds[0],
          resume: false,
          cwd: '/tmp/project',
          model: 'gpt-5.6-terra',
          effort: 'low',
        },
        {
          prompt: '$remediate',
          sessionId: codexSessionIds[1],
          resume: false,
          cwd: '/tmp/project',
          model: 'gpt-5.6-terra',
          effort: 'max',
        },
        {
          prompt: '$rebase',
          sessionId: codexSessionIds[2],
          resume: false,
          cwd: '/wt/rebase',
          model: 'gpt-5.6-terra',
          effort: 'high',
        },
        {
          prompt: expect.stringContaining('install failed'),
          sessionId: codexSessionIds[3],
          resume: false,
          cwd: '/wt/setup',
          model: 'gpt-5.6-luna',
          effort: 'low',
        },
        {
          prompt: expect.stringContaining('typecheck failed'),
          sessionId: codexSessionIds[4],
          resume: false,
          cwd: '/wt/ci',
          model: 'gpt-5.6-terra',
          effort: 'medium',
        },
        {
          prompt: 'Judge attribution exactly as supplied.\nTask: runtime-07',
          sessionId: codexSessionIds[5],
          resume: false,
          cwd: '/wt/attribution',
          model: 'gpt-5.6-sol',
          effort: 'high',
        },
        {
          prompt: 'Grade this assembled plan and diff exactly as supplied.',
          sessionId: codexSessionIds[6],
          resume: false,
          cwd: '/wt/build-review',
          model: 'gpt-5.6-sol',
          effort: 'high',
        },
      ],
      freeFormDispatches: [
        {
          step: 'worktree',
          byteIdentical: true,
          hasCandidateFactory: false,
        },
        {
          step: 'build',
          byteIdentical: true,
          hasCandidateFactory: false,
        },
        {
          step: 'attribution_verify',
          byteIdentical: true,
          hasCandidateFactory: false,
        },
        {
          step: 'build_review',
          byteIdentical: true,
          hasCandidateFactory: false,
        },
      ],
      complexity: expect.objectContaining({
        tier: 'M',
        preferredProvider: 'codex',
        actualProvider: 'codex',
      }),
      remediate: expect.objectContaining({
        success: true,
        preferredProvider: 'codex',
        actualProvider: 'codex',
      }),
      rebase: expect.objectContaining({
        resolved: true,
        preferredProvider: 'codex',
        actualProvider: 'codex',
      }),
      setup: expect.objectContaining({
        attempted: true,
        preferredProvider: 'codex',
        actualProvider: 'codex',
      }),
      ci: expect.objectContaining({
        kind: 'session-completed',
        preferredProvider: 'codex',
        actualProvider: 'codex',
      }),
    });
  });

  it.each([
    {
      provider: 'claude' as const,
      tokenUsage: { input: 17, output: 5, cacheRead: 11, cacheCreation: 3 },
    },
    {
      provider: 'codex' as const,
      tokenUsage: { input: 13, output: 7, cacheRead: 9, cacheCreation: 2 },
    },
  ])('records $provider streaming-envelope usage in its provider_attempt event', async ({
    provider,
    tokenUsage,
  }) => {
    const emitted: ProviderAttemptEvent[] = [];
    const invoke = vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => {
      // Faithful provider fake: REPL output is plaintext and has no machine
      // envelope, while the non-REPL stream carries the parsed token totals.
      if (options.interactive !== false) {
        return { success: true, output: 'repl output', exitCode: 0 };
      }
      return { success: true, output: 'machine envelope output', exitCode: 0, tokenUsage };
    });
    const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', {
      mode: 'auto',
      config: {
        llm_provider: [provider],
        steps: { explore: { llm_provider: provider } },
      },
      providerRuntimes: new ProviderRuntimeSet([interactiveRuntime(provider, invoke)]),
      configuredProviders: [provider],
      sessionStore: new ProviderSessionStore(),
      providerAttempt: (step, attempt) => {
        emitted.push({ type: 'provider_attempt', step, ...attempt });
      },
    });

    const result = await runner.run('explore', emptyState);
    const event = emitted.find((candidate) => candidate.provider === provider);

    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ interactive: false }));
    expect(result.tokenUsage).toEqual(tokenUsage);
    expect(event).toMatchObject({
      type: 'provider_attempt',
      step: 'explore',
      provider,
      outcome: 'success',
      invoked: true,
      tokenUsage,
    });
  });

  it.each([
    {
      provider: 'claude' as const,
      observation: {
        childObservability: 'observed' as const,
        activeChildren: 2,
        uncachedInputTokens: 76,
        outputTokens: 12,
      },
    },
    {
      provider: 'codex' as const,
      observation: {
        childObservability: 'unsupported' as const,
        uncachedInputTokens: 43,
        outputTokens: 9,
      },
    },
  ])('reports $provider live streaming burn before the provider invocation finishes', async ({
    provider,
    observation,
  }) => {
    const root = await mkdtemp(join(tmpdir(), 'streaming-live-status-'));
    const worktreeBase = join(root, '.worktrees');
    const projectDir = join(worktreeBase, 'streaming-feature');
    const pipelineDir = join(projectDir, '.pipeline');
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(pipelineDir, 'events.jsonl'), events);
    persister.start();
    let invocationFinished = false;
    let liveStatusWasReadWhileInvocationOpen = false;
    let resolveLiveStatus!: () => void;
    const liveStatusRead = new Promise<void>((resolve) => {
      resolveLiveStatus = resolve;
    });
    let liveStatus: Awaited<ReturnType<typeof scanInheritedState>> | undefined;
    events.once('provider_stream_progress', async () => {
      liveStatus = await scanInheritedState({
        worktreeBase,
        processedDir: join(root, '.daemon/processed'),
        discover: async () => [],
      });
      liveStatusWasReadWhileInvocationOpen = !invocationFinished;
      resolveLiveStatus();
    });
    const invoke = vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => {
      if (!options.onProviderStream) {
        return { success: false, output: 'stream observer missing', exitCode: 1 };
      }
      options.onProviderStream(observation);
      await liveStatusRead;
      invocationFinished = true;
      return { success: true, output: 'stream complete', exitCode: 0 };
    });
    const runner = new DefaultStepRunner(createMockProvider(), 'session', projectDir, {
      mode: 'auto',
      config: {
        llm_provider: [provider],
        steps: { explore: { llm_provider: provider } },
      },
      events,
      providerRuntimes: new ProviderRuntimeSet([interactiveRuntime(provider, invoke)]),
      configuredProviders: [provider],
      sessionStore: new ProviderSessionStore(),
    });

    try {
      await mkdir(pipelineDir, { recursive: true });
      await writeFile(join(pipelineDir, 'conduct-state.json'), JSON.stringify({ explore: 'in_progress' }));
      await events.emit({ type: 'step_started', step: 'explore', index: 1 });

      const result = await runner.run('explore', emptyState);
      const progress = liveStatus?.inProgress.find((entry) => entry.slug === 'streaming-feature')
        ?.providerStreamProgress;

      expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
        interactive: false,
        onProviderStream: expect.any(Function),
      }));
      expect(liveStatusWasReadWhileInvocationOpen).toBe(true);
      expect(invocationFinished).toBe(true);
      expect(progress).toMatchObject(observation);
      expect(progress?.uncachedInputTokens).toBeGreaterThan(0);
      expect(progress?.outputTokens).toBeGreaterThan(0);
      if (observation.childObservability === 'unsupported') {
        expect(progress).toMatchObject({ childObservability: 'unsupported' });
        expect(progress).not.toHaveProperty('activeChildren');
      } else {
        expect(progress).toMatchObject({ childObservability: 'observed', activeChildren: 2 });
      }
      expect(result).toMatchObject({ success: true, output: 'stream complete' });
    } finally {
      persister.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps a quiet streaming step working from its activity heartbeat, not stream observations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'quiet-stream-status-'));
    const worktreeBase = join(root, '.worktrees');
    const projectDir = join(worktreeBase, 'quiet-stream-feature');
    const pipelineDir = join(projectDir, '.pipeline');
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(pipelineDir, 'events.jsonl'), events);
    persister.start();
    const progressEvents = vi.fn();
    events.on('provider_stream_progress', progressEvents);
    let pulseWasSupplied = false;
    let enteredInvocation!: () => void;
    const invocationEntered = new Promise<void>((resolve) => {
      enteredInvocation = resolve;
    });
    let releaseProvider!: () => void;
    const providerMayFinish = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const invoke = vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => {
      pulseWasSupplied = typeof options.onActivity === 'function';
      options.onActivity?.();
      enteredInvocation();
      await providerMayFinish;
      return { success: true, output: 'quiet stream complete', exitCode: 0 };
    });
    const runner = new DefaultStepRunner(createMockProvider(), 'session', projectDir, {
      mode: 'auto',
      config: {
        llm_provider: ['claude'],
        step_heartbeat_stall_minutes: 1,
        steps: { explore: { llm_provider: 'claude' } },
      },
      events,
      providerRuntimes: new ProviderRuntimeSet([interactiveRuntime('claude', invoke)]),
      configuredProviders: ['claude'],
      sessionStore: new ProviderSessionStore(),
      heartbeatWatchdog: {
        pollIntervalMs: 1,
        now: () => Date.now() + 60 * 60_000,
      },
    });

    try {
      await mkdir(pipelineDir, { recursive: true });
      await writeFile(join(pipelineDir, 'conduct-state.json'), JSON.stringify({ explore: 'in_progress' }));
      await events.emit({ type: 'step_started', step: 'explore', index: 1 });

      const run = runner.run('explore', emptyState);
      await invocationEntered;
      // The provider is silent after its initial activity boundary. This is
      // the existing heartbeat's persisted shape, not a stream observation.
      await writeFile(
        join(pipelineDir, 'step-heartbeat'),
        JSON.stringify({ step: 'explore', ts: new Date().toISOString() }),
      );
      const liveStatus = await scanInheritedState({
        worktreeBase,
        processedDir: join(root, '.daemon/processed'),
        discover: async () => [],
      });
      const entry = liveStatus.inProgress.find((candidate) => candidate.slug === 'quiet-stream-feature');

      expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
        interactive: false,
        onActivity: expect.any(Function),
      }));
      expect(pulseWasSupplied).toBe(true);
      expect(progressEvents).not.toHaveBeenCalled();
      expect(entry).toMatchObject({ step: 'explore', activityState: 'working' });
      expect(entry?.heartbeatAgeMs).toEqual(expect.any(Number));
      expect(entry?.providerStreamProgress).toBeUndefined();

      releaseProvider();
      await expect(run).resolves.toMatchObject({ success: true, output: 'quiet stream complete' });
    } finally {
      releaseProvider();
      persister.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('dispatches a streaming step through its adapter invoke entry with fresh provider sessions', async () => {
    const codexInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'codex built',
      exitCode: 0,
      tokenUsage: { input: 11, output: 4 },
    }));
    const claudeInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'claude explored',
      exitCode: 0,
      tokenUsage: { input: 7, output: 3 },
    }));
    const claudeInteractive = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'legacy interactive path must not run',
      exitCode: 0,
    }));
    const legacyInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'legacy provider must not run',
      exitCode: 0,
    }));
    const legacyInteractive = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'legacy provider must not run',
      exitCode: 0,
    }));
    const provider = (
      invoke: LLMProvider['invoke'],
      _invokeInteractive: LLMProvider['invoke'],
    ): LLMProvider => ({
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke,
    });
    const runtimes = new ProviderRuntimeSet([
      {
        key: 'claude',
        provider: provider(
          claudeInvoke,
          claudeInteractive,
        ),
        policy: CLAUDE_POLICY,
        builtIn: true,
        availability: new ModelAvailability(
          CLAUDE_POLICY.modelFallbackLadder,
        ),
      },
      {
        key: 'codex',
        provider: provider(
          codexInvoke,
          vi.fn(async (): Promise<InvokeResult> => ({
            success: true,
            output: 'wrong Codex path',
            exitCode: 0,
          })),
        ),
        policy: CODEX_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability(
          CODEX_MODEL_POLICY.modelFallbackLadder,
        ),
      },
    ]);
    const sessionIds = [
      'build-codex-session',
      'explore-claude-session',
    ][Symbol.iterator]();
    const sessions = new ProviderSessionStore({
      createSessionId: () => sessionIds.next().value ?? 'unexpected-session',
    });
    const beginStep = vi.spyOn(sessions, 'beginStep');
    const runner = new DefaultStepRunner(
      provider(legacyInvoke, legacyInteractive),
      'legacy-session',
      '/tmp/project',
      {
        config: {
          llm_provider: ['claude', 'codex'],
          steps: {
            build: { llm_provider: 'codex' },
            explore: { llm_provider: 'claude' },
          },
        },
        sessionStore: sessions,
        providerRuntimes: runtimes,
        configuredProviders: ['claude', 'codex'],
      } satisfies StepRunnerOptions,
    );

    await runner.resetSession('build');
    const build = await runner.run('build', emptyState);
    const buildSession = sessions.current('codex');
    await runner.resetSession('explore');
    const explore = await runner.run('explore', emptyState);

    // Each dispatch mints its own fresh session id; the store's ids are never
    // consulted and the step scope records nothing. The zero-arg mock typing
    // hides the real (options) call shape, so recover it explicitly.
    const buildSessionId = (
      codexInvoke.mock.calls as unknown as Array<[InvokeOptions]>
    )[0]?.[0]?.sessionId;
    const exploreSessionId = (
      claudeInvoke.mock.calls as unknown as Array<[InvokeOptions]>
    )[0]?.[0]?.sessionId;
    expectUniqueFreshSessionIds([buildSessionId, exploreSessionId]);

    expect({
      legacyCalls: {
        invoke: legacyInvoke.mock.calls,
        interactive: legacyInteractive.mock.calls,
      },
      codexCalls: codexInvoke.mock.calls,
      claudeCalls: claudeInvoke.mock.calls,
      claudeInteractiveCalls: claudeInteractive.mock.calls,
      beginStepCalls: beginStep.mock.calls,
      buildSession,
      exploreSession: sessions.current('claude'),
      build,
      explore,
    }).toEqual({
      legacyCalls: { invoke: [], interactive: [] },
      beginStepCalls: [['build'], ['explore']],
      codexCalls: [
        [
          expect.objectContaining({
            cwd: '/tmp/project',
            dangerouslySkipPermissions: true,
            sessionId: buildSessionId,
            resume: false,
            model: 'gpt-5.6-terra',
            effort: 'medium',
          }),
        ],
      ],
      claudeCalls: [
        [
          expect.objectContaining({
            cwd: '/tmp/project',
            dangerouslySkipPermissions: false,
            sessionId: exploreSessionId,
            resume: false,
            interactive: true,
            model: 'opus',
            effort: 'high',
          }),
        ],
      ],
      claudeInteractiveCalls: [],
      buildSession: undefined,
      exploreSession: undefined,
      build: {
        success: true,
        output: 'codex built',
        managedGhObservationCoverage: {
          boundary: 'managed-path-resolved-gh',
          completeness: 'unknown',
        },
        tokenUsage: { input: 11, output: 4 },
        model: 'gpt-5.6-terra',
        effort: 'medium',
        preferredProvider: 'codex',
        provider: 'codex',
        actualProvider: 'codex',
        attempts: [
          {
            provider: 'codex',
            preferredProvider: 'codex',
            model: 'gpt-5.6-terra',
            effort: 'medium',
            tokenUsage: { input: 11, output: 4 },
            outcome: 'success',
            invoked: true,
          },
        ],
      },
      explore: {
        success: true,
        output: 'claude explored',
        managedGhObservationCoverage: {
          boundary: 'managed-path-resolved-gh',
          completeness: 'unknown',
        },
        tokenUsage: { input: 7, output: 3 },
        model: 'opus',
        effort: 'high',
        preferredProvider: 'claude',
        provider: 'claude',
        actualProvider: 'claude',
        attempts: [
          {
            provider: 'claude',
            preferredProvider: 'claude',
            model: 'opus',
            effort: 'high',
            tokenUsage: { input: 7, output: 3 },
            outcome: 'success',
            invoked: true,
          },
        ],
      },
    });
  });

  it('persists interactive run-wide unavailability across step scopes without marking the cached skip invoked', async () => {
    const unavailableCodex = vi.fn(async (): Promise<InvokeResult> => ({
      success: false,
      output: 'codex executable missing',
      exitCode: 127,
      providerUnavailable: true,
      providerUnavailableScope: 'run',
      providerUnavailableReason: 'codex executable missing',
    }));
    const claudeFallback = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'claude fallback',
      exitCode: 0,
    }));
    const cachedSessions = new ProviderSessionStore({
      createSessionId: (() => {
        let id = 0;
        return () => `cached-${++id}`;
      })(),
    });
    const cachedRunner = new DefaultStepRunner(
      createMockProvider(),
      'legacy-cache-session',
      '/tmp/project',
      {
        mode: 'interactive',
        config: {
          llm_provider: ['codex', 'claude'],
          steps: {
            explore: { llm_provider: 'codex' },
            stories: { llm_provider: 'codex' },
          },
        },
        sessionStore: cachedSessions,
        providerRuntimes: new ProviderRuntimeSet([
          interactiveRuntime('codex', unavailableCodex),
          interactiveRuntime('claude', claudeFallback),
        ]),
        configuredProviders: ['codex', 'claude'],
        providerWarn: vi.fn(),
      },
    );

    await cachedRunner.resetSession('explore');
    await cachedRunner.run('explore', emptyState);
    await cachedRunner.resetSession('stories');
    const cachedResult = await cachedRunner.run('stories', emptyState);

    expect({
      unavailableCodexCalls: unavailableCodex.mock.calls.length,
      cachedActualProvider: cachedResult.actualProvider,
      cachedAttempt: cachedResult.attempts?.[0],
      cachedSession: cachedSessions.current('codex'),
    }).toEqual({
      unavailableCodexCalls: 1,
      cachedActualProvider: 'claude',
      cachedAttempt: {
        provider: 'codex',
        outcome: 'unavailable',
        reason: 'codex executable missing',
        fallbackReason: 'codex executable missing',
        invoked: false,
        skipReason: 'cached-unavailable',
        setupCapability: 'cached-provider-availability',
        setupRecoveryAction: 'Restore the provider availability, then re-queue this feature.',
      },
      // The store is never consulted: no session is recorded for the scope.
      cachedSession: undefined,
    });
  });

  it('cold-starts after a rejected interactive attempt without created bookkeeping', async () => {
    const throwingInteractive = vi
      .fn<LLMProvider['invoke']>()
      .mockRejectedValueOnce(new Error('interactive process rejected'))
      .mockResolvedValueOnce({
        success: true,
        output: 'retry completed',
        exitCode: 0,
      });
    const retrySessions = new ProviderSessionStore({
      createSessionId: () => 'retry-claude-session',
    });
    const retryRunner = new DefaultStepRunner(
      createMockProvider(),
      'legacy-retry-session',
      '/tmp/project',
      {
        mode: 'interactive',
        config: {
          llm_provider: 'claude',
          steps: { explore: { llm_provider: 'claude' } },
        },
        sessionStore: retrySessions,
        providerRuntimes: new ProviderRuntimeSet([
          interactiveRuntime('claude', throwingInteractive),
        ]),
        configuredProviders: ['claude'],
      },
    );

    await retryRunner.resetSession('explore');
    const failed = await retryRunner.run('explore', emptyState);
    const afterFailure = retrySessions.current('claude');
    const retried = await retryRunner.run('explore', emptyState);

    expect({
      failed,
      afterFailure,
      retriedActualProvider: retried.actualProvider,
    }).toEqual({
      failed: {
        success: false,
        output: 'Session for explore exited with error: interactive process rejected',
      },
      // The store is never consulted: no session is recorded for the scope.
      afterFailure: undefined,
      retriedActualProvider: 'claude',
    });
    // The retry cold-starts with its OWN fresh session id — never the store's
    // 'retry-claude-session' and never the first attempt's id.
    const retryInvocations = throwingInteractive.mock.calls.map(([options]) => ({
      sessionId: options.sessionId,
      resume: options.resume,
    }));
    expect(retryInvocations.map(({ resume }) => resume)).toEqual([false, false]);
    expectUniqueFreshSessionIds(retryInvocations.map(({ sessionId }) => sessionId));
  });

  it('routes interactive recovery through the selected provider candidates', async () => {
    const failureReason = 'explore artifact review rejected the generated stories';
    const capturedInteractive = vi.fn().mockResolvedValue(undefined);
    const unavailableCodex = vi.fn(async (_options: InvokeOptions): Promise<InvokeResult> => ({
      success: false,
      output: 'codex executable missing',
      exitCode: 127,
      providerUnavailable: true,
      providerUnavailableScope: 'run',
      providerUnavailableReason: 'codex executable missing',
    }));
    const claudeFallback = vi.fn(async (_options: InvokeOptions): Promise<InvokeResult> => ({
      success: true,
      output: 'claude recovered',
      exitCode: 0,
    }));
    const sessions = new ProviderSessionStore({
      createSessionId: (() => {
        let id = 0;
        return () => `recovery-${++id}`;
      })(),
    });
    const attempts = vi.fn();
    const runner = new DefaultStepRunner(
      {
        invoke: vi.fn(),
      },
      'captured-session',
      '/tmp/project',
      {
        mode: 'interactive',
        config: {
          llm_provider: ['claude', 'codex'],
          steps: { explore: { llm_provider: 'codex' } },
        },
        sessionStore: sessions,
        providerRuntimes: new ProviderRuntimeSet([
          interactiveRuntime('claude', claudeFallback),
          interactiveRuntime('codex', unavailableCodex),
        ]),
        configuredProviders: ['claude', 'codex'],
        providerAttempt: attempts,
        providerWarn: vi.fn(),
      },
    );

    await runner.resetSession('explore');
    await (
      runner.runInteractive as unknown as (
        step: StepName,
        context: { step: StepName; reason: string },
      ) => Promise<void>
    )('explore', { step: 'explore', reason: failureReason });

    // Each recovery candidate mints its own fresh session id; the store's
    // 'recovery-N' ids never reach a provider.
    const recoverySessionIds = [
      ...unavailableCodex.mock.calls,
      ...claudeFallback.mock.calls,
    ].map(([options]) => options.sessionId);
    expectUniqueFreshSessionIds(recoverySessionIds);
    expect({
      capturedCalls: capturedInteractive.mock.calls,
      codexCalls: unavailableCodex.mock.calls.map(([options]) => ({
        prompt: options.prompt,
        sessionId: options.sessionId,
        resume: options.resume,
        interactive: options.interactive,
      })),
      claudeCalls: claudeFallback.mock.calls.map(([options]) => ({
        prompt: options.prompt,
        sessionId: options.sessionId,
        resume: options.resume,
        interactive: options.interactive,
      })),
      attempts: attempts.mock.calls
        .filter(([, attempt]) => !('lifecycle' in attempt))
        .map(([step, attempt]) => ({ step, ...attempt })),
    }).toEqual({
      capturedCalls: [],
      codexCalls: [
        {
          prompt: expect.stringContaining(failureReason),
          sessionId: recoverySessionIds[0],
          resume: false,
          interactive: true,
        },
      ],
      claudeCalls: [
        {
          prompt: expect.stringContaining(failureReason),
          sessionId: recoverySessionIds[1],
          resume: false,
          interactive: true,
        },
      ],
      attempts: [
        expect.objectContaining({
          step: 'explore',
          provider: 'codex',
          outcome: 'unavailable',
          invoked: true,
        }),
        expect.objectContaining({
          step: 'explore',
          provider: 'claude',
          outcome: 'success',
          invoked: true,
        }),
      ],
    });
  });

  it('cold-starts a free-form recovery REPL through invoke without a stream consumer', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'legacy-session', '/tmp/project');
    const failureReason = 'manual test returned a failing acceptance scenario';

    await (
      runner.runInteractive as unknown as (
        step: StepName,
        context: { step: StepName; reason: string },
      ) => Promise<void>
    )('manual_test', { step: 'manual_test', reason: failureReason });

    const options = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(options).not.toHaveProperty('streamConsumer');
    expect({
      prompt: options.prompt,
      resume: options.resume,
      interactive: options.interactive,
      dangerouslySkipPermissions: options.dangerouslySkipPermissions,
      model: options.model,
      effort: options.effort,
      cwd: options.cwd,
    }).toEqual({
      prompt: expect.stringMatching(new RegExp(`manual_test.*${failureReason}`, 's')),
      resume: false,
      interactive: true,
      dangerouslySkipPermissions: false,
      model: 'sonnet',
      effort: 'medium',
      cwd: '/tmp/project',
    });
  });

  it('states explicitly when interactive recovery captured no failure reason', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'legacy-session', '/tmp/project');

    await (
      runner.runInteractive as unknown as (
        step: StepName,
        context: { step: StepName; reason: string },
      ) => Promise<void>
    )('build', { step: 'build', reason: '  ' });

    const options = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect({
      prompt: options.prompt,
      resume: options.resume,
    }).toEqual({
      prompt: expect.stringMatching(/build.*no (failure )?reason (was )?captured/is),
      resume: false,
    });
  });

  it('dispatches the Codex policy default model and effort for the memory step', async () => {
    const provider = createMockProvider();
    const options = {
      modelPolicy: CODEX_MODEL_POLICY,
    } satisfies StepRunnerOptions;
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', options);

    await runner.run('memory', emptyState);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts).toMatchObject({ model: 'gpt-5.6-luna', effort: 'low' });
  });

  it('dispatches collaborative and branch-session steps through invoke with their existing options', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', { mode: 'auto' });

    await runner.run('explore', emptyState);
    await runner.run('explore', emptyState, { sessionId: 'branch-session', resume: true });

    expect(provider.invoke).toHaveBeenCalledTimes(2);

    const [serial, branch] = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls
      .map(([options]) => options as InvokeOptions);
    expect(serial).toMatchObject({
      prompt: '/explore',
      resume: false,
      interactive: false,
      cwd: '/tmp/project',
      dangerouslySkipPermissions: true,
      systemPrompt: expect.any(String),
      model: expect.any(String),
      effort: expect.any(String),
    });
    expect(branch).toMatchObject({
      prompt: serial.prompt,
      sessionId: 'branch-session',
      resume: true,
      interactive: serial.interactive,
      cwd: serial.cwd,
      dangerouslySkipPermissions: serial.dangerouslySkipPermissions,
      systemPrompt: serial.systemPrompt,
      model: serial.model,
      effort: serial.effort,
    });
    expect(serial.streamConsumer).toEqual(expect.objectContaining({
      onProviderStream: expect.any(Function),
      close: expect.any(Function),
    }));
    expect(branch.streamConsumer).toEqual(expect.objectContaining({
      onProviderStream: expect.any(Function),
      close: expect.any(Function),
    }));

    const replProvider = createMockProvider();
    const replRunner = new DefaultStepRunner(replProvider, 'session-2', '/tmp/project');
    await replRunner.run('explore', emptyState);
    const repl = (replProvider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(repl).toMatchObject({ interactive: true });
    expect(repl).not.toHaveProperty('streamConsumer');
  });

  it('passes correct prompt for explore', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('explore', emptyState);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.prompt).toContain('/explore');
  });

  it('renders provider-native skill syntax from the scalar provider key without changing interactive invocation semantics', async () => {
    const invocations = [] as Array<{
      providerKey: 'claude' | 'codex';
      invokeCalls: number;
      options: InvokeOptions;
    }>;

    for (const providerKey of ['claude', 'codex'] as const) {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(
        provider,
        'shared-session',
        '/wt/feature-x',
        {
          mode: 'interactive',
          featureDesc: 'Provider-native skill invocation',
          totalSteps: 14,
          config: { llm_provider: providerKey },
          providerKey,
        },
      );

      await runner.run('stories', emptyState);

      invocations.push({
        providerKey,
        invokeCalls: (provider.invoke as ReturnType<typeof vi.fn>).mock.calls.length,
        options: (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions,
      });
    }

    const [claude, codex] = invocations;
    const invocationFields = ({
      systemPrompt,
      model,
      effort,
      cwd,
      sessionId,
      resume,
      dangerouslySkipPermissions,
      interactive,
    }: InvokeOptions) => ({
      systemPrompt,
      model,
      effort,
      cwd,
      sessionId,
      resume,
      dangerouslySkipPermissions,
      interactive,
    });
    const claudeInvocation = invocationFields(claude.options);
    const codexInvocation = invocationFields(codex.options);

    expect({
      prompts: invocations.map(({ providerKey, options }) => ({ providerKey, prompt: options.prompt })),
      routes: invocations.map(({ providerKey, invokeCalls }) => ({
        providerKey,
        invokeCalls,
      })),
      claudeInvocation,
      differingInvocationFields: Object.entries(claudeInvocation)
        .filter(([key, value]) => codexInvocation[key as keyof typeof codexInvocation] !== value)
        .map(([key]) => key),
    }).toEqual({
      prompts: [
        { providerKey: 'claude', prompt: '/stories' },
        { providerKey: 'codex', prompt: '$stories' },
      ],
      routes: [
        { providerKey: 'claude', invokeCalls: 1 },
        { providerKey: 'codex', invokeCalls: 1 },
      ],
      claudeInvocation: {
        systemPrompt: expect.stringContaining('Stories'),
        model: expect.any(String),
        effort: expect.any(String),
        cwd: '/wt/feature-x',
        sessionId: expect.any(String),
        resume: false,
        dangerouslySkipPermissions: false,
        interactive: true,
      },
      differingInvocationFields: ['model', 'sessionId'],
    });
  });

  it('renders Codex-native skill syntax for every eligible normal dispatch selected through provider candidates', async () => {
    const cases = [
      { step: 'bootstrap', prompt: '$bootstrap' },
      { step: 'memory', prompt: '$memory' },
      { step: 'assess', prompt: '$assess' },
      { step: 'explore', prompt: '$explore' },
      { step: 'prd', prompt: '$prd' },
      { step: 'stories', prompt: '$stories' },
      { step: 'conflict_check', prompt: '$conflict-check' },
      { step: 'plan', prompt: '$plan' },
      { step: 'coherence_check', prompt: '$coherence-check' },
      { step: 'plan_review', prompt: '$plan-review' },
      { step: 'architecture_diagram', prompt: '$architecture-diagram' },
      { step: 'architecture_review', prompt: '$architecture-review' },
      { step: 'worktree', prompt: '$conduct worktree' },
      { step: 'acceptance_specs', prompt: '$writing-system-tests' },
      { step: 'build', prompt: '$pipeline' },
      { step: 'manual_test', prompt: '$manual-test' },
      { step: 'prd_audit', prompt: '$prd-audit' },
      { step: 'finish', prompt: '$finish' },
    ] satisfies ReadonlyArray<{ step: StepName; prompt: string }>;
    const codexBoundary = vi.fn(
      async (options: InvokeOptions): Promise<InvokeResult> =>
        options.nativeSchema === undefined
          ? { success: true, output: 'done', exitCode: 0 }
          : prdAuditPassResult(),
    );
    const codexProvider: LLMProvider = {
      lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
      invoke: codexBoundary,
    };
    const claudeProvider = createMockProvider();
    const runtimes = new ProviderRuntimeSet([
      {
        key: 'claude',
        provider: claudeProvider,
        policy: CLAUDE_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CLAUDE_POLICY.modelFallbackLadder),
      },
      {
        key: 'codex',
        provider: codexProvider,
        nativeSchemaCapability: { nativeOutputSchema: true },
        policy: CODEX_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
      },
    ]);
    let sessionSequence = 0;
    const sessions = new ProviderSessionStore({
      createSessionId: () => `codex-normal-${++sessionSequence}`,
    });
    const runner = new DefaultStepRunner(
      createMockProvider(),
      'legacy-session',
      '/tmp/project',
      {
        config: {
          llm_provider: ['claude', 'codex'],
          steps: Object.fromEntries(
            cases.map(({ step }) => [step, { llm_provider: 'codex' }]),
          ),
        } as HarnessConfig,
        sessionStore: sessions,
        providerRuntimes: runtimes,
        configuredProviders: ['claude', 'codex'],
      },
    );
    const observed: Array<{ step: StepName; prompt: string }> = [];

    buildPrdAuditProjection.mockResolvedValue(prdAuditProjectionFixture());
    for (const { step } of cases) {
      await runner.resetSession(step);
      await runner.run(step, emptyState);
      const options = codexBoundary.mock.calls.at(-1)?.[0] as InvokeOptions;
      observed.push({
        step,
        prompt: options.prompt.startsWith('$prd-audit\n\nPRD-AUDIT EVIDENCE')
          ? '$prd-audit'
          : options.prompt,
      });
    }

    expect(observed).toEqual(cases);
    buildPrdAuditProjection.mockReset();
  });

  // Worktree isolation: the spawned claude must run in the runner's projectDir,
  // not the daemon's cwd. Without this, daemon feature builds committed to the
  // main checkout's branch instead of the per-feature worktree branch.
  it('passes projectDir as cwd to the provider (collaborative path)', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x');
    await runner.run('explore', emptyState);
    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.cwd).toBe('/wt/feature-x');
  });

  it('passes projectDir as cwd to the provider (autonomous path)', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x');
    await runner.run('build', emptyState); // build is autonomous → invoke()
    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.cwd).toBe('/wt/feature-x');
  });

  // Task 3 (per-feature token accounting): the autonomous dispatch path must
  // forward the provider's tokenUsage and the resolved model string onto the
  // StepRunResult so downstream cost accounting can attribute usage per step.
  it('forwards tokenUsage and resolved model on successful autonomous run', async () => {
    const tokenUsage = {
      input: 100,
      output: 50,
      cacheCreation: 0,
      cacheRead: 0,
      costUsd: 0.0123,
    };
    const provider: LLMProvider = {
      invoke: vi.fn().mockResolvedValue({
        success: true,
        output: 'done',
        exitCode: 0,
        tokenUsage,
      } satisfies InvokeResult),
    };
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    const result = await runner.run('build', emptyState); // build is autonomous → invoke()

    expect(result.tokenUsage).toEqual(tokenUsage);
    expect(result.model).toBeTruthy();
    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(result.model).toBe(opts.model);
  });

  it('passes correct prompt for build (pipeline)', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('build', emptyState);

    // Autonomous steps use invoke() (captured output) not invokeInteractive()
    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.prompt).toMatch(/\/pipeline|\/tdd/);
  });

  // Regression: `remediate` is dispatched out-of-band when a prd_audit blocks
  // (conductor.ts). It's deliberately absent from the linear ALL_STEPS sequence,
  // so resolving its config/index/label threw "Unknown step: remediate" — which
  // the daemon caught and wrote to .pipeline/HALT, blocking autonomous SHIP
  // remediation entirely. run() must dispatch it like any other autonomous step.
  it('dispatches the out-of-band remediate step without throwing', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    const result = await runner.run('remediate', emptyState);

    expect(result.success).toBe(true);
    // Autonomous → invoke(), and the prompt carries the /remediate command.
    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.prompt).toContain('/remediate');
    // No linear index → labelled header instead of "N/total".
    expect(opts.systemPrompt).toContain('Remediate');
  });

  it('autonomous steps use --dangerouslySkipPermissions', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('build', emptyState);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.dangerouslySkipPermissions).toBe(true);
  });

  it('collaborative steps do NOT use --dangerouslySkipPermissions', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('explore', emptyState);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.dangerouslySkipPermissions).toBe(false);
  });

  it('in auto mode, collaborative steps DO skip permissions (no human to approve)', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', { mode: 'auto' });

    await runner.run('explore', emptyState);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    // Otherwise the spawned claude launches in the user's default permission
    // mode (possibly `plan`), blocking the PRD write and looping the step.
    expect(opts.dangerouslySkipPermissions).toBe(true);
  });

  describe('CONDUCT_DAEMON_AUTO_FINISH env marker', () => {
    const previousEnv = process.env.CONDUCT_DAEMON_AUTO_FINISH;

    afterEach(() => {
      if (previousEnv === undefined) delete process.env.CONDUCT_DAEMON_AUTO_FINISH;
      else process.env.CONDUCT_DAEMON_AUTO_FINISH = previousEnv;
    });

    it('sets CONDUCT_DAEMON_AUTO_FINISH=1 for the duration of an auto-mode finish dispatch, then clears it', async () => {
      delete process.env.CONDUCT_DAEMON_AUTO_FINISH;
      const provider = createMockProvider();
      let seenDuringDispatch: string | undefined;
      (provider.invoke as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        seenDuringDispatch = process.env.CONDUCT_DAEMON_AUTO_FINISH;
        return { success: true, output: '', exitCode: 0 };
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', { mode: 'auto' });

      await runner.run('finish', emptyState);

      expect(seenDuringDispatch).toBe('1');
      expect(process.env.CONDUCT_DAEMON_AUTO_FINISH).toBeUndefined();
    });

    it('does not set CONDUCT_DAEMON_AUTO_FINISH for other steps in auto mode', async () => {
      delete process.env.CONDUCT_DAEMON_AUTO_FINISH;
      const provider = createMockProvider();
      let seenDuringDispatch: string | undefined;
      (provider.invoke as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        seenDuringDispatch = process.env.CONDUCT_DAEMON_AUTO_FINISH;
        return { success: true, output: '', exitCode: 0 };
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', { mode: 'auto' });

      await runner.run('explore', emptyState);

      expect(seenDuringDispatch).toBeUndefined();
    });

    it('does not set CONDUCT_DAEMON_AUTO_FINISH for the finish step outside auto mode', async () => {
      delete process.env.CONDUCT_DAEMON_AUTO_FINISH;
      const provider = createMockProvider();
      let seenDuringDispatch: string | undefined;
      (provider.invoke as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        seenDuringDispatch = process.env.CONDUCT_DAEMON_AUTO_FINISH;
        return { success: true, output: '', exitCode: 0 };
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      await runner.run('finish', emptyState);

      expect(seenDuringDispatch).toBeUndefined();
    });

    it('restores a pre-existing CONDUCT_DAEMON_AUTO_FINISH value after an auto-mode finish dispatch', async () => {
      process.env.CONDUCT_DAEMON_AUTO_FINISH = 'preexisting';
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', { mode: 'auto' });

      await runner.run('finish', emptyState);

      expect(process.env.CONDUCT_DAEMON_AUTO_FINISH).toBe('preexisting');
    });
  });

  it('worktree is autonomous', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('worktree', emptyState);

    // Autonomous → invoke()
    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.dangerouslySkipPermissions).toBe(true);
  });

  it('stories is collaborative', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('stories', emptyState);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.dangerouslySkipPermissions).toBe(false);
  });

  it('returns success on normal completion', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    const result = await runner.run('explore', emptyState);

    expect(result.success).toBe(true);
  });

  it('returns failure when session throws', async () => {
    const provider = createMockProvider();
    (provider.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('crash'));
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    const result = await runner.run('explore', emptyState);

    expect(result.success).toBe(false);
  });

  it('logs and surfaces the real thrown error instead of swallowing it (interactive dispatch)', async () => {
    const provider = createMockProvider();
    (provider.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('ECONNRESET: provider process died'),
    );
    const log = vi.fn();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', { log });

    const result = await runner.run('explore', emptyState);

    expect(result).toEqual({
      success: false,
      output: 'Session for explore exited with error: ECONNRESET: provider process died',
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('ECONNRESET: provider process died'),
    );
  });

  it('logs and surfaces the real thrown error instead of swallowing it (provider-aware normal dispatch)', async () => {
    const log = vi.fn();
    const providerExecutor = vi.fn(async (_input: ExecuteProviderCandidatesInput) => {
      throw new Error('candidate ladder exhausted: no live model');
    });
    const runner = new DefaultStepRunner(createMockProvider(), 'session', '/tmp/project', {
      log,
      providerExecution: {
        configuredProviders: ['claude'],
        runtimes: new ProviderRuntimeSet([interactiveRuntime('claude', vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: '', exitCode: 0 })))]),
        sessions: new ProviderSessionStore(),
        executor: providerExecutor,
      },
    });

    const result = await runner.run('build', emptyState);

    expect(result).toEqual({
      success: false,
      output: 'Session for build exited with error: candidate ladder exhausted: no live model',
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('candidate ladder exhausted: no live model'),
    );
  });

  it('does not resume legacy scalar steps', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('worktree', emptyState); // autonomous → invoke
    await runner.run('memory', emptyState);   // autonomous → invoke

    const call1 = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    const call2 = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[1][0] as InvokeOptions;
    expect(call1.resume).toBe(false);
    expect(call2.resume).toBe(false);
  });

  // --- Feature 1: Step-scoped system prompts ---

  it('step runner passes system prompt with step context', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
      featureDesc: 'Add user auth',
      totalSteps: 14,
    });

    await runner.run('explore', emptyState);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).toContain('[Conduct step 3/14]');
    expect(opts.systemPrompt).toContain('Feature: Add user auth');
  });

  it('collaborative step system prompt includes "Complete ONLY this step"', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
      featureDesc: 'Add user auth',
      totalSteps: 14,
    });

    // explore is collaborative (not autonomous)
    await runner.run('explore', emptyState);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).toContain('Complete ONLY this step');
    expect(opts.systemPrompt).toContain('Explore');
  });

  it('autonomous step system prompt does NOT include "Complete ONLY this step"', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
      featureDesc: 'Add user auth',
      totalSteps: 14,
    });

    // build is autonomous → invoke() path
    await runner.run('build', emptyState);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).toContain('Feature: Add user auth');
    expect(opts.systemPrompt).not.toContain('Complete ONLY this step');
  });

  // FINISH mechanics are coordinator-owned. The provider boundary is limited
  // to the one reader-facing PR-prose judgment, so no prompt can authorize
  // git/GitHub mutation or completion-marker writes.
  it('auto-mode finish prompt limits the provider to PR prose and excludes mechanics', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x', {
      mode: 'auto',
      pipelineDir: '/wt/feature-x/.pipeline',
    });

    await runner.run('finish', emptyState);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).toContain('PR title and body');
    expect(opts.systemPrompt).not.toContain('finish-record');
    expect(opts.systemPrompt).not.toContain('gh pr create');
    expect(opts.systemPrompt).not.toContain('git push');
  });

  // The authoring pass is the fix for a PR that reached FINISH with an
  // unauthored body: the provider is told to WRITE the prose from the diff,
  // and is given the authoring contract instead of a grading rubric.
  // Covers: task:9
  it('finish authoring pass returns the prose through the engine handoff and names both hosts', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x', {
      mode: 'auto',
      pipelineDir: '/wt/feature-x/.pipeline',
    });

    await runner.run('finish', emptyState, { finishProsePass: 'author' });

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).toContain('FINISH PR PROSE AUTHORING');
    // Bounded diff reading: the shape of the change, never the whole diff.
    expect(opts.systemPrompt).toContain('git diff --stat <base>..HEAD');
    expect(opts.systemPrompt).toContain('Do not print the whole branch diff');
    expect(opts.systemPrompt).not.toContain('Read the full diff');
    expect(opts.systemPrompt).toContain('`/pr`');
    expect(opts.systemPrompt).toContain('`$pr`');
    expect(opts.systemPrompt).toContain('Write only `.pipeline/finish-pr-prose.json` as `{"version":1,"title":"…","body":"…"}`');
    expect(opts.systemPrompt).toContain('The engine validates and publishes that handoff');
    expect(opts.systemPrompt).toContain('leave every `ai-conductor:step` region and its markers unchanged');
    // It authors; it does not grade, and it makes no publication mechanics.
    expect(opts.systemPrompt).not.toContain('revision_required');
    expect(opts.systemPrompt).not.toContain('gh pr create');
    expect(opts.systemPrompt).not.toContain('git push');
    expect(opts.systemPrompt).not.toContain('finish-record');
    expect(opts.systemPrompt).not.toContain('in place');
    expect(opts.systemPrompt).not.toContain('ai-conductor github-operation');
    expect(opts.systemPrompt).not.toContain('--request-file');
    expect(opts.systemPrompt).not.toContain('pull-request.edit');
  });

  // Covers: task:9
  it('finish revision-lap authoring pass returns the revised prose through the engine handoff', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x', {
      mode: 'auto',
      pipelineDir: '/wt/feature-x/.pipeline',
    });
    const guidance = 'Explain how a failed rebase is recovered without losing completed work.';

    await runner.run('finish', emptyState, {
      finishProsePass: 'author',
      revisionGuidance: guidance,
    });

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).toContain('FINISH PR PROSE REVISION');
    expect(opts.systemPrompt).toContain(guidance);
    expect(opts.systemPrompt).toContain('Write only `.pipeline/finish-pr-prose.json` as `{"version":1,"title":"…","body":"…"}`');
    expect(opts.systemPrompt).toContain('The engine validates and publishes that handoff');
    expect(opts.systemPrompt).toContain('Do not print the whole branch diff');
    expect(opts.systemPrompt).not.toContain('still carries the engine-seeded placeholder body');
    expect(opts.systemPrompt).not.toContain('no prose to judge yet');
    expect(opts.systemPrompt).toContain('do not create, push, merge, or ready a pull request');
    expect(opts.systemPrompt).toContain('do not alter labels, shipment evidence, or completion files');
    expect(opts.systemPrompt).toContain('The publication coordinator re-reads the pull request afterwards');
    expect(opts.systemPrompt).not.toContain('in place');
    expect(opts.systemPrompt).not.toContain('ai-conductor github-operation');
    expect(opts.systemPrompt).not.toContain('--request-file');
    expect(opts.systemPrompt).not.toContain('pull-request.edit');
  });

  it('finish authoring pass without revision guidance keeps the placeholder-authoring prompt', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x', {
      mode: 'auto',
      pipelineDir: '/wt/feature-x/.pipeline',
    });

    await runner.run('finish', emptyState, { finishProsePass: 'author' });

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).toContain('FINISH PR PROSE AUTHORING');
    expect(opts.systemPrompt).toContain('still carries the engine-seeded placeholder body');
    expect(opts.systemPrompt).not.toContain('FINISH PR PROSE REVISION');
  });

  // Covers: task:10
  it('finish judgment passes return only a closed verdict and defer unauthored bodies', async () => {
    const provider = createMockProvider();
    const autoRunner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x', {
      mode: 'auto',
      pipelineDir: '/wt/feature-x/.pipeline',
    });

    await autoRunner.run('finish', emptyState, { finishProsePass: 'judge' });

    const autoPrompt = ((provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions).systemPrompt;
    expect(autoPrompt).not.toContain('FINISH PR PROSE AUTHORING');
    expect(autoPrompt).toContain('{"kind":"accepted"}');
    expect(autoPrompt).toContain('{"kind":"revision_required","reason":"placeholder|halt|structurally_incomplete"}');
    expect(autoPrompt).toContain('{"kind":"timed_out"}');
    expect(autoPrompt).toContain('{"kind":"provider_unavailable"}');
    expect(autoPrompt).toContain('{"kind":"refused"}');
    expect(autoPrompt).toContain('Return exactly one JSON object');
    expect(autoPrompt).toContain('separate authoring pass');

    vi.clearAllMocks();
    const interactiveRunner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x', {
      mode: 'interactive',
      pipelineDir: '/wt/feature-x/.pipeline',
    });
    await interactiveRunner.run('finish', emptyState, { finishProsePass: 'judge' });

    const interactivePrompt = ((provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions).systemPrompt;
    expect(interactivePrompt).toContain('{"kind":"accepted"}');
    expect(interactivePrompt).toContain('{"kind":"revision_required","reason":"placeholder|halt|structurally_incomplete"}');
    expect(interactivePrompt).toContain('{"kind":"timed_out"}');
    expect(interactivePrompt).toContain('{"kind":"provider_unavailable"}');
    expect(interactivePrompt).toContain('{"kind":"refused"}');
    expect(interactivePrompt).toContain('return exactly one JSON object');
    expect(interactivePrompt).toContain('separate authoring pass');

    for (const prompt of [autoPrompt, interactivePrompt]) {
      if (prompt === undefined) throw new Error('FINISH judgment prompt was not supplied');
      for (const forbidden of [
        'may repair', 'repair only', 'may edit', 'edit the PR', 'edit only', 'may rewrite', 'rewrite', 'in place',
        'ai-conductor github-operation', '--request-file', 'pull-request.edit',
      ]) {
        expect(prompt.toLowerCase()).not.toContain(forbidden);
      }
    }
  });

  it('auto-mode finish prompt has no pipeline-path-dependent mechanical instruction', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x', {
      mode: 'auto',
    });

    await runner.run('finish', emptyState);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).toContain('PR title and body');
    expect(opts.systemPrompt).not.toContain('--pipeline-dir');
  });

  it('auto-mode finish prompt does not restore the retired finish-record command', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x', {
      mode: 'auto',
      pipelineDir: '/wt/feature-x/.pipeline',
    });

    await runner.run('finish', emptyState);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).not.toContain('conduct-ts finish-record');
  });

  it('auto-mode finish prompt still excludes hand-written terminal markers', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x', {
      mode: 'auto',
      pipelineDir: '/wt/feature-x/.pipeline',
    });

    await runner.run('finish', emptyState);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).not.toContain('write the single word');
  });

  it('auto-mode finish prompt remains mechanical-path-independent without pipelineDir', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x', {
      mode: 'auto',
    });

    await runner.run('finish', emptyState);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).not.toContain('finish-record');
    expect(opts.systemPrompt).not.toContain('--pipeline-dir');
  });

  it('non-auto finish prompts retain operator intent but exclude mechanical commands', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x', {
      totalSteps: 14,
      pipelineDir: '/wt/feature-x/.pipeline',
    });

    // finish, but not auto mode (collaborative path)
    await runner.run('finish', emptyState);
    const finishOpts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(finishOpts.systemPrompt).toContain('operator publication intent');
    expect(finishOpts.systemPrompt).not.toContain('finish-record');
    expect(finishOpts.systemPrompt).not.toContain('gh pr create');
    expect(finishOpts.systemPrompt).toContain('return exactly one JSON object');
    expect(finishOpts.systemPrompt).toContain('exactly one JSON object');

    vi.clearAllMocks();

    const autoRunner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x', {
      mode: 'auto',
      totalSteps: 14,
    });
    await autoRunner.run('build', emptyState);
    const buildOpts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(buildOpts.systemPrompt).not.toContain('operator publication intent');
  });

  it('limits auto FINISH judgment authority to a typed result', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/wt/feature-x', { mode: 'auto' });

    await runner.run('finish', emptyState);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).toContain('Return exactly one JSON object');
    expect(opts.systemPrompt).not.toContain('may repair');
    expect(opts.systemPrompt).toContain('"revision_required"');
    expect(opts.systemPrompt).toContain('Do not create, push, merge, or ready a PR');
    expect(opts.systemPrompt).toContain('do not alter labels, shipment evidence, or completion files');
  });

  // --- Feature 2: Session creation marker ---

  describe('session marker persistence', () => {
    let pipeDir: string;

    beforeEach(async () => {
      pipeDir = await mkdtemp(join(tmpdir(), 'step-runner-'));
    });

    afterEach(async () => {
      await rm(pipeDir, { recursive: true, force: true });
    });

    it('persists session-created marker after first success', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      await runner.run('worktree', emptyState);

      // Marker file should exist
      const markerPath = join(pipeDir, 'session-created');
      await expect(access(markerPath).then(() => true, () => false)).resolves.toBe(true);
    });

    it('cold-starts a legacy scalar retry with a fresh session id', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      await runner.run('worktree', emptyState);
      await runner.run('worktree', emptyState);

      const attempts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls.map(
        ([options]) => options as InvokeOptions,
      );
      expect({
        resumes: attempts.map(({ resume }) => resume),
        sessionIdChanged: attempts[0].sessionId !== attempts[1].sessionId,
      }).toEqual({
        resumes: [false, false],
        sessionIdChanged: true,
      });
    });

    it('does not resume from an inherited session-created marker', async () => {
      // Pre-create the marker file
      await writeFile(join(pipeDir, 'session-created'), '1', 'utf-8');

      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      await runner.run('explore', emptyState);

      const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
      expect(opts.resume).toBe(false);
    });

    it('resetSession() overrides an inherited stale marker so the next step CREATES (no --resume)', async () => {
      // Reproduces the daemon worktree-reuse bug: a KEPT worktree carries a
      // stale `session-created` marker from the prior run, so a fresh runner's
      // lazy-init would set sessionStarted=true and `--resume` a brand-new
      // session id that was never created → "No conversation found" → "session
      // unavailable (expired or in use)". The conductor calls resetSession()
      // before every step (unconditional fresh-per-step); it must win over the stale
      // marker and force a create.
      await writeFile(join(pipeDir, 'session-created'), '1', 'utf-8');
      await writeFile(join(pipeDir, 'conduct-session-id'), 'stale-id', 'utf-8');

      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'fresh-id', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      await runner.resetSession();
      await runner.run('acceptance_specs', emptyState); // autonomous → invoke()

      const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
      expect(opts.resume).toBe(false);
    });

    it('does not replace the feature run id with a provider invocation id', async () => {
      await writeFile(join(pipeDir, 'conduct-session-id'), 'feature-run-id', 'utf-8');
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'my-session-id', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      await runner.run('worktree', emptyState);

      const sessionIdPath = join(pipeDir, 'conduct-session-id');
      const content = await readFile(sessionIdPath, 'utf-8');
      const invoked = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
      expect({
        runId: content.trim(),
        providerIdIsSeparate: invoked.sessionId !== content.trim(),
      }).toEqual({
        runId: 'feature-run-id',
        providerIdIsSeparate: true,
      });
    });

    it('does not write marker when step fails', async () => {
      const provider = createMockProvider();
      // worktree is autonomous → invoke() path. Mock it to return failure.
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        output: 'step exited nonzero',
        exitCode: 1,
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      await runner.run('worktree', emptyState);

      const markerPath = join(pipeDir, 'session-created');
      await expect(access(markerPath).then(() => true, () => false)).resolves.toBe(false);
    });
  });

  // --- Feature 3: Step cooldown ---

  describe('step cooldown', () => {
    it('tracks call count across steps', async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        stepCooldown: 10,
        sleepFn: sleepSpy,
      });

      await runner.run('worktree', emptyState);
      await runner.run('memory', emptyState);

      expect(runner.callCount).toBe(2);
    });

    it('skips cooldown for the very first step', async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        stepCooldown: 10,
        sleepFn: sleepSpy,
      });

      await runner.run('worktree', emptyState);

      // No sleep before the first step
      expect(sleepSpy).not.toHaveBeenCalled();
    });

    it('applies cooldown after the first step', async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        stepCooldown: 10,
        sleepFn: sleepSpy,
      });

      await runner.run('worktree', emptyState);
      await runner.run('memory', emptyState);

      // Sleep called once before the second step
      expect(sleepSpy).toHaveBeenCalledOnce();
      expect(sleepSpy).toHaveBeenCalledWith(10000); // 10 seconds in ms
    });

    it('cooldown escalates after 10 calls', async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        stepCooldown: 10,
        sleepFn: sleepSpy,
      });

      // Run 11 steps (first has no cooldown, steps 2-10 use base, step 11 uses 2x).
      // complexity is engine-managed, so it is excluded from runner.run paths.
      const steps: StepName[] = [
        'worktree', 'memory', 'explore', 'stories', 'conflict_check',
        'plan', 'architecture_diagram', 'architecture_review',
        'acceptance_specs', 'build', 'manual_test',
      ];
      for (const step of steps) {
        await runner.run(step, emptyState);
      }

      // 10 sleep calls (steps 2-11)
      expect(sleepSpy).toHaveBeenCalledTimes(10);
      // Last call (11th step, callCount=10 at that point) should use 2x cooldown
      expect(sleepSpy).toHaveBeenLastCalledWith(20000); // 2x base
    });

    it('cooldown escalates to 3x after 20 calls', async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        stepCooldown: 5,
        sleepFn: sleepSpy,
      });

      // Simulate 21 calls by running same step repeatedly
      for (let i = 0; i < 21; i++) {
        await runner.run('worktree', emptyState);
      }

      // Last call (21st step, callCount=20 at that point) should use 3x cooldown
      expect(sleepSpy).toHaveBeenLastCalledWith(15000); // 3x * 5s
    });

    it('pins cooldown multiplier at callCount == 9 (still 1x)', async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        stepCooldown: 10,
        sleepFn: sleepSpy,
      });

      // Run 10 steps: step 1 has no cooldown, steps 2-10 have cooldown
      // When step 10 runs, callCount == 9 (last value of 1x tier)
      for (let i = 0; i < 10; i++) {
        await runner.run('worktree', emptyState);
      }

      // 9 sleep calls (steps 2-10)
      expect(sleepSpy).toHaveBeenCalledTimes(9);
      // 10th step (callCount=9) should still use 1x multiplier
      expect(sleepSpy).toHaveBeenLastCalledWith(10000); // 1x base
    });

    it('pins cooldown multiplier at callCount == 10 (escalates to 2x)', async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        stepCooldown: 10,
        sleepFn: sleepSpy,
      });

      // Run 11 steps: when step 11 runs, callCount == 10 (first value of 2x tier)
      for (let i = 0; i < 11; i++) {
        await runner.run('worktree', emptyState);
      }

      // 10 sleep calls (steps 2-11)
      expect(sleepSpy).toHaveBeenCalledTimes(10);
      // 11th step (callCount=10) should use 2x multiplier
      expect(sleepSpy).toHaveBeenLastCalledWith(20000); // 2x base
    });

    it('pins cooldown multiplier at callCount == 19 (still 2x)', async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        stepCooldown: 10,
        sleepFn: sleepSpy,
      });

      // Run 20 steps: when step 20 runs, callCount == 19 (last value of 2x tier)
      for (let i = 0; i < 20; i++) {
        await runner.run('worktree', emptyState);
      }

      // 19 sleep calls (steps 2-20)
      expect(sleepSpy).toHaveBeenCalledTimes(19);
      // 20th step (callCount=19) should still use 2x multiplier
      expect(sleepSpy).toHaveBeenLastCalledWith(20000); // 2x base
    });

    it('pins cooldown multiplier at callCount == 20 (escalates to 3x)', async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        stepCooldown: 10,
        sleepFn: sleepSpy,
      });

      // Run 21 steps: when step 21 runs, callCount == 20 (first value of 3x tier)
      for (let i = 0; i < 21; i++) {
        await runner.run('worktree', emptyState);
      }

      // 20 sleep calls (steps 2-21)
      expect(sleepSpy).toHaveBeenCalledTimes(20);
      // 21st step (callCount=20) should use 3x multiplier
      expect(sleepSpy).toHaveBeenLastCalledWith(30000); // 3x base
    });

    it('cooldown disabled (stepCooldown == 0) → no sleep regardless of call count', async () => {
      const sleepSpy = vi.fn().mockResolvedValue(undefined);
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        stepCooldown: 0,
        sleepFn: sleepSpy,
      });

      // Run 21 steps to exercise all boundary crossings.
      // With stepCooldown: 0, sleep should never be called regardless.
      for (let i = 0; i < 21; i++) {
        await runner.run('worktree', emptyState);
      }

      // No sleep calls at all when cooldown is disabled
      expect(sleepSpy).not.toHaveBeenCalled();
    });
  });

  describe('complexity assessment', () => {
    it('refuses to run() the complexity step (engine-managed)', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      await expect(runner.run('complexity' as StepName, emptyState)).rejects.toThrow(
        /engine/i,
      );
    });

    it('refuses to run() the rebase step (engine-managed)', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      await expect(runner.run('rebase' as StepName, emptyState)).rejects.toThrow(
        /engine/i,
      );
    });

    it('assessComplexity calls provider.invoke in print mode', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        output: 'Reasoning...\n\nTIER: M',
        exitCode: 0,
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      const tier = await runner.assessComplexity();

      expect(provider.invoke).toHaveBeenCalledOnce();
      expect(tier).toBe('M');
    });

    it('assessComplexity returns null when provider fails', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        output: 'rate limited',
        exitCode: 1,
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      expect(await runner.assessComplexity()).toBeNull();
    });

    it('assessComplexity returns null when output has no tier', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        output: 'I could not determine a clear tier from the design exploration.',
        exitCode: 0,
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      expect(await runner.assessComplexity()).toBeNull();
    });
  });

  describe('parseSignalCountsFromOutput', () => {
    it('extracts all five signals from well-formed output', () => {
      const output = `MODELS: 12
INTEGRATIONS: 3
AUTH: 2
STATE_MACHINES: 4
STORIES: 25
TIER: L`;
      expect(parseSignalCountsFromOutput(output)).toEqual({
        models: 12,
        integrations: 3,
        auth: 2,
        stateMachines: 4,
        stories: 25,
      });
    });

    it('tolerates STATE MACHINES with space or hyphen', () => {
      expect(parseSignalCountsFromOutput('STATE MACHINES: 2').stateMachines).toBe(2);
      expect(parseSignalCountsFromOutput('STATE-MACHINES: 3').stateMachines).toBe(3);
      expect(parseSignalCountsFromOutput('STATEMACHINES: 1').stateMachines).toBe(1);
    });

    it('is case-insensitive and tolerates surrounding prose', () => {
      const output = `Here is my assessment.
models: 5
Some filler.
Integrations: 1
auth: 0
state_machines: 0
stories: 8
tier: m`;
      expect(parseSignalCountsFromOutput(output)).toEqual({
        models: 5,
        integrations: 1,
        auth: 0,
        stateMachines: 0,
        stories: 8,
      });
    });

    it('returns an empty object when no signals found', () => {
      expect(parseSignalCountsFromOutput('nothing useful')).toEqual({});
      expect(parseSignalCountsFromOutput('TIER: S')).toEqual({});
    });

    it('omits signals whose value is not a non-negative integer', () => {
      const output = `MODELS: abc
INTEGRATIONS: 2
AUTH: 1
STORIES: 10`;
      const parsed = parseSignalCountsFromOutput(output);
      expect(parsed.models).toBeUndefined();
      expect(parsed.integrations).toBe(2);
      expect(parsed.auth).toBe(1);
      expect(parsed.stories).toBe(10);
    });
  });

  describe('scoreComplexityFromCounts', () => {
    it('scores a Large project (many models + integrations)', () => {
      expect(
        scoreComplexityFromCounts({
          models: 12,     // L
          integrations: 3, // L
          auth: 2,         // L
          stateMachines: 2, // L
          stories: 25,     // L
        }),
      ).toBe('L');
    });

    it('scores a Small project (trivial across the board)', () => {
      expect(
        scoreComplexityFromCounts({
          models: 2,
          integrations: 0,
          auth: 0,
          stateMachines: 0,
          stories: 3,
        }),
      ).toBe('S');
    });

    it('breaks ties toward the higher tier (2S + 2L + 1M → L)', () => {
      expect(
        scoreComplexityFromCounts({
          models: 2,        // S
          integrations: 0,  // S
          auth: 1,          // M
          stateMachines: 2, // L
          stories: 50,      // L
        }),
      ).toBe('L');
    });

    it('returns null when fewer than 3 signals are available', () => {
      expect(scoreComplexityFromCounts({})).toBeNull();
      expect(scoreComplexityFromCounts({ models: 5 })).toBeNull();
      expect(
        scoreComplexityFromCounts({ models: 5, integrations: 1 }),
      ).toBeNull();
    });

    it('scores with exactly 3 signals (borderline)', () => {
      // 3 signals: 1S + 1M + 1L → tie break toward L per assessTier
      expect(
        scoreComplexityFromCounts({ models: 2, integrations: 2, stories: 20 }),
      ).toBe('L');
    });
  });

  describe('assessComplexity deterministic scoring', () => {
    it('cold-starts legacy complexity assessment despite an inherited session marker', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'complexity-cold-start-'));
      const pipelineDir = join(dir, '.pipeline');
      await mkdir(pipelineDir, { recursive: true });
      await writeFile(join(pipelineDir, 'session-created'), '1', 'utf-8');
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        output: 'MODELS: 2\nINTEGRATIONS: 0\nAUTH: 0\nTIER: S',
        exitCode: 0,
      });
      const runner = new DefaultStepRunner(provider, 'legacy-session', dir, {
        pipelineDir,
      });

      try {
        await runner.assessComplexity();
        const options = (provider.invoke as ReturnType<typeof vi.fn>).mock
          .calls[0][0] as InvokeOptions;
        expect({
          resume: options.resume,
          freshSessionId: options.sessionId !== 'legacy-session',
        }).toEqual({ resume: false, freshSessionId: true });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('prefers count-based scoring over Claude letter (L despite TIER: S)', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        output: `MODELS: 15
INTEGRATIONS: 5
AUTH: 2
STATE_MACHINES: 3
STORIES: 40
TIER: S`,
        exitCode: 0,
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');
      expect(await runner.assessComplexity()).toBe('L');
    });

    it('falls back to Claude letter when <3 counts extracted', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        output: `MODELS: 2
TIER: M`,
        exitCode: 0,
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');
      expect(await runner.assessComplexity()).toBe('M');
    });
  });

  describe('parseTierFromOutput', () => {
    it.each([
      ['TIER: S', 'S'],
      ['TIER: M', 'M'],
      ['TIER: L', 'L'],
      ['tier: s', 'S'],
      ['Reasoning about scope...\n\nFinal answer\n\nTIER: L', 'L'],
      ['TIER: M\nsome trailing text\nTIER: L', 'L'], // last match wins
    ])('extracts tier from %j → %s', (output, expected) => {
      expect(parseTierFromOutput(output)).toBe(expected);
    });

    it('falls back to trailing standalone letter', () => {
      expect(parseTierFromOutput('Analysis done.\n\nM.')).toBe('M');
      expect(parseTierFromOutput('Analysis done.\n\nL')).toBe('L');
    });

    it('returns null when no tier is present', () => {
      expect(parseTierFromOutput('')).toBeNull();
      expect(parseTierFromOutput('no tier here')).toBeNull();
      expect(parseTierFromOutput('TIER: X')).toBeNull();
    });
  });

  describe('auth-failure detection', () => {
    let pipeDir: string;
    beforeEach(async () => {
      pipeDir = await mkdtemp(join(tmpdir(), 'runner-authfail-'));
    });
    afterEach(async () => {
      await rm(pipeDir, { recursive: true, force: true });
    });

    it('surfaces preflight non-ready authentication metadata when provider reports authFailure', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        output: 'Not logged in — operator OAuth token is expired',
        exitCode: 1,
        authFailure: true,
        authentication: {
          provider: 'codex',
          source: 'api-key',
          state: 'missing',
        },
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      const result = await runner.run('worktree', emptyState);

      expect(result.authFailure).toBe(true);
      expect(result.authentication).toEqual({
        provider: 'codex',
        source: 'api-key',
        state: 'missing',
      });
    });

    it('preserves a provider permission denial for conductor-owned terminal handling', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        output: 'Codex permission review denied the required action.',
        exitCode: 1,
        permissionDenied: true,
        authentication: {
          provider: 'codex',
          source: 'cached-login',
          state: 'ready',
        },
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      const result = await runner.run('worktree', emptyState);

      expect(result).toMatchObject({
        success: false,
        permissionDenied: true,
        authentication: {
          provider: 'codex',
          source: 'cached-login',
          state: 'ready',
        },
      });
    });
  });

  describe('rate-limit detection', () => {
    let pipeDir: string;
    beforeEach(async () => {
      pipeDir = await mkdtemp(join(tmpdir(), 'runner-ratelimit-'));
    });
    afterEach(async () => {
      await rm(pipeDir, { recursive: true, force: true });
    });

    it('surfaces rateLimited=true when provider reports it', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        output: 'rate limit hit, try again',
        exitCode: 1,
        rateLimited: true,
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      const result = await runner.run('worktree', emptyState);

      expect(result.rateLimited).toBe(true);
      // No marker file → default wait
      expect(result.waitSeconds).toBe(300);
    });

    it('sources wait seconds from provider result', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        output: 'rate limited',
        exitCode: 1,
        rateLimited: true,
        waitSeconds: 450,
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      const result = await runner.run('worktree', emptyState);

      expect(result.waitSeconds).toBe(450);
    });

    it('falls back to 300 seconds when provider omits waitSeconds', async () => {
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        output: 'rate limited',
        exitCode: 1,
        rateLimited: true,
        // waitSeconds: undefined
      });
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      const result = await runner.run('worktree', emptyState);

      expect(result.waitSeconds).toBe(300);
    });
  });

  describe('resetSession', () => {
    let pipeDir: string;
    beforeEach(async () => {
      pipeDir = await mkdtemp(join(tmpdir(), 'runner-reset-'));
    });
    afterEach(async () => {
      await rm(pipeDir, { recursive: true, force: true });
    });

    it('deletes the marker and preserves the feature run id while the provider cold-starts', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      // Simulate a prior successful autonomous run that wrote the marker.
      await writeFile(join(pipeDir, 'session-created'), '1', 'utf-8');
      await writeFile(join(pipeDir, 'conduct-session-id'), 'session-1', 'utf-8');

      await runner.resetSession();

      // Marker gone
      const stillExists = await access(join(pipeDir, 'session-created'))
        .then(() => true, () => false);
      expect(stillExists).toBe(false);

      await runner.run('worktree', emptyState);
      const invocation = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
      expect({
        runId: (await readFile(join(pipeDir, 'conduct-session-id'), 'utf-8')).trim(),
        providerSessionChanged: invocation.sessionId !== 'session-1',
        resume: invocation.resume,
      }).toEqual({
        runId: 'session-1',
        providerSessionChanged: true,
        resume: false,
      });
    });

    it('tolerates resetSession when the marker never existed', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });
      await expect(runner.resetSession()).resolves.toBeUndefined();
    });

    it('after reset, next autonomous run uses --session-id (not --resume)', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      // First run — creates session
      await runner.run('worktree', emptyState);
      // Second run also cold-starts.
      await runner.run('memory', emptyState);

      // Reset and run again — should go back to resume=false. Use a
      // per-feature step (bootstrap/assess are project-level preludes, not in
      // ALL_STEPS — see runProjectPrelude).
      await runner.resetSession();
      await runner.run('acceptance_specs', emptyState);

      const calls = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0][0].resume).toBe(false);  // first
      expect(calls[1][0].resume).toBe(false);  // second
      expect(calls[2][0].resume).toBe(false);  // post-reset
    });
  });

  describe('interactive REPL dispatch for conversational steps', () => {
    const replSteps: StepName[] = [
      'explore',
      'stories',
      'plan',
      'architecture_review',
      'manual_test',
      'finish',
    ];

    for (const step of replSteps) {
      it(`${step}: passes interactive: true when mode is 'default'`, async () => {
        const provider = createMockProvider();
        const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
          mode: 'default',
        });

        await runner.run(step, emptyState);

        const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
        expect(opts.interactive).toBe(true);
      });

      it(`${step}: does NOT pass interactive: true when mode is 'auto'`, async () => {
        const provider = createMockProvider();
        const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
          mode: 'auto',
        });

        await runner.run(step, emptyState);

        const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
        expect(opts.interactive).toBe(false);
      });

      it(`${step}: passes interactive: true when mode is 'interactive'`, async () => {
        const provider = createMockProvider();
        const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
          mode: 'interactive',
        });

        await runner.run(step, emptyState);

        const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
        expect(opts.interactive).toBe(true);
      });
    }

    // FR-1-2: Test conversational steps NOT in INTERACTIVE_STEPS (like prd_audit)
    // should dispatch with interactive: true in mode='interactive' and
    // interactive: false in mode='default'
    it('prd_audit: passes interactive: false in mode default (not in INTERACTIVE_STEPS)', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        mode: 'default',
      });

      await runner.run('prd_audit', emptyState);

      const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
      expect(opts.interactive).toBe(false);
    });

    it('prd_audit: passes interactive: true in mode interactive (conversational, not one-shot)', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        mode: 'interactive',
      });

      await runner.run('prd_audit', emptyState);

      const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
      expect(opts.interactive).toBe(true);
    });

    // FR-2: Verify that steps in interactive mode continue to the next step normally
    it('after a conversational step completes in mode interactive, run advances to next step with same flow', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        mode: 'interactive',
      });

      const result1 = await runner.run('explore', emptyState);
      const result2 = await runner.run('stories', emptyState);

      // Both steps should complete successfully
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      // Both should have been dispatched with interactive: true
      const opts1 = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
      const opts2 = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[1][0] as InvokeOptions;
      expect(opts1.interactive).toBe(true);
      expect(opts2.interactive).toBe(true);
    });

    it('dispatchable one-shot steps stay print-mode even in default mode', async () => {
      const oneShotSteps: StepName[] = [
        'conflict_check',
        'architecture_diagram',
      ];
      for (const step of oneShotSteps) {
        const provider = createMockProvider();
        const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
          mode: 'default',
        });

        await runner.run(step, emptyState);

        const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
        expect(opts.interactive).toBe(false);
      }
    });

    it('surviving one-shot steps stay print-mode even in interactive mode', async () => {
      const oneShotSteps: StepName[] = [
        'conflict_check',
        'architecture_diagram',
      ];
      for (const step of oneShotSteps) {
        const provider = createMockProvider();
        const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
          mode: 'interactive',
        });

        await runner.run(step, emptyState);

        const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
        expect(opts.interactive).toBe(false);
      }
    });

    it('default mode is the default when options.mode is absent', async () => {
      const provider = createMockProvider();
      // No options → mode defaults to 'default'
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      await runner.run('explore', emptyState);

      const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
      expect(opts.interactive).toBe(true);
    });
  });

  describe('model fallback ladder (autonomous steps)', () => {
    it('falls back to opus when fable is marked dead, one attempt total', async () => {
      const invoke = vi.fn().mockResolvedValue({
        success: true,
        output: 'done',
        exitCode: 0,
      });
      const provider: LLMProvider = {
        invoke,
      };
      // Force the step's configured model to 'fable' so we can exercise the
      // ladder's fallback-to-opus path deterministically.
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        modelOverride: 'fable',
      });
      // Simulate fable already known-dead from a prior invocation in this process.
      (runner as unknown as { modelAvailability: { markDead: (m: string) => void } })
        .modelAvailability.markDead('fable');

      const result = await runner.run('build', emptyState); // build is autonomous → invoke()

      expect(result.success).toBe(true);
      expect(invoke).toHaveBeenCalledOnce();
      const opts = invoke.mock.calls[0][0] as InvokeOptions;
      expect(opts.model).toBe('opus');
    });

    it('returns ordinary success:false when all ladder models are dead', async () => {
      const invoke = vi.fn().mockResolvedValue({
        success: false,
        output: 'no models available',
        exitCode: 1,
        modelUnavailable: true,
      });
      const provider: LLMProvider = {
        invoke,
      };
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        modelOverride: 'fable',
      });
      (runner as unknown as { modelAvailability: { markDead: (m: string) => void } })
        .modelAvailability.markDead('fable');
      (runner as unknown as { modelAvailability: { markDead: (m: string) => void } })
        .modelAvailability.markDead('opus');
      (runner as unknown as { modelAvailability: { markDead: (m: string) => void } })
        .modelAvailability.markDead('sonnet');

      const result = await runner.run('build', emptyState);

      expect(result.success).toBe(false);
    });

    it('interactive dispatch substitutes a live model when the configured one is dead', async () => {
      const invoke = vi.fn().mockResolvedValue({ success: true, output: '', exitCode: 0 });
      const provider: LLMProvider = {
        invoke,
      };
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        modelOverride: 'fable',
        mode: 'auto',
      });
      (runner as unknown as { modelAvailability: { markDead: (m: string) => void } })
        .modelAvailability.markDead('fable');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // explore is collaborative (not in AUTONOMOUS_STEPS) → invoke()
      await runner.run('explore', emptyState);

      expect(invoke).toHaveBeenCalledOnce();
      const opts = invoke.mock.calls[0][0] as InvokeOptions;
      expect(opts.model).toBe('opus');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Downgraded from fable to opus'),
      );
      warnSpy.mockRestore();
    });

    it('does not dispatch a collaborative step when its dead model has no live fallback', async () => {
      const invoke = vi.fn().mockResolvedValue({ success: true, output: '', exitCode: 0 });
      const provider: LLMProvider = {
        invoke,
      };
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        modelOverride: 'fable',
        mode: 'auto',
      });
      const availability = (runner as unknown as {
        modelAvailability: { markDead: (model: string) => void };
      }).modelAvailability;
      availability.markDead('fable');
      availability.markDead('opus');
      availability.markDead('sonnet');

      const result = await runner.run('explore', emptyState);

      expect(result.success).toBe(false);
      expect(invoke).not.toHaveBeenCalled();
    });
  });

  // ── build_review one-shot grader dispatch (jstoup111/ai-conductor#324, Task 11) ──
  // build_review is a fresh, isolated grader session — never resumes the
  // conductor's own session (constructor sessionId 'session-1'). Follows the
  // resolveRebaseConflict one-shot pattern (step-runners.ts:594-610).
  describe('build_review one-shot dispatch', () => {
    let dir: string;
    let planPath: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'build-review-runner-'));
      planPath = join(dir, 'plan.md');
      await writeFile(planPath, '# Plan\n\nDo the thing.\n', 'utf-8');
    });

    it.each(['claude', 'codex'] as const)('correlates build-review provider attempts with the owning execution on %s', async (providerKey) => {
      const executionContext: ExecutionContext = {
        executionId: 'review-execution', subject: { kind: 'lifecycle-step', step: 'build_review' },
      };
      const attempts: ProviderAttemptEvent[] = [];
      const events = new ConductorEventEmitter();
      const spanExporter = new CapturingSpanExporter();
      const warnings: string[] = [];
      const visualizer = new OtelVisualizer(
        resolveOtelConfig({ otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } }, join(dir, '.pipeline')),
        { spanExporter, onWarning: (warning) => warnings.push(warning) },
      );
      visualizer.start(events);
      const invoke = vi.fn(async (options: InvokeOptions) => {
        options.spawnPermit?.();
        return { success: true, output: '{"findings":[]}', exitCode: 0, finalStructuredResult: { findings: [] } };
      });
      const runner = new DefaultStepRunner(createMockProvider(), 'correlation', dir, {
        gitRunner: scriptedGit(), planPath,
        buildReviewEffectiveResolver: async () => ({
          ok: true, feature: { version: 'v1', repository: dir, feature: 'correlation' },
          effective: {
            rawVerdict: 'PASS', verdict: 'PASS', acceptedFindingIds: [], unresolvedFindingIds: [],
            suppressedFindingIds: [], skippedRubrics: ['testQuality'], infrastructureFailureRubrics: [],
            uncoveredInfrastructureFailureRubrics: [],
          },
        }),
        ...currentBuildReviewProof(),
        config: { llm_provider: providerKey, build_review: {
          enabled: true, rubrics: { testQuality: { enabled: false }, security: { enabled: true, llm_provider: providerKey }, implementationQuality: { enabled: false } },
        } } as HarnessConfig,
        providerRuntimes: new ProviderRuntimeSet([interactiveRuntime(providerKey, invoke)]),
        sessionStore: new ProviderSessionStore(), configuredProviders: [providerKey],
        buildReviewPolicyCatalog: async () => [{
          semanticName: 'build-review-security', source: 'project', installationOrigin: '/fixture/project',
          canonicalSkillPath: '/fixture/project/SKILL.md', packageRoot: '/fixture/project',
          declaredDependencies: [], availability: 'available',
        }],
        buildReviewPolicyCapture: async (policy) => ({
          policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md',
          manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Build review security\n') }],
          metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] },
          digest: `sha256-v1:${'a'.repeat(64)}`,
        }),
        providerAttempt: async (step, attempt) => {
          const event: ProviderAttemptEvent = { type: 'provider_attempt', step, ...attempt };
          attempts.push(event);
          await events.emit(event);
        },
      });

      try {
        await events.emit({ type: 'step_started', step: 'build_review', index: 0, executionContext });
        const result = await runner.run('build_review', { complexity_tier: 'M' }, { executionContext });
        expect(result.success, JSON.stringify(result)).toBe(true);
        await events.emit({ type: 'step_completed', step: 'build_review', status: 'done', executionContext });
      } finally {
        await visualizer.stop();
      }

      expect(warnings).toEqual([]);
      expect(spanExporter.getFinishedSpans().find((span) => span.name === 'build_review')?.attributes)
        .toMatchObject({ 'conductor.provider': providerKey, 'conductor.complexity_tier': 'M' });
      expect(attempts.some((attempt) => attempt.invoked)).toBe(true);
      expect(attempts.filter((attempt) => attempt.lifecycle).map((attempt) => attempt.lifecycle!.phase))
        .toEqual(['preparing', 'running', 'settled']);
      for (const attempt of attempts) expect(attempt.executionContext).toEqual(executionContext);
    });

    it('routes an expired counterfactual deadline to the guarded scoped-run timeout without launching', async () => {
      const launcher = vi.fn<BuildReviewScopedLauncher>(() => {
        throw new Error('the expired deadline must prevent launch');
      });
      const runner = new DefaultStepRunner(createMockProvider(), 'session-1', dir, {
        config: { test_suite: { scoped_command: 'npm test -- {selectors}' } } as HarnessConfig,
        buildReviewScopedLauncher: launcher,
      });
      const controller = new AbortController();
      controller.abort();

      const result = await (runner as unknown as {
        runScopedTautologyCommand(cwd: string, selectors: readonly string[], signal: AbortSignal): Promise<{
          kind: 'timeout'; stdout: string; stderr: string;
        }>;
      }).runScopedTautologyCommand('/counterfactual', ['test/engine/example.test.ts'], controller.signal);

      expect(launcher).not.toHaveBeenCalled();
      expect(result).toEqual({ kind: 'timeout', stdout: '', stderr: '' });
      expect(scopedRunFailure(result)).toBe('scoped-run-timeout');
    });

    it('retains one public build_review step while delegating fan-out orchestration without a legacy provider call', async () => {
      const provider = createMockProvider();
      const coordinate = vi.fn(async () => ({ success: true, output: 'five rubric branches settled' }));
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scriptedGit(), planPath,
        buildReviewCoordinator: coordinate,
        buildReviewInputOptions: {
          inspectTestSuite: async () => ({
            status: 'CURRENT', evidence: { provenanceHeadSha: 'head', outcome: 'PASS' },
          } as never),
        },
      });

      await expect(runner.run('build_review', emptyState)).resolves.toMatchObject({
        success: true, output: 'five rubric branches settled',
      });
      expect(coordinate).toHaveBeenCalledOnce();
      expect(provider.invoke).not.toHaveBeenCalled();
    });

    it.each([
      ['failed', false, 'review failed: missing coverage'],
      ['passed', true, 'review passed'],
    ])('places a containment advisory around %s review output without changing its success result', async (_caseName, success, reviewOutput) => {
      const provider = createMockProvider();
      const warnings: string[] = [];
      const coordinate = vi.fn(async () => ({ success, output: reviewOutput }));
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scriptedGit(),
        planPath,
        config: { build_review: { scopeContainmentEnforced: true } } as HarnessConfig,
        buildReviewCoordinator: coordinate,
        log: (message) => warnings.push(message),
        ...currentBuildReviewProof(),
      });

      const result = await runner.run('build_review', emptyState);

      expect(result.success).toBe(success);
      const advisory =
        'Advisory: containment-floor: git repository check failed: fatal: not a git repository (or any of the parent directories): .git.';
      expect(result.output).toContain(advisory);
      expect(result.output?.startsWith(success
        ? advisory
        : reviewOutput)).toBe(true);
      expect(warnings).toEqual([
        `WARNING: ${advisory}`,
      ]);
      expect(coordinate).toHaveBeenCalledOnce();
    });

    it('leaves coordinator output untouched when containment is off or non-string', async () => {
      const provider = createMockProvider();
      const coordinator = vi.fn()
        .mockResolvedValueOnce({ success: false, output: 'review failed: untouched' })
        .mockResolvedValueOnce({ success: false });
      const withoutContainment = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scriptedGit(), planPath, buildReviewCoordinator: coordinator, ...currentBuildReviewProof(),
      });
      const withNonStringOutput = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scriptedGit(), planPath,
        config: { build_review: { scopeContainmentEnforced: true } } as HarnessConfig,
        buildReviewCoordinator: coordinator, ...currentBuildReviewProof(),
      });

      await expect(withoutContainment.run('build_review', emptyState)).resolves.toMatchObject({
        success: false, output: 'review failed: untouched',
      });
      const nonStringResult = await withNonStringOutput.run('build_review', emptyState);
      expect(nonStringResult.success).toBe(false);
      expect('output' in nonStringResult).toBe(false);
    });

    it('empty-passes opted-in test quality when no feature plan resolves', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scriptedGit(),
        ...testQualityOptIn(),
      });

      await expect(runner.run('build_review', emptyState)).resolves.toMatchObject({
        success: true,
        output: expect.stringContaining('test_quality_empty_scope'),
      });
      expect(provider.invoke).not.toHaveBeenCalled();
      await expect(readFile(join(dir, '.pipeline/build-review.json'), 'utf8')).resolves.toContain(
        '"reason": "test_quality_empty_scope"',
      );
    });

    it('refuses an unresolvable plan corpus before publishing a verdict or dispatching a provider', async () => {
      const invoke = vi.fn();
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await writeFile(join(dir, '.docs', 'plans', 'another-feature.md'), '# Another plan\n');
      await writeFile(join(dir, '.docs', 'plans', 'unrelated-work.md'), '# Unrelated plan\n');
      const runner = new DefaultStepRunner({ invoke }, 'session-1', dir, {
        featureDesc: 'this-feature-has-no-plan',
        gitRunner: scriptedGit(),
        ...testQualityOptIn(),
      });

      const result = await runner.run('build_review', emptyState);

      expect(result).toMatchObject({
        success: false,
        refusal: {
          kind: 'needs-human',
          reason: expect.stringContaining('this-feature-has-no-plan'),
        },
      });
      expect(result.refusal?.reason).toContain('another-feature');
      expect(result.refusal?.reason).toContain('unrelated-work');
      await expect(access(join(dir, '.pipeline', 'build-review.json'))).rejects.toThrow();
      expect(invoke).not.toHaveBeenCalled();
    });

    it('uses an explicit plan override over an otherwise unresolvable plan corpus', async () => {
      const provider = createMockProvider();
      const coordinate = vi.fn(async () => ({ success: true, output: 'reviewed explicit plan' }));
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await writeFile(join(dir, '.docs', 'plans', 'another-feature.md'), '# Another plan\n');
      await writeFile(join(dir, '.docs', 'plans', 'unrelated-work.md'), '# Unrelated plan\n');
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        featureDesc: 'this-feature-has-no-plan',
        planPath,
        gitRunner: scriptedGit(),
        buildReviewCoordinator: coordinate,
        ...currentBuildReviewProof(),
      });

      await expect(runner.run('build_review', emptyState)).resolves.toMatchObject({
        success: true,
        output: 'reviewed explicit plan',
      });
      expect(coordinate).toHaveBeenCalledOnce();
    });

    it.each([
      { name: 'a singleton plan', plans: ['this-feature-has-no-plan.md'] },
      { name: 'a stem-matched plan in a multi-plan corpus', plans: ['another-feature.md', 'this-feature-has-no-plan.md'] },
    ])('reviews $name instead of empty-passing', async ({ plans }) => {
      const provider = createMockProvider();
      const coordinate = vi.fn(async () => ({ success: true, output: 'reviewed resolved plan' }));
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await Promise.all(plans.map((name) => writeFile(join(dir, '.docs', 'plans', name), '# Plan\n')));
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        featureDesc: 'this-feature-has-no-plan',
        gitRunner: scriptedGit('.docs/plans/this-feature-has-no-plan.md'),
        buildReviewCoordinator: coordinate,
        ...currentBuildReviewProof(),
      });

      await expect(runner.run('build_review', emptyState)).resolves.toMatchObject({
        success: true,
        output: 'reviewed resolved plan',
      });
      expect(coordinate).toHaveBeenCalledOnce();
      await expect(access(join(dir, '.pipeline', 'build-review.json'))).rejects.toThrow();
    });

    it('publishes the no-rubrics PASS when no plan files exist', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', dir, { gitRunner: scriptedGit() });

      await expect(runner.run('build_review', emptyState)).resolves.toMatchObject({
        success: true,
        output: expect.stringContaining('build_review_no_rubrics'),
      });
      await expect(readFile(join(dir, '.pipeline/build-review.json'), 'utf8')).resolves.toContain(
        '"reason": "build_review_no_rubrics"',
      );
      expect(provider.invoke).not.toHaveBeenCalled();
    });

    // Covers: task:8, task:9
    it('passes resolved and live act sources into the runner frontier', async () => {
      const provider = createMockProvider();
      const config = resolveBuildReviewConfig({
        build_review: {
          enabled: true,
          rubrics: { testQuality: { enabled: false }, security: { enabled: false }, implementationQuality: { enabled: true } },
        },
      } as HarnessConfig, CLAUDE_POLICY);
      const entry = config.catalog.find((candidate) => candidate.id === 'implementationQuality')!;
      const hunk = deriveChangedFileReferences([
        'diff --git a/src/example.ts b/src/example.ts',
        '@@ -1 +1 @@',
        '-export const value = false;',
        '+export const value = true;',
      ].join('\n'))[0]!.hunks[0]!;
      const finding = {
        concernKind: 'duplication' as const,
        severity: 'major' as const,
        summary: 'The revised branch duplicates the existing implementation.',
        evidenceLocations: ['src/example.ts:1'],
        anchor: { rubric: 'implementationQuality' as const, locus: { path: 'src/example.ts', contentHash: hunk.contentHash, display: 'value' } },
      };
      const findingId = canonicalizeBuildReviewFindingIdentity({
        rubric: 'implementationQuality', contractVersion: 'v4', concernKind: finding.concernKind, anchor: finding.anchor,
      })!.id;
      const sourceId = `implementationQuality:${findingId}`;
      const engineIdentity = {
        engineStamp: 'engine-a',
        skillDigests: { implementationQuality: { kind: 'resolved' as const, digest: 'sha256:bundle-a' } },
      };
      const descriptor = getBuildReviewRubricDescriptor('implementationQuality').contract;
      const policyIdentity = buildReviewPolicyIdentity('implementationQuality', {
        contractVersion: descriptor.output.version,
        projectionVersion: descriptor.projection.version,
        declarationFingerprint: `sha256:${createHash('sha256').update(JSON.stringify(entry.policy)).digest('hex')}`,
        effectiveBundleDigest: 'sha256:bundle-a',
        provider: Array.isArray(entry.policy.llm_provider) ? entry.policy.llm_provider.join(',') : entry.policy.llm_provider,
        model: entry.policy.model,
        effort: entry.policy.effort,
        engineStamp: engineIdentity.engineStamp,
      });
      await mkdir(join(dir, '.pipeline', 'build-review', 'lap-prior'), { recursive: true });
      await writeFile(join(dir, '.pipeline', 'build-review', 'lap-prior', 'implementationQuality.json'), JSON.stringify({
        version: 2,
        rubric: 'implementationQuality',
        lapId: 'lap-prior',
        snapshotDigest: 'sha256:prior',
        provenance: { kind: 'fresh' },
        result: {
          kind: 'judged', rubric: 'implementationQuality', lapId: 'lap-prior', snapshotDigest: 'sha256:prior',
          contractVersion: 'v4', findings: [finding], verdict: 'FAIL',
        },
        reviewScope: {
          mode: 'full', reason: 'first-lap', sequence: 1, unreadableLapIds: [], mergeBase: 'base', headSha: 'prior',
          policyIdentity, reviewedHunks: [{ path: 'src/example.ts', contentHash: hunk.contentHash }],
          deltaHunks: [{ path: 'src/example.ts', contentHash: hunk.contentHash }], outOfDeltaSourceIds: [],
        },
      }));
      const runner = new DefaultStepRunner(provider, 'session-1', dir, { config: {} as HarnessConfig });
      vi.spyOn(runner as any, 'resolveBuildReviewEngineIdentity').mockResolvedValue(engineIdentity);
      vi.spyOn(runner as any, 'resolvedAppliedBuildReviewActSourceIds').mockResolvedValue(new Set([sourceId]));
      let observedScope: unknown;
      vi.mocked(coordinateBuildReviewRubrics).mockImplementationOnce(async (input) => {
        observedScope = input.reviewScopes?.implementationQuality;
        throw new Error('expected frontier observation');
      });

      await expect((runner as any).runRubricBuildReviewInner({
        sourceSnapshot: {
          digest: 'sha256:current', mergeBase: 'base', headSha: 'current', diff: [
            'diff --git a/src/example.ts b/src/example.ts', '@@ -1 +1 @@',
            '-export const value = false;', '+export const value = true;',
          ].join('\n'),
        },
      }, config, 'M', 'plan.md')).rejects.toThrow('expected frontier observation');

      expect(observedScope).toMatchObject({ mode: 'delta', deltaHunks: [] });

      vi.spyOn(runner as any, 'liveBuildReviewActSourceIds').mockResolvedValue({
        unappliedLiveSourceIds: new Set([sourceId]), appliedLiveSourceIds: new Set(),
      });
      observedScope = undefined;
      vi.mocked(coordinateBuildReviewRubrics).mockImplementationOnce(async (input) => {
        observedScope = input.reviewScopes?.implementationQuality;
        throw new Error('expected live frontier observation');
      });

      await expect((runner as any).runRubricBuildReviewInner({
        sourceSnapshot: {
          digest: 'sha256:current', mergeBase: 'base', headSha: 'current', diff: [
            'diff --git a/src/example.ts b/src/example.ts', '@@ -1 +1 @@',
            '-export const value = false;', '+export const value = true;',
          ].join('\n'),
        },
      }, config, 'M', 'plan.md')).rejects.toThrow('expected live frontier observation');

      expect(observedScope).toMatchObject({ mode: 'delta', deltaHunks: [{ path: 'src/example.ts', contentHash: hunk.contentHash }] });

      observedScope = undefined;
      vi.mocked(coordinateBuildReviewRubrics).mockImplementationOnce(async (input) => {
        observedScope = input.reviewScopes?.implementationQuality;
        throw new Error('expected unmapped frontier observation');
      });
      await expect((runner as any).runRubricBuildReviewInner({
        sourceSnapshot: {
          digest: 'sha256:unmapped', mergeBase: 'base', headSha: 'unmapped', diff: [
            'diff --git a/src/other.ts b/src/other.ts', '@@ -1 +1 @@',
            '-export const other = false;', '+export const other = true;',
          ].join('\n'),
        },
      }, config, 'M', 'plan.md')).rejects.toThrow('expected unmapped frontier observation');
      expect(observedScope).toMatchObject({ mode: 'full', reason: 'open-source-unmapped' });
    });

    // Covers: task:8, task:11
    it('settles a custom prior finding into an empty delta after its candidate resolves the policy identity', async () => {
      const provider = createMockProvider();
      const config = resolveBuildReviewConfig({
        build_review: {
          enabled: true,
          rubrics: { testQuality: { enabled: false }, security: { enabled: false }, implementationQuality: { enabled: false } },
          custom_rubrics: {
            portable: { enabled: true, skill: 'portable-policy', question: 'Check the portable contract.', source: 'project', llm_provider: 'claude' },
          },
        },
      } as HarnessConfig, CLAUDE_POLICY);
      const entry = customCatalogEntry(config);
      const diff = [
        'diff --git a/src/custom.ts b/src/custom.ts', '@@ -1 +1 @@',
        '-export const portable = false;', '+export const portable = true;',
      ].join('\n');
      const hunk = deriveChangedFileReferences(diff)[0]!.hunks[0]!;
      const engineIdentity = { engineStamp: 'engine-a', skillDigests: {} };
      const declaration = {
        version: 'v1' as const, rubricId: entry.id, semanticSkill: entry.skill,
        question: entry.question, source: 'project' as const, resources: entry.resources,
      };
      const stamp = {
        rubric: entry.id, lapId: 'lap-prior', declaration,
        policy: { version: 'v1' as const, bundleDigest: `sha256:${'a'.repeat(64)}` },
        candidate: { provider: 'claude', model: entry.policy.model, effort: entry.policy.effort },
        reviewedInput: { version: 'v1' as const, contentDigest: `sha256:${'b'.repeat(64)}` },
      };
      const references = {
        sourceRegions: [{ path: 'src/custom.ts', startLine: 1, endLine: 1, contentHash: hunk.contentHash, display: 'custom hunk' }],
      };
      const judged = stampBuildReviewCustomJudgedResult({
        kind: 'custom-findings', version: 'v2', findings: [{
          concernId: 'portable-policy-gap', summary: 'The changed boundary lacks portability evidence.', severity: 'major',
          evidenceLocations: ['src/custom.ts:1'], sourceRegions: references.sourceRegions,
        }],
      }, stamp, references)!;
      const policyIdentity = buildReviewPolicyIdentity(entry.id, {
        contractVersion: entry.contract.output.version,
        projectionVersion: entry.contract.projection.version,
        declarationFingerprint: `sha256:${createHash('sha256').update(JSON.stringify({ skill: entry.skill, question: entry.question, resources: entry.resources })).digest('hex')}`,
        effectiveBundleDigest: stamp.policy.bundleDigest,
        provider: Array.isArray(entry.policy.llm_provider) ? entry.policy.llm_provider.join(',') : entry.policy.llm_provider,
        model: entry.policy.model, effort: entry.policy.effort, engineStamp: engineIdentity.engineStamp,
      });
      await mkdir(join(dir, '.pipeline', 'build-review', 'lap-prior'), { recursive: true });
      await writeFile(join(dir, '.pipeline', 'build-review', 'lap-prior', 'portable.json'), JSON.stringify({
        version: 2, rubric: entry.id, lapId: 'lap-prior', snapshotDigest: 'sha256:prior', provenance: { kind: 'fresh' },
        descriptor: {
          version: 'v1', semanticSkill: entry.skill, declaration,
          installation: { source: 'project' }, effectivePolicy: stamp.policy,
          reviewedInput: stamp.reviewedInput, producer: stamp.candidate,
        },
        result: judged,
        reviewScope: {
          mode: 'full', reason: 'first-lap', sequence: 1, unreadableLapIds: [], mergeBase: 'base', headSha: 'prior', policyIdentity,
          reviewedHunks: [{ path: 'src/custom.ts', contentHash: hunk.contentHash }],
          deltaHunks: [{ path: 'src/custom.ts', contentHash: hunk.contentHash }], outOfDeltaSourceIds: [],
        },
      }));
      const baselinePath = join(dir, 'baseline');
      const headPath = join(dir, 'head');
      await Promise.all([mkdir(baselinePath), mkdir(headPath)]);
      const capture: NonNullable<StepRunnerOptions['buildReviewPolicyCapture']> = vi.fn(async (policy) => ({
        policy, materialPath: '/fixture/material', definitionPath: '/fixture/material/SKILL.md',
        manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# policy bundle') }],
        metadata: { version: 1 as const, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] },
        digest: stamp.policy.bundleDigest,
      }));
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        config: {} as HarnessConfig,
        providerRuntimes: new ProviderRuntimeSet([{
          key: 'claude',
          provider: {
            lifecycleCapability: { synchronousSpawnPermit: true },
            nativeSchemaCapability: { nativeOutputSchema: true },
            invoke: provider.invoke,
          },
          lifecycleCapability: { synchronousSpawnPermit: true },
          nativeSchemaCapability: { nativeOutputSchema: true },
          policy: CLAUDE_POLICY,
          builtIn: true,
          availability: new ModelAvailability(CLAUDE_POLICY.modelFallbackLadder),
        }]),
        sessionStore: new ProviderSessionStore(),
        configuredProviders: ['claude'],
        probeReadOnlyReviewCapability: async ({ provider: providerKey, platform }) => ({ provider: providerKey, platform, status: 'available' as const }),
        buildReviewPolicyCatalog: async () => [{
          semanticName: entry.skill, source: 'project', installationOrigin: '/fixture/policy',
          canonicalSkillPath: '/fixture/policy/SKILL.md', packageRoot: '/fixture/policy', declaredDependencies: [], availability: 'available',
        }],
        buildReviewPolicyCapture: capture,
        buildReviewEffectiveResolver: async () => ({
          ok: true as const,
          feature: { version: 'v1' as const, repository: dir, feature: 'custom-settlement' },
          effective: {
            rawVerdict: 'PASS' as const, verdict: 'PASS' as const, acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [],
            skippedRubrics: ['portable'], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [], uncoveredScopeIncompleteRubrics: [],
          },
        }) as never,
      });
      vi.spyOn(runner as any, 'resolveBuildReviewEngineIdentity').mockResolvedValue(engineIdentity);
      vi.spyOn(runner as any, 'resolvedAppliedBuildReviewActSourceIds').mockResolvedValue(
        new Set([`${entry.id}:${judged.findings[0]!.identity.id}`]),
      );
      vi.spyOn(runner as any, 'dispatchInstalledBuildReviewPolicy').mockImplementation((async (...args: unknown[]) => {
        const resolveScope = args[11] as ((policyIdentity: string) => Promise<unknown>) | undefined;
        await resolveScope?.(policyIdentity);
        return { id: entry.id, success: true, member: { declaration, result: { kind: 'scope-empty' as const, rubric: entry.id } } };
      }) as any);

      await expect((runner as any).runRubricBuildReviewInner({
        sourceSnapshot: {
          digest: 'sha256:current', contentDigest: `sha256:${'c'.repeat(64)}`, mergeBase: 'base', headSha: 'current', diff,
        },
        sourceMaterialization: {
          source: {
            identity: { snapshotDigest: 'sha256:current', contentDigest: `sha256:${'c'.repeat(64)}`, mergeBase: 'base', headSha: 'current' },
            baselinePath, headPath,
          },
          contextFor: (memberId: string) => ({ memberId, source: {
            identity: { snapshotDigest: 'sha256:current', contentDigest: `sha256:${'c'.repeat(64)}`, mergeBase: 'base', headSha: 'current' },
            baselinePath, headPath,
          } }),
          settle: async () => {}, finish: async () => {},
        },
      }, config, 'M', 'plan.md')).resolves.toMatchObject({ success: true });

      expect(capture).not.toHaveBeenCalled();
      expect(provider.invoke).not.toHaveBeenCalled();
    });

    // Covers: task:rem-prd-audit-6-r1
    it('uses the candidate-resolved custom policy identity for a version-changed lap', async () => {
      const provider = createMockProvider();
      const config = resolveBuildReviewConfig({
        build_review: {
          enabled: true,
          rubrics: { testQuality: { enabled: false }, security: { enabled: false }, implementationQuality: { enabled: false } },
          custom_rubrics: {
            portable: { enabled: true, skill: 'portable-policy', question: 'Check the portable contract.', source: 'project', llm_provider: 'claude' },
          },
        },
      } as HarnessConfig, CLAUDE_POLICY);
      const entry = customCatalogEntry(config);
      const diff = [
        'diff --git a/src/custom.ts b/src/custom.ts', '@@ -1 +1 @@',
        '-export const portable = false;', '+export const portable = true;',
      ].join('\n');
      const hunk = deriveChangedFileReferences(diff)[0]!.hunks[0]!;
      const engineIdentity = { engineStamp: 'engine-a', skillDigests: {} };
      const declaration = {
        version: 'v1' as const, rubricId: entry.id, semanticSkill: entry.skill,
        question: entry.question, source: 'project' as const, resources: entry.resources,
      };
      const priorBundleDigest = `sha256:${'a'.repeat(64)}`;
      const currentBundleDigest = `sha256:${'b'.repeat(64)}`;
      const stamp = {
        rubric: entry.id, lapId: 'lap-prior', declaration,
        policy: { version: 'v1' as const, bundleDigest: priorBundleDigest },
        candidate: { provider: 'claude', model: entry.policy.model, effort: entry.policy.effort },
        reviewedInput: { version: 'v1' as const, contentDigest: `sha256:${'c'.repeat(64)}` },
      };
      const judged = stampBuildReviewCustomJudgedResult(
        { kind: 'custom-findings', version: 'v2', findings: [] }, stamp, { sourceRegions: [] },
      )!;
      const priorPolicyIdentity = buildReviewPolicyIdentity(entry.id, {
        contractVersion: entry.contract.output.version,
        projectionVersion: entry.contract.projection.version,
        declarationFingerprint: `sha256:${createHash('sha256').update(JSON.stringify({ skill: entry.skill, question: entry.question, resources: entry.resources })).digest('hex')}`,
        effectiveBundleDigest: priorBundleDigest,
        provider: Array.isArray(entry.policy.llm_provider) ? entry.policy.llm_provider.join(',') : entry.policy.llm_provider,
        model: entry.policy.model, effort: entry.policy.effort, engineStamp: engineIdentity.engineStamp,
      });
      await mkdir(join(dir, '.pipeline', 'build-review', 'lap-prior'), { recursive: true });
      await writeFile(join(dir, '.pipeline', 'build-review', 'lap-prior', 'portable.json'), JSON.stringify({
        version: 2, rubric: entry.id, lapId: 'lap-prior', snapshotDigest: 'sha256:prior', provenance: { kind: 'fresh' },
        descriptor: {
          version: 'v1', semanticSkill: entry.skill, declaration,
          installation: { source: 'project' }, effectivePolicy: stamp.policy,
          reviewedInput: stamp.reviewedInput, producer: stamp.candidate,
        },
        result: judged,
        reviewScope: {
          mode: 'full', reason: 'first-lap', sequence: 1, unreadableLapIds: [], mergeBase: 'base', headSha: 'prior', policyIdentity: priorPolicyIdentity,
          reviewedHunks: [{ path: 'src/custom.ts', contentHash: hunk.contentHash }],
          deltaHunks: [{ path: 'src/custom.ts', contentHash: hunk.contentHash }], outOfDeltaSourceIds: [],
        },
      }));
      const capture: NonNullable<StepRunnerOptions['buildReviewPolicyCapture']> = vi.fn(async (policy) => ({
        policy, materialPath: '/fixture/material', definitionPath: '/fixture/material/SKILL.md',
        manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# changed policy bundle') }],
        metadata: { version: 1 as const, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] },
        digest: currentBundleDigest,
      }));
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        config: {} as HarnessConfig,
        buildReviewPolicyCatalog: async () => [{
          semanticName: entry.skill, source: 'project', installationOrigin: '/fixture/policy',
          canonicalSkillPath: '/fixture/policy/SKILL.md', packageRoot: '/fixture/policy', declaredDependencies: [], availability: 'available',
        }],
        buildReviewPolicyCapture: capture,
        buildReviewEffectiveResolver: async () => ({
          ok: true as const,
          feature: { version: 'v1' as const, repository: dir, feature: 'custom-policy-version-change' },
          effective: {
            rawVerdict: 'PASS' as const, verdict: 'PASS' as const, acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [],
            skippedRubrics: ['portable'], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [], uncoveredScopeIncompleteRubrics: [],
          },
        }) as never,
      });
      vi.spyOn(runner as any, 'resolveBuildReviewEngineIdentity').mockResolvedValue(engineIdentity);
      let observedScope: unknown;
      vi.spyOn(runner as any, 'dispatchInstalledBuildReviewPolicy').mockImplementation(async (...args: any[]) => {
        const reviewScope = args[8];
        const resolveReviewScope = args[11] as (policyIdentity: string) => Promise<unknown>;
        expect(reviewScope).toBeUndefined();
        const currentPolicyIdentity = buildReviewPolicyIdentity(entry.id, {
          contractVersion: entry.contract.output.version,
          projectionVersion: entry.contract.projection.version,
          declarationFingerprint: `sha256:${createHash('sha256').update(JSON.stringify({ skill: entry.skill, question: entry.question, resources: entry.resources })).digest('hex')}`,
          effectiveBundleDigest: currentBundleDigest,
          provider: 'claude', model: entry.policy.model, effort: entry.policy.effort, engineStamp: engineIdentity.engineStamp,
        });
        observedScope = await resolveReviewScope(currentPolicyIdentity);
        return {
          id: entry.id, success: true,
          member: { declaration, result: { kind: 'scope-empty' as const, rubric: entry.id } },
        };
      });

      await expect((runner as any).runRubricBuildReviewInner({
        sourceSnapshot: {
          digest: 'sha256:current', contentDigest: `sha256:${'d'.repeat(64)}`, mergeBase: 'base', headSha: 'current', diff,
        },
      }, config, 'M', 'plan.md')).resolves.toMatchObject({ success: true });

      expect(capture).not.toHaveBeenCalled();
      expect(observedScope).toMatchObject({ mode: 'full', reason: 'version-changed' });
    });

    // Covers: task:rem-as-built-6-r6
    it('does not prefetch a custom policy identity before candidate dispatch', async () => {
      const provider = createMockProvider();
      const config = resolveBuildReviewConfig({
        build_review: {
          enabled: true,
          rubrics: { testQuality: { enabled: false }, security: { enabled: false }, implementationQuality: { enabled: false } },
          custom_rubrics: {
            portable: { enabled: true, skill: 'portable-policy', question: 'Check the portable contract.', source: 'project', llm_provider: 'claude' },
          },
        },
      } as HarnessConfig, CLAUDE_POLICY);
      const entry = customCatalogEntry(config);
      const diff = [
        'diff --git a/src/custom.ts b/src/custom.ts', '@@ -1 +1 @@',
        '-export const portable = false;', '+export const portable = true;',
      ].join('\n');
      const hunk = deriveChangedFileReferences(diff)[0]!.hunks[0]!;
      const engineIdentity = { engineStamp: 'engine-a', skillDigests: {} };
      const declaration = {
        version: 'v1' as const, rubricId: entry.id, semanticSkill: entry.skill,
        question: entry.question, source: 'project' as const, resources: entry.resources,
      };
      const priorBundleDigest = `sha256:${'a'.repeat(64)}`;
      const stamp = {
        rubric: entry.id, lapId: 'lap-prior', declaration,
        policy: { version: 'v1' as const, bundleDigest: priorBundleDigest },
        candidate: { provider: 'claude', model: entry.policy.model, effort: entry.policy.effort },
        reviewedInput: { version: 'v1' as const, contentDigest: `sha256:${'b'.repeat(64)}` },
      };
      const judged = stampBuildReviewCustomJudgedResult(
        { kind: 'custom-findings', version: 'v2', findings: [] }, stamp, { sourceRegions: [] },
      )!;
      const unavailablePolicyIdentity = buildReviewPolicyIdentity(entry.id, {
        contractVersion: entry.contract.output.version,
        projectionVersion: entry.contract.projection.version,
        declarationFingerprint: `sha256:${createHash('sha256').update(JSON.stringify({ skill: entry.skill, question: entry.question, resources: entry.resources })).digest('hex')}`,
        effectiveBundleDigest: 'unavailable',
        provider: Array.isArray(entry.policy.llm_provider) ? entry.policy.llm_provider.join(',') : entry.policy.llm_provider,
        model: entry.policy.model, effort: entry.policy.effort, engineStamp: engineIdentity.engineStamp,
      });
      await mkdir(join(dir, '.pipeline', 'build-review', 'lap-prior'), { recursive: true });
      await writeFile(join(dir, '.pipeline', 'build-review', 'lap-prior', 'portable.json'), JSON.stringify({
        version: 2, rubric: entry.id, lapId: 'lap-prior', snapshotDigest: 'sha256:prior', provenance: { kind: 'fresh' },
        descriptor: {
          version: 'v1', semanticSkill: entry.skill, declaration,
          installation: { source: 'project' }, effectivePolicy: stamp.policy,
          reviewedInput: stamp.reviewedInput, producer: stamp.candidate,
        },
        result: judged,
        reviewScope: {
          mode: 'full', reason: 'first-lap', sequence: 1, unreadableLapIds: [], mergeBase: 'base', headSha: 'prior', policyIdentity: unavailablePolicyIdentity,
          reviewedHunks: [{ path: 'src/custom.ts', contentHash: hunk.contentHash }],
          deltaHunks: [{ path: 'src/custom.ts', contentHash: hunk.contentHash }], outOfDeltaSourceIds: [],
        },
      }));
      const catalog = vi.fn().mockRejectedValueOnce(new Error('preliminary catalog unavailable'));
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        config: {} as HarnessConfig,
        buildReviewPolicyCatalog: catalog,
        buildReviewEffectiveResolver: async () => ({
          ok: true as const,
          feature: { version: 'v1' as const, repository: dir, feature: 'custom-policy-identity-unavailable' },
          effective: {
            rawVerdict: 'PASS' as const, verdict: 'PASS' as const, acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [],
            skippedRubrics: ['portable'], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [], uncoveredScopeIncompleteRubrics: [],
          },
        }) as never,
      });
      vi.spyOn(runner as any, 'resolveBuildReviewEngineIdentity').mockResolvedValue(engineIdentity);
      let observedScope: unknown;
      vi.spyOn(runner as any, 'dispatchInstalledBuildReviewPolicy').mockImplementation(async (...args: any[]) => {
        const reviewScope = args[8];
        const resolveReviewScope = args[11] as (policyIdentity: string) => Promise<unknown>;
        expect(reviewScope).toBeUndefined();
        const candidatePolicyIdentity = buildReviewPolicyIdentity(entry.id, {
          contractVersion: entry.contract.output.version,
          projectionVersion: entry.contract.projection.version,
          declarationFingerprint: `sha256:${createHash('sha256').update(JSON.stringify({ skill: entry.skill, question: entry.question, resources: entry.resources })).digest('hex')}`,
          effectiveBundleDigest: `sha256:${'b'.repeat(64)}`,
          provider: 'claude', model: entry.policy.model, effort: entry.policy.effort, engineStamp: engineIdentity.engineStamp,
        });
        observedScope = await resolveReviewScope(candidatePolicyIdentity);
        return {
          id: entry.id, success: true,
          member: { declaration, result: { kind: 'scope-empty' as const, rubric: entry.id } },
        };
      });

      await expect((runner as any).runRubricBuildReviewInner({
        sourceSnapshot: {
          digest: 'sha256:current', contentDigest: `sha256:${'c'.repeat(64)}`, mergeBase: 'base', headSha: 'current', diff,
        },
      }, config, 'M', 'plan.md')).resolves.toMatchObject({ success: true });

      expect(catalog).not.toHaveBeenCalled();
      expect(observedScope).toMatchObject({ mode: 'full', reason: 'version-changed' });
    });

    it('persists the fallback candidate policy identity and reuses it for the next delta lap', async () => {
      const provider = createMockProvider();
      const config = resolveBuildReviewConfig({
        build_review: {
          enabled: true,
          rubrics: { testQuality: { enabled: false }, security: { enabled: false }, implementationQuality: { enabled: false } },
          custom_rubrics: {
            portable: {
              enabled: true, skill: 'portable-policy', question: 'Check the portable contract.', source: 'project',
              llm_provider: ['pi', 'claude'], max_retries: 1,
            },
          },
        },
      } as HarnessConfig, CLAUDE_POLICY);
      const entry = customCatalogEntry(config);
      const diff = [
        'diff --git a/src/custom.ts b/src/custom.ts', '@@ -1 +1 @@',
        '-export const portable = false;', '+export const portable = true;',
      ].join('\n');
      const hunk = deriveChangedFileReferences(diff)[0]!.hunks[0]!;
      const engineIdentity = { engineStamp: 'engine-a', skillDigests: {} };
      const bundleA = `sha256:${'a'.repeat(64)}`;
      const bundleB = `sha256:${'b'.repeat(64)}`;
      const preliminaryIdentity = buildReviewPolicyIdentity(entry.id, {
        contractVersion: entry.contract.output.version, projectionVersion: entry.contract.projection.version,
        declarationFingerprint: `sha256:${createHash('sha256').update(JSON.stringify({ skill: entry.skill, question: entry.question, resources: entry.resources })).digest('hex')}`,
        effectiveBundleDigest: bundleA, provider: 'pi,claude', model: entry.policy.model,
        effort: entry.policy.effort, engineStamp: engineIdentity.engineStamp,
      });
      const baselinePath = join(dir, 'baseline');
      const headPath = join(dir, 'head');
      await Promise.all([mkdir(baselinePath), mkdir(headPath)]);
      const claudeInvoke = vi.fn(async (_options: InvokeOptions): Promise<InvokeResult> => ({
        success: true, output: JSON.stringify({ kind: 'custom-findings', version: 'v2', findings: [] }), exitCode: 0,
        finalStructuredResult: { kind: 'custom-findings', version: 'v2', findings: [] },
      }));
      const runtime = (key: 'pi' | 'claude', invoke: LLMProvider['invoke']) => ({
        key, provider: { lifecycleCapability: { synchronousSpawnPermit: true as const }, nativeSchemaCapability: { nativeOutputSchema: true as const }, invoke },
        lifecycleCapability: { synchronousSpawnPermit: true as const }, nativeSchemaCapability: { nativeOutputSchema: true as const },
        policy: CLAUDE_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_POLICY.modelFallbackLadder),
      });
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        config: {} as HarnessConfig, providerRuntimes: new ProviderRuntimeSet([runtime('pi', vi.fn()), runtime('claude', claudeInvoke)]),
        sessionStore: new ProviderSessionStore(), configuredProviders: ['pi', 'claude'],
        buildReviewPolicyCatalog: async ({ provider: catalogProvider }) => [{
          semanticName: entry.skill, source: 'project', installationOrigin: `/fixture/${catalogProvider}`,
          canonicalSkillPath: `/fixture/${catalogProvider}/SKILL.md`, packageRoot: `/fixture/${catalogProvider}`,
          declaredDependencies: [], availability: 'available',
        }],
        buildReviewPolicyCapture: async (policy) => ({
          policy, materialPath: `/fixture/material/${policy.packageRoot.endsWith('/pi') ? 'a' : 'b'}`,
          definitionPath: `/fixture/material/${policy.packageRoot.endsWith('/pi') ? 'a' : 'b'}/SKILL.md`,
          manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# policy') }],
          metadata: { version: 1 as const, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] },
          digest: policy.packageRoot.endsWith('/pi') ? bundleA : bundleB,
        }),
        buildReviewEffectiveResolver: async () => ({
          ok: true as const, feature: { version: 'v1' as const, repository: dir, feature: 'custom-policy-fallback-identity' },
          effective: {
            rawVerdict: 'PASS' as const, verdict: 'PASS' as const, acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [],
            skippedRubrics: ['portable'], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [], uncoveredScopeIncompleteRubrics: [],
          },
        }) as never,
      });
      vi.spyOn(runner as any, 'resolveBuildReviewEngineIdentity').mockResolvedValue(engineIdentity);

      const inputs = {
        sourceSnapshot: { digest: 'sha256:current', contentDigest: `sha256:${'d'.repeat(64)}`, mergeBase: 'base', headSha: 'current', diff },
        sourceMaterialization: {
          source: { identity: { snapshotDigest: 'sha256:current', contentDigest: `sha256:${'d'.repeat(64)}`, mergeBase: 'base', headSha: 'current' }, baselinePath, headPath },
          contextFor: (memberId: string) => ({ memberId, source: { identity: { snapshotDigest: 'sha256:current', contentDigest: `sha256:${'d'.repeat(64)}`, mergeBase: 'base', headSha: 'current' }, baselinePath, headPath } }),
          settle: async () => {}, finish: async () => {},
        },
      } as any;
      await (runner as any).dispatchInstalledBuildReviewPolicy(
        entry, inputs, 'lap-current', 'M', undefined,
        async (providerKey: string) => providerKey === 'pi'
          ? { provider: 'pi', platform: process.platform, status: 'unavailable', reason: 'fixture fallback' }
          : { provider: 'claude', platform: process.platform, status: 'available' },
        join(dir, '.pipeline'), undefined,
        {
          mode: 'delta', reason: 'delta', sequence: 2, unreadableLapIds: [], mergeBase: 'base', headSha: 'current',
          policyIdentity: preliminaryIdentity, predecessorLapId: 'lap-prior',
          reviewedHunks: [{ path: 'src/custom.ts', contentHash: hunk.contentHash }],
          deltaHunks: [{ path: 'src/custom.ts', contentHash: hunk.contentHash }], outOfDeltaSourceIds: [],
        },
      );

      const current = JSON.parse(await readFile(join(dir, '.pipeline', 'build-review', 'lap-current', 'portable.json'), 'utf8'));
      const actualIdentity = buildReviewPolicyIdentity(entry.id, {
        contractVersion: entry.contract.output.version, projectionVersion: entry.contract.projection.version,
        declarationFingerprint: `sha256:${createHash('sha256').update(JSON.stringify({ skill: entry.skill, question: entry.question, resources: entry.resources })).digest('hex')}`,
        effectiveBundleDigest: bundleB, provider: 'claude', model: current.descriptor.producer.model,
        effort: current.descriptor.producer.effort, engineStamp: engineIdentity.engineStamp,
      });
      let nextScope: unknown;
      vi.spyOn(runner as any, 'dispatchInstalledBuildReviewPolicy').mockImplementation(async (...args: any[]) => {
        const scope = args[8];
        const resolveReviewScope = args[11] as (policyIdentity: string) => Promise<unknown>;
        expect(scope).toBeUndefined();
        nextScope = await resolveReviewScope(actualIdentity);
        return { id: entry.id, success: true, member: { result: { kind: 'scope-empty' as const, rubric: entry.id } } };
      });
      await (runner as any).runRubricBuildReviewInner({
        ...inputs,
        sourceSnapshot: { ...inputs.sourceSnapshot, digest: 'sha256:next', headSha: 'next' },
      }, config, 'M', 'plan.md');
      vi.mocked((runner as any).dispatchInstalledBuildReviewPolicy).mockRestore();
      await (runner as any).dispatchInstalledBuildReviewPolicy(
        entry,
        {
          sourceSnapshot: { digest: 'sha256:open-source', contentDigest: `sha256:${'d'.repeat(64)}`, mergeBase: 'base', headSha: 'open-source', diff },
          sourceMaterialization: {
            source: { identity: { snapshotDigest: 'sha256:open-source', contentDigest: `sha256:${'d'.repeat(64)}`, mergeBase: 'base', headSha: 'open-source' }, baselinePath, headPath },
            contextFor: (memberId: string) => ({ memberId, source: { identity: { snapshotDigest: 'sha256:open-source', contentDigest: `sha256:${'d'.repeat(64)}`, mergeBase: 'base', headSha: 'open-source' }, baselinePath, headPath } }),
            settle: async () => {}, finish: async () => {},
          },
        },
        'lap-open-source', 'M', undefined,
        async (providerKey: string) => providerKey === 'pi'
          ? { provider: 'pi', platform: process.platform, status: 'unavailable', reason: 'fixture fallback' }
          : { provider: 'claude', platform: process.platform, status: 'available' },
        join(dir, '.pipeline'), undefined,
        {
          mode: 'full', reason: 'open-source-unmapped', sequence: 3, unreadableLapIds: [], mergeBase: 'base', headSha: 'open-source',
          policyIdentity: preliminaryIdentity, predecessorLapId: 'lap-current',
          reviewedHunks: [{ path: 'src/custom.ts', contentHash: hunk.contentHash }],
          deltaHunks: [{ path: 'src/custom.ts', contentHash: hunk.contentHash }], outOfDeltaSourceIds: [],
        },
      );
      const openSource = JSON.parse(await readFile(join(dir, '.pipeline', 'build-review', 'lap-open-source', 'portable.json'), 'utf8'));
      expect(claudeInvoke).toHaveBeenCalledOnce();
      expect(current.descriptor).toMatchObject({ effectivePolicy: { bundleDigest: bundleB }, producer: { provider: 'claude' } });
      expect(current.reviewScope).toMatchObject({
        mode: 'full', reason: 'version-changed', policyIdentity: actualIdentity,
      });
      // The fallback lap persisted Claude's actual identity. Re-resolving that
      // same candidate is compatible evidence, so only a delta is needed.
      expect(nextScope).toMatchObject({ mode: 'delta', reason: 'delta', policyIdentity: actualIdentity });
      expect(openSource.reviewScope).toMatchObject({
        mode: 'full', reason: 'version-changed', policyIdentity: actualIdentity,
      });
    });

    // Covers: task:2, task:6, task:9, task:rem-as-built-rem-2, task:rem-as-built-rem-5
    it('uses compatible current test-scope resolutions for the frontier and policy identity', async () => {
      const provider = createMockProvider();
      const config = resolveBuildReviewConfig({
        build_review: {
          enabled: true,
          rubrics: { testQuality: { enabled: true }, security: { enabled: false }, implementationQuality: { enabled: false } },
        },
      } as HarnessConfig, CLAUDE_POLICY);
      const entry = config.catalog.find((candidate) => candidate.id === 'testQuality')!;
      const diff = [
        'diff --git a/src/example.ts b/src/example.ts', '@@ -1 +1 @@',
        '-export const value = false;', '+export const value = true;',
        '@@ -10 +10 @@', '-export const other = false;', '+export const other = true;',
      ].join('\n');
      const [resolvedHunk, indeterminateHunk] = deriveChangedFileReferences(diff)[0]!.hunks;
      const candidates = [
        { id: 'candidate-resolved', source: { fileName: 'src/example.ts', side: 'head' as const }, region: { start: 0, end: 1 } },
        { id: 'candidate-current', source: { fileName: 'src/example.ts', side: 'head' as const }, region: { start: 2, end: 3 } },
      ];
      const testScope = { candidates: candidates.map((candidate) => ({
        source: candidate.source, declaration: { span: candidate.region }, markers: [], associationChanges: [], reasons: ['uncertain-association'],
      })) };
      const engineIdentity = {
        engineStamp: 'engine-a', skillDigests: { testQuality: { kind: 'resolved' as const, digest: 'sha256:bundle-a' } },
      };
      const descriptor = getBuildReviewRubricDescriptor('testQuality').contract;
      const policyIdentity = buildReviewPolicyIdentity('testQuality', {
        contractVersion: descriptor.output.version, projectionVersion: descriptor.projection.version,
        declarationFingerprint: `sha256:${createHash('sha256').update(JSON.stringify(entry.policy)).digest('hex')}`,
        effectiveBundleDigest: 'sha256:bundle-a',
        provider: Array.isArray(entry.policy.llm_provider) ? entry.policy.llm_provider.join(',') : entry.policy.llm_provider,
        model: entry.policy.model, effort: entry.policy.effort, engineStamp: engineIdentity.engineStamp,
        testScope: {
          analysisVersion: 'test-scope-v2',
          bindingIdentity: `sha256:${createHash('sha256').update(JSON.stringify(candidates.map((candidate) => candidate.id).sort())).digest('hex')}`,
        },
      });
      await mkdir(join(dir, '.pipeline', 'build-review', 'lap-prior'), { recursive: true });
      await writeFile(join(dir, '.pipeline', 'build-review', 'lap-prior', 'testQuality.json'), JSON.stringify({
        version: 2, rubric: 'testQuality', lapId: 'lap-prior', snapshotDigest: 'sha256:prior', provenance: { kind: 'fresh' },
        result: {
          kind: 'judged', rubric: 'testQuality', lapId: 'lap-prior', snapshotDigest: 'sha256:prior', contractVersion: 'v4', findings: [], verdict: 'PASS',
          scopeResolutions: [{
            candidateId: 'candidate-resolved', status: 'indeterminate', missingEvidenceReason: 'pinned source unreadable',
            sourceRegion: { path: 'src/example.ts', startLine: 1, endLine: 1, contentHash: resolvedHunk!.contentHash, display: 'covered test' },
            obligationReferences: ['task:1'],
          }],
        },
        reviewScope: {
          mode: 'full', reason: 'first-lap', sequence: 1, unreadableLapIds: [], mergeBase: 'base', headSha: 'prior', policyIdentity,
          reviewedHunks: [resolvedHunk, indeterminateHunk].map((hunk) => ({ path: 'src/example.ts', contentHash: hunk!.contentHash })), deltaHunks: [resolvedHunk, indeterminateHunk].map((hunk) => ({ path: 'src/example.ts', contentHash: hunk!.contentHash })), outOfDeltaSourceIds: [],
        },
      }));
      await mkdir(join(dir, '.pipeline', 'build-review', 'lap-resolved'), { recursive: true });
      await writeFile(join(dir, '.pipeline', 'build-review', 'lap-resolved', 'testQuality.json'), JSON.stringify({
        version: 2, rubric: 'testQuality', lapId: 'lap-resolved', snapshotDigest: 'sha256:resolved', provenance: { kind: 'fresh' },
        result: {
          kind: 'judged', rubric: 'testQuality', lapId: 'lap-resolved', snapshotDigest: 'sha256:resolved', contractVersion: 'v4', findings: [], verdict: 'PASS',
          scopeResolutions: [
            { candidateId: 'candidate-resolved', status: 'resolved', sourceRegion: { path: 'src/example.ts', startLine: 1, endLine: 1, contentHash: resolvedHunk!.contentHash, display: 'covered test' }, obligationReferences: ['task:1'], associationReason: 'The candidate is now covered.' },
            { candidateId: 'candidate-current', status: 'indeterminate', missingEvidenceReason: 'pinned source unreadable', sourceRegion: { path: 'src/example.ts', startLine: 10, endLine: 10, contentHash: indeterminateHunk!.contentHash, display: 'current test' }, obligationReferences: ['task:2'] },
          ],
        },
        reviewScope: {
          mode: 'full', reason: 'first-lap', sequence: 2, unreadableLapIds: [], mergeBase: 'base', headSha: 'resolved', policyIdentity,
          reviewedHunks: [resolvedHunk, indeterminateHunk].map((hunk) => ({ path: 'src/example.ts', contentHash: hunk!.contentHash })), deltaHunks: [resolvedHunk, indeterminateHunk].map((hunk) => ({ path: 'src/example.ts', contentHash: hunk!.contentHash })), outOfDeltaSourceIds: [],
        },
      }));
      const runner = new DefaultStepRunner(provider, 'session-1', dir, { config: {} as HarnessConfig });
      vi.spyOn(runner as any, 'resolveBuildReviewEngineIdentity').mockResolvedValue(engineIdentity);
      let observedScope: unknown;
      vi.mocked(coordinateBuildReviewRubrics).mockImplementationOnce(async (input) => {
        observedScope = input.reviewScopes?.testQuality;
        throw new Error('expected unknown frontier observation');
      });

      await expect((runner as any).runRubricBuildReviewInner({
        sourceSnapshot: {
          digest: 'sha256:current', mergeBase: 'base', headSha: 'current',
          diff, testScopeAnalysisVersion: 'test-scope-v2', testScope, testScopeEvidence: candidates,
        },
      }, config, 'M', 'plan.md')).rejects.toThrow('expected unknown frontier observation');

      expect(observedScope).toMatchObject({ mode: 'delta', deltaHunks: [{ path: 'src/example.ts', contentHash: indeterminateHunk!.contentHash }] });

      observedScope = undefined;
      vi.mocked(coordinateBuildReviewRubrics).mockImplementationOnce(async (input) => {
        observedScope = input.reviewScopes?.testQuality;
        throw new Error('expected stale unknown to be ignored');
      });

      await expect((runner as any).runRubricBuildReviewInner({
        sourceSnapshot: { digest: 'sha256:version-changed', mergeBase: 'base', headSha: 'version-changed', diff, testScope, testScopeEvidence: candidates, testScopeAnalysisVersion: 'test-scope-v3' },
      }, config, 'M', 'plan.md')).rejects.toThrow('expected stale unknown to be ignored');
      expect(observedScope).toMatchObject({ mode: 'full', reason: 'version-changed' });

      observedScope = undefined;
      vi.mocked(coordinateBuildReviewRubrics).mockImplementationOnce(async (input) => {
        observedScope = input.reviewScopes?.testQuality;
        throw new Error('expected child-local frontier observation');
      });

      await expect((runner as any).runRubricBuildReviewInner({
        sourceSnapshot: { digest: 'sha256:binding-changed', mergeBase: 'base', headSha: 'binding-changed', diff, testScope, testScopeEvidence: [...candidates.slice(0, 1), { ...candidates[1]!, id: 'candidate-rebound' }], testScopeAnalysisVersion: 'test-scope-v2' },
      }, config, 'M', 'plan.md')).rejects.toThrow('expected child-local frontier observation');

      expect(observedScope).toMatchObject({ mode: 'full', reason: 'version-changed' });

      observedScope = undefined;
      vi.mocked(coordinateBuildReviewRubrics).mockImplementationOnce(async (input) => {
        observedScope = input.reviewScopes?.testQuality;
        throw new Error('expected sibling child frontier isolation');
      });
      await mkdir(join(dir, '.pipeline', 'children', '2', 'build-review', 'lap-sibling'), { recursive: true });
      await writeFile(join(dir, '.pipeline', 'children', '2', 'build-review', 'lap-sibling', 'testQuality.json'), JSON.stringify({
        version: 2, rubric: 'testQuality', lapId: 'lap-sibling', snapshotDigest: 'sha256:sibling', provenance: { kind: 'fresh' },
        result: { kind: 'judged', rubric: 'testQuality', lapId: 'lap-sibling', snapshotDigest: 'sha256:sibling', contractVersion: 'v4', findings: [], verdict: 'PASS' },
        reviewScope: { mode: 'full', reason: 'first-lap', sequence: 1, unreadableLapIds: [], mergeBase: 'base', headSha: 'sibling', policyIdentity, reviewedHunks: [resolvedHunk, indeterminateHunk].map((hunk) => ({ path: 'src/example.ts', contentHash: hunk!.contentHash })), deltaHunks: [resolvedHunk, indeterminateHunk].map((hunk) => ({ path: 'src/example.ts', contentHash: hunk!.contentHash })), outOfDeltaSourceIds: [] },
      }));
      await expect((runner as any).runRubricBuildReviewInner({
        sourceSnapshot: { digest: 'sha256:child-current', mergeBase: 'base', headSha: 'child-current', diff, testScope, testScopeEvidence: candidates, testScopeAnalysisVersion: 'test-scope-v2' },
      }, config, 'M', 'plan.md', undefined, undefined, parseChildId('1'))).rejects.toThrow('expected sibling child frontier isolation');

      expect(observedScope).toMatchObject({ mode: 'full', reason: 'first-lap' });
    });

    // #3317: a branch that commits a root `node_modules` symlink must not make
    // the preflight's own root dependency link fail with EEXIST.
    it.each([
      ['an untracked root dependency path', false],
      ['a tracked root node_modules symlink', true],
    ])('materializes checkout-local dependencies before uuid- and execa-importing counterfactual selectors run with %s', async (_case, tracksRootDependencyLink) => {
      const repository = await mkdtemp(join(tmpdir(), 'build-review-checkout-dependencies-'));
      const featureRoot = join(repository, '.worktrees', 'feature');
      const selector = 'src/conductor/spec/example.test.mjs';
      const sourceDependencies = join(featureRoot, 'src/conductor/node_modules');
      const selectorMarker = join(repository, 'counterfactual-selector-ran');
      const selectorMarkerEnv = 'BUILD_REVIEW_COUNTERFACTUAL_SELECTOR_MARKER';
      const priorSelectorMarker = process.env[selectorMarkerEnv];
      let checkoutRoot: string | undefined;
      const observedProjections: Array<{ preflight: { classification: string; excerpt: string } }> = [];
      const observedPrompts: string[] = [];
      try {
        await execa('git', ['init', '-q', '-b', 'main'], { cwd: repository });
        await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: repository });
        await execa('git', ['config', 'user.name', 'Test'], { cwd: repository });
        await execa('git', ['config', 'commit.gpgsign', 'false'], { cwd: repository });
        await writeFile(join(repository, '.gitignore'), '.pipeline/\nnode_modules/\n');
        await mkdir(join(repository, 'src/conductor/src'), { recursive: true });
        await mkdir(join(repository, 'src/conductor/spec'), { recursive: true });
        await mkdir(join(repository, '.docs/plans'), { recursive: true });
        await writeFile(join(repository, '.docs/plans/feature.md'), `### Task 1: distinguish the selector\n**Files:** ${selector}\n`);
        await writeFile(join(repository, 'src/conductor/src/example.mjs'), 'export const answer = 1;\n');
        await writeFile(join(repository, selector), "import { v4 as uuidv4 } from 'uuid';\nimport { answer } from '../src/example.mjs';\nif (!uuidv4() || answer !== 1) process.exit(1);\n");
        await execa('git', ['add', '.'], { cwd: repository });
        await execa('git', ['commit', '-q', '-m', 'base behavior'], { cwd: repository });
        await execa('git', ['remote', 'add', 'origin', repository], { cwd: repository });
        await execa('git', ['update-ref', 'refs/remotes/origin/main', 'refs/heads/main'], { cwd: repository });
        await execa('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], { cwd: repository });
        await mkdir(join(repository, '.worktrees'), { recursive: true });
        await execa('git', ['worktree', 'add', '-q', '-b', 'feature/proof', featureRoot], { cwd: repository });
        await writeFile(join(featureRoot, 'src/conductor/src/example.mjs'), 'export const answer = 2;\n');
        await writeFile(join(featureRoot, selector), "import { writeFile } from 'node:fs/promises';\nimport { v4 as uuidv4 } from 'uuid';\nimport { execa } from 'execa';\nimport { answer } from '../src/example.mjs';\nfunction it(_title, body) { body(); }\n// Covers: task:1\nit('loads checkout dependencies', () => { if (!uuidv4() || !execa || answer !== 2) { writeFile(process.env.BUILD_REVIEW_COUNTERFACTUAL_SELECTOR_MARKER, 'selector-loaded-checkout-dependencies').then(() => process.exit(1)); } });\n");
        await execa('git', ['add', 'src/conductor'], { cwd: featureRoot });
        if (tracksRootDependencyLink) {
          await symlink('src/conductor/node_modules', join(featureRoot, 'node_modules'));
          await execa('git', ['add', 'node_modules'], { cwd: featureRoot });
        }
        await execa('git', ['commit', '-q', '-m', 'change behavior and selector'], { cwd: featureRoot });
        await mkdir(join(sourceDependencies, 'uuid'), { recursive: true });
        await writeFile(join(sourceDependencies, 'uuid/package.json'), '{"name":"uuid","type":"module","exports":"./index.mjs"}\n');
        await writeFile(join(sourceDependencies, 'uuid/index.mjs'), "export function v4() { return 'fixture-uuid'; }\n");
        await mkdir(join(sourceDependencies, 'execa'), { recursive: true });
        await writeFile(join(sourceDependencies, 'execa/package.json'), '{"name":"execa","type":"module","exports":"./index.mjs"}\n');
        await writeFile(join(sourceDependencies, 'execa/index.mjs'), 'export function execa() {}\n');

        const provider: LLMProvider = {
          invoke: vi.fn(async (options) => {
            const projection = JSON.parse(options.prompt.split('\n\n').at(-1)!) as typeof observedProjections[number];
            observedProjections.push(projection);
            observedPrompts.push(options.prompt);
            const scopeContext = JSON.parse(options.prompt.match(/Candidate-resolution authority \(use only these ids, regions, and obligations\):\n(\{[\s\S]*?\})\n\nYour final/)![1]);
            const payload = {
              findings: [],
              scopeResolutions: scopeContext.candidates.map((candidate: any) => ({
                candidateId: candidate.candidateId,
                status: 'resolved',
                sourceRegion: candidate.sourceRegion,
                obligationReferences: candidate.obligationReferences,
                associationReason: 'The pinned declaration is a test target.',
              })),
            };
            return { success: true, exitCode: 0, output: JSON.stringify(payload), finalStructuredResult: payload };
          }),
        };
        // AB-1 (Task 20): every shared-`.git` worktree mutation the preflight
        // issues must flow through the dispatcher-owned lifecycle queue, so a
        // concurrent slug's add/remove/prune can never overlap it.
        let queueDepth = 0;
        const queuedMutations: string[] = [];
        const worktreeLifecycle = new WorktreeLifecycleQueue();
        const originalRun = worktreeLifecycle.run.bind(worktreeLifecycle);
        worktreeLifecycle.run = (operation) => originalRun(async () => {
          queueDepth += 1;
          try { return await operation(); } finally { queueDepth -= 1; }
        });
        const gitRunner = async (args: string[]) => {
          if (args[0] === 'worktree' && (args[1] === 'add' || args[1] === 'remove')) {
            queuedMutations.push(queueDepth > 0 ? `${args[1]}:queued` : `${args[1]}:unqueued`);
          }
          if (args[0] === 'worktree' && args[1] === 'add') checkoutRoot = args[3];
          if (args[0] === 'worktree' && args[1] === 'remove') return { exitCode: 0, stdout: '', stderr: '' };
          const result = await execa('git', args, { cwd: featureRoot, reject: false });
          return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr };
        };
        const head = (await execa('git', ['rev-parse', 'HEAD'], { cwd: featureRoot })).stdout;
        process.env[selectorMarkerEnv] = selectorMarker;
        const runner = new DefaultStepRunner(provider, 'checkout-proof', featureRoot, {
          gitRunner,
          worktreeLifecycle,
          planPath: join(featureRoot, '.docs/plans/feature.md'),
          pipelineDir: join(featureRoot, '.pipeline'),
          config: { test_suite: { scoped_command: 'node {selectors}' }, build_review: {
            enabled: true,
            rubrics: { testQuality: { enabled: true }, security: { enabled: false }, implementationQuality: { enabled: false } },
          } } as HarnessConfig,
          buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: { provenanceHeadSha: head, outcome: 'PASS', fingerprint: 'proof' } } as never) },
        });

        await expect(runner.run('build_review', emptyState)).resolves.toMatchObject({ success: true });
        expect(checkoutRoot).toBe(join(featureRoot, '.pipeline', 'build-review-preflight', head));
        const checkoutDependencies = join(checkoutRoot!, 'src/conductor/node_modules');
        expect((await lstat(checkoutDependencies)).isSymbolicLink()).toBe(true);
        expect(await realpath(checkoutDependencies)).toBe(await realpath(sourceDependencies));
        const checkoutCommandDependencies = join(checkoutRoot!, 'node_modules');
        expect((await lstat(checkoutCommandDependencies)).isSymbolicLink()).toBe(true);
        expect(await realpath(checkoutCommandDependencies)).toBe(await realpath(sourceDependencies));
        expect(await readFile(selectorMarker, 'utf8')).toBe('selector-loaded-checkout-dependencies');
        // The preflight reaches the grader as typed evidence only: its
        // classification plus a bounded excerpt, never a verdict.
        expect(observedProjections[0]).toMatchObject({ preflight: { classification: 'nonzero-exit' } });
        expect(typeof observedProjections[0].preflight.excerpt).toBe('string');
        expect(queuedMutations).toEqual(['add:queued', 'remove:queued']);
        // The grader is told each status's validator-required fields, so a
        // `resolved` copy of the authority cannot omit `associationReason`.
        expect(observedPrompts[0]).toContain('`resolved` requires `sourceRegion` and `obligationReferences` copied verbatim from that candidate in the authority (a non-empty subset of its obligations, no duplicates) plus a non-blank `associationReason`; `out-of-scope` requires a non-blank `exclusionReason`; `indeterminate` requires a non-blank `missingEvidenceReason`.');
      } finally {
        if (priorSelectorMarker === undefined) delete process.env[selectorMarkerEnv];
        else process.env[selectorMarkerEnv] = priorSelectorMarker;
        await rm(repository, { recursive: true, force: true });
      }
    });

    it('writes the raw aggregate but returns and emits the shared effective verdict', async () => {
      await scopedPlan();
      const provider = createMockProvider();
      const events = { emit: vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: '', exitCode: 0 })) } as any;
      let rawAggregate: unknown;
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scopedTestGit(), planPath, events,
        buildReviewArtifactReader: async (_projectRoot, rubric, lapId, snapshotDigest, _fs) => ({
          version: 1,
          rubric,
          lapId,
          snapshotDigest,
          provenance: { kind: 'fresh' as const },
          result: {
            kind: 'judged' as const,
            rubric,
            lapId,
            snapshotDigest,
            contractVersion: 'v4' as never,
            findings: [{
              concernKind: 'test-insensitive', severity: 'major', summary: 'The changed test does not observe the behavior it should.',
              evidenceLocations: ['x:1'],
              anchor: { rubric: 'testQuality', locus: SCOPED_TEST_REGION },
            }],
            verdict: 'FAIL' as const,
          },
        }),
        buildReviewEffectiveResolver: vi.fn(async (_projectRoot, aggregate) => {
          rawAggregate = aggregate;
          return {
            ok: true as const,
            feature: { version: 'v1' as const, repository: '/repo', feature: 'feature' },
            effective: {
              rawVerdict: 'FAIL' as const, verdict: 'PASS' as const, acceptedFindingIds: ['accepted'], unresolvedFindingIds: [], suppressedFindingIds: [],
              skippedRubrics: [], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [],
            },
          };
        }),
        ...scopedTestQualityOptIn(),
        ...currentBuildReviewProof(),
      });
      vi.spyOn(runner as any, 'dispatchBuildReviewRubric').mockImplementation(async (branch: any, projection: any) => ({
        kind: 'judged', rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
        contractVersion: 'v4',
        findings: [{
          concernKind: 'test-insensitive', severity: 'major', summary: 'The changed test does not observe the behavior it should.',
          evidenceLocations: ['x:1'],
          anchor: { rubric: 'testQuality', locus: SCOPED_TEST_REGION },
        }],
        verdict: 'FAIL',
      }));

      await expect(runner.run('build_review', emptyState)).resolves.toMatchObject({ success: true });
      expect(JSON.parse(await readFile(join(dir, '.pipeline/build-review.json'), 'utf8'))).toMatchObject(rawAggregate as object);
      expect(events.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'build_review_outer_verdict', rawVerdict: 'FAIL', effectiveVerdict: 'PASS',
      }));
    });

    // adr-2026-08-29 D4.4 keeps a fully suppressed lap out of post-join
    // judgement: the runner returns success, so the conductor's adjudication
    // branch — the coordinator that used to be the only suppression writer —
    // is never entered. D4.6 still requires the durable entry, so the seam
    // must run here, before that pass/fail fork.
    it('persists durable suppression entries on a fully suppressed lap that never reaches adjudication', async () => {
      await scopedPlan();
      const provider = createMockProvider();
      const events = { emit: vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: '', exitCode: 0 })) } as any;
      const feature = { version: 'v1' as const, repository: '/repo', feature: 'feature' };
      let suppressedFindingId: string | undefined;
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scopedTestGit(), planPath, events,
        config: {
          test_suite: { scoped_command: 'exit 1' },
          build_review: { enabled: true, rubrics: { testQuality: { enabled: true, min_confidence: 70 }, security: { enabled: false }, implementationQuality: { enabled: false } } },
        } as HarnessConfig,
        buildReviewEffectiveResolver: vi.fn(async (_projectRoot, aggregate) => {
          suppressedFindingId = projectBuildReviewAggregateSources(aggregate as never)![0]!.findingId;
          return {
            ok: true as const,
            feature,
            effective: {
              rawVerdict: 'FAIL' as const, verdict: 'PASS' as const, acceptedFindingIds: [],
              unresolvedFindingIds: [], suppressedFindingIds: [suppressedFindingId],
              skippedRubrics: [], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [],
            },
          };
        }),
        ...currentBuildReviewProof(),
      });
      vi.spyOn(runner as any, 'dispatchBuildReviewRubric').mockImplementation(async (branch: any, projection: any) => ({
        kind: 'judged', rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
        contractVersion: 'v4',
        findings: [{
          concernKind: 'test-insensitive', severity: 'minor', summary: 'The changed test does not observe the behavior it should.',
          evidenceLocations: ['x:1'],
          anchor: { rubric: 'testQuality', locus: SCOPED_TEST_REGION },
          confidence: 40,
        }],
        verdict: 'FAIL',
      }));

      // `success: true` is exactly the route selector the conductor reads to
      // skip adjudication, so no remediate dispatch can follow this lap.
      await expect(runner.run('build_review', emptyState)).resolves.toMatchObject({ success: true });

      const persisted = await new RemediationCaseStore(dir, feature).read();
      if (!persisted.ok) throw new Error(`unexpected case-store failure: ${persisted.reason}`);
      expect(persisted.state.suppressions).toEqual([{
        kind: 'confidence',
        findingId: suppressedFindingId,
        rubric: 'testQuality',
        summary: 'The changed test does not observe the behavior it should.',
        confidence: 40,
        floor: 70,
        lastSeenLap: 'lap-head',
      }]);
    });

    it('publishes an empty registered-rubric set as a reasoned PASS when security and implementation quality opt out over the test-quality default', async () => {
      const provider = createMockProvider();
      const events = { emit: vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: '', exitCode: 0 })) } as any;
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scriptedGit(),
        planPath,
        events,
        config: {
          build_review: {
            rubrics: {
              security: { enabled: false },
              implementationQuality: { enabled: false },
            },
          },
        } as HarnessConfig,
        ...currentBuildReviewProof(),
      });
      const dispatch = vi.spyOn(runner as any, 'dispatchBuildReviewRubric');

      await expect(runner.run('build_review', emptyState)).resolves.toMatchObject({
        success: true,
        output: expect.stringContaining('build_review_no_rubrics'),
      });

      expect(dispatch).not.toHaveBeenCalled();
      expect(JSON.parse(await readFile(join(dir, '.pipeline/build-review.json'), 'utf8'))).toMatchObject({
        verdict: 'PASS',
        reason: 'build_review_no_rubrics',
        rubric: { testQuality: false },
      });
      expect(events.emit).toHaveBeenCalledWith({
        type: 'build_review_outer_verdict',
        lapId: 'lap-head',
        rawVerdict: 'PASS',
        effectiveVerdict: 'PASS',
        reason: 'build_review_no_rubrics',
      });
    });

    it('leaves a missing current-lap branch artifact absent until the mechanical allowance is exhausted', async () => {
      await scopedPlan();
      const provider = createMockProvider();
      const events = { emit: vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: '', exitCode: 0 })) } as any;
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scopedGit(), planPath, events,
        buildReviewArtifactReader: async () => undefined,
        ...testQualityOptIn(),
        ...currentBuildReviewProof(),
      });
      vi.spyOn(runner as any, 'dispatchBuildReviewRubric').mockImplementation(async (branch: any, projection: any) => ({
        kind: 'judged', rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
        contractVersion: 'v3', findings: [], verdict: 'PASS',
      }));

      await expect(runner.run('build_review', emptyState)).resolves.toMatchObject({ success: false });
      expect(events.emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'build_review_outer_verdict' }));
      await expect(readFile(join(dir, '.pipeline/build-review.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      expect(JSON.parse(await readFile(join(dir, '.pipeline/kickback-ledger.json'), 'utf8'))).toMatchObject({
        gates: { build_review: { mechanicalFaults: 1, cumulative: 0 } },
      });
    });

    it('withholds an aggregate for an all-infrastructure below-cap lap and reports its first closed failure', async () => {
      await scopedPlan();
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scopedGit(), planPath,
        ...testQualityOptIn(),
        ...currentBuildReviewProof(),
      });
      const dispatch = vi.spyOn(runner as any, 'dispatchBuildReviewRubric').mockImplementation(async (branch: any) => ({
        kind: 'dispatch-failure', detail: `${branch.rubric} omitted the required verdict`,
      }));

      const result = await runner.run('build_review', emptyState);
      expect(result).toMatchObject({
        success: false,
        currentLapMechanicalFault: true,
        output: 'build_review mechanical fault in testQuality (invalid-structured-result): invalid-structured-result: testQuality omitted the required verdict',
      });
      expect(dispatch.mock.calls.map(([branch]) => (branch as { rubric: string }).rubric)).toEqual([
        'testQuality',
      ]);
      await expect(readFile(join(dir, '.pipeline/build-review.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await readKickbackLedger(dir)).gates.build_review).toMatchObject({
        mechanicalFaults: 1,
        lastMechanicalFault: {
          rubric: 'testQuality',
          reason: 'invalid-structured-result',
          detail: 'invalid-structured-result: testQuality omitted the required verdict',
          lapId: 'lap-head',
        },
      });
    });

    it('persists a preflight materialization excerpt when the mechanical allowance is exhausted', async () => {
      await scopedPlan();
      const runner = new DefaultStepRunner(createMockProvider(), 'session-1', dir, {
        gitRunner: scopedGit(), planPath,
        ...testQualityOptIn(),
        ...currentBuildReviewProof(),
        buildReviewEffectiveResolver: vi.fn(async () => ({
          ok: true as const,
          feature: { version: 'v1' as const, repository: '/repo', feature: 'feature' },
          effective: {
            rawVerdict: 'FAIL' as const,
            verdict: 'FAIL' as const,
            acceptedFindingIds: [],
            unresolvedFindingIds: [],
            suppressedFindingIds: [],
            skippedRubrics: [],
            infrastructureFailureRubrics: ['testQuality'] as const,
            uncoveredInfrastructureFailureRubrics: ['testQuality'] as const,
          },
        })),
      });
      vi.spyOn(runner as any, 'runTautologyPreflight').mockResolvedValue({
        classification: 'infrastructure-failure', reason: 'materialization-failed', failureExcerpt: 'boom-checkout',
        changedPaths: [], changedTestSelectors: [], sourceIdentities: { mergeBase: 'abc123', headSha: 'head' },
      });

      await runner.run('build_review', emptyState);
      await runner.run('build_review', emptyState);
      await runner.run('build_review', emptyState);

      await expect(readFile(join(dir, '.pipeline/build-review.json'), 'utf8')).resolves.toContain(
        '"detail": "materialization-failed: boom-checkout"',
      );
    });

    it.each([
      {
        name: 'test-quality is enabled explicitly',
        config: {
          test_suite: { scoped_command: 'true' },
          build_review: { enabled: true, rubrics: { testQuality: { enabled: true }, security: { enabled: false }, implementationQuality: { enabled: false } } },
        } as HarnessConfig,
        expectedInvokeCalls: 1,
      },
      {
        name: 'test-quality uses its configured policy',
        config: {
          test_suite: { scoped_command: 'true' },
          build_review: {
            enabled: true,
            rubrics: { testQuality: { enabled: true, model: 'opus' }, security: { enabled: false }, implementationQuality: { enabled: false } },
          },
          wiring: { entry_points: ['src/index.ts'] },
        } as HarnessConfig,
        expectedInvokeCalls: 1,
      },
    ])('uses the production rubric coordinator when $name', async ({ config, expectedInvokeCalls }) => {
      await scopedPlan();
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scopedGit(),
        planPath,
        config,
        buildReviewInputOptions: {
          inspectTestSuite: async () => ({
            status: 'CURRENT', evidence: { provenanceHeadSha: 'head', outcome: 'PASS' },
          } as never),
        },
      });

      await runner.run('build_review', emptyState);

      expect(provider.invoke).toHaveBeenCalledTimes(expectedInvokeCalls);
      const prompts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls.map(([options]) => options.prompt);
      expect(prompts).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Build Review Test Quality rubric'),
        ]),
      );
      expect(prompts.join('\n')).not.toContain('Build Review Scope rubric');
    });

    it('dispatches implementation quality and security as the default rubrics', async () => {
      await scopedPlan();
      const invoke = vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => {
        const projection = JSON.parse(options.prompt.split('\n\n').at(-1)!);
        const result = {
          kind: 'judged', rubric: projection.rubric, lapId: projection.lapId,
          snapshotDigest: projection.snapshotDigest, contractVersion: 'v3', findings: [],
        };
        return { success: true, output: JSON.stringify(result), exitCode: 0, finalStructuredResult: result };
      });
      const runner = new DefaultStepRunner({ invoke }, 'session-1', dir, {
        gitRunner: scopedGit(),
        planPath,
        providerKey: 'codex',
        config: { llm_provider: 'codex', build_review: { enabled: true } } as HarnessConfig,
        providerRuntimes: new ProviderRuntimeSet([interactiveRuntime('codex', invoke)]),
        sessionStore: new ProviderSessionStore(),
        configuredProviders: ['codex'],
        buildReviewPolicyCatalog: async ({ skill }) => [{
          semanticName: skill, source: 'project', installationOrigin: '/fixture/project',
          canonicalSkillPath: `/fixture/project/${skill}/SKILL.md`, packageRoot: `/fixture/project/${skill}`,
          declaredDependencies: [], availability: 'available',
        }],
        buildReviewPolicyCapture: async (policy) => ({
          policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md',
          manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from(`# ${policy.semanticName}\n`) }],
          metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] },
          digest: `sha256-v1:${'a'.repeat(64)}`,
        }),
        ...currentBuildReviewProof(),
        buildReviewEffectiveResolver: async () => ({
          ok: true as const,
          feature: { version: 'v1' as const, repository: dir, feature: 'feature' },
          effective: {
            rawVerdict: 'PASS' as const,
            verdict: 'PASS' as const,
            acceptedFindingIds: [],
            unresolvedFindingIds: [],
            suppressedFindingIds: [],
            skippedRubrics: ['testQuality'] as const,
            infrastructureFailureRubrics: [],
            uncoveredInfrastructureFailureRubrics: [],
          },
        }),
      });

      const result = await runner.run('build_review', emptyState);
      expect(result.success, result.output).toBe(true);

      expect(invoke).toHaveBeenCalledTimes(2);
      const prompts = invoke.mock.calls.map(([options]) => options.prompt);
      expect(prompts.join('\n')).toContain('# build-review-implementation-quality');
      expect(prompts.join('\n')).toContain('# build-review-security');
      expect(prompts.join('\n')).not.toContain('Build Review Test Quality rubric');
    });

    it('dispatches only implementation quality when security is disabled and every other rubric uses its default', async () => {
      await scopedPlan();
      const invoke = vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => {
        const projection = JSON.parse(options.prompt.split('\n\n').at(-1)!);
        const result = {
          kind: 'judged', rubric: projection.rubric, lapId: projection.lapId,
          snapshotDigest: projection.snapshotDigest, contractVersion: 'v3', findings: [],
        };
        return { success: true, output: JSON.stringify(result), exitCode: 0, finalStructuredResult: result };
      });
      const runner = new DefaultStepRunner({ invoke }, 'session-1', dir, {
        gitRunner: scopedGit(), planPath, providerKey: 'codex',
        config: { llm_provider: 'codex', build_review: { enabled: true, rubrics: { security: { enabled: false } } } } as HarnessConfig,
        providerRuntimes: new ProviderRuntimeSet([interactiveRuntime('codex', invoke)]),
        sessionStore: new ProviderSessionStore(),
        configuredProviders: ['codex'],
        buildReviewPolicyCatalog: async ({ skill }) => [{
          semanticName: skill, source: 'project', installationOrigin: '/fixture/project',
          canonicalSkillPath: `/fixture/project/${skill}/SKILL.md`, packageRoot: `/fixture/project/${skill}`,
          declaredDependencies: [], availability: 'available',
        }],
        buildReviewPolicyCapture: async (policy) => ({
          policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md',
          manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from(`# ${policy.semanticName}\n`) }],
          metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] },
          digest: `sha256-v1:${'a'.repeat(64)}`,
        }),
        ...currentBuildReviewProof(),
        buildReviewEffectiveResolver: async () => ({
          ok: true as const,
          feature: { version: 'v1' as const, repository: dir, feature: 'feature' },
          effective: {
            rawVerdict: 'PASS' as const, verdict: 'PASS' as const, acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [],
            skippedRubrics: ['testQuality', 'security'] as const, infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [],
          },
        }),
      });

      await expect(runner.run('build_review', emptyState)).resolves.toMatchObject({
        success: true,
      });
      expect(invoke).toHaveBeenCalledTimes(1);
      const prompts = invoke.mock.calls.map(([options]) => options.prompt).join('\n');
      expect(prompts).toContain('# build-review-implementation-quality');
      expect(prompts).not.toContain('# build-review-security');
    });

    it('persists the exact dispatched rubric prompt beside the lap artifact for offline replay', async () => {
      await scopedPlan();
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scopedGit(),
        planPath,
        config: {
          test_suite: { scoped_command: 'true' },
          build_review: { enabled: true, rubrics: { testQuality: { enabled: true }, security: { enabled: false }, implementationQuality: { enabled: false } } },
        } as HarnessConfig,
        buildReviewInputOptions: {
          inspectTestSuite: async () => ({
            status: 'CURRENT', evidence: { provenanceHeadSha: 'head', outcome: 'PASS' },
          } as never),
        },
      });

      await runner.run('build_review', emptyState);

      const dispatched = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls
        .map(([options]) => options.prompt as string)
        .find((prompt) => prompt.includes('Build Review Test Quality rubric'));
      expect(dispatched).toBeDefined();
      const laps = await readdir(join(dir, '.pipeline/build-review'));
      const stored = await Promise.all(laps.filter((lap) => lap.startsWith('lap-')).map((lap) =>
        readFile(join(dir, '.pipeline/build-review', lap, 'testQuality.prompt.txt'), 'utf8').catch(() => undefined)));
      const prompt = stored.find((body) => body !== undefined);
      expect(prompt).toContain('Build Review Test Quality rubric');
      // The provider prompt only prefixes the skill command; the rest is byte-identical.
      expect(dispatched!.endsWith(prompt!)).toBe(true);
    });

    it('retains a rejected built-in reviewer response and links it from the infrastructure fault event', async () => {
      await scopedPlan();
      const provider = createMockProvider();
      const findings = [{ concernKind: 'test-insensitive' }];
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        exitCode: 0,
        output: 'reviewer final message',
        finalStructuredResult: { findings },
      });
      const events = new ConductorEventEmitter();
      const failures: Array<Extract<ConductorEvent, { type: 'build_review_rubric_infrastructure_failure' }>> = [];
      events.on('build_review_rubric_infrastructure_failure', (event) => {
        if (event.type === 'build_review_rubric_infrastructure_failure') failures.push(event);
      });
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        events,
        gitRunner: scopedGit(),
        planPath,
        ...testQualityOptIn(),
        ...currentBuildReviewProof(),
      });

      await runner.run('build_review', emptyState);

      expect(failures).toHaveLength(1);
      const failure = failures[0]!;
      const [lapId] = (await readdir(join(dir, '.pipeline/build-review'))).filter((lap) => lap.startsWith('lap-'));
      expect(lapId).toBeDefined();
      const retainedResponsePath = `.pipeline/build-review-rejections/${lapId}/testQuality.1.json`;
      const record = JSON.parse(await readFile(join(dir, retainedResponsePath), 'utf8'));
      const ledger = await readKickbackLedger(dir);

      expect(record).toMatchObject({
        version: 1,
        rubric: 'testQuality',
        rubricKind: 'builtin',
        attempt: 1,
        reason: 'invalid-structured-result',
        output: 'reviewer final message',
        structuredResult: { findings },
        detail: ledger.gates.build_review?.lastMechanicalFault?.detail,
        rejection: failure.rejection,
      });
      expect(failure.retainedResponsePath).toBe(retainedResponsePath);
    });

    it('keeps the built-in rejection fault outcome when response retention is unavailable', async () => {
      await scopedPlan();
      const findings = [{ concernKind: 'test-insensitive' }];
      const response = {
        success: true,
        exitCode: 0,
        output: 'reviewer final message',
        finalStructuredResult: { findings },
      };
      const baselineProvider = createMockProvider();
      (baselineProvider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(response);
      const baselineEvents = new ConductorEventEmitter();
      const baselineFailures: Array<Extract<ConductorEvent, { type: 'build_review_rubric_infrastructure_failure' }>> = [];
      baselineEvents.on('build_review_rubric_infrastructure_failure', (event) => {
        if (event.type === 'build_review_rubric_infrastructure_failure') baselineFailures.push(event);
      });
      const baselineRunner = new DefaultStepRunner(baselineProvider, 'session-1', dir, {
        events: baselineEvents,
        gitRunner: scopedGit(),
        planPath,
        ...testQualityOptIn(),
        ...currentBuildReviewProof(),
      });

      const baselineResult = await baselineRunner.run('build_review', emptyState);
      const baselineLedger = await readKickbackLedger(dir);
      const baselineFailure = baselineFailures[0]!;
      const blockedDir = await mkdtemp(join(tmpdir(), 'build-review-retention-blocked-'));
      try {
        const blockedPlanPath = join(blockedDir, 'plan.md');
        await scopedPlan(blockedPlanPath);
        await mkdir(join(blockedDir, '.pipeline'), { recursive: true });
        await writeFile(join(blockedDir, '.pipeline', 'build-review-rejections'), 'not a directory\n', 'utf-8');
        const blockedProvider = createMockProvider();
        (blockedProvider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(response);
        const blockedEvents = new ConductorEventEmitter();
        const blockedFailures: Array<Extract<ConductorEvent, { type: 'build_review_rubric_infrastructure_failure' }>> = [];
        blockedEvents.on('build_review_rubric_infrastructure_failure', (event) => {
          if (event.type === 'build_review_rubric_infrastructure_failure') blockedFailures.push(event);
        });
        const blockedRunner = new DefaultStepRunner(blockedProvider, 'session-1', blockedDir, {
          events: blockedEvents,
          gitRunner: scopedGit(),
          planPath: blockedPlanPath,
          ...testQualityOptIn(),
          ...currentBuildReviewProof(),
        });

        const blockedResult = await blockedRunner.run('build_review', emptyState);
        const blockedLedger = await readKickbackLedger(blockedDir);
        const blockedFailure = blockedFailures[0]!;

        expect(blockedResult.output).toBe(baselineResult.output);
        expect(blockedResult.currentLapMechanicalFault).toBe(true);
        expect({
          mechanicalFaults: blockedLedger.gates.build_review?.mechanicalFaults,
          lastMechanicalFault: blockedLedger.gates.build_review?.lastMechanicalFault,
        }).toEqual({
          mechanicalFaults: 1,
          lastMechanicalFault: baselineLedger.gates.build_review?.lastMechanicalFault,
        });
        expect({
          reason: blockedFailure.reason,
          cause: blockedFailure.cause,
          rejection: blockedFailure.rejection,
          excerpt: blockedFailure.excerpt,
        }).toEqual({
          reason: baselineFailure.reason,
          cause: baselineFailure.cause,
          rejection: baselineFailure.rejection,
          excerpt: baselineFailure.excerpt,
        });
        expect(blockedFailure).not.toHaveProperty('retainedResponsePath');
        await expect(access(join(blockedDir, '.pipeline/build-review.json'))).rejects.toThrow();
      } finally {
        await rm(blockedDir, { recursive: true, force: true });
      }
    });

    it('does not create a retention directory for an accepted test-quality judgment', async () => {
      await scopedPlan();
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        exitCode: 0,
        output: '{"findings":[]}',
        finalStructuredResult: { findings: [] },
      });
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scopedGit(),
        planPath,
        ...testQualityOptIn(),
        ...currentBuildReviewProof(),
      });

      const result = await runner.run('build_review', emptyState);
      expect(result.output).toContain('"verdict":"PASS"');
      await expect(access(join(dir, '.pipeline/build-review-rejections'))).rejects.toThrow();
    });

    it('retains final failed-grader exit facts through the exhausted mechanical-fault aggregate', async () => {
      await scopedPlan();
      const provider = createMockProvider();
      (provider.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        output: '',
        exitCode: 1,
        exitFacts: { exitCode: 1, stdoutBytes: 0, stderrBytes: 0 },
      });
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scopedGit(),
        planPath,
        config: {
          test_suite: { scoped_command: 'true' },
          build_review: { enabled: true, rubrics: { testQuality: { enabled: true }, security: { enabled: false }, implementationQuality: { enabled: false } } },
        } as HarnessConfig,
        ...currentBuildReviewProof(),
      });

      await runner.run('build_review', emptyState);
      await runner.run('build_review', emptyState);
      const result = await runner.run('build_review', emptyState);

      expect(result).toMatchObject({ success: false });
      expect(result.output).toContain('invalid-provider-result');
      expect(result.output).toContain('exitCode=1');
      expect(result.output).toContain('stdoutBytes=0');
      expect(result.output).toContain('stderrBytes=0');
      await expect(readFile(join(dir, '.pipeline/build-review.json'), 'utf8')).resolves.toMatchObject(
        expect.stringContaining('exitCode=1'),
      );
    });

    it('does not dispatch the coordinator or legacy scalar grader when the whole gate is disabled', async () => {
      const provider = createMockProvider();
      const coordinate = vi.fn(async () => ({ success: true, output: 'unexpected coordinator dispatch' }));
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scriptedGit(),
        planPath,
        config: { build_review: { enabled: false } } as HarnessConfig,
        buildReviewCoordinator: coordinate,
        ...currentBuildReviewProof(),
      });

      await expect(runner.run('build_review', emptyState)).resolves.toMatchObject({
        success: true,
        output: 'build_review disabled',
      });
      expect(coordinate).not.toHaveBeenCalled();
      expect(provider.invoke).not.toHaveBeenCalled();
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    function scriptedGit(planRepoPath = 'plan.md') {
      const git = async (args: string[]) => {
        if (args[0] === 'symbolic-ref') return { exitCode: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' };
        if (args[0] === 'rev-parse') return { exitCode: 0, stdout: args[1] === 'HEAD' ? 'head\n' : 'base-tip\n', stderr: '' };
        if (args[0] === 'merge-base') return { exitCode: 0, stdout: 'abc123\n', stderr: '' };
        if (args[0] === 'diff' && args.includes('--name-status')) return { exitCode: 0, stdout: 'M\u0000x\u0000', stderr: '' };
        if (args[0] === 'diff') return { exitCode: 0, stdout: 'diff --git a/x b/x\n', stderr: '' };
        if (args[0] === 'show' && args[1] === `head:${planRepoPath}`) return { exitCode: 0, stdout: '# Plan\n', stderr: '' };
        if (args[0] === 'show' && args[1] === `head:.docs/stories/${basename(planRepoPath)}`) return { exitCode: 0, stdout: '# Stories\n', stderr: '' };
        if (args[0] === 'show' && args[1] === 'head:x') return { exitCode: 0, stdout: 'export const x = true;\n', stderr: '' };
        if (args[0] === 'ls-tree') return { exitCode: 0, stdout: '', stderr: '' };
        return { exitCode: 1, stdout: '', stderr: '' };
      };
      return git;
    }

    function testQualityOptIn() {
      return {
        config: {
          test_suite: { scoped_command: 'true' },
          build_review: { enabled: true, rubrics: { testQuality: { enabled: true }, security: { enabled: false }, implementationQuality: { enabled: false } } },
        } as HarnessConfig,
      };
    }

    function currentBuildReviewProof() {
      return {
        buildReviewInputOptions: {
          inspectTestSuite: async () => ({
            status: 'CURRENT', evidence: { provenanceHeadSha: 'head', outcome: 'PASS' },
          } as never),
        },
      };
    }

    // A non-empty test-quality scope: one changed non-test source path whose
    // `Covers:` marker binds to the plan's Task 1. A non-test path keeps the
    // revert-and-rerun preflight on its engine-authored empty-test-set
    // exception, so the grader dispatch is reached without a git checkout.
    const SCOPED_SELECTOR = 'src/covered.ts';
    function scopedGit() {
      const git = async (args: string[]) => {
        if (args[0] === 'symbolic-ref') return { exitCode: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' };
        if (args[0] === 'rev-parse') return { exitCode: 0, stdout: args[1] === 'HEAD' ? 'head\n' : 'base-tip\n', stderr: '' };
        if (args[0] === 'merge-base') return { exitCode: 0, stdout: 'abc123\n', stderr: '' };
        if (args[0] === 'diff' && args.includes('--name-status')) return { exitCode: 0, stdout: `M\u0000${SCOPED_SELECTOR}\u0000M\u0000${SCOPED_TEST}\u0000`, stderr: '' };
        if (args[0] === 'diff') return { exitCode: 0, stdout: `diff --git a/${SCOPED_SELECTOR} b/${SCOPED_SELECTOR}\ndiff --git a/${SCOPED_TEST} b/${SCOPED_TEST}\n`, stderr: '' };
        if (args[0] === 'show' && args[1]?.startsWith('head:') && args[1].endsWith('.md')) {
          return { exitCode: 0, stdout: `# Plan\n\n### Task 1: Cover the thing\n**Files:** ${SCOPED_SELECTOR}\n`, stderr: '' };
        }
        if (args[0] === 'show' && args[1]?.endsWith(`:${SCOPED_TEST}`)) {
          return { exitCode: 0, stdout: args[1].startsWith('head:')
            ? "// Covers: task:1\nit('covered', () => {});\n"
            : "it('covered', () => {});\n", stderr: '' };
        }
        if (args[0] === 'show' && args[1]?.endsWith(`:${SCOPED_SELECTOR}`)) {
          return { exitCode: 0, stdout: args[1].startsWith('head:')
            ? '// Covers: task:1\nexport const covered = true;\n'
            : 'export const covered = false;\n', stderr: '' };
        }
        if (args[0] === 'worktree' && args[1] === 'add') {
          await mkdir(join(args[3]!, 'test'), { recursive: true });
          return { exitCode: 0, stdout: '', stderr: '' };
        }
        if (args[0] === 'worktree' && args[1] === 'remove') return { exitCode: 0, stdout: '', stderr: '' };
        return { exitCode: 1, stdout: '', stderr: '' };
      };
      return git;
    }
    function equivalentScopedGit() {
      const git = scopedGit();
      return async (args: string[]) => {
        if (args[0] === 'cherry') {
          return { exitCode: 0, stdout: '- 1234567 replayed upstream patch\n', stderr: '' };
        }
        if (args[0] === 'log') {
          return { exitCode: 0, stdout: '1234567\0\0\nsrc/replayed.ts\0', stderr: '' };
        }
        return git(args);
      };
    }
    function failedPatchEquivalentProvenanceGit(diffCalls: string[][]) {
      const git = scopedGit();
      return async (args: string[]) => {
        if (args[0] === 'cherry') {
          return { exitCode: 0, stdout: '- 1234567 replayed upstream patch\n', stderr: '' };
        }
        if (args[0] === 'log') {
          return { exitCode: 1, stdout: '', stderr: 'attribution unavailable' };
        }
        if (args[0] === 'diff') diffCalls.push(args);
        return git(args);
      };
    }
    async function scopedPlan(path = planPath) {
      await writeFile(path, `# Plan\n\n### Task 1: Cover the thing\n**Files:** ${SCOPED_SELECTOR}\n`, 'utf-8');
    }

    // A scoped changed TEST (title `covered`) beside a production change. The
    // fake git materializes the preflight checkout so the runner's own
    // revert-and-rerun reaches the grader; the finding anchor must then name
    // the changed test's content region exactly.
    const SCOPED_TEST = 'test/covered.test.ts';
    const SCOPED_TEST_REGION = {
      path: SCOPED_TEST,
      contentHash: `sha256:${createHash('sha256').update('covered').digest('hex')}`,
      display: 'covered',
    };
    function scopedTestGit() {
      const git = async (args: string[]) => {
        if (args[0] === 'symbolic-ref') return { exitCode: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' };
        if (args[0] === 'rev-parse') return { exitCode: 0, stdout: args[1] === 'HEAD' ? 'head\n' : 'base-tip\n', stderr: '' };
        if (args[0] === 'merge-base') return { exitCode: 0, stdout: 'abc123\n', stderr: '' };
        if (args[0] === 'diff') {
          if (args.includes('--name-status')) {
            return { exitCode: 0, stdout: `M\u0000${SCOPED_SELECTOR}\u0000M\u0000${SCOPED_TEST}\u0000`, stderr: '' };
          }
          return { exitCode: 0, stdout: [
            `diff --git a/${SCOPED_SELECTOR} b/${SCOPED_SELECTOR}`,
            `diff --git a/${SCOPED_TEST} b/${SCOPED_TEST}`,
          ].join('\n') + '\n', stderr: '' };
        }
        if (args[0] === 'show' && args[1]?.startsWith('head:') && args[1].endsWith('.md')) {
          return { exitCode: 0, stdout: `# Plan\n\n### Task 1: Cover the thing\n**Files:** ${SCOPED_SELECTOR}\n`, stderr: '' };
        }
        if (args[0] === 'show' && args[1]?.endsWith(`:${SCOPED_TEST}`)) {
          return { exitCode: 0, stdout: args[1].startsWith('head:')
            ? "// Covers: task:1\nit('covered', () => {});\n"
            : "it('covered', () => {});\n", stderr: '' };
        }
        if (args[0] === 'show' && args[1]?.endsWith(`:${SCOPED_SELECTOR}`)) {
          return { exitCode: 0, stdout: args[1].startsWith('head:')
            ? 'export const covered = false;\n'
            : 'export const covered = true;\n', stderr: '' };
        }
        if (args[0] === 'worktree' && args[1] === 'add') {
          const checkout = args[3]!;
          await mkdir(join(checkout, 'src'), { recursive: true });
          await mkdir(join(checkout, 'test'), { recursive: true });
          return { exitCode: 0, stdout: '', stderr: '' };
        }
        if (args[0] === 'worktree' && args[1] === 'remove') return { exitCode: 0, stdout: '', stderr: '' };
        return { exitCode: 1, stdout: '', stderr: '' };
      };
      return git;
    }
    function scopedTestQualityOptIn() {
      return {
        config: {
          test_suite: { scoped_command: 'exit 1' },
          build_review: { enabled: true, rubrics: { testQuality: { enabled: true }, security: { enabled: false }, implementationQuality: { enabled: false } } },
        } as HarnessConfig,
      };
    }

    it('leaves no verdict artifact after an invalid vocabulary result is rejected', async () => {
      await scopedPlan();
      const invoke = vi.fn().mockResolvedValue({
        success: true,
        output: JSON.stringify({
          kind: 'judged', rubric: 'testQuality', contractVersion: 'v3', lapId: 'lap-head',
          snapshotDigest: 'sha256:source', findings: [{
            concernKind: 'not-test-insensitive', summary: 'A rejected catch-all.',
            evidenceLocations: ['src/example.ts:1'],
            anchor: { rubric: 'testQuality' },
          }],
        }),
        exitCode: 0,
      });
      const runner = new DefaultStepRunner(
        { invoke },
        'session-1',
        dir,
        { gitRunner: scopedGit(), planPath, ...testQualityOptIn(), ...currentBuildReviewProof() },
      );

      const result = await runner.run('build_review', emptyState);

      expect(result.success).toBe(false);
      await expect(access(join(dir, '.pipeline/build-review.json'))).rejects.toThrow();
      expect(invoke).toHaveBeenCalledTimes(1);
      const ledger = await readKickbackLedger(dir);
      expect(ledger.gates.build_review?.count ?? 0).toBe(0);
      expect(ledger.gates.build_review?.cumulative ?? 0).toBe(0);
    });

    it('dispatches test-quality with a fresh uuid and resume:false, never the constructor session', async () => {
      await scopedPlan();
      const invoke = vi.fn().mockResolvedValue({ success: true, output: '{"verdict":"PASS"}', exitCode: 0 });
      const provider: LLMProvider = { invoke };
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scopedGit(),
        planPath,
        ...testQualityOptIn(),
        ...currentBuildReviewProof(),
      });

      const result = await runner.run('build_review', emptyState);

      expect(result.success).toBe(false);
      expect(invoke).toHaveBeenCalledTimes(1);
      for (const [options] of invoke.mock.calls) {
        const opts = options as InvokeOptions;
        expect(opts.resume).toBe(false);
        expect(opts.sessionId).not.toBe('session-1');
        expect(opts.sessionId).toMatch(/^[0-9a-f-]{36}$/);
      }
    });

    it('resolves the feature\'s own plan by featureDesc stem, not the alphabetically-last plan file (#788)', async () => {
      const { mkdir } = await import('node:fs/promises');
      const plansDir = join(dir, '.docs', 'plans');
      await mkdir(plansDir, { recursive: true });
      // Unrelated plan that sorts AFTER the feature's own plan alphabetically.
      // Its only task cannot bind the changed file's `Covers: task:1` marker,
      // so grading against it would empty-pass without a dispatch.
      await writeFile(
        join(plansDir, 'writing-system-tests-red-exit-gate.md'),
        '# Unrelated Plan\n\n### Task 9: Wrong plan\n**Files:** src/other.ts\n',
        'utf-8',
      );
      await scopedPlan(join(plansDir, 'block-edits-to-docs-spec-artifacts-during-build-an.md'));

      const invoke = vi.fn().mockResolvedValue({ success: true, output: '{"verdict":"PASS"}', exitCode: 0 });
      const provider: LLMProvider = { invoke };
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scopedGit(),
        featureDesc: 'block-edits-to-docs-spec-artifacts-during-build-an',
        ...testQualityOptIn(),
        ...currentBuildReviewProof(),
      });

      const result = await runner.run('build_review', emptyState);

      // The feature's own plan binds the scope. The wrong plan would have
      // empty-passed.
      expect(result.success).toBe(false);
      expect(result.output).not.toContain('test_quality_empty_scope');
      expect(invoke).toHaveBeenCalledTimes(1);
      const prompts = invoke.mock.calls.map(([options]) => (options as InvokeOptions).prompt).join('\n');
      expect(prompts).toContain(SCOPED_SELECTOR);
    });

    // Task 4 (build-review-grades-plan-vs-diff-against-a-stale-o): base-
    // freshness telemetry, carried on StepRunResult so the conductor can
    // emit a `build_review_base` event without step-runners.ts owning event
    // emission itself.
    it('attaches baseFreshness from assembleBuildReviewInputs when the verdict is invalid', async () => {
      await scopedPlan();
      const invoke = vi.fn().mockResolvedValue({ success: true, output: '{"verdict":"PASS"}', exitCode: 0 });
      const provider: LLMProvider = { invoke };
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scopedGit(),
        planPath,
        ...testQualityOptIn(),
        ...currentBuildReviewProof(),
      });

      const result = await runner.run('build_review', emptyState);

      expect(result.success).toBe(false);
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(result.baseFreshness).toEqual({
        mergeBase: 'abc123',
        trackingRefSha: null,
        remoteHeadSha: null,
        fresh: false,
      });
    });

    it('carries patch-equivalent exclusions on baseFreshness', async () => {
      await scopedPlan();
      const invoke = vi.fn().mockResolvedValue({ success: true, output: '{"verdict":"PASS"}', exitCode: 0 });
      const runner = new DefaultStepRunner({ invoke }, 'session-1', dir, {
        gitRunner: equivalentScopedGit(),
        planPath,
        ...testQualityOptIn(),
        ...currentBuildReviewProof(),
      });

      const result = await runner.run('build_review', emptyState);

      expect(result.baseFreshness).toMatchObject({
        filteredCommits: [{ sha: '1234567', subject: 'replayed upstream patch' }],
        excludedPaths: ['src/replayed.ts'],
      });
    });

    it('leaves the build review result and graded diff unchanged when patch-equivalent provenance fails', async () => {
      await scopedPlan();
      const invoke = vi.fn().mockResolvedValue({ success: true, output: '{"verdict":"PASS"}', exitCode: 0 });
      const baselineDiffCalls: string[][] = [];
      const failedProvenanceDiffCalls: string[][] = [];
      const baseline = new DefaultStepRunner({ invoke }, 'session-1', dir, {
        gitRunner: async (args) => {
          if (args[0] === 'diff') baselineDiffCalls.push(args);
          return scopedGit()(args);
        },
        planPath,
        ...testQualityOptIn(),
        ...currentBuildReviewProof(),
      });
      const failedProvenance = new DefaultStepRunner({ invoke }, 'session-2', dir, {
        gitRunner: failedPatchEquivalentProvenanceGit(failedProvenanceDiffCalls),
        planPath,
        ...testQualityOptIn(),
        ...currentBuildReviewProof(),
      });

      const baselineResult = await baseline.run('build_review', emptyState);
      const failedProvenanceResult = await failedProvenance.run('build_review', emptyState);

      expect({
        success: failedProvenanceResult.success,
        output: failedProvenanceResult.output,
        baseFreshness: failedProvenanceResult.baseFreshness,
        diff: failedProvenanceDiffCalls,
      }).toEqual({
        success: baselineResult.success,
        output: baselineResult.output,
        baseFreshness: baselineResult.baseFreshness,
        diff: baselineDiffCalls,
      });
    });

    // Task 24 (rebase-invalidated-test-failures-never-reach-build): the
    // middle leg of grading provenance — whatever assembly classified must
    // reach the conductor on StepRunResult, or the event is never emitted.
    it('carries the assembled grading provenance through to the conductor', async () => {
      await scopedPlan();
      const invoke = vi.fn().mockResolvedValue({ success: true, output: '{"verdict":"PASS"}', exitCode: 0 });
      const provider: LLMProvider = { invoke };
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scopedGit(),
        planPath,
        ...testQualityOptIn(),
        ...currentBuildReviewProof(),
      });

      const result = await runner.run('build_review', emptyState);

      expect(result.repairProvenance).toEqual({ disposition: 'none_warranted' });
      expect(invoke).toHaveBeenCalledTimes(1);
    });

    it('attaches baseFreshness even on a ladder-exhausted failure (fire-and-forget telemetry)', async () => {
      await scopedPlan();
      const invoke = vi.fn().mockResolvedValue({
        success: false,
        output: 'no models available',
        exitCode: 1,
        modelUnavailable: true,
      });
      const provider: LLMProvider = { invoke };
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scopedGit(),
        planPath,
        ...testQualityOptIn(),
        ...currentBuildReviewProof(),
      });

      const result = await runner.run('build_review', emptyState);

      expect(result.success).toBe(false);
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(result.baseFreshness).toEqual({
        mergeBase: 'abc123',
        trackingRefSha: null,
        remoteHeadSha: null,
        fresh: false,
      });
    });

    it('does not set baseFreshness when input assembly itself fails', async () => {
      const invoke = vi.fn();
      const provider: LLMProvider = { invoke };
      const failingGit = async () => ({ exitCode: 1, stdout: '', stderr: 'no merge base' });
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: failingGit,
        planPath,
      });

      const result = await runner.run('build_review', emptyState);

      expect(result.success).toBe(false);
      expect(result.baseFreshness).toBeUndefined();
      expect(invoke).not.toHaveBeenCalled();
    });

    it('marks only a typed suite-proof assembly failure as waiting for test_suite', async () => {
      const provider: LLMProvider = {
        invoke: vi.fn(),
      };
      const suiteProofRunner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scriptedGit(),
        planPath,
        buildReviewInputOptions: {
          inspectTestSuite: async () => ({ status: 'STALE' } as never),
        },
      });
      const mergeBaseRunner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: async () => ({ exitCode: 1, stdout: '', stderr: 'no merge base' }),
        planPath,
        ...currentBuildReviewProof(),
      });

      const suiteProofFailure = await suiteProofRunner.run('build_review', emptyState);
      const mergeBaseFailure = await mergeBaseRunner.run('build_review', emptyState);

      expect(suiteProofFailure.unretryableInputs).toEqual({ retryAfterStep: 'test_suite' });
      expect(mergeBaseFailure.unretryableInputs).toBeUndefined();
    });

    it('ladder-exhausted (all retries fail) reports step failure, never PASS', async () => {
      const invoke = vi.fn().mockResolvedValue({
        success: false,
        output: 'no models available',
        exitCode: 1,
        modelUnavailable: true,
      });
      const provider: LLMProvider = { invoke };
      const runner = new DefaultStepRunner(provider, 'session-1', dir, {
        gitRunner: scriptedGit(),
        planPath,
      });

      const result = await runner.run('build_review', emptyState);

      expect(result.success).toBe(false);
    });

  });

  describe('resolveSetupFailure one-shot dispatch', () => {
    it('assembles a fresh session with uuid and calls provider with output tail in prompt', async () => {
      const invoke = vi.fn().mockResolvedValue({
        success: true,
        output: 'done',
        exitCode: 0,
      });
      const provider: LLMProvider = {
        invoke,
      };
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      const result = await runner.resolveSetupFailure({
        worktreePath: '/wt/feature-x',
        outputTail: 'npm ERR! Something went wrong',
        slug: 'my-feature',
      });

      expect(result.attempted).toBe(true);
      expect(invoke).toHaveBeenCalledOnce();

      const opts = invoke.mock.calls[0][0] as InvokeOptions;
      // Must be a fresh session, not the constructor's session
      expect(opts.sessionId).not.toBe('session-1');
      expect(opts.sessionId).toMatch(/^[0-9a-f-]{36}$/);
      // Must use resume:false for fresh session
      expect(opts.resume).toBe(false);
      // Prompt must contain the output tail
      expect(opts.prompt).toContain('npm ERR! Something went wrong');
      // System prompt must be present
      expect(opts.systemPrompt).toBeTruthy();
      expect(opts.systemPrompt).toContain('docker compose up -d --no-recreate');
      expect(opts.systemPrompt).toContain('Do not stop, restart, or tear down Docker');
    });

    it('respects the AI_CONDUCTOR_NO_REAL_EXEC kill-switch in tests', async () => {
      const originalEnv = process.env.AI_CONDUCTOR_NO_REAL_EXEC;
      try {
        process.env.AI_CONDUCTOR_NO_REAL_EXEC = '1';
        const invoke = vi.fn().mockResolvedValue({
          success: true,
          output: 'done',
          exitCode: 0,
        });
        const provider: LLMProvider = {
          invoke,
        };
        const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

        const result = await runner.resolveSetupFailure({
          worktreePath: '/wt/feature-x',
          outputTail: 'error output',
          slug: 'my-feature',
        });

        expect(result.attempted).toBe(true);
      } finally {
        if (originalEnv !== undefined) {
          process.env.AI_CONDUCTOR_NO_REAL_EXEC = originalEnv;
        } else {
          delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
        }
      }
    });

    it('passes dangerouslySkipPermissions=true like other one-shot fix-session patterns', async () => {
      const invoke = vi.fn().mockResolvedValue({
        success: true,
        output: 'done',
        exitCode: 0,
      });
      const provider: LLMProvider = {
        invoke,
      };
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      await runner.resolveSetupFailure({
        worktreePath: '/wt/feature-x',
        outputTail: 'error',
        slug: 'my-feature',
      });

      const opts = invoke.mock.calls[0][0] as InvokeOptions;
      expect(opts.dangerouslySkipPermissions).toBe(true);
    });

    it('sets cwd to the worktreePath', async () => {
      const invoke = vi.fn().mockResolvedValue({
        success: true,
        output: 'done',
        exitCode: 0,
      });
      const provider: LLMProvider = {
        invoke,
      };
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      await runner.resolveSetupFailure({
        worktreePath: '/wt/feature-x',
        outputTail: 'error',
        slug: 'my-feature',
      });

      const opts = invoke.mock.calls[0][0] as InvokeOptions;
      expect(opts.cwd).toBe('/wt/feature-x');
    });
  });

  describe('resolveCiFailure one-shot dispatch', () => {
    it.each([
      [{ success: false, output: 'readiness unavailable', exitCode: 1, executionDisposition: 'not-started' as const }, 'not-started'],
      [{ success: false, output: 'provider exited', exitCode: 1 }, 'failed'],
      [{ success: true, output: 'completed', exitCode: 0, executionDisposition: 'not-started' as const }, 'session-completed'],
    ])('preserves legacy scalar disposition (%s)', async (result, expectedKind) => {
      const runner = new DefaultStepRunner({ invoke: vi.fn().mockResolvedValue(result) }, 'session-1', '/tmp/project');
      await expect(runner.resolveCiFailure({
        worktreePath: '/wt/feature-x', prUrl: 'https://github.com/org/repo/pull/42', hint: 'failure', slug: 'my-feature',
      })).resolves.toMatchObject({ kind: expectedKind, preferredProvider: 'claude' });
    });

    it('invokes the model ladder once with resume:false, dangerouslySkipPermissions:true, cwd=worktreePath, and the hint in the prompt', async () => {
      const invoke = vi.fn().mockResolvedValue({
        success: true,
        output: 'done',
        exitCode: 0,
      });
      const provider: LLMProvider = {
        invoke,
      };
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

      await runner.resolveCiFailure({
        worktreePath: '/wt/feature-x',
        prUrl: 'https://github.com/org/repo/pull/42',
        hint: 'TypeError: Cannot read properties of undefined (reading \'foo\')',
        slug: 'my-feature',
      });

      expect(invoke).toHaveBeenCalledOnce();

      const opts = invoke.mock.calls[0][0] as InvokeOptions;
      expect(opts.resume).toBe(false);
      expect(opts.dangerouslySkipPermissions).toBe(true);
      expect(opts.cwd).toBe('/wt/feature-x');
      expect(opts.systemPrompt).toContain('Do not run tests');
      expect(opts.systemPrompt).toContain('Do not push');
      expect(opts.systemPrompt).toContain('The daemon owns all test execution');
      expect(opts.prompt).toContain("TypeError: Cannot read properties of undefined (reading 'foo')");
    });
  });
});

describe('auxiliary provider dispatch tier telemetry', () => {
  const rubric = { rubric: 'testQuality' as const, skillName: 'build-review-test-quality', policy: {
    enabled: true, llm_provider: 'claude' as const, model: 'opus', effort: 'high' as const,
    model_fallback_ladder: ['opus'], max_retries: 1, escalate: false,
  } };
  const projection = {
    rubric: 'testQuality', contractVersion: 'v3', projectionVersion: 'v2',
    lapId: 'lap-a237011e9f263dd47ca1a2c7cfe929865c2e99b8', snapshotDigest: 'sha256:projection',
    digest: 'sha256:projection', mergeBase: 'base', headSha: 'head', changedFiles: [],
    removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] }, changedTestSelectors: [],
    testSuiteProof: {}, revertedProductionManifest: [], preflight: {}, repairContext: [],
  } as unknown as import('../../src/engine/build-review-projections.js').BuildReviewRubricProjection;

  it.each([
    ['M' as const, { tier: 'M' }],
    [undefined, {}],
  ])('records tier metadata for a build-review rubric dispatch (%s)', async (tier, expected) => {
    const projectDir = await mkdtemp(join(tmpdir(), 'build-review-tier-'));
    const attempts: ProviderAttemptEvent[] = [];
    const invoke = vi.fn().mockResolvedValue({ success: true, output: '{"findings":[]}', exitCode: 0 });
    const runner = new DefaultStepRunner(createMockProvider(), 'tier-build-review', projectDir, {
      config: { llm_provider: ['claude'] },
      providerRuntimes: new ProviderRuntimeSet([interactiveRuntime('claude', invoke)]),
      sessionStore: new ProviderSessionStore(), configuredProviders: ['claude'],
      providerAttempt: (step, attempt) => { attempts.push({ type: 'provider_attempt', step, ...attempt }); },
    });

    try {
      await (runner as unknown as {
        dispatchBuildReviewRubric: (branch: typeof rubric, value: typeof projection, valueTier?: ConductState['complexity_tier']) => Promise<unknown>;
      }).dispatchBuildReviewRubric(rubric, projection, tier);

      const invocation = attempts.find((attempt) => attempt.invoked);
      expect(invocation).toBeDefined();
      expect(invocation).toMatchObject(expected);
      expect('tier' in invocation!).toBe(tier !== undefined);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});

describe('build_review rubric dispatch', () => {
  const lapId = 'lap-a237011e9f263dd47ca1a2c7cfe929865c2e99b8';
  const snapshotDigest = 'sha256:434fa33612c7d7188d5ba5398a748b54a28400bcb534988863610f64a70896f8';
  const projection = {
    rubric: 'testQuality', contractVersion: 'v3', projectionVersion: 'v2',
    lapId, snapshotDigest, digest: 'sha256:projection',
    mergeBase: 'base', headSha: 'head', changedFiles: [{ path: 'test/engine/event-sinks.test.ts', changeKind: 'modified', hunks: [] }], removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] },
    changedTestSelectors: ['test/engine/event-sinks.test.ts'], testSuiteProof: {}, revertedProductionManifest: [], preflight: {}, repairContext: [],
  } as unknown as import('../../src/engine/build-review-projections.js').BuildReviewRubricProjection;
  const policy = {
    enabled: true, llm_provider: 'claude' as const, model: 'opus', effort: 'high' as const,
    model_fallback_ladder: ['opus'], max_retries: 1, escalate: false,
  };
  const branch = { rubric: 'testQuality' as const, skillName: 'build-review-test-quality', policy };

  function dispatch(runner: DefaultStepRunner) {
    return (runner as unknown as {
      dispatchBuildReviewRubric: (branch: unknown, projection: unknown) => Promise<unknown>;
    }).dispatchBuildReviewRubric(branch, projection);
  }

  it('records an unresolved rubric skill command as a named dispatch failure', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: false,
      output: 'unknown skill command',
      exitCode: 1,
      commandUnresolved: true,
      commandUnresolvedName: '$build-review-test-quality',
    });
    const runner = new DefaultStepRunner({ invoke }, 'session-1', '/tmp/project');

    const result = await dispatch(runner);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      kind: 'dispatch-failure',
      detail: renderBuildReviewUnresolvedSkillRemedy(
        'build-review-test-quality',
        '$build-review-test-quality',
      ),
    });
  });

  it('returns a provider-result dispatch failure when the grader invocation itself fails', async () => {
    const invoke = vi.fn().mockResolvedValue({ success: false, output: 'crashed', exitCode: 1 });
    const runner = new DefaultStepRunner({ invoke }, 'session-1', '/tmp/project');

    await expect(dispatch(runner)).resolves.toMatchObject({
      kind: 'dispatch-failure',
      cause: 'invalid-provider-result',
      detail: 'build_review grader invocation ended without a result.',
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('skips Pi for its unavailable native schema and dispatches the Claude fallback', async () => {
    const piInvoke = vi.fn();
    const claudeInvoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: '{"findings":[]}',
      exitCode: 0,
      finalStructuredResult: { findings: [] },
    }));
    const lifecycleCapability = { synchronousSpawnPermit: true } as const;
    const nativeSchemaCapability = { nativeOutputSchema: true } as const;
    const runtime = (key: 'pi' | 'claude', invoke: LLMProvider['invoke']) => ({
      key,
      provider: { lifecycleCapability, nativeSchemaCapability, invoke },
      lifecycleCapability,
      nativeSchemaCapability,
      policy: CLAUDE_POLICY,
      builtIn: true,
      availability: new ModelAvailability(CLAUDE_POLICY.modelFallbackLadder),
    });
    const attempts: ProviderAttemptEvent[] = [];
    const runner = new DefaultStepRunner(createMockProvider(), 'session-1', '/tmp/project', {
      providerRuntimes: new ProviderRuntimeSet([
        runtime('pi', piInvoke),
        runtime('claude', claudeInvoke),
      ]),
      sessionStore: new ProviderSessionStore(),
      configuredProviders: ['pi', 'claude'],
      providerAttempt: (step, attempt) => { attempts.push({ type: 'provider_attempt', step, ...attempt }); },
      buildReviewPolicyCatalog: async () => [{
        semanticName: 'build-review-test-quality', source: 'project', installationOrigin: '/fixture/project',
        canonicalSkillPath: '/fixture/project/SKILL.md', packageRoot: '/fixture/project',
        declaredDependencies: [], availability: 'available',
      }],
      buildReviewPolicyCapture: async (policy) => ({
        policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md',
        manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Build review test quality\n') }],
        metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] },
        digest: `sha256-v1:${'a'.repeat(64)}`,
      }),
    });
    const piThenClaudeBranch = {
      ...branch,
      policy: { ...policy, llm_provider: ['pi', 'claude'] as const },
    };
    const inputs = {
      sourceMaterialization: {
        contextFor: () => ({ source: undefined }),
        settle: async () => {},
      },
      sourceSnapshot: { contentDigest: 'sha256:source', mergeBase: 'base', headSha: 'head', sourceChanges: [] },
    };
    const engineIdentity = {
      engineStamp: 'engine-stamp',
      skillDigests: { testQuality: { kind: 'resolved' as const, digest: `sha256-v1:${'b'.repeat(64)}` } },
    };
    await (runner as unknown as {
      dispatchBuildReviewRubric: (
        branch: unknown, projection: unknown, tier: undefined, context: undefined,
        inputs: unknown, engineIdentity: unknown,
      ) => Promise<unknown>;
    }).dispatchBuildReviewRubric(piThenClaudeBranch, projection, undefined, undefined, inputs, engineIdentity);

    expect(piInvoke).not.toHaveBeenCalled();
    expect(claudeInvoke).toHaveBeenCalledOnce();
    expect(attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'claude', invoked: true }),
    ]));
  });

  it.each([
    {
      name: 'a delta lap',
      reviewScope: {
        mode: 'delta' as const,
        deltaHunks: [{ path: 'src/current.ts', contentHash: `sha256:${'c'.repeat(64)}` }],
      },
      scopeInstruction: 'Judge only the `reviewScope` delta hunks.',
    },
    {
      name: 'a full lap',
      reviewScope: { mode: 'full' as const, deltaHunks: [] },
      scopeInstruction: 'Judge the full changed diff described by `changedFiles`.',
    },
  ])('renders the projected peer review scope for %s', async ({ reviewScope, scopeInstruction }) => {
    const projectDir = await mkdtemp(join(tmpdir(), 'build-review-peer-scope-'));
    const baselinePath = join(projectDir, 'baseline');
    const headPath = join(projectDir, 'head');
    await Promise.all([mkdir(baselinePath), mkdir(headPath)]);
    const invoke = vi.fn<(options: InvokeOptions) => Promise<InvokeResult>>(async (_options) => ({
      success: true,
      output: '{"findings":[]}',
      exitCode: 0,
      finalStructuredResult: { findings: [] },
    }));
    const runner = new DefaultStepRunner(createMockProvider(), 'peer-scope', projectDir, {
      config: { llm_provider: ['claude'] } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([interactiveRuntime('claude', invoke)]),
      sessionStore: new ProviderSessionStore(),
      configuredProviders: ['claude'],
      buildReviewPolicyCatalog: async () => [{
        semanticName: 'build-review-test-quality', source: 'project', installationOrigin: '/fixture/project',
        canonicalSkillPath: '/fixture/project/SKILL.md', packageRoot: '/fixture/project',
        declaredDependencies: [], availability: 'available',
      }],
      buildReviewPolicyCapture: async (capturedPolicy) => ({
        policy: capturedPolicy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md',
        manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Build review test quality\n') }],
        metadata: { version: 1, semanticName: capturedPolicy.semanticName, source: capturedPolicy.source, declaredDependencies: [] },
        digest: `sha256-v1:${'a'.repeat(64)}`,
      }),
    });
    const peerProjection = {
      rubric: 'testQuality', contractVersion: 'v4', projectionVersion: 'v4',
      lapId, snapshotDigest, contentDigest: 'sha256:content', digest: 'sha256:peer-projection',
      mergeBase: 'base', headSha: 'head', changedFiles: [], reviewScope,
      runnerSelectors: [], changedTestSelectors: [], unresolvedMarkers: [], changedTestTitles: [],
      testScope: { analysisVersion: 'test-scope-v1', changedDeclarations: [], targets: [], candidates: [], notes: [], affectedGroups: [], sharedSources: [], evidence: [] },
      testSuiteProof: {}, revertedProductionManifest: [], preflight: { classification: 'not-requested' },
    };
    const inputs = {
      sourceSnapshot: {
        contentDigest: 'sha256:content', mergeBase: 'base', headSha: 'head',
        sourceChanges: [{ kind: 'M', path: 'src/current.ts' }],
      },
      sourceMaterialization: {
        contextFor: () => ({
          memberId: 'testQuality',
          source: {
            identity: { snapshotDigest, contentDigest: 'sha256:content', mergeBase: 'base', headSha: 'head' },
            baselinePath,
            headPath,
          },
        }),
        settle: async () => {},
      },
    };

    try {
      await (runner as unknown as {
        dispatchBuildReviewRubric: (
          branch: unknown, projection: unknown, tier: undefined, context: undefined,
          inputs: unknown, engineIdentity: unknown, customPolicyLap: boolean,
          readOnlyReviewCapabilityFor: (provider: string) => Promise<unknown>,
        ) => Promise<unknown>;
      }).dispatchBuildReviewRubric(
        branch,
        peerProjection,
        undefined,
        undefined,
        inputs,
        { engineStamp: 'engine-stamp', skillDigests: { testQuality: { kind: 'resolved', digest: `sha256-v1:${'a'.repeat(64)}` } } },
        true,
        async (provider) => ({ provider, platform: process.platform, status: 'available' }),
      );

      const prompt = invoke.mock.calls[0]?.[0].prompt;
      expect(prompt).toContain(JSON.stringify({ reviewScope }));
      expect(prompt).toContain(scopeInstruction);
      if (reviewScope.mode === 'full') {
        expect(prompt).not.toContain('Judge only the `reviewScope` delta hunks.');
      }
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

});
