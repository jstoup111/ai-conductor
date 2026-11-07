import type { ReviewedHunk } from "./build-review-artifacts.js";
import type {
  BuildReviewCustomFinding,
  BuildReviewFinding,
} from "./build-review-domain.js";
import type { ChangedFileReference } from "./build-review-projections.js";

/** A finding either resolves to concrete changed hunks or conservatively to a path. */
export type BuildReviewFindingHunkTarget =
  | { readonly kind: "hunks"; readonly hunks: readonly ReviewedHunk[] }
  | { readonly kind: "file"; readonly path: string };

function hunkKey(hunk: ReviewedHunk): string {
  return `${hunk.path}\u0000${hunk.contentHash}`;
}

function lineIntersectsHunk(
  region: { readonly startLine: number; readonly endLine: number },
  hunk: ChangedFileReference["hunks"][number],
): boolean {
  // A zero-count new side is a deletion. It has no source line to review, so
  // it deliberately falls through to the conservative file target.
  if (hunk.newCount === 0) return false;
  const start = hunk.newStart;
  const end = start + hunk.newCount - 1;
  return region.startLine <= end && region.endLine >= start;
}

function hasLineRange(
  region: BuildReviewFinding["anchor"]["locus"] | BuildReviewCustomFinding["sourceRegions"][number],
): region is (BuildReviewFinding["anchor"]["locus"] & { readonly startLine: number; readonly endLine: number }) | BuildReviewCustomFinding["sourceRegions"][number] {
  return region.startLine !== undefined && region.endLine !== undefined;
}

/**
 * Maps every source region independently. The file fallback is intentional:
 * an imprecise anchor must remain in the delta, never silently become settled.
 */
export function mapBuildReviewFindingToHunks(
  finding: BuildReviewFinding | BuildReviewCustomFinding,
  changedFiles: readonly ChangedFileReference[],
): readonly BuildReviewFindingHunkTarget[] {
  const byPath = new Map(changedFiles.map((file) => [file.path, file]));
  const regions = "sourceRegions" in finding
    ? finding.sourceRegions
    : [finding.anchor.locus];
  const targets: BuildReviewFindingHunkTarget[] = [];
  const seen = new Set<string>();
  for (const region of regions) {
    const file = byPath.get(region.path);
    const candidates = file === undefined ? [] : (
      hasLineRange(region)
        ? file.hunks.filter((hunk) => lineIntersectsHunk(region, hunk))
        : file.hunks.filter((hunk) => hunk.contentHash === region.contentHash)
    );
    if (candidates.length === 0) {
      const key = `file\u0000${region.path}`;
      if (!seen.has(key)) {
        seen.add(key);
        targets.push({ kind: "file", path: region.path });
      }
      continue;
    }
    const hunks = [...new Set(candidates.map((hunk) => hunk.contentHash))]
      .map((contentHash) => ({ path: region.path, contentHash }));
    const key = `hunks\u0000${hunks.map(hunkKey).sort().join("\u0001")}`;
    if (!seen.has(key)) {
      seen.add(key);
      targets.push({ kind: "hunks", hunks });
    }
  }
  return targets;
}
