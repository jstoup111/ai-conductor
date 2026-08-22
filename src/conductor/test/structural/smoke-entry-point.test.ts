import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';
import { createVitest } from 'vitest/node';

import { runSmokeEntryPoint } from '../../scripts/smoke.js';
import type { SmokeCapability } from '../../src/engine/smoke-capability.js';
import { runSmokeCli } from '../../src/engine/smoke-runner.js';
import { LIVE_E2E_PROVIDERS } from '../fixtures/live-e2e-providers.js';

const structuralRoot = dirname(fileURLToPath(import.meta.url));
const conductorRoot = join(structuralRoot, '../..');
const liveProviderSmokeCapabilities: Readonly<Record<string, SmokeCapability>> = Object.fromEntries(
  LIVE_E2E_PROVIDERS.map(({ id }) => [
    `test/engine/daemon-e2e-live-${id}.smoke.test.ts`,
    `credentialed:${id}` as SmokeCapability,
  ]),
);
const smokeCapabilities: Readonly<Record<string, SmokeCapability>> = {
  'test/backlog-priority.smoke.test.ts': 'toolchain',
  'test/engine/build-token-auth.smoke.test.ts': 'credentialed:claude',
  ...liveProviderSmokeCapabilities,
  'test/engine/daemon-tmux.smoke.test.ts': 'toolchain',
  'test/execution/claude-provider.smoke.test.ts': 'credentialed:claude',
  'test/execution/codex-provider.smoke.test.ts': 'toolchain',
  'test/smoke/claude-subagent-stream.smoke.test.ts': 'credentialed:claude',
  'test/smoke/finish-record.smoke.test.ts': 'hermetic',
  'test/smoke/publish-interrupted.smoke.test.ts': 'toolchain',
  'test/smoke/surgical-finish-retry.smoke.test.ts': 'hermetic',
};

describe('structural: smoke test entry point', () => {
  it('forwards both the smoke config and matrix-selected file to the smoke command', async () => {
    const runSmokeCommand = vi.fn();
    const originalArgv = process.argv;

    process.argv = [
      'node',
      'scripts/smoke.ts',
      'vitest.smoke.config.ts',
      'test/engine/daemon-e2e-live-claude.smoke.test.ts',
    ];
    try {
      await runSmokeEntryPoint(undefined, runSmokeCommand);
    } finally {
      process.argv = originalArgv;
    }

    expect(runSmokeCommand).toHaveBeenCalledWith([
      'vitest.smoke.config.ts',
      'test/engine/daemon-e2e-live-claude.smoke.test.ts',
    ]);
  });

  it('fails before running Vitest when smoke discovery is empty', async () => {
    const runVitest = vi.fn();
    const outcome = await runSmokeCli('vitest.smoke.config.ts', {
      discover: async () => [],
      runVitest,
    }).then(
      () => 'resolved',
      (error: unknown) => `${(error as Error).message}:${runVitest.mock.calls.length}`,
    );

    expect(outcome).toBe('Smoke discovery found no test files:0');
  });

  it('applies per-file capability decisions, records skips, and requires provider-leg execution in gate mode', async () => {
    const runVitest = vi.fn(async () => ({ executedAssertions: true, output: '' }));
    const emit = vi.fn();

    await runSmokeCli('vitest.smoke.config.ts', {
      discover: async () => [
        { file: 'test/smoke/finish-record.smoke.test.ts', source: "const smokeCapability = 'hermetic';" },
        { file: 'test/backlog-priority.smoke.test.ts', source: "const smokeCapability = 'toolchain';" },
        { file: 'test/engine/daemon-e2e-live-claude.smoke.test.ts', source: "const smokeCapability = 'credentialed:claude';" },
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
      ['smoke ledger: test/engine/daemon-e2e-live-claude.smoke.test.ts [credentialed:claude] skipped (unmet: CLAUDE_CODE_OAUTH_TOKEN)'],
      ['smoke ledger: test/smoke/finish-record.smoke.test.ts [hermetic] ran'],
    ]));

    await expect(runSmokeCli('vitest.smoke.config.ts', {
      discover: async () => [
        { file: 'test/smoke/finish-record.smoke.test.ts', source: "const smokeCapability = 'hermetic';" },
        { file: 'test/engine/daemon-e2e-live-claude.smoke.test.ts', source: "const smokeCapability = 'credentialed:claude';" },
      ],
      runVitest,
      mode: 'gate',
      hasCommand: () => true,
      environment: {},
      emit,
    })).rejects.toThrow('Gate-mode smoke run executed no credentialed test files');
  });

  it('keeps provider-leg credential and failure outcomes isolated', async () => {
    const claudeFile = 'test/engine/daemon-e2e-live-claude.smoke.test.ts';
    const codexFile = 'test/engine/daemon-e2e-live-codex.smoke.test.ts';
    const providerLegs = [
      { file: claudeFile, source: "const smokeCapability = 'credentialed:claude';" },
      { file: codexFile, source: "const smokeCapability = 'credentialed:codex';" },
    ];

    for (const { environment, executedFile, skippedLine } of [
      {
        environment: { CLAUDE_CODE_OAUTH_TOKEN: 'claude-token' },
        executedFile: claudeFile,
        skippedLine: `smoke ledger: ${codexFile} [credentialed:codex] skipped (unmet: CODEX_API_KEY)`,
      },
      {
        environment: { CODEX_API_KEY: 'codex-token' },
        executedFile: codexFile,
        skippedLine: `smoke ledger: ${claudeFile} [credentialed:claude] skipped (unmet: CLAUDE_CODE_OAUTH_TOKEN)`,
      },
    ]) {
      const runVitest = vi.fn(async () => ({ executedAssertions: true, output: '' }));
      const emit = vi.fn();

      await expect(runSmokeCli('vitest.smoke.config.ts', {
        discover: async () => providerLegs,
        runVitest,
        mode: 'gate',
        hasCommand: () => true,
        environment,
        emit,
      })).resolves.toBeUndefined();

      expect(runVitest).toHaveBeenCalledTimes(1);
      expect(runVitest).toHaveBeenCalledWith(executedFile);
      expect(emit).toHaveBeenCalledWith(skippedLine);
    }

    const runVitest = vi.fn(async (file: string) => {
      if (file === claudeFile) throw new Error('Claude leg failed');
      return { executedAssertions: true, output: '' };
    });
    const emit = vi.fn();

    await expect(runSmokeCli('vitest.smoke.config.ts', {
      discover: async () => providerLegs,
      runVitest,
      mode: 'gate',
      hasCommand: () => true,
      environment: { CLAUDE_CODE_OAUTH_TOKEN: 'claude-token', CODEX_API_KEY: 'codex-token' },
      emit,
    })).rejects.toThrow('Claude leg failed');

    expect(runVitest).toHaveBeenCalledWith(codexFile);
    expect(emit.mock.calls).toEqual(expect.arrayContaining([
      [`smoke ledger: ${claudeFile} [credentialed:claude] failed (evidence: Vitest output for ${claudeFile})`],
      [`smoke ledger: ${codexFile} [credentialed:codex] ran`],
    ]));
  });

  it(
    'executes both hermetic smoke files through real discovery and child-process dispatch',
    async () => {
      const ledger: string[] = [];
      const fixtureDir = await mkdtemp(join(tmpdir(), 'ai-conductor-task21-smoke-'));
      const fixtureFiles = ['first.smoke.test.ts', 'second.smoke.test.ts']
        .map((name) => join(fixtureDir, name));
      const config = join(fixtureDir, 'vitest.config.ts');

      try {
        await Promise.all(fixtureFiles.map((file) => writeFile(file, [
          "import { expect, it } from 'vitest';",
          "const smokeCapability = 'hermetic';",
          "it('executes', () => expect(true).toBe(true));",
        ].join('\n'))));
        await writeFile(config, [
          "import { tmpdir } from 'node:os';",
          `import { defineConfig } from ${JSON.stringify(join(conductorRoot, 'node_modules/vitest/dist/config.js'))};`,
          `import { ensureRunTmpRootSync } from ${JSON.stringify(join(conductorRoot, 'test/tmpdir-leak-guard.js'))};`,
          '',
          'ensureRunTmpRootSync(tmpdir());',
          'export default defineConfig({ test: {',
          `  include: ${JSON.stringify(fixtureFiles)},`,
          '  exclude: [],',
          "  environment: 'node',",
          `  setupFiles: [${JSON.stringify(join(conductorRoot, 'test/setup.ts'))}],`,
          `  globalSetup: [${JSON.stringify(join(conductorRoot, 'test/global-setup.ts'))}],`,
          "  pool: 'forks',",
          "  poolOptions: { forks: { maxForks: 1, minForks: 1 } },",
          '} });',
        ].join('\n'));

        await runSmokeCli(config, {
          mode: 'advisory',
          environment: {},
          emit: (line) => ledger.push(line),
        });

        expect(ledger.filter((line) => line.endsWith('[hermetic] ran'))).toEqual(
          fixtureFiles.map((file) => `smoke ledger: ${relative(conductorRoot, file)} [hermetic] ran`),
        );
      } finally {
        await rm(config, { force: true });
        await rm(fixtureDir, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it(
    'ledgers a provider-leg child with only skipped assertions as skipped and rejects it in gate mode',
    async () => {
      const ledger: string[] = [];
      const fixtureDir = await mkdtemp(join(tmpdir(), 'ai-conductor-skipped-smoke-'));
      const fixtureFile = join(fixtureDir, 'credentialed-claude.smoke.test.ts');
      const config = join(fixtureDir, 'vitest.config.ts');
      const vitestEntry = join(conductorRoot, 'node_modules/vitest/dist/index.js');

      try {
        await writeFile(fixtureFile, [
          `import { it } from ${JSON.stringify(vitestEntry)};`,
          "const smokeCapability = 'credentialed:claude';",
          "it.skip('has no executable assertion', () => {});",
        ].join('\n'));
        await writeFile(config, [
          `import { defineConfig } from ${JSON.stringify(join(conductorRoot, 'node_modules/vitest/dist/config.js'))};`,
          '',
          'export default defineConfig({ test: {',
          `  include: [${JSON.stringify(fixtureFile)}],`,
          '  exclude: [],',
          "  environment: 'node',",
          "  pool: 'forks',",
          "  poolOptions: { forks: { maxForks: 1, minForks: 1 } },",
          '} });',
        ].join('\n'));

        await runSmokeCli(config, {
          mode: 'advisory',
          environment: { CLAUDE_CODE_OAUTH_TOKEN: 'test-token' },
          emit: (line) => ledger.push(line),
        });

        await expect(runSmokeCli(config, {
          mode: 'gate',
          environment: { CLAUDE_CODE_OAUTH_TOKEN: 'test-token' },
          hasCommand: () => true,
        })).rejects.toThrow('Gate-mode smoke run executed no credentialed test files');

        expect(ledger, ledger.join('\n')).toContain(
          `smoke ledger: ${relative(conductorRoot, fixtureFile)} [credentialed:claude] skipped (unmet: no Vitest assertions executed)`,
        );
      } finally {
        await rm(fixtureDir, { recursive: true, force: true });
      }
    },
    60_000,
  );

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
        'test/engine/daemon-e2e-live-claude.smoke.test.ts',
        'test/engine/daemon-e2e-live-codex.smoke.test.ts',
        'test/engine/daemon-tmux.smoke.test.ts',
        'test/execution/claude-provider.smoke.test.ts',
        'test/execution/codex-provider.smoke.test.ts',
        'test/smoke/claude-subagent-stream.smoke.test.ts',
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
          `(?:export\\s+)?const\\s+smokeCapability\\s*=\\s*['\"]${smokeCapabilities[file]}['\"]`,
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
