import {
  openShipDraftPr,
  type OpenShipDraftPrDeps,
} from './ship-draft-pr.js';
import type {
  FinishPublicationEvent,
  FinishPublicationTransition,
} from '../types/events.js';

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
function validatePublicationSnapshot(
  snapshot: PublicationSnapshot,
): PublicationSnapshotValidation {
  if (
    snapshot.intent.outcome !== 'keep' &&
    snapshot.outcomeRecord === 'valid' &&
    snapshot.pr.identity === 'none'
  ) {
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

export type PublicationTransition = FinishPublicationTransition;

/**
 * A FINISH execution may observe every transition twice before a non-converging
 * publication state requires operator review.
 */
export const FINISH_PUBLICATION_PROGRESS_ALLOWANCE = 2 * 7;

type PublicationEventEmitter = (event: FinishPublicationEvent) => void | Promise<void>;

/**
 * Selects the first publication effect still required by a closed snapshot.
 * Every result is a resumable transition; the coordinator owns performing it
 * and obtaining the next authoritative snapshot.
 */
export function nextFinishPublicationTransition(
  snapshot: PublicationSnapshot,
): PublicationTransition {
  // An authorized keep outcome deliberately has no GitHub identity. Its
  // durable finish record is the only remaining publication transition; do
  // not manufacture a PR merely to satisfy the PR publication ordering.
  if (snapshot.intent.outcome === 'keep') {
    return 'record_outcome';
  }

  if (snapshot.pr.identity !== 'one' || snapshot.branchPushed !== 'valid') {
    return 'establish_pr';
  }

  if (snapshot.releaseReadiness !== 'valid') {
    return 'verify_release_readiness';
  }

  // A placeholder body is deterministically unauthored: the SHIP-entry draft
  // carries the engine's own body-floor marker and "not yet authored" sections.
  // Nothing can judge prose that was never written, so author it FIRST. The
  // judgment transition therefore only ever sees authored prose.
  if (snapshot.pr.prose === 'placeholder') {
    return 'author_pr_prose';
  }

  if (snapshot.pr.prose !== 'accepted') {
    return 'judge_pr_prose';
  }

  // The shipped record is `daemon-backlog`'s dedup key, so it is committed only
  // AFTER prose is accepted. Writing it earlier made every prose halt
  // unrecoverable: the feature was deduped as shipped and FINISH was never
  // re-dispatched to fix the prose the halt was asking a human about.
  if (snapshot.shippedRecord !== 'valid') {
    return 'write_shipped_record';
  }

  if (!snapshot.pr.ready) {
    return 'ready_pr';
  }

  return 'record_outcome';
}

export type HumanRequiredReason =
  | 'judgment_refused'
  | 'judgment_halt_prose'
  | 'ambiguous_pr_identity'
  | 'invalid_shipped_record'
  | 'interactive_intent_deferred'
  | 'interactive_intent_declined'
  | 'interactive_intent_destructive_choice'
  | 'interactive_intent_unrecognized'
  | 'unattended_intent_destructive_choice'
  | 'unattended_intent_unauthorized_outcome';

export type PublicationDisposition =
  | { kind: 'complete' }
  | { kind: 'publication_progress'; transition: PublicationTransition }
  | { kind: 'publication_retry'; transition: PublicationTransition; reason: string }
  | { kind: 'publication_retry'; condition: PublicationCondition }
  | { kind: 'implementation_invalid'; evidence: string }
  | { kind: 'human_required'; reason: HumanRequiredReason; detail?: string };

/** The only actions the conductor may take for a typed FINISH result. */
export type FinishPublicationRoute =
  | { kind: 'complete' }
  | { kind: 'progress_finish'; transition: PublicationTransition }
  | { kind: 'retry_finish'; reason: string }
  | { kind: 'retry_build'; evidence: string }
  | { kind: 'halt'; reason: string };

const PUBLICATION_CONDITIONS = {
  publication_snapshot_incoherent: {
    message: 'Publication evidence is contradictory. Resolve the cited publication state, then retry FINISH.',
    nextAction: 'resolve_publication_state',
  },
  publication_snapshot_indeterminate: {
    message: 'Publication evidence could not be determined. Restore the evidence observer, then retry FINISH.',
    nextAction: 'restore_publication_observation',
  },
  implementation_evidence_invalid: {
    message: 'Implementation evidence is invalid. Re-run the BUILD verification, then retry FINISH.',
    nextAction: 'rerun_build_verification',
  },
  implementation_evidence_indeterminate: {
    message: 'Implementation evidence could not be determined. Restore the implementation evidence observer, then retry FINISH.',
    nextAction: 'restore_implementation_observation',
  },
  ship_evidence_invalid: {
    message: 'SHIP evidence is invalid. Re-run the SHIP validators, then retry FINISH.',
    nextAction: 'rerun_ship_validators',
  },
  ship_evidence_indeterminate: {
    message: 'SHIP evidence could not be determined. Restore the SHIP evidence observer, then retry FINISH.',
    nextAction: 'restore_ship_observation',
  },
  release_readiness_missing: {
    message: 'Release readiness is missing. Publish a valid release readiness result, then retry FINISH.',
    nextAction: 'publish_release_readiness',
  },
  release_readiness_invalid: {
    message: 'Release readiness is invalid. Restore a valid release readiness result, then retry FINISH.',
    nextAction: 'restore_release_readiness',
  },
  release_readiness_indeterminate: {
    message: 'Release readiness could not be determined. Restore the readiness observer, then retry FINISH.',
    nextAction: 'restore_release_readiness_observation',
  },
} as const;

export const HUMAN_REQUIRED_REASONS = {
  judgment_refused: {
    message: 'The PR prose judgment was refused and requires an operator decision.',
    nextAction: 'Review the refusal and decide how to continue publication.',
  },
  judgment_halt_prose: {
    message: 'The PR contains halt prose that must not be overwritten automatically.',
    nextAction: 'Review the halt prose and resolve its stated blocker.',
  },
  ambiguous_pr_identity: {
    message: 'More than one pull request matches this feature, so FINISH cannot select one safely.',
    nextAction: 'Identify the correct pull request and resolve the duplicate matches.',
  },
  invalid_shipped_record: {
    message: 'The existing shipped record is invalid and cannot be replaced automatically.',
    nextAction: 'Inspect and repair the shipped record before retrying FINISH.',
  },
  interactive_intent_deferred: {
    message: 'Publication was deferred and requires an operator decision before FINISH can continue.',
    nextAction: 'Choose whether to publish the pull request or keep the work.',
  },
  interactive_intent_declined: {
    message: 'Publication was declined and requires an operator decision before FINISH can continue.',
    nextAction: 'Choose whether to publish the pull request or keep the work.',
  },
  interactive_intent_destructive_choice: {
    message: 'The requested publication outcome is destructive and requires explicit human action.',
    nextAction: 'Perform the destructive action manually or choose a safe publication outcome.',
  },
  interactive_intent_unrecognized: {
    message: 'The requested interactive publication outcome is not recognized.',
    nextAction: 'Choose a supported publication outcome.',
  },
  unattended_intent_destructive_choice: {
    message: 'Unattended publication cannot perform the requested destructive outcome.',
    nextAction: 'Perform the destructive action manually or choose a safe unattended outcome.',
  },
  unattended_intent_unauthorized_outcome: {
    message: 'The requested publication outcome is not authorized by the unattended policy.',
    nextAction: 'Choose the outcome allowed by the current unattended policy.',
  },
} satisfies Record<HumanRequiredReason, { message: string; nextAction: string }>;

const PUBLICATION_RETRY_REASONS: Record<PublicationTransition, readonly string[]> = {
  establish_pr: [
    'draft_pr_effect_unavailable',
    'draft_pr_skipped',
    'draft_pr_no-commits',
    'draft_pr_push-failed',
    // The establish_pr push is lease-protected (the finish-time rebase rewrote
    // the branch). A REJECTED lease is kept as its own reason: it means the
    // remote carries work this checkout never saw, which is an operator-visible
    // condition distinct from an ordinary push failure.
    'draft_pr_lease-rejected',
    'draft_pr_failed',
    'pr_url_persistence_failed',
    'pr_identity_not_verified_after_establish',
  ],
  verify_release_readiness: [],
  author_pr_prose: [
    'authoring_effect_unavailable',
    'authoring_dispatch_failed',
    'authoring_not_verified_after_pass',
    // The judgment pass observed prose the deterministic classifier accepted as
    // authored but the reader-facing verdict did not. Authoring — not a human —
    // is the remedy, so the coordinator routes back to it rather than halting.
    'authoring_required_after_judgment',
  ],
  write_shipped_record: [
    'shipped_record_effect_unavailable',
    'shipped_record_write_failed',
    'shipped_record_not_verified_after_write',
  ],
  judge_pr_prose: [
    'judgment_timed_out',
    'judgment_provider_unavailable',
    'judgment_dispatch_failed',
    // An undecodable provider reply is NOT a verdict. It is kept distinct from
    // the `structurally_incomplete` verdict it used to be collapsed into, so an
    // unparsable response earns a fresh judgment session instead of halting a
    // feature whose prose may be perfectly fine.
    'judgment_malformed_response',
    'judgment_completed_reobserve',
  ],
  ready_pr: [
    'presentation_repair_effect_unavailable',
    'presentation_repair_failed',
    'presentation_not_verified_after_repair',
  ],
  record_outcome: [
    'outcome_record_effect_unavailable',
    'outcome_record_write_failed',
    'outcome_record_not_verified_after_write',
  ],
};

/**
 * Publication retry reasons that re-running the identical transition can NEVER
 * satisfy, mapped to the operator-facing explanation of why.
 *
 * Between FINISH attempts the conductor re-enters `finishPublication.advance`
 * and nothing else: the provider is dispatched only for the `judge_pr_prose`
 * transition, so no retry authors a commit, wires a missing effect, moves a
 * branch, or reconciles a remote. For the reasons below the retry is therefore
 * a guaranteed re-derivation of the same failure — the run used to spend its
 * whole publication budget (~9s an attempt) to reach exactly the halt it could
 * have taken on the first observation.
 *
 * Membership is DELIBERATELY narrow. Anything that can succeed on a second
 * attempt — transport (`*push-failed*`), GitHub (`draft_pr_failed`), filesystem
 * (`*_write_failed`, `pr_url_persistence_failed`), provider judgment, and every
 * `*_not_verified_after_*` re-observation — keeps its retries.
 */
const NON_RETRYABLE_PUBLICATION_REASONS: Readonly<Record<string, string>> = {
  draft_pr_effect_unavailable:
    'the establish-PR effect is not wired into this coordinator, and the effect set is identical on every attempt',
  shipped_record_effect_unavailable:
    'the shipped-record effect is not wired into this coordinator, and the effect set is identical on every attempt',
  authoring_effect_unavailable:
    'the PR-prose authoring effect is not wired into this coordinator, and the effect set is identical on every attempt',
  presentation_repair_effect_unavailable:
    'the presentation-repair effect is not wired into this coordinator, and the effect set is identical on every attempt',
  outcome_record_effect_unavailable:
    'the outcome-record effect is not wired into this coordinator, and the effect set is identical on every attempt',
  'draft_pr_no-commits':
    'the feature branch has no commits over its base, and no FINISH retry authors commits',
  draft_pr_skipped:
    'the publisher could not resolve a branch, a base, or the comparison between them (no branch recorded, detached HEAD, or an unresolvable base ref), and no FINISH retry changes any of them',
  'draft_pr_lease-rejected':
    'the remote branch carries commits this checkout has never observed; the same lease is refused identically on every attempt, and forcing past it would destroy that work',
};

/**
 * Classify a publication retry reason for fail-fast halting.
 *
 * Returns the operator-facing explanation when the reason is provably
 * non-retryable, and `undefined` otherwise.
 *
 * **Fails CLOSED toward retrying.** Only reasons explicitly listed in
 * {@link NON_RETRYABLE_PUBLICATION_REASONS} are recognised — an unknown,
 * malformed, or future reason keeps its full retry budget, because wrongly
 * fail-fasting a healthy run is far more damaging than spending retries on a
 * doomed one.
 */
export function nonRetryablePublicationReason(reason: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(NON_RETRYABLE_PUBLICATION_REASONS, reason)
    ? NON_RETRYABLE_PUBLICATION_REASONS[reason]
    : undefined;
}

function renderHumanRequiredHaltReason(
  disposition: Extract<PublicationDisposition, { kind: 'human_required' }>,
): string {
  const guidance = HUMAN_REQUIRED_REASONS[disposition.reason] as
    | { message: string; nextAction: string }
    | undefined;
  if (!guidance) {
    return `Human-required reason ${disposition.reason}: no guidance is registered.`;
  }
  const { message, nextAction } = guidance;
  const detail = disposition.detail ? ` Detail: ${disposition.detail}` : '';
  return `${message} Next action: ${nextAction}${detail}`;
}

/**
 * Fail-closed boundary between the publication coordinator and conductor.
 * Publication-only work may retry FINISH, while every other currently-known
 * outcome remains local to FINISH until its dedicated routing rule exists.
 *
 * `unknown` is intentional: the boundary can receive a malformed result from
 * a future adapter, so compile-time exhaustiveness alone is insufficient.
 */
export function routeFinishPublicationDisposition(
  disposition: unknown,
): FinishPublicationRoute {
  if (!isExactDisposition(disposition)) {
    return {
      kind: 'halt',
      reason: 'Unknown or contradictory FINISH publication disposition; human review required.',
    };
  }

  switch (disposition.kind) {
    case 'complete':
      return { kind: 'complete' };
    case 'publication_progress':
      return { kind: 'progress_finish', transition: disposition.transition };
    case 'publication_retry':
      if (
        'condition' in disposition &&
        (disposition.condition.code === 'implementation_evidence_invalid' ||
          disposition.condition.code === 'implementation_evidence_indeterminate' ||
          disposition.condition.code === 'ship_evidence_invalid' ||
          disposition.condition.code === 'ship_evidence_indeterminate')
      ) {
        return {
          kind: 'halt',
          reason:
            'FINISH evidence-invalid disposition requires its dedicated BUILD routing rule: ' +
            disposition.condition.code,
        };
      }
      return {
        kind: 'retry_finish',
        reason: 'reason' in disposition ? disposition.reason : disposition.condition.code,
      };
    case 'implementation_invalid':
      return {
        kind: 'retry_build',
        evidence: disposition.evidence,
      };
    case 'human_required':
      return { kind: 'halt', reason: renderHumanRequiredHaltReason(disposition) };
  }
}

export function isExactDisposition(
  disposition: unknown,
): disposition is PublicationDisposition {
  if (!disposition || typeof disposition !== 'object' || Array.isArray(disposition)) return false;
  const value = disposition as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  const hasOnly = (...expected: string[]) =>
    keys.length === expected.length && keys.every((key, index) => key === expected.sort()[index]);

  switch (value.kind) {
    case 'complete':
      return hasOnly('kind');
    case 'publication_progress':
      return hasOnly('kind', 'transition') && isPublicationTransition(value.transition);
    case 'publication_retry':
      if (hasOnly('kind', 'transition', 'reason')) {
        return (
          isPublicationTransition(value.transition) &&
          typeof value.reason === 'string' &&
          PUBLICATION_RETRY_REASONS[value.transition].includes(value.reason)
        );
      }
      return (
        hasOnly('kind', 'condition') &&
        isPublicationCondition(value.condition)
      );
    case 'implementation_invalid':
      return (
        hasOnly('kind', 'evidence') &&
        typeof value.evidence === 'string' &&
        value.evidence.trim().length > 0
      );
    case 'human_required':
      return (
        typeof value.reason === 'string' &&
        value.reason.length > 0 &&
        (
          hasOnly('kind', 'reason') ||
          (
            hasOnly('kind', 'reason', 'detail') &&
            typeof value.detail === 'string' &&
            value.detail.trim().length > 0
          )
        )
      );
    default:
      return false;
  }
}

function isPublicationTransition(value: unknown): value is PublicationTransition {
  return (
    value === 'establish_pr' ||
    value === 'verify_release_readiness' ||
    value === 'write_shipped_record' ||
    value === 'author_pr_prose' ||
    value === 'judge_pr_prose' ||
    value === 'ready_pr' ||
    value === 'record_outcome'
  );
}

function isPublicationCondition(value: unknown): value is PublicationCondition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const condition = value as Record<string, unknown>;
  const expected =
    typeof condition.code === 'string'
      ? PUBLICATION_CONDITIONS[condition.code as keyof typeof PUBLICATION_CONDITIONS]
      : undefined;
  return (
    typeof condition.message === 'string' &&
    typeof condition.nextAction === 'string' &&
    expected?.message === condition.message &&
    expected.nextAction === condition.nextAction &&
    Object.keys(condition).length === 3
  );
}

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
function preflightFinishPublication(
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

/**
 * The one provider-owned FINISH *authoring* request. It is selected
 * deterministically — `prose === 'placeholder'` is the engine's own
 * observation of its own body-floor marker — so no prompt discipline decides
 * whether prose gets written. The provider's self-report is not trusted: the
 * coordinator verifies the pass by re-observing the PR.
 */
export type PrProseAuthoringRequest = {
  kind: 'finish_pr_prose_authoring';
  pullRequestUrl: string;
  authoringScope: readonly ['title', 'body'];
  maximumPasses: 1;
};

/**
 * The bounded provider result, including fail-closed judgment outcomes.
 *
 * `revision_required` carries a real verdict the provider reached.
 * `malformed_response` is the decoder's fail-closed fallback for a reply it
 * could not parse at all — deliberately NOT collapsed into
 * `structurally_incomplete`, because the two need opposite routing.
 */
export type PrProseJudgmentResult =
  | { kind: 'accepted' }
  | {
    kind: 'revision_required';
    reason: 'placeholder' | 'halt' | 'structurally_incomplete';
    detail?: string;
  }
  | { kind: 'timed_out' }
  | { kind: 'provider_unavailable' }
  | { kind: 'refused'; detail?: string }
  | { kind: 'malformed_response' };

/**
 * The coordinator passes only an already-authorized outcome to the existing
 * fail-closed recorder. Path validation and marker-last persistence remain
 * inside that boundary; this domain layer never writes completion files.
 */
export type FinishOutcomeRecordRequest =
  | { choice: 'pr'; prUrl: string }
  | { choice: 'keep' };

type PrWithJudgmentNeeded = Extract<PublicationPullRequest, { identity: 'one' }> & {
  prose: 'stale' | 'halt' | 'indeterminate';
};

type PrWithAuthoringNeeded = Extract<PublicationPullRequest, { identity: 'one' }> & {
  prose: 'placeholder';
};

/**
 * A typed predicate protects the expensive boundary: accepted observed prose
 * is final for this pass, while a stale or incomplete observation earns one
 * request. A placeholder body is excluded — it has no prose to judge and is
 * routed to the authoring transition instead. The predicate performs no
 * provider work itself.
 */
function isPrProseJudgmentNeeded(
  pr: PublicationPullRequest,
): pr is PrWithJudgmentNeeded {
  return pr.identity === 'one' && pr.prose !== 'accepted' && pr.prose !== 'placeholder';
}

/** The deterministic complement: an unauthored body needs an authoring pass. */
function isPrProseAuthoringNeeded(
  pr: PublicationPullRequest,
): pr is PrWithAuthoringNeeded {
  return pr.identity === 'one' && pr.prose === 'placeholder';
}

function prProseAuthoringRequest(pr: PrWithAuthoringNeeded): PrProseAuthoringRequest {
  return {
    kind: 'finish_pr_prose_authoring',
    pullRequestUrl: pr.url,
    authoringScope: ['title', 'body'],
    maximumPasses: 1,
  };
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
  /** Best-effort, closed publication progress telemetry supplied by the composition root. */
  emit?: PublicationEventEmitter;
  effects: {
    dispatchJudgment(request: PrProseJudgmentRequest): Promise<PrProseJudgmentResult>;
    /**
     * Author the retained PR's reader-facing title and body from the feature's
     * own diff and specification context. Optional only so an isolated caller
     * that never observes a placeholder body need not wire it; reaching the
     * transition without it is reported as an unwired effect, never skipped.
     * Its return value is ignored: the coordinator re-observes the PR and
     * accepts the transition only when the body is no longer a placeholder.
     */
    authorProse?: (request: PrProseAuthoringRequest) => Promise<void>;
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
    /**
     * Persist the authoritative URL returned by a successful draft-PR
     * establishment before the coordinator re-observes PR identity. The
     * composition root owns its durable feature-state representation.
     */
    persistEstablishedPrUrl?: (prUrl: string) => Promise<void>;
    /**
     * Existing order-gated PR presentation repair. The composition root owns
     * the GitHub mechanics (halt rehabilitation, title/body floors, and the
     * draft-to-ready flip); this coordinator invokes it only after accepted
     * prose has been observed and verifies its result by re-observation.
     */
    repairPresentation?: () => Promise<void>;
    /**
     * Adapter for the existing finish-record primitive. It owns durable writes
     * and refuses unsafe paths; the coordinator owns observe-before-record and
     * re-observation after any interrupted response.
     */
    recordOutcome?: (request: FinishOutcomeRecordRequest) => Promise<void>;
  };
}

export type AdvanceFinishPublicationResult =
  | { kind: 'complete' }
  | { kind: 'advanced'; transition: PublicationTransition }
  | { kind: 'implementation_invalid'; evidence: string }
  | { kind: 'publication_retry'; condition: PublicationCondition }
  | {
      kind: 'publication_retry';
      transition: PublicationTransition;
      reason: string;
    }
  | {
      kind: 'publication_retry';
      transition: 'record_outcome';
      reason:
        | 'outcome_record_effect_unavailable'
        | 'outcome_record_write_failed'
        | 'outcome_record_not_verified_after_write';
    }
  | {
      kind: 'human_required';
      reason: 'ambiguous_pr_identity' | 'invalid_shipped_record';
    }
  | {
      kind: 'human_required';
      reason: 'judgment_halt_prose' | 'judgment_refused';
      detail?: string;
    };

/**
 * The effects object is the composition root's stable identity for one
 * publication attempt. Coalescing by that identity prevents two resumptions
 * in the same process from crossing the same mutation boundary concurrently.
 * Each winner still verify-after-writes; followers receive that authoritative
 * reconciliation rather than repeating a create, record, presentation, or
 * marker effect.
 */
const activePublicationEffects = new WeakMap<
  AdvanceFinishPublicationInput['effects'],
  Map<PublicationTransition, Promise<AdvanceFinishPublicationResult>>
>();

async function coalescePublicationEffect(
  effects: AdvanceFinishPublicationInput['effects'],
  transition: PublicationTransition,
  advance: () => Promise<AdvanceFinishPublicationResult>,
): Promise<AdvanceFinishPublicationResult> {
  let activeForPublication = activePublicationEffects.get(effects);
  if (!activeForPublication) {
    activeForPublication = new Map();
    activePublicationEffects.set(effects, activeForPublication);
  }

  const active = activeForPublication.get(transition);
  if (active) return active;

  const winner = advance();
  activeForPublication.set(transition, winner);
  try {
    return await winner;
  } finally {
    if (activeForPublication.get(transition) === winner) {
      activeForPublication.delete(transition);
    }
    if (activeForPublication.size === 0) activePublicationEffects.delete(effects);
  }
}

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
      return result.detail === undefined
        ? { kind: 'human_required', reason: 'judgment_refused' }
        : { kind: 'human_required', reason: 'judgment_refused', detail: result.detail };
    case 'malformed_response':
      // The decoder could not parse the reply at all. That is a provider
      // response defect, not a prose verdict, so it earns a fresh judgment
      // session rather than a halt on prose nobody actually judged.
      return {
        kind: 'publication_retry',
        transition: 'judge_pr_prose',
        reason: 'judgment_malformed_response',
      };
    case 'revision_required':
      switch (result.reason) {
        case 'halt':
          // Halt boilerplate on a PR is a genuine operator condition: the
          // remediation narrative must not be silently overwritten by an
          // authoring pass.
          return result.detail === undefined
            ? { kind: 'human_required', reason: 'judgment_halt_prose' }
            : { kind: 'human_required', reason: 'judgment_halt_prose', detail: result.detail };
        case 'placeholder':
        case 'structurally_incomplete':
          // Both verdicts say the same thing — the reader-facing prose is not
          // there yet. Authoring is the remedy, and it is exactly the pass the
          // judge was never equipped to perform. Bounded by the publication
          // progress allowance, so a non-converging pair still halts.
          return {
            kind: 'publication_retry',
            transition: 'author_pr_prose',
            reason: 'authoring_required_after_judgment',
          };
      }
  }
}

async function emitPublicationEvent(
  emit: PublicationEventEmitter | undefined,
  event: FinishPublicationEvent,
): Promise<void> {
  try {
    await emit?.(event);
  } catch {
    // Observability must not alter a verified publication disposition.
  }
}

async function advancedPublicationTransition(
  emit: PublicationEventEmitter | undefined,
  transition: PublicationTransition,
): Promise<Extract<AdvanceFinishPublicationResult, { kind: 'advanced' }>> {
  await emitPublicationEvent(emit, {
    type: 'finish_publication_transition', phase: 'completed', transition,
  });
  return { kind: 'advanced', transition };
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
    await emitPublicationEvent(input.emit, {
      type: 'finish_publication_blocked',
      condition: preflight.condition.code,
    });
    if (preflight.condition.code === 'implementation_evidence_invalid') {
      return {
        kind: 'implementation_invalid',
        evidence: `${preflight.condition.code}: ${preflight.condition.message}`,
      };
    }
    return { kind: 'publication_retry', condition: preflight.condition };
  }

  if (snapshot.pr.identity === 'ambiguous') {
    return { kind: 'human_required', reason: 'ambiguous_pr_identity' };
  }

  if (nextFinishPublicationTransition(snapshot) === 'establish_pr') {
    return coalescePublicationEffect(input.effects, 'establish_pr', async () => {
      if (!input.effects.establishPr) {
        return {
          kind: 'publication_retry',
          transition: 'establish_pr',
          reason: 'draft_pr_effect_unavailable',
        };
      }

      await emitPublicationEvent(input.emit, {
        type: 'finish_publication_transition', phase: 'started', transition: 'establish_pr',
      });

      const draftPr = await openShipDraftPr(input.effects.establishPr);
      if (draftPr.outcome === 'published' && input.effects.persistEstablishedPrUrl) {
        try {
          await input.effects.persistEstablishedPrUrl(draftPr.prUrl);
        } catch {
          return {
            kind: 'publication_retry',
            transition: 'establish_pr',
            reason: 'pr_url_persistence_failed',
          };
        }
      }
      const observedAfterEstablish = await input.observe();
      if (
        observedAfterEstablish.pr.identity === 'one' &&
        observedAfterEstablish.branchPushed === 'valid'
      ) {
        return advancedPublicationTransition(input.emit, 'establish_pr');
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
    });
  }

  if (isPrProseAuthoringNeeded(snapshot.pr)) {
    const pr = snapshot.pr;
    if (!input.effects.authorProse) {
      return {
        kind: 'publication_retry',
        transition: 'author_pr_prose',
        reason: 'authoring_effect_unavailable',
      };
    }

    await emitPublicationEvent(input.emit, {
      type: 'finish_publication_transition', phase: 'started', transition: 'author_pr_prose',
    });
    return coalescePublicationEffect(input.effects, 'author_pr_prose', async () => {
      let dispatchFailure = false;
      try {
        await input.effects.authorProse!(prProseAuthoringRequest(pr));
      } catch {
        // A dispatcher can lose its response after the provider already edited
        // the PR. The mandatory re-observation below is the only authority.
        dispatchFailure = true;
      }

      const observedAfterAuthoring = await input.observe();
      if (observedAfterAuthoring.pr.identity === 'ambiguous') {
        return { kind: 'human_required', reason: 'ambiguous_pr_identity' };
      }
      if (
        observedAfterAuthoring.pr.identity === 'one' &&
        observedAfterAuthoring.pr.prose !== 'placeholder' &&
        observedAfterAuthoring.pr.prose !== 'indeterminate'
      ) {
        return advancedPublicationTransition(input.emit, 'author_pr_prose');
      }

      return {
        kind: 'publication_retry',
        transition: 'author_pr_prose',
        reason: dispatchFailure
          ? 'authoring_dispatch_failed'
          : 'authoring_not_verified_after_pass',
      };
    });
  }

  if (isPrProseJudgmentNeeded(snapshot.pr)) {
    const pr = snapshot.pr;
    await emitPublicationEvent(input.emit, {
      type: 'finish_publication_transition', phase: 'started', transition: 'judge_pr_prose',
    });
    return coalescePublicationEffect(input.effects, 'judge_pr_prose', async () => {
      try {
        const result = mapPrProseJudgmentResult(
          await input.effects.dispatchJudgment(prProseJudgmentRequest(pr)),
        );
        return result.kind === 'advanced'
          ? advancedPublicationTransition(input.emit, 'judge_pr_prose')
          : result;
      } catch {
        // The dispatcher can lose its response after the provider has returned.
        // Re-observation on the next FINISH pass is authoritative, so retain the
        // already verified PR effects and retry only judgment.
        return {
          kind: 'publication_retry',
          transition: 'judge_pr_prose',
          reason: 'judgment_dispatch_failed',
        };
      }
    });
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

    await emitPublicationEvent(input.emit, {
      type: 'finish_publication_transition', phase: 'started', transition: 'write_shipped_record',
    });
    return coalescePublicationEffect(input.effects, 'write_shipped_record', async () => {
      let writeFailure: unknown;
      try {
        await input.effects.createShippedRecord!();
      } catch (error) {
        // A response can be lost after a successful push. The mandatory
        // re-observation below distinguishes that case from an actual failure.
        writeFailure = error;
      }

      const observedAfterWrite = await input.observe();
      if (observedAfterWrite.shippedRecord === 'valid') {
        return advancedPublicationTransition(input.emit, 'write_shipped_record');
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
    });
  }

  if (nextFinishPublicationTransition(snapshot) === 'ready_pr') {
    if (!input.effects.repairPresentation) {
      return {
        kind: 'publication_retry',
        transition: 'ready_pr',
        reason: 'presentation_repair_effect_unavailable',
      };
    }

    await emitPublicationEvent(input.emit, {
      type: 'finish_publication_transition', phase: 'started', transition: 'ready_pr',
    });
    return coalescePublicationEffect(input.effects, 'ready_pr', async () => {
      try {
        await input.effects.repairPresentation!();
      } catch {
        return {
          kind: 'publication_retry',
          transition: 'ready_pr',
          reason: 'presentation_repair_failed',
        };
      }

      const observedAfterPresentationRepair = await input.observe();
      if (observedAfterPresentationRepair.pr.identity === 'ambiguous') {
        return { kind: 'human_required', reason: 'ambiguous_pr_identity' };
      }
      if (
        observedAfterPresentationRepair.pr.identity === 'one' &&
        observedAfterPresentationRepair.pr.prose === 'accepted' &&
        observedAfterPresentationRepair.pr.ready
      ) {
        return advancedPublicationTransition(input.emit, 'ready_pr');
      }

      return {
        kind: 'publication_retry',
        transition: 'ready_pr',
        reason: 'presentation_not_verified_after_repair',
      };
    });
  }

  if (nextFinishPublicationTransition(snapshot) === 'record_outcome') {
    // A previously observed terminal marker is already the durable commit
    // point. Repeating the recorder would be unnecessary and could obscure a
    // completed prior attempt.
    if (snapshot.outcomeRecord === 'valid') {
      return { kind: 'complete' };
    }
    if (!input.effects.recordOutcome) {
      return {
        kind: 'publication_retry',
        transition: 'record_outcome',
        reason: 'outcome_record_effect_unavailable',
      };
    }

    let recordRequest: FinishOutcomeRecordRequest;
    if (snapshot.intent.outcome === 'pr') {
      // `record_outcome` is reachable only after a single PR identity was
      // observed, but retain the check at the adapter boundary so a future
      // transition-order refactor cannot manufacture a PR URL.
      if (snapshot.pr.identity !== 'one') {
        return {
          kind: 'publication_retry',
          transition: 'record_outcome',
          reason: 'outcome_record_not_verified_after_write',
        };
      }
      recordRequest = { choice: 'pr', prUrl: snapshot.pr.url };
    } else {
      recordRequest = { choice: 'keep' };
    }

    await emitPublicationEvent(input.emit, {
      type: 'finish_publication_transition', phase: 'started', transition: 'record_outcome',
    });
    return coalescePublicationEffect(input.effects, 'record_outcome', async () => {
      let writeFailure = false;
      try {
        await input.effects.recordOutcome!(recordRequest);
      } catch {
        // The recorder can complete its marker write before its caller loses the
        // response. The observation below is authoritative in either case.
        writeFailure = true;
      }

      const observedAfterRecord = await input.observe();
      const observedPreflight = preflightFinishPublication(observedAfterRecord);
      if (
        observedPreflight.kind === 'ready_for_judgment' &&
        nextFinishPublicationTransition(observedAfterRecord) === 'record_outcome' &&
        observedAfterRecord.outcomeRecord === 'valid'
      ) {
        await emitPublicationEvent(input.emit, {
          type: 'finish_publication_transition', phase: 'completed', transition: 'record_outcome',
        });
        return { kind: 'complete' };
      }

      return {
        kind: 'publication_retry',
        transition: 'record_outcome',
        reason: writeFailure
          ? 'outcome_record_write_failed'
          : 'outcome_record_not_verified_after_write',
      };
    });
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
