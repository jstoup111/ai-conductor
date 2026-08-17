/**
 * RED acceptance specs for #1487: a FINISH publication transition must move
 * the dimension it owns, and an already-halted PR must not be judged again.
 *
 * Stories: .docs/stories/finish-publication-burns-its-retry-budget-on-an-un.md
 * Plan:    .docs/plans/finish-publication-burns-its-retry-budget-on-an-un.md
 * ADR:     .docs/decisions/adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns.md
 *
 * Project shape: headless TypeScript CLI/daemon. The first suite drives the
 * real coordinator with an injected authoritative snapshot. The second drives
 * the production observer/coordinator composition with faithful local fakes at
 * the GitHub, Git, and provider boundaries; no third-party process is spawned.
 *
 * Acceptance classification:
 *   - Story 2: spec-covered here through the two non-converging judgment paths.
 *   - Story 4: spec-covered here through production PR observation.
 *   - Stories 1, 3, and 6: unit-covered by their plan tasks at the dimension,
 *     rendering, and three-way comparison seams.
 *   - Story 5: already tested by unattended-finish-publication and
 *     finish-publication-progress-budget acceptance suites.
 *
 * Production call sites exercised:
 *   - src/conductor/src/engine/finish-publication.ts#advanceFinishPublication
 *   - src/conductor/src/engine/finish-publication-production.ts#observePullRequest
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  advanceFinishPublication,
  advancedPublicationTransition,
  FINISH_PUBLICATION_PROGRESS_ALLOWANCE,
  type AdvanceFinishPublicationResult,
  type PublicationDisposition,
  type PublicationSnapshot,
  type PublicationTransition,
} from '../../src/engine/finish-publication.js';
import { createProductionFinishPublicationCoordinator } from '../../src/engine/finish-publication-production.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { readState, writeState } from '../../src/engine/state.js';
import type { ConductState, FinishPublicationEvent } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { Conductor } from '../test-conductor.js';

const PR_URL = 'https://github.com/acme/widget/pull/1487';
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function judgmentSnapshot(): PublicationSnapshot {
  return {
    mode: 'daemon',
    intent: {
      outcome: 'pr',
      authority: { kind: 'unattended_policy', mode: 'daemon' },
    },
    implementationEvidence: 'valid',
    shipEvidence: 'valid',
    releaseReadiness: 'valid',
    branchPushed: 'valid',
    pr: {
      identity: 'one',
      url: PR_URL,
      prose: 'stale',
      ready: false,
    },
    shippedRecord: 'valid',
    outcomeRecord: 'missing',
  };
}

function asProductionPublicationDisposition(
  result: AdvanceFinishPublicationResult,
): PublicationDisposition {
  return result.kind === 'advanced'
    ? { kind: 'publication_progress', transition: result.transition }
    : result;
}

describe('Story 2 — non-advancing judgment stops on its first occurrence', () => {
  it('halts Cycle A when the retry names an authoring stage the fresh snapshot cannot select', async () => {
    const snapshot = judgmentSnapshot();
    const observe = vi.fn(async () => structuredClone(snapshot));
    const emitted: FinishPublicationEvent[] = [];
    const dispatchJudgment = vi.fn(async () => ({
      kind: 'revision_required' as const,
      reason: 'placeholder' as const,
      detail: 'The title and body still look like placeholders.',
    }));

    const result = await advanceFinishPublication({
      observe,
      effects: { dispatchJudgment },
      emit: async (event) => { emitted.push(event); },
    });

    expect(result).toEqual(expect.objectContaining({
      kind: 'human_required',
      detail: expect.stringContaining('author_pr_prose'),
    }));
    expect((result as { detail?: string }).detail).toContain('judge_pr_prose');
    expect(emitted).not.toContainEqual({
      type: 'finish_publication_transition', phase: 'completed', transition: 'author_pr_prose',
    });
    expect(dispatchJudgment).toHaveBeenCalledTimes(1);
  });

  it('halts Cycle B when an accepted verdict leaves the observed prose dimension unchanged', async () => {
    const snapshot = judgmentSnapshot();
    const observe = vi.fn(async () => structuredClone(snapshot));
    const emitted: FinishPublicationEvent[] = [];
    const dispatchJudgment = vi.fn(async () => ({ kind: 'accepted' as const }));

    const result = await advanceFinishPublication({
      observe,
      effects: { dispatchJudgment },
      emit: async (event) => { emitted.push(event); },
    });

    expect(result).toEqual(expect.objectContaining({
      kind: 'human_required',
      detail: expect.stringContaining('judge_pr_prose'),
    }));
    expect((result as { detail?: string }).detail).toMatch(/prose/i);
    // FINISH increments its 14-transition allowance only from a completed
    // transition event. An unchanged accepted verdict must emit none, rather
    // than refunding fourteen non-advancing laps through the coordinator.
    expect(emitted).not.toContainEqual({
      type: 'finish_publication_transition', phase: 'completed', transition: 'judge_pr_prose',
    });
    expect(dispatchJudgment).toHaveBeenCalledTimes(1);

    // Keep the injected Cycle B snapshot seam, but route its actual
    // coordinator result through the counter-owning Conductor boundary.
    await expect(finishRetryEventsFor(
      asProductionPublicationDisposition(result),
      async () => asProductionPublicationDisposition(await advanceFinishPublication({
        observe,
        effects: { dispatchJudgment },
      })),
    )).resolves.toMatchObject({
      retryReasons: [],
      publicationDispositions: ['human_required'],
      finishStatus: 'failed',
    });
  });
});

function healthyPr(): Extract<PublicationSnapshot['pr'], { identity: 'one' }> {
  return {
    identity: 'one',
    url: PR_URL,
    prose: 'accepted',
    ready: true,
  };
}

function healthySnapshot(): PublicationSnapshot {
  return {
    mode: 'daemon',
    intent: {
      outcome: 'pr',
      authority: { kind: 'unattended_policy', mode: 'daemon' },
    },
    implementationEvidence: 'valid',
    shipEvidence: 'valid',
    releaseReadiness: 'valid',
    branchPushed: 'valid',
    pr: healthyPr(),
    shippedRecord: 'valid',
    outcomeRecord: 'missing',
  };
}

describe('Story 5 — legitimate publication revisits still advance', () => {
  it('recognizes every transition moving its own dimension on a legitimate revisit', async () => {
    const revisitCases: Array<{
      transition: PublicationTransition;
      before: PublicationSnapshot;
      after: PublicationSnapshot;
    }> = [
      {
        transition: 'establish_pr',
        before: { ...healthySnapshot(), branchPushed: 'missing' },
        after: healthySnapshot(),
      },
      {
        transition: 'verify_release_readiness',
        before: { ...healthySnapshot(), releaseReadiness: 'missing' },
        after: healthySnapshot(),
      },
      {
        transition: 'author_pr_prose',
        before: { ...healthySnapshot(), pr: { ...healthyPr(), prose: 'placeholder' } },
        after: { ...healthySnapshot(), pr: { ...healthyPr(), prose: 'stale' } },
      },
      {
        transition: 'judge_pr_prose',
        before: { ...healthySnapshot(), pr: { ...healthyPr(), prose: 'stale' } },
        after: healthySnapshot(),
      },
      {
        transition: 'write_shipped_record',
        before: { ...healthySnapshot(), shippedRecord: 'missing' },
        after: healthySnapshot(),
      },
      {
        transition: 'ready_pr',
        before: { ...healthySnapshot(), pr: { ...healthyPr(), ready: false } },
        after: healthySnapshot(),
      },
      {
        transition: 'record_outcome',
        before: healthySnapshot(),
        after: { ...healthySnapshot(), outcomeRecord: 'valid' },
      },
    ];

    await expect(Promise.all(revisitCases.map(({ transition, before, after }) =>
      advancedPublicationTransition(undefined, transition, before, after),
    ))).resolves.toEqual(revisitCases.map(({ transition }) => ({ kind: 'advanced', transition })));
  });

  it('advances establish_pr again after writing the shipped record leaves the branch unpushed', async () => {
    const afterWrite = {
      ...healthySnapshot(),
      branchPushed: 'missing' as const,
      shippedRecord: 'valid' as const,
    };
    const afterReestablish = healthySnapshot();

    await expect(
      advancedPublicationTransition(undefined, 'establish_pr', afterWrite, afterReestablish),
    ).resolves.toEqual({ kind: 'advanced', transition: 'establish_pr' });
  });

  it('completes a healthy publication run without human-required results or exhausting allowance', async () => {
    let snapshot: PublicationSnapshot = {
      ...healthySnapshot(),
      pr: { ...healthyPr(), prose: 'placeholder', ready: false },
      shippedRecord: 'missing',
    };
    const completedTransitions: PublicationTransition[] = [];
    const dispositions = [];
    const observe = async () => structuredClone(snapshot);
    const effects = {
      authorProse: async () => {
        snapshot = { ...snapshot, pr: { ...snapshot.pr, prose: 'stale' } } as PublicationSnapshot;
      },
      dispatchJudgment: async () => {
        snapshot = { ...snapshot, pr: { ...snapshot.pr, prose: 'accepted' } } as PublicationSnapshot;
        return { kind: 'accepted' as const };
      },
      createShippedRecord: async () => {
        snapshot = { ...snapshot, shippedRecord: 'valid' };
      },
      repairPresentation: async () => {
        snapshot = { ...snapshot, pr: { ...snapshot.pr, ready: true } } as PublicationSnapshot;
      },
      recordOutcome: async () => {
        snapshot = { ...snapshot, outcomeRecord: 'valid' };
      },
    };

    for (let attempt = 0; attempt < FINISH_PUBLICATION_PROGRESS_ALLOWANCE; attempt++) {
      const result = await advanceFinishPublication({
        observe,
        effects,
        emit: async (event) => {
          if (event.type === 'finish_publication_transition' && event.phase === 'completed') {
            completedTransitions.push(event.transition);
          }
        },
      });
      dispositions.push(result);
      if (result.kind === 'complete') break;
    }

    expect(dispositions.at(-1)).toEqual({ kind: 'complete' });
    expect(dispositions).not.toContainEqual(expect.objectContaining({ kind: 'human_required' }));
    expect(completedTransitions).toEqual([
      'author_pr_prose',
      'judge_pr_prose',
      'write_shipped_record',
      'ready_pr',
      'record_outcome',
    ]);
    expect(completedTransitions).toHaveLength(5);
    expect(completedTransitions.length).toBeLessThan(FINISH_PUBLICATION_PROGRESS_ALLOWANCE);
  });
});

interface ObservedPr {
  url: string;
  title: string;
  body: string;
  isDraft: boolean;
  labels: Array<{ name: string }>;
}

async function runProductionObservation(
  pr: ObservedPr,
  options: { failView?: boolean; shippedRecordPresent?: boolean } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'finish-publication-non-advance-'));
  roots.push(root);
  const pipeline = join(root, '.pipeline');
  await mkdir(pipeline, { recursive: true });
  const shippedDirectory = join(root, '.docs', 'shipped');
  await mkdir(shippedDirectory, { recursive: true });
  if (options.shippedRecordPresent !== false) {
    await writeFile(join(shippedDirectory, 'finish-publication-non-advance.md'), 'shipped\n');
  }
  const stateFilePath = join(pipeline, 'conduct-state.json');
  const state: ConductState = {
    feature_desc: 'finish-publication-non-advance',
    worktree_branch: 'feat/finish-publication-non-advance',
    pr_url: PR_URL,
    build_review: 'done',
    test_suite: 'done',
    manual_test: 'done',
    architecture_review_as_built: 'done',
  };
  const ghCalls: string[][] = [];
  const completedTransitions: PublicationTransition[] = [];
  const dispatchJudgment = vi.fn(async () => ({
    success: true,
    publicationDisposition: { kind: 'accepted' },
  }));
  const coordinator = createProductionFinishPublicationCoordinator({
    projectRoot: root,
    stateFilePath,
    baseBranch: 'main',
    git: async (args) => {
      if (args[0] === 'remote') return { stdout: 'origin\n' };
      if (args[0] === 'rev-parse') {
        return { stdout: 'refs/remotes/origin/feat/finish-publication-non-advance\n' };
      }
      if (args[0] === 'merge-base') return { stdout: '' };
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    },
    gh: async (args) => {
      ghCalls.push([...args]);
      if (args[0] === 'auth' && args[1] === 'status') return { stdout: '' };
      if (args[0] === 'pr' && args[1] === 'view') {
        if (options.failView) throw new Error('GitHub observation unavailable');
        return { stdout: JSON.stringify(pr) };
      }
      if (args[0] === 'pr' && args[1] === 'ready') {
        pr.isDraft = false;
        return { stdout: '' };
      }
      throw new Error(`unexpected gh command: ${args.join(' ')}`);
    },
    observeReleaseReadiness: async () => 'present',
    ...(options.shippedRecordPresent === false
      ? {
          writeShippedRecord: async () => {
            await writeFile(join(shippedDirectory, 'finish-publication-non-advance.md'), 'shipped\n');
            return 0;
          },
        }
      : {}),
  });

  const result = await coordinator.advance({
    state,
    mode: 'auto',
    daemon: true,
    dispatchJudgment,
    emit: async (event: FinishPublicationEvent) => {
      if (event.type === 'finish_publication_transition' && event.phase === 'completed') {
        completedTransitions.push(event.transition);
      }
    },
  });

  return { result, dispatchJudgment, ghCalls, completedTransitions };
}

async function finishRetryEventsFor(
  disposition: PublicationDisposition,
  advanceOverride?: () => Promise<PublicationDisposition>,
): Promise<{
  retryReasons: string[];
  publicationDispositions: string[];
  finishStatus: string | undefined;
}> {
  const root = await mkdtemp(join(tmpdir(), 'finish-publication-halt-counter-'));
  roots.push(root);
  const pipeline = join(root, '.pipeline');
  await mkdir(pipeline, { recursive: true });
  const state: Record<string, unknown> = {
    complexity_tier: 'M',
    feature_desc: 'finish-publication-halt-counter',
    track: 'technical',
  };
  for (const step of ALL_STEPS) {
    if (step.name === 'finish') break;
    state[step.name] = 'done';
  }
  const stateFilePath = join(pipeline, 'conduct-state.json');
  await writeState(stateFilePath, state as ConductState);

  const events = new ConductorEventEmitter();
  const retryReasons: string[] = [];
  const publicationDispositions: string[] = [];
  events.on('step_retry', (event) => {
    if (event.type === 'step_retry' && event.step === 'finish') retryReasons.push(event.reason);
  });
  events.on('finish_publication_disposition', (event) => {
    if (event.type === 'finish_publication_disposition') publicationDispositions.push(event.disposition);
  });
  const stepRunner: StepRunner = {
    run: vi.fn(async () => {
      throw new Error('the injected FINISH disposition should terminate this fixture');
    }),
  };
  const advance = vi.fn(async () => {
    return advanceOverride?.() ?? disposition;
  });
  const conductor = new Conductor({
    stateFilePath,
    stepRunner,
    finishPublication: { advance } as never,
    events,
    projectRoot: root,
    fromStep: 'finish',
    mode: 'auto',
    daemon: true,
    verifyArtifacts: false,
    git: async () => ({ stdout: '' }),
    gh: async () => ({ stdout: '' }),
    runGh: async () => ({ stdout: '' }),
    escalateBuildFailure: vi.fn(async () => ({})),
  });

  await conductor.run();
  const persisted = await readState(stateFilePath);
  return {
    retryReasons,
    publicationDispositions,
    finishStatus: persisted.ok ? persisted.value.finish : undefined,
  };
}

describe('Story 4 — production observation recognizes a halt-state PR before judgment', () => {
  it.each([
    [
      'needs-remediation label only',
      {
        url: PR_URL,
        title: 'feat: ordinary authored title',
        body: 'Reader-facing summary and validation evidence.',
        isDraft: true,
        labels: [{ name: 'needs-remediation' }],
      },
    ],
    [
      'needs-remediation body marker only',
      {
        url: PR_URL,
        title: 'feat: ordinary authored title',
        body: '<!-- conductor:needs-remediation -->\n\nReader-facing summary.',
        isDraft: true,
        labels: [],
      },
    ],
    [
      'mixed-case Needs-remediation title prefix only',
      {
        url: PR_URL,
        title: 'Needs-remediation: operator review required',
        body: 'Reader-facing summary and validation evidence.',
        isDraft: true,
        labels: [],
      },
    ],
    [
      'residual needs-remediation label beside ordinary authored prose',
      {
        url: PR_URL,
        title: 'feat: ordinary authored title',
        body: 'Reader-facing summary and validation evidence.',
        isDraft: false,
        labels: [{ name: 'needs-remediation' }],
      },
    ],
  ] satisfies Array<[string, ObservedPr]>)('resolves %s as human-required with zero judgment sessions', async (_name, pr) => {
    const {
      result,
      dispatchJudgment,
      ghCalls,
      completedTransitions,
    } = await runProductionObservation(pr);

    expect(result).toEqual(expect.objectContaining({ kind: 'human_required' }));
    expect(dispatchJudgment).not.toHaveBeenCalled();
    // A halt is terminal at observation: it neither retries FINISH nor spends
    // a verified-publication progress slot.
    expect(completedTransitions).toEqual([]);
    await expect(finishRetryEventsFor(result)).resolves.toMatchObject({
      retryReasons: [],
      publicationDispositions: ['human_required'],
      finishStatus: 'failed',
    });
    const viewCall = ghCalls.find((args) => args[0] === 'pr' && args[1] === 'view');
    expect(viewCall?.join(' ')).toContain('labels');
  });

  it.each([
    ['an empty label list', []],
    ['an unrelated documentation label', [{ name: 'documentation' }]],
  ])('makes no halt claim for %s and judges ordinary authored prose exactly once', async (_name, labels) => {
    const { result, dispatchJudgment, ghCalls } = await runProductionObservation({
      url: PR_URL,
      title: 'feat: ordinary authored title',
      body: 'Reader-facing summary and validation evidence.',
      isDraft: true,
      labels,
    }, { shippedRecordPresent: false });

    expect(result).not.toEqual(expect.objectContaining({ kind: 'human_required' }));
    expect(result).toEqual({ kind: 'publication_progress', transition: 'judge_pr_prose' });
    expect(dispatchJudgment).toHaveBeenCalledTimes(1);
    expect(ghCalls.find((args) => args[0] === 'pr' && args[1] === 'view')).toEqual(
      expect.arrayContaining(['--json', 'url,title,body,isDraft,labels']),
    );
  });

  it('takes the degraded-observation path when gh pr view fails without claiming halt state', async () => {
    const { result, dispatchJudgment, completedTransitions, ghCalls } = await runProductionObservation({
      url: PR_URL,
      title: 'feat: ordinary authored title',
      body: 'Reader-facing summary and validation evidence.',
      isDraft: true,
      labels: [],
    }, { failView: true });

    expect(result).not.toEqual(expect.objectContaining({ kind: 'human_required' }));
    expect(dispatchJudgment).not.toHaveBeenCalled();
    expect(completedTransitions).toEqual([]);
    expect(ghCalls.find((args) => args[0] === 'pr' && args[1] === 'view')).toEqual(
      expect.arrayContaining(['--json', 'url,title,body,isDraft,labels']),
    );
  });
});
