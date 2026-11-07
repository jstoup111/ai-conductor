// Covers: task:7
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { readDecisionCorpus } from '../../src/engine/decision-corpus.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const CANONICAL_RECORD_PREFIX = /^(?:adr-|architecture-review-|review-|technical-assessment-)/;

describe('repository decision corpus', () => {
  // Covers: task:7
  it('contains no retired founding record or unclassified canonical records', async () => {
    const corpus = await readDecisionCorpus(repositoryRoot);

    expect(corpus.rows.some((row) => basename(row.path) === '001-harness-architecture.md')).toBe(false);
    expect(corpus.rows.filter((row) => CANONICAL_RECORD_PREFIX.test(basename(row.path)) && row.kind === 'unclassified')).toEqual([]);
    expect(corpus.errors).toEqual([]);
  });
});
