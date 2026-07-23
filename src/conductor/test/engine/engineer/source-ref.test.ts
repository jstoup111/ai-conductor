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

describe('parseWorkRef — Jira grammar', () => {
  it.each([
    ['PROJ-123'],
    ['AB2C-7'],
  ])('parses a well-formed Jira key %s', (input) => {
    expect(parseWorkRef(input)).toEqual({ kind: 'jira', key: input });
  });

  it.each([
    ['lowercase project key', 'proj-123'],
    ['single-char project key', 'P-1'],
    ['missing number', 'PROJ-'],
    ['non-digit suffix', 'PROJ-12a'],
  ])('returns null for %s (%j)', (_label, input) => {
    expect(parseWorkRef(input)).toBeNull();
  });

  it.each([
    ['github-style ref with slash and hash', 'A/B#1-2'],
    ['ref containing a hash', 'PROJ-123#extra'],
  ])('never yields kind "jira" for %s (%j)', (_label, input) => {
    expect(parseWorkRef(input)?.kind).not.toBe('jira');
  });
});
