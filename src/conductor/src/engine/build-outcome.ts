import type { EffortLevel } from '../types/config.js';

/** The tree-level outcome observed when a build step settles. */
export type BuildSettleOutcome = 'moved' | 'no-movement';

/** The terminal state reached by a build step. */
export type BuildTerminalOutcome = 'done' | 'failed' | 'no-verdict';

/** The model and reasoning-effort rung used for a build attempt. */
export interface BuildOutcomeRung {
  model: string;
  effort: EffortLevel;
}

/** Durable engine-authored observation of one build-step settle. */
export interface BuildOutcomeRecord {
  outcome: BuildSettleOutcome;
  terminalOutcome: BuildTerminalOutcome;
  gate: string | null;
  verdict: boolean | null;
  rung: BuildOutcomeRung;
  treeBefore: string | null;
  treeAfter: string | null;
  headBefore: string | null;
  headAfter: string | null;
  note?: string[];
  category?: string;
}

export interface ClassifyBuildSettleInput {
  treeBefore: string | null;
  treeAfter: string | null;
  resolvedBefore: number;
  resolvedAfter: number;
}

/** Classifies the tree/resolved-work movement observed during a build settle. */
export function classifyBuildSettle({
  treeBefore,
  treeAfter,
  resolvedBefore,
  resolvedAfter,
}: ClassifyBuildSettleInput): BuildSettleOutcome {
  if (treeBefore !== null && treeAfter !== null && treeBefore !== treeAfter) return 'moved';
  if (resolvedAfter > resolvedBefore) return 'moved';
  return 'no-movement';
}
