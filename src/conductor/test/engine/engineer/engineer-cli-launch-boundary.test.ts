import { describe, expect, it } from 'vitest';
import { resolveBoundaryProvider } from '../../../src/engine/engineer/launch-boundary.js';

describe('Composer launcher boundary', () => {
  it('Covers: Task 17 continues, switches only to an interactive provider, and refuses local-only handoff', () => {
    expect(resolveBoundaryProvider({ choice: 'continue', activeProvider: 'claude', hasRemote: true })).toEqual({ action: 'resume', provider: 'claude' });
    expect(resolveBoundaryProvider({ choice: 'switch', activeProvider: 'claude', switchTo: 'codex', hasRemote: true })).toEqual({ action: 'resume', provider: 'codex' });
    expect(() => resolveBoundaryProvider({ choice: 'handoff', activeProvider: 'codex', hasRemote: false })).toThrow(/only locally/);
  });
});
