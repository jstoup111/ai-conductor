import type { ChildId } from '../child-context.js';
import type { GitRunner } from '../rebase.js';
import { buildRewriteMapForRanges } from '../rewrite-map.js';
import type { CommitSha } from './restack-types.js';

export interface ConsumedTipCorrespondence {
  readonly child: ChildId;
  readonly oldParent: CommitSha;
  readonly oldTip: CommitSha;
  readonly newParent: CommitSha;
  readonly tip: CommitSha;
}

export interface UnenteredLeafOwner {
  readonly child: ChildId;
  readonly rewritten: CommitSha;
}

export interface UnenteredLeafResolution {
  readonly matches: readonly UnenteredLeafOwner[];
  /** Whether the match came from a consumed-resolution correspondence. */
  readonly recoveredFromConsumedResolution: boolean;
}

/**
 * Resolve a leaf through durable exact rewrites first, then through the
 * per-range correspondence retained for a consumed resolution.  The latter
 * deliberately rebuilds patch identity: duplicate subjects are omitted from
 * the durable exact map and must never be selected by subject text.
 */
export async function resolveUnenteredLeafOwner(
  git: GitRunner,
  oldTip: CommitSha,
  exactRewrites: ReadonlyMap<ChildId, ReadonlyMap<CommitSha, CommitSha>>,
  consumedTipCorrespondences: readonly ConsumedTipCorrespondence[],
): Promise<UnenteredLeafResolution> {
  const rewrittenMatches = [...exactRewrites.entries()].flatMap(([child, rewrites]) => {
    const rewritten = rewrites.get(oldTip);
    return rewritten === undefined ? [] : [{ child, rewritten }];
  });
  if (rewrittenMatches.length > 0) return { matches: rewrittenMatches, recoveredFromConsumedResolution: false };

  const explicitTipMatches = consumedTipCorrespondences.flatMap((correspondence) =>
    correspondence.oldTip === oldTip ? [{ child: correspondence.child, rewritten: correspondence.tip }] : []);
  if (explicitTipMatches.length > 0) return { matches: explicitTipMatches, recoveredFromConsumedResolution: true };

  const reconstructedMatches = (await Promise.all(consumedTipCorrespondences.map(async (correspondence) => {
    const { map } = await buildRewriteMapForRanges(
      git,
      correspondence.oldParent,
      correspondence.oldTip,
      correspondence.newParent,
      correspondence.tip,
    );
    const rewritten = map[oldTip];
    return rewritten === undefined ? undefined : { child: correspondence.child, rewritten };
  }))).filter((match): match is UnenteredLeafOwner => match !== undefined);
  return { matches: reconstructedMatches, recoveredFromConsumedResolution: reconstructedMatches.length > 0 };
}
