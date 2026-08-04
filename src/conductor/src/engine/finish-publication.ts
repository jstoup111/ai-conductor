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

/**
 * A deterministic observer result. `present` means the boundary both found
 * and verified the expected evidence; stale and malformed observations never
 * receive the benefit of the doubt. `unavailable` covers a failed adapter
 * call, so a transient dependency outage cannot manufacture completion.
 */
export type PublicationEvidenceObservation =
  | 'present'
  | 'missing'
  | 'stale'
  | 'malformed'
  | 'unavailable';

export type PushEvidenceObservation =
  | 'pushed'
  | 'unpushed'
  | 'stale'
  | 'malformed'
  | 'unavailable';

/** GitHub's authoritative view of the one PR eligible for this feature. */
export type PullRequestObservation =
  | { state: 'one'; url: string; prose: 'accepted' | 'stale' | 'placeholder'; ready: boolean }
  | { state: 'missing' }
  | { state: 'ambiguous'; urls: readonly string[] }
  | { state: 'malformed' }
  | { state: 'unavailable' };

/**
 * All repository and external boundaries used to construct a FINISH snapshot.
 * The composition root supplies real adapters; unit tests supply fakes. The
 * observer itself has no filesystem, process, or network fallback.
 */
export interface PublicationObservationPorts {
  filesystem: {
    observeImplementationEvidence(): Promise<PublicationEvidenceObservation>;
    observeShipEvidence(): Promise<PublicationEvidenceObservation>;
    observeOutcomeRecord(): Promise<PublicationEvidenceObservation>;
  };
  git: {
    observePushEvidence(): Promise<PushEvidenceObservation>;
  };
  github: {
    observePullRequest(): Promise<PullRequestObservation>;
  };
  shippedRecord: {
    observeShippedRecord(): Promise<PublicationEvidenceObservation>;
  };
  releaseReadiness: {
    observeReleaseReadiness(): Promise<PublicationEvidenceObservation>;
  };
}

export type PublicationObservationContext =
  | { mode: 'daemon'; intent: DaemonPublicationIntent }
  | { mode: 'foreground-auto'; intent: ForegroundAutoPublicationIntent }
  | { mode: 'interactive'; intent: InteractivePublicationIntent };

export type ObservePublicationSnapshotInput = PublicationObservationContext & {
  ports: PublicationObservationPorts;
};

/**
 * Read every authoritative publication boundary into the closed snapshot.
 * This is observation only: it has no local-state cache, mutation, process,
 * or network behavior of its own. A failed observer is represented as
 * indeterminate rather than escaping as an exception or being treated as
 * evidence of absence.
 */
export async function observePublicationSnapshot(
  input: ObservePublicationSnapshotInput,
): Promise<PublicationSnapshot> {
  const {
    filesystem,
    git,
    github,
    shippedRecord,
    releaseReadiness,
  } = input.ports;

  const implementationEvidence = mapRequiredEvidence(
    await safelyObserve(filesystem.observeImplementationEvidence),
  );
  const shipEvidence = mapRequiredEvidence(await safelyObserve(filesystem.observeShipEvidence));
  const outcomeRecord = mapOptionalEvidence(await safelyObserve(filesystem.observeOutcomeRecord));
  const branchPushed = mapPushEvidence(await safelyObserve(git.observePushEvidence));
  const pr = mapPullRequest(await safelyObserve(github.observePullRequest));
  const shipped = mapOptionalEvidence(await safelyObserve(shippedRecord.observeShippedRecord));
  const readiness = mapReleaseReadiness(
    await safelyObserve(releaseReadiness.observeReleaseReadiness),
  );

  return {
    mode: input.mode,
    intent: input.intent,
    implementationEvidence,
    shipEvidence,
    releaseReadiness: readiness,
    branchPushed,
    pr,
    shippedRecord: shipped,
    outcomeRecord,
  } as PublicationSnapshot;
}

async function safelyObserve<T>(observe: () => Promise<T>): Promise<T | 'unavailable'> {
  try {
    return await observe();
  } catch {
    return 'unavailable';
  }
}

function mapRequiredEvidence(
  observation: PublicationEvidenceObservation | 'unavailable',
): PublicationEvidence['implementationEvidence'] {
  switch (observation) {
    case 'present':
      return 'valid';
    case 'unavailable':
      return 'indeterminate';
    case 'missing':
    case 'stale':
    case 'malformed':
      return 'invalid';
  }
}

function mapOptionalEvidence(
  observation: PublicationEvidenceObservation | 'unavailable',
): PublicationEvidence['shippedRecord'] {
  switch (observation) {
    case 'present':
      return 'valid';
    case 'missing':
      return 'missing';
    case 'unavailable':
      return 'indeterminate';
    case 'stale':
    case 'malformed':
      return 'invalid';
  }
}

function mapReleaseReadiness(
  observation: PublicationEvidenceObservation | 'unavailable',
): PublicationEvidence['releaseReadiness'] {
  return mapOptionalEvidence(observation);
}

function mapPushEvidence(
  observation: PushEvidenceObservation | 'unavailable',
): PublicationEvidence['branchPushed'] {
  switch (observation) {
    case 'pushed':
      return 'valid';
    case 'unpushed':
      return 'missing';
    case 'unavailable':
      return 'indeterminate';
    case 'stale':
    case 'malformed':
      return 'invalid';
  }
}

function mapPullRequest(
  observation: PullRequestObservation | 'unavailable',
): PublicationEvidence['pr'] {
  if (observation === 'unavailable') {
    return { identity: 'indeterminate' };
  }

  switch (observation.state) {
    case 'one':
      return {
        identity: 'one',
        url: observation.url,
        prose: observation.prose,
        ready: observation.ready,
      };
    case 'missing':
      return { identity: 'none' };
    case 'ambiguous':
      return { identity: 'ambiguous', urls: observation.urls };
    case 'malformed':
    case 'unavailable':
      return { identity: 'indeterminate' };
  }
}

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
