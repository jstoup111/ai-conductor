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
  | { readonly kind: 'rejected'; readonly reason: BuildReviewSourceRegionRejectionReason; readonly detail: string };

export interface BuildReviewFrozenSourceReader {
  /** Reads one blob of the reviewed baseline or head commit, never the worktree. */
  read(side: 'baseline' | 'head', path: string): Promise<BuildReviewOptionalSourceRead>;
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

/**
 * Derives the admitted reference set for a custom judgement from the frozen
 * baseline/head input.  A reviewer's claim contributes only a lookup key:
 * every admitted region is re-read and re-hashed by the engine.
 */
export async function admitBuildReviewCustomSourceRegions(
  claimed: readonly BuildReviewCandidateScopeSourceRegion[],
  changes: readonly BuildReviewPathChange[],
  reader: BuildReviewFrozenSourceReader,
): Promise<BuildReviewSourceRegionAdmission> {
  const admitted: BuildReviewCandidateScopeSourceRegion[] = [];
  for (const region of claimed) {
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
    admitted.push(Object.freeze({ path: region.path, startLine: region.startLine, endLine: region.endLine, contentHash: expected, display: region.display }));
  }
  return { kind: 'admitted', sourceRegions: Object.freeze(admitted) };
}
