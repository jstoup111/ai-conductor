import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createProductionFinishPublicationCoordinator,
  createProductionReleaseReadinessObserver,
} from '../../src/engine/finish-publication-production.js';
import { PR_BODY_FLOOR_MARKER } from '../../src/engine/halt-pr-rehabilitation.js';
import { HALT_PR_BANNER_SENTINEL } from '../../src/engine/pr-labels.js';
import type { ConductState } from '../../src/types/index.js';

const commandResult = { stdout: '' };

describe('production FINISH publication composition', () => {
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
          dispatchJudgment: async () => ({ success: true }),
          emit: async (event) => { events.push(event); },
        }),
      ).resolves.toMatchObject({ kind: 'publication_retry', transition: 'establish_pr' });

      await expect(readFile(join(pipeline, 'conduct-state.json'), 'utf8')).resolves.toContain(`"pr_url": "${prUrl}"`);
      const reobservedState = JSON.parse(
        await readFile(join(pipeline, 'conduct-state.json'), 'utf8'),
      ) as ConductState;
      await expect(
        coordinator.advance({
          state: reobservedState,
          mode: 'auto',
          daemon: true,
          dispatchJudgment: async () => ({ success: true }),
          emit: async () => {},
        }),
      ).resolves.toMatchObject({ kind: 'publication_retry', transition: 'write_shipped_record' });
      expect(git).toHaveBeenCalledWith(['rev-list', '--count', 'trunk..HEAD'], { cwd: root });
      expect(gh).toHaveBeenCalledWith(expect.arrayContaining(['--base', 'trunk']), { cwd: root });
      expect(gh).toHaveBeenCalledWith(['pr', 'view', prUrl, '--json', 'url,title,body,isDraft'], { cwd: root });
      expect(events).toContainEqual(expect.objectContaining({
        type: 'finish_publication_transition', phase: 'completed', transition: 'establish_pr',
      }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps accepted prose containing ordinary "required" language on the same transition after restart', async () => {
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
      const dispatchJudgment = vi.fn(async () => ({ success: true }));
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

      expect(beforeRestart).toEqual({
        kind: 'publication_retry',
        transition: 'ready_pr',
        reason: 'presentation_not_verified_after_repair',
      });
      expect(afterRestart).toEqual(beforeRestart);
      expect(dispatchJudgment).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses the injected presentation repair rather than reducing repair to a ready flip', async () => {
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
      await expect(coordinator.advance({ state, mode: 'auto', daemon: true, dispatchJudgment: async () => ({ success: true }), emit: async () => {} }))
        .resolves.toEqual({ kind: 'publication_retry', transition: 'ready_pr', reason: 'presentation_not_verified_after_repair' });
      expect(repairPresentation).toHaveBeenCalledWith({ prUrl, state });
      expect(gh.mock.calls.some(([args]) => args[0] === 'pr' && args[1] === 'ready')).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['placeholder floor', `${PR_BODY_FLOOR_MARKER}\n\n## Summary\n\nDraft publication`, 'feat: draft publication', { kind: 'revision_required', reason: 'placeholder' }, { kind: 'human_required', reason: 'judgment_placeholder_prose' }],
    ['halt banner', `${HALT_PR_BANNER_SENTINEL}\n\nHuman remediation required.`, 'Needs remediation: publication', { kind: 'revision_required', reason: 'halt' }, { kind: 'human_required', reason: 'judgment_halt_prose' }],
    ['structurally incomplete prose', `${PR_BODY_FLOOR_MARKER}\n\nIncomplete`, 'feat: publication', { kind: 'revision_required', reason: 'structurally_incomplete' }, { kind: 'human_required', reason: 'judgment_malformed_prose' }],
    ['refused prose judgment', `${PR_BODY_FLOOR_MARKER}\n\nDraft publication`, 'feat: draft publication', { kind: 'refused' }, { kind: 'human_required', reason: 'judgment_refused' }],
    ['timed out prose judgment', `${PR_BODY_FLOOR_MARKER}\n\nDraft publication`, 'feat: draft publication', { kind: 'timed_out' }, { kind: 'publication_retry', transition: 'judge_pr_prose', reason: 'judgment_timed_out' }],
    ['unavailable judgment provider', `${PR_BODY_FLOOR_MARKER}\n\nDraft publication`, 'feat: draft publication', { kind: 'provider_unavailable' }, { kind: 'publication_retry', transition: 'judge_pr_prose', reason: 'judgment_provider_unavailable' }],
    ['malformed structured judgment', `${PR_BODY_FLOOR_MARKER}\n\nDraft publication`, 'feat: draft publication', { kind: 'not_a_judgment' }, { kind: 'human_required', reason: 'judgment_malformed_prose' }],
  ] as const)('carries the exact bounded judgment outcome for %s without recording completion', async (_label, body, title, publicationDisposition, expected) => {
    const root = await mkdtemp(join(tmpdir(), 'finish-production-prose-'));
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
            stdout: JSON.stringify({ url: prUrl, title, body, isDraft: true }),
          };
        }
        throw new Error(`unexpected GitHub mutation: ${args.join(' ')}`);
      });
      const dispatchJudgment = vi.fn(async () => ({ success: true, publicationDisposition }));
      const recordFinish = vi.fn(async () => 0);
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root,
        stateFilePath: join(pipeline, 'conduct-state.json'),
        baseBranch: 'main',
        git: async (args) => args[0] === 'remote'
          ? { stdout: 'origin\n' }
          : { stdout: 'refs/remotes/origin/feat/feature\n' },
        gh,
        observeReleaseReadiness: async () => 'present',
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

      expect(result).toEqual(expected);
      expect(dispatchJudgment).toHaveBeenCalledOnce();
      expect(gh.mock.calls.some(([args]) => args[0] === 'pr' && args[1] === 'ready')).toBe(false);
      expect(recordFinish).not.toHaveBeenCalled();
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

  it('acquires fresh interactive PR intent before every publication observation or effect', async () => {
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
});
