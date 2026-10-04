import { join } from 'node:path';
import { createInterface } from 'node:readline';
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

/** Result returned by the monitor's halt-issue reconciliation adapter. */
export interface HaltIssueReconciliationOutcome {
  readonly exitCode: number;
  readonly recordedErrorCount: number;
  readonly capturedLines: readonly string[];
}

/** Seams owned by the foreground monitor's queue-driving loop. */
export interface GuidedMonitorLoopDeps {
  readonly deriveMembership: () => Promise<readonly ProjectHalt[]>;
  readonly launch: (halt: ProjectHalt) => Promise<unknown>;
  readonly offer: (halt: ProjectHalt) => void;
  /** Resolves when the foreground monitor should stop; injectable for tests. */
  readonly untilStop?: Promise<void>;
  /** Waits between idle passes; injectable so tests do not use a real timer. */
  readonly waitForNextPass?: () => Promise<void>;
  /** Reads the operator's post-session choice; absent input continues the queue. */
  readonly readOperatorInput?: (prompt: string, signal?: AbortSignal) => Promise<string | undefined>;
  readonly snapshotHaltMarker?: (halt: ProjectHalt) => Promise<DeferralKey['haltIdentity']>;
  readonly writeHaltMarker?: (halt: ProjectHalt, contents: Uint8Array) => Promise<void>;
  readonly recordDeferral?: (key: DeferralKey) => Promise<void>;
  readonly report?: (message: string) => void;
  /** Existing halt-issue bookkeeping, started once for each monitor pass. */
  readonly reconcileHaltIssues?: () => Promise<HaltIssueReconciliationOutcome>;
  /** Existing event spine for durable queue-transition telemetry. */
  readonly events?: MonitorEventEmitter;
  /** A composition root can end the loop after a terminal inventory result. */
  readonly shouldStopAfterMembership?: () => boolean;
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

interface HaltIssueReconciliationState {
  networkFailureReported: boolean;
  nonZeroExitReported: boolean;
  recordedErrorsReported: boolean;
  inFlight: boolean;
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

function reportRecordedHaltIssueErrors(
  deps: GuidedMonitorLoopDeps,
  outcome: HaltIssueReconciliationOutcome,
): void {
  const count = outcome.recordedErrorCount;
  const details = outcome.capturedLines.join('\n');
  reportHaltIssueReconciliationFailure(
    deps,
    `Halt-issue reconciliation recorded ${count} error${count === 1 ? '' : 's'}${details ? `: ${details}` : '.'}`,
  );
}

function startHaltIssueReconciliation(
  deps: GuidedMonitorLoopDeps,
  state: HaltIssueReconciliationState,
): void {
  const reconcile = deps.reconcileHaltIssues;
  if (reconcile === undefined || state.inFlight) return;
  state.inFlight = true;

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
      (outcome) => {
        if (outcome.exitCode === 0 && outcome.recordedErrorCount === 0) {
          state.networkFailureReported = false;
          state.nonZeroExitReported = false;
          state.recordedErrorsReported = false;
        } else if (outcome.recordedErrorCount > 0) {
          if (state.recordedErrorsReported) return;
          state.recordedErrorsReported = true;
          reportRecordedHaltIssueErrors(deps, outcome);
        } else if (!state.nonZeroExitReported) {
          state.nonZeroExitReported = true;
          reportHaltIssueReconciliationFailure(deps, `Halt-issue reconciliation exited with code ${outcome.exitCode}.`);
        }
      },
      reportFailure,
    ).finally(() => {
      state.inFlight = false;
    });
  } catch (error) {
    state.inFlight = false;
    reportFailure(error);
  }
}

const POST_SESSION_PROMPT = 'Guided session ended. Choose skip to defer this item, or continue to keep it in the queue [skip/continue]: ';

async function readTerminalInput(prompt: string, signal?: AbortSignal): Promise<string | undefined> {
  if (process.stdin.isTTY !== true || signal?.aborted === true) return undefined;

  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await new Promise<string | undefined>((resolve) => {
      let settled = false;
      const settle = (answer: string | undefined): void => {
        if (settled) return;
        settled = true;
        resolve(answer);
      };
      const abort = (): void => {
        terminal.close();
        settle(undefined);
      };
      terminal.once('close', () => settle(undefined));
      signal?.addEventListener('abort', abort, { once: true });
      terminal.question(prompt, (answer) => settle(answer));
    });
  } catch {
    return undefined;
  } finally {
    terminal.close();
  }
}

async function operatorChoseSkip(deps: GuidedMonitorLoopDeps, signal?: AbortSignal): Promise<boolean> {
  try {
    const answer = await (deps.readOperatorInput ?? readTerminalInput)(POST_SESSION_PROMPT, signal);
    return answer?.trim().toLowerCase() === 'skip';
  } catch {
    return false;
  }
}

function worktreePath(halt: ProjectHalt): string {
  return join(halt.project, '.worktrees', halt.slug);
}

function inputWasAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

async function recordSkipIfNeeded(
  deps: GuidedMonitorLoopDeps,
  halt: ProjectHalt,
  signal?: AbortSignal,
): Promise<boolean> {
  if (inputWasAborted(signal) || !await operatorChoseSkip(deps, signal) || inputWasAborted(signal)) return false;

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

async function finishGuidedSession(
  deps: GuidedMonitorLoopDeps,
  halt: ProjectHalt,
  untilStop?: Promise<void>,
): Promise<boolean> {
  const aborted = new AbortController();
  const skip = recordSkipIfNeeded(deps, halt, aborted.signal);
  if (untilStop !== undefined) {
    const settled = await Promise.race([
      skip.then((selected) => ({ stopped: false as const, selected })),
      untilStop.then(() => ({ stopped: true as const })),
    ]);
    if (settled.stopped) {
      aborted.abort();
      await emitMonitorTransition(deps, 'monitor_session_ended', halt);
      return false;
    }
    if (settled.selected) await emitMonitorTransition(deps, 'monitor_item_deferred', halt);
  } else if (await skip) {
    await emitMonitorTransition(deps, 'monitor_item_deferred', halt);
  }
  await emitMonitorTransition(deps, 'monitor_session_ended', halt);
  return true;
}

async function launchGuidedSession(deps: GuidedMonitorLoopDeps, halt: ProjectHalt): Promise<void> {
  try {
    await deps.launch(halt);
  } catch {
    // A failed launch still returns control to the operator for a queue decision.
  }
  await finishGuidedSession(deps, halt);
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
/**
 * Work a fresh queue until it becomes empty. An unchanged halt is retained in
 * the next membership result, but is held behind every item not yet offered in
 * the current rotation before it can be offered again.
 */
export async function runGuidedMonitorQueue(
  deps: GuidedMonitorLoopDeps,
): Promise<GuidedMonitorLoopResult> {
  const offered = new Set<string>();
  const reconciliationState: HaltIssueReconciliationState = {
    networkFailureReported: false,
    nonZeroExitReported: false,
    recordedErrorsReported: false,
    inFlight: false,
  };
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
    if (deps.shouldStopAfterMembership?.()) return { active: false };
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
    // An interrupt can arrive while rendering an offer. Do not open a fresh
    // provider session after that terminal boundary.
    if (stopped) return stop();
    await emitMonitorTransition(deps, 'monitor_session_opened', next);
    if (untilStop !== undefined) {
      const outcome = await Promise.race([
        deps.launch(next).then(
          () => ({ stopped: false as const }),
          () => ({ stopped: false as const }),
        ),
        untilStop.then(() => ({ stopped: true as const })),
      ]);
      if (outcome.stopped) return stop();
      if (!await finishGuidedSession(deps, next, untilStop)) return stop();
      continue;
    }
    await launchGuidedSession(deps, next);
  }
}
