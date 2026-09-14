// owner-gate/mutation-provenance.ts — strict committed ownership evidence for mutations.
//
// Dispatch eligibility's `provenance.ts` intentionally has weaker semantics:
// an absent owner is an un-owned spec there. A remote mutation instead needs
// exactly one committed owner record. This module therefore has its own reader
// and never consults branch prefixes, halt markers, shipped records, PR authors,
// git authors, or caller-provided hints.

import { normalizeOwnerId } from './identity.js';

export interface MutationProvenanceRequest {
  readonly repository: string;
  readonly defaultBranch: string;
  readonly specBranch: string;
  /** Exact committed intake-marker path for this feature. */
  readonly featureMarker: string;
  /** Default-branch evidence after merge; spec-branch evidence before publish. */
  readonly publication: 'merged' | 'initial';
  /** Deliberately ignored: hints are never ownership evidence. */
  readonly hints?: unknown;
}

export interface CommittedProvenanceRecord {
  readonly path: string;
  readonly content: string;
}

/** Injected committed-tree reader; it must not read a live worktree. */
export interface MutationProvenanceDiscovery {
  readCommittedRecords(input: {
    readonly repository: string;
    readonly ref: string;
  }): Promise<readonly CommittedProvenanceRecord[]>;
}

/** A strict result suitable for direct translation into a mutation refusal. */
export type MutationProvenance =
  | { readonly kind: 'owned'; readonly owner: string; readonly ref: string }
  | {
    readonly kind: 'refused';
    readonly reason:
      | 'missing-provenance'
      | 'conflicting-provenance'
      | 'duplicate-conflicting-owner'
      | 'provenance-unreadable'
      | 'provenance-timeout';
  };

function refused(reason: Extract<MutationProvenance, { kind: 'refused' }>['reason']): MutationProvenance {
  return { kind: 'refused', reason };
}

function isTimedOut(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const candidate = error as { timedOut?: unknown; code?: unknown; message?: unknown };
    if (candidate.timedOut === true || candidate.code === 'ETIMEDOUT') return true;
    if (typeof candidate.message === 'string' && /\btime(?:d)?[\s-]*out\b/i.test(candidate.message)) return true;
  }
  return false;
}

/** All owner lines matter: a duplicate is ambiguous even when its text agrees. */
function ownerLines(content: string): readonly (string | null)[] {
  return content
    .split('\n')
    .map((line) => /^\s*Owner:\s*(.*)\r?$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => normalizeOwnerId(match[1]));
}

function validRequest(request: MutationProvenanceRequest): boolean {
  return typeof request?.repository === 'string' && request.repository !== ''
    && typeof request.defaultBranch === 'string' && request.defaultBranch !== ''
    && typeof request.specBranch === 'string' && request.specBranch !== ''
    && typeof request.featureMarker === 'string' && request.featureMarker !== ''
    && (request.publication === 'merged' || request.publication === 'initial');
}

/**
 * Read one feature's authoritative committed ownership evidence.
 *
 * The discovery request selects exactly one authoritative ref. Results then
 * select exactly `featureMarker`, rather than scanning for a convenient marker
 * belonging to another feature. Every discovered `Owner:` line is evaluated;
 * neither a first match nor an otherwise plausible ownership hint can grant
 * mutation permission.
 */
export async function readMutationProvenance(
  request: MutationProvenanceRequest,
  discovery: MutationProvenanceDiscovery,
): Promise<MutationProvenance> {
  if (!validRequest(request) || !discovery || typeof discovery.readCommittedRecords !== 'function') {
    return refused('provenance-unreadable');
  }

  const ref = request.publication === 'merged' ? request.defaultBranch : request.specBranch;
  let records: readonly CommittedProvenanceRecord[];
  try {
    records = await discovery.readCommittedRecords({ repository: request.repository, ref });
  } catch (error) {
    return refused(isTimedOut(error) ? 'provenance-timeout' : 'provenance-unreadable');
  }

  if (!Array.isArray(records)) return refused('provenance-unreadable');
  const relevant = records.filter((record) => record && record.path === request.featureMarker);
  if (relevant.length === 0) return refused('missing-provenance');
  if (relevant.some((record) => typeof record.content !== 'string')) return refused('provenance-unreadable');

  const owners: string[] = [];
  for (const record of relevant) {
    const lines = ownerLines(record.content);
    if (lines.length === 0) return refused('missing-provenance');
    // A blank Owner line is missing evidence only on its own. Once another
    // Owner line is present in this record, it is contradictory duplicate
    // evidence regardless of line order and cannot grant the later value.
    if (lines.length !== 1 || lines[0] === null) {
      return lines.length === 1 ? refused('missing-provenance') : refused('duplicate-conflicting-owner');
    }
    owners.push(lines[0]);
  }

  return new Set(owners).size === 1
    ? { kind: 'owned', owner: owners[0], ref }
    : refused('conflicting-provenance');
}
