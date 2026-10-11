import { createHash } from 'node:crypto';

import type { BuildReviewCandidateScopeSourceRegion } from './build-review-domain.js';
import type { BuildReviewOptionalSourceRead, BuildReviewPathChange } from './build-review-scope-source.js';

/**
 * The one hashing rule for a custom reviewer's source region: the inclusive
 * one-based lines, each terminated by a single LF.  It is independent of
 * whether the blob (or a transport) keeps its final newline, and a read-only
 * reviewer can reproduce it with `sed -n 'S,Ep' <path> | sha256sum`.
 */
export const BUILD_REVIEW_CUSTOM_SOURCE_REGION_HASH_RULE =
  "contentHash is 'sha256:' + the lowercase hex SHA-256 of lines startLine..endLine (one-based, inclusive) of the cited file, each line terminated by one LF " +
  "(equivalent to `sed -n 'S,Ep' <path> | sha256sum`). Cite the head side of a changed file, or the baseline side of a deleted file; " +
  'the engine recomputes this from the frozen commit bytes and refuses any region whose range or hash does not match.';

export type BuildReviewSourceRegionRejectionReason =
  | 'outside-changed-input'
  | 'frozen-blob-unavailable'
  | 'range-outside-blob'
  | 'content-hash-mismatch';

export type BuildReviewSourceRegionAdmission =
  | { readonly kind: 'admitted'; readonly sourceRegions: readonly BuildReviewCandidateScopeSourceRegion[] }
  | {
    readonly kind: 'rejected';
    readonly reason: BuildReviewSourceRegionRejectionReason;
    /** The first rejected claim, in citation order. */
    readonly detail: string;
    /** Claims that did admit, so a diagnosis names only the regions that failed. */
    readonly admittedSourceRegions: readonly BuildReviewCandidateScopeSourceRegion[];
  };

export interface BuildReviewFrozenSourceReader {
  /** Reads one blob of the reviewed baseline or head commit, never the worktree. */
  read(side: 'baseline' | 'head', path: string): Promise<BuildReviewOptionalSourceRead>;
}

export type BuildReviewCitedRegionComparisonStatus =
  | 'match'
  | BuildReviewSourceRegionRejectionReason;

/** A diagnostic-only comparison of one raw reviewer citation against frozen input. */
export interface BuildReviewCitedRegionComparison {
  readonly finding: number;
  readonly region: number;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly citedContentHash?: string;
  readonly side?: 'baseline' | 'head';
  readonly status: BuildReviewCitedRegionComparisonStatus;
  readonly frozenContentHash?: string;
  readonly frozenLineCount?: number;
}

function frozenLines(text: string): readonly string[] {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/** Engine-side recomputation of a region's identity from frozen bytes. */
export function hashBuildReviewFrozenSourceLines(text: string, startLine: number, endLine: number): string | undefined {
  const lines = frozenLines(text);
  if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1 || endLine < startLine || endLine > lines.length) return undefined;
  const content = lines.slice(startLine - 1, endLine).map((line) => `${line}\n`).join('');
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/**
 * Compares each structurally recognizable citation in an otherwise rejected
 * reviewer payload. This is diagnostic-only: unlike admission, malformed
 * entries are omitted and no comparison can affect its outcome.
 */
export async function compareBuildReviewCitedSourceRegions(
  value: unknown,
  changes: readonly BuildReviewPathChange[],
  reader: BuildReviewFrozenSourceReader,
): Promise<readonly BuildReviewCitedRegionComparison[]> {
  const findings = record(value)?.findings;
  if (!Array.isArray(findings)) return [];

  const comparisons: BuildReviewCitedRegionComparison[] = [];
  for (const [finding, findingValue] of findings.entries()) {
    const sourceRegions = record(findingValue)?.sourceRegions;
    if (!Array.isArray(sourceRegions)) continue;
    for (const [region, regionValue] of sourceRegions.entries()) {
      const citation = record(regionValue);
      if (
        !citation || typeof citation.path !== 'string' ||
        !Number.isSafeInteger(citation.startLine) || !Number.isSafeInteger(citation.endLine)
      ) continue;

      const path = citation.path;
      const startLine = citation.startLine;
      const endLine = citation.endLine;
      const citedContentHash = typeof citation.contentHash === 'string' ? citation.contentHash : undefined;
      const base = { finding, region, path, startLine, endLine, ...(citedContentHash === undefined ? {} : { citedContentHash }) } as const;
      const change = changes.find((candidate) => candidate.path === path);
      if (!change) {
        comparisons.push(Object.freeze({ ...base, status: 'outside-changed-input' }));
        continue;
      }

      const side = change.kind === 'D' ? 'baseline' : 'head';
      let blob: BuildReviewOptionalSourceRead;
      try {
        blob = await reader.read(side, path);
      } catch {
        comparisons.push(Object.freeze({ ...base, side, status: 'frozen-blob-unavailable' }));
        continue;
      }
      if (blob.kind === 'absent') {
        comparisons.push(Object.freeze({ ...base, side, status: 'frozen-blob-unavailable' }));
        continue;
      }

      const frozenLineCount = frozenLines(blob.value).length;
      const frozenContentHash = hashBuildReviewFrozenSourceLines(blob.value, startLine, endLine);
      if (frozenContentHash === undefined) {
        comparisons.push(Object.freeze({ ...base, side, status: 'range-outside-blob', frozenLineCount }));
      } else if (frozenContentHash !== citedContentHash) {
        comparisons.push(Object.freeze({ ...base, side, status: 'content-hash-mismatch', frozenContentHash, frozenLineCount }));
      } else {
        comparisons.push(Object.freeze({ ...base, side, status: 'match', frozenContentHash, frozenLineCount }));
      }
    }
  }
  return Object.freeze(comparisons);
}

type BuildReviewSourceRegionCheck =
  | { readonly kind: 'admitted'; readonly sourceRegion: BuildReviewCandidateScopeSourceRegion }
  | { readonly kind: 'rejected'; readonly reason: BuildReviewSourceRegionRejectionReason; readonly detail: string };

async function admitBuildReviewCustomSourceRegion(
  region: BuildReviewCandidateScopeSourceRegion,
  changes: readonly BuildReviewPathChange[],
  reader: BuildReviewFrozenSourceReader,
): Promise<BuildReviewSourceRegionCheck> {
  const label = `${region.path}:${region.startLine}-${region.endLine}`;
  const change = changes.find((candidate) => candidate.path === region.path);
  if (!change) return { kind: 'rejected', reason: 'outside-changed-input', detail: `source region ${label} is outside the frozen changed input` };
  const side = change.kind === 'D' ? 'baseline' : 'head';
  let blob: BuildReviewOptionalSourceRead;
  try {
    blob = await reader.read(side, region.path);
  } catch (error) {
    return { kind: 'rejected', reason: 'frozen-blob-unavailable', detail: `source region ${label} could not be read from the frozen ${side}: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (blob.kind === 'absent') return { kind: 'rejected', reason: 'frozen-blob-unavailable', detail: `source region ${label} names no blob in the frozen ${side}` };
  const expected = hashBuildReviewFrozenSourceLines(blob.value, region.startLine, region.endLine);
  if (expected === undefined) return { kind: 'rejected', reason: 'range-outside-blob', detail: `source region ${label} is outside the frozen ${side} blob` };
  if (expected !== region.contentHash) return { kind: 'rejected', reason: 'content-hash-mismatch', detail: `source region ${label} does not match the frozen ${side} bytes` };
  // The admitted record carries the engine-computed hash, never the claim.
  return { kind: 'admitted', sourceRegion: Object.freeze({ path: region.path, startLine: region.startLine, endLine: region.endLine, contentHash: expected, display: region.display }) };
}

/**
 * Derives the admitted reference set for a custom judgement from the frozen
 * baseline/head input.  A reviewer's claim contributes only a lookup key:
 * every admitted region is re-read and re-hashed by the engine.  Every claim
 * is checked, so a rejection still carries the regions that did admit and a
 * diagnosis can name only the regions that failed.
 */
export async function admitBuildReviewCustomSourceRegions(
  claimed: readonly BuildReviewCandidateScopeSourceRegion[],
  changes: readonly BuildReviewPathChange[],
  reader: BuildReviewFrozenSourceReader,
): Promise<BuildReviewSourceRegionAdmission> {
  const admitted: BuildReviewCandidateScopeSourceRegion[] = [];
  let rejection: Extract<BuildReviewSourceRegionCheck, { kind: 'rejected' }> | undefined;
  for (const region of claimed) {
    const check = await admitBuildReviewCustomSourceRegion(region, changes, reader);
    if (check.kind === 'admitted') admitted.push(check.sourceRegion);
    else rejection ??= check;
  }
  const sourceRegions = Object.freeze(admitted);
  return rejection === undefined
    ? { kind: 'admitted', sourceRegions }
    : { ...rejection, admittedSourceRegions: sourceRegions };
}
