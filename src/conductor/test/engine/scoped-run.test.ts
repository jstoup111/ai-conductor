import { describe, expect, it, vi } from 'vitest';
import { runScopedCommand, type ScopedRunRunner } from '../../src/engine/scoped-run.js';

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
    );
    expect(exitCode).toBe(7);
  });
});
