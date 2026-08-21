import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createProductionFinishPublicationCoordinator,
  createProductionReleaseReadinessObserver,
  publishAcceptedBuildReviewRiskToRetainedPr,
} from '../../src/engine/finish-publication-production.js';
import { canonicalizeBuildReviewFindingIdentity } from '../../src/engine/build-review-finding-identity.js';
import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import { joinBuildReviewRubricOutcomes } from '../../src/engine/build-review-aggregate.js';
import type { BuildReviewDispositionRecord } from '../../src/engine/build-review-dispositions.js';
import { routeFinishPublicationDisposition } from '../../src/engine/finish-publication.js';
import { PR_BODY_FLOOR_MARKER } from '../../src/engine/halt-pr-rehabilitation.js';
import { HALT_PR_BANNER_SENTINEL } from '../../src/engine/pr-labels.js';
import type { dispatchFinishRecord } from '../../src/engine/finish-record-cli.js';
import type { ConductState } from '../../src/types/index.js';

const commandResult = { stdout: '' };

describe('production FINISH publication composition', () => {
  it('upserts accepted build-review risk into the retained PR and blocks unrenderable records', async () => {
    const finding = canonicalizeBuildReviewFindingIdentity({
      rubric: 'scope', contractVersion: 'v1', concernKind: 'out-of-plan-change',
      anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'out-of-plan-change' },
    })!;
    const accepted: BuildReviewDispositionRecord = {
      version: 'v1', feature: { version: 'v1', repository: 'github.com/acme/conductor', feature: 'review-rubrics' },
      finding, sourceLapId: parseBuildReviewLapId('lap-7')!, summary: 'summary', rationale: 'reason', operator: 'james', acceptedAt: '2026-08-14T12:00:00.000Z',
    };
    const gh = vi.fn(async () => commandResult);

    await expect(publishAcceptedBuildReviewRiskToRetainedPr({
      prUrl: 'https://github.com/acme/conductor/pull/1', body: '## Summary', records: [accepted], gh, cwd: '/project',
    })).resolves.toEqual({ ok: true, changed: true });
    expect(gh).toHaveBeenCalledWith(expect.arrayContaining(['pr', 'edit', 'https://github.com/acme/conductor/pull/1', '--body']), { cwd: '/project' });
    await expect(publishAcceptedBuildReviewRiskToRetainedPr({
      prUrl: 'https://github.com/acme/conductor/pull/1', body: '## Summary', records: [{ ...accepted, rationale: '' }], gh, cwd: '/project',
    })).resolves.toMatchObject({ ok: false });
  });

  it('reports a verified advance as publication progress', async () => {
    const advanceFinishPublication = vi.fn(async () => ({
      kind: 'advanced' as const,
      transition: 'write_shipped_record' as const,
    }));
    vi.resetModules();
    vi.doMock('../../src/engine/finish-publication.js', async () => ({
      ...await vi.importActual('../../src/engine/finish-publication.js'),
      advanceFinishPublication,
    }));

    try {
      const { createProductionFinishPublicationCoordinator: createCoordinator } = await import(
        '../../src/engine/finish-publication-production.js'
      );
      const coordinator = createCoordinator({
        projectRoot: '/project',
        stateFilePath: '/project/.pipeline/conduct-state.json',
        baseBranch: 'main',
        git: async () => commandResult,
        gh: async () => commandResult,
      });

      await expect(coordinator.advance({
        state: {} as ConductState,
        mode: 'auto',
        daemon: true,
        dispatchJudgment: async () => ({ success: true }),
        emit: async () => {},
      })).resolves.toEqual({ kind: 'publication_progress', transition: 'write_shipped_record' });
    } finally {
      vi.doUnmock('../../src/engine/finish-publication.js');
      vi.resetModules();
    }
  });

  it('refuses FINISH publication when the shipped-record dispatch reports required-evidence failure', async () => {
    const advanceFinishPublication = vi.fn(async (input: { effects: { createShippedRecord?: () => Promise<void> } }) => {
      await input.effects.createShippedRecord!();
      return { kind: 'advanced' as const, transition: 'write_shipped_record' as const };
    });
    vi.resetModules();
    vi.doMock('../../src/engine/finish-publication.js', async () => ({
      ...await vi.importActual('../../src/engine/finish-publication.js'),
      advanceFinishPublication,
    }));

    try {
      const { createProductionFinishPublicationCoordinator: createCoordinator } = await import(
        '../../src/engine/finish-publication-production.js'
      );
      const writeShippedRecord = vi.fn(async () => 1);
      const coordinator = createCoordinator({
        projectRoot: '/project', stateFilePath: '/project/.pipeline/conduct-state.json', baseBranch: 'main',
        git: async () => commandResult, gh: async () => commandResult, writeShippedRecord,
      });

      await expect(coordinator.advance({
        state: { feature_desc: 'feature', pr_url: 'https://example.test/pr/1' } as ConductState,
        mode: 'auto', daemon: true, dispatchJudgment: async () => ({ success: true }), emit: async () => {},
      })).rejects.toThrow('required shipped-record accepted-risk evidence');
      expect(writeShippedRecord).toHaveBeenCalledOnce();
    } finally {
      vi.doUnmock('../../src/engine/finish-publication.js');
      vi.resetModules();
    }
  });

  it('passes a genuine establish-PR verification failure through as a FINISH retry', async () => {
    const advanceFinishPublication = vi.fn(async () => ({
      kind: 'publication_retry' as const,
      transition: 'establish_pr' as const,
      reason: 'pr_identity_not_verified_after_establish',
    }));
    vi.resetModules();
    vi.doMock('../../src/engine/finish-publication.js', async () => ({
      ...await vi.importActual('../../src/engine/finish-publication.js'),
      advanceFinishPublication,
    }));

    try {
      const { createProductionFinishPublicationCoordinator: createCoordinator } = await import(
        '../../src/engine/finish-publication-production.js'
      );
      const coordinator = createCoordinator({
        projectRoot: '/project',
        stateFilePath: '/project/.pipeline/conduct-state.json',
        baseBranch: 'main',
        git: async () => commandResult,
        gh: async () => commandResult,
      });

      const disposition = await coordinator.advance({
        state: {} as ConductState,
        mode: 'auto',
        daemon: true,
        dispatchJudgment: async () => ({ success: true }),
        emit: async () => {},
      });

      expect(disposition).toEqual({
        kind: 'publication_retry',
        transition: 'establish_pr',
        reason: 'pr_identity_not_verified_after_establish',
      });
      expect(routeFinishPublicationDisposition(disposition)).toEqual({
        kind: 'retry_finish',
        reason: 'pr_identity_not_verified_after_establish',
      });
    } finally {
      vi.doUnmock('../../src/engine/finish-publication.js');
      vi.resetModules();
    }
  });

  it.each([
    ['missing', 'missing'],
    ['stale', 'stale'],
    ['malformed', 'malformed'],
    ['unavailable', 'unavailable'],
    ['present', 'present'],
  ] as const)('observes configured release-readiness evidence as %s', async (fixture, expected) => {
    const root = await mkdtemp(join(tmpdir(), 'finish-production-readiness-observer-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);
      const marker = join(pipeline, 'release-disposition-pass');
      const runStartedAt = Date.UTC(2026, 7, 1, 12, 0, 0);
      if (fixture === 'stale' || fixture === 'present') {
        await writeFile(marker, 'PASS\n');
        const markerDate = new Date(
          runStartedAt + (fixture === 'present' ? 60_000 : -60_000),
        );
        await utimes(marker, markerDate, markerDate);
      } else if (fixture === 'malformed') {
        await mkdir(marker);
      }
      const observer = createProductionReleaseReadinessObserver({
        projectRoot: root,
        config: {
          steps: {
            'release-disposition': {
              completion_artifact: '.pipeline/release-disposition-pass',
            },
          },
        },
      });
      const state = {
        ...({ 'release-disposition': 'done' } as Record<string, unknown>),
        ...(fixture === 'unavailable'
          ? {}
          : { run_started_at: runStartedAt, session_started_at: runStartedAt + 60_000 }),
      } as ConductState;

      await expect(observer(state)).resolves.toBe(expected);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed when release-readiness observation is not composed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finish-production-readiness-unwired-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);
      await mkdir(join(root, '.docs', 'shipped'), { recursive: true });
      await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
      await writeFile(join(root, '.docs', 'shipped', 'feature.md'), 'shipped\n');
      const prUrl = 'https://github.com/acme/widget/pull/1172';
      const gh = vi.fn(async (args: string[]) => {
        if (args[0] === 'auth') return commandResult;
        if (args[0] === 'pr' && args[1] === 'view') {
          return {
            stdout: JSON.stringify({
              url: prUrl,
              title: 'feat: publish coherent finish',
              body: 'Reader-facing summary.',
              isDraft: true,
            }),
          };
        }
        throw new Error(`unexpected GitHub mutation: ${args.join(' ')}`);
      });
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root,
        stateFilePath: join(pipeline, 'conduct-state.json'),
        baseBranch: 'main',
        git: async (args) => args[0] === 'remote'
          ? { stdout: 'origin\n' }
          : { stdout: 'refs/remotes/origin/feat/feature\n' },
        gh,
      });

      const result = await coordinator.advance({
        state: {
          feature_desc: 'feature',
          worktree_branch: 'feat/feature',
          pr_url: prUrl,
          build_review: 'done',
          test_suite: 'done',
          manual_test: 'done',
          architecture_review_as_built: 'done',
        } as ConductState,
        mode: 'auto',
        daemon: true,
        dispatchJudgment: vi.fn(async () => ({ success: true })),
        emit: async () => {},
      });

      expect(result).toEqual({
        kind: 'publication_retry',
        condition: {
          code: 'release_readiness_indeterminate',
          message: 'Release readiness could not be determined. Restore the readiness observer, then retry FINISH.',
          nextAction: 'restore_release_readiness_observation',
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    {
      label: 'missing',
      observe: async () => 'missing' as const,
      condition: {
        code: 'release_readiness_missing',
        message: 'Release readiness is missing. Publish a valid release readiness result, then retry FINISH.',
        nextAction: 'publish_release_readiness',
      },
    },
    ...(['stale', 'malformed'] as const).map((observation) => ({
      label: observation,
      observe: async () => observation,
      condition: {
        code: 'release_readiness_invalid',
        message: 'Release readiness is invalid. Restore a valid release readiness result, then retry FINISH.',
        nextAction: 'restore_release_readiness',
      },
    })),
    {
      label: 'unavailable',
      observe: async (): Promise<never> => { throw new Error('readiness store unavailable'); },
      condition: {
        code: 'release_readiness_indeterminate',
        message: 'Release readiness could not be determined. Restore the readiness observer, then retry FINISH.',
        nextAction: 'restore_release_readiness_observation',
      },
    },
  ])('blocks $label release readiness before judgment or publication mutation', async ({ observe, condition }) => {
    const root = await mkdtemp(join(tmpdir(), 'finish-production-readiness-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);
      await mkdir(join(root, '.docs', 'shipped'), { recursive: true });
      await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
      await writeFile(join(root, '.docs', 'shipped', 'feature.md'), 'shipped\n');
      const prUrl = 'https://github.com/acme/widget/pull/1172';
      const git = vi.fn(async (args: string[]) => {
        if (args[0] === 'remote') return { stdout: 'origin\n' };
        if (args[0] === 'rev-parse') return { stdout: 'refs/remotes/origin/feat/feature\n' };
        return commandResult;
      });
      const gh = vi.fn(async (args: string[]) => {
        if (args[0] === 'auth') return commandResult;
        if (args[0] === 'pr' && args[1] === 'view' && args[2] === prUrl) {
          return {
            stdout: JSON.stringify({
              url: prUrl,
              title: 'feat: publish coherent finish',
              body: 'Reader-facing summary.',
              isDraft: true,
            }),
          };
        }
        throw new Error(`unexpected GitHub mutation: ${args.join(' ')}`);
      });
      const dispatchJudgment = vi.fn(async () => ({ success: true }));
      const writeShippedRecord = vi.fn(async () => 0);
      const recordFinish = vi.fn(async () => 0);
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root,
        stateFilePath: join(pipeline, 'conduct-state.json'),
        baseBranch: 'main',
        git,
        gh,
        observeReleaseReadiness: observe,
        writeShippedRecord,
        recordFinish,
      });

      const result = await coordinator.advance({
        state: {
          feature_desc: 'feature',
          worktree_branch: 'feat/feature',
          pr_url: prUrl,
          build_review: 'done',
          test_suite: 'done',
          manual_test: 'done',
          architecture_review_as_built: 'done',
        } as ConductState,
        mode: 'auto',
        daemon: true,
        dispatchJudgment,
        emit: async () => {},
      });

      expect(result).toEqual({
        kind: 'publication_retry',
        condition,
      });
      expect(dispatchJudgment).not.toHaveBeenCalled();
      expect(gh.mock.calls.some(([args]) => args[0] === 'pr' && ['create', 'ready'].includes(args[1]!))).toBe(false);
      expect(writeShippedRecord).not.toHaveBeenCalled();
      expect(recordFinish).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('establishes a missing draft PR against the supplied base branch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finish-production-establish-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);

      const state = {
        feature_desc: 'feature',
        worktree_branch: 'feat/feature',
        build_review: 'done',
        test_suite: 'done',
        manual_test: 'done',
        architecture_review_as_built: 'done',
      } as ConductState;
      const prUrl = 'https://github.com/acme/widget/pull/1172';
      const git = vi.fn(async (args: string[]) => {
        if (args[0] === 'remote') return { stdout: 'origin\n' };
        if (args[0] === 'rev-list') return { stdout: '1\n' };
        if (args[0] === 'rev-parse') return { stdout: 'refs/remotes/origin/feat/feature\n' };
        return { stdout: '' };
      });
      const gh = vi.fn(async (args: string[]) => {
        if (args[0] === 'auth') return { stdout: '' };
        if (args[0] === 'pr' && args[1] === 'view' && args[2] === 'feat/feature') {
          throw new Error('no open PR');
        }
        if (args[0] === 'pr' && args[1] === 'create') {
          return { stdout: `${prUrl}\n` };
        }
        if (args[0] === 'pr' && args[1] === 'view' && args[2] === prUrl) {
          return { stdout: JSON.stringify({ url: prUrl, title: 'draft', body: 'draft', isDraft: true }) };
        }
        return { stdout: '' };
      });
      const events: unknown[] = [];
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root,
        stateFilePath: join(pipeline, 'conduct-state.json'),
        git,
        gh,
        baseBranch: 'trunk',
        observeReleaseReadiness: async () => 'present',
      });

      await expect(
        coordinator.advance({
          state,
          mode: 'auto',
          daemon: true,
          dispatchJudgment: async () => ({ success: true, publicationDisposition: { kind: 'accepted' } }),
          emit: async (event) => { events.push(event); },
        }),
      ).resolves.toEqual({ kind: 'publication_progress', transition: 'establish_pr' });

      await expect(readFile(join(pipeline, 'conduct-state.json'), 'utf8')).resolves.toContain(`"pr_url": "${prUrl}"`);
      expect(git).toHaveBeenCalledWith(['rev-list', '--count', 'trunk..HEAD'], { cwd: root });
      expect(gh).toHaveBeenCalledWith(expect.arrayContaining(['--base', 'trunk']), { cwd: root });
      expect(gh).toHaveBeenCalledWith(['pr', 'view', prUrl, '--json', 'url,title,body,isDraft,labels'], { cwd: root });
      expect(events).toContainEqual(expect.objectContaining({
        type: 'finish_publication_transition', phase: 'completed', transition: 'establish_pr',
      }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('establishes the PR for a branch the finish-time rebase rewrote, which no plain push can publish', async () => {
    // Regression: the FINISH-time `rebase` step rewrites the feature branch's
    // history, so the branch legitimately diverges from its own remote (same
    // work, new SHAs). A plain push is rejected non-fast-forward on EVERY
    // attempt, so `establish_pr` burned the whole publication retry budget and
    // halted the feature. `establish_pr` must publish with a lease instead.
    const root = await mkdtemp(join(tmpdir(), 'finish-production-rebased-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);

      const state = {
        feature_desc: 'feature',
        worktree_branch: 'feat/feature',
        build_review: 'done',
        test_suite: 'done',
        manual_test: 'done',
        architecture_review_as_built: 'done',
      } as ConductState;
      const prUrl = 'https://github.com/acme/widget/pull/1275';
      const pushes: string[][] = [];
      const git = vi.fn(async (args: string[]) => {
        if (args[0] === 'remote') return { stdout: 'origin\n' };
        if (args[0] === 'rev-list') return { stdout: '31\n' };
        if (args[0] === 'rev-parse') return { stdout: 'refs/remotes/origin/feat/feature\n' };
        if (args[0] === 'push') {
          pushes.push([...args]);
          if (!args.includes('--force-with-lease')) {
            throw new Error(
              '! [rejected] feat/feature -> feat/feature (non-fast-forward)',
            );
          }
          return { stdout: '' };
        }
        return { stdout: '' };
      });
      const gh = vi.fn(async (args: string[]) => {
        if (args[0] === 'auth') return { stdout: '' };
        if (args[0] === 'pr' && args[1] === 'view' && args[2] === 'feat/feature') {
          throw new Error('no open PR');
        }
        if (args[0] === 'pr' && args[1] === 'create') return { stdout: `${prUrl}\n` };
        if (args[0] === 'pr' && args[1] === 'view' && args[2] === prUrl) {
          return { stdout: JSON.stringify({ url: prUrl, title: 'draft', body: 'draft', isDraft: true }) };
        }
        return { stdout: '' };
      });
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root,
        stateFilePath: join(pipeline, 'conduct-state.json'),
        git,
        gh,
        baseBranch: 'main',
        observeReleaseReadiness: async () => 'present',
      });

      await expect(
        coordinator.advance({
          state,
          mode: 'auto',
          daemon: true,
          dispatchJudgment: async () => ({ success: true }),
          emit: async () => {},
        }),
      ).resolves.toEqual({ kind: 'publication_progress', transition: 'establish_pr' });

      // Exactly one push, lease-protected — never a bare force.
      expect(pushes).toEqual([['push', '-u', 'origin', 'feat/feature', '--force-with-lease']]);
      await expect(readFile(join(pipeline, 'conduct-state.json'), 'utf8')).resolves.toContain(
        `"pr_url": "${prUrl}"`,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('restores an accepted judgment for ordinary prose containing "required" language after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finish-production-restart-'));
    try {
      const pipeline = join(root, '.pipeline');
      const shipped = join(root, '.docs', 'shipped');
      await mkdir(pipeline);
      await mkdir(shipped, { recursive: true });
      await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
      await writeFile(join(shipped, 'feature.md'), 'shipped\n');

      const prUrl = 'https://github.com/acme/widget/pull/1172';
      const state = {
        feature_desc: 'feature',
        worktree_branch: 'feat/feature',
        pr_url: prUrl,
        build_review: 'done',
        test_suite: 'done',
        manual_test: 'done',
        architecture_review_as_built: 'done',
      } as ConductState;
      const git = vi.fn(async (args: string[]) => {
        if (args[0] === 'remote') return { stdout: 'origin\n' };
        if (args[0] === 'rev-parse') return { stdout: 'refs/remotes/origin/feat/feature\n' };
        return { stdout: '' };
      });
      const gh = vi.fn(async (args: string[]) => {
        if (args[0] === 'auth') return { stdout: '' };
        if (args[0] === 'pr' && args[1] === 'view' && args[2] === prUrl) {
          return {
            stdout: JSON.stringify({
              url: prUrl,
              title: 'docs: add required configuration context',
              body: 'The migration is required for operators upgrading from the prior release.',
              isDraft: true,
            }),
          };
        }
        return { stdout: '' };
      });
      const dispatchJudgment = vi.fn(async () => ({
        success: true,
        publicationDisposition: { kind: 'accepted' },
      }));
      const makeCoordinator = () => createProductionFinishPublicationCoordinator({
        projectRoot: root,
        stateFilePath: join(pipeline, 'conduct-state.json'),
        baseBranch: 'main',
        git,
        gh,
        observeReleaseReadiness: async () => 'present',
      });
      const input = {
        state,
        mode: 'auto' as const,
        daemon: true,
        dispatchJudgment,
        emit: async () => {},
      };

      const beforeRestart = await makeCoordinator().advance(input);
      const afterRestart = await makeCoordinator().advance(input);

      expect(beforeRestart).toEqual({ kind: 'publication_progress', transition: 'judge_pr_prose' });
      // Durable per-revision verdicts: the restarted coordinator re-observes
      // the persisted acceptance instead of paying a second judgment session.
      expect(afterRestart).not.toMatchObject({ kind: 'publication_progress', transition: 'judge_pr_prose' });
      expect(dispatchJudgment).toHaveBeenCalledTimes(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reclassifies a changed title/body revision from accepted to placeholder across a fresh coordinator', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finish-production-revision-invalidation-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);
      await mkdir(join(root, '.docs', 'shipped'), { recursive: true });
      await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
      await writeFile(join(root, '.docs', 'shipped', 'feature.md'), 'shipped\n');
      const prUrl = 'https://github.com/acme/widget/pull/1172';
      let body = 'Reader-facing summary and validation evidence.';
      const gh = vi.fn(async (args: string[]) => {
        if (args[0] === 'auth') return commandResult;
        if (args[0] === 'pr' && args[1] === 'view') {
          return { stdout: JSON.stringify({
            url: prUrl, title: 'feat: publication prose', body, isDraft: true, labels: [],
          }) };
        }
        throw new Error(`unexpected GitHub mutation: ${args.join(' ')}`);
      });
      const input = {
        state: {
          feature_desc: 'feature', worktree_branch: 'feat/feature', pr_url: prUrl,
          build_review: 'done', test_suite: 'done', manual_test: 'done', architecture_review_as_built: 'done',
        } as ConductState,
        mode: 'auto' as const,
        daemon: true,
        dispatchJudgment: vi.fn(async () => ({ success: true, publicationDisposition: { kind: 'accepted' } })),
        dispatchAuthoring: vi.fn(async () => {
          body = 'Restored reader-facing summary and validation evidence.';
          return { success: true };
        }),
        emit: async () => {},
      };
      const makeCoordinator = () => createProductionFinishPublicationCoordinator({
        projectRoot: root, stateFilePath: join(pipeline, 'conduct-state.json'), baseBranch: 'main', gh,
        git: async (args) => args[0] === 'remote'
          ? { stdout: 'origin\n' }
          : { stdout: 'refs/remotes/origin/feat/feature\n' },
        observeReleaseReadiness: async () => 'present',
      });

      await expect(makeCoordinator().advance(input)).resolves.toEqual({
        kind: 'publication_progress', transition: 'judge_pr_prose',
      });
      body = `${PR_BODY_FLOOR_MARKER}\n\nDraft opened automatically.`;
      await expect(makeCoordinator().advance(input)).resolves.toEqual({
        kind: 'publication_progress', transition: 'author_pr_prose',
      });
      expect(input.dispatchJudgment).toHaveBeenCalledOnce();
      expect(input.dispatchAuthoring).toHaveBeenCalledOnce();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses the injected presentation repair after ordinary accepted prose is observed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finish-production-repair-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);
      await mkdir(join(root, '.docs', 'shipped'), { recursive: true });
      await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
      await writeFile(join(root, '.docs', 'shipped', 'feature.md'), 'shipped\n');
      const prUrl = 'https://github.com/acme/widget/pull/1172';
      const gh = vi.fn(async (args: string[]) => {
        if (args[0] === 'auth') return commandResult;
        if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ url: prUrl, title: 'feat: publish', body: 'Reader-facing summary.', isDraft: true }) };
        throw new Error(`unexpected direct mutation: ${args.join(' ')}`);
      });
      const repairPresentation = vi.fn(async () => undefined);
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root,
        stateFilePath: join(pipeline, 'conduct-state.json'),
        baseBranch: 'main',
        git: async (args) => args[0] === 'remote' ? { stdout: 'origin\n' } : { stdout: 'refs/remotes/origin/feat/feature\n' },
        gh,
        observeReleaseReadiness: async () => 'present',
        repairPresentation,
      });
      const state = {
        feature_desc: 'feature', worktree_branch: 'feat/feature', pr_url: prUrl,
        build_review: 'done', test_suite: 'done', manual_test: 'done', architecture_review_as_built: 'done',
      } as ConductState;
      await expect(coordinator.advance({
        state,
        mode: 'auto',
        daemon: true,
        dispatchJudgment: async () => ({
          success: true,
          publicationDisposition: { kind: 'accepted' },
        }),
        emit: async () => {},
      })).resolves.toEqual({ kind: 'publication_progress', transition: 'judge_pr_prose' });
      await expect(coordinator.advance({
        state,
        mode: 'auto',
        daemon: true,
        dispatchJudgment: async () => ({
          success: true,
          publicationDisposition: { kind: 'accepted' },
        }),
        emit: async () => {},
      })).resolves.toMatchObject({ kind: 'human_required', reason: 'publication_transition_unmoved' });
      expect(repairPresentation).toHaveBeenCalledWith({ prUrl, state });
      expect(gh.mock.calls.some(([args]) => args[0] === 'pr' && args[1] === 'ready')).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('projects accepted build-review risk onto the retained PR while repairing presentation (Task 38)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finish-production-risk-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);
      await mkdir(join(root, '.docs', 'shipped'), { recursive: true });
      await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
      await writeFile(join(root, '.docs', 'shipped', 'feature.md'), 'shipped\n');
      const prUrl = 'https://github.com/acme/widget/pull/1173';
      const feature = { version: 'v1' as const, repository: 'github.com/acme/conductor', feature: 'review-rubrics' };
      const finding = canonicalizeBuildReviewFindingIdentity({
        rubric: 'scope', contractVersion: 'v1', concernKind: 'out-of-plan-change',
        summary: 'Actionable finding summary', evidenceLocations: ['src/a.ts:1'],
        anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'out-of-plan-change' },
      })!;
      const accepted: BuildReviewDispositionRecord = {
        version: 'v1', feature, finding, sourceLapId: parseBuildReviewLapId('lap-7')!,
        summary: 'summary', rationale: 'reason', operator: 'james', acceptedAt: '2026-08-14T12:00:00.000Z',
      };
      const coverage = {
        kind: 'reduced-coverage' as const, version: 'v1' as const, feature,
        identity: { rubric: 'rootCause' as const, reason: 'provider-error' as const },
        rationale: 'The provider was unavailable for this current lap.', operator: 'james', acceptedAt: '2026-08-20T00:00:00.000Z',
      };
      const currentLap = parseBuildReviewLapId('lap-current')!;
      await writeFile(join(pipeline, 'build-review.json'), JSON.stringify(joinBuildReviewRubricOutcomes({
        lapId: currentLap, snapshotDigest: 'sha256:current', results: {
          tautology: { kind: 'judged', rubric: 'tautology', lapId: currentLap, snapshotDigest: 'sha256:current', contractVersion: 'v2' as never, findings: [], verdict: 'PASS' },
          scope: { kind: 'judged', rubric: 'scope', lapId: currentLap, snapshotDigest: 'sha256:current', contractVersion: 'v2' as never, findings: [], verdict: 'PASS' },
          rootCause: { kind: 'infrastructure-failure', rubric: 'rootCause', reason: 'provider-error', detail: 'provider unavailable' },
          completeness: { kind: 'judged', rubric: 'completeness', lapId: currentLap, snapshotDigest: 'sha256:current', contractVersion: 'v2' as never, findings: [], verdict: 'PASS' },
        },
      })));
      const edits: string[][] = [];
      const gh = vi.fn(async (args: string[]) => {
        if (args[0] === 'auth') return commandResult;
        if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ url: prUrl, title: 'feat: publish', body: 'Reader-facing summary.', isDraft: true }) };
        if (args[0] === 'pr' && args[1] === 'edit') { edits.push(args); return commandResult; }
        throw new Error(`unexpected direct mutation: ${args.join(' ')}`);
      });
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root,
        stateFilePath: join(pipeline, 'conduct-state.json'),
        baseBranch: 'main',
        git: async (args) => args[0] === 'remote' ? { stdout: 'origin\n' } : { stdout: 'refs/remotes/origin/feat/feature\n' },
        gh,
        observeReleaseReadiness: async () => 'present',
        repairPresentation: async () => undefined,
        resolveFeatureIdentity: async () => feature,
        createDispositionStore: () => ({
          list: async () => ({ ok: true, records: Object.freeze([accepted]) }),
          listReducedCoverage: async () => ({ ok: true as const, records: [coverage] }),
        }),
      });
      const state = {
        feature_desc: 'feature', worktree_branch: 'feat/feature', pr_url: prUrl,
        build_review: 'done', test_suite: 'done', manual_test: 'done', architecture_review_as_built: 'done',
      } as ConductState;

      // The rebased flow judges stale prose before any retained-PR maintenance
      // effect, so accept the prose and advance until the repair transition
      // applies the projection edit.
      const dispatchJudgment = async () => ({ success: true, publicationDisposition: { kind: 'accepted' } }) as never;
      for (let i = 0; i < 6 && edits.length === 0; i++) {
        await coordinator.advance({ state, mode: 'auto', daemon: true, dispatchJudgment, emit: async () => {} });
      }

      expect(edits.length).toBe(1);
      const body = edits[0][edits[0].indexOf('--body') + 1];
      expect(body).toContain('Reader-facing summary.');
      expect(body).toContain('Accepted build-review risk');
      expect(body).toContain('## Reduced build-review coverage');
      expect(body).toContain('Current diagnostic: provider unavailable');
      expect(body).toContain(`- Finding: \`${finding.id}\` — rubric: scope`);
      expect(body).not.toContain('**Rationale:**');
      expect(body).not.toContain('reason');
      expect(body).toContain('Operator: james');
      expect(body).toContain('Decision time: 2026-08-20T00:00:00.000Z');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('blocks retained-PR maintenance when reduced coverage is known but lacks current-lap evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finish-production-risk-block-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);
      await mkdir(join(root, '.docs', 'shipped'), { recursive: true });
      await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
      await writeFile(join(root, '.docs', 'shipped', 'feature.md'), 'shipped\n');
      const prUrl = 'https://github.com/acme/widget/pull/1174';
      const feature = { version: 'v1' as const, repository: 'github.com/acme/conductor', feature: 'review-rubrics' };
      const coverage = {
        kind: 'reduced-coverage' as const, version: 'v1' as const, feature,
        identity: { rubric: 'rootCause' as const, reason: 'provider-error' as const },
        rationale: 'approved', operator: 'james', acceptedAt: '2026-08-20T00:00:00.000Z',
      };
      const gh = vi.fn(async (args: string[]) => {
        if (args[0] === 'auth') return commandResult;
        if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ url: prUrl, title: 'feat: publish', body: 'Reader-facing summary.', isDraft: true }) };
        throw new Error(`unexpected direct mutation: ${args.join(' ')}`);
      });
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root,
        stateFilePath: join(pipeline, 'conduct-state.json'),
        baseBranch: 'main',
        git: async (args) => args[0] === 'remote' ? { stdout: 'origin\n' } : { stdout: 'refs/remotes/origin/feat/feature\n' },
        gh,
        observeReleaseReadiness: async () => 'present',
        repairPresentation: async () => { throw new Error('presentation repair must not run before the risk projection settles'); },
        resolveFeatureIdentity: async () => feature,
        createDispositionStore: () => ({
          list: async () => ({ ok: true as const, records: [] }),
          listReducedCoverage: async () => ({ ok: true as const, records: [coverage] }),
        }),
      });
      const state = {
        feature_desc: 'feature', worktree_branch: 'feat/feature', pr_url: prUrl,
        build_review: 'done', test_suite: 'done', manual_test: 'done', architecture_review_as_built: 'done',
      } as ConductState;

      // The core coordinator converts the projection failure into a bounded
      // retry: presentation repair never completes and accepted risk is never
      // silently dropped. The injected repairPresentation throws if reached,
      // proving the projection blocked the effect before any repair ran.
      let result: unknown;
      for (let i = 0; i < 6; i++) {
        result = await coordinator.advance({
          state, mode: 'auto', daemon: true,
          dispatchJudgment: async () => ({ success: true, publicationDisposition: { kind: 'accepted' } }) as never,
          emit: async () => {},
        });
        if ((result as { reason?: string }).reason === 'presentation_repair_failed') break;
      }
      expect(result).toEqual({ kind: 'publication_retry', transition: 'ready_pr', reason: 'presentation_repair_failed' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('dispatches the authoring pass for the SHIP-entry placeholder body and never judges it unauthored', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finish-production-authoring-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);
      await mkdir(join(root, '.docs', 'shipped'), { recursive: true });
      await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
      const prUrl = 'https://github.com/acme/widget/pull/1364';
      let body = `${PR_BODY_FLOOR_MARKER}\n\n## Why\n\n_Not yet authored_\n`;
      const gh = vi.fn(async (args: string[]) => {
        if (args[0] === 'auth') return commandResult;
        if (args[0] === 'pr' && args[1] === 'view') {
          return { stdout: JSON.stringify({ url: prUrl, title: 'feat: draft publication', body, isDraft: true }) };
        }
        throw new Error(`unexpected GitHub mutation: ${args.join(' ')}`);
      });
      const dispatchJudgment = vi.fn(async () => ({ success: true }));
      const dispatchAuthoring = vi.fn(async () => {
        body = '## Why\n\nThe teardown hook never ran.\n\n## What Changed\n\nRun it.\n';
        return { success: true };
      });
      const writeShippedRecord = vi.fn(async () => 0);
      const makeCoordinator = () => createProductionFinishPublicationCoordinator({
        projectRoot: root,
        stateFilePath: join(pipeline, 'conduct-state.json'),
        baseBranch: 'main',
        gh,
        git: async (args) => args[0] === 'remote'
          ? { stdout: 'origin\n' }
          : { stdout: 'refs/remotes/origin/feat/feature\n' },
        observeReleaseReadiness: async () => 'present',
        writeShippedRecord,
        repairPresentation: async () => {},
      });
      const input = {
        state: {
          feature_desc: 'feature',
          worktree_branch: 'feat/feature',
          pr_url: prUrl,
          build_review: 'done',
          test_suite: 'done',
          manual_test: 'done',
          architecture_review_as_built: 'done',
        } as ConductState,
        mode: 'auto' as const,
        daemon: true,
        dispatchJudgment,
        dispatchAuthoring,
        emit: async () => {},
      };

      await expect(makeCoordinator().advance(input)).resolves.toEqual({
        kind: 'publication_progress', transition: 'author_pr_prose',
      });

      // The dedup key stays unwritten until the prose survives, so a prose
      // halt here remains re-dispatchable by the daemon.
      expect(writeShippedRecord).not.toHaveBeenCalled();

      // A daemon re-creates this composition on the next dispatch. The exact
      // revision the authoring pass produced remains accepted, so the healthy
      // placeholder path consumes its one authoring provider pass, not a
      // second judgment pass.
      await makeCoordinator().advance(input);

      expect(dispatchAuthoring).toHaveBeenCalledWith({
        kind: 'finish_pr_prose_authoring',
        pullRequestUrl: prUrl,
        authoringScope: ['title', 'body'],
        maximumPasses: 1,
      });
      expect(dispatchJudgment).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('advances the authoring transition when authored prose preserved the body-floor marker', async () => {
    // #1703: the authoring provider wrote 3,988 characters of genuine prose but
    // left the invisible floor marker line in place. Marker-presence-alone
    // classification kept calling the body a placeholder, so the
    // non-advancing-transition guard halted FINISH on finished work.
    const root = await mkdtemp(join(tmpdir(), 'finish-production-authored-marker-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);
      await mkdir(join(root, '.docs', 'shipped'), { recursive: true });
      await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
      const prUrl = 'https://github.com/acme/widget/pull/1741';
      let body = `${PR_BODY_FLOOR_MARKER}\n\n## Why\n\n_Not yet authored_\n`;
      const gh = vi.fn(async (args: string[]) => {
        if (args[0] === 'auth') return commandResult;
        if (args[0] === 'pr' && args[1] === 'view') {
          return { stdout: JSON.stringify({ url: prUrl, title: 'fix: author the retained PR body', body, isDraft: true, labels: [] }) };
        }
        throw new Error(`unexpected GitHub mutation: ${args.join(' ')}`);
      });
      const dispatchJudgment = vi.fn(async () => ({ success: true }));
      const dispatchAuthoring = vi.fn(async () => {
        body = [
          PR_BODY_FLOOR_MARKER,
          '',
          '## Why',
          '',
          'The FINISH publication coordinator refused to advance because it classified an authored',
          'body as an engine placeholder, halting a feature whose work was already complete.',
          '',
          '## What Changed',
          '',
          'Floor classification now reads the body content, so an invisible marker that survived the',
          'authoring pass no longer outweighs the prose sitting underneath it.',
          '',
          '## Testing',
          '',
          'Unit coverage for the shared floor predicate plus this coordinator-level regression.',
        ].join('\n');
        return { success: true };
      });
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root,
        stateFilePath: join(pipeline, 'conduct-state.json'),
        baseBranch: 'main',
        gh,
        git: async (args) => args[0] === 'remote'
          ? { stdout: 'origin\n' }
          : { stdout: 'refs/remotes/origin/feat/feature\n' },
        observeReleaseReadiness: async () => 'present',
        writeShippedRecord: vi.fn(async () => 0),
        repairPresentation: async () => {},
      });

      await expect(coordinator.advance({
        state: {
          feature_desc: 'feature',
          worktree_branch: 'feat/feature',
          pr_url: prUrl,
          build_review: 'done',
          test_suite: 'done',
          manual_test: 'done',
          architecture_review_as_built: 'done',
        } as ConductState,
        mode: 'auto' as const,
        daemon: true,
        dispatchJudgment,
        dispatchAuthoring,
        emit: async () => {},
      })).resolves.toEqual({ kind: 'publication_progress', transition: 'author_pr_prose' });

      expect(dispatchAuthoring).toHaveBeenCalledOnce();
      expect(dispatchJudgment).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['halt', { success: true, publicationDisposition: { kind: 'revision_required', reason: 'halt' } }, { kind: 'human_required', reason: 'judgment_halt_prose' }],
    ['refused', { success: true, publicationDisposition: { kind: 'refused', detail: 'provider declined' } }, { kind: 'human_required', reason: 'judgment_refused', detail: 'provider declined' }],
    ['timed_out', { success: true, publicationDisposition: { kind: 'timed_out' } }, { kind: 'publication_retry', transition: 'judge_pr_prose', reason: 'judgment_timed_out' }],
    ['provider_unavailable', { success: true, publicationDisposition: { kind: 'provider_unavailable' } }, { kind: 'publication_retry', transition: 'judge_pr_prose', reason: 'judgment_provider_unavailable' }],
    ['undecodable', { success: true, output: 'not a judgment result' }, { kind: 'publication_retry', transition: 'judge_pr_prose', reason: 'judgment_malformed_response' }],
    ['incompleteness', { success: true, publicationDisposition: { kind: 'revision_required', reason: 'structurally_incomplete' } }, { kind: 'human_required', reason: 'publication_transition_unmoved', detail: 'The author_pr_prose retry cannot run because the fresh publication observation selects judge_pr_prose.' }],
    ['raw-placeholder', { success: true, output: '{"kind":"revision_required","reason":"placeholder"}' }, { kind: 'human_required', reason: 'publication_transition_unmoved', detail: 'The author_pr_prose retry cannot run because the fresh publication observation selects judge_pr_prose.' }],
  ])('maps each $0 prose judgment response without readying or recording the PR', async (_label, judgmentResponse, expected) => {
    const root = await mkdtemp(join(tmpdir(), 'finish-production-judgment-outcome-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);
      await mkdir(join(root, '.docs', 'shipped'), { recursive: true });
      await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
      await writeFile(join(root, '.docs', 'shipped', 'feature.md'), 'shipped\n');
      const prUrl = 'https://github.com/acme/widget/pull/1172';
      const gh = vi.fn(async (args: string[]) => {
        if (args[0] === 'auth') return commandResult;
        if (args[0] === 'pr' && args[1] === 'view') {
          return { stdout: JSON.stringify({ url: prUrl, title: 'feat: authored publication', body: 'Reader-facing summary.', isDraft: true, labels: [] }) };
        }
        throw new Error(`unexpected GitHub mutation: ${args.join(' ')}`);
      });
      const writeShippedRecord = vi.fn(async () => 0);
      const recordFinish = vi.fn(async () => 0);
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root,
        stateFilePath: join(pipeline, 'conduct-state.json'),
        baseBranch: 'main',
        gh,
        git: async (args) => args[0] === 'remote'
          ? { stdout: 'origin\n' }
          : { stdout: 'refs/remotes/origin/feat/feature\n' },
        observeReleaseReadiness: async () => 'present',
        writeShippedRecord,
        recordFinish,
      });

      const dispatchJudgment = vi.fn(async () => judgmentResponse);
      await expect(coordinator.advance({
        state: {
          feature_desc: 'feature', worktree_branch: 'feat/feature', pr_url: prUrl,
          build_review: 'done', test_suite: 'done', manual_test: 'done', architecture_review_as_built: 'done',
        } as ConductState,
        mode: 'auto',
        daemon: true,
        dispatchJudgment,
        emit: async () => {},
      })).resolves.toEqual(expected);

      expect(dispatchJudgment).toHaveBeenCalledOnce();
      expect(gh.mock.calls.filter(([args]) => args[0] === 'pr' && args[1] === 'ready')).toEqual([]);
      expect(recordFinish).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not spend a provider judgment on a persistent remediation-state PR', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finish-production-judgment-cache-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);
      await mkdir(join(root, '.docs', 'shipped'), { recursive: true });
      await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
      await writeFile(join(root, '.docs', 'shipped', 'feature.md'), 'shipped\n');
      const prUrl = 'https://github.com/acme/widget/pull/1172';
      const gh = vi.fn(async (args: string[]) => {
        if (args[0] === 'auth') return commandResult;
        if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ url: prUrl, title: 'Needs remediation: publication', body: `${HALT_PR_BANNER_SENTINEL}\n\nHuman remediation required.`, isDraft: true }) };
        throw new Error(`unexpected GitHub command: ${args.join(' ')}`);
      });
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root, stateFilePath: join(pipeline, 'conduct-state.json'), baseBranch: 'main', gh,
        git: async (args) => args[0] === 'remote' ? { stdout: 'origin\n' } : { stdout: 'refs/remotes/origin/feat/feature\n' },
        observeReleaseReadiness: async () => 'present',
      });
      const dispatchJudgment = vi.fn(async () => ({ success: true }));
      const input = {
        state: { feature_desc: 'feature', worktree_branch: 'feat/feature', pr_url: prUrl, build_review: 'done', test_suite: 'done', manual_test: 'done', architecture_review_as_built: 'done' } as ConductState,
        mode: 'auto' as const, daemon: true, dispatchJudgment, emit: async () => {},
      };
      await expect(coordinator.advance(input)).resolves.toEqual({ kind: 'human_required', reason: 'halt_state_pr' });
      await expect(coordinator.advance(input)).resolves.toEqual({ kind: 'human_required', reason: 'halt_state_pr' });
      expect(dispatchJudgment).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('re-observes a persisted prose verdict from a FRESH coordinator instead of dispatching again', async () => {
    // The daemon constructs a new coordinator per dispatch. Without durable
    // per-revision verdicts, every resume re-judged unchanged prose — an extra
    // provider attempt on a legitimately converging path.
    const root = await mkdtemp(join(tmpdir(), 'finish-production-judgment-durable-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);
      await mkdir(join(root, '.docs', 'shipped'), { recursive: true });
      await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
      await writeFile(join(root, '.docs', 'shipped', 'feature.md'), 'shipped\n');
      const prUrl = 'https://github.com/acme/widget/pull/1172';
      const gh = vi.fn(async (args: string[]) => {
        if (args[0] === 'auth') return commandResult;
        if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ url: prUrl, title: 'Needs remediation: publication', body: `${HALT_PR_BANNER_SENTINEL}\n\nHuman remediation required.`, isDraft: true }) };
        throw new Error(`unexpected GitHub command: ${args.join(' ')}`);
      });
      const makeCoordinator = () => createProductionFinishPublicationCoordinator({
        projectRoot: root, stateFilePath: join(pipeline, 'conduct-state.json'), baseBranch: 'main', gh,
        git: async (args) => args[0] === 'remote' ? { stdout: 'origin\n' } : { stdout: 'refs/remotes/origin/feat/feature\n' },
        observeReleaseReadiness: async () => 'present',
      });
      const dispatchJudgment = vi.fn(async () => ({ success: true, publicationDisposition: { kind: 'revision_required', reason: 'halt' } }));
      const input = {
        state: { feature_desc: 'feature', worktree_branch: 'feat/feature', pr_url: prUrl, build_review: 'done', test_suite: 'done', manual_test: 'done', architecture_review_as_built: 'done' } as ConductState,
        mode: 'auto' as const, daemon: true, dispatchJudgment, emit: async () => {},
      };
      await expect(makeCoordinator().advance(input)).resolves.toEqual({ kind: 'human_required', reason: 'halt_state_pr' });
      await expect(makeCoordinator().advance(input)).resolves.toEqual({ kind: 'human_required', reason: 'halt_state_pr' });
      // The halt banner is classified deterministically before any judgment,
      // so no provider session is spent on either fresh coordinator.
      expect(dispatchJudgment).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    { mode: 'interactive' as const, daemon: false },
    { mode: 'default' as const, daemon: false },
    { mode: 'auto' as const, daemon: false },
    { mode: 'auto' as const, daemon: true },
  ])('preflights %s without a provider or GitHub call when BUILD evidence is absent', async ({ mode, daemon }) => {
    const root = await mkdtemp(join(tmpdir(), 'finish-production-composition-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);
      // Interactive intent is operator-owned; a valid stored intent lets this
      // bounded test reach the same coordinator preflight as unattended modes.
      await writeFile(join(pipeline, 'finish-choice'), daemon ? 'pr\n' : 'keep\n');
      const git = vi.fn(async () => commandResult);
      const gh = vi.fn(async () => commandResult);
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root,
        stateFilePath: join(pipeline, 'conduct-state.json'),
        baseBranch: 'main',
        git,
        gh,
        observeReleaseReadiness: async () => 'present',
        acquireInteractiveIntent: async () => 'keep',
      });
      const dispatchJudgment = vi.fn(async () => ({ success: true }));

      const disposition = await coordinator.advance({
        state: { feature_desc: 'feature' } as ConductState,
        mode,
        daemon,
        dispatchJudgment,
        emit: async () => {},
      });

      expect(disposition).toMatchObject({
        kind: daemon ? 'publication_retry' : 'implementation_invalid',
      });
      expect(dispatchJudgment).not.toHaveBeenCalled();
      // The fake boundaries are the only allowed process/network seam in this
      // integration test; no real provider or GitHub executable is reachable.
      expect(git).toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('acquires interactive PR intent once and reuses it across deterministic publication retries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finish-production-interactive-pr-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);
      const trace: string[] = [];
      const prUrl = 'https://github.com/acme/widget/pull/1172';
      const git = vi.fn(async (args: string[]) => {
        trace.push(`git:${args.join(' ')}`);
        if (args[0] === 'rev-list') return { stdout: '1\n' };
        if (args[0] === 'rev-parse') return { stdout: 'refs/remotes/origin/feat/feature\n' };
        return commandResult;
      });
      const gh = vi.fn(async (args: string[]) => {
        trace.push(`gh:${args.join(' ')}`);
        if (args[0] === 'pr' && args[1] === 'view') throw new Error('no open PR');
        if (args[0] === 'pr' && args[1] === 'create') return { stdout: `${prUrl}\n` };
        throw new Error(`unexpected GitHub command: ${args.join(' ')}`);
      });
      const writeShippedRecord = vi.fn(async () => { trace.push('shipped-record'); return 0; });
      const recordFinish = vi.fn(async () => { trace.push('outcome-record'); return 0; });
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root,
        stateFilePath: join(pipeline, 'conduct-state.json'),
        baseBranch: 'main',
        git,
        gh,
        acquireInteractiveIntent: async () => { trace.push('operator-choice'); return 'pr'; },
        observeReleaseReadiness: async () => { trace.push('release-readiness'); return 'present'; },
        writeShippedRecord,
        recordFinish,
      });

      const result = await coordinator.advance({
        state: {
          feature_desc: 'feature',
          worktree_branch: 'feat/feature',
          build_review: 'done',
          test_suite: 'done',
          manual_test: 'done',
          architecture_review_as_built: 'done',
        } as ConductState,
        mode: 'interactive',
        daemon: false,
        dispatchJudgment: vi.fn(async () => ({ success: true })),
        emit: async () => {},
      });

      expect(result).toMatchObject({ kind: 'publication_retry', transition: 'establish_pr' });
      expect(trace[0]).toBe('operator-choice');
      expect(trace.indexOf('operator-choice')).toBeLessThan(trace.findIndex((entry) => entry.startsWith('git:push')));
      expect(trace.indexOf('operator-choice')).toBeLessThan(trace.indexOf('release-readiness'));
      expect(trace.indexOf('operator-choice')).toBeLessThan(trace.findIndex((entry) => entry.startsWith('gh:pr create')));
      expect(writeShippedRecord).not.toHaveBeenCalled();
      expect(recordFinish).not.toHaveBeenCalled();
      await expect(readFile(join(pipeline, 'finish-choice'), 'utf8')).rejects.toThrow();

      await coordinator.advance({
        state: {
          feature_desc: 'feature',
          worktree_branch: 'feat/feature',
          build_review: 'done',
          test_suite: 'done',
          manual_test: 'done',
          architecture_review_as_built: 'done',
        } as ConductState,
        mode: 'interactive',
        daemon: false,
        dispatchJudgment: vi.fn(async () => ({ success: true })),
        emit: async () => {},
      });
      expect(trace.filter((entry) => entry === 'operator-choice')).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['defer', 'decline'] as const)(
    'keeps interactive %s inert before any publication boundary',
    async (choice) => {
      const root = await mkdtemp(join(tmpdir(), 'finish-production-interactive-inert-'));
      try {
        const pipeline = join(root, '.pipeline');
        await mkdir(pipeline);
        const git = vi.fn(async () => commandResult);
        const gh = vi.fn(async () => commandResult);
        const readiness = vi.fn(async () => 'present' as const);
        const writeShippedRecord = vi.fn(async () => 0);
        const recordFinish = vi.fn(async () => 0);
        const coordinator = createProductionFinishPublicationCoordinator({
          projectRoot: root,
          stateFilePath: join(pipeline, 'conduct-state.json'),
          baseBranch: 'main',
          git,
          gh,
          acquireInteractiveIntent: async () => choice,
          observeReleaseReadiness: readiness,
          writeShippedRecord,
          recordFinish,
        });

        const result = await coordinator.advance({
          state: { feature_desc: 'feature' } as ConductState,
          mode: 'interactive',
          daemon: false,
          dispatchJudgment: vi.fn(async () => ({ success: true })),
          emit: async () => {},
        });

        expect(result).toEqual({
          kind: 'human_required',
          reason: choice === 'defer' ? 'interactive_intent_deferred' : 'interactive_intent_declined',
        });
        expect(git).not.toHaveBeenCalled();
        expect(gh).not.toHaveBeenCalled();
        expect(readiness).not.toHaveBeenCalled();
        expect(writeShippedRecord).not.toHaveBeenCalled();
        expect(recordFinish).not.toHaveBeenCalled();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.each(['default', 'interactive'] as const)(
    'keeps attended %s defer inert before any publication observation',
    async (mode) => {
      const root = await mkdtemp(join(tmpdir(), 'finish-production-attended-inert-'));
      try {
        const pipeline = join(root, '.pipeline');
        await mkdir(pipeline);
        const git = vi.fn(async () => commandResult);
        const gh = vi.fn(async () => commandResult);
        const acquireInteractiveIntent = vi.fn(async () => 'defer');
        const coordinator = createProductionFinishPublicationCoordinator({
          projectRoot: root,
          stateFilePath: join(pipeline, 'conduct-state.json'),
          baseBranch: 'main',
          git,
          gh,
          acquireInteractiveIntent,
          observeReleaseReadiness: async () => 'present',
        });

        await expect(coordinator.advance({
          state: { feature_desc: 'feature' } as ConductState,
          mode,
          daemon: false,
          dispatchJudgment: vi.fn(async () => ({ success: true })),
          emit: async () => {},
        })).resolves.toEqual({ kind: 'human_required', reason: 'interactive_intent_deferred' });
        expect(acquireInteractiveIntent).toHaveBeenCalledOnce();
        expect(git).not.toHaveBeenCalled();
        expect(gh).not.toHaveBeenCalled();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it('defaults the finish-record runners to the real gh/git boundary when the composition root omits them', async () => {
    // Regression: the coordinator forwarded an undefined runner bundle, so
    // finish-record fell back to its fail-closed no-op and every daemon
    // `record_outcome` attempt refused with "runGh not implemented" until the
    // FINISH retry budget was exhausted.
    const root = await mkdtemp(join(tmpdir(), 'finish-production-record-runners-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);
      const recordFinish = vi.fn<typeof dispatchFinishRecord>(async () => 0);
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root,
        stateFilePath: join(pipeline, 'conduct-state.json'),
        baseBranch: 'main',
        git: vi.fn(async () => commandResult),
        gh: vi.fn(async () => commandResult),
        // A keep outcome routes straight to `record_outcome` without needing a
        // GitHub identity, isolating the runner wiring under test.
        acquireInteractiveIntent: async () => 'keep',
        observeReleaseReadiness: async () => 'present',
        recordFinish,
        // finishRecordRunners intentionally omitted — that is the defect.
      });

      await coordinator.advance({
        state: {
          feature_desc: 'feature',
          worktree_branch: 'feat/feature',
          build_review: 'done',
          test_suite: 'done',
          manual_test: 'done',
          architecture_review_as_built: 'done',
        } as ConductState,
        mode: 'interactive',
        daemon: false,
        dispatchJudgment: vi.fn(async () => ({ success: true })),
        emit: async () => {},
      });

      expect(recordFinish).toHaveBeenCalledOnce();
      const runners = recordFinish.mock.calls[0]![2];
      expect(runners).toBeDefined();
      expect(typeof runners!.runGh).toBe('function');
      expect(typeof runners!.runGit).toBe('function');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
