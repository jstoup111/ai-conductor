// Covers: task:1
import { describe, expect, it } from 'vitest';
import { classifyConflictScope } from '../../src/engine/autoresolve.js';

describe('engine/autoresolve — conflict scope classification', () => {
  it('returns test-only only for a nonempty conflict list of test paths', () => {
    expect(classifyConflictScope(['src/widget.test.ts', 'test/engine/widget.ts'])).toBe('test-only');
    expect(classifyConflictScope([])).toBe('mixed');
    expect(classifyConflictScope(['src/widget.test.ts', 'src/widget.ts'])).toBe('mixed');
  });
});
