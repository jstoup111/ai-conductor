// Covers: task:22
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const { spawnProcess } = vi.hoisted(() => ({ spawnProcess: vi.fn() }));

vi.mock('node:child_process', () => ({ spawn: spawnProcess }));

import { openGuidedSession } from '../../../src/engine/monitor/session.js';

const halt = {
  project: '/workspace/harness',
  slug: 'repair-halt',
  reason: 'test failure',
  haltClass: 'mechanical',
} as const;

const openingPrompt = [
  'Resolve this halted daemon feature with the existing daemon-triage procedure.',
  'Invoke $daemon-triage for feature repair-halt.',
  'Project: /workspace/harness',
  'Feature: repair-halt',
  'Reason: test failure',
  'Classification: mechanical',
  'Recovery procedure: Follow the mechanical halt recovery in docs/runbooks/stalled-or-stuck-feature.md.',
  'Session host: conduct monitor queue.',
  'Quitting this session returns the operator to the monitor queue.',
  'Quit instruction: /quit',
  'When daemon-triage reaches its end, follow its monitor-hosted closing step.',
].join('\n');

const claudeOpeningPrompt = [
  'Resolve this halted daemon feature with the existing daemon-triage procedure.',
  'Invoke /daemon-triage for feature repair-halt.',
  'Project: /workspace/harness',
  'Feature: repair-halt',
  'Reason: test failure',
  'Classification: mechanical',
  'Recovery procedure: Follow the mechanical halt recovery in docs/runbooks/stalled-or-stuck-feature.md.',
  'Session host: conduct monitor queue.',
  'Quitting this session returns the operator to the monitor queue.',
  'Quit instruction: /quit',
  'When daemon-triage reaches its end, follow its monitor-hosted closing step.',
].join('\n');

describe('guided monitor interactive launch', () => {
  it('opens Codex as an attached TUI while preserving Claude\'s REPL invocation', async () => {
    const codexStdin = { end: vi.fn(), write: vi.fn() };
    const codexChild = Object.assign(new EventEmitter(), { stdin: codexStdin });
    const claudeChild = Object.assign(new EventEmitter(), { stdin: undefined });
    spawnProcess.mockReturnValueOnce(codexChild).mockReturnValueOnce(claudeChild);
    const stdinIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    const stdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });

    try {
      const codexLaunch = openGuidedSession({ provider: 'codex', halt });
      codexChild.emit('exit', 0);
      await codexLaunch;

      const claudeLaunch = openGuidedSession({ provider: 'claude', halt });
      claudeChild.emit('exit', 0);
      await claudeLaunch;

      expect({
        codex: spawnProcess.mock.calls[0],
        codexStdinCalls: [...codexStdin.write.mock.calls, ...codexStdin.end.mock.calls],
        claude: spawnProcess.mock.calls[1],
      }).toEqual({
        codex: [
          'codex',
          [openingPrompt],
          {
            cwd: '/workspace/harness/.worktrees/repair-halt',
            stdio: 'inherit',
          },
        ],
        codexStdinCalls: [],
        claude: [
          'claude',
          ['--permission-mode', 'default', claudeOpeningPrompt],
          {
            cwd: '/workspace/harness/.worktrees/repair-halt',
            stdio: 'inherit',
          },
        ],
      });
    } finally {
      if (stdinIsTTY === undefined) delete (process.stdin as { isTTY?: boolean }).isTTY;
      else Object.defineProperty(process.stdin, 'isTTY', stdinIsTTY);
      if (stdoutIsTTY === undefined) delete (process.stdout as { isTTY?: boolean }).isTTY;
      else Object.defineProperty(process.stdout, 'isTTY', stdoutIsTTY);
    }
  });
});
