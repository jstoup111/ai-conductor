import { join } from 'node:path';
import { recordDeferralSafely, type DeferralKey } from './deferrals.js';
import type { ProjectHalt } from './halt-inventory.js';
import { snapshotHaltMarker } from '../halt-marker.js';

/** Seams owned by the foreground monitor's queue-driving loop. */
export interface GuidedMonitorLoopDeps {
  readonly deriveMembership: () => Promise<readonly ProjectHalt[]>;
  readonly launch: (halt: ProjectHalt) => Promise<unknown>;
  readonly offer: (halt: ProjectHalt) => void;
  readonly operatorSkipped?: (outcome: unknown, halt: ProjectHalt) => boolean | Promise<boolean>;
  readonly snapshotHaltMarker?: (halt: ProjectHalt) => Promise<DeferralKey['haltIdentity']>;
  readonly writeHaltMarker?: (halt: ProjectHalt, contents: Uint8Array) => Promise<void>;
  readonly recordDeferral?: (key: DeferralKey) => Promise<void>;
  readonly report?: (message: string) => void;
}

/** The monitor is still available when it has no item to offer. */
export interface GuidedMonitorLoopResult {
  readonly active: true;
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

  for (;;) {
    const membership = await deps.deriveMembership();
    if (membership.length === 0) {
      deps.report?.('Monitor queue is empty; staying active.');
      return { active: true };
    }

    const next = membership.find((halt) => !offered.has(`${halt.project}\u0000${halt.slug}`));
    if (next === undefined) {
      offered.clear();
      continue;
    }

    offered.add(`${next.project}\u0000${next.slug}`);
    deps.offer(next);
    const outcome = await deps.launch(next);
    await recordSkipIfNeeded(deps, next, outcome);
  }
}
