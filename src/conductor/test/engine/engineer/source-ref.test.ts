import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatWorkRef, parseWorkRef, splitOwnerRepo } from '../../../src/engine/engineer/source-ref.js';

const execFile = promisify(execFileCb);
const CONDUCTOR_SRC = resolve(__dirname, '../../../src');

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

describe('formatWorkRef — round-trip identity', () => {
  it.each(['acme/app#49', 'owner/repo#1', 'a/b/c#123', 'PROJ-123', 'AB2C-7'])(
    'formats then re-parses to an equivalent WorkRef for %s',
    (sourceRef) => {
      const ref = parseWorkRef(sourceRef);
      expect(ref).not.toBeNull();
      expect(formatWorkRef(ref!)).toBe(sourceRef);
      expect(parseWorkRef(formatWorkRef(ref!))).toEqual(ref);
    },
  );

  it('does not trim whitespace when parsing (negative path)', () => {
    expect(parseWorkRef(' PROJ-123 ')).toBeNull();
  });

  it('throws for a malformed WorkRef that would not re-parse', () => {
    expect(() => formatWorkRef({ kind: 'github', repo: '', number: '' })).toThrow();
  });
});

describe('splitOwnerRepo — split an owner/repo slug', () => {
  it('splits a well-formed slug', () => {
    expect(splitOwnerRepo('acme/app')).toEqual({ owner: 'acme', repo: 'app' });
  });

  it.each([
    ['no slash', 'acmeapp'],
    ['leading slash (empty owner)', '/app'],
    ['trailing slash (empty repo)', 'acme/'],
    ['empty string', ''],
    ['multiple slashes', 'a/b/c'],
  ])('returns null for %s (%j)', (_label, input) => {
    expect(splitOwnerRepo(input)).toBeNull();
  });
});

describe('grammar sweep — no competing owner/repo#N or #N regex outside source-ref.ts', () => {
  it('finds the ref-splitting grammar only in source-ref.ts, plus two documented, unrelated exceptions', async () => {
    // pr-labels.ts owns an independent URL-based parser (github.com/.../pull/N),
    // never delegated to source-ref.ts by design (different input shape: a PR
    // URL, not a bare sourceRef). wired-into.ts's ISSUE_REF parses a DIFFERENT
    // domain entirely — plan/story authoring annotations ("Wired-into: owner/repo#N")
    // — not a runtime sourceRef value, so it is not a competing grammar for the
    // same concern.
    const { stdout } = await execFile(
      'grep',
      ['-rlE', "lastIndexOf\\('#'\\)|#\\(\\\\d\\+\\)\\$", CONDUCTOR_SRC],
    ).catch((e) => e as { stdout: string });

    const files = stdout
      .split('\n')
      .filter(Boolean)
      .filter((f) => !f.includes('/test/'))
      .map((f) => f.replace(`${CONDUCTOR_SRC}/`, ''))
      .sort();

    expect(files).toEqual(['engine/engineer/source-ref.ts', 'engine/wired-into.ts']);
  });
});
