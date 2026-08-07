import { describe, expect, it, vi } from 'vitest';
import {
  runScopedCommand,
  type ScopedRunRunner,
} from '../../src/engine/scoped-run.js';

describe('runScopedCommand', () => {
  it('substitutes a selector into the configured template and returns the runner exit status', async () => {
    const runner = vi.fn<ScopedRunRunner>(async () => 7);

    const exitCode = await runScopedCommand({
      template: 'npx vitest run {selectors}',
      selectors: ['test/engine/scoped-run.test.ts'],
      runner,
    });

    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith(
      expect.stringContaining('test/engine/scoped-run.test.ts'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(exitCode.exitCode).toBe(7);
  });

  it('substitutes every selector at a mid-template placeholder', async () => {
    const runner = vi.fn<ScopedRunRunner>(async () => 0);

    await runScopedCommand({
      template: 'npx vitest run {selectors} --reporter=dot',
      selectors: ['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts'],
      runner,
    });

    expect(runner).toHaveBeenCalledWith(
      'npx vitest run test/a.test.ts test/b.test.ts test/c.test.ts --reporter=dot',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('refuses an empty selector list before substituting or running a command', async () => {
    const runner = vi.fn<ScopedRunRunner>(async () => 0);

    const result = await runScopedCommand({
      template: 'npx vitest run {selectors}',
      selectors: [],
      runner,
    });

    expect(result).toMatchObject({
      exitCode: 1,
      reason: 'empty_selection',
      message: expect.stringMatching(/requires at least one selector/i),
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it('reports a selected-test failure without invoking the aggregate command', async () => {
    const runner = vi.fn<ScopedRunRunner>(async () => 7);

    const result = await runScopedCommand({
      template: 'npx vitest run {selectors}',
      selectors: ['test/failing.test.ts'],
      runner,
    });

    expect(result).toMatchObject({
      exitCode: 7,
      reason: 'test_failure',
      message: expect.stringMatching(/selected test.*failed/i),
    });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith(
      'npx vitest run test/failing.test.ts',
      expect.anything(),
    );
  });

  it('reports an unlaunchable scoped command by name without invoking the aggregate command', async () => {
    const runner = vi.fn<ScopedRunRunner>(async () => {
      throw Object.assign(new Error('spawn npx ENOENT'), { code: 'ENOENT' });
    });

    const result = await runScopedCommand({
      template: 'npx vitest run {selectors}',
      selectors: ['test/selected.test.ts'],
      runner,
    });

    expect(result).toMatchObject({
      exitCode: 1,
      reason: 'launch_failure',
      message: expect.stringContaining('npx vitest run test/selected.test.ts'),
    });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith(
      'npx vitest run test/selected.test.ts',
      expect.anything(),
    );
  });

  it('terminates and reports a timed-out scoped run without invoking the aggregate command', async () => {
    let terminated = false;
    const runner = vi.fn<ScopedRunRunner>((_command, { signal }) => new Promise<number>((resolve) => {
      signal.addEventListener('abort', () => {
        terminated = true;
        resolve(1);
      });
    }));

    const result = await runScopedCommand({
      template: 'npx vitest run {selectors}',
      selectors: ['test/slow.test.ts'],
      runner,
      timeoutMs: 1,
      scheduleTimeout: (callback) => {
        callback();
        return () => undefined;
      },
    });

    expect(terminated).toBe(true);
    expect(result).toMatchObject({
      exitCode: 1,
      reason: 'timeout',
      message: expect.stringMatching(/timed out/i),
    });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith(
      'npx vitest run test/slow.test.ts',
      expect.anything(),
    );
  });
});
