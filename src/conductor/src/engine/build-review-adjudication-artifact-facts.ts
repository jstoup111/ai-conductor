import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { BuildReviewAggregate } from './build-review-aggregate.js';
import {
  buildReviewAdjudicationSourceId,
  type BuildReviewAdjudicationPriorFindingDigest,
} from './build-review-adjudication-context.js';
import {
  parseBuildReviewBranchArtifact,
  type BuildReviewBranchArtifact,
} from './build-review-artifacts.js';
import { pipelinePathFor, type ChildId } from './child-context.js';
import type { BuildReviewFinding } from './build-review-domain.js';
import {
  canonicalizeBuildReviewCustomFindingIdentity,
  canonicalizeBuildReviewFindingIdentity,
} from './build-review-finding-identity.js';
import type {
  BuildReviewFindingHunkTarget,
  BuildReviewProvenanceArtifact,
} from './build-review-review-frontier.js';
import { mapBuildReviewFindingToHunks } from './build-review-review-frontier.js';
import type { ChangedFileReference } from './build-review-projections.js';

export interface BuildReviewAdjudicationArtifactFactOptions {
  /**
   * The current lap's frozen diff, resolved from the artifact's immutable
   * merge-base and head identities. Historical artifact reads need no ranges:
   * they contribute digests, while only current sources enter provenance.
   */
  readonly changedFilesForArtifact?: (
    artifact: BuildReviewBranchArtifact,
  ) => Promise<readonly ChangedFileReference[] | undefined>;
}

type BuildReviewAdjudicationArtifactFacts = {
  readonly priorFindingDigests: ReadonlyMap<string, BuildReviewAdjudicationPriorFindingDigest>;
  readonly provenance?: {
    readonly deltaHunks: readonly { readonly path: string; readonly contentHash: string }[];
    readonly predecessorArtifacts: readonly BuildReviewProvenanceArtifact[];
    readonly sourceTargets: Readonly<Record<string, readonly BuildReviewFindingHunkTarget[]>>;
    readonly sources: Readonly<Record<string, {
      readonly deltaHunks: readonly { readonly path: string; readonly contentHash: string }[];
      readonly predecessorArtifacts: readonly BuildReviewProvenanceArtifact[];
      readonly targets: readonly BuildReviewFindingHunkTarget[];
    }>>;
  };
};

function buildReviewArtifactFinding(
  artifact: BuildReviewBranchArtifact,
  value: unknown,
  changedFiles?: readonly ChangedFileReference[],
): { readonly sourceId: string; readonly digest: BuildReviewAdjudicationPriorFindingDigest; readonly targets: readonly BuildReviewFindingHunkTarget[] } | undefined {
  if (artifact.rubric === 'testQuality' || artifact.rubric === 'security' || artifact.rubric === 'implementationQuality') {
    const finding = value as BuildReviewFinding;
    const identity = canonicalizeBuildReviewFindingIdentity({
      ...finding,
      rubric: artifact.rubric,
      contractVersion: artifact.result.kind === 'judged' ? artifact.result.contractVersion : undefined,
    });
    if (!identity) return undefined;
    return {
      sourceId: buildReviewAdjudicationSourceId({ rubric: artifact.rubric, findingId: identity.id }),
      digest: {
        rubric: artifact.rubric,
        concernKind: finding.concernKind,
        summary: finding.summary,
        evidenceLocations: finding.evidenceLocations,
        lapId: artifact.lapId,
      },
      targets: changedFiles === undefined
        ? [{ kind: 'file', path: finding.anchor.locus.path }]
        : mapBuildReviewFindingToHunks(finding, changedFiles),
    };
  }
  const identity = canonicalizeBuildReviewCustomFindingIdentity(value);
  const finding = value as { readonly summary?: unknown; readonly evidenceLocations?: unknown };
  if (!identity || typeof finding.summary !== 'string' || !Array.isArray(finding.evidenceLocations) ||
    !finding.evidenceLocations.every((location) => typeof location === 'string')) return undefined;
  return {
    sourceId: buildReviewAdjudicationSourceId({ rubric: artifact.rubric, findingId: identity.id }),
    digest: {
      rubric: artifact.rubric,
      concernKind: identity.canonicalPayload.concernId,
      summary: finding.summary,
      evidenceLocations: finding.evidenceLocations,
      lapId: artifact.lapId,
    },
    targets: changedFiles === undefined
      ? identity.canonicalPayload.sourceRegions.map((region) => ({ kind: 'file' as const, path: region.path }))
      : mapBuildReviewFindingToHunks(value as import('./build-review-domain.js').BuildReviewCustomFinding, changedFiles),
  };
}

/**
 * Branch artifacts are the durable owner of both lap scope and historical
 * findings. Keep their asynchronous reads at the conductor boundary; the
 * coordinator receives only source-id keyed, schema-checked facts.
 */
export async function readBuildReviewAdjudicationArtifactFacts(
  projectRoot: string,
  aggregate: BuildReviewAggregate,
  options: BuildReviewAdjudicationArtifactFactOptions = {},
  child?: ChildId,
): Promise<BuildReviewAdjudicationArtifactFacts> {
  const byLap = new Map<string, BuildReviewBranchArtifact[]>();
  const artifactRoot = pipelinePathFor(projectRoot, 'build-review', child);
  try {
    const lapIds = await readdir(artifactRoot);
    for (const lapId of lapIds) {
      let files: readonly string[];
      try {
        files = await readdir(join(artifactRoot, lapId));
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const artifact = parseBuildReviewBranchArtifact(JSON.parse(await readFile(
            join(artifactRoot, lapId, file), 'utf-8',
          )));
          if (artifact === undefined) continue;
          const entries = byLap.get(artifact.lapId) ?? [];
          entries.push(artifact);
          byLap.set(artifact.lapId, entries);
        } catch {
          // One missing or malformed historical artifact is not authority to
          // discard readable evidence from the rest of the lap history.
        }
      }
    }
  } catch {
    // Missing branch-artifact state is valid for legacy and first-lap runs.
  }

  const priorFindingDigests = new Map<string, BuildReviewAdjudicationPriorFindingDigest>();
  for (const artifacts of byLap.values()) {
    for (const artifact of artifacts) {
      if (artifact.result.kind !== 'judged' || artifact.lapId === aggregate.lapId) continue;
      for (const finding of artifact.result.findings) {
        const projected = buildReviewArtifactFinding(artifact, finding);
        if (projected !== undefined) priorFindingDigests.set(projected.sourceId, projected.digest);
      }
    }
  }

  const sources: Record<string, {
    readonly deltaHunks: readonly { readonly path: string; readonly contentHash: string }[];
    readonly predecessorArtifacts: readonly BuildReviewProvenanceArtifact[];
    readonly targets: readonly BuildReviewFindingHunkTarget[];
  }> = {};
  for (const artifact of byLap.get(aggregate.lapId) ?? []) {
    const scope = artifact.reviewScope;
    if (artifact.result.kind !== 'judged' || scope === undefined || 'kind' in scope || scope.predecessorLapId === undefined) continue;
    const predecessorArtifacts = byLap.get(scope.predecessorLapId) ?? [];
    const changedFiles = await options.changedFilesForArtifact?.(artifact);
    for (const finding of artifact.result.findings) {
      const projected = buildReviewArtifactFinding(artifact, finding, changedFiles);
      if (projected === undefined) continue;
      sources[projected.sourceId] = {
        deltaHunks: scope.deltaHunks,
        predecessorArtifacts,
        targets: projected.targets,
      };
    }
  }
  const values = Object.values(sources);
  return {
    priorFindingDigests,
    ...(values.length === 0 ? {} : {
      provenance: {
        // Legacy direct coordinator callers use this shared shape. The
        // conductor uses `sources`, preserving each rubric's own predecessor.
        deltaHunks: values[0]!.deltaHunks,
        predecessorArtifacts: values[0]!.predecessorArtifacts,
        sourceTargets: Object.fromEntries(Object.entries(sources).map(([sourceId, value]) => [sourceId, value.targets])),
        sources,
      },
    }),
  };
}
