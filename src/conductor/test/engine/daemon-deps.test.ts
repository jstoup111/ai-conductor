import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('execa', () => ({ execa: vi.fn() }));
import { execa } from 'execa';
import {
  isProcessed,
  readWorktreeOutcome,
  makeFeatureRunnerDeps,
} from '../../src/engine/daemon-deps.js';

describe('engine/daemon-deps', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'daemon-deps-'));
    await mkdir(join(dir, '.pipeline'), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('readWorktreeOutcome', () => {
    it('reports done with pr_url from state', async () => {
      await writeFile(join(dir, '.pipeline/DONE'), 'converged\n');
      await writeFile(
        join(dir, '.pipeline/conduct-state.json'),
        JSON.stringify({ pr_url: 'https://github.com/x/y/pull/9' }),
      );
      const out = await readWorktreeOutcome(dir);
      expect(out.done).toBe(true);
      expect(out.halted).toBe(false);
      expect(out.prUrl).toBe('https://github.com/x/y/pull/9');
    });

    it('reports halted with the HALT reason', async () => {
      await writeFile(join(dir, '.pipeline/HALT'), 'kickback ping-pong on plan\n');
      const out = await readWorktreeOutcome(dir);
      expect(out.halted).toBe(true);
      expect(out.done).toBe(false);
      expect(out.reason).toMatch(/ping-pong/);
    });

    it('reports neither when no markers exist', async () => {
      const out = await readWorktreeOutcome(dir);
      expect(out).toMatchObject({ done: false, halted: false });
    });
  });

  it('derives the engineer-store project key from the projectRoot basename, not the worktree path (FR-9)', () => {
    const d = makeFeatureRunnerDeps({
      projectRoot: '/home/user/code/my-project',
      worktreeBase: '/home/user/code/my-project/.worktrees',
      baseBranch: 'main',
      runConductorInWorktree: async () => {},
    } as unknown as Parameters<typeof makeFeatureRunnerDeps>[0]);
    // Must be the project's basename — NOT '.worktrees' (the worktree parent),
    // which would collapse every project to the same key.
    expect(d.project).toBe('my-project');
    expect(d.project).not.toBe('.worktrees');
  });

  it('wires projectRoot and runGh into the returned deps (FR-9/FR-16 orphaned-primitive guard)', () => {
    // Regression guard: if either field is dropped, the entire enroll/sweep/clear
    // code path silently no-ops in production (daemon-runner guards with `if
    // (deps.projectRoot)`). This test must fail if someone removes those fields.
    const d = makeFeatureRunnerDeps({
      projectRoot: '/home/user/code/my-project',
      worktreeBase: '/home/user/code/my-project/.worktrees',
      baseBranch: 'main',
      runConductorInWorktree: async () => {},
    } as unknown as Parameters<typeof makeFeatureRunnerDeps>[0]);
    expect(d.projectRoot).toBe('/home/user/code/my-project');
    expect(typeof d.runGh).toBe('function');
  });

  describe('createWorktree (idempotent retry)', () => {
    const mockExeca = vi.mocked(execa);
    const slug = 'feat-x';

    function deps(worktreePath: string) {
      return makeFeatureRunnerDeps({
        projectRoot: dir,
        worktreeBase: join(dir, '.worktrees'),
        baseBranch: 'main',
        runConductorInWorktree: async () => {},
      });
    }
    // Route git subcommands; `addCalls` records every `worktree add`.
    function routeGit(opts: { worktreeListed: boolean; branchExists: boolean }) {
      const path = join(dir, '.worktrees', slug);
      const addCalls: string[][] = [];
      mockExeca.mockImplementation((async (...callArgs: unknown[]) => {
        const args = (callArgs[1] as string[]) ?? [];
        if (args[0] === 'worktree' && args[1] === 'list') {
          return { stdout: opts.worktreeListed ? `worktree ${path}\n` : 'worktree ' + dir };
        }
        if (args[0] === 'show-ref') {
          if (opts.branchExists) return { stdout: '' };
          throw new Error('no ref');
        }
        if (args[0] === 'worktree' && args[1] === 'add') {
          addCalls.push(args);
          return { stdout: '' };
        }
        return { stdout: '' };
      }) as unknown as typeof execa);
      return { path, addCalls };
    }

    beforeEach(() => mockExeca.mockReset());

    it('creates a fresh branch+worktree when neither exists', async () => {
      const { addCalls } = routeGit({ worktreeListed: false, branchExists: false });
      const wt = await deps(dir).createWorktree(slug);
      expect(wt.branch).toBe(`feat/daemon-${slug}`);
      expect(addCalls).toHaveLength(1);
      expect(addCalls[0]).toContain('-b'); // fresh: -b <branch> <path> main
    });

    it('reuses an already-registered worktree (resume) without adding', async () => {
      const { addCalls } = routeGit({ worktreeListed: true, branchExists: true });
      await deps(dir).createWorktree(slug);
      expect(addCalls).toHaveLength(0); // no worktree add at all
    });

    it('attaches a worktree to an existing branch when the worktree was removed', async () => {
      const { addCalls } = routeGit({ worktreeListed: false, branchExists: true });
      await deps(dir).createWorktree(slug);
      expect(addCalls).toHaveLength(1);
      expect(addCalls[0]).not.toContain('-b'); // attach: add <path> <branch>
    });
  });

  describe('isProcessed', () => {
    it('is false until the marker exists, then true', async () => {
      expect(await isProcessed(dir, 'feat-x')).toBe(false);
      await mkdir(join(dir, '.daemon/processed'), { recursive: true });
      await writeFile(join(dir, '.daemon/processed/feat-x'), 'shipped\n');
      expect(await isProcessed(dir, 'feat-x')).toBe(true);
    });
  });
});
