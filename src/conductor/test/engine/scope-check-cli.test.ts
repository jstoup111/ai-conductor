import { describe, expect, it } from 'vitest';

import {
  detectScopeCheckCommand,
  runScopeCheck,
} from '../../src/engine/scope-check-cli.js';

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

  it('refuses every undeclared path with copy-pasteable Scope trailers and no deletion advice', async () => {
    const output: string[] = [];

    await expect(
      runScopeCheck({
        projectRoot: '/repo',
        commitMessagePath: '/repo/.git/COMMIT_EDITMSG',
        readFile: async (path) =>
          path.endsWith('task-status.json') ? TASK_STATUS : MESSAGE,
        stagedPaths: async () => [
          'src/conductor/src/engine/artifacts.ts',
          'src/conductor/src/engine/changelog-pr-finalizer-cli.ts',
        ],
        print: (message) => output.push(message),
      }),
    ).resolves.toBe(2);

    expect(output.join('\n')).toContain('Task 3');
    expect(output.join('\n')).toContain('src/conductor/src/engine/artifacts.ts');
    expect(output.join('\n')).toContain('src/conductor/src/engine/changelog-pr-finalizer-cli.ts');
    expect(output.join('\n')).toContain('Scope: src/conductor/src/engine/artifacts.ts — <rationale>');
    expect(output.join('\n')).toContain('Scope: src/conductor/src/engine/changelog-pr-finalizer-cli.ts — <rationale>');
    expect(output.join('\n').toLowerCase()).not.toContain('delete');
  });

  it.each([
    ['missing Task trailer', 'feat(engine): no task\n', TASK_STATUS],
    ['missing task-status data', MESSAGE, undefined],
    ['a malformed task-status file', MESSAGE, '{'],
    ['a stale task row', MESSAGE, JSON.stringify({ tasks: [{ id: '3', status: 'completed', files: ['config.ts'] }] })],
  ])('abstains on %s', async (_name, message, status) => {
    const output: string[] = [];

    await expect(
      runScopeCheck({
        projectRoot: '/repo',
        commitMessagePath: '/repo/.git/COMMIT_EDITMSG',
        readFile: async (path) => {
          if (path.endsWith('task-status.json')) {
            if (status === undefined) throw new Error('ENOENT');
            return status;
          }
          return message;
        },
        stagedPaths: async () => ['src/conductor/src/engine/artifacts.ts'],
        print: (line) => output.push(line),
      }),
    ).resolves.toBe(1);

    expect(output).toEqual([]);
  });
});
