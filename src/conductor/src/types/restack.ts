export type ChildId = number & { readonly __brand: 'ChildId' };
export type CommitSha = string & { readonly __brand: 'CommitSha' };
export type RefName = string & { readonly __brand: 'RefName' };
export type RestackOpId = string & { readonly __brand: 'RestackOpId' };
/** Why a stack is being rebuilt. Fold is the terminal, leaf-to-owner repair pass. */
export type RestackCause = 'feature-repair' | 'base-refresh' | 'fold';
export type JournalState = 'planned' | 'ready' | 'moved' | 'synced' | 'applied' | 'aborted' | 'rolling-back';
export type RestackRefusalReason = 'cascade-cap' | 'dirty-overlap' | 'sync-collision' | 'checked-out-elsewhere' | 'stack-ref-changed' | 'lock-unavailable' | 'verification-failed' | 'replay-mismatch' | 'range-not-ancestor' | 'closed-child-rewritten' | 'restack-outstanding' | 'published-stack' | 'deferred-base-refresh' | 'journal-live-owner' | 'restack-resolution-stale' | 'fold-owner-invalid' | 'fold-misrouted' | 'fold-tree-mismatch' | 'fold-boundary-lost';
