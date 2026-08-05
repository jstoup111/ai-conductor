import { readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';
import { createVitest } from 'vitest/node';

import type { SmokeCapability } from '../smoke-capability.js';
import { parseSmokeCapabilityDeclaration, runSmoke } from '../smoke-runner.js';

const structuralRoot = dirname(fileURLToPath(import.meta.url));
const conductorRoot = join(structuralRoot, '../..');
const smokeCapabilities: Readonly<Record<string, SmokeCapability>> = {
  'test/backlog-priority.smoke.test.ts': 'toolchain',
  'test/engine/build-token-auth.smoke.test.ts': 'credentialed',
  'test/engine/daemon-e2e-live.smoke.test.ts': 'credentialed',
  'test/engine/daemon-tmux.smoke.test.ts': 'toolchain',
  'test/execution/claude-provider.smoke.test.ts': 'credentialed',
  'test/execution/codex-provider.smoke.test.ts': 'toolchain',
  'test/smoke/finish-record.smoke.test.ts': 'hermetic',
  'test/smoke/publish-interrupted.smoke.test.ts': 'toolchain',
  'test/smoke/surgical-finish-retry.smoke.test.ts': 'hermetic',
};

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

  it('names a discovered file and its invalid capability literal', () => {
    const file = 'test/smoke/invalid-capability.smoke.test.ts';

    expect(() => parseSmokeCapabilityDeclaration(
      file,
      `declareSmokeCapability('${file}', 'networked');`,
    )).toThrow(`Smoke file ${file} declares invalid capability networked`);
  });

  it('applies per-file capability decisions, records skips, and requires credentialed execution in gate mode', async () => {
    const runVitest = vi.fn(async () => undefined);
    const emit = vi.fn();

    await runSmoke({
      discover: async () => [
        { file: 'test/smoke/finish-record.smoke.test.ts', capability: 'hermetic' },
        { file: 'test/backlog-priority.smoke.test.ts', capability: 'toolchain' },
        { file: 'test/engine/daemon-e2e-live.smoke.test.ts', capability: 'credentialed' },
      ],
      runVitest,
      mode: 'advisory',
      hasCommand: (command) => command !== 'gh',
      environment: {},
      emit,
    });

    expect(runVitest).toHaveBeenCalledTimes(1);
    expect(runVitest).toHaveBeenNthCalledWith(1, 'test/smoke/finish-record.smoke.test.ts');
    expect(emit.mock.calls).toEqual(expect.arrayContaining([
      ['smoke ledger: test/backlog-priority.smoke.test.ts [toolchain] skipped (unmet: gh)'],
      ['smoke ledger: test/engine/daemon-e2e-live.smoke.test.ts [credentialed] skipped (unmet: CLAUDE_CODE_OAUTH_TOKEN)'],
      ['smoke ledger: test/smoke/finish-record.smoke.test.ts [hermetic] ran'],
    ]));

    await expect(runSmoke({
      discover: async () => [
        { file: 'test/smoke/finish-record.smoke.test.ts', capability: 'hermetic' },
        { file: 'test/engine/daemon-e2e-live.smoke.test.ts', capability: 'credentialed' },
      ],
      runVitest,
      mode: 'gate',
      hasCommand: () => true,
      environment: {},
      emit,
    })).rejects.toThrow('CLAUDE_CODE_OAUTH_TOKEN');
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

  it('requires every discovered smoke file to declare a capability without a retired execution gate', async () => {
    const vitest = await createVitest('test', {
      config: join(conductorRoot, 'vitest.smoke.config.ts'),
      root: conductorRoot,
    });

    try {
      const discovered = (await vitest.globTestFiles())
        .map(({ moduleId }) => relative(conductorRoot, moduleId).replaceAll('\\', '/'))
        .sort();
      const retiredVariables = [
        'AUTORESOLVE_SMOKE_TEST',
        'CODEX_CLI_SMOKE_TEST',
        'PRIORITY_GH_SMOKE',
        'MODEL_UNAVAILABLE_SMOKE',
        'AUTH_FAILURE_SMOKE',
        'BUILD_TOKEN_AUTH_SMOKE',
        'DAEMON_E2E_LIVE_SMOKE',
      ];
      const sources = await Promise.all(
        discovered.map(async (file) => [file, await readFile(join(conductorRoot, file), 'utf8')] as const),
      );

      expect(discovered).toEqual(Object.keys(smokeCapabilities).sort());
      expect(sources.filter(([file, source]) => {
        const declaration = new RegExp(
          `declareSmokeCapability\\(\\s*['\"]${file}['\"]\\s*,\\s*['\"]${smokeCapabilities[file]}['\"]\\s*\\)`,
        );
        return !declaration.test(source);
      }).map(([file]) => file)).toEqual([]);
      expect(sources.flatMap(([file, source]) => retiredVariables
        .filter((variable) => source.includes(variable))
        .map((variable) => `${file}: ${variable}`)))
        .toEqual([]);
    } finally {
      await vitest.close();
    }
  });
});
