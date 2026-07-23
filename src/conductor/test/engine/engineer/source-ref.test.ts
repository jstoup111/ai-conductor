import { describe, expect, it } from 'vitest';
import { parseWorkRef } from '../../../src/engine/engineer/source-ref.js';

describe('parseWorkRef — GitHub grammar', () => {
  it('parses a well-formed owner/repo#N ref', () => {
    expect(parseWorkRef('acme/app#49')).toEqual({ kind: 'github', repo: 'acme/app', number: '49' });
  });

  it.each([
    ['trailing hash with no number', 'acme/app#'],
    ['hash at position zero (no repo segment)', '#49'],
    ['non-digit number', 'acme/app#4x'],
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
  ])('returns null for %s (%j)', (_label, input) => {
    expect(parseWorkRef(input as string | null | undefined)).toBeNull();
  });
});
