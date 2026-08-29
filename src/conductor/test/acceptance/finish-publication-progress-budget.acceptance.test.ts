/**
 * RED acceptance specs for #1342: verified FINISH publication progress is not
 * a retry.
 *
 * Stories: .docs/stories/a-successful-finish-publication-transition-consume.md
 * Plan:    .docs/plans/a-successful-finish-publication-transition-consume.md
 * ADRs:    .docs/decisions/adr-2026-08-06-publication-progress-is-its-own-disposition.md
 *          .docs/decisions/adr-2026-08-06-bounded-progress-allowance-for-finish-publication.md
 *
 * Project shape: headless TypeScript CLI/daemon. These specs drive the real
 * `Conductor.run()` FINISH retry loop. The injected publication coordinator is
 * the production adapter seam; it supplies deterministic internal outcomes and
 * makes no GitHub, provider, process, or network calls.
 *
 * Acceptance classification:
 *   - #2006 Story 4: spec-covered here through bounded non-converging and
 *     converging author-then-judge revision laps (Covers: S4.1, S4.2, S4.4, task:9).
 *   - Stories 2 and 5: spec-covered here through the full FINISH accounting
 *     flow, including the observed healthy establish/write/establish revisit.
 *   - Story 3: spec-covered here through the bounded re-entry and HALT flow.
 *   - Story 1: unit-covered by plan Tasks 1-3 at the disposition, validator,
 *     route, and production-adapter seams.
 *   - Story 4: already tested by
 *     test/engine/conductor-finish-publication.test.ts (failure budget,
 *     exhaustion, non-retryable, BUILD, human-required, and malformed paths).
 */

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StepRunner } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { Conductor } from '../test-conductor.js';

const PUBLICATION_TRANSITIONS = [
  'establish_pr',
  'verify_release_readiness',
  'author_pr_prose',
  'write_shipped_record',
  'judge_pr_prose',
  'ready_pr',
  'record_outcome',
] as const;

type PublicationTransition = (typeof PUBLICATION_TRANSITIONS)[number];

type ScenarioDisposition =
  | { kind: 'publication_progress'; transition: PublicationTransition }
  | {
      kind: 'publication_revision_progress';
      transition: 'author_pr_prose';
      detail?: string;
    }
  | {
      kind: 'publication_retry';
      transition: PublicationTransition;
      reason: 'presentation_repair_failed';
      detail?: string;
    }
  | { kind: 'complete' };

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createFinishState(): Promise<{ root: string; stateFilePath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'finish-publication-progress-budget-'));
  roots.push(root);
  const pipeline = join(root, '.pipeline');
  await mkdir(pipeline, { recursive: true });
  const stateFilePath = join(pipeline, 'conduct-state.json');
  const state: Record<string, unknown> = {
    complexity_tier: 'S',
    feature_desc: 'finish-publication-progress-budget',
    track: 'technical',
  };
  for (const step of ALL_STEPS) {
    if (step.name === 'finish') break;
    state[step.name] = 'done';
  }
  state.finish = 'pending';
  await writeState(stateFilePath, state as ConductState);
  return { root, stateFilePath };
}

async function runFinishScenario(
  dispositions: readonly ScenarioDisposition[],
  maxRetries = 6,
): Promise<{
  root: string;
  advanceCalls: number;
  completedTransitions: PublicationTransition[];
  retryReasons: string[];
}> {
  const { root, stateFilePath } = await createFinishState();
  const events = new ConductorEventEmitter();
  const completedTransitions: PublicationTransition[] = [];
  const retryReasons: string[] = [];
  events.on('finish_publication_transition', (event) => {
    if (event.type === 'finish_publication_transition' && event.phase === 'completed') {
      completedTransitions.push(event.transition as PublicationTransition);
    }
  });
  events.on('step_retry', (event) => {
    if (event.type === 'step_retry' && event.step === 'finish') retryReasons.push(event.reason);
  });

  let advanceCalls = 0;
  const finishPublication = {
    advance: vi.fn(async ({ emit }: { emit: (event: never) => Promise<void> }) => {
      const disposition = dispositions[advanceCalls] ?? { kind: 'complete' as const };
      advanceCalls++;
      if (disposition.kind === 'publication_progress') {
        await emit({
          type: 'finish_publication_transition',
          phase: 'completed',
          transition: disposition.transition,
        } as never);
      }
      return disposition;
    }),
  };
  const stepRunner: StepRunner = {
    run: vi.fn(async () => {
      throw new Error('the publication coordinator should own this FINISH flow');
    }),
  };
  const conductor = new Conductor({
    stateFilePath,
    stepRunner,
    finishPublication: finishPublication as never,
    events,
    projectRoot: root,
    fromStep: 'finish',
    mode: 'auto',
    daemon: false,
    verifyArtifacts: false,
    maxRetries,
    git: async () => ({ stdout: '' }),
    gh: async () => ({ stdout: '' }),
    runGh: async () => ({ stdout: '' }),
    escalateBuildFailure: vi.fn(async () => ({})),
  });

  await conductor.run();
  return { root, advanceCalls, completedTransitions, retryReasons };
}

describe('FINISH publication progress accounting', () => {
  it('completes a healthy publication revisit with zero retry consumption', async () => {
    const healthyReplay: readonly ScenarioDisposition[] = [
      { kind: 'publication_progress', transition: 'establish_pr' },
      { kind: 'publication_progress', transition: 'write_shipped_record' },
      { kind: 'publication_progress', transition: 'establish_pr' },
      { kind: 'publication_progress', transition: 'ready_pr' },
      { kind: 'publication_progress', transition: 'record_outcome' },
      { kind: 'complete' },
    ];

    const result = await runFinishScenario(healthyReplay);

    expect(result.advanceCalls).toBe(6);
    expect(result.retryReasons).toEqual([]);
    expect(result.completedTransitions).toEqual([
      'establish_pr',
      'write_shipped_record',
      'establish_pr',
      'ready_pr',
      'record_outcome',
    ]);
    await expect(readFile(join(result.root, '.pipeline/HALT'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('keeps the full failure allowance after five successful advances', async () => {
    const result = await runFinishScenario([
      { kind: 'publication_progress', transition: 'establish_pr' },
      { kind: 'publication_progress', transition: 'write_shipped_record' },
      { kind: 'publication_progress', transition: 'judge_pr_prose' },
      { kind: 'publication_progress', transition: 'ready_pr' },
      { kind: 'publication_progress', transition: 'record_outcome' },
      {
        kind: 'publication_retry',
        transition: 'ready_pr',
        reason: 'presentation_repair_failed',
      },
      { kind: 'complete' },
    ], 2);

    expect(result.advanceCalls).toBe(7);
    expect(result.retryReasons).toEqual([
      'FINISH publication retry: presentation_repair_failed',
    ]);
    await expect(readFile(join(result.root, '.pipeline/HALT'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('halts alternating progress at the total allowance and names the last transition', async () => {
    // Two passes over each of the seven publication transitions.
    const stuck = Array.from({ length: 14 }, (_, index): ScenarioDisposition => ({
      kind: 'publication_progress',
      transition: index % 2 === 0 ? 'establish_pr' : 'ready_pr',
    }));

    const result = await runFinishScenario(stuck);

    expect(result.advanceCalls).toBe(14);
    expect(result.retryReasons).toEqual([]);
    await expect(readFile(join(result.root, '.pipeline/HALT'), 'utf8')).resolves.toContain(
      'ready_pr',
    );
    await expect(readFile(join(result.root, '.pipeline/HALT.class'), 'utf8')).resolves.toBe(
      'needs-human',
    );
  });

  // Covers: S4.1, S4.2, task:9
  it('bounds an always-deficient author-judge revision lap and preserves the last objection', async () => {
    const objection = 'The PR body still omits the concrete validation evidence.';
    const nonConvergingLap = Array.from(
      { length: 14 },
      (): readonly ScenarioDisposition[] => [
        {
          kind: 'publication_revision_progress',
          transition: 'author_pr_prose',
          detail: objection,
        },
        { kind: 'publication_progress', transition: 'author_pr_prose' },
      ],
    ).flat();

    const result = await runFinishScenario(nonConvergingLap);

    // A judged deficiency and its resulting authoring pass are both FINISH
    // publication advances. Together they spend the pre-existing allowance;
    // neither may fall back to the ordinary retry budget.
    expect(result.advanceCalls).toBe(14);
    expect(result.retryReasons).toEqual([]);
    expect(result.completedTransitions).toHaveLength(7);
    expect(result.completedTransitions).toEqual(
      Array.from({ length: 7 }, () => 'author_pr_prose'),
    );
    await expect(readFile(join(result.root, '.pipeline/HALT'), 'utf8')).resolves.toMatch(
      new RegExp(`progress allowance exhausted after 14 transition\\(s\\);[\\s\\S]*${objection}`),
    );
    await expect(readFile(join(result.root, '.pipeline/HALT.class'), 'utf8')).resolves.toBe(
      'needs-human',
    );
  });

  // Covers: S4.4, task:9
  it('publishes after the second revision is accepted without exhausting the allowance', async () => {
    const convergingLap: readonly ScenarioDisposition[] = [
      {
        kind: 'publication_revision_progress',
        transition: 'author_pr_prose',
        detail: 'The first revision needs a concrete validation section.',
      },
      { kind: 'publication_progress', transition: 'author_pr_prose' },
      { kind: 'publication_progress', transition: 'judge_pr_prose' },
      { kind: 'publication_progress', transition: 'write_shipped_record' },
      { kind: 'publication_progress', transition: 'ready_pr' },
      { kind: 'publication_progress', transition: 'record_outcome' },
      { kind: 'complete' },
    ];

    const result = await runFinishScenario(convergingLap);

    expect(result.advanceCalls).toBe(convergingLap.length);
    expect(result.retryReasons).toEqual([]);
    expect(result.completedTransitions).toEqual([
      'author_pr_prose',
      'judge_pr_prose',
      'write_shipped_record',
      'ready_pr',
      'record_outcome',
    ]);
    await expect(readFile(join(result.root, '.pipeline/HALT'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
