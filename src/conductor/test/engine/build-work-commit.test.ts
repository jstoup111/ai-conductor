import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ENGINE_BUILD_COMMIT_FAILURE_PREFIX,
  commitUncommittedBuildWork,
  resolveActiveBuildTaskIds,
} from '../../src/engine/build-work-commit.js';
import type { GitRunner } from '../../src/engine/pr-labels.js';

// adr-2026-08-03 D10: the engine commits a settled BUILD attempt's dirty work
// through the injected git runner (the process boundary), never spawning git
// itself. Every test here records the argv that reaches that boundary.

describe('commitUncommittedBuildWork', () => {
  let dir: string;
  let calls: string[][];
  let git: GitRunner;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-work-commit-'));
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    calls = [];
    git = async (args) => {
      calls.push(args);
      return { stdout: args[0] === 'rev-parse' ? 'abc123\n' : '' };
    };
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeStatus(tasks: Array<{ id: string | number; status: string }>): Promise<void> {
    await writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({ tasks }));
  }

  it('stages exactly the dirty paths and commits with a Task: trailer per builder-declared active task', async () => {
    await writeStatus([
      { id: 1, status: 'completed' },
      { id: 2, status: 'in_progress' },
      { id: 3, status: 'pending' },
    ]);
    await writeFile(join(dir, '.pipeline', 'current-task'), 'remediation-2\n');

    const result = await commitUncommittedBuildWork({
      projectRoot: dir,
      git,
      paths: ['src/a.ts', 'test/a.test.ts'],
      attempt: 1,
    });

    expect(result).toEqual({ kind: 'committed', sha: 'abc123', taskIds: ['remediation-2', '2'] });
    expect(calls[0]).toEqual(['add', '--', 'src/a.ts', 'test/a.test.ts']);
    expect(calls[1]?.slice(0, 2)).toEqual(['commit', '-m']);
    const message = calls[1]?.[2] ?? '';
    expect(message).toMatch(/^build: commit work left uncommitted by BUILD attempt 1\n/);
    expect(message).toContain('\nTask: remediation-2\nTask: 2');
    expect(message).not.toContain('Task: 1');
    expect(message).not.toContain('Task: 3');
    expect(calls.flat()).not.toContain('--no-verify');
    expect(calls.flat()).not.toContain('-f');
    expect(calls.flat()).not.toContain('--force');
  });

  it('commits unattributed when the builder declared no active task, rather than guessing from paths', async () => {
    await writeStatus([
      { id: 1, status: 'pending' },
      { id: 2, status: 'pending' },
    ]);

    const result = await commitUncommittedBuildWork({ projectRoot: dir, git, paths: ['src/a.ts'], attempt: 2 });

    expect(result).toEqual({ kind: 'committed', sha: 'abc123', taskIds: [] });
    expect(calls[1]?.[2]).not.toMatch(/^Task:/m);
  });

  it('never stages run state under .pipeline/ and refuses when nothing else is dirty', async () => {
    const result = await commitUncommittedBuildWork({
      projectRoot: dir,
      git,
      paths: ['.pipeline/task-status.json', '.pipeline/HALT'],
      attempt: 1,
    });

    expect(result).toMatchObject({
      kind: 'failed',
      reason: expect.stringContaining(ENGINE_BUILD_COMMIT_FAILURE_PREFIX),
    });
    expect(calls).toEqual([]);
  });

  it('refuses the whole commit when a protected DECIDE artifact is among the dirty paths', async () => {
    const result = await commitUncommittedBuildWork({
      projectRoot: dir,
      git,
      paths: ['src/a.ts', '.docs/plans/feature.md'],
      attempt: 1,
    });

    expect(result).toMatchObject({
      kind: 'failed',
      reason: expect.stringContaining(
        'protected artifact path(s) cannot be committed by BUILD: .docs/plans/feature.md',
      ),
    });
    expect(calls).toEqual([]);
  });

  it('reports a hook or git rejection as a failure carrying stderr, leaving attribution visible', async () => {
    await writeStatus([{ id: 4, status: 'in_progress' }]);
    const rejecting: GitRunner = async (args) => {
      calls.push(args);
      if (args[0] === 'commit') {
        throw Object.assign(new Error('Command failed: git commit'), {
          stderr: 'pre-commit: rejected protected artifact(s) during BUILD: x',
        });
      }
      return { stdout: '' };
    };

    const result = await commitUncommittedBuildWork({
      projectRoot: dir,
      git: rejecting,
      paths: ['src/a.ts'],
      attempt: 3,
    });

    expect(result).toEqual({
      kind: 'failed',
      reason: `${ENGINE_BUILD_COMMIT_FAILURE_PREFIX} pre-commit: rejected protected artifact(s) during BUILD: x`,
      taskIds: ['4'],
    });
    expect(calls.map((args) => args[0])).toEqual(['add', 'commit']);
  });
});

describe('resolveActiveBuildTaskIds', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'active-task-ids-'));
    await mkdir(join(dir, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns nothing when neither stamp nor status exists', async () => {
    await expect(resolveActiveBuildTaskIds(dir)).resolves.toEqual([]);
  });

  it('ignores a malformed current-task stamp and de-duplicates the stamped id against in_progress rows', async () => {
    await writeFile(join(dir, '.pipeline', 'current-task'), '7\n');
    await writeFile(
      join(dir, '.pipeline', 'task-status.json'),
      JSON.stringify({
        tasks: [
          { id: 7, status: 'in_progress' },
          { id: 8, status: 'in_progress' },
        ],
      }),
    );
    await expect(resolveActiveBuildTaskIds(dir)).resolves.toEqual(['7', '8']);

    await writeFile(join(dir, '.pipeline', 'current-task'), 'not a task id\n');
    await expect(resolveActiveBuildTaskIds(dir)).resolves.toEqual(['7', '8']);
  });
});
