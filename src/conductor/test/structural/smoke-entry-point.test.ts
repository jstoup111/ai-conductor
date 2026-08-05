import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { createVitest } from 'vitest/node';

import { assertSmokeDiscovery } from '../smoke-capability.js';

const structuralRoot = dirname(fileURLToPath(import.meta.url));
const conductorRoot = join(structuralRoot, '../..');

describe('structural: smoke test entry point', () => {
  it('rejects an empty smoke discovery instead of allowing a vacuous pass', () => {
    expect(() => assertSmokeDiscovery([])).toThrow('Smoke discovery found no test files');
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
