/**
 * RED acceptance spec for #1227 / #1074 plan-scope containment.
 *
 * Production call site: prepareWorktree() provisions COMMIT_MSG_HOOK, then a
 * real `git commit` supplies the staged paths and Task:/Scope: trailers. The
 * shipped mode is report-only, so a verified violation must print the complete
 * refusal diagnostic while allowing the commit. Unit tests own the later
 * enforcement flip and the evaluator's abstention matrix.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { prepareWorktree } from '../../src/engine/worktree-prepare.js';

const execFileAsync = promisify(execFile);
interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

describe('acceptance: #1074 out-of-plan commits reach the plan-scope boundary', () => {
  let repoDir: string;
  let binDir: string;

  async function git(...args: string[]): Promise<GitResult> {
    try {
      const result = await execFileAsync('git', ['-C', repoDir, ...args], {
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      });
      return {
        code: 0,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
      };
    } catch (error) {
      const result = error as { code?: number; stdout?: string; stderr?: string };
      return {
        code: result.code ?? 1,
        stdout: (result.stdout ?? '').trim(),
        stderr: (result.stderr ?? '').trim(),
      };
    }
  }

  async function stage(paths: string[]): Promise<void> {
    await git('add', ...paths);
  }

  async function change(path: string, contents: string): Promise<void> {
    await writeFile(join(repoDir, path), contents, 'utf8');
  }

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'plan-scope-containment-'));
    binDir = join(repoDir, '.scope-check-bin');
    await mkdir(binDir, { recursive: true });
    await writeFile(
      join(binDir, 'conduct-ts'),
      `#!/bin/sh
if [ "$1" = scope-check ] && ! grep -q '^Scope:' "$2" && ! git diff --cached --name-only | grep -qx 'src/conductor/src/engine/config.ts'; then
  echo 'scope-check: refusing Task 3; staged paths are outside its declared scope:' >&2
  echo '  src/conductor/src/engine/artifacts.ts' >&2
  echo '  src/conductor/src/engine/changelog-pr-finalizer-cli.ts' >&2
  echo 'Narrow this commit to the task declaration, or justify each widening by adding:' >&2
  echo '  Scope: src/conductor/src/engine/artifacts.ts — <rationale>' >&2
  echo '  Scope: src/conductor/src/engine/changelog-pr-finalizer-cli.ts — <rationale>' >&2
fi
`,
      'utf8',
    );
    await chmod(join(binDir, 'conduct-ts'), 0o755);
    await git('init', '-q', '-b', 'main');
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');

    const engineDir = join(repoDir, 'src', 'conductor', 'src', 'engine');
    await mkdir(engineDir, { recursive: true });
    await writeFile(join(engineDir, 'config.ts'), 'export const config = 1;\n', 'utf8');
    await writeFile(join(engineDir, 'artifacts.ts'), 'export const artifacts = 1;\n', 'utf8');
    await writeFile(
      join(engineDir, 'changelog-pr-finalizer-cli.ts'),
      'export const finalizer = 1;\n',
      'utf8',
    );
    await git('add', '.');
    await git('commit', '-qm', 'chore: initial fixture');

    await prepareWorktree(repoDir);
    await mkdir(join(repoDir, '.pipeline'), { recursive: true });
    await writeFile(join(repoDir, '.pipeline', 'current-task'), '3\n', 'utf8');
    await writeFile(
      join(repoDir, '.pipeline', 'task-status.json'),
      JSON.stringify(
        {
          tasks: [
            {
              id: '3',
              name: 'config-only task',
              status: 'in_progress',
              files: [
                'src/conductor/src/engine/config.ts',
                'src/conductor/test/engine/config.test.ts',
              ],
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it('reports both #1074 paths at the real commit boundary without deleting either file', async () => {
    const artifactsPath = 'src/conductor/src/engine/artifacts.ts';
    const finalizerPath = 'src/conductor/src/engine/changelog-pr-finalizer-cli.ts';
    const artifactsContents = 'export const artifacts = 2;\n';
    const finalizerContents = 'export const finalizer = 2;\n';

    await change(artifactsPath, artifactsContents);
    await change(finalizerPath, finalizerContents);
    await stage([artifactsPath, finalizerPath]);

    const result = await git(
      'commit',
      '-m',
      'fix: reproduce out-of-plan finish work',
      '-m',
      'Task: 3',
    );

    // Report-only is the shipped default: the violation is observable but the
    // commit proceeds until live data earns the one-line enforcement flip.
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('Task 3');
    expect(result.stderr).toContain(artifactsPath);
    expect(result.stderr).toContain(finalizerPath);
    expect(result.stderr).toContain(`Scope: ${artifactsPath} — <rationale>`);
    expect(result.stderr).toContain(`Scope: ${finalizerPath} — <rationale>`);
    expect(result.stderr.toLowerCase()).not.toContain('delete');
    expect(await readFile(join(repoDir, artifactsPath), 'utf8')).toBe(artifactsContents);
    expect(await readFile(join(repoDir, finalizerPath), 'utf8')).toBe(finalizerContents);
  });

  it('accepts an explicitly justified widening without reporting a violation', async () => {
    const artifactsPath = 'src/conductor/src/engine/artifacts.ts';
    await change(artifactsPath, 'export const artifacts = 3;\n');
    await stage([artifactsPath]);

    const result = await git(
      'commit',
      '-m',
      'fix: register the new command',
      '-m',
      'Task: 3',
      '-m',
      `Scope: ${artifactsPath} — needed to register the new command`,
    );

    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain(artifactsPath);
  });

  it('accepts a commit confined to the active task declaration without reporting', async () => {
    const configPath = 'src/conductor/src/engine/config.ts';
    await change(configPath, 'export const config = 2;\n');
    await stage([configPath]);

    const result = await git('commit', '-m', 'feat: update config behavior', '-m', 'Task: 3');

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
  });
});
