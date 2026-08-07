import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
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

  it('registers the scoped-run detector and dispatcher before normal pipeline parsing', async () => {
    const source = await readFile(new URL('../../src/index.ts', import.meta.url), 'utf8');

    expect(source).toMatch(/from ['"]\.\/engine\/scoped-run-cli\.js['"]/);
    expect(source).toMatch(/detectScopedRunCommand\(process\.argv\)/);
    expect(source).toMatch(/dispatchScopedRunCommand\(scopedRunCmd, \{\s*projectRoot: process\.cwd\(\),?\s*\}\)/);
  });
});
