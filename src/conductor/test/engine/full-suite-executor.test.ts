import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  DEFAULT_FULL_SUITE_TIMEOUT_MS,
  executeFullSuite,
  type FullSuiteCommandRunner,
} from '../../src/engine/full-suite-executor.js';

describe('executeFullSuite', () => {
  it('forwards the exact command, cwd, environment, and timeout with typed timings', async () => {
    const command = 'node runner.mjs --name "quoted aggregate"';
    const environment = { PATH: '/fixture/bin', SUITE_MODE: 'aggregate' };
    const calls: Array<{ command: string; options: unknown }> = [];
    const runner: FullSuiteCommandRunner = async (forwardedCommand, options) => {
      calls.push({ command: forwardedCommand, options });
      return { exitCode: 0, stdout: 'unit: pass\nacceptance: pass\n', stderr: '' };
    };
    const times = [
      new Date('2026-07-25T12:00:00.000Z'),
      new Date('2026-07-25T12:00:03.456Z'),
    ];

    const result = await executeFullSuite({
      projectRoot: '/repo',
      testSuite: {
        command,
        working_directory: 'packages/api',
        timeout_seconds: 42,
      },
      environment,
      runner,
      clock: () => times.shift()!,
    });

    expect({ calls, result }).toEqual({
      calls: [
        {
          command,
          options: {
            cwd: resolve('/repo', 'packages/api'),
            env: environment,
            shell: true,
            timeoutMs: 42_000,
          },
        },
      ],
      result: {
        ok: true,
        command,
        cwd: resolve('/repo', 'packages/api'),
        startedAt: '2026-07-25T12:00:00.000Z',
        endedAt: '2026-07-25T12:00:03.456Z',
        durationMs: 3_456,
        exitCode: 0,
        stdout: 'unit: pass\nacceptance: pass\n',
        stderr: '',
      },
    });
  });

  it('uses the aggregate default timeout when none is declared', async () => {
    let forwardedTimeout: number | undefined;
    const runner: FullSuiteCommandRunner = async (_command, options) => {
      forwardedTimeout = options.timeoutMs;
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    await executeFullSuite({
      projectRoot: '/repo',
      testSuite: { command: 'npm test' },
      runner,
      clock: () => new Date('2026-07-25T12:00:00.000Z'),
    });

    expect(forwardedTimeout).toBe(DEFAULT_FULL_SUITE_TIMEOUT_MS);
  });

  it('executes quoted arguments through the default command-string runner', async () => {
    const command = "printf '%s' 'quoted aggregate'";

    const result = await executeFullSuite({
      projectRoot: process.cwd(),
      testSuite: { command },
    });

    expect(result).toMatchObject({
      ok: true,
      command,
      exitCode: 0,
      stdout: 'quoted aggregate',
      stderr: '',
    });
  });
});
