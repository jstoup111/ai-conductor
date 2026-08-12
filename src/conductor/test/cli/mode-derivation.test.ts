import { describe, it, expect, vi, afterEach } from 'vitest';
import { deriveMode } from '../../src/index.js';

describe('RunMode derivation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns default when neither --auto nor --interactive is set', () => {
    const mode = deriveMode({ auto: false, interactive: false });
    expect(mode).toBe('default');
  });

  it('rejects --auto with a deprecation notice directing the operator to the daemon', () => {
    const exitSentinel = new Error('process.exit called');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw exitSentinel;
    });

    let thrown: unknown;
    try {
      deriveMode({ auto: true, interactive: false });
    } catch (error) {
      thrown = error;
    }

    expect({
      thrown,
      exitCode: exitSpy.mock.calls[0]?.[0],
      notice: errorSpy.mock.calls[0]?.[0],
    }).toEqual({
      thrown: exitSentinel,
      exitCode: 1,
      notice: expect.stringMatching(/--auto.*deprecated.*conduct-ts daemon start/i),
    });
  });

  it('returns interactive when --interactive is set', () => {
    const mode = deriveMode({ auto: false, interactive: true });
    expect(mode).toBe('interactive');
  });

  it('exits non-zero with error message when both --auto and --interactive are set', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => {
      throw new Error('process.exit called');
    });

    expect(() => deriveMode({ auto: true, interactive: true })).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);

    const errorMsg = errorSpy.mock.calls[0]?.[0] as string;
    expect(errorMsg).toMatch(/--auto/);
    expect(errorMsg).toMatch(/--interactive/);
    expect(errorMsg).toMatch(/mutually exclusive/);
  });
});
