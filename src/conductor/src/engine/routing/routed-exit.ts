import type { ChildId } from '../child-context.js';
import { makeGitRunner } from '../rebase.js';
import type { StoredRouteRecord } from './route-record-store.js';
import { resolveGitRef } from './git-ref-resolver.js';
import { closureRefFor } from './routing-refs.js';

/** The immutable Git comparison facts used to choose a routed host's exit. */
export interface HostNoOpEvidence {
  readonly kind: 'evidence';
  readonly headMoved: boolean;
  readonly treeDiffers: boolean;
  readonly tipEqualsClosure: boolean;
}

/** The host entry baseline cannot be inferred when the durable record lacks it. */
export interface HostNoOpEvidenceUnavailable {
  readonly kind: 'unavailable';
  readonly detail: string;
}

export type HostNoOpEvidenceResult = HostNoOpEvidence | HostNoOpEvidenceUnavailable;

/** Reads the durable entry baseline before a routed host selects its exit. */
export async function hostNoOpEvidence(
  worktree: string,
  slug: string,
  stored: StoredRouteRecord,
  host: ChildId,
): Promise<HostNoOpEvidenceResult> {
  const entry = stored.record.entry;
  if (entry?.host !== host) return { kind: 'unavailable', detail: `host ${host} entry baseline is unavailable` };

  const git = makeGitRunner(worktree);
  const head = await resolveGitRef(git, 'HEAD');
  if (typeof head !== 'string') return { kind: 'unavailable', detail: `host ${host} HEAD is unavailable` };
  const tree = await resolveGitRef(git, 'HEAD^{tree}');
  if (typeof tree !== 'string') return { kind: 'unavailable', detail: `host ${host} HEAD tree is unavailable` };
  const closure = await resolveGitRef(git, closureRefFor(slug, host));
  if (typeof closure !== 'string') return { kind: 'unavailable', detail: `host ${host} closure is unavailable` };

  return {
    kind: 'evidence',
    headMoved: head !== entry.pinnedBase,
    treeDiffers: tree !== entry.tree,
    tipEqualsClosure: head === closure,
  };
}
