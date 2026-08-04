/**
 * Closed domain vocabulary for resumable FINISH publication.  The coordinator
 * derives these values from authoritative repository and external evidence;
 * it never treats a local progress hint as a successful publication effect.
 */

/**
 * Authority is part of the intent, rather than inferred from a caller's mode.
 * Daemon policy may publish only a PR; the foreground automatic policy may
 * safely keep work when publication is unavailable; interactive choices retain
 * explicit operator authority.  Merge and discard are deliberately absent.
 */
export type PublicationIntent =
  | {
      outcome: 'pr';
      authority: { kind: 'unattended_policy'; mode: 'daemon' };
    }
  | {
      outcome: 'pr';
      authority: { kind: 'unattended_policy'; mode: 'foreground-auto' };
    }
  | {
      outcome: 'pr';
      authority: { kind: 'operator_confirmed'; mode: 'interactive' };
    }
  | {
      outcome: 'keep';
      authority: { kind: 'unattended_policy'; mode: 'foreground-auto' };
    }
  | {
      outcome: 'keep';
      authority: { kind: 'operator_confirmed'; mode: 'interactive' };
    };

type DaemonPublicationIntent = Extract<
  PublicationIntent,
  { authority: { kind: 'unattended_policy'; mode: 'daemon' } }
>;
type ForegroundAutoPublicationIntent = Extract<
  PublicationIntent,
  { authority: { kind: 'unattended_policy'; mode: 'foreground-auto' } }
>;
type InteractivePublicationIntent = Extract<
  PublicationIntent,
  { authority: { kind: 'operator_confirmed'; mode: 'interactive' } }
>;

type PublicationEvidence = {
  implementationEvidence: 'valid' | 'invalid' | 'indeterminate';
  shipEvidence: 'valid' | 'invalid' | 'indeterminate';
  releaseReadiness: 'valid' | 'missing' | 'invalid' | 'indeterminate';
  branchPushed: 'valid' | 'missing' | 'invalid' | 'indeterminate';
  shippedRecord: 'valid' | 'missing' | 'invalid' | 'indeterminate';
  outcomeRecord: 'valid' | 'missing' | 'invalid' | 'indeterminate';
  pr:
    | {
        identity: 'one';
        url: string;
        prose: 'accepted' | 'stale' | 'placeholder' | 'indeterminate';
        ready: boolean;
      }
    | { identity: 'none' }
    | { identity: 'ambiguous'; urls: readonly string[] }
    | { identity: 'indeterminate' };
};

export type PublicationSnapshot =
  | (PublicationEvidence & { mode: 'daemon'; intent: DaemonPublicationIntent })
  | (PublicationEvidence & { mode: 'foreground-auto'; intent: ForegroundAutoPublicationIntent })
  | (PublicationEvidence & { mode: 'interactive'; intent: InteractivePublicationIntent });

export type PublicationSnapshotValidation =
  | { kind: 'valid' }
  | {
      kind: 'incoherent';
      reason: 'valid_outcome_record_requires_external_pr';
    }
  | {
      kind: 'indeterminate';
      reason:
        | 'outcome_record_indeterminate'
        | 'external_pr_identity_indeterminate';
    };

/**
 * Validates whether the repository and external observations can describe the
 * same publication state. This is deliberately not a completion decision.
 */
export function validatePublicationSnapshot(
  snapshot: PublicationSnapshot,
): PublicationSnapshotValidation {
  if (snapshot.outcomeRecord === 'valid' && snapshot.pr.identity === 'none') {
    return {
      kind: 'incoherent',
      reason: 'valid_outcome_record_requires_external_pr',
    };
  }

  if (snapshot.outcomeRecord === 'indeterminate') {
    return { kind: 'indeterminate', reason: 'outcome_record_indeterminate' };
  }

  if (snapshot.pr.identity === 'indeterminate') {
    return {
      kind: 'indeterminate',
      reason: 'external_pr_identity_indeterminate',
    };
  }

  return { kind: 'valid' };
}

export type PublicationTransition =
  | 'establish_pr'
  | 'verify_release_readiness'
  | 'write_shipped_record'
  | 'judge_pr_prose'
  | 'ready_pr'
  | 'record_outcome';

/**
 * Selects the first publication effect still required by a closed snapshot.
 * Every result is a resumable transition; the coordinator owns performing it
 * and obtaining the next authoritative snapshot.
 */
export function nextFinishPublicationTransition(
  snapshot: PublicationSnapshot,
): PublicationTransition {
  if (snapshot.pr.identity !== 'one' || snapshot.branchPushed !== 'valid') {
    return 'establish_pr';
  }

  if (snapshot.releaseReadiness !== 'valid') {
    return 'verify_release_readiness';
  }

  if (snapshot.shippedRecord !== 'valid') {
    return 'write_shipped_record';
  }

  if (snapshot.pr.prose !== 'accepted') {
    return 'judge_pr_prose';
  }

  if (!snapshot.pr.ready) {
    return 'ready_pr';
  }

  return 'record_outcome';
}

export type PublicationDisposition =
  | { kind: 'complete' }
  | { kind: 'publication_retry'; transition: PublicationTransition; reason: string }
  | { kind: 'implementation_invalid'; evidence: string }
  | { kind: 'human_required'; reason: string };
