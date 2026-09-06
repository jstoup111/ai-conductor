import { describe, expect, it, vi } from 'vitest';
import { dispatchEngineer } from '../../../src/engine/engineer-cli.js';

describe('dispatchEngineer — gh version floor', () => {
  it('refuses before the interactive DECIDE entry can mutate or launch', async () => {
    const printErr = vi.fn();
    const launchInteractive = vi.fn(async () => 0);

    const code = await dispatchEngineer(
      { kind: 'launch' },
      {
        launchInteractive,
        printErr,
        probeGhVersion: async () => ({ kind: 'below-floor', version: { major: 2, minor: 14, patch: 1 } }),
      },
    );

    expect(code).toBe(1);
    expect(launchInteractive).not.toHaveBeenCalled();
    expect(printErr).toHaveBeenCalledWith(expect.stringContaining('gh 2.14.1'));
    expect(printErr).toHaveBeenCalledWith(expect.stringContaining('2.73.0'));
  });

  it('names an absent binary distinctly and lets a supported CLI reach normal entry', async () => {
    const absent = vi.fn();
    await expect(dispatchEngineer({ kind: 'launch' }, {
      printErr: absent,
      launchInteractive: async () => 0,
      probeGhVersion: async () => ({ kind: 'absent' }),
    })).resolves.toBe(1);
    expect(absent).toHaveBeenCalledWith(expect.stringContaining('not installed'));

    const launchInteractive = vi.fn(async () => 0);
    await expect(dispatchEngineer({ kind: 'launch' }, {
      launchInteractive,
      confirmAnother: () => false,
      probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
    })).resolves.toBe(0);
    expect(launchInteractive).toHaveBeenCalledOnce();
  });
});
