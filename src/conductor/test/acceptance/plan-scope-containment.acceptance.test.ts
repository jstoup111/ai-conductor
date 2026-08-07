/**
 * RED acceptance spec for #1227 / #1074 plan-scope containment.
 *
 * Production call site: prepareWorktree() provisions COMMIT_MSG_HOOK, then a
 * real `git commit` invokes the repository's real conduct-ts binary. These
 * scenarios therefore fail if either the hook wiring, resolved configuration,
 * evaluateScopeContainment(), or parseScopeTrailers() stops enforcing the
 * observable commit boundary.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { prepareWorktree } from '../../src/engine/worktree-prepare.js';

const execFileAsync = promisify(execFile);
const CONDUCT_TS_BIN_DIR = join(process.cwd(), '..', '..', 'bin');

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

describe('acceptance: #1074 out-of-plan commits reach the plan-scope boundary', () => {
  let repoDir: string;

  async function git(...args: string[]): Promise<GitResult> {
    try {
      const result = await execFileAsync('git', ['-C', repoDir, ...args], {
        env: { ...process.env, PATH: `${CONDUCT_TS_BIN_DIR}:${process.env.PATH}` },
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
    const result = await git('add', ...paths);
    expect(result.code).toBe(0);
  }

  async function change(path: string, contents: string): Promise<void> {
    await writeFile(join(repoDir, path), contents, 'utf8');
  }

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'plan-scope-containment-'));
    await git('init', '-q', '-b', 'main');
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');

    const engineDir = join(repoDir, 'src', 'conductor', 'src', 'engine');
    await mkdir(engineDir, { recursive: true });
    await mkdir(join(repoDir, '.ai-conductor'), { recursive: true });
    await writeFile(
      join(repoDir, '.ai-conductor', 'config.yml'),
      ['build_review:', '  scopeContainmentEnforced: true', ''].join('\n'),
      'utf8',
    );
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

  it('refuses both #1074 paths for Task 3 while preserving the files and index', async () => {
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

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Task 3');
    expect(result.stderr).toContain(artifactsPath);
    expect(result.stderr).toContain(finalizerPath);
    expect(result.stderr).toContain(`Scope: ${artifactsPath} — <rationale>`);
    expect(result.stderr).toContain(`Scope: ${finalizerPath} — <rationale>`);
    expect(result.stderr.toLowerCase()).not.toContain('delete');
    expect(await readFile(join(repoDir, artifactsPath), 'utf8')).toBe(artifactsContents);
    expect(await readFile(join(repoDir, finalizerPath), 'utf8')).toBe(finalizerContents);
    expect((await git('diff', '--cached', '--name-only')).stdout.split('\n')).toEqual([
      artifactsPath,
      finalizerPath,
    ]);
  });

  it('allows both paths when each has a valid same-commit Scope trailer', async () => {
    const artifactsPath = 'src/conductor/src/engine/artifacts.ts';
    const finalizerPath = 'src/conductor/src/engine/changelog-pr-finalizer-cli.ts';
    await change(artifactsPath, 'export const artifacts = 3;\n');
    await change(finalizerPath, 'export const finalizer = 3;\n');
    await stage([artifactsPath, finalizerPath]);

    const result = await git(
      'commit',
      '-m',
      'fix: register both widened paths',
      '-m',
      'Task: 3',
      '-m',
      `Scope: ${artifactsPath} — needed to update artifact discovery`,
      '-m',
      `Scope: ${finalizerPath} — needed to finalize the registered artifact`,
    );

    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain('scope-check: refusing');
  });

  it.each([
    ['an empty rationale', 'Scope: src/conductor/src/engine/artifacts.ts —'],
    ['a bare trailer', 'Scope:'],
    ['a trailer for an unstaged path', 'Scope: src/conductor/src/engine/config.ts — adjacent config work'],
  ])('does not allow the out-of-plan path with %s', async (_case, scopeTrailer) => {
    const artifactsPath = 'src/conductor/src/engine/artifacts.ts';
    await change(artifactsPath, 'export const artifacts = 4;\n');
    await stage([artifactsPath]);

    const result = await git(
      'commit',
      '-m',
      'fix: malformed widening attempt',
      '-m',
      'Task: 3',
      '-m',
      scopeTrailer,
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Task 3');
    expect(result.stderr).toContain(artifactsPath);
    expect((await git('diff', '--cached', '--name-only')).stdout).toBe(artifactsPath);
  });

  it('allows a commit confined to the active task declaration', async () => {
    const configPath = 'src/conductor/src/engine/config.ts';
    await change(configPath, 'export const config = 2;\n');
    await stage([configPath]);

    const result = await git('commit', '-m', 'feat: update config behavior', '-m', 'Task: 3');

    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain('scope-check: refusing');
  });
});
