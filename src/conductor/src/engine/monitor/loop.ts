import { join } from 'node:path';
import { recordDeferralSafely, type DeferralKey } from './deferrals.js';
import type { ProjectHalt } from './halt-inventory.js';
import { snapshotHaltMarker } from '../halt-marker.js';
import type { ConductorEvent } from '../../types/events.js';
import type { ConductorEventEmitter } from '../../ui/events.js';

type MonitorTransitionType = Extract<ConductorEvent, {
  type:
    | 'monitor_item_offered'
    | 'monitor_session_opened'
    | 'monitor_item_deferred'
    | 'monitor_session_ended';
}>['type'];

type MonitorEventEmitter = Pick<ConductorEventEmitter, 'emit'>;

/** Seams owned by the foreground monitor's queue-driving loop. */
export interface GuidedMonitorLoopDeps {
  readonly deriveMembership: () => Promise<readonly ProjectHalt[]>;
  readonly launch: (halt: ProjectHalt) => Promise<unknown>;
  readonly offer: (halt: ProjectHalt) => void;
  /** Resolves when the foreground monitor should stop; injectable for tests. */
  readonly untilStop?: Promise<void>;
  /** Waits between idle passes; injectable so tests do not use a real timer. */
  readonly waitForNextPass?: () => Promise<void>;
  readonly operatorSkipped?: (outcome: unknown, halt: ProjectHalt) => boolean | Promise<boolean>;
  readonly snapshotHaltMarker?: (halt: ProjectHalt) => Promise<DeferralKey['haltIdentity']>;
  readonly writeHaltMarker?: (halt: ProjectHalt, contents: Uint8Array) => Promise<void>;
  readonly recordDeferral?: (key: DeferralKey) => Promise<void>;
  readonly report?: (message: string) => void;
  /** Existing halt-issue bookkeeping, started once for each monitor pass. */
  readonly reconcileHaltIssues?: () => Promise<number>;
  /** Existing event spine for durable queue-transition telemetry. */
  readonly events?: MonitorEventEmitter;
}

/** The monitor is still available when it has no item to offer. */
export interface GuidedMonitorLoopResult {
  readonly active: boolean;
}

function waitForMonitorPass(untilStop: Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 1_000);
    void untilStop.then(() => clearTimeout(timer));
  });
}

function sameHalt(left: ProjectHalt, right: ProjectHalt): boolean {
  return left.project === right.project && left.slug === right.slug;
}

interface HaltIssueReconciliationState {
  networkFailureReported: boolean;
}

function reportHaltIssueReconciliationFailure(deps: GuidedMonitorLoopDeps, message: string): void {
  try {
    deps.report?.(message);
  } catch {
    // Reconciliation diagnostics must not stop the foreground queue.
  }
}

function isNetworkFailure(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : String(error);
  return /\b(?:network|offline|fetch failed|ENOTFOUND|EAI_AGAIN|ECONN\w*|ETIMEDOUT)\b/i.test(detail);
}

function startHaltIssueReconciliation(
  deps: GuidedMonitorLoopDeps,
  state: HaltIssueReconciliationState,
): void {
  const reconcile = deps.reconcileHaltIssues;
  if (reconcile === undefined) return;

  const reportFailure = (error: unknown): void => {
    if (isNetworkFailure(error)) {
      if (state.networkFailureReported) return;
      state.networkFailureReported = true;
    }
    const detail = error instanceof Error ? error.message : String(error);
    reportHaltIssueReconciliationFailure(deps, `Halt-issue reconciliation failed: ${detail}`);
  };

  try {
    void reconcile().then(
      (exitCode) => {
        if (exitCode !== 0) {
          reportHaltIssueReconciliationFailure(deps, `Halt-issue reconciliation exited with code ${exitCode}.`);
        }
      },
      reportFailure,
    );
  } catch (error) {
    reportFailure(error);
  }
}

function wasSkipped(outcome: unknown): boolean {
  return typeof outcome === 'object' && outcome !== null &&
    (outcome as { kind?: unknown }).kind === 'operator-skip';
}

function worktreePath(halt: ProjectHalt): string {
  return join(halt.project, '.worktrees', halt.slug);
}

async function recordSkipIfNeeded(
  deps: GuidedMonitorLoopDeps,
  halt: ProjectHalt,
  outcome: unknown,
): Promise<boolean> {
  const skipped = await (deps.operatorSkipped?.(outcome, halt) ?? wasSkipped(outcome));
  if (!skipped) return false;

  const key: DeferralKey = {
    project: halt.project,
    feature: halt.slug,
    haltIdentity: await (deps.snapshotHaltMarker?.(halt) ?? snapshotHaltMarker(worktreePath(halt))),
  };
  if (deps.recordDeferral !== undefined) {
    await deps.recordDeferral(key);
    return true;
  }
  return recordDeferralSafely(worktreePath(halt), key);
}

async function emitMonitorTransition(
  deps: GuidedMonitorLoopDeps,
  type: MonitorTransitionType,
  halt: ProjectHalt,
): Promise<void> {
  await deps.events?.emit({ type, project: halt.project, feature: halt.slug });
}

async function offerHalt(deps: GuidedMonitorLoopDeps, halt: ProjectHalt): Promise<void> {
  deps.offer(halt);
  await emitMonitorTransition(deps, 'monitor_item_offered', halt);
}

/**
 * Opens the current head, then re-derives membership before presenting the
 * next remaining item. The launch result is deliberately not interpreted:
 * halt markers, not a session outcome, establish current membership.
 */
export async function advanceAfterGuidedSession(deps: GuidedMonitorLoopDeps): Promise<void> {
  const current = await deps.deriveMembership();
  const head = current[0];
  if (head === undefined) return;

  await offerHalt(deps, head);
  await emitMonitorTransition(deps, 'monitor_session_opened', head);
  const outcome = await deps.launch(head);
  if (await recordSkipIfNeeded(deps, head, outcome)) {
    await emitMonitorTransition(deps, 'monitor_item_deferred', head);
  }
  await emitMonitorTransition(deps, 'monitor_session_ended', head);

  const next = (await deps.deriveMembership()).find((halt) => !sameHalt(halt, head));
  if (next !== undefined) await offerHalt(deps, next);
}

/**
 * Work a fresh queue until it becomes empty. An unchanged halt is retained in
 * the next membership result, but is held behind every item not yet offered in
 * the current rotation before it can be offered again.
 */
export async function runGuidedMonitorQueue(
  deps: GuidedMonitorLoopDeps,
): Promise<GuidedMonitorLoopResult> {
  const offered = new Set<string>();
  const reconciliationState: HaltIssueReconciliationState = { networkFailureReported: false };
  const untilStop = deps.untilStop;
  let stopped = false;
  void untilStop?.then(() => {
    stopped = true;
  });

  const stop = (): GuidedMonitorLoopResult => {
    deps.report?.('Monitor stopped.');
    return { active: false };
  };

  // A pre-resolved injected stop condition must prevent even an initial scan.
  await Promise.resolve();

  for (;;) {
    if (stopped) return stop();

    startHaltIssueReconciliation(deps, reconciliationState);
    const membership = await deps.deriveMembership();
    if (stopped) return stop();
    if (membership.length === 0) {
      deps.report?.('Monitor queue is empty; staying active.');
      if (untilStop === undefined) return { active: true };

      const passed = await Promise.race([
        (deps.waitForNextPass?.() ?? waitForMonitorPass(untilStop)).then(() => false),
        untilStop.then(() => true),
      ]);
      if (passed) return stop();
      continue;
    }

    const next = membership.find((halt) => !offered.has(`${halt.project}\u0000${halt.slug}`));
    if (next === undefined) {
      offered.clear();
      continue;
    }

    offered.add(`${next.project}\u0000${next.slug}`);
    await offerHalt(deps, next);
    await emitMonitorTransition(deps, 'monitor_session_opened', next);
    if (untilStop !== undefined) {
      const outcome = await Promise.race([
        deps.launch(next).then((value) => ({ stopped: false as const, value })),
        untilStop.then(() => ({ stopped: true as const })),
      ]);
      if (outcome.stopped) return stop();
      if (await recordSkipIfNeeded(deps, next, outcome.value)) {
        await emitMonitorTransition(deps, 'monitor_item_deferred', next);
      }
      await emitMonitorTransition(deps, 'monitor_session_ended', next);
      continue;
    }
    const outcome = await deps.launch(next);
    if (await recordSkipIfNeeded(deps, next, outcome)) {
      await emitMonitorTransition(deps, 'monitor_item_deferred', next);
    }
    await emitMonitorTransition(deps, 'monitor_session_ended', next);
  }
}
