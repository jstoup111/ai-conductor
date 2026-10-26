export type ChildId = number & { readonly __brand: 'ChildId' };
export type CommitSha = string & { readonly __brand: 'CommitSha' };
export type RefName = string & { readonly __brand: 'RefName' };
export type RestackOpId = string & { readonly __brand: 'RestackOpId' };
export type RestackCause = 'feature-repair' | 'base-refresh';
export type JournalState = 'planned' | 'ready' | 'moved' | 'synced' | 'applied' | 'aborted' | 'rolling-back';
export type RestackRefusalReason = 'cascade-cap' | 'dirty-overlap' | 'sync-collision' | 'checked-out-elsewhere' | 'stack-ref-changed' | 'lock-unavailable' | 'verification-failed' | 'replay-mismatch' | 'range-not-ancestor' | 'closed-child-rewritten' | 'flatten_refused' | 'restack-outstanding' | 'published-stack' | 'deferred-base-refresh' | 'journal-live-owner';
