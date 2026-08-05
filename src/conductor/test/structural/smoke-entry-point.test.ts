import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';
import { createVitest } from 'vitest/node';

import { runSmoke } from '../smoke-runner.js';

const structuralRoot = dirname(fileURLToPath(import.meta.url));
const conductorRoot = join(structuralRoot, '../..');

describe('structural: smoke test entry point', () => {
  it('fails before running Vitest when smoke discovery is empty', async () => {
    const runVitest = vi.fn();
    const outcome = await runSmoke({
      discover: async () => [],
      runVitest,
    }).then(
      () => 'resolved',
      (error: unknown) => `${(error as Error).message}:${runVitest.mock.calls.length}`,
    );

    expect(outcome).toBe('Smoke discovery found no test files:0');
  });

  it('discovers every known smoke file through the resolved smoke config', async () => {
    const vitest = await createVitest('test', {
      config: join(conductorRoot, 'vitest.smoke.config.ts'),
      root: conductorRoot,
    });

    try {
      const discovered = (await vitest.globTestFiles())
        .map(({ moduleId }) => relative(conductorRoot, moduleId).replaceAll('\\', '/'))
        .sort();

      expect(discovered).toEqual([
        'test/backlog-priority.smoke.test.ts',
        'test/engine/build-token-auth.smoke.test.ts',
        'test/engine/daemon-e2e-live.smoke.test.ts',
        'test/engine/daemon-tmux.smoke.test.ts',
        'test/execution/claude-provider.smoke.test.ts',
        'test/execution/codex-provider.smoke.test.ts',
        'test/smoke/finish-record.smoke.test.ts',
        'test/smoke/publish-interrupted.smoke.test.ts',
        'test/smoke/surgical-finish-retry.smoke.test.ts',
      ]);
    } finally {
      await vitest.close();
    }
  });
});
