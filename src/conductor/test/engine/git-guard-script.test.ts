// Covers: task:3, task:4, task:5
import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GIT_GUARD_SCRIPT } from '../../src/engine/git-hook-assets.js';

const FEATURE_COMMON_DIR = '/fixture/feature-common';
const SAFE_CLASSIFICATION_COMMANDS = new Set(['config', 'rev-parse', 'for-each-ref', 'merge-base']);

interface GuardResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
  signal?: NodeJS.Signals | null;
}

const REFUSAL_CASES: Array<[string, string[], RegExp, RegExp]> = [
  ['force push', ['push', '--force', 'origin', 'main'], /bare force push/, /--force-with-lease/],
  ['short force push', ['push', '-f', 'origin', 'main'], /bare force push/, /--force-with-lease/],
  ['force refspec push', ['push', 'origin', '+HEAD:main'], /bare force push/, /--force-with-lease/],
  ['short force refspec push', ['push', 'origin', '+feature'], /bare force push/, /--force-with-lease/],
  ['force beside lease push', ['push', '--force-with-lease', '--force', 'origin', 'main'], /bare force push/, /--force-with-lease/],
  ['hard reset', ['reset', '--hard', 'HEAD~1'], /hard reset/, /reset --keep/],
  ['force branch delete', ['branch', '-D', 'unreachable'], /commits unreachable/, /branch -d/],
  ['long force branch delete', ['branch', '--delete', '--force', 'unreachable'], /commits unreachable/, /branch -d/],
  ['forced clean', ['clean', '-f'], /forced clean/, /clean -n/],
  ['clustered forced clean', ['clean', '-fd'], /forced clean/, /clean -n/],
  ['mixed clustered forced clean', ['clean', '-xdf'], /forced clean/, /clean -n/],
  ['long forced clean', ['clean', '--force'], /forced clean/, /clean -n/],
  ['path checkout', ['checkout', '--', 'file'], /path checkout/, /commit a WIP first or use a temporary worktree/],
  ['tree-ish path checkout', ['checkout', 'HEAD', '--', 'file'], /path checkout/, /commit a WIP first or use a temporary worktree/],
  ['working-tree restore', ['restore', 'file'], /restore discards/, /commit a WIP first or use a temporary worktree/],
];

describe('GIT_GUARD_SCRIPT refusal messages', () => {
  let fixtureDir: string;
  let guardPath: string;
  let callsPath: string;
  let aliasPath: string;

  beforeEach(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), 'git-guard-script-'));
    const binDir = join(fixtureDir, '.pipeline', 'bin');
    const guardDataDir = join(fixtureDir, '.pipeline', 'git-guard');
    callsPath = join(fixtureDir, 'calls');
    aliasPath = join(fixtureDir, 'alias');
    guardPath = join(binDir, 'git');
    const realGitPath = join(fixtureDir, 'real-git');

    await Promise.all([mkdir(binDir, { recursive: true }), mkdir(guardDataDir, { recursive: true })]);
    await writeFile(guardPath, GIT_GUARD_SCRIPT, 'utf8');
    await chmod(guardPath, 0o755);
    await writeFile(join(guardDataDir, 'common-dir'), `${FEATURE_COMMON_DIR}\n`, 'utf8');
    await writeFile(join(guardDataDir, 'real-git'), `${realGitPath}\n`, 'utf8');
    await writeFile(realGitPath, `#!/usr/bin/env bash
printf '%s\\n' "$1" >> ${JSON.stringify(callsPath)}
case "$1" in
  rev-parse) printf '%s\\n' ${JSON.stringify(FEATURE_COMMON_DIR)} ;;
  config) cat ${JSON.stringify(aliasPath)} 2>/dev/null || true ;;
  push) printf '%s\\n' 'non-fast-forward: remote rejected update' >&2; exit 17 ;;
esac
`, 'utf8');
    await chmod(realGitPath, 0o755);
  });

  afterEach(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  function invoke(args: string[]): GuardResult {
    const result = spawnSync(guardPath, args, { cwd: fixtureDir, encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error, signal: result.signal };
  }

  async function recordedCommands(): Promise<string[]> {
    try {
      return (await readFile(callsPath, 'utf8')).trim().split('\n').filter(Boolean);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  it.each(REFUSAL_CASES)('refuses %s with one actionable message and only read-only classification calls', async (_name, args, reason, alternative) => {
    const result = invoke(args);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(new RegExp(`^ai-conductor git guard: refused ${args[0]} — `));
    expect(result.stderr.trim().split('\n')).toHaveLength(1);
    expect(result.stderr).toMatch(reason);
    expect(result.stderr).toMatch(alternative);
    expect((await recordedCommands()).every((command) => SAFE_CLASSIFICATION_COMMANDS.has(command))).toBe(true);
  });

  it('passes through an allowed push rejection without adding guard text', async () => {
    const result = invoke(['push', 'origin', 'main']);

    expect(result.status).toBe(17);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('non-fast-forward: remote rejected update\n');
    expect(await recordedCommands()).toEqual(['config', 'push']);
  });

  it('passes a safe built-in through with exactly one real-git invocation', async () => {
    const result = invoke(['status']);

    expect(result.status).toBe(0);
    expect(await recordedCommands()).toEqual(['status']);
  });

  it.each([
    ['lease force push', ['push', '--force-with-lease', '--force-if-includes', 'origin', 'main']],
    ['non-hard reset', ['reset', '--keep', 'HEAD']],
    ['soft reset', ['reset', '--soft', 'HEAD']],
    ['mixed reset', ['reset', '--mixed', 'HEAD']],
    ['safe built-in with no alias query', ['show', 'HEAD']],
    ['safe fetch with no alias query', ['fetch', 'origin']],
    ['safe add with no alias query', ['add', 'file']],
    ['safe ls-files with no alias query', ['ls-files']],
  ])('passes %s byte-identically to real git', async (_name, args) => {
    const result = invoke(args);
    expect(result.status).toBe(args[0] === 'push' ? 17 : 0);
    expect(await recordedCommands()).toEqual(args[0] === 'show' || args[0] === 'fetch' || args[0] === 'add' || args[0] === 'ls-files' ? [args[0]] : ['config', args[0]]);
  });

  it.each(["reset '--hard'", 'reset "--hard"', "clean '-f'"])('refuses quote-aware destructive alias %s', async (alias) => {
    await writeFile(aliasPath, alias, 'utf8');
    const result = invoke(['guarded']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ai-conductor git guard: refused');
    expect(await recordedCommands()).toContain('rev-parse');
    expect(await recordedCommands()).not.toContain('reset');
    expect(await recordedCommands()).not.toContain('clean');
  });

  it('expands a quoted non-destructive alias before invoking real git', async () => {
    await writeFile(aliasPath, "log '-1'", 'utf8');
    const result = invoke(['guarded']);
    expect(result.status).toBe(0);
    expect(await recordedCommands()).toEqual(['config', 'log']);
  });
});

// These cases deliberately use local Git rather than the classification stub:
// they prove that the shim preserves real repository data on refusal and that
// allowed forms reach Git unchanged.
describe('GIT_GUARD_SCRIPT in a scratch repository', () => {
  let root: string;
  let repository: string;
  let guard: string;
  const git = (args: string[], cwd = repository) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'git-guard-real-'));
    repository = join(root, 'repo');
    await mkdir(repository);
    git(['init', '-b', 'main']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    await writeFile(join(repository, 'tracked'), 'base\n');
    git(['add', '.']); git(['commit', '-m', 'base']);
    const bin = join(repository, '.pipeline', 'bin');
    const data = join(repository, '.pipeline', 'git-guard');
    await Promise.all([mkdir(bin, { recursive: true }), mkdir(data, { recursive: true })]);
    guard = join(bin, 'git');
    await writeFile(guard, GIT_GUARD_SCRIPT); await chmod(guard, 0o755);
    await writeFile(join(data, 'real-git'), `${execFileSync('which', ['git'], { encoding: 'utf8' }).trim()}\n`);
    await writeFile(join(data, 'common-dir'), `${git(['rev-parse', '--path-format=absolute', '--git-common-dir'])}\n`);
  });

  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  const invoke = (args: string[], cwd = repository, env: NodeJS.ProcessEnv = process.env) => spawnSync(guard, args, { cwd, encoding: 'utf8', env });

  it('refuses destructive operations in the guarded repository without changing its tips or untracked bytes', async () => {
    git(['switch', '-c', 'unreachable']);
    await writeFile(join(repository, 'tracked'), 'unreachable\n'); git(['add', 'tracked']); git(['commit', '-m', 'unreachable']);
    const tip = git(['rev-parse', 'unreachable']); git(['switch', 'main']);
    await writeFile(join(repository, 'untracked'), 'survive exactly\n');
    const branchDelete = invoke(['branch', '-D', 'unreachable']);
    expect(branchDelete.error).toBeUndefined();
    expect(branchDelete.signal).toBeNull();
    expect(branchDelete.status).toBe(1);
    expect(invoke(['clean', '-f']).status).toBe(1);
    expect(git(['rev-parse', 'unreachable'])).toBe(tip);
    expect(await readFile(join(repository, 'untracked'), 'utf8')).toBe('survive exactly\n');
  });

  it('passes reachable forced and ordinary branch deletion to real Git, including remote-only reachability', async () => {
    git(['branch', 'local-reachable']);
    expect(invoke(['branch', '-D', 'local-reachable']).status).toBe(0);
    git(['branch', 'remote-reachable']);
    const tip = git(['rev-parse', 'remote-reachable']);
    git(['update-ref', 'refs/remotes/origin/remote-reachable', tip]);
    expect(invoke(['branch', '-D', 'remote-reachable']).status).toBe(0);
    git(['branch', 'ordinary']);
    expect(invoke(['branch', '-d', 'ordinary']).status).toBe(0);
  });

  it('refuses path discard forms but allows conflict-side selection, and does not guard a foreign repository', async () => {
    await writeFile(join(repository, 'tracked'), 'edited\n');
    for (const args of [['checkout', '--', 'tracked'], ['restore', 'tracked'], ['restore', '--worktree', 'tracked']] as const) {
      expect(invoke([...args]).status).toBe(1);
      expect(await readFile(join(repository, 'tracked'), 'utf8')).toBe('edited\n');
    }
    const foreign = join(root, 'foreign'); await mkdir(foreign); git(['init', '-b', 'main'], foreign);
    git(['config', 'user.email', 'test@example.com'], foreign); git(['config', 'user.name', 'Test'], foreign);
    await writeFile(join(foreign, 'untracked'), 'remove\n');
    expect(invoke(['-C', foreign, 'clean', '-f']).status).toBe(0);
    expect(() => execFileSync('test', ['-e', join(foreign, 'untracked')])).toThrow();
  });
  async function provisionGuardIn(worktree: string): Promise<string> {
    const bin = join(worktree, '.pipeline', 'bin');
    const data = join(worktree, '.pipeline', 'git-guard');
    await Promise.all([mkdir(bin, { recursive: true }), mkdir(data, { recursive: true })]);
    const copy = join(bin, 'git');
    await writeFile(copy, GIT_GUARD_SCRIPT); await chmod(copy, 0o755);
    await writeFile(join(data, 'real-git'), `${execFileSync('which', ['git'], { encoding: 'utf8' }).trim()}\n`);
    await writeFile(join(data, 'common-dir'), `${git(['rev-parse', '--path-format=absolute', '--git-common-dir'], worktree)}\n`);
    return copy;
  }

  async function foreignRepository(): Promise<string> {
    const foreign = join(root, 'foreign'); await mkdir(foreign); git(['init', '-b', 'main'], foreign);
    git(['config', 'user.email', 'test@example.com'], foreign); git(['config', 'user.name', 'Test'], foreign);
    await writeFile(join(foreign, 'f'), 'f\n'); git(['add', '.'], foreign); git(['commit', '-m', 'f'], foreign);
    return foreign;
  }

  it.each([
    ['checkout --ours', ['checkout', '--ours', '--', 'tracked'], 'main side\n'],
    ['checkout --theirs', ['checkout', '--theirs', '--', 'tracked'], 'side side\n'],
    ['restore --ours', ['restore', '--ours', 'tracked'], 'main side\n'],
    ['restore --theirs', ['restore', '--theirs', 'tracked'], 'side side\n'],
  ])('lets %s resolve a file in a merge stopped on a conflict', async (_name, args, expected) => {
    git(['switch', '-c', 'side']);
    await writeFile(join(repository, 'tracked'), 'side side\n'); git(['commit', '-am', 'side']);
    git(['switch', 'main']);
    await writeFile(join(repository, 'tracked'), 'main side\n'); git(['commit', '-am', 'main']);
    expect(spawnSync('git', ['merge', 'side'], { cwd: repository, encoding: 'utf8' }).status).not.toBe(0);
    expect(await readFile(join(repository, 'tracked'), 'utf8')).toContain('<<<<<<<');

    const result = invoke([...args]);
    expect(result.stderr).not.toContain('ai-conductor git guard');
    expect(result.status).toBe(0);
    expect(await readFile(join(repository, 'tracked'), 'utf8')).toBe(expected);
  });

  it('refuses -C retargeting of the feature repository from a foreign current directory', async () => {
    const foreign = await foreignRepository();
    await writeFile(join(repository, 'tracked'), 'edited\n');
    const result = invoke(['-C', repository, 'reset', '--hard'], foreign);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ai-conductor git guard: refused reset');
    expect(await readFile(join(repository, 'tracked'), 'utf8')).toBe('edited\n');
  });

  it('refuses GIT_DIR retargeting of the feature repository from a foreign current directory', async () => {
    const foreign = await foreignRepository();
    await writeFile(join(repository, 'tracked'), 'edited\n');
    const result = invoke(['reset', '--hard'], foreign, { ...process.env, GIT_DIR: join(repository, '.git'), GIT_WORK_TREE: repository });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ai-conductor git guard: refused reset');
    expect(await readFile(join(repository, 'tracked'), 'utf8')).toBe('edited\n');
  });

  it('classifies -C branch -D reachability in the targeted feature repository, not the current directory', async () => {
    const foreign = await foreignRepository();
    git(['branch', 'doomed'], foreign); // reachable from foreign main
    git(['switch', '-c', 'doomed']);
    await writeFile(join(repository, 'tracked'), 'only here\n'); git(['commit', '-am', 'only here']);
    const tip = git(['rev-parse', 'doomed']); git(['switch', 'main']);

    const result = invoke(['-C', repository, 'branch', '-D', 'doomed'], foreign);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('commits unreachable');
    expect(git(['rev-parse', 'doomed'])).toBe(tip);
  });

  it.each(['sibling worktree', 'root checkout'])('refuses clean -f in the feature repository\'s %s', async (where) => {
    const feature = join(root, 'feature-wt');
    const sibling = join(root, 'sibling-wt');
    git(['worktree', 'add', '-b', 'feature', feature]);
    git(['worktree', 'add', '-b', 'sibling', sibling]);
    const featureGuard = await provisionGuardIn(feature);
    const cwd = where === 'sibling worktree' ? sibling : repository;
    await writeFile(join(cwd, 'untracked'), 'survive\n');

    const result = spawnSync(featureGuard, ['clean', '-f'], { cwd, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ai-conductor git guard: refused clean');
    expect(await readFile(join(cwd, 'untracked'), 'utf8')).toBe('survive\n');
  });
});
