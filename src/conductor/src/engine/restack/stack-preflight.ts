import { existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

import { hasDurableChildState, resolveActiveChild } from '../child-cursor.js';
import type { GitRunner } from '../rebase.js';
import { HALT_MARKER } from '../halt-marker.js';
import type { ConductorEventEmitter } from '../../ui/events.js';
import { checkCascadeCap } from './cascade-cap.js';
import { runRestack } from './restack-executor.js';
import { emitRestackRefused } from './restack-events.js';
import { readRestackJournal } from './restack-journal.js';
import { haltRestack } from './restack-move.js';
import { recoverRestackJournal } from './restack-recovery.js';

/** The bounded result consumed by daemon and resume entry points. */
export type StackPreflightResult =
  | { readonly kind: 'no-stack' | 'clear' | 'recovered' | 'repaired' }
  | { readonly kind: 'halted' }
  | { readonly kind: 'unavailable'; readonly detail: string };

export interface RunStackPreflightOptions {
  readonly worktree: string;
  readonly slug: string;
  /** A re-kick was recorded and must become the repair's durable follow-on. */
  readonly baseRefreshDue?: boolean;
  /** Removes REKICK only immediately before a journal naming its follow-on exists. */
  readonly consumeRekick?: () => Promise<void>;
  readonly events?: ConductorEventEmitter;
  readonly git?: GitRunner;
  /**
   * The dispatcher supplies the committed-halt/authorization operation.  It is
   * deliberately injectable: this restack layer does not own daemon discovery
   * or the authorization ledger's process-wide dependencies.
   */
  readonly prepareResume?: () => Promise<void>;
  /**
   * A staged authorization is deliberately an explicit seam: merely having an
   * old ledger entry is not permission to cross a live halt.  The daemon's
   * normal authorization consumer clears the marker before this entry point,
   * while this hook keeps direct resume callers equally fail-closed.
   */
  readonly hasMatchingResumeAuthorization?: () => Promise<boolean>;
  /** Injectable only for the dispatch boundary tests. */
  readonly hasLiveHalt?: () => Promise<boolean>;
}

async function deferredBaseRefresh(events: ConductorEventEmitter | undefined): Promise<void> {
  await events?.emit(emitRestackRefused({ reason: 'deferred-base-refresh' }));
}

async function liveHaltExists(worktree: string): Promise<boolean> {
  return access(join(worktree, HALT_MARKER)).then(() => true).catch(() => false);
}

/**
 * Make the durable stack coherent before an entry point judges the active
 * child.  The journal is always probed first, even for a flat feature: an
 * interrupted stack cannot be made safe by losing its worktree metadata.
 */
export async function runStackPreflight(options: RunStackPreflightOptions): Promise<StackPreflightResult> {
  // Unit fixtures and legacy N=1 callers can have neither a Git boundary nor
  // child state.  They cannot contain a journal ref, so the flat path must not
  // fail while attempting its Git-backed recovery probe.
  if (!existsSync(join(options.worktree, '.git')) && !await hasDurableChildState(options.worktree, options.slug, { git: options.git })) {
    return { kind: 'no-stack' };
  }
  const recovery = await recoverRestackJournal(options);
  if (recovery.kind === 'live-owner') return { kind: 'halted' };
  if (recovery.kind === 'unavailable') return recovery;

  // Recovery is safe while a feature is parked; changing closure refs is not.
  // A matching, staged authorization is the sole exception.  In the regular
  // daemon path that authorization clears HALT before dispatch, but checking
  // it here keeps CLI resume and direct callers from silently bypassing a
  // live halt.
  const hasLiveHalt = options.hasLiveHalt ?? (() => liveHaltExists(options.worktree));
  if (await hasLiveHalt()) {
    if (options.hasMatchingResumeAuthorization === undefined || !await options.hasMatchingResumeAuthorization()) {
      return { kind: 'halted' };
    }
  }

  // This phase is intentionally after recovery. A halt-record commit must
  // never race an in-flight move, and a recovered follow-on owns its journal
  // before any cursor looks at closure refs.
  await options.prepareResume?.();

  // Recheck after the supersede/authorization phase: it may have made an
  // aborted journal collectible. Task 31.1 adds live-HALT gating around this
  // entry point; until then recovery remains the sole owner of cleanup.
  const secondRecovery = await recoverRestackJournal(options);
  if (secondRecovery.kind === 'live-owner') return { kind: 'halted' };
  if (secondRecovery.kind === 'unavailable') return secondRecovery;

  const durable = await hasDurableChildState(options.worktree, options.slug, { git: options.git });
  if (durable === 'git-error') return { kind: 'unavailable', detail: 'cannot inspect durable child state' };
  if (!durable) return { kind: recovery.kind === 'none' && secondRecovery.kind === 'none' ? 'no-stack' : 'recovered' };

  const cursor = await resolveActiveChild(options.worktree, options.slug, { git: options.git });
  if (cursor.kind === 'no-child') return { kind: 'no-stack' };
  if (cursor.kind === 'divergent') {
    await haltRestack(options.worktree, cursor.check, options.events, { child: cursor.child });
    return { kind: 'halted' };
  }
  if (cursor.kind !== 'repair-pending') {
    return cursor.kind === 'git-error' || cursor.kind === 'detached-head' || cursor.kind === 'envelope-missing'
      ? { kind: 'unavailable', detail: `cannot resolve stack cursor: ${cursor.kind}` }
      : { kind: 'clear' };
  }

  // Check every origin before creating a journal. runRestack repeats the
  // check with the active child's configured allowance and owns cap evidence.
  for (const child of cursor.repairChildren) {
    await checkCascadeCap(options.worktree, options.slug, [child], undefined, { git: options.git });
  }

  if (options.baseRefreshDue) await options.consumeRekick?.();
  const repair = await runRestack({
    worktree: options.worktree,
    slug: options.slug,
    cause: 'feature-repair',
    originatingChildren: cursor.repairChildren,
    ...(options.baseRefreshDue ? { followOnCause: 'base-refresh' as const } : {}),
    ...(options.events === undefined ? {} : { events: options.events }),
    ...(options.git === undefined ? {} : { git: options.git }),
  });
  if (repair.kind !== 'applied') {
    if (options.baseRefreshDue) await deferredBaseRefresh(options.events);
    return repair.kind === 'unavailable' ? repair : { kind: 'halted' };
  }
  if (!options.baseRefreshDue) return { kind: 'repaired' };

  // A successful repair intentionally leaves its applied journal in place.
  // Replacing it with the named follow-on is the atomic hand-off which also
  // makes a process crash recoverable without consulting REKICK again.
  const applied = await readRestackJournal(options.worktree, options.slug, { git: options.git });
  if (applied.kind !== 'journal' || applied.journal.state !== 'applied' || applied.journal.followOnCause !== 'base-refresh') {
    await deferredBaseRefresh(options.events);
    return { kind: 'unavailable', detail: 'feature-repair journal did not retain its base-refresh follow-on' };
  }
  const followOn = await runRestack({
    worktree: options.worktree,
    slug: options.slug,
    cause: 'base-refresh',
    replacesAppliedJournal: applied,
    ...(options.events === undefined ? {} : { events: options.events }),
    ...(options.git === undefined ? {} : { git: options.git }),
  });
  if (followOn.kind !== 'applied') {
    await deferredBaseRefresh(options.events);
    return followOn.kind === 'unavailable' ? followOn : { kind: 'halted' };
  }
  return { kind: 'repaired' };
}
