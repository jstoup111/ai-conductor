/**
 * RED acceptance spec for the non-blocking plan-scope containment recorder.
 *
 * Production call sites exercised here:
 * - prepareWorktree() provisions COMMIT_MSG_HOOK, then real `git commit`
 *   operations invoke the repository's real conduct-ts scope-check command.
 * - runContainmentFloor() harvests commit-time widenings and hook-authored
 *   events at the build-step boundary.
 * - buildGraderPrompt() renders the harvested rationale provenance for the
 *   configured build_review grader.
 *
 * Third-party boundaries: none. Git is local and every fixture is isolated.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { buildGraderPrompt } from '../../src/engine/build-review-prompt.js';
import {
  runContainmentFloor,
  type AcceptedScopeWidening,
} from '../../src/engine/per-task-commit-floor.js';
import { runScopeCheck } from '../../src/engine/scope-check-cli.js';
import { prepareWorktree } from '../../src/engine/worktree-prepare.js';

const execFileAsync = promisify(execFile);
const CONDUCT_TS_BIN_DIR = join(process.cwd(), '..', '..', 'bin');

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

describe('acceptance: out-of-plan production edits reach build_review with context', () => {
  let repoDir: string;
  let planPath: string;

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

  async function change(path: string, contents: string): Promise<void> {
    await writeFile(join(repoDir, path), contents, 'utf8');
    const result = await git('add', path);
    expect(result.code).toBe(0);
  }

  async function commit(subject: string, ...trailers: string[]): Promise<GitResult> {
    const args = ['commit', '-m', subject];
    for (const trailer of trailers) args.push('-m', trailer);
    return git(...args);
  }

  function graderPrompt(acceptedWidenings: AcceptedScopeWidening[]): string {
    return buildGraderPrompt({
      diff: 'diff --git a/example b/example',
      planBody: '### Task 3: config-only task',
      mergeBase: 'base-sha',
      baseRef: 'main',
      baseKind: 'local',
      trackingRefSha: null,
      remoteHeadSha: null,
      fresh: false,
      acceptedWidenings,
    });
  }

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'plan-scope-recorder-'));
    await git('init', '-q', '-b', 'main');
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');

    const engineDir = join(repoDir, 'src', 'conductor', 'src', 'engine');
    await mkdir(engineDir, { recursive: true });
    await mkdir(join(repoDir, 'src', 'conductor', 'src', 'daemon'), { recursive: true });
    await mkdir(join(repoDir, '.ai-conductor'), { recursive: true });
    await mkdir(join(repoDir, '.docs', 'plans'), { recursive: true });
    await writeFile(
      join(repoDir, '.ai-conductor', 'config.yml'),
      ['build_review:', '  scopeContainmentEnforced: true', ''].join('\n'),
      'utf8',
    );
    await writeFile(join(engineDir, 'config.ts'), 'export const config = 1;\n', 'utf8');
    await writeFile(join(engineDir, 'resolved-config.ts'), 'export const resolved = 1;\n', 'utf8');
    await writeFile(join(repoDir, 'src', 'conductor', 'src', 'daemon', 'backlog.ts'), 'export const backlog = 1;\n', 'utf8');
    planPath = join(repoDir, '.docs', 'plans', 'feature.md');
    await writeFile(
      planPath,
      '### Task 3: config-only task\n**Files:** src/conductor/src/engine/config.ts\n',
      'utf8',
    );
    await git('add', '.');
    await git('commit', '-qm', 'chore: initial fixture');

    await prepareWorktree(repoDir);
    await mkdir(join(repoDir, '.pipeline'), { recursive: true });
    await writeFile(
      join(repoDir, '.pipeline', 'task-status.json'),
      JSON.stringify({
        tasks: [{
          id: '3',
          name: 'config-only task',
          status: 'in_progress',
          files: ['src/conductor/src/engine/config.ts'],
        }],
      }),
      'utf8',
    );
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it('keeps an adjacent edit silent and lets an unrelated edit land with an advisory', async () => {
    const neighborPath = 'src/conductor/src/engine/resolved-config.ts';
    await change(neighborPath, 'export const resolved = 2;\n');

    const neighborCommit = await commit('feat: update resolved config', 'Task: 3');

    expect(neighborCommit.code).toBe(0);
    expect(neighborCommit.stderr).toBe('');

    const unrelatedPath = 'src/conductor/src/daemon/backlog.ts';
    await change(unrelatedPath, 'export const backlog = 2;\n');

    const unrelatedCommit = await commit('fix: keep daemon behavior aligned', 'Task: 3');

    expect(unrelatedCommit.code).toBe(0);
    expect(unrelatedCommit.stderr).toContain('Task 3');
    expect(unrelatedCommit.stderr).toContain(unrelatedPath);
    expect(unrelatedCommit.stderr).toContain(`Scope: ${unrelatedPath} — fix: keep daemon behavior aligned`);
    expect(unrelatedCommit.stderr).not.toMatch(/refus(?:e|ing|al)/i);
    expect((await git('show', '--format=%s', '--no-patch', 'HEAD')).stdout)
      .toBe('fix: keep daemon behavior aligned');
  });

  it('leaves a consumer on the false default with no advisory or widening record', async () => {
    await writeFile(
      join(repoDir, '.ai-conductor', 'config.yml'),
      '# no build_review containment opt-in\n',
      'utf8',
    );
    const unrelatedPath = 'src/conductor/src/daemon/backlog.ts';
    await change(unrelatedPath, 'export const backlog = 3;\n');

    const result = await commit('fix: consumer-local daemon update', 'Task: 3');

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    await expect(readFile(join(repoDir, '.pipeline', 'hook-events.jsonl'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });

    const report = await runContainmentFloor({
      projectRoot: repoDir,
      planPath,
      scopeContainmentEnforced: false,
    });
    expect(report.acceptedWidenings).toEqual([]);
    expect(report.skipNotes).toEqual([]);
    expect(graderPrompt([])).not.toContain(unrelatedPath);
  });

  it('carries authored and derived rationales from a real commit into build_review', async () => {
    const authoredPath = 'src/conductor/src/daemon/backlog.ts';
    const derivedPath = 'src/conductor/src/runtime/worker.ts';
    await mkdir(join(repoDir, 'src', 'conductor', 'src', 'runtime'), { recursive: true });
    await writeFile(join(repoDir, derivedPath), 'export const worker = 1;\n', 'utf8');
    await change(authoredPath, 'export const backlog = 4;\n');
    const addDerived = await git('add', derivedPath);
    expect(addDerived.code).toBe(0);

    const result = await commit(
      'fix: keep runtime collaborators synchronized',
      'Task: 3',
      `Scope: ${authoredPath} — required to preserve daemon scheduling`,
    );

    expect(result.code).toBe(0);
    const sha = (await git('rev-parse', 'HEAD')).stdout;
    const report = await runContainmentFloor({ projectRoot: repoDir, planPath });
    expect(report.satisfied).toBe(true);
    expect(report.acceptedWidenings).toEqual(expect.arrayContaining([
      {
        path: authoredPath,
        rationale: 'required to preserve daemon scheduling',
        taskId: '3',
        sha,
        derived: false,
      },
      expect.objectContaining({
        path: derivedPath,
        rationale: expect.stringContaining('fix: keep runtime collaborators synchronized'),
        taskId: '3',
        sha,
        derived: true,
      }),
    ]));

    const prompt = graderPrompt(report.acceptedWidenings);
    expect(prompt).toMatch(new RegExp(`${authoredPath.replaceAll('/', '\\/')}[\\s\\S]*Provenance: Authored trailer`));
    expect(prompt).toMatch(new RegExp(`${derivedPath.replaceAll('/', '\\/')}[\\s\\S]*Provenance: Derived commit rationale`));
  });

  it('surfaces an unresolvable check from the hook ledger in the build record', async () => {
    const engineLedgerPath = join(repoDir, '.pipeline', 'events.jsonl');
    const engineLedger = '{"type":"step_started","step":"build","index":11,"ts":"2026-08-12T12:00:00.000Z"}\n';
    await writeFile(engineLedgerPath, engineLedger, 'utf8');
    await writeFile(join(repoDir, '.pipeline', 'task-status.json'), '{ malformed json', 'utf8');
    const messagePath = join(repoDir, '.git', 'SCOPE_CHECK_MESSAGE');
    await writeFile(messagePath, 'fix: malformed task state\n\nTask: 3\n', 'utf8');

    const exitCode = await runScopeCheck({
      projectRoot: repoDir,
      commitMessagePath: messagePath,
      enforce: true,
      stagedPaths: async () => ['src/conductor/src/daemon/backlog.ts'],
    });

    expect(exitCode).toBe(3);
    expect(await readFile(engineLedgerPath, 'utf8')).toBe(engineLedger);
    const hookEvents = (await readFile(
      join(repoDir, '.pipeline', 'hook-events.jsonl'),
      'utf8',
    )).trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(hookEvents).toEqual([
      expect.objectContaining({
        type: 'containment_check_unresolved',
        taskId: '3',
        ts: expect.anything(),
      }),
    ]);

    const report = await runContainmentFloor({ projectRoot: repoDir, planPath });
    expect(report).toMatchObject({
      satisfied: true,
      unresolvedChecks: [expect.objectContaining({
        type: 'containment_check_unresolved',
        taskId: '3',
      })],
    });
  });
});
