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

  it.each([
    {
      name: 'command-not-found shell exit',
      failure: { exitCode: 127, stdout: '', stderr: 'suite-tool: not found' },
      reason: 'unlaunchable',
      exitCode: 127,
      signal: null,
    },
    {
      name: 'permission failure',
      failure: {
        code: 'EACCES',
        exitCode: 7,
        stdout: '',
        stderr: 'permission denied',
      },
      reason: 'unlaunchable',
      exitCode: null,
      signal: null,
    },
    {
      name: 'invalid working directory',
      failure: { code: 'ENOENT', stdout: '', stderr: 'working directory missing' },
      reason: 'unlaunchable',
      exitCode: null,
      signal: null,
    },
    {
      name: 'signal termination',
      failure: {
        signal: 'SIGTERM',
        isTerminated: true,
        stdout: 'suite started',
        stderr: 'terminated',
      },
      reason: 'signal',
      exitCode: null,
      signal: 'SIGTERM',
    },
    {
      name: 'ordinary non-zero exit',
      failure: { exitCode: 7, stdout: 'suite started', stderr: 'assertion failed' },
      reason: 'nonzero_exit',
      exitCode: 7,
      signal: null,
    },
  ])('returns a typed non-passing result for $name', async (testCase) => {
    const command = 'npm test';
    const runner: FullSuiteCommandRunner = async () => {
      throw Object.assign(new Error(testCase.name), testCase.failure);
    };
    const times = [
      new Date('2026-07-25T13:00:00.000Z'),
      new Date('2026-07-25T13:00:01.250Z'),
    ];

    const result = await executeFullSuite({
      projectRoot: '/repo',
      testSuite: { command, working_directory: 'src/conductor' },
      runner,
      clock: () => times.shift()!,
    });

    expect(result).toEqual({
      ok: false,
      reason: testCase.reason,
      command,
      cwd: resolve('/repo', 'src/conductor'),
      startedAt: '2026-07-25T13:00:00.000Z',
      endedAt: '2026-07-25T13:00:01.250Z',
      durationMs: 1_250,
      exitCode: testCase.exitCode,
      signal: testCase.signal,
      stdout: testCase.failure.stdout,
      stderr: testCase.failure.stderr,
    });
  });

  it('returns a typed non-zero result from a real failing process', async () => {
    const command =
      "printf '%s' 'suite started'; printf '%s' 'terminal failure' >&2; exit 7";

    const result = await executeFullSuite({
      projectRoot: process.cwd(),
      testSuite: { command },
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'nonzero_exit',
      command,
      cwd: process.cwd(),
      exitCode: 7,
      signal: null,
      stdout: 'suite started',
      stderr: 'terminal failure',
    });
  });

  it('classifies a real shell-mediated SIGTERM as signal termination', async () => {
    const command = "sh -c 'kill -TERM $$'";

    const result = await executeFullSuite({
      projectRoot: process.cwd(),
      testSuite: { command },
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'signal',
      command,
      cwd: process.cwd(),
      exitCode: null,
      signal: 'SIGTERM',
    });
  });

  it('preserves a plain runner error message as its diagnostic', async () => {
    const runner: FullSuiteCommandRunner = async () => {
      throw new Error('runner exploded');
    };

    const result = await executeFullSuite({
      projectRoot: '/repo',
      testSuite: { command: 'npm test' },
      runner,
      clock: () => new Date('2026-07-25T13:00:00.000Z'),
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'internal_error',
      exitCode: null,
      signal: null,
      stderr: 'runner exploded',
    });
  });
});
