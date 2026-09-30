import { join } from 'node:path';
import { recordDeferralSafely, type DeferralKey } from './deferrals.js';
import type { ProjectHalt } from './halt-inventory.js';
import { snapshotHaltMarker } from '../halt-marker.js';

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
): Promise<void> {
  const skipped = await (deps.operatorSkipped?.(outcome, halt) ?? wasSkipped(outcome));
  if (!skipped) return;

  const key: DeferralKey = {
    project: halt.project,
    feature: halt.slug,
    haltIdentity: await (deps.snapshotHaltMarker?.(halt) ?? snapshotHaltMarker(worktreePath(halt))),
  };
  if (deps.recordDeferral !== undefined) {
    await deps.recordDeferral(key);
    return;
  }
  await recordDeferralSafely(worktreePath(halt), key);
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

  deps.offer(head);
  const outcome = await deps.launch(head);
  await recordSkipIfNeeded(deps, head, outcome);

  const next = (await deps.deriveMembership()).find((halt) => !sameHalt(halt, head));
  if (next !== undefined) deps.offer(next);
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
    deps.offer(next);
    if (untilStop !== undefined) {
      const outcome = await Promise.race([
        deps.launch(next).then((value) => ({ stopped: false as const, value })),
        untilStop.then(() => ({ stopped: true as const })),
      ]);
      if (outcome.stopped) return stop();
      await recordSkipIfNeeded(deps, next, outcome.value);
      continue;
    }
    const outcome = await deps.launch(next);
    await recordSkipIfNeeded(deps, next, outcome);
  }
}
