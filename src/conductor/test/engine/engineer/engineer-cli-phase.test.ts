// Covers: task:3
// Covers: task:4
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import {
  detectEngineerCommand,
  dispatchEngineer,
  SUBCOMMAND_HELP,
} from '../../../src/engine/engineer-cli.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function specWorktree(): Promise<string> {
  const worktree = await mkdtemp(join(tmpdir(), 'engineer-cli-phase-'));
  temporaryDirectories.push(worktree);
  await execa('git', ['init', '--initial-branch=main'], { cwd: worktree });
  await execa('git', ['config', 'user.email', 'test@example.test'], { cwd: worktree });
  await execa('git', ['config', 'user.name', 'Test User'], { cwd: worktree });
  await execa('git', ['commit', '--allow-empty', '-m', 'initial'], { cwd: worktree });
  await execa('git', ['checkout', '-b', 'spec/demo-idea'], { cwd: worktree });
  return worktree;
}

const argv = (...args: string[]) => ['node', 'conduct', 'compose', 'phase', ...args];
const ghCapability = {
  probeGhVersion: async () => ({ kind: 'ok' as const, version: { major: 2, minor: 73, patch: 0 } }),
};
const phaseSlug = { resolvePlanReviewFeatureSlug: async () => 'demo-idea' };

describe('compose phase', () => {
  it.each(['', 'plan review', '\u001b[31mplan', 'PLAN'])('rejects invalid phase %j before labeling', async (phase) => {
    const worktree = await specWorktree();
    const calls: Array<{ command: string; args: string[] }> = [];
    const errors: string[] = [];

    const code = await dispatchEngineer(
      detectEngineerCommand(argv('--worktree', worktree, '--phase', phase))!,
      {
        ...ghCapability,
        ...phaseSlug,
        env: { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' },
        paneLabelRunner: async (command, args) => { calls.push({ command, args }); },
        printErr: (line) => errors.push(line),
      },
    );

    expect(code).toBe(1);
    expect(errors).toEqual([expect.stringContaining(`invalid phase '${phase}'`)]);
    expect(calls).toEqual([]);
  });

  it('rejects a worktree that does not resolve to a spec branch before labeling', async () => {
    const worktree = await mkdtemp(join(tmpdir(), 'engineer-cli-phase-non-spec-'));
    temporaryDirectories.push(worktree);
    await execa('git', ['init', '--initial-branch=main'], { cwd: worktree });
    await execa('git', ['config', 'user.email', 'test@example.test'], { cwd: worktree });
    await execa('git', ['config', 'user.name', 'Test User'], { cwd: worktree });
    await execa('git', ['commit', '--allow-empty', '-m', 'initial'], { cwd: worktree });
    const calls: Array<{ command: string; args: string[] }> = [];
    const errors: string[] = [];

    const code = await dispatchEngineer(
      detectEngineerCommand(argv('--worktree', worktree, '--phase', 'stories'))!,
      {
        ...ghCapability,
        env: { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' },
        paneLabelRunner: async (command, args) => { calls.push({ command, args }); },
        printErr: (line) => errors.push(line),
      },
    );

    expect(code).toBe(1);
    expect(errors).toEqual([expect.stringContaining(worktree)]);
    expect(calls).toEqual([]);
  });

  it('succeeds without a HERDR_ENV or TMUX_PANE and makes no label call', async () => {
    const worktree = await specWorktree();
    const calls: Array<{ command: string; args: string[] }> = [];

    const code = await dispatchEngineer(
      detectEngineerCommand(argv('--worktree', worktree, '--phase', 'stories'))!,
      {
        ...ghCapability,
        ...phaseSlug,
        env: {},
        paneLabelRunner: async (command, args) => { calls.push({ command, args }); },
      },
    );

    expect(code).toBe(0);
    expect(calls).toEqual([]);
  });

  it('labels the spec worktree pane through the injected herdr runner', async () => {
    const worktree = await specWorktree();
    const calls: Array<{ command: string; args: string[] }> = [];
    const command = detectEngineerCommand(argv('--worktree', worktree, '--phase', 'stories'));

    const code = await dispatchEngineer(command!, {
      ...ghCapability,
      env: { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' },
      paneLabelRunner: async (command, args) => { calls.push({ command, args }); },
    });

    expect(code).toBe(0);
    expect(calls).toEqual([
      { command: 'herdr', args: ['pane', 'rename', 'w1:p1', 'demo-idea · stories'] },
    ]);
  });

  it('uses the current phase for each tmux label', async () => {
    const worktree = await specWorktree();
    const calls: Array<{ command: string; args: string[] }> = [];
    const options = {
      ...ghCapability,
      env: { TMUX_PANE: '%3' },
      paneLabelRunner: async (command: string, args: string[]) => { calls.push({ command, args }); },
    };

    const first = await dispatchEngineer(detectEngineerCommand(argv('--worktree', worktree, '--phase', 'stories'))!, options);
    const second = await dispatchEngineer(detectEngineerCommand(argv('--worktree', worktree, '--phase', 'plan'))!, options);

    expect(first).toBe(0);
    expect(second).toBe(0);
    expect(calls).toEqual([
      { command: 'tmux', args: ['select-pane', '-t', '%3', '-T', 'demo-idea · stories'] },
      { command: 'tmux', args: ['select-pane', '-t', '%3', '-T', 'demo-idea · plan'] },
    ]);
  });

  it('keeps a rejected or timed-out label best-effort and reports one stderr warning', async () => {
    const worktree = await specWorktree();
    const command = detectEngineerCommand(argv('--worktree', worktree, '--phase', 'stories'))!;
    const rejectedErrors: string[] = [];
    const rejected = await dispatchEngineer(command, {
      ...ghCapability,
      ...phaseSlug,
      env: { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' },
      paneLabelRunner: async () => { throw new Error('unavailable'); },
      printErr: (line) => rejectedErrors.push(line),
    });

    vi.useFakeTimers();
    try {
      const timeoutErrors: string[] = [];
      const timedOut = dispatchEngineer(command, {
        ...ghCapability,
        ...phaseSlug,
        env: { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' },
        paneLabelRunner: async () => new Promise<void>(() => {}),
        printErr: (line) => timeoutErrors.push(line),
      });
      await vi.advanceTimersByTimeAsync(2_000);

      expect(rejected).toBe(0);
      expect(rejectedErrors).toHaveLength(1);
      expect(rejectedErrors[0]).toMatch(/^compose: pane label skipped/);
      await expect(timedOut).resolves.toBe(0);
      expect(timeoutErrors).toHaveLength(1);
      expect(timeoutErrors[0]).toMatch(/^compose: pane label skipped/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders phase help without dispatching a label', async () => {
    const output: string[] = [];
    const command = detectEngineerCommand(argv('--help'));
    const code = await dispatchEngineer(command!, { print: (line) => output.push(line) });

    expect(code).toBe(0);
    expect(output).toEqual([SUBCOMMAND_HELP.phase]);
    expect(output[0]).toContain('--worktree');
    expect(output[0]).toContain('--phase');
  });

  it('does not label when no runner is injected', async () => {
    const worktree = await specWorktree();
    const errors: string[] = [];
    const code = await dispatchEngineer(
      detectEngineerCommand(argv('--worktree', worktree, '--phase', 'stories'))!,
      { ...ghCapability, env: { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' }, printErr: (line) => errors.push(line) },
    );

    expect(code).toBe(0);
    expect(errors).toEqual([]);
  });
});
