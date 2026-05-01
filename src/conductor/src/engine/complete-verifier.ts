import { join } from 'node:path';
import type { ConductState, StepName } from '../types/index.js';
import { checkStepCompletion } from './artifacts.js';
import { readState } from './state.js';

/** Steps re-checked when a feature is marked complete on resume. */
const SHIP_GATING_STEPS: StepName[] = ['manual_test', 'retro', 'finish'];

export interface CompleteStateOk {
  ok: true;
}

export interface CompleteStateGap {
  ok: false;
  /** Step names whose completion predicate failed re-verification. */
  failedSteps: StepName[];
  /** Per-step "why" strings, in the same order as `failedSteps`. */
  reasons: string[];
}

export type CompleteStateVerification = CompleteStateOk | CompleteStateGap;

/**
 * Re-evaluate SHIP-phase completion predicates against the on-disk evidence
 * for a worktree marked `feature_status: 'complete'`. The classic version
 * of the conductor would set `feature_status='complete'` whenever the loop
 * walked all 14 steps without an early return — but cascading lax gates
 * meant the marker could land without the SHIP phase having genuinely run.
 *
 * This helper detects that case: any worktree whose state claims complete
 * but where manual_test / retro / finish predicates can't reproduce
 * `done: true` is "stale-complete" and should be rolled back.
 *
 * `sessionStartedAt` is intentionally NOT passed in; we use the worktree
 * state's persisted value (or undefined → predicates fail open). That way
 * a feature that legitimately completed in a previous session still verifies
 * — only the ones missing the underlying artifacts come back as gaps.
 */
export async function verifyCompleteState(
  worktreePath: string,
): Promise<CompleteStateVerification> {
  const stateRes = await readState(join(worktreePath, '.pipeline/conduct-state.json'));
  const state: ConductState = stateRes.ok ? stateRes.value : {};

  const ctx = {
    sessionStartedAt: state.session_started_at,
    featureDesc: state.feature_desc,
  };

  const failedSteps: StepName[] = [];
  const reasons: string[] = [];

  for (const step of SHIP_GATING_STEPS) {
    const result = await checkStepCompletion(worktreePath, step, ctx);
    if (!result.done) {
      failedSteps.push(step);
      reasons.push(result.reason ?? 'completion check failed');
    }
  }

  if (failedSteps.length === 0) return { ok: true };
  return { ok: false, failedSteps, reasons };
}

/**
 * Format a verification gap report for the terminal. Same wording for the
 * recovery prompt and `--diagnose` output, so users see the same diagnosis
 * either way.
 */
export function formatGapReport(
  featureDesc: string | undefined,
  worktreePath: string,
  gap: CompleteStateGap,
): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(
    `⚠  Feature ${featureDesc ? `"${featureDesc}"` : 'in this worktree'} is marked complete but evidence is missing:`,
  );
  for (let i = 0; i < gap.failedSteps.length; i++) {
    lines.push(`    - ${gap.failedSteps[i]}: ${gap.reasons[i]}`);
  }
  lines.push('');
  lines.push(`  Worktree: ${worktreePath}`);
  lines.push(
    '  This usually means a prior pipeline run exited mid-implementation without writing',
  );
  lines.push(
    '  the halt marker (skills/pipeline/SKILL.md "User-requested exit during a run"),',
  );
  lines.push('  cascading false-completion through the SHIP-phase steps.');
  lines.push('');
  return lines.join('\n');
}
