import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execa: vi.fn() }));

vi.mock('execa', () => ({ execa: mocks.execa }));

import { withPinnedGitConfig } from '../../src/engine/git-pinned-config.js';
import { makeGitRunner, performRebase, startFeatureReplay } from '../../src/engine/rebase.js';

const sourceDirectory = join(dirname(fileURLToPath(import.meta.url)), '../../src');

const PINS: readonly (readonly [string, string])[] = [
  ['rebase.updateRefs', 'false'],
  ['rebase.rebaseMerges', 'false'],
  ['rebase.autoSquash', 'false'],
  ['merge.renames', 'true'],
  ['merge.directoryRenames', 'conflict'],
  ['diff.renameLimit', '1000'],
];

function pinsAt(offset: number): Record<string, string> {
  return Object.fromEntries(PINS.flatMap(([key, value], index) => [
    [`GIT_CONFIG_KEY_${offset + index}`, key],
    [`GIT_CONFIG_VALUE_${offset + index}`, value],
  ]));
}

interface RecordedCall {
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv | undefined;
}

const OLD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const NEW = 'c'.repeat(40);

/** A scripted git process boundary for one rebase that moves HEAD. */
function scriptGit(calls: RecordedCall[]) {
  let rebased = false;
  mocks.execa.mockImplementation(async (_command: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
    calls.push({ args: [...args], env: options.env });
    const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '' });
    const [subcommand] = args;
    if (subcommand === 'rev-parse' && args[1] === '--is-inside-work-tree') return ok('true\n');
    if (subcommand === 'rev-parse' && args.includes('--git-path')) return ok('/nonexistent-git-path\n');
    if (subcommand === 'rev-parse' && args.at(-1) === 'HEAD') return ok(`${rebased ? NEW : OLD}\n`);
    if (subcommand === 'rev-parse') return ok(`${BASE}\n`);
    if (subcommand === 'diff') return ok('');
    if (subcommand === 'remote') return ok('');
    if (subcommand === 'rev-list' && args[1] === '--count') return ok(rebased ? '0\n' : '1\n');
    if (subcommand === 'rev-list' && args[1] === '--merges') return ok('');
    if (subcommand === 'rev-list') return ok('');
    if (subcommand === 'merge-base') return ok(`${BASE}\n`);
    if (subcommand === 'merge-tree') return ok(`${'d'.repeat(40)}\n`);
    if (subcommand === 'rebase') {
      rebased = true;
      return ok('');
    }
    return ok('');
  });
}

describe('engine git pin travels only in the environment (sweep G1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Covers: S1.12, task:3
  it('appends the six literal engine pins after two credential-helper entries without renumbering them', () => {
    const credentials: NodeJS.ProcessEnv = {
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_0: '',
      GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_1: '!gh auth git-credential',
    };

    expect(withPinnedGitConfig(credentials)).toEqual({ ...credentials, GIT_CONFIG_COUNT: '8', ...pinsAt(2) });
    expect(withPinnedGitConfig({})).toEqual({ GIT_CONFIG_COUNT: '6', ...pinsAt(0) });
  });

  // Covers: S1.12, task:3
  it('records performRebase and startFeatureReplay argv with no config arguments while their rebase carries the pin environment', async () => {
    const calls: RecordedCall[] = [];
    scriptGit(calls);
    const git = makeGitRunner('/fixture-worktree');

    await expect(performRebase(git, '/fixture-worktree', 'main')).resolves.toMatchObject({ replay: { preRebaseHead: OLD, completedHead: NEW } });
    const performRebaseCalls = [...calls];
    const performRebaseArgv = performRebaseCalls.map(({ args }) => args);
    calls.length = 0;
    scriptGit(calls);
    await expect(startFeatureReplay(git, 'main', BASE)).resolves.toMatchObject({ kind: 'started', rebaseArgs: ['rebase', '--autostash', 'main'] });
    const replayArgv = calls.map(({ args }) => args);

    expect(performRebaseArgv).toEqual([
      ['rev-parse', '--is-inside-work-tree'],
      ['diff', '--name-only', '--diff-filter=U'],
      ['rev-parse', '--git-path', 'rebase-merge'],
      ['rev-parse', '--git-path', 'rebase-apply'],
      ['remote'],
      ['rev-list', '--count', 'HEAD..main'],
      ['rev-parse', 'main'],
      ['symbolic-ref', 'refs/remotes/origin/HEAD'],
      ['rev-parse', 'HEAD'],
      ['merge-base', 'HEAD', 'main'],
      ['rev-parse', 'main'],
      ['rev-list', '--merges', 'main..HEAD'],
      ['rebase', '--autostash', 'main'],
      ['diff', '--name-only', OLD, 'HEAD'],
      ['rev-parse', 'HEAD'],
    ]);
    const rebaseCalls = [...performRebaseCalls, ...calls].filter(({ args }) => args[0] === 'rebase');
    expect(rebaseCalls).toHaveLength(2);
    for (const call of rebaseCalls) expect(call.env).toMatchObject({ GIT_CONFIG_COUNT: String(PINS.length), ...pinsAt(0) });
    expect(replayArgv).toEqual([
      ['rev-list', '--merges', 'main..HEAD'],
      ['rebase', '--autostash', 'main'],
    ]);
    for (const args of [...performRebaseArgv, ...replayArgv]) {
      expect(args).not.toContain('-c');
      expect(args).not.toContain('--config-env');
      for (const [key] of PINS) expect(args.some((arg) => arg.includes(key))).toBe(false);
    }
  });

  // Covers: S1.12, task:3
  it('pins every rebase, merge and merge-tree process the engine replay runners start', async () => {
    const calls: RecordedCall[] = [];
    scriptGit(calls);
    const git = makeGitRunner('/fixture-worktree');
    await performRebase(git, '/fixture-worktree', 'main', { finishMergeabilityCheck: true });
    await startFeatureReplay(git, 'main', BASE);
    await git(['merge', '--ff-only', 'origin/main']);
    await git(['merge-tree', '--write-tree', '--merge-base', BASE, OLD, NEW]);

    const replayCalls = calls.filter(({ args }) => ['rebase', 'merge', 'merge-tree'].includes(args[0]!));
    expect(new Set(replayCalls.map(({ args }) => args[0]))).toEqual(new Set(['rebase', 'merge', 'merge-tree']));
    for (const call of replayCalls) {
      expect(call.env).toMatchObject({ GIT_CONFIG_COUNT: String(PINS.length), ...pinsAt(0) });
    }

    // autoresolve's open-PR replay and ci-fix's worktree fix both obtain their
    // git process runner from makeGitRunner and never start rebase, merge or
    // merge-tree through another process boundary.
    for (const [file, owner] of [['engine/autoresolve.ts', 'resolveConflictingPr'], ['engine/ci-fix.ts', undefined]] as const) {
      const source = await readFile(join(sourceDirectory, file), 'utf8');
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const runners: string[] = [];
      const rawReplayCalls: string[] = [];
      const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'git' && node.initializer !== undefined) {
          runners.push(node.initializer.getText(sourceFile).replace(/\(.*\)$/s, ''));
        }
        if (ts.isCallExpression(node) && node.expression.getText(sourceFile) === 'execa') {
          const argv = node.arguments[1];
          const first = argv !== undefined && ts.isArrayLiteralExpression(argv) ? argv.elements[0] : undefined;
          if (first !== undefined && ts.isStringLiteral(first) && ['rebase', 'merge', 'merge-tree'].includes(first.text)) {
            rawReplayCalls.push(node.getText(sourceFile));
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
      expect(rawReplayCalls).toEqual([]);
      expect(runners.length).toBeGreaterThan(0);
      expect(new Set(runners)).toEqual(new Set(['makeGitRunner']));
      if (owner !== undefined) expect(source).toMatch(/startFeatureReplay\(git, baseRef, mergeBase, worktreePath\)/);
    }
  });
});
