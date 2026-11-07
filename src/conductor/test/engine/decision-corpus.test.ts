// Covers: task:1
import { describe, expect, it } from 'vitest';

import { classifyKind, matchesKnownShape } from '../../src/engine/decision-corpus.js';

describe('decision corpus known shapes', () => {
  it('recognizes every known filename shape', () => {
    expect([
      matchesKnownShape('adr-2026-01-01-x.md'),
      matchesKnownShape('architecture-review-2026-01-01-x.md'),
      matchesKnownShape('review-x.md'),
      matchesKnownShape('technical-assessment-2026-01-01.md'),
      matchesKnownShape('api-response-contract.md'),
      matchesKnownShape('styleguide.md'),
    ]).toEqual([true, true, true, true, true, true]);
  });

  it('classifies filename shapes before falling back to status-bearing content', () => {
    expect([
      classifyKind('adr-2026-01-01-x.md', '# Untitled'),
      classifyKind('architecture-review-2026-01-01-x.md', '**Status:** APPROVED'),
      classifyKind('review-x.md', '# Untitled'),
      classifyKind('technical-assessment-2026-01-01.md', '**Verdict:** APPROVED'),
      classifyKind('adr-2026-01-01-x.md', '**Verdict:** APPROVED'),
      classifyKind('review-x.md', '**Status:** APPROVED'),
      classifyKind('api-response-contract.md', '**Status:** APPROVED'),
      classifyKind('styleguide.md', '**Verdict:** APPROVED'),
      classifyKind('notes.md', '**Status:** APPROVED'),
      classifyKind('notes.md', '**Verdict:** APPROVED'),
    ]).toEqual([
      'decision',
      'review',
      'review',
      'assessment',
      'decision',
      'review',
      'reference',
      'reference',
      'decision',
      'review',
    ]);
  });
});
