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

  it('returns auto when --auto is set', () => {
    const mode = deriveMode({ auto: true, interactive: false });
    expect(mode).toBe('auto');
  });

  it('returns interactive when --interactive is set', () => {
    const mode = deriveMode({ auto: false, interactive: true });
    expect(mode).toBe('interactive');
  });

  it('exits non-zero with error message when both --auto and --interactive are set', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
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
