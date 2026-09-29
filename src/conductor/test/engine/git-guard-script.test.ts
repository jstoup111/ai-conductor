// Covers: task:5
import { spawnSync } from 'node:child_process';
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

  beforeEach(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), 'git-guard-script-'));
    const binDir = join(fixtureDir, '.pipeline', 'bin');
    const guardDataDir = join(fixtureDir, '.pipeline', 'git-guard');
    callsPath = join(fixtureDir, 'calls');
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
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
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
});
