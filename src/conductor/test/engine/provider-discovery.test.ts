// Covers: task:9
import { describe, expect, it } from 'vitest';
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
});
