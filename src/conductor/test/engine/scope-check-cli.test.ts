import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as scopeCheckCli from '../../src/engine/scope-check-cli.js';
import { COMMIT_MSG_HOOK } from '../../src/engine/git-hook-assets.js';

const { detectScopeCheckCommand, runScopeCheck } = scopeCheckCli;
const loadScopeCheckEnforcement = (
  scopeCheckCli as typeof scopeCheckCli & {
    loadScopeCheckEnforcement(
      projectRoot: string,
      load?: (projectRoot: string) => Promise<any>,
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

  it('falls back to report-only for a non-boolean containment configuration value', async () => {
    await expect(
      loadScopeCheckEnforcement(projectRoot, async () => ({
        ok: true,
        config: { build_review: { scopeContainmentEnforced: 'true' } },
        warnings: [],
      })),
    ).resolves.toBe(false);
  });

  it('falls back to report-only when the configuration loader rejects', async () => {
    await expect(
      loadScopeCheckEnforcement(projectRoot, async () => {
        throw new Error('configuration unreadable');
      }),
    ).resolves.toBe(false);
  });

  it('falls back to report-only for a malformed configuration result', async () => {
    await expect(
      loadScopeCheckEnforcement(projectRoot, async () => ({
        ok: false,
        error: { type: 'parse_error', message: 'configuration malformed' },
      })),
    ).resolves.toBe(false);
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

  it('keeps reserved exit code 2 outside runScopeCheck', async () => {
    const source = await readFile(new URL('../../src/engine/scope-check-cli.ts', import.meta.url), 'utf8');
    const runScopeCheckStart = source.indexOf('export async function runScopeCheck');
    const nextDeclaration = source.indexOf('/** Record hook-owned uncertainty', runScopeCheckStart);
    const runScopeCheckSource = source.slice(runScopeCheckStart, nextDeclaration);

    expect(runScopeCheckStart).toBeGreaterThanOrEqual(0);
    expect(nextDeclaration).toBeGreaterThan(runScopeCheckStart);
    expect(runScopeCheckSource).not.toMatch(/\breturn\s+2\b/);
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

  it('keeps a root-level neighbor silent when containment recording is disabled', async () => {
    const output: string[] = [];

    await expect(
      runScopeCheck({
        projectRoot: '/repo',
        commitMessagePath: '/repo/.git/COMMIT_EDITMSG',
        readFile: async (path) =>
          path.endsWith('task-status.json') ? TASK_STATUS : MESSAGE,
        stagedPaths: async () => ['neighbor.ts'],
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

  it.each([
    ['non-object row', JSON.stringify({ tasks: [null] })],
    ['missing id', JSON.stringify({ tasks: [{ status: 'in_progress', files: ['config.ts'] }] })],
    ['null id', JSON.stringify({ tasks: [{ id: null, status: 'in_progress', files: ['config.ts'] }] })],
    ['non-string status', JSON.stringify({ tasks: [{ id: '3', status: true, files: ['config.ts'] }] })],
    ['non-string files member', JSON.stringify({ tasks: [{ id: '3', status: 'in_progress', files: ['config.ts', 1] }] })],
  ])('records task-status-malformed for a structurally malformed %s', async (_name, status) => {
    const messagePath = join(projectRoot, 'COMMIT_EDITMSG');
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(messagePath, MESSAGE, 'utf8');
    await writeFile(join(projectRoot, '.pipeline', 'task-status.json'), status, 'utf8');

    await expect(runScopeCheck({ projectRoot, commitMessagePath: messagePath })).resolves.toBe(3);
    await expect(readFile(join(projectRoot, '.pipeline', 'hook-events.jsonl'), 'utf8')).resolves.toContain(
      '"failure":"task-status-malformed"',
    );
  });

  it('remains not applicable for a valid task-status file without an active row', async () => {
    await expect(
      runScopeCheck({
        projectRoot: '/repo',
        commitMessagePath: '/repo/.git/COMMIT_EDITMSG',
        readFile: async (path) => path.endsWith('task-status.json')
          ? JSON.stringify({ tasks: [{ id: '3', status: 'completed', files: ['config.ts'] }] })
          : MESSAGE,
      }),
    ).resolves.toBe(0);
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

    expect(JSON.parse(await readFile(join(projectRoot, '.pipeline', 'hook-events.jsonl'), 'utf8'))).toMatchObject({
      type: 'containment_check_unresolved',
      failure: 'task-status-malformed',
      taskId: '3',
      commitMessage: MESSAGE,
    });
    await expect(readFile(engineLedgerPath, 'utf8')).resolves.toBe(engineLedger);
  });

  it('round-trips a real commit message with escaped body content as one parseable hook-ledger line', async () => {
    const commitMessage = 'feat(engine): retain "quote" and \\backslash\n\nbody has embedded\nnewlines\n\nTask: 3\n';
    const messagePath = join(projectRoot, 'COMMIT_EDITMSG');
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(join(projectRoot, '.pipeline', 'task-status.json'), '{', 'utf8');
    await writeFile(messagePath, commitMessage, 'utf8');

    await expect(runScopeCheck({ projectRoot, commitMessagePath: messagePath })).resolves.toBe(3);

    const lines = (await readFile(join(projectRoot, '.pipeline', 'hook-events.jsonl'), 'utf8')).split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      taskId: '3',
      failure: 'task-status-malformed',
      commitMessage,
    });
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
