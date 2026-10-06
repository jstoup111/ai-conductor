// Covers: task:11
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  GIT_OPTION_SPEC,
  type GitGlobalOption,
  type GitOptionSpec,
  type GitSubcommandOption,
} from '../../src/engine/git-option-spec.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(__dirname, '..', '..', '..', '..', 'hooks', 'claude', 'block-destructive-git.sh');

function extractEmbeddedSpec(hook: string): GitOptionSpec {
  const start = hook.indexOf('# BEGIN GIT_OPTION_SPEC');
  const end = hook.indexOf('# END GIT_OPTION_SPEC');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('hook is missing GIT_OPTION_SPEC markers');
  }

  const section = hook.slice(start, end);
  const json = section.match(/SPEC = json\.loads\(r'''(.*)'''\)/s)?.[1];
  if (json === undefined) {
    throw new Error('hook GIT_OPTION_SPEC markers do not contain JSON');
  }
  return JSON.parse(json) as GitOptionSpec;
}

function optionKey(option: GitGlobalOption | GitSubcommandOption): string {
  return option.name === undefined ? `-${option.short}` : `--${option.name}`;
}

function optionDifferences(
  command: string,
  actual: readonly (GitGlobalOption | GitSubcommandOption)[],
  expected: readonly (GitGlobalOption | GitSubcommandOption)[],
): string[] {
  const actualByKey = new Map(actual.map((option) => [optionKey(option), option]));
  const expectedByKey = new Map(expected.map((option) => [optionKey(option), option]));
  return [...new Set([...actualByKey.keys(), ...expectedByKey.keys()])]
    .filter((key) => JSON.stringify(actualByKey.get(key)) !== JSON.stringify(expectedByKey.get(key)))
    .map((key) => `${command} ${key}`);
}

function specDifferences(actual: GitOptionSpec, expected: GitOptionSpec): string[] {
  const differences = optionDifferences('global', actual.global, expected.global);
  const actualCommands = actual.subcommands as Readonly<Record<string, readonly GitSubcommandOption[]>>;
  const expectedCommands = expected.subcommands as Readonly<Record<string, readonly GitSubcommandOption[]>>;
  for (const command of new Set([...Object.keys(actualCommands), ...Object.keys(expectedCommands)])) {
    differences.push(...optionDifferences(
      command,
      actualCommands[command] ?? [],
      expectedCommands[command] ?? [],
    ));
  }
  return differences;
}

describe('block-destructive-git embedded option spec', () => {
  const hook = readFileSync(HOOK_PATH, 'utf8');

  it('matches the TypeScript option spec', () => {
    const differences = specDifferences(extractEmbeddedSpec(hook), GIT_OPTION_SPEC);
    expect(differences, differences.join('\n')).toEqual([]);
  });

  it('reports a missing reset soft option', () => {
    const embedded: GitOptionSpec = {
      ...GIT_OPTION_SPEC,
      subcommands: {
        ...GIT_OPTION_SPEC.subcommands,
        reset: GIT_OPTION_SPEC.subcommands.reset.filter((option) => option.name !== 'soft'),
      },
    };

    const differences = specDifferences(embedded, GIT_OPTION_SPEC);
    expect(differences).toEqual(['reset --soft']);
    expect(() => expect(differences, differences.join('\n')).toEqual([])).toThrow(/reset --soft/);
  });

  it('rejects hook text without option-spec markers', () => {
    expect(() => extractEmbeddedSpec('python hook without embedded data')).toThrow(/missing GIT_OPTION_SPEC markers/);
  });
});
