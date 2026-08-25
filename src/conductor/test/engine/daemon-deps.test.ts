import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('execa', () => ({ execa: vi.fn() }));
const { watcherHandlers, watcher } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const fakeWatcher = {
    on: vi.fn((event: string, handler: (...args: never[]) => unknown) => {
      handlers.set(event, handler);
      return fakeWatcher;
    }),
    close: vi.fn(async () => {}),
  };
  return { watcherHandlers: handlers, watcher: fakeWatcher };
});
// chokidar 5 is pure ESM and its package exports no CJS entry, so vitest no
// longer synthesizes a default export from a factory mock the way it did for
// chokidar 4. daemon-deps.ts imports the DEFAULT (`import chokidar from
// 'chokidar'`), so the factory has to provide it explicitly — otherwise
// `chokidar.watch` is undefined, watchHaltCleared's try/catch swallows the
// TypeError, no handler is ever registered, and the test fails downstream on
// an empty handler map rather than at the mock.
vi.mock('chokidar', () => {
  const watch = vi.fn(() => watcher);
  return { default: { watch }, watch };
});
const { runProjectTeardown } = vi.hoisted(() => ({
  runProjectTeardown: vi.fn<
    (worktreePath: string, log?: (message: string) => void, opts?: { verbose?: boolean; timeoutSeconds?: number }) => Promise<void>
  >(),
}));
vi.mock('../../src/engine/worktree-prepare.js', () => ({
  prepareWorktree: vi.fn(),
  runProjectTeardown,
}));
import { execa } from 'execa';
import {
  isProcessed,
  readWorktreeOutcome,
  makeFeatureRunnerDeps,
  repairProcessed,
  watchHaltCleared,
} from '../../src/engine/daemon-deps.js';

describe('engine/daemon-deps', () => {
  let dir: string;
  beforeEach(async () => {
    vi.mocked(execa).mockReset();
    dir = await mkdtemp(join(tmpdir(), 'daemon-deps-'));
    await mkdir(join(dir, '.pipeline'), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    watcherHandlers.clear();
    watcher.on.mockClear();
  });

  describe('watchHaltCleared halt record supersession', () => {
    const slug = 'halted-feature';

    async function clearHalt(cause: 'operator' | 'rekick'): Promise<void> {
      const worktree = join(dir, slug);
      await mkdir(join(worktree, '.pipeline'), { recursive: true });
      if (cause === 'rekick') {
        await writeFile(join(worktree, '.pipeline', 'HALT.cleared'), 'cleared\n');
      }
      await mkdir(join(worktree, '.docs', 'halted'), { recursive: true });
      await writeFile(join(worktree, '.docs', 'halted', `${slug}.md`), 'Status: halted\n');

      watchHaltCleared(dir, slug, () => {});
      await (watcherHandlers.get('unlink') as () => Promise<void>)();
    }

    it('resolves a halt record with the operator cause before notifying the daemon', async () => {
      await clearHalt('operator');

      await expect(readFile(join(dir, slug, '.docs', 'halted', `${slug}.md`), 'utf8')).resolves.toContain(
        'Status: resolved\nResolution cause: operator\n',
      );
    });

    it('preserves the rekick cause verbatim when clearing a halt record', async () => {
      await clearHalt('rekick');

      await expect(readFile(join(dir, slug, '.docs', 'halted', `${slug}.md`), 'utf8')).resolves.toContain(
        'Resolution cause: rekick\n',
      );
    });

    it('does not create a halt record or commit when no record exists', async () => {
      const worktree = join(dir, slug);
      await mkdir(join(worktree, '.pipeline'), { recursive: true });
      watchHaltCleared(dir, slug, () => {});

      await (watcherHandlers.get('unlink') as () => Promise<void>)();

      expect(execa).not.toHaveBeenCalled();
      await expect(readFile(join(worktree, '.docs', 'halted', `${slug}.md`), 'utf8')).rejects.toThrow();
    });

    it('still appends halt_cleared when superseding the record fails', async () => {
      const worktree = join(dir, slug);
      await mkdir(join(worktree, '.pipeline'), { recursive: true });
      await mkdir(join(worktree, '.docs', 'halted', `${slug}.md`), { recursive: true });
      watchHaltCleared(dir, slug, () => {});

      await (watcherHandlers.get('unlink') as () => Promise<void>)();

      await expect(readFile(join(worktree, '.pipeline', 'audit-trail', 'events.jsonl'), 'utf8')).resolves.toContain(
        '"event":"halt_cleared"',
      );
    });
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
    // `originRefExists` controls whether `git rev-parse --verify origin/main`
    // resolves — i.e. whether the remote-tracking base is available.
    function routeGit(opts: {
      worktreeListed: boolean;
      branchExists: boolean;
      originRefExists?: boolean;
    }) {
      const originRefExists = opts.originRefExists ?? true;
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
        if (args[0] === 'rev-parse') {
          // resolveWorktreeBase: succeed only when origin/<base> is present.
          if (originRefExists) return { stdout: 'deadbeef' };
          throw new Error('fatal: Needed a single revision');
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

    it('creates a fresh branch+worktree off origin/<base> when neither exists', async () => {
      const { addCalls } = routeGit({ worktreeListed: false, branchExists: false });
      const wt = await deps(dir).createWorktree(slug);
      expect(wt.branch).toBe(`feat/daemon-${slug}`);
      expect(addCalls).toHaveLength(1);
      expect(addCalls[0]).toContain('-b'); // fresh: -b <branch> <path> origin/main
      // Forks from the remote-tracking tip, NOT local main, so the build starts
      // from the latest fetched origin even when the root drifted off main.
      expect(addCalls[0]).toContain('origin/main');
      expect(addCalls[0]).not.toContain('main'); // bare 'main' is never the base now
    });

    it('falls back to local <base> when origin/<base> is unresolvable (local-only repo)', async () => {
      const { addCalls } = routeGit({
        worktreeListed: false,
        branchExists: false,
        originRefExists: false,
      });
      await deps(dir).createWorktree(slug);
      expect(addCalls).toHaveLength(1);
      expect(addCalls[0]).toContain('-b');
      expect(addCalls[0]).toContain('main'); // fell back to local main
      expect(addCalls[0]).not.toContain('origin/main');
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

  describe('teardownWorktree', () => {
    const worktree = { path: join('/tmp', 'daemon-feature'), branch: 'feat/daemon-feature' };

    beforeEach(() => {
      vi.mocked(execa).mockReset();
      runProjectTeardown.mockReset();
      runProjectTeardown.mockResolvedValue(undefined);
    });

    it('runs project teardown once before reaping an unretained worktree', async () => {
      const calls: string[] = [];
      runProjectTeardown.mockImplementation(async (path) => {
        expect(path).toBe(worktree.path);
        calls.push('teardown');
      });
      vi.mocked(execa).mockImplementation((async (...args: unknown[]) => {
        expect(args).toEqual([
          'git',
          ['worktree', 'remove', '--force', worktree.path],
          { cwd: dir },
        ]);
        calls.push('remove');
        return { stdout: '' };
      }) as unknown as typeof execa);

      const d = makeFeatureRunnerDeps({
        projectRoot: dir,
        worktreeBase: join(dir, '.worktrees'),
        baseBranch: 'main',
        runConductorInWorktree: async () => {},
      });
      await d.teardownWorktree(worktree, false);

      expect(calls).toEqual(['teardown', 'remove']);
      expect(runProjectTeardown).toHaveBeenCalledTimes(1);
    });

    it('passes the resolved teardown timeout to the project hook', async () => {
      const d = makeFeatureRunnerDeps({
        projectRoot: dir,
        worktreeBase: join(dir, '.worktrees'),
        baseBranch: 'main',
        teardownTimeoutSeconds: 7,
        runConductorInWorktree: async () => {},
      });
      vi.mocked(execa).mockResolvedValue({ stdout: '' } as Awaited<ReturnType<typeof execa>>);

      await d.teardownWorktree(worktree, false);

      expect(runProjectTeardown).toHaveBeenCalledWith(worktree.path, undefined, {
        verbose: false,
        timeoutSeconds: 7,
      });
    });

    it('does not run project teardown or remove a retained worktree', async () => {
      const d = makeFeatureRunnerDeps({
        projectRoot: dir,
        worktreeBase: join(dir, '.worktrees'),
        baseBranch: 'main',
        runConductorInWorktree: async () => {},
      });
      await d.teardownWorktree(worktree, true);

      expect(runProjectTeardown).not.toHaveBeenCalled();
      expect(execa).not.toHaveBeenCalled();
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

  describe('repairProcessed (exemption regression pin)', () => {
    it('writes {"status":"shipped","prUrl":null} when record has no pr field (malformed base-branch record)', async () => {
      // Regression pin for ADR scope note (adr-2026-07-06-daemon-false-ship-guard):
      // `repairProcessed` is exempt from the null-prUrl guard because it is a cache
      // repair driven by a committed shipped record already merged on the base branch.
      // The ship is proven by independent evidence; null prUrl only marks a
      // malformed-but-proven record and is legitimate.
      const marker = join(dir, '.daemon/processed', 'billing-export');
      await repairProcessed(dir, 'billing-export', { malformed: true });
      const contents = await readFile(marker, 'utf-8');
      const parsed = JSON.parse(contents);
      expect(parsed).toEqual({ status: 'shipped', prUrl: null });
    });

    it('writes {"status":"shipped","prUrl":null} when record has null pr field', async () => {
      // Repair exemption: null prUrl is legitimate when repairing a committed
      // record that exists on the base branch (shipped status proven independent
      // of prUrl).
      const marker = join(dir, '.daemon/processed', 'repair-test');
      await repairProcessed(dir, 'repair-test', { pr: null as unknown as string });
      const contents = await readFile(marker, 'utf-8');
      const parsed = JSON.parse(contents);
      expect(parsed).toEqual({ status: 'shipped', prUrl: null });
    });

    it('writes the prUrl when the record has a valid pr field', async () => {
      const marker = join(dir, '.daemon/processed', 'good-record');
      await repairProcessed(dir, 'good-record', { pr: 'https://github.com/x/y/pull/9' });
      const contents = await readFile(marker, 'utf-8');
      const parsed = JSON.parse(contents);
      expect(parsed).toEqual({ status: 'shipped', prUrl: 'https://github.com/x/y/pull/9' });
    });

    it('creates .daemon/processed directory if missing', async () => {
      // Clean slate — no .daemon directory
      const newDir = join(dir, 'test-create-dir');
      await mkdir(newDir, { recursive: true });
      await repairProcessed(newDir, 'test-slug', { malformed: true });
      const marker = join(newDir, '.daemon/processed', 'test-slug');
      const contents = await readFile(marker, 'utf-8');
      expect(contents).toBeTruthy();
    });
  });
});
