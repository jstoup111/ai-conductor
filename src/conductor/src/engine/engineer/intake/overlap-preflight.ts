import type { OverlapSuggestions, OverlapSuggestion, BranchOverlap } from './overlap-suggestions.js';
import type { ConductorEvent } from '../../../types/events.js';

export interface OverlapSkipNote {
  part: string;
  reason: string;
}

export type OverlapDecision =
  | {
    kind: 'proceed';
    accepted: string[];
    declined: string[];
    advisory: BranchOverlap[];
    skipNotes: OverlapSkipNote[];
    omittedCount: number;
  }
  | {
    kind: 'refused';
    undecided: OverlapSuggestion[];
    advisory: BranchOverlap[];
    skipNotes: OverlapSkipNote[];
    omittedCount: number;
  }
  | {
    kind: 'invalid-decline';
    invalid: string[];
    advisory: BranchOverlap[];
    skipNotes: OverlapSkipNote[];
    omittedCount: number;
  };

export interface OverlapPreflightInput {
  title: string;
  body: string;
  dependsOn: readonly string[];
  interactive: boolean;
  prompt?: (question: string) => Promise<string>;
}

/** The injected, read-only source of overlap suggestions for one filing. */
export interface OverlapPreflightDeps {
  suggestions: (input: OverlapPreflightInput) => Promise<OverlapSuggestions>;
  /** The CLI's existing canonical event spine; no overlap-specific log is opened. */
  events?: { emit(event: Extract<ConductorEvent, { type: 'intake_overlap_checked' }>): Promise<void> };
  /** The filing target recorded with the overlap decision when telemetry is enabled. */
  repository?: string;
}

/** Build the single, secret-safe overlap occurrence carried by the event spine. */
export function intakeOverlapCheckedEvent(
  repository: string,
  suggestions: OverlapSuggestions,
  decision: OverlapDecision,
): Extract<ConductorEvent, { type: 'intake_overlap_checked' }> {
  return {
    type: 'intake_overlap_checked',
    repository,
    outcome: decision.kind === 'proceed' ? 'proceeded' : decision.kind,
    suggested: [...suggestions.preAccepted, ...suggestions.shown].map(({ issue }) => issue),
    accepted: decision.kind === 'proceed' ? [...decision.accepted] : [],
    declined: decision.kind === 'proceed' ? [...decision.declined] : [],
    undecided: decision.kind === 'refused' ? decision.undecided.map(({ issue }) => issue) : [],
    advisoryCount: suggestions.advisory.length,
    skipped: decision.skipNotes.map(({ part, reason }) => ({ part, reason })),
  };
}

/**
 * The pre-creation decision boundary. Later tasks add acceptance, decline and
 * refusal choices; its first contract is that an empty suggestion set proceeds
 * without prompting or changing the creation transaction.
 */
export async function runOverlapPreflight(
  input: OverlapPreflightInput,
  deps: OverlapPreflightDeps,
): Promise<OverlapDecision> {
  const suggestions = await deps.suggestions(input);
  const decision: OverlapDecision = suggestions.shown.length > 0 && !input.interactive
    ? {
      kind: 'refused',
      undecided: [...suggestions.shown],
      advisory: [...suggestions.advisory],
      skipNotes: [],
      omittedCount: suggestions.omittedCount ?? 0,
    }
    : {
      kind: 'proceed',
      // A pre-accepted suggestion came from an existing --depends-on ref,
      // which fileIntakeIssue already links. Re-adding it here would submit
      // that dependency operation twice.
      accepted: [],
      declined: [],
      advisory: [...suggestions.advisory],
      skipNotes: [],
      omittedCount: suggestions.omittedCount ?? 0,
    };
  if (deps.events && deps.repository) {
    await deps.events.emit(intakeOverlapCheckedEvent(deps.repository, suggestions, decision));
  }
  return decision;
}
