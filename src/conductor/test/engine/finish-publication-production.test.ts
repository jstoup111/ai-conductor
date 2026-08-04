import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProductionFinishPublicationCoordinator } from '../../src/engine/finish-publication-production.js';
import type { ConductState } from '../../src/types/index.js';

const commandResult = { stdout: '' };

describe('production FINISH publication composition', () => {
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
});
