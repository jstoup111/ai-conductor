// Covers: task:15, task:16, task:17

import { describe, expect, it, vi } from 'vitest';

import { detectDoneWhenAcceptCommand } from '../../src/cli.js';
import { dispatchDoneWhenAccept } from '../../src/engine/done-when-accept-cli.js';

const command = {
  kind: 'accept' as const,
  feature: 'done-when-citations',
  taskId: '24',
  check: 3,
  reason: 'The operator verified this citation manually.',
};

function refusalFixture() {
  const files = new Map<string, string>([
    ['/main/.worktrees/done-when-citations/.pipeline/task-status.json', JSON.stringify({
      tasks: [{
        id: '24', status: 'completed', doneWhen: [
          { check: 'first check', source: 'judged', verdict: 'asserts' },
          { check: 'second check', source: 'judged', verdict: 'asserts' },
          { check: 'third check', source: 'judged', verdict: 'does-not-assert' },
        ],
      }],
    }, null, 2)],
    ['/main/.worktrees/done-when-citations/.pipeline/engine-state.json', '{\n  "version": 1\n}\n'],
  ]);
  return files;
}

describe('done-when accept CLI', () => {
  it('recognizes only the exact bound operator grammar', () => {
    const accepted = ['node', 'conduct', 'done-when', 'accept', '--feature', 'done-when-citations', '--task', '24', '--check', '3', '--reason', 'manual review'];
    expect(detectDoneWhenAcceptCommand(accepted)).toEqual({
      kind: 'accept', feature: 'done-when-citations', taskId: '24', check: 3, reason: 'manual review',
    });
    for (const argv of [
      [...accepted, '--operator', 'forged'],
      accepted.slice(0, -2),
      ['node', 'conduct', 'done-when', 'accept', '--task', '24', '--feature', 'done-when-citations', '--check', '3', '--reason', 'manual review'],
      ['node', 'conduct', 'done-when', 'accept', '--feature', '../outside', '--task', '24', '--check', '3', '--reason', 'manual review'],
      ['node', 'conduct', 'done-when', 'accept', '--feature', 'done-when-citations', '--task', '24', '--check', '0', '--reason', 'manual review'],
    ]) expect(detectDoneWhenAcceptCommand(argv)).toBeNull();
  });

  it.each([
    ['missing reason', { ...command, reason: '  ' }, /missing reason/i],
    ['unknown feature', { ...command, feature: 'unknown-feature' }, /unknown feature/i],
    ['unknown task', { ...command, taskId: '999' }, /unknown task/i],
    ['unknown check', { ...command, check: 4 }, /unknown check/i],
    ['check with no refused citation', { ...command, check: 2 }, /no refused citation/i],
  ] as const)('refuses %s without changing task status or engine state', async (_caseName, input, expected) => {
    const files = refusalFixture();
    const before = new Map(files);
    const print = vi.fn();
    const code = await dispatchDoneWhenAccept(input, {
      resolveWorktree: async (feature) => feature === command.feature ? '/main/.worktrees/done-when-citations' : undefined,
      readFile: async (path) => files.get(path) ?? Promise.reject(new Error('missing fixture')),
      print,
    });

    expect(code).toBe(1);
    expect(print).toHaveBeenCalledWith(expect.stringMatching(expected));
    expect(files).toEqual(before);
  });

  it('records operator acceptance and emits its canonical event', async () => {
    const files = refusalFixture();
    const emitted: unknown[] = [];
    const code = await dispatchDoneWhenAccept(command, {
      resolveWorktree: async () => '/main/.worktrees/done-when-citations',
      readFile: async (path) => files.get(path) ?? Promise.reject(new Error('missing fixture')),
      writeFile: async (path, data) => { files.set(path, data); },
      emit: async (_worktree, event) => { emitted.push(event); },
      print: vi.fn(),
    });

    expect(code).toBe(0);
    const status = JSON.parse(files.get('/main/.worktrees/done-when-citations/.pipeline/task-status.json')!);
    expect(status.tasks[0].doneWhen[2]).toMatchObject({ source: 'operator-accepted', reason: command.reason });
    expect(emitted).toEqual([expect.objectContaining({ type: 'done_when_citation_accepted', taskId: '24', check: 3, reason: command.reason })]);
  });

  it('accepts a refusal demoted to unverified while retaining its refusal provenance', async () => {
    const files = refusalFixture();
    const status = JSON.parse(files.get('/main/.worktrees/done-when-citations/.pipeline/task-status.json')!);
    status.tasks[0].doneWhen[2] = { check: 'third check', source: 'unverified', verdict: 'does-not-assert', reason: 'bounded refusal' };
    files.set('/main/.worktrees/done-when-citations/.pipeline/task-status.json', JSON.stringify(status));
    const code = await dispatchDoneWhenAccept(command, {
      resolveWorktree: async () => '/main/.worktrees/done-when-citations',
      readFile: async (path) => files.get(path) ?? Promise.reject(new Error('missing fixture')),
      writeFile: async (path, data) => { files.set(path, data); }, emit: async () => {}, print: vi.fn(),
    });
    expect(code).toBe(0);
    expect(JSON.parse(files.get('/main/.worktrees/done-when-citations/.pipeline/task-status.json')!).tasks[0].doneWhen[2])
      .toMatchObject({ source: 'operator-accepted', reason: command.reason });
  });
});
