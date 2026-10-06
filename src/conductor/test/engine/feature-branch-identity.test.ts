// Covers: task:3
import { describe, expect, it } from 'vitest';
import {
  INTERACTIVE_PREFIX,
  LEAF_PREFIX,
  SPEC_PREFIX,
  childBranchFor,
  leafBranchFor,
  parseFeatureBranch,
} from '../../src/engine/feature-branch-identity.js';

describe('feature-branch prefixes', () => {
  it('exposes the exact prefixes', () => {
    expect(LEAF_PREFIX).toBe('feat/daemon-');
    expect(SPEC_PREFIX).toBe('spec/');
    expect(INTERACTIVE_PREFIX).toBe('feature/');
  });
});

describe('parseFeatureBranch happy paths', () => {
  const cases = [
    { raw: 'feat/daemon-x', expected: { kind: 'leaf', slug: 'x' } as const },
    { raw: 'feat/daemon-c1', expected: { kind: 'leaf', slug: 'c1' } as const },
    { raw: 'feat/daemon-a/b', expected: { kind: 'leaf', slug: 'a/b' } as const },
    { raw: 'feat/c2/x', expected: { kind: 'child', slug: 'x', child: 2 } as const },
    {
      raw: 'feat/c9/engine-cannot-represent-more-than-one-branch-step-',
      expected: { kind: 'child', slug: 'engine-cannot-represent-more-than-one-branch-step-', child: 9 } as const,
    },
    { raw: 'spec/x', expected: { kind: 'spec', slug: 'x' } as const },
    { raw: 'feature/x', expected: { kind: 'interactive', slug: 'x' } as const },
  ] as const;

  for (const { raw, expected } of cases) {
    it(`parses ${raw} as ${expected.kind}`, () => {
      expect(parseFeatureBranch(raw)).toEqual(expected);
    });
  }
});

describe('parseFeatureBranch unrecognized', () => {
  const invalidChildId = [
    { raw: 'feat/c0/x', reason: 'invalid child id "0"' },
    { raw: 'feat/c10/x', reason: 'invalid child id "10"' },
    { raw: 'feat/c01/x', reason: 'invalid child id' },
    { raw: 'feat/cool/x', reason: 'invalid child id' },
  ] as const;

  for (const { raw, reason } of invalidChildId) {
    it(`names an invalid child id for ${raw}`, () => {
      expect(parseFeatureBranch(raw)).toEqual({ kind: 'unrecognized', raw, reason });
    });
  }

  const missingSlug = ['feat/c1', 'feat/c1/'] as const;
  for (const raw of missingSlug) {
    it(`names a missing slug for ${raw}`, () => {
      expect(parseFeatureBranch(raw)).toEqual({ kind: 'unrecognized', raw, reason: 'missing slug' });
    });
  }

  it('names a multi-segment slug for feat/c1/a/b', () => {
    expect(parseFeatureBranch('feat/c1/a/b')).toEqual({
      kind: 'unrecognized',
      raw: 'feat/c1/a/b',
      reason: 'multi-segment slug',
    });
  });

  const emptySlug = ['feat/daemon-', 'spec/', 'feature/'] as const;
  for (const raw of emptySlug) {
    it(`names an empty slug for ${JSON.stringify(raw)}`, () => {
      expect(parseFeatureBranch(raw)).toEqual({ kind: 'unrecognized', raw, reason: 'empty slug' });
    });
  }

  const others = ['refs/heads/feat/c1/x', 'origin/feat/c1/x', 'main'] as const;
  for (const raw of others) {
    it(`reports unrecognized for ${raw}`, () => {
      expect(parseFeatureBranch(raw)).toEqual({ kind: 'unrecognized', raw, reason: 'unrecognized' });
    });
  }
});

describe('leafBranchFor', () => {
  const cases = [
    ['x', 'feat/daemon-x'],
    ['a/b', 'feat/daemon-a/b'],
    ['trailing-', 'feat/daemon-trailing-'],
  ] as const;

  for (const [slug, expected] of cases) {
    it(`templates ${JSON.stringify(slug)} unchanged`, () => {
      expect(leafBranchFor(slug)).toBe(expected);
    });
  }
});

describe('childBranchFor', () => {
  it('builds a canonical child branch for a valid child id and slug', () => {
    expect(childBranchFor('x', 3)).toEqual({ ok: true, branch: 'feat/c3/x' });
  });

  const invalidChildIds = [0, 10] as const;
  for (const child of invalidChildIds) {
    it(`rejects invalid child id ${child} with no branch`, () => {
      const result = childBranchFor('x', child);
      expect(result).toEqual({ ok: false, reason: `invalid child id "${child}"` });
      expect(result).not.toHaveProperty('branch');
    });
  }

  const invalidSlugs = ['a/b', ''] as const;
  for (const slug of invalidSlugs) {
    it(`rejects invalid slug ${JSON.stringify(slug)} with no branch`, () => {
      const result = childBranchFor(slug, 1);
      expect(result).toEqual({ ok: false, reason: `invalid slug "${slug}"` });
      expect(result).not.toHaveProperty('branch');
    });
  }
});