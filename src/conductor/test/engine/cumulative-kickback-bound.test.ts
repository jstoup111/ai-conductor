import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { coordinateBuildReviewRubrics } from '../../src/engine/build-review-coordinator.js';
import type { BuildReviewFrozenInputs } from '../../src/engine/build-review-inputs.js';
import { HALT_MARKER } from '../../src/engine/halt-marker.js';
import { readKickbackLedger, writeKickbackLedger } from '../../src/engine/kickback-ledger.js';
import { resolveBuildReviewConfig } from '../../src/engine/resolved-config.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { writeState } from '../../src/engine/state.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { HarnessConfig } from '../../src/types/config.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

vi.mock('../../src/engine/build-review-coordinator.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/build-review-coordinator.js')>(),
  coordinateBuildReviewRubrics: vi.fn(),
}));

describe('cumulative build-review kickback bound', () => {
  let dir: string;
  let statePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cumulative-kickback-bound-'));
    statePath = join(dir, 'conduct-state.json');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    git('init', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test User');
    await writeFile(join(dir, 'initial.txt'), 'initial\n');
    git('add', 'initial.txt');
    git('commit', '-m', 'initial');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function git(...args: string[]): void {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  }

  async function runFailLaps({
    cumulativeBoundEnabled,
    changedTrees,
    laps,
  }: {
    cumulativeBoundEnabled?: boolean;
    changedTrees: boolean;
    laps: number;
  }) {
    for (let lap = 1; lap <= laps; lap += 1) {
      await writeState(statePath, {
        run_started_at: 1,
        complexity_tier: 'S',
        track: 'technical',
        worktree: 'done', memory: 'done', explore: 'done', prd: 'done', stories: 'done',
        conflict_check: 'skipped', plan: 'done', architecture_diagram: 'skipped',
        architecture_review: 'skipped', acceptance_specs: 'skipped',
        wiring_check: 'skipped', test_suite: 'done',
      });

      const runner: StepRunner = {
        run: async (step) => {
          if (step === 'build_review') {
            await writeFile(join(dir, '.pipeline/build-review.json'), JSON.stringify({
              verdict: 'FAIL',
              rubric: { tautology: true, scope: false, rootCause: false, completeness: false },
              findings: { tautology: ['semantic failure remains'] },
            }));
          }
          if (step === 'build') {
            await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({
              tasks: [{ id: 't1', status: 'completed' }],
            }));
            if (changedTrees) {
              await writeFile(join(dir, `build-${lap}.txt`), `${lap}\n`);
              git('add', `build-${lap}.txt`);
              git('commit', '-m', `build ${lap}`);
            }
            throw new Error('stop after one lap');
          }
          return { success: true };
        },
      };

      await new Conductor({
        stateFilePath: statePath, stepRunner: runner, events: new ConductorEventEmitter(),
        projectRoot: dir, verifyArtifacts: true, mode: 'auto', daemon: true,
        fromStep: 'build_review', maxRetries: 1,
        config: {
          build_review: { enabled: true },
          kickback_escalation: { enabled: false },
          ...(cumulativeBoundEnabled === undefined
            ? {}
            : { cumulative_kickback_bound: { enabled: cumulativeBoundEnabled } }),
        },
        fullSuiteVerifier: {
          ensure: async () => ({ status: 'REUSED', evidence: {} as never }),
          inspect: async () => ({ status: 'CURRENT', evidence: {} as never }),
        },
      } as never).run().catch(() => {});

      const haltPath = join(dir, HALT_MARKER);
      if (existsSync(haltPath) && (await readFile(haltPath, 'utf8')).startsWith('conductor error:')) {
        await rm(haltPath);
      }
      if (existsSync(haltPath)) break;
    }

    const ledger = await readKickbackLedger(dir);
    return {
      halt: existsSync(join(dir, HALT_MARKER))
        ? await readFile(join(dir, HALT_MARKER), 'utf8')
        : null,
      entry: ledger.gates.build_review,
    };
  }

  it('continues ten changed-tree failures when the cumulative bound is disabled', async () => {
    await expect(runFailLaps({ cumulativeBoundEnabled: false, changedTrees: true, laps: 10 }))
      .resolves.toMatchObject({ halt: null, entry: { cumulative: 10, count: 1 } });
  });

  it('still applies the per-tree cap while the cumulative bound is disabled', async () => {
    const baseline = await runFailLaps({ cumulativeBoundEnabled: false, changedTrees: false, laps: 1 });
    await writeKickbackLedger(dir, {
      version: 1,
      gates: {
        build_review: {
          count: 2,
          cumulative: 2,
          treeHash: baseline.entry?.treeHash ?? null,
          lastReason: 'semantic failure remains',
          priorVerdict: true,
          resolvedBefore: 1,
        },
      },
    });

    await expect(runFailLaps({ cumulativeBoundEnabled: false, changedTrees: false, laps: 1 }))
      .resolves.toMatchObject({ halt: expect.stringMatching(/cap 2/i), entry: { cumulative: 3, count: 2 } });
  });

  it('halts on the sixth failure when the cumulative-bound block is absent', async () => {
    await expect(runFailLaps({ changedTrees: true, laps: 6 }))
      .resolves.toMatchObject({ halt: expect.stringMatching(/cumulative kickback cap exceeded/i), entry: { cumulative: 6, count: 1 } });
  });

  it('keeps semantic kickback state unchanged across mechanical laps but charges a mixed judged finding', async () => {
    const semanticEntry = {
      count: 1,
      cumulative: 4,
      mechanicalFaults: 0,
      treeHash: null,
      lastReason: 'existing semantic failure',
      priorVerdict: true,
      resolvedBefore: 7,
    };
    await writeKickbackLedger(dir, { version: 1, gates: { build_review: semanticEntry } });
    let mixedLap = false;
    vi.mocked(coordinateBuildReviewRubrics).mockImplementation(async () => ({
      kind: 'ready',
      branches: [
        { kind: 'infrastructure-failure', rubric: 'scope', reason: 'invalid-provider-result', detail: 'worker response unavailable' },
        ...(['tautology', 'rootCause', 'completeness'] as const).map((rubric) => ({ kind: 'dispatched' as const, rubric, result: {} as never })),
      ],
    }));
    const provider: LLMProvider = { invoke: vi.fn(), invokeInteractive: vi.fn() };
    const makeRunner = () => new DefaultStepRunner(provider, 'mechanical-lap', dir, {
      pipelineDir: join(dir, '.pipeline'),
      buildReviewEffectiveResolver: async () => ({
        ok: true,
        feature: { version: 'v1', repository: dir, feature: 'cumulative-kickback-bound' },
        effective: {
          rawVerdict: 'FAIL', verdict: 'FAIL', acceptedFindingIds: [], unresolvedFindingIds: [],
          skippedRubrics: [], infrastructureFailureRubrics: ['scope'],
        },
      }),
      buildReviewArtifactReader: async (_root, rubric, lapId, snapshotDigest, _fs) => ({
        version: 1,
        rubric,
        lapId,
        snapshotDigest,
        result: {
          kind: 'judged' as const,
          rubric,
          lapId,
          snapshotDigest,
          contractVersion: 'v3' as never,
          findings: mixedLap && rubric === 'rootCause'
            ? [{ concernKind: 'symptom-only-fix', summary: 'The root cause remains unresolved.', evidenceLocations: ['src/fix.ts:1'], anchor: { rubric: 'rootCause' as const, statedDefect: 'The root cause remains unresolved.', locus: { path: 'src/fix.ts', contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', display: 'unresolved root-cause region' }, relation: 'symptom-only-fix' } }]
            : [],
          verdict: mixedLap && rubric === 'rootCause' ? 'FAIL' as const : 'PASS' as const,
        },
        provenance: { kind: 'fresh' as const },
      }),
    });
    const runRubricLap = async (headSha: string) => (makeRunner() as unknown as {
      runRubricBuildReview: (inputs: BuildReviewFrozenInputs, config: ReturnType<typeof resolveBuildReviewConfig>) => Promise<{ success: boolean }>;
    }).runRubricBuildReview({
      sourceSnapshot: { headSha, digest: `sha256:${headSha}`, mergeBase: 'base' },
    } as BuildReviewFrozenInputs, resolveBuildReviewConfig({ build_review: { enabled: true } } as HarnessConfig));

    await runRubricLap('mechanical-one');
    await runRubricLap('mechanical-two');
    const afterMechanical = (await readKickbackLedger(dir)).gates.build_review!;

    mixedLap = true;
    await writeState(statePath, {
      run_started_at: 1,
      complexity_tier: 'S',
      track: 'technical',
      worktree: 'done', memory: 'done', explore: 'done', prd: 'done', stories: 'done',
      conflict_check: 'skipped', plan: 'done', architecture_diagram: 'skipped',
      architecture_review: 'skipped', acceptance_specs: 'skipped',
      wiring_check: 'skipped', test_suite: 'done',
    });
    let mixedBuildReviewRuns = 0;
    await new Conductor({
      stateFilePath: statePath,
      projectRoot: dir,
      events: new ConductorEventEmitter(),
      verifyArtifacts: true,
      mode: 'auto',
      daemon: true,
      fromStep: 'build_review',
      maxRetries: 1,
      config: { build_review: { enabled: true }, kickback_escalation: { enabled: false } },
      buildReviewEffectiveResolver: async () => ({
        ok: true,
        effective: {
          rawVerdict: 'FAIL', verdict: 'FAIL', acceptedFindingIds: [], unresolvedFindingIds: [],
          skippedRubrics: [], infrastructureFailureRubrics: ['scope'],
        },
      }),
      stepRunner: {
        run: async (step: string) => {
          if (step === 'build_review') {
            mixedBuildReviewRuns += 1;
            return runRubricLap('mixed-lap');
          }
          if (step === 'build') throw new Error('stop after mixed lap kickback');
          return { success: true };
        },
      },
      fullSuiteVerifier: {
        ensure: async () => ({ status: 'REUSED', evidence: {} as never }),
        inspect: async () => ({ status: 'CURRENT', evidence: {} as never }),
      },
    } as never).run().catch(() => {});

    expect({
      semanticStateAfterMechanical: {
        count: afterMechanical.count,
        cumulative: afterMechanical.cumulative,
        treeHash: afterMechanical.treeHash,
        lastReason: afterMechanical.lastReason,
        priorVerdict: afterMechanical.priorVerdict,
        resolvedBefore: afterMechanical.resolvedBefore,
      },
      mechanicalFaults: afterMechanical.mechanicalFaults,
      mixedBuildReviewRuns,
      mixedSemanticCount: (await readKickbackLedger(dir)).gates.build_review?.count,
      mixedSemanticCumulative: (await readKickbackLedger(dir)).gates.build_review?.cumulative,
    }).toEqual({
      semanticStateAfterMechanical: {
        count: semanticEntry.count,
        cumulative: semanticEntry.cumulative,
        treeHash: semanticEntry.treeHash,
        lastReason: semanticEntry.lastReason,
        priorVerdict: semanticEntry.priorVerdict,
        resolvedBefore: semanticEntry.resolvedBefore,
      },
      mechanicalFaults: 2,
      mixedBuildReviewRuns: 1,
      mixedSemanticCount: 1,
      mixedSemanticCumulative: semanticEntry.cumulative + 1,
    });
  });
});
