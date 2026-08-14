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
  type PublicationSnapshot,
} from '../../src/engine/finish-publication.js';
import { createProductionFinishPublicationCoordinator } from '../../src/engine/finish-publication-production.js';
import type { ConductState, FinishPublicationEvent } from '../../src/types/index.js';

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

describe('Story 2 — non-advancing judgment stops on its first occurrence', () => {
  it('halts Cycle A when the retry names an authoring stage the fresh snapshot cannot select', async () => {
    const snapshot = judgmentSnapshot();
    const observe = vi.fn(async () => structuredClone(snapshot));
    const dispatchJudgment = vi.fn(async () => ({
      kind: 'revision_required' as const,
      reason: 'placeholder' as const,
      detail: 'The title and body still look like placeholders.',
    }));

    const result = await advanceFinishPublication({
      observe,
      effects: { dispatchJudgment },
    });

    expect(result).toEqual(expect.objectContaining({
      kind: 'human_required',
      detail: expect.stringContaining('author_pr_prose'),
    }));
    expect((result as { detail?: string }).detail).toContain('judge_pr_prose');
    expect(dispatchJudgment).toHaveBeenCalledTimes(1);
  });

  it('halts Cycle B when an accepted verdict leaves the observed prose dimension unchanged', async () => {
    const snapshot = judgmentSnapshot();
    const observe = vi.fn(async () => structuredClone(snapshot));
    const dispatchJudgment = vi.fn(async () => ({ kind: 'accepted' as const }));

    const result = await advanceFinishPublication({
      observe,
      effects: { dispatchJudgment },
    });

    expect(result).toEqual(expect.objectContaining({
      kind: 'human_required',
      detail: expect.stringContaining('judge_pr_prose'),
    }));
    expect((result as { detail?: string }).detail).toMatch(/prose/i);
    expect(dispatchJudgment).toHaveBeenCalledTimes(1);
  });
});

interface ObservedPr {
  url: string;
  title: string;
  body: string;
  isDraft: boolean;
  labels: Array<{ name: string }>;
}

async function runProductionObservation(pr: ObservedPr) {
  const root = await mkdtemp(join(tmpdir(), 'finish-publication-non-advance-'));
  roots.push(root);
  const pipeline = join(root, '.pipeline');
  await mkdir(pipeline, { recursive: true });
  const shippedDirectory = join(root, '.docs', 'shipped');
  await mkdir(shippedDirectory, { recursive: true });
  await writeFile(join(shippedDirectory, 'finish-publication-non-advance.md'), 'shipped\n');
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
        return { stdout: JSON.stringify(pr) };
      }
      if (args[0] === 'pr' && args[1] === 'ready') {
        pr.isDraft = false;
        return { stdout: '' };
      }
      throw new Error(`unexpected gh command: ${args.join(' ')}`);
    },
    observeReleaseReadiness: async () => 'present',
  });

  const result = await coordinator.advance({
    state,
    mode: 'auto',
    daemon: true,
    dispatchJudgment,
    emit: async (_event: FinishPublicationEvent) => undefined,
  });

  return { result, dispatchJudgment, ghCalls };
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
  ] satisfies Array<[string, ObservedPr]>)('resolves %s as human-required with zero judgment sessions', async (_name, pr) => {
    const { result, dispatchJudgment, ghCalls } = await runProductionObservation(pr);

    expect(result).toEqual(expect.objectContaining({ kind: 'human_required' }));
    expect(dispatchJudgment).not.toHaveBeenCalled();
    const viewCall = ghCalls.find((args) => args[0] === 'pr' && args[1] === 'view');
    expect(viewCall?.join(' ')).toContain('labels');
  });

  it('leaves ordinary authored prose with no halt signal on the normal publication path', async () => {
    const { result, dispatchJudgment } = await runProductionObservation({
      url: PR_URL,
      title: 'feat: ordinary authored title',
      body: 'Reader-facing summary and validation evidence.',
      isDraft: true,
      labels: [],
    });

    expect(result).toEqual({ kind: 'publication_progress', transition: 'ready_pr' });
    expect(dispatchJudgment).not.toHaveBeenCalled();
  });
});
