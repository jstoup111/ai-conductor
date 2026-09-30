import { describe, expect, it } from 'vitest';
import { isSpecSlug, slugify } from '../../../src/engine/engineer/spec-branch.js';

const ISSUE_1354_IDEA = 'engine-owned destructive-git prevention is absent in self-host';
const EXACTLY_FIFTY_CHARACTERS = 'a'.repeat(50);

describe('engineer/spec-branch', () => {
  describe('isSpecSlug', () => {
    it.each([
      ['single word', 'hello-world', true],
      ['hyphenated words', 'compose-handoff', true],
      ['one trailing hyphen', 'self-host-', true],
      ['exactly fifty characters', EXACTLY_FIFTY_CHARACTERS, true],
      ['empty string', '', false],
      ['uppercase character', 'Compose-handoff', false],
      ['leading hyphen', '-compose-handoff', false],
      ['double hyphen', 'compose--handoff', false],
      ['two trailing hyphens', 'compose--', false],
      ['slash', 'compose/handoff', false],
      ['fifty-one characters', 'a'.repeat(51), false],
    ])('accepts %s according to the spec slug grammar', (_fixture, slug, expected) => {
      expect(isSpecSlug(slug)).toBe(expected);
    });
  });

  it('keeps fixed generator outputs byte-identical and within the spec slug grammar', () => {
    const ideasAndExpectedSlugs = [
      [ISSUE_1354_IDEA, 'engine-owned-destructive-git-prevention-is-absent-'],
      [EXACTLY_FIFTY_CHARACTERS, EXACTLY_FIFTY_CHARACTERS],
      ['Compose handoff', 'compose-handoff'],
      ['Hello, world!', 'hello-world'],
    ] as const;

    for (const [idea, expectedSlug] of ideasAndExpectedSlugs) {
      const slug = slugify(idea);
      expect(slug).toBe(expectedSlug);
      expect(isSpecSlug(slug)).toBe(true);
    }

    expect(slugify(ISSUE_1354_IDEA).endsWith('-')).toBe(true);
  });
});
