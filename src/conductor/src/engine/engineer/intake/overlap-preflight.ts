import type { OverlapSuggestions, OverlapSuggestion, BranchOverlap } from './overlap-suggestions.js';

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
  return {
    kind: 'proceed',
    accepted: [],
    declined: [],
    advisory: [...suggestions.advisory],
    skipNotes: [],
    omittedCount: suggestions.omittedCount ?? 0,
  };
}
