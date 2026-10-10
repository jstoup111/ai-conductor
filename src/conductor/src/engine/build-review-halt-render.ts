import { parseBuildReviewAggregate } from './build-review-aggregate.js';
import { MAX_MECHANICAL_FAULTS_BUILD_REVIEW, type KickbackGateEntry } from './kickback-ledger.js';
import { resolveFeaturePlanPath } from './artifacts.js';
import { seedTaskStatus } from './task-seed.js';
import type { ChildId } from './child-context.js';

/**
 * Render the operator-facing recovery for a terminal mechanical review fault.
 * The aggregate is the current-lap authority for the rubric and closed cause;
 * the ledger only supplies the shared allowance consumption.
 */
export function renderExhaustedMechanicalBuildReviewHalt(
  entry: Pick<KickbackGateEntry, 'mechanicalFaults' | 'lastMechanicalFault'>,
  currentLap: unknown,
): string {
  const aggregate = parseBuildReviewAggregate(currentLap);
  const failure = aggregate && Object.values(aggregate.results).find(
    (result) => result.kind === 'infrastructure-failure',
  );
  const consumed = entry.mechanicalFaults ?? 0;
  if (!aggregate || !failure || failure.kind !== 'infrastructure-failure') {
    const lastMechanicalFault = entry.lastMechanicalFault;
    return `build_review mechanical fault allowance exhausted: ${consumed} of ` +
      `${MAX_MECHANICAL_FAULTS_BUILD_REVIEW} shared faults consumed; current-lap diagnostic is unavailable` +
      (lastMechanicalFault === undefined ? '' :
        `; Last recorded fault: ${lastMechanicalFault.rubric} closed cause ${lastMechanicalFault.reason} ` +
        `on lap ${lastMechanicalFault.lapId} (${lastMechanicalFault.detail}).`);
  }
  // ai-conductor:session-command-context=operator-only
  const message = [
    `build_review mechanical fault allowance exhausted: ${consumed} of ${MAX_MECHANICAL_FAULTS_BUILD_REVIEW} shared faults consumed.`,
    `Current lap ${aggregate.lapId}: ${failure.rubric} closed cause ${failure.reason} (${failure.detail}).`,
    `1. Record a reduced-coverage decision: ai-conductor build-review record-reduced-coverage --feature <feature-slug> --lap ${aggregate.lapId} --rubric ${failure.rubric} --rationale "<rationale>".`,
    '2. Clear the documented terminal state: rm -f .pipeline/HALT .pipeline/HALT.class.',
  ].join('\n');
  // /ai-conductor:session-command-context
  return message;
}

/** Render the closed recovery for a custom review with no read-only candidate. */
export function renderReadOnlyReviewUnavailableBuildReviewHalt(detail: string): string {
  return [
    'build_review halted: read-only-review-unavailable.',
    detail,
    'Install or enable a read-only review mode for one listed provider, or record reduced coverage for this rubric before re-queueing the feature.',
  ].join('\n');
}

/** Seed best-effort task progress telemetry before every BUILD dispatch. */
export async function seedBuildTaskTelemetry(
  projectRoot: string,
  featureDesc: string,
  childBase?: { readonly slug: string; readonly child: ChildId },
): Promise<void> {
  const planPath = await resolveFeaturePlanPath(projectRoot, featureDesc);
  if (!planPath) {
    return;
  }
  try {
    await seedTaskStatus(projectRoot, planPath, undefined, { dispatchBoundary: true, childBase });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[task-telemetry] unable to seed task-status.json: ${message}`);
  }
}
