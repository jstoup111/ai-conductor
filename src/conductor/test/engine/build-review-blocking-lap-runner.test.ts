// Covers: task:4, task:5
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { parseChildId, type ChildId } from '../../src/engine/child-context.js';
import { coordinateBuildReviewRubrics } from '../../src/engine/build-review-coordinator.js';
import { canonicalizeBuildReviewFindingIdentity } from '../../src/engine/build-review-finding-identity.js';
import {
  deriveEffectiveBuildReviewVerdict,
  parseBuildReviewAggregate,
  type BuildReviewAggregate,
} from '../../src/engine/build-review-aggregate.js';
import type { BuildReviewFinding } from '../../src/engine/build-review-domain.js';
import { resolveBuildReviewConfig } from '../../src/engine/resolved-config.js';
import { CLAUDE_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { ConductorEvent } from '../../src/types/events.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

vi.mock('../../src/engine/build-review-coordinator.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/engine/build-review-coordinator.js')>()),
  coordinateBuildReviewRubrics: vi.fn(),
}));

const IMPLEMENTATION_QUALITY = 'implementationQuality' as const;
const DIFF = [
  'diff --git a/src/example.ts b/src/example.ts',
  '@@ -1 +1 @@',
  '-export const example = false;',
  '+export const example = true;',
].join('\n');
const FINDING: BuildReviewFinding = {
  concernKind: 'primitive-obsession',
  summary: 'Raw string state permits invalid domain values.',
  evidenceLocations: ['src/example.ts:1'],
  anchor: {
    rubric: IMPLEMENTATION_QUALITY,
    locus: { path: 'src/example.ts', contentHash: `sha256:${'a'.repeat(64)}`, display: 'changed state model' },
  },
  severity: 'critical',
  confidence: 95,
};
const FINDING_ID = canonicalizeBuildReviewFindingIdentity({
  rubric: IMPLEMENTATION_QUALITY,
  contractVersion: 'v4',
  concernKind: FINDING.concernKind,
  anchor: FINDING.anchor,
})!.id;
const engineIdentity = {
  engineStamp: 'blocking-lap-fixture',
  skillDigests: { implementationQuality: { kind: 'resolved' as const, digest: 'sha256:blocking-lap-policy' } },
};

describe('build_review blocking-lap limit at the lap join', () => {
  let projectDir: string;
  let verdicts: Extract<ConductorEvent, { type: 'build_review_outer_verdict' }>[];
  let resolved: BuildReviewAggregate[];
  let runner: DefaultStepRunner;

  function configFor(implementationQuality: Record<string, unknown> = {}) {
    return resolveBuildReviewConfig(
      {
        build_review: {
          enabled: true,
          rubrics: {
            testQuality: { enabled: false },
            security: { enabled: false },
            implementationQuality: { enabled: true, ...implementationQuality },
          },
        },
      } as HarnessConfig,
      CLAUDE_MODEL_POLICY,
    );
  }

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'build-review-blocking-lap-runner-'));
    verdicts = [];
    resolved = [];
    const emitter = new ConductorEventEmitter();
    emitter.on('build_review_outer_verdict', (event) => {
      if (event.type === 'build_review_outer_verdict') verdicts.push(event);
    });
    const provider: LLMProvider = { invoke: vi.fn() };
    runner = new DefaultStepRunner(provider, 'blocking-lap-runner', projectDir, {
      config: {} as HarnessConfig,
      events: emitter,
      // The real reducer classifies the stamped aggregate; only feature
      // identity and disposition storage are outside this test's boundary.
      buildReviewEffectiveResolver: async (_projectRoot, aggregate) => {
        resolved.push(aggregate as BuildReviewAggregate);
        return {
          ok: true as const,
          feature: { version: 'v1' as const, repository: projectDir, feature: 'blocking-lap-runner' },
          effective: deriveEffectiveBuildReviewVerdict(aggregate)!,
        };
      },
    });
    vi.spyOn(runner as any, 'resolveBuildReviewEngineIdentity').mockResolvedValue(engineIdentity as never);
    vi.spyOn(runner as any, 'resolvedAppliedBuildReviewActSourceIds').mockResolvedValue(new Set());
    vi.spyOn(runner as any, 'liveBuildReviewActSourceIds').mockResolvedValue({
      unappliedLiveSourceIds: new Set(),
      appliedLiveSourceIds: new Set(),
    });
    vi.mocked(coordinateBuildReviewRubrics).mockReset();
    vi.mocked(coordinateBuildReviewRubrics).mockImplementation(async (input) => {
      const result = {
        kind: 'judged' as const,
        rubric: IMPLEMENTATION_QUALITY,
        lapId: input.lapId,
        snapshotDigest: input.inputs.sourceSnapshot.digest,
        contractVersion: 'v4' as const,
        findings: [FINDING],
        verdict: 'FAIL' as const,
      };
      await input.writeArtifact({
        rubric: IMPLEMENTATION_QUALITY,
        lapId: input.lapId,
        snapshotDigest: input.inputs.sourceSnapshot.digest,
        result,
        provenance: { kind: 'fresh' },
        reviewScope: input.reviewScopes?.[IMPLEMENTATION_QUALITY]!,
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
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  async function seedState(contents: string): Promise<void> {
    await mkdir(join(projectDir, '.pipeline'), { recursive: true });
    await writeFile(join(projectDir, '.pipeline', 'engine-state.json'), contents);
  }

  async function run(
    headSha: string,
    config = configFor(),
    child?: ChildId,
  ): Promise<{ success: boolean; output: string }> {
    return (
      runner as never as {
        runRubricBuildReviewInner: (...args: unknown[]) => Promise<{ success: boolean; output: string }>;
      }
    ).runRubricBuildReviewInner(
      {
        sourceSnapshot: { digest: `sha256:${headSha}`, mergeBase: 'b'.repeat(40), headSha, diff: DIFF },
      },
      config,
      'M',
      'plan.md',
      undefined,
      undefined,
      child,
    );
  }

  async function engineState(): Promise<any> {
    return JSON.parse(await readFile(join(projectDir, '.pipeline', 'engine-state.json'), 'utf8'));
  }

  async function publishedAggregate(child?: ChildId): Promise<BuildReviewAggregate> {
    const path =
      child === undefined
        ? join(projectDir, '.pipeline', 'build-review.json')
        : join(projectDir, '.pipeline', 'children', String(child), 'build-review.json');
    return parseBuildReviewAggregate(JSON.parse(await readFile(path, 'utf8')))!;
  }

  it('demotes a rubric that already blocked its limit and reports the limit on the aggregate and event', async () => {
    await seedState(
      JSON.stringify({ buildReviewBlockingLaps: { feature: { implementationQuality: ['lap-a', 'lap-b'] } } }),
    );
    const head = 'c'.repeat(40);

    await expect(run(head)).resolves.toMatchObject({ success: true });

    const limit = { rubric: IMPLEMENTATION_QUALITY, blockingLaps: 2, limit: 2 };
    expect(resolved.at(-1)?.blockingLapLimits).toEqual([limit]);
    expect((await publishedAggregate()).blockingLapLimits).toEqual([limit]);
    expect(verdicts.at(-1)).toMatchObject({
      effectiveVerdict: 'PASS',
      blockingLapLimits: [{ ...limit, findingIds: [FINDING_ID] }],
    });
    expect((await engineState()).buildReviewBlockingLaps.feature.implementationQuality).toEqual(['lap-a', 'lap-b']);
  });

  it('keeps blocking below the limit and records the lap', async () => {
    await seedState(JSON.stringify({ buildReviewBlockingLaps: { feature: { implementationQuality: ['lap-a'] } } }));
    const head = 'c'.repeat(40);

    await run(head);

    expect(verdicts.at(-1)?.effectiveVerdict).toBe('FAIL');
    expect(verdicts.at(-1)).not.toHaveProperty('blockingLapLimits');
    expect(await publishedAggregate()).not.toHaveProperty('blockingLapLimits');
    expect((await engineState()).buildReviewBlockingLaps.feature.implementationQuality).toEqual([
      'lap-a',
      `lap-${head}`,
    ]);
  });

  it('scopes a stacked child lap to its own count', async () => {
    const childOne = parseChildId(1)!;
    const childTwo = parseChildId(2)!;
    await seedState(
      JSON.stringify({ buildReviewBlockingLaps: { 'child-1': { implementationQuality: ['lap-a', 'lap-b'] } } }),
    );

    await run('d'.repeat(40), configFor(), childTwo);
    expect(verdicts.at(-1)?.effectiveVerdict).toBe('FAIL');
    expect(await publishedAggregate(childTwo)).not.toHaveProperty('blockingLapLimits');
    expect((await engineState()).buildReviewBlockingLaps['child-2'].implementationQuality).toEqual([
      `lap-${'d'.repeat(40)}`,
    ]);
    expect((await engineState()).buildReviewBlockingLaps['child-1'].implementationQuality).toEqual(['lap-a', 'lap-b']);

    await run('e'.repeat(40), configFor(), childOne);
    expect(verdicts.at(-1)?.effectiveVerdict).toBe('PASS');
  });

  it('never limits a lap by its own earlier record', async () => {
    const head = 'f'.repeat(40);
    const config = configFor({ max_blocking_laps: 1 });

    await run(head, config);
    await run(head, config);

    expect(verdicts.map((event) => event.effectiveVerdict)).toEqual(['FAIL', 'FAIL']);
    expect((await engineState()).buildReviewBlockingLaps.feature.implementationQuality).toEqual([`lap-${head}`]);
  });

  it('fails the step without demoting or overwriting when blocking-lap state is unreadable', async () => {
    await seedState('{not json');

    const result = await run('9'.repeat(40));

    expect(result.output).toContain('build_review blocking-lap persistence failed');
    expect(verdicts.at(-1)?.effectiveVerdict).toBe('FAIL');
    expect(await publishedAggregate()).not.toHaveProperty('blockingLapLimits');
    expect(await readFile(join(projectDir, '.pipeline', 'engine-state.json'), 'utf8')).toBe('{not json');
  });
});
