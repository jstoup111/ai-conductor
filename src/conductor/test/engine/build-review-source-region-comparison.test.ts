// Covers: task:3
import { describe, expect, it } from 'vitest';

import {
  compareBuildReviewCitedSourceRegions,
  hashBuildReviewFrozenSourceLines,
  type BuildReviewFrozenSourceReader,
} from '../../src/engine/build-review-source-region-admission.js';

const source = 'one\ntwo\nthree\nfour\nfive\n';
const changes = [{ path: 'src/a.ts', kind: 'M' }] as const;
const matchingHash = hashBuildReviewFrozenSourceLines(source, 1, 2)!;
const secondMatchingHash = hashBuildReviewFrozenSourceLines(source, 3, 4)!;

function readerFor(value = source): BuildReviewFrozenSourceReader {
  return {
    async read(side, path) {
      expect(side).toBe('head');
      expect(path).toBe('src/a.ts');
      return { kind: 'present', value };
    },
  };
}

function payload(...sourceRegions: readonly unknown[]): unknown {
  return { kind: 'custom-findings', findings: [{ sourceRegions }] };
}

describe('build-review cited source-region comparison', () => {
  it('compares cited head regions in citation order without stopping after a mismatch', async () => {
    const result = await compareBuildReviewCitedSourceRegions(payload(
      { path: 'src/a.ts', startLine: 1, endLine: 2, contentHash: matchingHash },
      { path: 'src/a.ts', startLine: 3, endLine: 4, contentHash: `sha256:${'0'.repeat(64)}` },
    ), changes, readerFor());

    expect(result).toEqual([
      {
        finding: 0, region: 0, path: 'src/a.ts', startLine: 1, endLine: 2,
        citedContentHash: matchingHash, side: 'head', status: 'match', frozenContentHash: matchingHash, frozenLineCount: 5,
      },
      {
        finding: 0, region: 1, path: 'src/a.ts', startLine: 3, endLine: 4,
        citedContentHash: `sha256:${'0'.repeat(64)}`, side: 'head', status: 'content-hash-mismatch', frozenContentHash: secondMatchingHash, frozenLineCount: 5,
      },
    ]);
  });

  it('classifies a citation outside the frozen changed input', async () => {
    const result = await compareBuildReviewCitedSourceRegions(payload(
      { path: 'src/other.ts', startLine: 1, endLine: 1, contentHash: matchingHash },
    ), changes, readerFor());

    expect(result).toEqual([{
      finding: 0, region: 0, path: 'src/other.ts', startLine: 1, endLine: 1,
      citedContentHash: matchingHash, status: 'outside-changed-input',
    }]);
  });

  it('reports a cited range past the frozen blob end', async () => {
    const result = await compareBuildReviewCitedSourceRegions(payload(
      { path: 'src/a.ts', startLine: 4, endLine: 9, contentHash: matchingHash },
    ), changes, readerFor());

    expect(result).toEqual([{
      finding: 0, region: 0, path: 'src/a.ts', startLine: 4, endLine: 9,
      citedContentHash: matchingHash, side: 'head', status: 'range-outside-blob', frozenLineCount: 5,
    }]);
  });

  it('reports a frozen source reader failure', async () => {
    const reader: BuildReviewFrozenSourceReader = { read: async () => { throw new Error('unavailable'); } };
    const result = await compareBuildReviewCitedSourceRegions(payload(
      { path: 'src/a.ts', startLine: 1, endLine: 2, contentHash: matchingHash },
    ), changes, reader);

    expect(result).toEqual([{
      finding: 0, region: 0, path: 'src/a.ts', startLine: 1, endLine: 2,
      citedContentHash: matchingHash, side: 'head', status: 'frozen-blob-unavailable',
    }]);
  });

  it('ignores malformed payload roots and regions', async () => {
    await expect(compareBuildReviewCitedSourceRegions(null, changes, readerFor())).resolves.toEqual([]);
    await expect(compareBuildReviewCitedSourceRegions({ kind: 'custom-findings', findings: 'not-an-array' }, changes, readerFor())).resolves.toEqual([]);
    await expect(compareBuildReviewCitedSourceRegions(payload(
      { path: 'src/a.ts', startLine: 1.5, endLine: 2 },
      { path: 'src/a.ts', startLine: 1, endLine: '2' },
    ), changes, readerFor())).resolves.toEqual([]);
  });

  it('continues comparing after a failing citation', async () => {
    const result = await compareBuildReviewCitedSourceRegions(payload(
      { path: 'src/other.ts', startLine: 1, endLine: 1 },
      { path: 'src/a.ts', startLine: 3, endLine: 4, contentHash: secondMatchingHash },
    ), changes, readerFor());

    expect(result.map(({ status }) => status)).toEqual(['outside-changed-input', 'match']);
  });
});
