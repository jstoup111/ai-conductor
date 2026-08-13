import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as scopeCheckCli from '../../src/engine/scope-check-cli.js';
import { COMMIT_MSG_HOOK } from '../../src/engine/git-hook-assets.js';

const { appendUnresolvedContainmentCheck, detectScopeCheckCommand, runScopeCheck } = scopeCheckCli;
const loadScopeCheckEnforcement = (
  scopeCheckCli as typeof scopeCheckCli & {
    loadScopeCheckEnforcement(
      projectRoot: string,
    ): Promise<boolean>;
  }
).loadScopeCheckEnforcement;

const MESSAGE = 'feat(engine): scope check\n\nTask: 3\n';
const TASK_STATUS = JSON.stringify({
  tasks: [
    {
      id: '3',
      status: 'in_progress',
      files: ['src/conductor/src/engine/config.ts'],
    },
  ],
});

describe('scope-check CLI', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'scope-check-config-'));
    await mkdir(join(projectRoot, '.ai-conductor'), { recursive: true });
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('loads report-only as the default from resolved project configuration', async () => {
    await writeFile(join(projectRoot, '.ai-conductor', 'config.yml'), '{}\n');

    await expect(loadScopeCheckEnforcement(projectRoot)).resolves.toBe(false);
  });

  it('loads explicit enforcement from resolved project configuration', async () => {
    await writeFile(
      join(projectRoot, '.ai-conductor', 'config.yml'),
      'build_review:\n  scopeContainmentEnforced: true\n',
    );

    await expect(loadScopeCheckEnforcement(projectRoot)).resolves.toBe(true);
  });

  it('contains no withdrawn enforcement-flip guidance in the scope-check source or generated hook', async () => {
    const source = await readFile(new URL('../../src/engine/scope-check-cli.ts', import.meta.url), 'utf8');
    const withdrawnGuidance = [
      'Flip this single value',
      'enforcing scope refusals',
      'one-line enforcement flip',
      'a later resolved enforcement flip',
      'this branch then refuses the commit',
    ];

    for (const phrase of withdrawnGuidance) {
      expect(source).not.toContain(phrase);
      expect(COMMIT_MSG_HOOK).not.toContain(phrase);
    }
  });

  it('falls back to report-only for a non-boolean containment setting', async () => {
    await writeFile(
      join(projectRoot, '.ai-conductor', 'config.yml'),
      'build_review:\n  scopeContainmentEnforced: enabled\n',
    );

    await expect(loadScopeCheckEnforcement(projectRoot)).resolves.toBe(false);
  });

  it.each([
    ['a malformed config result', async () => ({
      ok: false as const,
      error: { type: 'parse_error' as const, message: 'invalid YAML' },
    })],
    ['an unreadable config', async () => {
      throw new Error('EACCES');
    }],
  ])('falls back to report-only without throwing for %s', async (_name, load) => {
    await expect(loadScopeCheckEnforcement(projectRoot, load)).resolves.toBe(false);
  });

  it('detects the commit-message path for the dispatcher', () => {
    expect(
      detectScopeCheckCommand(['node', 'conduct-ts', 'scope-check', '/tmp/COMMIT_EDITMSG']),
    ).toEqual({ commitMessagePath: '/tmp/COMMIT_EDITMSG' });
    expect(detectScopeCheckCommand(['node', 'conduct-ts', 'inline', 'feature'])).toBeNull();
  });

  it('allows staged paths declared by the in-progress Task trailer row', async () => {
    const output: string[] = [];

    await expect(
      runScopeCheck({
        projectRoot: '/repo',
        commitMessagePath: '/repo/.git/COMMIT_EDITMSG',
        readFile: async (path) =>
          path.endsWith('task-status.json') ? TASK_STATUS : MESSAGE,
        stagedPaths: async () => ['src/conductor/src/engine/config.ts'],
        print: (message) => output.push(message),
      }),
    ).resolves.toBe(0);

    expect(output).toEqual([]);
  });

  it('advises on every undeclared path with copy-pasteable Scope trailers when recording is enabled', async () => {
    const output: string[] = [];

    await expect(
      runScopeCheck({
        projectRoot: '/repo',
        commitMessagePath: '/repo/.git/COMMIT_EDITMSG',
        readFile: async (path) =>
          path.endsWith('task-status.json') ? TASK_STATUS : MESSAGE,
        enforce: true,
        stagedPaths: async () => [
          'src/conductor/src/unrelated/artifacts.ts',
          'src/conductor/src/other/changelog-pr-finalizer-cli.ts',
        ],
        print: (message) => output.push(message),
      }),
    ).resolves.toBe(0);

    const diagnostic = output.join('\n');
    expect(diagnostic).toContain('Task 3');
    expect(diagnostic).toContain('src/conductor/src/unrelated/artifacts.ts');
    expect(diagnostic).toContain('src/conductor/src/other/changelog-pr-finalizer-cli.ts');
    expect(diagnostic).toContain('Scope: src/conductor/src/unrelated/artifacts.ts — feat(engine): scope check');
    expect(diagnostic).toContain('Scope: src/conductor/src/other/changelog-pr-finalizer-cli.ts — feat(engine): scope check');
    expect(diagnostic.toLowerCase()).not.toContain('refus');
  });

  it('keeps an out-of-floor commit silent when containment recording is disabled', async () => {
    const output: string[] = [];

    await expect(
      runScopeCheck({
        projectRoot: '/repo',
        commitMessagePath: '/repo/.git/COMMIT_EDITMSG',
        readFile: async (path) =>
          path.endsWith('task-status.json') ? TASK_STATUS : MESSAGE,
        stagedPaths: async () => ['src/conductor/src/unrelated/artifacts.ts'],
        print: (message) => output.push(message),
      }),
    ).resolves.toBe(0);

    expect(output).toEqual([]);
  });

  it('bounds its advisory diagnostic for 200 undeclared paths', async () => {
    const output: string[] = [];
    const stagedPaths = Array.from(
      { length: 200 },
      (_value, index) => `src/conductor/src/unrelated-${index}.ts`,
    );

    await expect(
      runScopeCheck({
        projectRoot: '/repo',
        commitMessagePath: '/repo/.git/COMMIT_EDITMSG',
        enforce: true,
        readFile: async (path) =>
          path.endsWith('task-status.json') ? TASK_STATUS : MESSAGE,
        stagedPaths: async () => stagedPaths,
        print: (message) => output.push(message),
      }),
    ).resolves.toBe(0);

    expect(output).toHaveLength(1);
    expect(output[0]).toContain('Task 3');
    expect(output[0]).toContain('src/conductor/src/unrelated-0.ts');
    expect(output[0]).toContain('more undeclared paths');
    expect(output[0]).not.toContain('src/conductor/src/unrelated-199.ts');
    expect(output[0].length).toBeLessThan(5_000);
  });

  it.each([
    ['missing Task trailer', 'feat(engine): no task\n', TASK_STATUS, 0],
    ['missing task-status data', MESSAGE, undefined, 0],
    ['a stale task row', MESSAGE, JSON.stringify({ tasks: [{ id: '3', status: 'completed', files: ['config.ts'] }] }), 0],
    ['an active task without declared files', MESSAGE, JSON.stringify({ tasks: [{ id: '3', status: 'in_progress', files: [] }] }), 0],
    ['a malformed task-status file', MESSAGE, '{', 3],
  ])('exits with the classified result for %s in either mode', async (_name, message, status, expectedExitCode) => {
    const output: string[] = [];

    for (const enforce of [false, true]) {
      await expect(
        runScopeCheck({
          projectRoot: '/repo',
          commitMessagePath: '/repo/.git/COMMIT_EDITMSG',
          enforce,
          readFile: async (path) => {
            if (path.endsWith('task-status.json')) {
              if (status === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
              return status;
            }
            return message;
          },
          stagedPaths: async () => ['src/conductor/src/engine/artifacts.ts'],
          print: (line) => output.push(line),
        }),
      ).resolves.toBe(expectedExitCode);
    }

    expect(output).toEqual([]);
  });

  it('exits 3 when staged-path evaluation throws after resolving the active task', async () => {
    await expect(
      runScopeCheck({
        projectRoot: '/repo',
        commitMessagePath: '/repo/.git/COMMIT_EDITMSG',
        readFile: async (path) =>
          path.endsWith('task-status.json') ? TASK_STATUS : MESSAGE,
        stagedPaths: async () => {
          throw new Error('git failed');
        },
      }),
    ).resolves.toBe(3);
  });

  it('appends exactly one unresolved-check event without changing the engine ledger', async () => {
    const engineLedgerPath = join(projectRoot, '.pipeline', 'events.jsonl');
    const engineLedger = '{"type":"step_started"}\n';
    const messagePath = join(projectRoot, 'COMMIT_EDITMSG');
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(engineLedgerPath, engineLedger, 'utf8');
    await writeFile(join(projectRoot, '.pipeline', 'task-status.json'), '{', 'utf8');
    await writeFile(messagePath, MESSAGE, 'utf8');

    await expect(runScopeCheck({ projectRoot, commitMessagePath: messagePath })).resolves.toBe(3);

    expect(await readFile(join(projectRoot, '.pipeline', 'hook-events.jsonl'), 'utf8')).toMatch(
      /^\{"type":"containment_check_unresolved","failure":"task-status-malformed","taskId":"3","ts":\d+\}\n$/,
    );
    await expect(readFile(engineLedgerPath, 'utf8')).resolves.toBe(engineLedger);
  });

  it('round-trips escaped commit task values as one parseable hook-ledger line', async () => {
    const taskId = 'task "quote"\\slash\nnewline';
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await appendUnresolvedContainmentCheck(projectRoot, {
      type: 'containment_check_unresolved',
      failure: 'task-status-malformed',
      taskId,
      ts: 1,
    });

    const lines = (await readFile(join(projectRoot, '.pipeline', 'hook-events.jsonl'), 'utf8')).split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ taskId, failure: 'task-status-malformed' });
  });

  it('swallows an unwritable hook ledger path', async () => {
    const messagePath = join(projectRoot, 'COMMIT_EDITMSG');
    await writeFile(join(projectRoot, '.pipeline'), 'not a directory', 'utf8');
    await writeFile(messagePath, MESSAGE, 'utf8');

    await expect(runScopeCheck({ projectRoot, commitMessagePath: messagePath })).resolves.toBe(3);
  });

  it('keeps two rapid unresolved checks as individually parseable records', async () => {
    const firstMessagePath = join(projectRoot, 'COMMIT_EDITMSG-1');
    const secondMessagePath = join(projectRoot, 'COMMIT_EDITMSG-2');
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(join(projectRoot, '.pipeline', 'task-status.json'), '{', 'utf8');
    await writeFile(firstMessagePath, MESSAGE, 'utf8');
    await writeFile(secondMessagePath, MESSAGE.replace('Task: 3', 'Task: 4'), 'utf8');

    await expect(Promise.all([
      runScopeCheck({ projectRoot, commitMessagePath: firstMessagePath }),
      runScopeCheck({ projectRoot, commitMessagePath: secondMessagePath }),
    ])).resolves.toEqual([3, 3]);

    const records = (await readFile(join(projectRoot, '.pipeline', 'hook-events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.taskId).sort()).toEqual(['3', '4']);
  });
});
