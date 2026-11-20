import type { ChildId } from './child-context.js';
import type { RemediationCaseRecord, RemediationCaseStoreReadResult } from './remediation-case-store.js';

export type BuildStallStaleCitation =
  | {
    readonly kind: 'stale';
    readonly caseId: string;
    readonly ownerChild: ChildId;
    readonly state: 'resolved' | 'foreign';
  }
  | { readonly kind: 'not-stale' };

export interface BuildStallStaleCitationInput {
  readonly question: string | null | undefined;
  readonly activeChild: ChildId;
  readonly caseStores: ReadonlyMap<ChildId, RemediationCaseStoreReadResult>;
}

interface CitedCase {
  readonly case: RemediationCaseRecord;
  readonly ownerChild: ChildId;
}

/**
 * Determines whether a BUILD stall only repeats remediation work already
 * settled or owned by another child. Case ids are the sole citation grammar:
 * question prose is never parsed or interpreted.
 */
export function classifyBuildStallStaleCitation(input: BuildStallStaleCitationInput): BuildStallStaleCitation {
  if (!input.question) return { kind: 'not-stale' };

  const citedCases: CitedCase[] = [];
  for (const [child, result] of input.caseStores) {
    if (!result.ok) return { kind: 'not-stale' };
    for (const record of result.state.cases) {
      if (input.question.includes(record.id)) citedCases.push({ case: record, ownerChild: child });
    }
  }

  if (citedCases.length === 0 || citedCases.some(({ case: record, ownerChild }) =>
    ownerChild === input.activeChild && record.resolution === 'open')) {
    return { kind: 'not-stale' };
  }

  const cited = citedCases[0]!;
  return {
    kind: 'stale',
    caseId: cited.case.id,
    ownerChild: cited.ownerChild,
    state: cited.case.resolution === 'resolved' ? 'resolved' : 'foreign',
  };
}
