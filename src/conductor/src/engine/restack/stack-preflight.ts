import { existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

import { hasDurableChildState, resolveActiveChild, resolveSealedFirst } from '../child-cursor.js';
import { childBranchFor } from '../feature-branch-identity.js';
import { makeGitRunner, type GitRunner } from '../rebase.js';
import { HALT_MARKER } from '../halt-marker.js';
import type { ConductorEventEmitter } from '../../ui/events.js';
import { checkCascadeCap } from './cascade-cap.js';
import { defaultTip, runRestack } from './restack-executor.js';
import type { RestackResolver } from './restack-resolver.js';
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
  /** Provider-backed resolver and its configured attempt budget. */
  readonly resolver?: RestackResolver;
  readonly resolverCap?: number;
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
  if (recovery.kind === 'live-owner' || recovery.kind === 'halted') return { kind: 'halted' };
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
  if (secondRecovery.kind === 'live-owner' || secondRecovery.kind === 'halted') return { kind: 'halted' };
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
    await checkCascadeCap(options.worktree, options.slug, [child], { git: options.git });
  }

  // A re-kick asks for a base refresh, but when the default is already inside
  // the first sealed declared child position there is nothing to carry:
  // chaining one would only rewrite every child to new SHAs. The REKICK is
  // then satisfied by the repair alone.
  const baseRefreshDue = options.baseRefreshDue === true
    && !(await defaultAlreadyInStack(options.worktree, options.slug, options.git ?? makeGitRunner(options.worktree)));
  const repair = await runRestack({
    worktree: options.worktree,
    slug: options.slug,
    cause: 'feature-repair',
    originatingChildren: cursor.repairChildren,
    ...(baseRefreshDue ? { followOnCause: 'base-refresh' as const } : {}),
    ...(options.events === undefined ? {} : { events: options.events }),
    ...(options.git === undefined ? {} : { git: options.git }),
    ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
    ...(options.resolverCap === undefined ? {} : { resolverCap: options.resolverCap }),
  });
  if (repair.kind !== 'applied') {
    if (baseRefreshDue) await deferredBaseRefresh(options.events);
    return repair.kind === 'unavailable' ? repair : { kind: 'halted' };
  }
  if (!baseRefreshDue) {
    if (options.baseRefreshDue) await options.consumeRekick?.();
    return { kind: 'repaired' };
  }

  // A successful repair intentionally leaves its applied journal in place.
  // Replacing it with the named follow-on is the atomic hand-off which also
  // makes a process crash recoverable without consulting REKICK again.
  const applied = await readRestackJournal(options.worktree, options.slug, { git: options.git });
  if (applied.kind !== 'journal' || applied.journal.state !== 'applied' || applied.journal.followOnCause !== 'base-refresh') {
    await deferredBaseRefresh(options.events);
    return { kind: 'unavailable', detail: 'feature-repair journal did not retain its base-refresh follow-on' };
  }
  // A crash before the repair journal names its follow-on must leave REKICK in
  // place. The durable journal is the hand-off; the sentinel is only its
  // discovery trigger.
  await options.consumeRekick?.();
  const followOn = await runRestack({
    worktree: options.worktree,
    slug: options.slug,
    cause: 'base-refresh',
    replacesAppliedJournal: applied,
    ...(options.events === undefined ? {} : { events: options.events }),
    ...(options.git === undefined ? {} : { git: options.git }),
    ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
    ...(options.resolverCap === undefined ? {} : { resolverCap: options.resolverCap }),
  });
  if (followOn.kind !== 'applied') {
    await deferredBaseRefresh(options.events);
    return followOn.kind === 'unavailable' ? followOn : { kind: 'halted' };
  }
  return { kind: 'repaired' };
}

async function defaultAlreadyInStack(worktree: string, slug: string, git: GitRunner): Promise<boolean> {
  // The stack's first child is the first sealed declared position, not a
  // literal 1 (adr-2026-10-07-per-child-build-region D1).
  const position = await resolveSealedFirst(worktree);
  if (position === undefined) return false;
  const first = childBranchFor(slug, position);
  if (!first.ok) return false;
  try {
    const tip = await defaultTip(git);
    return (await git(['merge-base', '--is-ancestor', tip, `refs/heads/${first.branch}`])).exitCode === 0;
  } catch {
    return false;
  }
}
