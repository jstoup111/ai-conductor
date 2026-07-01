import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('execa', () => ({ execa: vi.fn() }));
import { execa } from 'execa';
import {
  ensureWorktree,
  removeWorktree,
  worktreeStatus,
} from '../../src/engine/worktree-shared.js';

const mockExeca = vi.mocked(execa);
const ROOT = '/repo';
const PATH = '/repo/.worktrees/engineer-add-auth';
const BRANCH = 'spec/add-auth';

/**
 * Route git subcommands. `worktreeListed` controls whether the path is a
 * registered worktree; `branchExists` controls whether `show-ref` resolves.
 * `addCalls` records every `worktree add`; `baseResolved` records resolveBase calls.
 */
function routeGit(opts: { worktreeListed: boolean; branchExists: boolean }) {
  const addCalls: string[][] = [];
  const removeCalls: string[][] = [];
  mockExeca.mockImplementation((async (...callArgs: unknown[]) => {
    const args = (callArgs[1] as string[]) ?? [];
    if (args[0] === 'worktree' && args[1] === 'list') {
      return { stdout: opts.worktreeListed ? `worktree ${PATH}\n` : `worktree ${ROOT}` };
    }
    if (args[0] === 'show-ref') {
      if (opts.branchExists) return { stdout: '' };
      throw new Error('no ref');
    }
    if (args[0] === 'worktree' && args[1] === 'add') {
      addCalls.push(args);
      return { stdout: '' };
    }
    if (args[0] === 'worktree' && args[1] === 'remove') {
      removeCalls.push(args);
      return { stdout: '' };
    }
    if (args[0] === 'status') return { stdout: opts.worktreeListed ? ' M foo.ts\n' : '' };
    return { stdout: '' };
  }) as unknown as typeof execa);
  return { addCalls, removeCalls };
}

describe('worktree-shared/ensureWorktree', () => {
  beforeEach(() => mockExeca.mockReset());

  it('creates a fresh branch+worktree off the resolved base when neither exists', async () => {
    const { addCalls } = routeGit({ worktreeListed: false, branchExists: false });
    const resolveBase = vi.fn(async () => 'main');
    const res = await ensureWorktree({ root: ROOT, path: PATH, branch: BRANCH, resolveBase });
    expect(res).toEqual({ path: PATH, branch: BRANCH, reconcile: 'created' });
    expect(resolveBase).toHaveBeenCalledOnce();
    expect(addCalls).toHaveLength(1);
    expect(addCalls[0]).toEqual(['worktree', 'add', '-b', BRANCH, PATH, 'main']);
  });

  it('attaches a worktree to an existing branch (leftover-branch-no-worktree, FR-11)', async () => {
    const { addCalls } = routeGit({ worktreeListed: false, branchExists: true });
    const resolveBase = vi.fn(async () => 'main');
    const res = await ensureWorktree({ root: ROOT, path: PATH, branch: BRANCH, resolveBase });
    expect(res.reconcile).toBe('attached');
    expect(addCalls).toHaveLength(1);
    expect(addCalls[0]).toEqual(['worktree', 'add', PATH, BRANCH]); // no -b
    expect(resolveBase).not.toHaveBeenCalled(); // base resolved lazily — only for a fresh branch
  });

  it('reuses an already-registered worktree without adding (resume)', async () => {
    const { addCalls } = routeGit({ worktreeListed: true, branchExists: true });
    const resolveBase = vi.fn(async () => 'main');
    const res = await ensureWorktree({ root: ROOT, path: PATH, branch: BRANCH, resolveBase });
    expect(res.reconcile).toBe('reused');
    expect(addCalls).toHaveLength(0);
    expect(resolveBase).not.toHaveBeenCalled();
  });
});

describe('worktree-shared/removeWorktree', () => {
  beforeEach(() => mockExeca.mockReset());

  it('removes the worktree with --force', async () => {
    const { removeCalls } = routeGit({ worktreeListed: true, branchExists: true });
    await removeWorktree(ROOT, PATH);
    expect(removeCalls).toHaveLength(1);
    expect(removeCalls[0]).toEqual(['worktree', 'remove', '--force', PATH]);
  });

  // removeWorktree deliberately has NO try/catch, so a `git worktree remove` failure
  // propagates to the caller (FR-5 negative — "removal failure reported, not
  // swallowed"). That operator-facing REPORTING is asserted at the lifecycle layer
  // (handoff worktree-teardown) with an injected removeWorktree spy — rejecting the
  // module-level execa mock here trips a vitest spy settled-result artifact and the
  // low-level "does not catch" is already evident from the source.
});

describe('worktree-shared/worktreeStatus', () => {
  beforeEach(() => mockExeca.mockReset());

  it('surfaces a dirty leftover worktree (FR-11 negative — not silently reused)', async () => {
    routeGit({ worktreeListed: true, branchExists: true });
    expect(await worktreeStatus(PATH)).toBe('M foo.ts');
  });

  it('reports clean as empty string', async () => {
    routeGit({ worktreeListed: false, branchExists: false });
    expect(await worktreeStatus(PATH)).toBe('');
  });
});
