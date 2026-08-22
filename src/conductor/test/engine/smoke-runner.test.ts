import { describe, expect, it, vi } from 'vitest';

import { discoverSmokeFiles, runSmokeCli, runSmokeCommand } from '../../src/engine/smoke-runner.js';

describe('discoverSmokeFiles', () => {
  it('isolates discovery, then restores the caller environment and cleans up after success', async () => {
    const close = vi.fn(async () => {});
    const remove = vi.fn(async () => {});
    const createVitest = vi.fn(async (_mode: 'test', _options: { config: string; root: string }) => {
      expect(process.env.AI_CONDUCTOR_TEST_TMP_ROOT).toBeUndefined();
      expect(process.env.TMPDIR).toBe('isolated-discovery-root');
      return {
      globTestSpecifications: async () => [],
      close,
      };
    });
    const previousRunRoot = process.env.AI_CONDUCTOR_TEST_TMP_ROOT;
    const previousTmpdir = process.env.TMPDIR;
    process.env.AI_CONDUCTOR_TEST_TMP_ROOT = 'parent-run-root';
    process.env.TMPDIR = 'parent-tmpdir';

    try {
      await expect(discoverSmokeFiles('vitest.smoke.config.ts', {
        createTempDir: async () => 'isolated-discovery-root',
        createVitest,
        remove,
      })).resolves.toEqual([]);

      expect(createVitest).toHaveBeenCalledWith('test', {
        config: expect.any(String),
        root: process.cwd(),
      });
      expect(process.env.AI_CONDUCTOR_TEST_TMP_ROOT).toBe('parent-run-root');
      expect(process.env.TMPDIR).toBe('parent-tmpdir');
      expect(close).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledWith('isolated-discovery-root', { recursive: true, force: true });
    } finally {
      if (previousRunRoot === undefined) delete process.env.AI_CONDUCTOR_TEST_TMP_ROOT;
      else process.env.AI_CONDUCTOR_TEST_TMP_ROOT = previousRunRoot;
      if (previousTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previousTmpdir;
    }
  });

  it('restores the caller environment, closes Vitest, and cleans up when discovery fails', async () => {
    const close = vi.fn(async () => {});
    const remove = vi.fn(async () => {});
    const previousRunRoot = process.env.AI_CONDUCTOR_TEST_TMP_ROOT;
    const previousTmpdir = process.env.TMPDIR;
    process.env.AI_CONDUCTOR_TEST_TMP_ROOT = 'parent-run-root';
    process.env.TMPDIR = 'parent-tmpdir';

    try {
      await expect(discoverSmokeFiles('vitest.smoke.config.ts', {
        createTempDir: async () => 'isolated-discovery-root',
        createVitest: async () => {
          expect(process.env.AI_CONDUCTOR_TEST_TMP_ROOT).toBeUndefined();
          expect(process.env.TMPDIR).toBe('isolated-discovery-root');
          return {
            globTestSpecifications: async () => { throw new Error('discovery failed'); },
            close,
          };
        },
        remove,
      })).rejects.toThrow('discovery failed');

      expect(process.env.AI_CONDUCTOR_TEST_TMP_ROOT).toBe('parent-run-root');
      expect(process.env.TMPDIR).toBe('parent-tmpdir');
      expect(close).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledWith('isolated-discovery-root', { recursive: true, force: true });
    } finally {
      if (previousRunRoot === undefined) delete process.env.AI_CONDUCTOR_TEST_TMP_ROOT;
      else process.env.AI_CONDUCTOR_TEST_TMP_ROOT = previousRunRoot;
      if (previousTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previousTmpdir;
    }
  });
});

describe('runSmokeCli selection', () => {
  it('maps the production CLI config and one matrix smoke file to the runner selection', async () => {
    const runner = vi.fn(async () => {});
    const selectedFile = 'test/engine/daemon-e2e-live-codex.smoke.test.ts';

    await runSmokeCommand(['vitest.smoke.config.ts', selectedFile], runner);

    expect(runner).toHaveBeenCalledWith('vitest.smoke.config.ts', { selectedFile });
  });

  it('discovers and validates all smoke files, then runs only the selected credentialed leg', async () => {
    const runVitest = vi.fn(async () => ({ executedAssertions: true, output: '' }));
    const claudeFile = 'test/engine/daemon-e2e-live-claude.smoke.test.ts';
    const codexFile = 'test/engine/daemon-e2e-live-codex.smoke.test.ts';

    await runSmokeCli('vitest.smoke.config.ts', {
      discover: async () => [
        { file: claudeFile, source: "const smokeCapability = 'credentialed:claude';" },
        { file: codexFile, source: "const smokeCapability = 'credentialed:codex';" },
      ],
      runVitest,
      mode: 'gate',
      hasCommand: () => true,
      environment: { CODEX_API_KEY: 'present' },
      selectedFile: codexFile,
    });

    expect(runVitest).toHaveBeenCalledOnce();
    expect(runVitest).toHaveBeenCalledWith(codexFile);
  });

  it('fails a credential-present selected gate leg when Vitest executes no assertions', async () => {
    const codexFile = 'test/engine/daemon-e2e-live-codex.smoke.test.ts';

    await expect(runSmokeCli('vitest.smoke.config.ts', {
      discover: async () => [
        { file: 'test/engine/daemon-e2e-live-claude.smoke.test.ts', source: "const smokeCapability = 'credentialed:claude';" },
        { file: codexFile, source: "const smokeCapability = 'credentialed:codex';" },
      ],
      runVitest: async () => ({ executedAssertions: false, output: '' }),
      mode: 'gate',
      hasCommand: () => true,
      environment: { CODEX_API_KEY: 'present' },
      selectedFile: codexFile,
    })).rejects.toThrow('Gate-mode smoke run executed no credentialed test files');
  });

  it('rejects a selected smoke file that discovery did not validate', async () => {
    await expect(runSmokeCli('vitest.smoke.config.ts', {
      discover: async () => [
        { file: 'test/smoke/finish-record.smoke.test.ts', source: "const smokeCapability = 'hermetic';" },
      ],
      runVitest: async () => ({ executedAssertions: true, output: '' }),
      selectedFile: 'test/engine/daemon-e2e-live-codex.smoke.test.ts',
    })).rejects.toThrow('Selected smoke file was not discovered: test/engine/daemon-e2e-live-codex.smoke.test.ts');
  });

  it('records a selected credential-absent leg as a non-gating skip without weakening full-tier enforcement', async () => {
    const emit = vi.fn();
    const codexFile = 'test/engine/daemon-e2e-live-codex.smoke.test.ts';

    await expect(runSmokeCli('vitest.smoke.config.ts', {
      discover: async () => [
        { file: 'test/engine/daemon-e2e-live-claude.smoke.test.ts', source: "const smokeCapability = 'credentialed:claude';" },
        { file: codexFile, source: "const smokeCapability = 'credentialed:codex';" },
      ],
      runVitest: vi.fn(),
      mode: 'gate',
      hasCommand: () => true,
      environment: {},
      emit,
      selectedFile: codexFile,
    })).resolves.toBeUndefined();

    expect(emit).toHaveBeenCalledWith(
      `smoke ledger: ${codexFile} [credentialed:codex] skipped (unmet: CODEX_API_KEY)`,
    );
  });
});
