// Covers: task:9, task:10
import { describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: vi.fn(actual.execFile) };
});

import { execFile as execFileSpy } from 'node:child_process';
import { discoverInstalledProviders } from '../../src/engine/provider-discovery.js';

describe('discoverInstalledProviders', () => {
  it('reports resolvable claude and codex and a missing pi executable', async () => {
    const runner = async (executable: string): Promise<{ exitCode: number }> => {
      if (executable === 'pi') {
        throw Object.assign(new Error('pi not found'), { code: 'ENOENT' });
      }
      return { exitCode: 0 };
    };

    await expect(discoverInstalledProviders({ env: {}, runner })).resolves.toEqual({
      installed: ['claude', 'codex'],
      missing: [{ id: 'pi', reason: 'not-found' }],
    });
  });

  it('probes an override path instead of the descriptor default executable', async () => {
    const calls: string[] = [];
    const runner = async (executable: string): Promise<{ exitCode: number }> => {
      calls.push(executable);
      return { exitCode: 0 };
    };

    await discoverInstalledProviders({
      env: { CLAUDE_EXECUTABLE: '/opt/claude/bin/claude' },
      runner,
    });

    expect(calls).toContain('/opt/claude/bin/claude');
  });

  it('classifies non-zero probes and non-executable binaries distinctly', async () => {
    const runner = async (executable: string): Promise<{ exitCode: number }> => {
      if (executable === 'claude') return { exitCode: 1 };
      if (executable === 'codex') {
        throw Object.assign(new Error('codex is not executable'), { code: 'EACCES' });
      }
      return { exitCode: 0 };
    };

    await expect(discoverInstalledProviders({ env: {}, runner })).resolves.toEqual({
      installed: ['pi'],
      missing: [
        { id: 'claude', reason: 'version-failed' },
        { id: 'codex', reason: 'not-executable' },
      ],
    });
  });

  it('bounds a probe that never exits by its timeout', async () => {
    const startedAt = Date.now();
    const runner = (executable: string): Promise<{ exitCode: number }> => {
      if (executable === 'pi') return new Promise(() => {});
      return Promise.resolve({ exitCode: 0 });
    };

    await expect(discoverInstalledProviders({ env: {}, runner, timeoutMs: 10 })).resolves.toEqual({
      installed: ['claude', 'codex'],
      missing: [{ id: 'pi', reason: 'timeout' }],
    });
    expect(Date.now() - startedAt).toBeLessThanOrEqual(110);
  });

  it('refuses the default real-exec runner before it spawns under the test guard', async () => {
    vi.mocked(execFileSpy).mockClear();
    expect(process.env.AI_CONDUCTOR_NO_REAL_EXEC).toBeTruthy();

    await expect(discoverInstalledProviders()).rejects.toThrow(/AI_CONDUCTOR_NO_REAL_EXEC/);

    expect(execFileSpy).not.toHaveBeenCalled();
  });
});
