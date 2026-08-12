import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScopedRunRunner } from '../../src/engine/scoped-run.js';

describe('scoped-run CLI adapter', () => {
  it('detects scoped-run, forwards selectors to the scoped runner, and returns its exit code', async () => {
    const cli = await import('../../src/engine/scoped-run-cli.js');
    const runner = vi.fn<ScopedRunRunner>(async () => 7);
    const command = cli.detectScopedRunCommand([
      'node',
      'conduct-ts',
      'scoped-run',
      'test/one.test.ts',
      'test/two.test.ts',
    ]);

    expect(command).toEqual({
      kind: 'run',
      selectors: ['test/one.test.ts', 'test/two.test.ts'],
    });

    const exitCode = await cli.dispatchScopedRunCommand(command!, {
      template: 'npx vitest run {selectors}',
      runner,
    });

    expect({ exitCode, calls: runner.mock.calls }).toEqual({
      exitCode: 7,
      calls: [[
        'npx vitest run test/one.test.ts test/two.test.ts',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ]],
    });
  });

  it('does not treat test-suite as an alias', async () => {
    const cli = await import('../../src/engine/scoped-run-cli.js');

    expect(cli.detectScopedRunCommand(['node', 'conduct-ts', 'test-suite'])).toBeNull();
  });

  it('reports a missing project configuration without throwing', async () => {
    const cli = await import('../../src/engine/scoped-run-cli.js');
    const projectRoot = await mkdtemp(join(tmpdir(), 'scoped-run-missing-config-'));
    const printed: string[] = [];

    try {
      const exitCode = await cli.dispatchScopedRunCommand(
        { kind: 'run', selectors: ['test/selected.test.ts'] },
        { projectRoot, print: (message) => printed.push(message) },
      );

      expect({ exitCode, printed }).toEqual({
        exitCode: 1,
        printed: [expect.stringMatching(/config file not found/i)],
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('runs a scoped-only test_suite configuration without aggregate fields', async () => {
    const cli = await import('../../src/engine/scoped-run-cli.js');
    const runner = vi.fn<ScopedRunRunner>(async () => 0);

    const exitCode = await cli.dispatchScopedRunCommand(
      { kind: 'run', selectors: ['test/selected.test.ts'] },
      {
        loadProjectConfig: async () => ({
          ok: true,
          config: { test_suite: { scoped_command: 'npx vitest run {selectors}' } },
          warnings: [],
        }),
        runner,
      },
    );

    expect({ exitCode, calls: runner.mock.calls }).toEqual({
      exitCode: 0,
      calls: [[
        'npx vitest run test/selected.test.ts',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ]],
    });
  });

  it('runs the scoped command in test_suite.working_directory and rebases project-root selectors onto it', async () => {
    const cli = await import('../../src/engine/scoped-run-cli.js');
    const runner = vi.fn<ScopedRunRunner>(async () => 0);

    const exitCode = await cli.dispatchScopedRunCommand(
      { kind: 'run', selectors: ['src/conductor/test/selected.test.ts'] },
      {
        projectRoot: '/repo',
        loadProjectConfig: async () => ({
          ok: true,
          config: {
            test_suite: {
              scoped_command: 'npx vitest run {selectors}',
              working_directory: 'src/conductor',
            },
          },
          warnings: [],
        }),
        fileExists: (path) => path === '/repo/src/conductor/test/selected.test.ts',
        runner,
      },
    );

    expect({ exitCode, calls: runner.mock.calls }).toEqual({
      exitCode: 0,
      calls: [[
        'npx vitest run test/selected.test.ts',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
          cwd: '/repo/src/conductor',
        }),
      ]],
    });
  });

  it('leaves a selector already relative to the working directory unchanged', async () => {
    const cli = await import('../../src/engine/scoped-run-cli.js');
    const runner = vi.fn<ScopedRunRunner>(async () => 0);

    const exitCode = await cli.dispatchScopedRunCommand(
      { kind: 'run', selectors: ['test/selected.test.ts', '--reporter=dot'] },
      {
        projectRoot: '/repo',
        loadProjectConfig: async () => ({
          ok: true,
          config: {
            test_suite: {
              scoped_command: 'npx vitest run {selectors}',
              working_directory: 'src/conductor',
            },
          },
          warnings: [],
        }),
        fileExists: (path) => path === '/repo/src/conductor/test/selected.test.ts',
        runner,
      },
    );

    expect({ exitCode, calls: runner.mock.calls }).toEqual({
      exitCode: 0,
      calls: [[
        'npx vitest run test/selected.test.ts --reporter=dot',
        expect.objectContaining({ cwd: '/repo/src/conductor' }),
      ]],
    });
  });

  it('registers the scoped-run detector and dispatcher before normal pipeline parsing', async () => {
    const source = await readFile(new URL('../../src/index.ts', import.meta.url), 'utf8');

    expect(source).toMatch(/from ['"]\.\/engine\/scoped-run-cli\.js['"]/);
    expect(source).toMatch(/detectScopedRunCommand\(process\.argv\)/);
    expect(source).toMatch(/dispatchScopedRunCommand\(scopedRunCmd, \{\s*projectRoot: process\.cwd\(\),?\s*\}\)/);
  });
});
