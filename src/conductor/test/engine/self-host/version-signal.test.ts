import { describe, it, expect } from 'vitest';
import { PATCH_SAFE_GLOBS, classifyVersionSignal } from '../../../src/engine/self-host/version-signal.js';

// Task 4: classifier module + allow-list constant
//
// Test the core classifier skeleton: types, PATCH_SAFE_GLOBS constant, and
// fail-closed null/empty handling. Later tasks build out the MAJOR/MINOR/PATCH signals.

describe('PATCH_SAFE_GLOBS (TR-2 PATCH allow-list)', () => {
  it('exports an exact set of patch-safe glob patterns', () => {
    // The allow-list is the single source of truth for patch-safe paths.
    // This test asserts the exact contents so layout drift breaks loudly.
    expect(PATCH_SAFE_GLOBS).toEqual([
      'README.md',
      '.docs/**',
      'test/**',
      'src/conductor/src/**',
    ]);
  });
});

describe('classifyVersionSignal (TR-2 core)', () => {
  it('empty change set → undeterminable (fail-closed)', () => {
    const result = classifyVersionSignal([]);
    expect(result.level).toBe('halt-undeterminable');
  });

  it('null change set → undeterminable (fail-closed)', () => {
    const result = classifyVersionSignal(null);
    expect(result.level).toBe('halt-undeterminable');
  });
});
