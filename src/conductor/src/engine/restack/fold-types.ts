import type { ChildId } from '../child-context.js';
import type { RoundId } from '../routing/route-types.js';
import type { CommitSha } from './restack-types.js';

export interface FoldSourceCommit {
  readonly sha: CommitSha;
  readonly roundId: RoundId;
  readonly owner: ChildId;
}

/** A closed leaf interval that remains to be folded onto its recorded owner. */
export interface FoldRange {
  readonly host: ChildId;
  readonly roundId: RoundId;
  readonly leafEntryTip: CommitSha;
  readonly exitTip?: CommitSha;
}

export interface FoldFrozenBlock {
  readonly id: string;
  readonly body: string;
}

export type FoldPartReason = 'owner' | 'introduced-above-owner';

/** One source hunk, retained in the plan so its placement can be replayed exactly. */
export interface FoldHunk {
  readonly path: string;
  readonly patch: string;
  readonly wholeFile: boolean;
}

export type FoldPart =
  | { readonly kind: 'hunks'; readonly child: ChildId | 'leaf'; readonly path: string; readonly hunk: FoldHunk; readonly reason: FoldPartReason }
  | { readonly kind: 'whole'; readonly child: ChildId; readonly paths: readonly []; readonly reason: 'owner' }
  | {
    readonly kind: 'blocks';
    readonly child: ChildId;
    readonly paths: readonly [];
    readonly reason: 'owner';
    readonly blocks: readonly { readonly id: string; readonly body: string }[];
  };

export interface FoldCommitPlan extends FoldSourceCommit {
  readonly parts: readonly FoldPart[];
}

/** The durable source-to-placement correspondence recorded before fold replay. */
export type FoldPlan =
  | { readonly kind: 'planned'; readonly commits: readonly FoldCommitPlan[] }
  | {
    readonly kind: 'refused';
    readonly reason: 'fold-unplaced-path' | 'fold-residual-unexpressible';
    readonly commit: CommitSha;
    readonly paths: readonly string[];
  };
