import { join } from 'node:path';
import type { ConductState, StepName } from '../types/index.js';
import { checkStepCompletion } from './artifacts.js';
import { FullSuiteVerifier, type FullSuiteInspectionResult } from './full-suite-verifier.js';
import { getStepStatus, readState } from './state.js';
import { listExistingChildren, type ChildId } from './child-context.js';
import { resolveActiveChild } from './child-cursor.js';
import { readConductStateOverlay } from './conduct-state-store.js';

/** Steps re-checked when a feature is marked complete on resume. */
const SHIP_GATING_STEPS: StepName[] = ['test_suite', 'manual_test', 'finish'];

export interface CompleteVerifierOptions {
  /** Process-free current-PASS inspection seam for test_suite. */
  fullSuiteInspect?: (activeChild?: { readonly child: ChildId; readonly isLeaf: boolean }) => Promise<FullSuiteInspectionResult>;
  /** Test seam for the cursor that identifies a stacked feature's leaf. */
  resolveActiveChild?: typeof resolveActiveChild;
}

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
 * but where test_suite / manual_test / finish predicates can't reproduce
 * `done: true` is "stale-complete" and should be rolled back.
 *
 * `sessionStartedAt` is intentionally NOT passed in; we use the worktree
 * state's persisted value (or undefined → predicates fail open). That way
 * a feature that legitimately completed in a previous session still verifies
 * — only the ones missing the underlying artifacts come back as gaps.
 */
export async function verifyCompleteState(
  worktreePath: string,
  options: CompleteVerifierOptions = {},
): Promise<CompleteStateVerification> {
  const stateRes = await readState(join(worktreePath, '.pipeline/conduct-state.json'));
  let state: ConductState = stateRes.ok ? stateRes.value : {};
  let activeChild: { readonly child: ChildId; readonly isLeaf: boolean } | undefined;

  // A completed stacked feature must be verified against its current leaf
  // overlay.  Do not probe ordinary legacy worktrees: the presence of a child
  // directory is the durable signal that this feature opted into child state.
  const children = await listExistingChildren(worktreePath);
  if (children.length > 0 && state.feature_desc) {
    const cursor = await (options.resolveActiveChild ?? resolveActiveChild)(
      worktreePath,
      state.feature_desc,
    );
    if (cursor.kind !== 'active' || !cursor.isLeaf) {
      return {
        ok: false,
        failedSteps: ['test_suite'],
        reasons: [
          cursor.kind === 'active'
            ? `stacked feature completion requires leaf child evidence, but child ${cursor.child} is not the leaf`
            : `stacked feature completion cannot resolve its leaf child: ${cursor.kind}`,
        ],
      };
    }
    const overlay = await readConductStateOverlay(worktreePath, cursor.child);
    if (!overlay.ok) {
      return {
        ok: false,
        failedSteps: ['test_suite'],
        reasons: [`stacked feature completion cannot read leaf child ${cursor.child} state: ${overlay.error.message}`],
      };
    }
    state = overlay.value;
    activeChild = { child: cursor.child, isLeaf: true };
  }

  const ctx = {
    sessionStartedAt: state.session_started_at,
    featureDesc: state.feature_desc,
    // SHIP-phase re-check: a changed-only lap PASS does not satisfy SHIP.
    fullSuiteInspect: () => options.fullSuiteInspect?.(activeChild) ??
      new FullSuiteVerifier({ projectRoot: worktreePath, ...(activeChild === undefined ? {} : { activeChild }) })
        .inspect({ requireAggregate: true }),
  };

  const failedSteps: StepName[] = [];
  const reasons: string[] = [];

  for (const step of SHIP_GATING_STEPS) {
    if (getStepStatus(state, step) === 'skipped') continue;

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
