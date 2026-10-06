// Covers: task:1
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import {
  GIT_OPTION_SPEC,
  type GuardedSubcommand,
} from '../../src/engine/git-option-spec.js';
import { resolveRealGit } from '../../src/engine/git-guard.js';

function driftFindings(
  spec: typeof GIT_OPTION_SPEC,
  command: GuardedSubcommand,
  helperOutput: string,
): string[] {
  const known = new Set(spec.subcommands[command].flatMap((option) => option.name === undefined ? [] : [option.name]));
  return [...helperOutput.matchAll(/--(?:no-)?([a-z0-9][a-z0-9-]*)(?:=[^\s]*)?/g)]
    .map((match) => match[1]!)
    .filter((name) => !known.has(name))
    .map((name) => `${command} --${name}`);
}

function optionFor(command: GuardedSubcommand, token: string) {
  const normalized = token.replace(/^--no-/, '--').replace(/=.*/, '');
  if (normalized.startsWith('--')) {
    return GIT_OPTION_SPEC.subcommands[command].find((option) => option.name === normalized.slice(2));
  }
  return GIT_OPTION_SPEC.subcommands[command].find((option) => option.short === normalized.slice(1));
}

describe('git option spec', () => {
  it('describes the guarded subcommands and their exceptional options', () => {
    expect(Object.keys(GIT_OPTION_SPEC.subcommands)).toEqual([
      'reset', 'branch', 'clean', 'push', 'checkout', 'restore',
    ]);
    expect(optionFor('clean', '--force')?.short).toBe('f');
    expect(optionFor('branch', '--force')?.short).toBe('f');
    expect(optionFor('push', '--force-with-lease')?.arity).toBe('optional');
    expect(optionFor('reset', '--hard')?.negatable).toBe(false);
    expect(optionFor('reset', '--auto-advance')?.negatable).toBe(true);
    expect(optionFor('checkout', '--auto-advance')?.negatable).toBe(true);
  });

  it('resolves every guarded option in the engine CLI argv table', async () => {
    const source = await readFile(new URL('./git-guard-engine-unaffected.test.ts', import.meta.url), 'utf8');
    const rows = [...source.matchAll(/\['[^']+', \[([^\]]+)\]\]/g)];
    const unresolved = rows.flatMap((row) => {
      const argv = [...row[1]!.matchAll(/'([^']+)'/g)].map((token) => token[1]!);
      const command = argv[0];
      if (!isGuardedSubcommand(command)) return [];
      return argv.slice(1).filter((token) => token.startsWith('-') && optionFor(command, token) === undefined)
        .map((token) => `${command} ${token}`);
    });

    expect(unresolved).toEqual([]);
  });

  it('reports missing completion-helper options but permits helper omissions', () => {
    expect(driftFindings(GIT_OPTION_SPEC, 'reset', '--hard --brand-new --no-quiet')).toEqual(['reset --brand-new']);
    expect(driftFindings(GIT_OPTION_SPEC, 'clean', '--quiet --dry-run --interactive --exclude=')).toEqual([]);
  });

  it.each(Object.keys(GIT_OPTION_SPEC.subcommands) as GuardedSubcommand[])(
    'covers git %s completion-helper options',
    async (command) => {
      const result = spawnSync(await resolveRealGit(), [command, '--git-completion-helper'], { encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      const output = result.stdout;
      const findings = driftFindings(GIT_OPTION_SPEC, command, output);
      expect(findings, findings.join('\n')).toEqual([]);
    },
  );
});

function isGuardedSubcommand(value: string | undefined): value is GuardedSubcommand {
  return value !== undefined && value in GIT_OPTION_SPEC.subcommands;
}
