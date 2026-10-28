// Covers: task:2
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { loadMergedConfig } from '../../../src/engine/config.js';
import {
  formatCascadeAllowance,
  renderCascadeSummary,
  resolveCascadeAllowanceForWorktree,
  resolveRestackCascadeAllowance,
} from '../../../src/engine/restack/cascade-allowance.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('resolveRestackCascadeAllowance', () => {
  it('uses the S/M/L defaults and retains an unrecorded tier', () => {
    expect(resolveRestackCascadeAllowance({} as never, 'S')).toEqual({ limit: 3, tier: 'S', source: 'default' });
    expect(resolveRestackCascadeAllowance({} as never, 'M')).toEqual({ limit: 3, tier: 'M', source: 'default' });
    expect(resolveRestackCascadeAllowance({} as never, 'L')).toEqual({ limit: 8, tier: 'L', source: 'default' });
    expect(resolveRestackCascadeAllowance({} as never, undefined)).toEqual({ limit: 3, tier: undefined, source: 'default' });
  });

  it('applies an integer to every tier and selectively falls back from a map', () => {
    const integer = { stacked_prs: { max_restack_cascades: 5 } } as never;
    for (const tier of ['S', 'M', 'L', undefined] as const) {
      expect(resolveRestackCascadeAllowance(integer, tier)).toEqual({ limit: 5, tier, source: 'configured' });
    }

    const mapped = { stacked_prs: { max_restack_cascades: { L: 10 } } } as never;
    expect(resolveRestackCascadeAllowance(mapped, 'L')).toEqual({ limit: 10, tier: 'L', source: 'configured' });
    expect(resolveRestackCascadeAllowance(mapped, 'S')).toEqual({ limit: 3, tier: 'S', source: 'default' });
    expect(resolveRestackCascadeAllowance(mapped, 'M')).toEqual({ limit: 3, tier: 'M', source: 'default' });
    expect(resolveRestackCascadeAllowance(mapped, undefined)).toEqual({ limit: 3, tier: undefined, source: 'default' });
  });
});

describe('cascade allowance configuration loading', () => {
  it('merges tier maps and replaces them with a project integer without materializing a cap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cascade-allowance-config-'));
    roots.push(root);
    const userConfigDir = join(root, 'user');
    const originalUserConfigDir = process.env.AI_CONDUCTOR_USER_CONFIG_DIR;
    try {
      await mkdir(join(root, '.ai-conductor'), { recursive: true });
      await mkdir(userConfigDir, { recursive: true });
      process.env.AI_CONDUCTOR_USER_CONFIG_DIR = userConfigDir;

      const load = async (user: string, project: string) => {
        await writeFile(join(userConfigDir, 'config.yml'), user);
        await writeFile(join(root, '.ai-conductor', 'config.yml'), project);
        const loaded = await loadMergedConfig(root);
        if (!loaded.ok) throw new Error(loaded.error.message);
        return loaded.config;
      };

      const mergedMaps = await load(
        'stacked_prs:\n  max_restack_cascades:\n    M: 2\n',
        'stacked_prs:\n  max_restack_cascades:\n    L: 6\n',
      );
      expect(resolveRestackCascadeAllowance(mergedMaps, 'S').limit).toBe(3);
      expect(resolveRestackCascadeAllowance(mergedMaps, 'M').limit).toBe(2);
      expect(resolveRestackCascadeAllowance(mergedMaps, 'L').limit).toBe(6);

      const projectInteger = await load(
        'stacked_prs:\n  max_restack_cascades:\n    L: 6\n',
        'stacked_prs:\n  max_restack_cascades: 4\n',
      );
      for (const tier of ['S', 'M', 'L', undefined] as const) {
        expect(resolveRestackCascadeAllowance(projectInteger, tier).limit).toBe(4);
      }

      const absent = await load('{}\n', 'stacked_prs:\n  enabled: true\n  max_slices: 5\n');
      expect(absent.stacked_prs).not.toHaveProperty('max_restack_cascades');
      expect(resolveRestackCascadeAllowance(absent, 'L')).toEqual({ limit: 8, tier: 'L', source: 'default' });
    } finally {
      if (originalUserConfigDir === undefined) delete process.env.AI_CONDUCTOR_USER_CONFIG_DIR;
      else process.env.AI_CONDUCTOR_USER_CONFIG_DIR = originalUserConfigDir;
    }
  });
});

describe('resolveCascadeAllowanceForWorktree', () => {
  it('reads tier from the feature worktree but configuration from the main checkout', async () => {
    const mainRoot = await mkdtemp(join(tmpdir(), 'cascade-allowance-worktree-'));
    roots.push(mainRoot);
    const worktree = join(mainRoot, '.worktrees', 'demo');
    const git = (args: string[], cwd = mainRoot) => execFile('git', args, { cwd });
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'cascade@example.test']);
    await git(['config', 'user.name', 'Cascade allowance']);
    await writeFile(join(mainRoot, 'README.md'), '# base\n');
    await git(['add', '.']);
    await git(['commit', '-qm', 'base']);
    await mkdir(join(mainRoot, '.worktrees'), { recursive: true });
    await git(['worktree', 'add', '-qb', 'feat/demo', worktree, 'main']);

    await mkdir(join(mainRoot, '.ai-conductor'), { recursive: true });
    await mkdir(join(worktree, '.ai-conductor'), { recursive: true });
    await mkdir(join(worktree, '.pipeline'), { recursive: true });
    await writeFile(join(mainRoot, '.ai-conductor', 'config.yml'), '{}\n');
    await writeFile(join(worktree, '.pipeline', 'conduct-state.json'), JSON.stringify({ complexity_tier: 'L' }));

    await expect(resolveCascadeAllowanceForWorktree(worktree)).resolves.toEqual({
      limit: 8, tier: 'L', source: 'default',
    });

    await writeFile(join(mainRoot, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  max_restack_cascades:\n    L: 6\n');
    await writeFile(join(worktree, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  max_restack_cascades:\n    L: 9\n');

    await expect(resolveCascadeAllowanceForWorktree(worktree)).resolves.toEqual({
      limit: 6, tier: 'L', source: 'configured',
    });

    await rm(join(worktree, '.pipeline', 'conduct-state.json'));
    await expect(resolveCascadeAllowanceForWorktree(worktree)).resolves.toEqual({
      limit: 3, tier: undefined, source: 'default',
    });
  });

  it('formats the allowance phrase shared by restack surfaces', () => {
    expect(formatCascadeAllowance({ limit: 8, tier: 'L', source: 'default' })).toBe('tier L allowance 8 (default)');
    expect(formatCascadeAllowance({ limit: 4, tier: 'M', source: 'configured' })).toBe('tier M allowance 4 (configured)');
    expect(formatCascadeAllowance({ limit: 3, tier: undefined, source: 'default' })).toBe(
      'tier unrecorded, treated as M; allowance 3 (default)',
    );
  });
});

describe('renderCascadeSummary', () => {
  it('renders inspect lines, a status fragment, and JSON for every counted or raised child', () => {
    const summary = renderCascadeSummary({
      version: 1,
      counts: { 1: 4, 2: 3 },
      limits: { 2: 10, 3: 9 },
    }, { limit: 8, tier: 'L', source: 'default' });

    expect(summary.inspectLines).toEqual([
      'Restack cascades — tier L allowance 8 (default)',
      'child 1: 4/8 consumed; 4 remaining',
      'child 2: 3/10 consumed; 7 remaining (raised)',
      'child 3: 0/9 consumed; 9 remaining (raised)',
    ]);
    expect(summary.statusFragment).toBe(
      'tier L allowance 8 (default); child 1 4/8, child 2 3/10 (raised), child 3 0/9 (raised)',
    );
    expect(summary.json).toEqual({
      tier: 'L',
      allowance: 8,
      source: 'default',
      children: [
        { child: 1, consumed: 4, limit: 8, remaining: 4, raised: false },
        { child: 2, consumed: 3, limit: 10, remaining: 7, raised: true },
        { child: 3, consumed: 0, limit: 9, remaining: 9, raised: true },
      ],
    });
  });

  it('renders an unrecorded-tier empty cascade view consistently', () => {
    const summary = renderCascadeSummary(
      { version: 1, counts: {} },
      { limit: 3, tier: undefined, source: 'default' },
    );

    expect(summary.inspectLines).toEqual([
      'Restack cascades — tier unrecorded, treated as M; allowance 3 (default)',
      'none charged',
    ]);
    expect(summary.statusFragment).toBe('tier unrecorded, treated as M; allowance 3 (default); none charged');
    expect(summary.json).toEqual({ tier: null, allowance: 3, source: 'default', children: [] });
  });
});
