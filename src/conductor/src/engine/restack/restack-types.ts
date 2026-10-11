import type { ChildId } from '../child-context.js';

/** A full, lowercase Git object name validated at the restack boundary. */
export type CommitSha = string & { readonly __brand: 'CommitSha' };

/** A Git reference name restricted to the refs/ namespace. */
export type RefName = string & { readonly __brand: 'RefName' };

/** A durable restack operation identifier. */
export type RestackOpId = string & { readonly __brand: 'RestackOpId' };

export interface ChildRange {
  readonly child: ChildId;
  readonly oldParent: CommitSha;
  readonly oldTip: CommitSha;
  readonly kind: 'closed' | 'active' | 'leaf-active' | 'leaf-unentered';
}

export type RestackCause = 'feature-repair' | 'base-refresh';

export type JournalState =
  | 'planned'
  | 'ready'
  | 'moved'
  | 'synced'
  | 'applied'
  | 'aborted'
  | 'rolling-back';

export type ChildStatus = 'pending' | 'replayed' | 'resolved';

/** Reasons emitted by the single restack refusal boundary. */
export type RestackRefusalReason =
  | 'cascade-cap'
  | 'dirty-overlap'
  | 'sync-collision'
  | 'checked-out-elsewhere'
  | 'stack-ref-changed'
  | 'lock-unavailable'
  | 'verification-failed'
  | 'restack-conflict'
  | 'replay-mismatch'
  | 'range-not-ancestor'
  | 'closed-child-rewritten'
  | 'flatten_refused'
  | 'restack-outstanding'
  | 'published-stack'
  | 'deferred-base-refresh';

const fullObjectName = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function parseCommitSha(raw: string): CommitSha | undefined {
  return fullObjectName.test(raw) ? raw as CommitSha : undefined;
}

export function parseRefName(raw: string): RefName | undefined {
  return raw.startsWith('refs/') && raw.length > 'refs/'.length ? raw as RefName : undefined;
}

export function isLegalJournalTransition(from: JournalState, to: JournalState): boolean {
  return (from === 'planned' && (to === 'ready' || to === 'aborted'))
    || (from === 'ready' && (to === 'moved' || to === 'aborted'))
    || (from === 'moved' && (to === 'synced' || to === 'rolling-back'))
    || (from === 'synced' && to === 'applied')
    || (from === 'rolling-back' && to === 'aborted');
}

export function isLegalChildStatusTransition(from: ChildStatus, to: ChildStatus): boolean {
  return (from === 'pending' && (to === 'replayed' || to === 'resolved'))
    || (from === 'replayed' && to === 'resolved');
}
