import {
  openShipDraftPr,
  type OpenShipDraftPrDeps,
} from './ship-draft-pr.js';

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

export type UnattendedPublicationMode = 'daemon' | 'foreground-auto';

/**
 * Capability observations are inputs from the composition root.  The intent
 * policy is pure: it must not probe remotes or credentials itself.
 */
export interface UnattendedPublicationCapabilities {
  remote: 'configured' | 'missing';
  authentication: 'authenticated' | 'unavailable';
}

export interface UnattendedPublicationIntentInput {
  mode: UnattendedPublicationMode;
  capabilities: UnattendedPublicationCapabilities;
  /** Reject a supplied outcome that diverges from the mode's safe policy. */
  requestedOutcome?: unknown;
}

type PublicationEvidence = {
  implementationEvidence: 'valid' | 'invalid' | 'indeterminate';
  shipEvidence: 'valid' | 'invalid' | 'indeterminate';
  releaseReadiness: 'valid' | 'missing' | 'invalid' | 'indeterminate';
  branchPushed: 'valid' | 'missing' | 'invalid' | 'indeterminate';
  shippedRecord: 'valid' | 'missing' | 'invalid' | 'indeterminate';
  outcomeRecord: 'valid' | 'missing' | 'invalid' | 'indeterminate';
  pr: PublicationPullRequest;
};

export type PublicationPullRequest =
  | {
      identity: 'one';
      url: string;
      prose: 'accepted' | 'stale' | 'placeholder' | 'halt' | 'indeterminate';
      ready: boolean;
    }
  | { identity: 'none' }
  | { identity: 'ambiguous'; urls: readonly string[] }
  | { identity: 'indeterminate' };

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
  | {
      state: 'one';
      url: string;
      prose: 'accepted' | 'stale' | 'placeholder' | 'halt';
      ready: boolean;
    }
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

/** A deterministic FINISH condition with the only permitted operator action. */
export type PublicationCondition =
  | {
      code: 'publication_snapshot_incoherent';
      message: 'Publication evidence is contradictory. Resolve the cited publication state, then retry FINISH.';
      nextAction: 'resolve_publication_state';
    }
  | {
      code: 'publication_snapshot_indeterminate';
      message: 'Publication evidence could not be determined. Restore the evidence observer, then retry FINISH.';
      nextAction: 'restore_publication_observation';
    }
  | {
      code: 'implementation_evidence_invalid';
      message: 'Implementation evidence is invalid. Re-run the BUILD verification, then retry FINISH.';
      nextAction: 'rerun_build_verification';
    }
  | {
      code: 'implementation_evidence_indeterminate';
      message: 'Implementation evidence could not be determined. Restore the implementation evidence observer, then retry FINISH.';
      nextAction: 'restore_implementation_observation';
    }
  | {
      code: 'ship_evidence_invalid';
      message: 'SHIP evidence is invalid. Re-run the SHIP validators, then retry FINISH.';
      nextAction: 'rerun_ship_validators';
    }
  | {
      code: 'ship_evidence_indeterminate';
      message: 'SHIP evidence could not be determined. Restore the SHIP evidence observer, then retry FINISH.';
      nextAction: 'restore_ship_observation';
    }
  | {
      code: 'release_readiness_missing';
      message: 'Release readiness is missing. Publish a valid release readiness result, then retry FINISH.';
      nextAction: 'publish_release_readiness';
    }
  | {
      code: 'release_readiness_invalid';
      message: 'Release readiness is invalid. Restore a valid release readiness result, then retry FINISH.';
      nextAction: 'restore_release_readiness';
    }
  | {
      code: 'release_readiness_indeterminate';
      message: 'Release readiness could not be determined. Restore the readiness observer, then retry FINISH.';
      nextAction: 'restore_release_readiness_observation';
    };

export type PublicationPreflightResult =
  | { kind: 'ready_for_judgment' }
  | { kind: 'blocked'; condition: PublicationCondition };

/**
 * Checks only evidence that can block a judgment call without making any
 * publication effect. The order is intentional: it gives multi-gap state one
 * stable, actionable condition and never asks a judgment provider to infer
 * deterministic repository or release state.
 */
export function preflightFinishPublication(
  snapshot: PublicationSnapshot,
): PublicationPreflightResult {
  const validation = validatePublicationSnapshot(snapshot);
  if (validation.kind === 'incoherent') {
    return {
      kind: 'blocked',
      condition: {
        code: 'publication_snapshot_incoherent',
        message: 'Publication evidence is contradictory. Resolve the cited publication state, then retry FINISH.',
        nextAction: 'resolve_publication_state',
      },
    };
  }
  if (validation.kind === 'indeterminate') {
    return {
      kind: 'blocked',
      condition: {
        code: 'publication_snapshot_indeterminate',
        message: 'Publication evidence could not be determined. Restore the evidence observer, then retry FINISH.',
        nextAction: 'restore_publication_observation',
      },
    };
  }

  if (snapshot.implementationEvidence === 'invalid') {
    return {
      kind: 'blocked',
      condition: {
        code: 'implementation_evidence_invalid',
        message: 'Implementation evidence is invalid. Re-run the BUILD verification, then retry FINISH.',
        nextAction: 'rerun_build_verification',
      },
    };
  }
  if (snapshot.implementationEvidence === 'indeterminate') {
    return {
      kind: 'blocked',
      condition: {
        code: 'implementation_evidence_indeterminate',
        message: 'Implementation evidence could not be determined. Restore the implementation evidence observer, then retry FINISH.',
        nextAction: 'restore_implementation_observation',
      },
    };
  }
  if (snapshot.shipEvidence === 'invalid') {
    return {
      kind: 'blocked',
      condition: {
        code: 'ship_evidence_invalid',
        message: 'SHIP evidence is invalid. Re-run the SHIP validators, then retry FINISH.',
        nextAction: 'rerun_ship_validators',
      },
    };
  }
  if (snapshot.shipEvidence === 'indeterminate') {
    return {
      kind: 'blocked',
      condition: {
        code: 'ship_evidence_indeterminate',
        message: 'SHIP evidence could not be determined. Restore the SHIP evidence observer, then retry FINISH.',
        nextAction: 'restore_ship_observation',
      },
    };
  }
  if (snapshot.releaseReadiness === 'missing') {
    return {
      kind: 'blocked',
      condition: {
        code: 'release_readiness_missing',
        message: 'Release readiness is missing. Publish a valid release readiness result, then retry FINISH.',
        nextAction: 'publish_release_readiness',
      },
    };
  }
  if (snapshot.releaseReadiness === 'invalid') {
    return {
      kind: 'blocked',
      condition: {
        code: 'release_readiness_invalid',
        message: 'Release readiness is invalid. Restore a valid release readiness result, then retry FINISH.',
        nextAction: 'restore_release_readiness',
      },
    };
  }
  if (snapshot.releaseReadiness === 'indeterminate') {
    return {
      kind: 'blocked',
      condition: {
        code: 'release_readiness_indeterminate',
        message: 'Release readiness could not be determined. Restore the readiness observer, then retry FINISH.',
        nextAction: 'restore_release_readiness_observation',
      },
    };
  }

  return { kind: 'ready_for_judgment' };
}

/**
 * The only provider-owned FINISH decision is whether the observed PR's title
 * and body need repair. Everything else is selected from durable evidence.
 */
export type PrProseJudgmentRequest = {
  kind: 'finish_pr_prose_quality';
  pullRequestUrl: string;
  qualityScope: readonly ['title', 'body'];
  maximumPasses: 1;
};

/** The bounded provider result, including fail-closed judgment outcomes. */
export type PrProseJudgmentResult =
  | { kind: 'accepted' }
  | { kind: 'revision_required'; reason: 'placeholder' | 'halt' | 'structurally_incomplete' }
  | { kind: 'timed_out' }
  | { kind: 'provider_unavailable' }
  | { kind: 'refused' };

type PrWithJudgmentNeeded = Extract<PublicationPullRequest, { identity: 'one' }> & {
  prose: 'stale' | 'placeholder' | 'halt' | 'indeterminate';
};

/**
 * A typed predicate protects the expensive boundary: accepted observed prose
 * is final for this pass, while a stale or incomplete observation earns one
 * request. The predicate performs no provider work itself.
 */
export function isPrProseJudgmentNeeded(
  pr: PublicationPullRequest,
): pr is PrWithJudgmentNeeded {
  return pr.identity === 'one' && pr.prose !== 'accepted';
}

function prProseJudgmentRequest(pr: PrWithJudgmentNeeded): PrProseJudgmentRequest {
  return {
    kind: 'finish_pr_prose_quality',
    pullRequestUrl: pr.url,
    qualityScope: ['title', 'body'],
    maximumPasses: 1,
  };
}

export interface AdvanceFinishPublicationInput {
  observe(): Promise<PublicationSnapshot>;
  effects: {
    dispatchJudgment(request: PrProseJudgmentRequest): Promise<PrProseJudgmentResult>;
    /**
     * The existing shipped-record primitive writes, commits, and pushes the
     * record. It is injected here because `observe` remains the authority for
     * strict committed-tree and PR-head verification.
     */
    createShippedRecord?: () => Promise<void>;
    /**
     * Existing SHIP draft-PR primitive, supplied with injected Git/GitHub
     * runners by the composition root. It is optional only because callers
     * that already observed a stable identity never need this transition.
     */
    establishPr?: OpenShipDraftPrDeps;
  };
}

export type AdvanceFinishPublicationResult =
  | { kind: 'advanced'; transition: PublicationTransition }
  | { kind: 'publication_retry'; condition: PublicationCondition }
  | {
      kind: 'publication_retry';
      transition: PublicationTransition;
      reason: string;
    }
  | {
      kind: 'human_required';
      reason:
        | 'ambiguous_pr_identity'
        | 'invalid_shipped_record'
        | 'judgment_placeholder_prose'
        | 'judgment_halt_prose'
        | 'judgment_malformed_prose'
        | 'judgment_refused';
    };

function mapPrProseJudgmentResult(
  result: PrProseJudgmentResult,
): AdvanceFinishPublicationResult {
  switch (result.kind) {
    case 'accepted':
      return { kind: 'advanced', transition: 'judge_pr_prose' };
    case 'timed_out':
      return {
        kind: 'publication_retry',
        transition: 'judge_pr_prose',
        reason: 'judgment_timed_out',
      };
    case 'provider_unavailable':
      return {
        kind: 'publication_retry',
        transition: 'judge_pr_prose',
        reason: 'judgment_provider_unavailable',
      };
    case 'refused':
      return { kind: 'human_required', reason: 'judgment_refused' };
    case 'revision_required':
      switch (result.reason) {
        case 'placeholder':
          return { kind: 'human_required', reason: 'judgment_placeholder_prose' };
        case 'halt':
          return { kind: 'human_required', reason: 'judgment_halt_prose' };
        case 'structurally_incomplete':
          return { kind: 'human_required', reason: 'judgment_malformed_prose' };
      }
  }
}

/**
 * The narrow Task 7 coordinator seam: observe first, stop on deterministic
 * blockers, and only then cross the injected judgment boundary.
 */
export async function advanceFinishPublication(
  input: AdvanceFinishPublicationInput,
): Promise<AdvanceFinishPublicationResult> {
  const snapshot = await input.observe();
  const preflight = preflightFinishPublication(snapshot);
  if (preflight.kind === 'blocked') {
    return { kind: 'publication_retry', condition: preflight.condition };
  }

  if (snapshot.pr.identity === 'ambiguous') {
    return { kind: 'human_required', reason: 'ambiguous_pr_identity' };
  }

  if (nextFinishPublicationTransition(snapshot) === 'establish_pr') {
    if (!input.effects.establishPr) {
      return {
        kind: 'publication_retry',
        transition: 'establish_pr',
        reason: 'draft_pr_effect_unavailable',
      };
    }

    const draftPr = await openShipDraftPr(input.effects.establishPr);
    const observedAfterEstablish = await input.observe();
    if (
      observedAfterEstablish.pr.identity === 'one' &&
      observedAfterEstablish.branchPushed === 'valid'
    ) {
      return { kind: 'advanced', transition: 'establish_pr' };
    }
    if (observedAfterEstablish.pr.identity === 'ambiguous') {
      return { kind: 'human_required', reason: 'ambiguous_pr_identity' };
    }

    return {
      kind: 'publication_retry',
      transition: 'establish_pr',
      reason:
        draftPr.outcome === 'published'
          ? 'pr_identity_not_verified_after_establish'
          : `draft_pr_${draftPr.outcome}`,
    };
  }

  if (nextFinishPublicationTransition(snapshot) === 'write_shipped_record') {
    // An invalid record can be a different feature's evidence, a stale hash,
    // or an unpushed/malformed write. Replacing it would destroy the only
    // diagnostic evidence, so require a human resolution rather than trying
    // to overwrite it.
    if (snapshot.shippedRecord === 'invalid') {
      return { kind: 'human_required', reason: 'invalid_shipped_record' };
    }
    if (!input.effects.createShippedRecord) {
      return {
        kind: 'publication_retry',
        transition: 'write_shipped_record',
        reason: 'shipped_record_effect_unavailable',
      };
    }

    let writeFailure: unknown;
    try {
      await input.effects.createShippedRecord();
    } catch (error) {
      // A response can be lost after a successful push. The mandatory
      // re-observation below distinguishes that case from an actual failure.
      writeFailure = error;
    }

    const observedAfterWrite = await input.observe();
    if (observedAfterWrite.shippedRecord === 'valid') {
      return { kind: 'advanced', transition: 'write_shipped_record' };
    }
    if (observedAfterWrite.shippedRecord === 'invalid') {
      return { kind: 'human_required', reason: 'invalid_shipped_record' };
    }
    return {
      kind: 'publication_retry',
      transition: 'write_shipped_record',
      reason: writeFailure
        ? 'shipped_record_write_failed'
        : 'shipped_record_not_verified_after_write',
    };
  }

  if (isPrProseJudgmentNeeded(snapshot.pr)) {
    try {
      return mapPrProseJudgmentResult(
        await input.effects.dispatchJudgment(prProseJudgmentRequest(snapshot.pr)),
      );
    } catch {
      // The dispatcher can lose its response after the provider has returned.
      // Re-observation on the next FINISH pass is authoritative, so retain the
      // already verified PR and shipped-record effects and retry only judgment.
      return {
        kind: 'publication_retry',
        transition: 'judge_pr_prose',
        reason: 'judgment_dispatch_failed',
      };
    }
  }

  return { kind: 'advanced', transition: nextFinishPublicationTransition(snapshot) };
}

/**
 * Parses the interactive host's raw choice without advancing publication.
 * Only PR and keep are representable as coordinator intents; deferred,
 * declined, and destructive choices remain explicit human decisions.
 */
export function resolveInteractivePublicationIntent(
  choice: unknown,
): InteractivePublicationIntent | Extract<PublicationDisposition, { kind: 'human_required' }> {
  switch (choice) {
    case 'pr':
    case 'keep':
      return {
        outcome: choice,
        authority: { kind: 'operator_confirmed', mode: 'interactive' },
      };
    case 'defer':
      return { kind: 'human_required', reason: 'interactive_intent_deferred' };
    case 'decline':
      return { kind: 'human_required', reason: 'interactive_intent_declined' };
    case 'merge-local':
    case 'merge':
    case 'discard':
      return { kind: 'human_required', reason: 'interactive_intent_destructive_choice' };
    default:
      return { kind: 'human_required', reason: 'interactive_intent_unrecognized' };
  }
}

/**
 * Resolves the existing unattended policy without probing or mutating any
 * external boundary. Daemon runs are PR-only; foreground auto keeps committed
 * work when remote publication is not available. Neither policy may synthesize
 * an operator-only destructive outcome.
 */
export function resolveUnattendedPublicationIntent(
  input: UnattendedPublicationIntentInput,
): DaemonPublicationIntent | ForegroundAutoPublicationIntent | Extract<PublicationDisposition, { kind: 'human_required' }> {
  const { mode, capabilities, requestedOutcome } = input;

  if (
    requestedOutcome === 'merge' ||
    requestedOutcome === 'merge-local' ||
    requestedOutcome === 'discard'
  ) {
    return { kind: 'human_required', reason: 'unattended_intent_destructive_choice' };
  }

  if (mode === 'daemon') {
    if (requestedOutcome !== undefined && requestedOutcome !== 'pr') {
      return { kind: 'human_required', reason: 'unattended_intent_unauthorized_outcome' };
    }
    return { outcome: 'pr', authority: { kind: 'unattended_policy', mode: 'daemon' } };
  }

  const publicationAvailable =
    capabilities.remote === 'configured' && capabilities.authentication === 'authenticated';
  const outcome = publicationAvailable ? 'pr' : 'keep';
  if (requestedOutcome !== undefined && requestedOutcome !== outcome) {
    return { kind: 'human_required', reason: 'unattended_intent_unauthorized_outcome' };
  }
  if (publicationAvailable) {
    return { outcome: 'pr', authority: { kind: 'unattended_policy', mode: 'foreground-auto' } };
  }
  return { outcome: 'keep', authority: { kind: 'unattended_policy', mode: 'foreground-auto' } };
}
