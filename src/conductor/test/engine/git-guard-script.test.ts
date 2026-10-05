// Covers: task:2, task:3, task:4, task:5, task:12
import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GIT_GUARD_SCRIPT } from '../../src/engine/git-hook-assets.js';
import { writeGitGuard } from '../../src/engine/git-guard.js';

type Expectation = 'refuse' | 'allow' | 'not-applicable';
interface CorpusCase {
  name: string;
  argv: string[];
  command: string;
  pathGuard: Expectation;
  hook: Expectation;
  branch?: 'unreachable' | 'reachable-unmerged' | 'merged';
  spellingOnly?: boolean;
  policyDifference?: 'checkout-paths' | 'branch-merged-rule';
  alias?: string;
}
const destructiveGitCorpus = JSON.parse(await readFile(new URL('../fixtures/destructive-git-corpus.json', import.meta.url), 'utf8')) as CorpusCase[];

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
  let branchStatePath: string;

  beforeEach(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), 'git-guard-script-'));
    const binDir = join(fixtureDir, '.pipeline', 'bin');
    const guardDataDir = join(fixtureDir, '.pipeline', 'git-guard');
    callsPath = join(fixtureDir, 'calls');
    aliasPath = join(fixtureDir, 'alias');
    branchStatePath = join(fixtureDir, 'branch-state');
    guardPath = join(binDir, 'git');
    const realGitPath = join(fixtureDir, 'real-git');

    await Promise.all([mkdir(binDir, { recursive: true }), mkdir(guardDataDir, { recursive: true })]);
    await writeFile(guardPath, GIT_GUARD_SCRIPT, 'utf8');
    await chmod(guardPath, 0o755);
    await writeFile(join(guardDataDir, 'common-dir'), `${FEATURE_COMMON_DIR}\n`, 'utf8');
    await writeFile(join(guardDataDir, 'real-git'), `${realGitPath}\n`, 'utf8');
    await writeFile(realGitPath, `#!/usr/bin/env bash
printf '%s\\0' "$@" >> ${JSON.stringify(callsPath)}
printf '\\n' >> ${JSON.stringify(callsPath)}
argv=("$@")
command_index=0
while [[ $command_index -lt $# ]]; do
  case "\${argv[$command_index]}" in
    -C|-c|--git-dir|--work-tree|--namespace|--config-env) ((command_index+=2)); continue ;;
    --config-env=*|--git-dir=*|--work-tree=*|--namespace=*|--exec-path=*|--attr-source=*) ((command_index++)); continue ;;
    --exec-path|--no-pager|--paginate|-P|--no-optional-locks|--no-replace-objects|--no-lazy-fetch|--no-advice|--bare|--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs) ((command_index++)); continue ;;
  esac
  break
done
case "\${argv[$command_index]}" in
  rev-parse) printf '%s\\n' ${JSON.stringify(FEATURE_COMMON_DIR)} ;;
  config) cat ${JSON.stringify(aliasPath)} 2>/dev/null || true ;;
  for-each-ref) [[ "$(cat ${JSON.stringify(branchStatePath)} 2>/dev/null)" == reachable-unmerged ]] && printf '%s\\n' refs/heads/other ;;
  merge-base) [[ "$(cat ${JSON.stringify(branchStatePath)} 2>/dev/null)" == reachable-unmerged ]] && exit 0; exit 1 ;;
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
    return (await recordedArgv()).map(([command]) => command);
  }

  async function recordedArgv(): Promise<string[][]> {
    try {
      return (await readFile(callsPath, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((call) => call.split('\0').slice(0, -1));
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
    ['--config-env equals form', ['--config-env=core.pager=PAGER', 'reset', '--hard']],
    ['-C and --no-pager', ['-C', 'fixture', '--no-pager', 'reset', '--hard']],
  ])('refuses hard reset after global options in the %s without reaching real git', async (_name, args) => {
    await mkdir(join(fixtureDir, 'fixture'));

    const result = invoke(args);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ai-conductor git guard: refused reset');
    expect(result.stderr).toContain('hard reset');
    expect(result.stderr).toContain('reset --keep');
    expect((await recordedArgv()).some((argv) => argv.includes('reset'))).toBe(false);
  });

  it('passes an unknown global option before a safe command through with exact argv', async () => {
    const args = ['--no-pag', 'status'];

    expect(invoke(args).status).toBe(0);
    expect(await recordedArgv()).toEqual([args]);
  });

  it('refuses an unknown global option before reset without reaching real git', async () => {
    const result = invoke(['--no-pag', 'reset', '--hard']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unrecognized git option «--no-pag» before «reset»');
    expect((await recordedArgv()).some((argv) => argv.includes('reset'))).toBe(false);
  });

  it('refuses an attached -C global option before reset without reaching real git', async () => {
    const result = invoke(['-Cfixture', 'reset', '--hard']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unrecognized git option «-Cfixture» before «reset»');
    expect((await recordedArgv()).some((argv) => argv.includes('reset'))).toBe(false);
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

  it('classifies a quoted non-destructive alias but preserves it for real git', async () => {
    await writeFile(aliasPath, "log '-1'", 'utf8');
    const result = invoke(['guarded']);
    expect(result.status).toBe(0);
    expect(await recordedCommands()).toEqual(['config', 'guarded']);
  });

  it('normalizes destructive options after expanding a nuke alias', async () => {
    await writeFile(aliasPath, 'reset --har', 'utf8');

    const result = invoke(['nuke']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('hard reset discards working-tree changes');
    expect(result.stderr).toContain('git reset --keep');
    expect(await recordedCommands()).not.toContain('nuke');
    expect(await recordedCommands()).not.toContain('reset');
  });

  it('preserves the original argv after expanding a safe nuke alias', async () => {
    await writeFile(aliasPath, 'reset --keep HEAD~1', 'utf8');

    expect(invoke(['nuke']).status).toBe(0);
    expect((await recordedArgv()).at(-1)).toEqual(['nuke']);
  });

  it.each([
    ['abbreviated hard reset', ['reset', '--har'], /hard reset/],
    ['shortened hard reset', ['reset', '--ha', 'HEAD~1'], /hard reset/],
    ['abbreviated forced clean', ['clean', '--fo'], /forced clean/],
    ['shortened forced clean', ['clean', '--forc', '-d'], /forced clean/],
    ['bundled forced clean', ['clean', '-dxf'], /forced clean/],
    ['global-prefixed abbreviated reset', ['-C', 'fixture', '--no-pager', 'reset', '--har'], /hard reset/],
    ['config-prefixed abbreviated reset', ['--config-env=core.pager=PAGER', 'reset', '--ha'], /hard reset/],
    ['bundled force branch deletion', ['branch', '-df', 'unreachable'], /commits unreachable/],
    ['reversed bundled force branch deletion', ['branch', '-fd', 'unreachable'], /commits unreachable/],
    ['expanded force branch deletion', ['branch', '-Dq', 'unreachable'], /commits unreachable/],
    ['abbreviated branch deletion', ['branch', '--del', '--force', 'unreachable'], /commits unreachable/],
    ['path checkout after option terminator', ['checkout', '--', '--har'], /path checkout/],
  ])('normalizes %s before classifying it', async (_name, args, reason) => {
    await mkdir(join(fixtureDir, 'fixture'));
    const result = invoke(args);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(reason);
    expect((await recordedArgv()).some((argv) => argv.includes(args.includes('branch') ? 'branch' : args.includes('clean') ? 'clean' : args.includes('checkout') ? 'checkout' : 'reset'))).toBe(false);
  });

  it.each([
    ['reset keep abbreviation', ['reset', '--ke', 'HEAD~1']],
    ['reset soft abbreviation', ['reset', '--so', 'HEAD~1']],
    ['reset mixed', ['reset', '--mix']],
    ['push force-with-lease abbreviation', ['push', '--force-with', 'origin', 'main']],
    ['non-forced clean bundle', ['clean', '-nd']],
    ['dry-run clean abbreviation', ['clean', '--dry']],
  ])('passes normalized safe %s through unchanged', async (_name, args) => {
    const result = invoke(args);
    expect(result.status).toBe(args[0] === 'push' ? 17 : 0);
    expect((await recordedArgv()).at(-1)).toEqual(args);
  });

  it.each([
    ['unknown reset option', ['reset', '--bogus', 'HEAD'], '--bogus'],
    ['ambiguous push option', ['push', '--forc', 'origin', 'main'], '--forc'],
    ['unknown branch short option', ['branch', '-Z', 'unreachable'], '-Z'],
  ])('refuses an unresolvable %s before it reaches real git', async (_name, args, token) => {
    const result = invoke(args);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`unrecognized option «${token}» for git «${args[0]}»`);
    expect(result.stderr).toContain('spell the option in full');
    expect((await recordedCommands()).every((command) => SAFE_CLASSIFICATION_COMMANDS.has(command))).toBe(true);
  });

  it.each([
    ['status unknown option', ['status', '--bogus']],
    ['log unknown option', ['log', '--ha']],
    ['push short upstream', ['push', '-u', 'origin', 'feature']],
    ['branch verbose bundle', ['branch', '-vv']],
    ['checkout branch', ['checkout', '-b', 'feature']],
    ['restore staged', ['restore', '--staged', 'file']],
    ['reset soft', ['reset', '--soft', 'HEAD~1']],
  ])('passes a resolvable or unguarded %s through unchanged', async (_name, args) => {
    const result = invoke(args);
    expect(result.status).toBe(args[0] === 'push' ? 17 : 0);
    expect((await recordedArgv()).at(-1)).toEqual(args);
  });

  it('does not refuse an unresolvable guarded option outside the feature repository', async () => {
    await writeFile(join(fixtureDir, '.pipeline', 'git-guard', 'common-dir'), '/other/common-dir\n');
    const args = ['reset', '--bogus'];

    expect(invoke(args).status).toBe(0);
    expect((await recordedArgv()).at(-1)).toEqual(args);
  });

  it.each([
    ['lease and includes push', ['push', '--force-with-lease', '--force-if-includes', 'origin', 'main']],
    ['keep reset', ['reset', '--keep', 'HEAD~1']],
    ['ordinary branch delete', ['branch', '-d', 'unreachable']],
    ['dry-run clean', ['clean', '-n']],
    ['checkout conflict side', ['checkout', '--ours', '--', 'file']],
    ['staged restore', ['restore', '--staged', 'file']],
  ])('preserves canonical safe %s argv', async (_name, args) => {
    const result = invoke(args);
    expect(result.status).toBe(args[0] === 'push' ? 17 : 0);
    expect((await recordedArgv()).at(-1)).toEqual(args);
  });

  it('keeps a hard reset refusal when a later option selects another mode', async () => {
    const result = invoke(['reset', '--hard', '--soft']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('hard reset discards working-tree changes');
    expect((await recordedCommands()).some((command) => command === 'reset')).toBe(false);
  });

  it('drives every applicable shared corpus case and no excluded case', async () => {
    const applicable = destructiveGitCorpus.filter(({ pathGuard }) => pathGuard !== 'not-applicable');
    let ran = 0;
    for (const corpusCase of applicable) {
      await writeFile(aliasPath, corpusCase.alias ?? '', 'utf8');
      await writeFile(branchStatePath, corpusCase.branch ?? '', 'utf8');
      const result = invoke(corpusCase.argv);
      // An allowed push reaches the stub real git, which rejects every push with 17.
      const allowedStatus = corpusCase.argv[0] === 'push' ? 17 : 0;
      expect(result.status, corpusCase.name).toBe(corpusCase.pathGuard === 'refuse' ? 1 : allowedStatus);
      ran += 1;
    }
    expect(ran).toBe(applicable.length);
  });

  it('enforces the shared corpus schema and policy boundaries', () => {
    const names = new Set(destructiveGitCorpus.map(({ name }) => name));
    for (const name of ['C prefix branch delete', 'git-dir prefix branch delete', 'config-env global prefix', 'escaped heredoc only', 'quoted heredoc opener only', 'comment heredoc marker', 'git-dir equals reset', 'quoted alias hard reset', 'multiple quoted heredocs only', 'spaced quoted heredoc only', 'reset abbreviated hard', 'branch bundled delete force', 'branch abbreviated delete force', 'clean bundled force', 'push plus refspec']) expect(names).toContain(name);
    for (const corpusCase of destructiveGitCorpus) {
      if (corpusCase.spellingOnly) expect([corpusCase.pathGuard, corpusCase.hook]).toEqual(['refuse', 'refuse']);
      if (corpusCase.pathGuard !== 'not-applicable' && corpusCase.hook !== 'not-applicable' && corpusCase.pathGuard !== corpusCase.hook) expect(corpusCase.policyDifference).toMatch(/^(checkout-paths|branch-merged-rule)$/);
      if (corpusCase.pathGuard === 'not-applicable') expect(corpusCase.command).toMatch(/^(?:#|cat <<)/);
      if (/^git (checkout|restore) /.test(corpusCase.command) && corpusCase.hook === 'refuse') expect(corpusCase.command).toMatch(/^git (?:checkout -- \.|restore \.)$/);
    }
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

  it('normalizes abbreviated resets in a guard provisioned by writeGitGuard', async () => {
    const provisioned = await writeGitGuard(repository);
    await writeFile(join(repository, 'tracked'), 'edited\n');

    const result = spawnSync(join(provisioned, 'git'), ['reset', '--har'], { cwd: repository, encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('hard reset discards working-tree changes');
    expect(await readFile(join(repository, 'tracked'), 'utf8')).toBe('edited\n');
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

  it('passes a non-deleting branch --force update to real Git', async () => {
    await writeFile(join(repository, 'tracked'), 'new tip\n');
    git(['commit', '-am', 'new tip']);
    git(['branch', 'X', 'HEAD~1']);

    const result = invoke(['branch', '--force', 'X', 'HEAD']);

    expect(result.status).toBe(0);
    expect(git(['rev-parse', 'X'])).toBe(git(['rev-parse', 'HEAD']));
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

  it.each([
    ['equals form', ['--config-env=core.pager=PAGER', 'reset', '--hard']],
    ['separate form', ['--config-env', 'core.pager=PAGER', 'reset', '--hard']],
  ])('refuses reset after the --config-env %s without reaching real Git', async (_name, args) => {
    const calls = join(root, 'config-env-calls');
    const recordingGit = join(root, 'recording-git');
    const systemGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    await writeFile(recordingGit, `#!/usr/bin/env bash
printf '%s\\0' "$@" >> ${JSON.stringify(calls)}
exec ${JSON.stringify(systemGit)} "$@"
`, 'utf8');
    await chmod(recordingGit, 0o755);
    await writeFile(join(repository, '.pipeline', 'git-guard', 'real-git'), `${recordingGit}\n`);
    await writeFile(join(repository, 'tracked'), 'edited\n');

    const result = invoke(args, repository, { ...process.env, PAGER: 'cat' });

    expect(result.status).toBe(1);
    expect(await readFile(join(repository, 'tracked'), 'utf8')).toBe('edited\n');
    expect((await readFile(calls, 'utf8')).split('\0').filter(Boolean)).not.toContain('reset');
  });

  it('passes a --config-env status command through with its argv unchanged', async () => {
    const calls = join(root, 'config-env-status-calls');
    const recordingGit = join(root, 'recording-git');
    const systemGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    await writeFile(recordingGit, `#!/usr/bin/env bash
printf '%s\\0' "$@" >> ${JSON.stringify(calls)}
exec ${JSON.stringify(systemGit)} "$@"
`, 'utf8');
    await chmod(recordingGit, 0o755);
    await writeFile(join(repository, '.pipeline', 'git-guard', 'real-git'), `${recordingGit}\n`);
    const args = ['--config-env=core.pager=PAGER', 'status'];

    expect(invoke(args, repository, { ...process.env, PAGER: 'cat' }).status).toBe(0);
    const recorded = (await readFile(calls, 'utf8')).split('\0').filter(Boolean);
    expect(recorded.slice(-args.length)).toEqual(args);
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
