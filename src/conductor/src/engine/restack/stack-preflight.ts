import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { hasDurableChildState, resolveActiveChild, resolveSealedFirst } from '../child-cursor.js';
import { childBranchFor } from '../feature-branch-identity.js';
import { makeGitRunner, type GitRunner } from '../rebase.js';
import { HALT_MARKER, writeHaltMarker } from '../halt-marker.js';
import { ConductorEventEmitter } from '../conductor-event-emitter.js';
import { defaultTip, runRestack } from './restack-executor.js';
import type { RestackResolver } from './restack-resolver.js';
import { emitRestackRefused } from './restack-events.js';
import { readRestackJournal, type RestackJournalOwner } from './restack-journal.js';
import { haltRestack } from './restack-move.js';
import { recoverRestackJournal } from './restack-recovery.js';
import { loadConfig } from '../config.js';
import { routingEligible, routingSettingOn } from '../routing/route-types.js';
import { drainRoutingOutboxes, readRepairMarker, readRouteRecord } from '../routing/route-record-store.js';
import { resolveGitRef } from '../routing/git-ref-resolver.js';
import { closureRefFor, repairMarkerRefFor } from '../routing/routing-refs.js';
import { diagnoseAffectedRounds, exitRoutedHostAndReconcile, reconcileRounds, recordRoundStall, routedRoundOpen, type ReconcileRoundsResult } from '../routing/round-admission.js';
import { checkOperatorTips, formatOperatorHaltReason } from '../routing/operator-round.js';
import { reconcileReceiptLedger } from '../routing/round-receipt.js';
import { consumeLowestQueued } from '../routing/revalidation-queue.js';
import { EventPersister } from '../event-persister.js';
import { publishedStackRefusal } from '../stack-publication.js';
import { formatStackCursorRefusal, type StackCursorFailureCause } from '../stack-cursor-recovery.js';

/** The bounded result consumed by daemon and resume entry points. */
export type StackPreflightResult =
  | { readonly kind: 'no-stack' | 'clear' | 'recovered' | 'repaired' }
  | Extract<ReconcileRoundsResult, { readonly kind: 'navigate-leaf-to-build' | 'navigate-host' }>
  | { readonly kind: 'halted'; readonly detail: string; readonly haltClass?: 'mechanical' }
  | { readonly kind: 'unavailable'; readonly detail: string };

export interface RunStackPreflightOptions {
  readonly worktree: string;
  readonly slug: string;
  /** A re-kick was recorded and must become the repair's durable follow-on. */
  readonly baseRefreshDue?: boolean;
  /** Removes REKICK only immediately before a journal naming its follow-on exists. */
  readonly consumeRekick?: () => Promise<void>;
  /** Recreates REKICK when a queued child defers a journal-owned follow-on. */
  readonly rearmRekick?: () => Promise<void>;
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
  /** Routing recovery belongs between journal recovery and cursor resolution. */
  readonly reconcileRounds?: typeof reconcileRounds;
  /** Injectable continuation keeps resume-exit behavior parity-testable. */
  readonly exitRoutedHostAndReconcile?: typeof exitRoutedHostAndReconcile;
  readonly routedRoundOpen?: typeof routedRoundOpen;
}

async function haltUnresolvableCursor(
  options: RunStackPreflightOptions,
  cause: StackCursorFailureCause,
  refusalDetail: string,
  topology: {
    readonly planPath?: string;
    readonly positionsRef?: string;
    readonly recordedPositions?: readonly number[];
    readonly planPositions?: readonly number[];
  } = {},
): Promise<Extract<StackPreflightResult, { kind: 'halted' }>> {
  const detail = `cannot resolve stack cursor: ${cause}: ${await formatStackCursorRefusal(
    options.worktree, options.slug, cause, refusalDetail, topology,
  )}`;
  return { kind: 'halted', detail };
}

async function deferredBaseRefresh(events: ConductorEventEmitter | undefined): Promise<void> {
  await events?.emit(emitRestackRefused({ reason: 'deferred-base-refresh' }));
}

async function liveHaltExists(worktree: string): Promise<boolean> {
  return access(join(worktree, HALT_MARKER)).then(() => true).catch(() => false);
}

function unlandedClosedChildCommitsHalt(slug: string, children: readonly number[]): string {
  const [host, ...carried] = children;
  const subject = children.length === 1 ? `child ${host}` : `children ${children.join(', ')}`;
  const carry = carried.map((child) => ` --carry ${child}`).join('');
  return [
    `unlanded-closed-child-commits: ${subject}`,
    // ai-conductor:session-command-context=operator-only
    `ai-conductor stack land --slug ${slug} --child ${host}${carry} --reason "<why>"`,
    // /ai-conductor:session-command-context
    '',
  ].join('\n');
}

function stageDetail(stage: string, detail: string): string {
  return detail.trim() || `stack preflight: ${stage} refused`;
}

async function haltForLiveJournalOwner(
  options: RunStackPreflightOptions,
  owner: RestackJournalOwner | undefined,
): Promise<Extract<StackPreflightResult, { kind: 'halted' }>> {
  const detail = owner === undefined
    ? 'journal owner unreadable'
    : `restack journal owned by live process ${owner.pid} on ${owner.host}`;
  await options.events?.emit(emitRestackRefused({ reason: 'journal-live-owner', detail }));
  return { kind: 'halted', detail, haltClass: 'mechanical' };
}

/**
 * Make the durable stack coherent before an entry point judges the active
 * child. Durable-state detection includes the journal, so an interrupted
 * stack cannot be flattened by lost worktree metadata.
 */
async function runStackPreflightInner(options: RunStackPreflightOptions): Promise<StackPreflightResult> {
  // A routing stall cannot be retryable unless its attempt reaches the active
  // event spine. A direct caller without an emitter therefore fails closed.
  const stallEvents = options.events ?? new ConductorEventEmitter();
  // Establish whether the feature is stacked before touching routing state.
  // A journal itself establishes durable child state, so this still recovers
  // interrupted stacks while keeping N=1 features on their historical path.
  const durable = await hasDurableChildState(options.worktree, options.slug, { git: options.git });
  if (durable === 'git-error') return haltUnresolvableCursor(options, 'git-error', 'cannot inspect durable child state');
  if (!durable) return { kind: 'no-stack' };

  // Routing-off stacks retain the ordinary restack/recovery path, but must
  // never inspect routing refs while doing so.
  const config = await loadConfig(options.worktree);
  const routingEnabled = config.ok && routingSettingOn(config.config);

  // Publication freezes new rewrites, not a resume which has no rewrite to
  // perform. A settled feature-repair journal may still be cleaned, but its
  // base-refresh follow-on must not move published member refs.
  const published = await publishedStackRefusal(options.worktree, options.slug, { git: options.git });
  const recovery = await recoverRestackJournal({ ...options, suppressFollowOn: published });
  if (recovery.kind === 'live-owner') return haltForLiveJournalOwner(options, recovery.owner);
  if (recovery.kind === 'halted') return { kind: 'halted', detail: 'restack journal recovery halted' };
  if (recovery.kind === 'unavailable') return haltUnresolvableCursor(options, 'git-error', recovery.detail);

  // Recovery is safe while a feature is parked; changing closure refs is not.
  // A matching, staged authorization is the sole exception.  In the regular
  // daemon path that authorization clears HALT before dispatch, but checking
  // it here keeps CLI resume and direct callers from silently bypassing a
  // live halt.
  const hasLiveHalt = options.hasLiveHalt ?? (() => liveHaltExists(options.worktree));
  if (await hasLiveHalt()) {
    if (options.hasMatchingResumeAuthorization === undefined || !await options.hasMatchingResumeAuthorization()) {
      return { kind: 'halted', detail: 'live HALT without resume authorization' };
    }
  }

  // This phase is intentionally after recovery. A halt-record commit must
  // never race an in-flight move, and a recovered follow-on owns its journal
  // before any cursor looks at closure refs.
  await options.prepareResume?.();

  // Recheck after the supersede/authorization phase: it may have made an
  // aborted journal collectible. Task 31.1 adds live-HALT gating around this
  // entry point; until then recovery remains the sole owner of cleanup.
  const secondRecovery = await recoverRestackJournal({ ...options, suppressFollowOn: published });
  if (secondRecovery.kind === 'live-owner') return haltForLiveJournalOwner(options, secondRecovery.owner);
  if (secondRecovery.kind === 'halted') return { kind: 'halted', detail: 'restack journal recovery halted' };
  if (secondRecovery.kind === 'unavailable') return haltUnresolvableCursor(options, 'git-error', secondRecovery.detail);

  // The hook cannot see a --no-verify commit or a ref move made elsewhere.
  // Check an active operator host before any route admission, ref movement, or
  // the undeclared-round stop that Task 15 adds at this same boundary.
  const marker = routingEnabled
    ? await readRepairMarker(options.worktree, options.slug, { git: options.git })
    : undefined;
  if (marker?.kind === 'unreadable') return { kind: 'unavailable', detail: 'cannot read operator repair marker' };
  if (marker?.kind === 'marker') {
    const stored = await readRouteRecord(options.worktree, options.slug, marker.marker.roundId, { git: options.git });
    // Do not stop at the marker's first unreadable record.  The outbox drain
    // remains the admission fence, and reconciliation below turns every
    // unreadable durable round (including an earlier one) into one named,
    // mechanical stall.
    // Only a restack moves a host's closure, and only from `built`, so an active
    // host off its pin was moved by hand. Its routed exit would read the moved
    // closure as "no commits" and never carry the repair above this child.
    const { host, roundId } = marker.marker;
    const record = stored.kind === 'record' ? stored.record : undefined;
    const entry = record?.entry;
    if (entry?.host === host && (record?.hosts[host] === 'admitted' || record?.hosts[host] === 'repairing')) {
      const closureRef = closureRefFor(options.slug, host);
      const closure = await resolveGitRef(options.git ?? makeGitRunner(options.worktree), closureRef);
      if (typeof closure === 'string' && closure !== entry.pinnedBase) {
        return {
          kind: 'halted',
          detail: `routed host closure moved: ${closureRef} is ${closure}, but open round ${roundId} pinned host ${host} at ${entry.pinnedBase}; ` +
            `${repairMarkerRefFor(options.slug)} (${marker.blob}) still names that round, so its repair would never reach the children above host ${host}\n` +
            `Recovery:\ngit update-ref ${closureRef} ${entry.pinnedBase} ${closure}\n` +
            // ai-conductor:session-command-context=operator-only
            `ai-conductor halt clear --feature ${options.slug} --rationale "restored ${closureRef} to the round ${roundId} pin"`,
            // /ai-conductor:session-command-context
        };
      }
    }
    if (stored.kind === 'record' && stored.record.kind === 'operator') {
      const tips = await checkOperatorTips({
        worktree: options.worktree,
        slug: options.slug,
        record: stored.record,
        ...(options.git === undefined ? {} : { git: options.git }),
      });
      if (tips.kind === 'unavailable') return { kind: 'unavailable', detail: tips.detail };
      if (tips.kind === 'moved') {
        const reason = formatOperatorHaltReason('operator-round-branch-moved', stored.record.roundId);
        const details = tips.branches.map(({ branch, recorded, current }) => `${branch} (recorded ${recorded}, current ${current})`).join(', ');
        const body = `${reason}\noperator round ${stored.record.roundId} branch moved: ${details}\n`;
        return { kind: 'halted', detail: body.trimEnd() };
      }
      // An abandon has already durably chosen its host reset; it must reach
      // round reconciliation even though it has no landing declaration.
      if (stored.record.operator?.declaration === undefined && stored.record.hosts[marker.marker.host] !== 'abandoning') {
        const reason = formatOperatorHaltReason('operator-round-undeclared', stored.record.roundId);
        const body = `${reason}\noperator round ${stored.record.roundId} landing on child ${marker.marker.host} is awaiting ` +
          // ai-conductor:session-command-context=operator-only
          'ai-conductor stack land --done or ai-conductor stack land --abandon\n';
          // /ai-conductor:session-command-context
        return { kind: 'halted', detail: body.trimEnd() };
      }
    }
  }

  const receiptCursor = routingEnabled
    ? await resolveActiveChild(options.worktree, options.slug, { git: options.git })
    : undefined;
  if (config.ok && receiptCursor !== undefined && routingEligible(receiptCursor, config.config)) {
    // A receipt CAS may survive a process crash before its ledger write.  Do
    // this after journal recovery, while route refs are stable, before any
    // resumed host can dispatch again.
    try {
      await reconcileReceiptLedger(options.worktree, options.slug, { cursor: receiptCursor, config: config.config }, options.git);
    } catch {
      return { kind: 'unavailable', detail: 'cannot reconcile routed receipt ledger' };
    }
    const persister = new EventPersister(join(options.worktree, '.pipeline', 'events.jsonl'), options.events ?? new ConductorEventEmitter());
    const drained = await drainRoutingOutboxes(options.worktree, options.slug, (event) => persister.persistDurably(event), { git: options.git });
    if (drained.kind !== 'drained') {
      // A failed outbox must not enter reconciliation: that path may advance
      // a pending successor or create a marker. Render its durable context
      // through the read-only diagnostic instead.
      const affected = await diagnoseAffectedRounds(options.worktree, options.slug, { git: options.git });
      if (affected.kind === 'affected' && affected.rounds.length > 0) {
        const recorded = await recordRoundStall(options.worktree, options.slug, {
          kind: 'stalled',
          detail: `cannot drain routing outbox: ${drained.kind}`,
          rounds: affected.rounds,
        }, stallEvents);
        return { kind: 'halted', ...recorded };
      }
      return { kind: 'unavailable', detail: affected.kind === 'unavailable'
        ? `${affected.detail}; cannot drain routing outbox: ${drained.kind}`
        : `cannot drain routing outbox: ${drained.kind}` };
    }
    // A due base refresh must yield to *any* durable routed obligation.  In
    // particular, reconciliation can otherwise navigate an admitted host (or
    // consume the queue) before this deferral is observed.
    if (options.baseRefreshDue && await (options.routedRoundOpen ?? routedRoundOpen)(options.worktree, options.slug, { git: options.git })) {
      await deferredBaseRefresh(options.events);
    }
    let reconciled = await (options.reconcileRounds ?? reconcileRounds)(options.worktree, options.slug, { git: options.git });
    if (reconciled.kind === 'unavailable') return { kind: 'unavailable', detail: stageDetail('round reconciliation', reconciled.detail) };
    if (reconciled.kind === 'stalled') {
      const recorded = await recordRoundStall(options.worktree, options.slug, reconciled, stallEvents);
      return { kind: 'halted', ...recorded };
    }
    if (reconciled.kind === 'resume-exit') {
      const exited = await (options.exitRoutedHostAndReconcile ?? exitRoutedHostAndReconcile)({
        worktree: options.worktree,
        slug: options.slug,
        roundId: reconciled.roundId,
        host: reconciled.host,
        skipBuiltCompareAndSwap: true,
        persist: (event) => persister.persistDurably(event),
        ...(options.git === undefined ? {} : { git: options.git }),
        ...(options.events === undefined ? {} : { events: options.events }),
        ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
        ...(options.resolverCap === undefined ? {} : { resolverCap: options.resolverCap }),
        ...(options.reconcileRounds === undefined ? {} : { reconcile: options.reconcileRounds }),
      });
      if (exited.kind === 'exit-halted' && exited.unreadableRoundId !== undefined) {
        // A restack can apply before its route record becomes unreadable (or
        // before the continuation can drain it). Diagnose that durable
        // state without recovering it: a mutable reconciliation could admit
        // an earlier pending round before it reaches this unreadable one.
        // A refused or rolled-back exit still has a readable record and keeps
        // its original stop below.
        const affected = await diagnoseAffectedRounds(options.worktree, options.slug, { git: options.git });
        if (affected.kind === 'affected' && affected.rounds.length > 0) {
          const recorded = await recordRoundStall(options.worktree, options.slug, {
            kind: 'stalled',
            detail: `routing round ${exited.unreadableRoundId} is unreadable after routed exit: ${stageDetail('routed exit', exited.detail)}`,
            rounds: affected.rounds,
          }, stallEvents);
          return { kind: 'halted', ...recorded };
        }
        return {
          kind: 'halted',
          haltClass: 'mechanical',
          detail: affected.kind === 'unavailable'
            ? `${affected.detail}; routing round ${exited.unreadableRoundId} is unreadable after routed exit: ${stageDetail('routed exit', exited.detail)}`
            : `routing round ${exited.unreadableRoundId} is unreadable after routed exit: ${stageDetail('routed exit', exited.detail)}`,
        };
      }
      if (exited.kind === 'exit-halted') return { kind: 'halted', detail: stageDetail('routed exit', exited.detail) };
      reconciled = exited.next;
      if (reconciled.kind === 'unavailable') return { kind: 'unavailable', detail: stageDetail('round reconciliation', reconciled.detail) };
      if (reconciled.kind === 'stalled') {
        const recorded = await recordRoundStall(options.worktree, options.slug, reconciled, stallEvents);
        return { kind: 'halted', ...recorded };
      }
    }
    // Queue admission is marker-first and happens before any leaf return.
    // A closed audit round may therefore yield to its lowest invalidated child.
    if (
      reconciled.kind === 'none' ||
      reconciled.kind === 'aborted' ||
      reconciled.kind === 'deferred' ||
      reconciled.kind === 'leaf-returned' ||
      reconciled.kind === 'quiescent'
    ) {
      const consumed = await consumeLowestQueued(options.worktree, options.slug, { git: options.git });
      if (consumed.kind === 'admitted') return { kind: 'navigate-host', roundId: consumed.roundId, host: consumed.host };
      if (consumed.kind === 'unavailable') return { kind: 'unavailable', detail: 'cannot consume revalidation queue' };
      if (consumed.kind === 'stalled') {
        // Queue admission discovered an unreadable durable round. Reconcile
        // again to preserve the round set and bounded escalation on the
        // existing routing-stall event spine.
        const stalled = await (options.reconcileRounds ?? reconcileRounds)(options.worktree, options.slug, { git: options.git });
        if (stalled.kind === 'stalled') {
          const recorded = await recordRoundStall(options.worktree, options.slug, stalled, stallEvents);
          return { kind: 'halted', ...recorded };
        }
        return { kind: 'halted', detail: consumed.detail ?? 'routing queue consumption stalled', haltClass: 'mechanical' };
      }
      // The exit continuation has already reconciled the durable return. Do
      // not reuse the pre-exit cursor and manufacture a feature-repair
      // restack from the former host's closure.
      if (reconciled.kind === 'leaf-returned' && consumed.kind === 'none') {
        if (!await (options.routedRoundOpen ?? routedRoundOpen)(options.worktree, options.slug, { git: options.git })) {
          // A carried child deliberately survives an operator abandon.  It is
          // no longer covered by the just-closed round, so do not let the
          // terminal fast path hide its unlanded closed-child commit.
          const returnedCursor = await resolveActiveChild(options.worktree, options.slug, { git: options.git });
          if (returnedCursor.kind === 'repair-pending') {
            return {
              kind: 'halted',
              detail: unlandedClosedChildCommitsHalt(options.slug, returnedCursor.repairChildren).trimEnd(),
            };
          }
          return { kind: 'repaired' };
        }
        return { kind: 'unavailable', detail: 'routing leaf return did not reach a terminal routing state' };
      }

      // A routed continuation owns its next action.  In particular, a queue
      // fence can report busy because another open round has a pending host;
      // falling through to the receipt cursor here could restack that former
      // host and incorrectly report a feature repair.
      if (await (options.routedRoundOpen ?? routedRoundOpen)(options.worktree, options.slug, { git: options.git })) {
        return {
          kind: 'unavailable',
          detail: consumed.kind === 'busy' && consumed.detail !== undefined
            ? `routing queue remains busy while routed rounds are open: ${consumed.detail}`
            : 'routing rounds remain open after reconciliation',
        };
      }
    }
    if (reconciled.kind === 'navigate-leaf-to-build' || reconciled.kind === 'navigate-host') return reconciled;
  }

  const cursor = receiptCursor ?? await resolveActiveChild(options.worktree, options.slug, { git: options.git });
  if (cursor.kind === 'no-child') return { kind: 'no-stack' };
  if (cursor.kind === 'divergent') {
    await haltRestack(options.worktree, cursor.check, options.events, { child: cursor.child });
    return { kind: 'halted', detail: `stack cursor divergent: ${cursor.check}` };
  }
  if (cursor.kind !== 'repair-pending') {
    if (cursor.kind === 'topology-unavailable') {
      const { kind: _kind, cause, ...topology } = cursor;
      return haltUnresolvableCursor(options, cause, `slice topology is unavailable (${cause})`, topology);
    }
    if (cursor.kind === 'git-error' || cursor.kind === 'detached-head') {
      return haltUnresolvableCursor(options, cursor.kind, `cannot resolve stack cursor: ${cursor.kind}`);
    }
    return { kind: 'clear' };
  }

  if (cursor.foreignRoundChildren?.length) {
    const details = cursor.foreignRoundChildren.map((child) => `child ${child} round ${cursor.foreignRounds?.[child] ?? 'unknown'}`).join(', ');
    return { kind: 'halted', detail: `routing foreign-round commit: ${details}` };
  }

  // A routed repair rewrites closure refs. Once those refs back published
  // member branches, only an operator may choose a refresh/recovery path.
  const publishedChild = cursor.repairChildren[0];
  if (publishedChild !== undefined && await publishedStackRefusal(options.worktree, options.slug, { git: options.git })) {
    await haltRestack(options.worktree, 'published-stack', options.events, { child: publishedChild });
    return { kind: 'halted', detail: 'published stack refused restack repair' };
  }

  // A raw closed-child commit needs an operator landing to declare it done;
  // routing must never silently replay it into a routed feature repair.
  if (marker?.kind === 'absent' && config.ok && routingEligible(cursor, config.config)) {
    return { kind: 'halted', detail: unlandedClosedChildCommitsHalt(options.slug, cursor.repairChildren).trimEnd() };
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
    return repair.kind === 'unavailable'
      ? { kind: 'unavailable', detail: stageDetail('feature-repair restack', repair.detail) }
      : { kind: 'halted', detail: 'feature-repair restack halted' };
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
  if (await (options.routedRoundOpen ?? routedRoundOpen)(options.worktree, options.slug, { git: options.git })) {
    await options.rearmRekick?.();
    const suppressed = await recoverRestackJournal({ ...options, suppressFollowOn: true });
    await deferredBaseRefresh(options.events);
    return suppressed.kind === 'unavailable' ? suppressed : { kind: 'repaired' };
  }
  // A crash before the repair journal names its follow-on must leave REKICK in
  // place. The durable journal is the hand-off; the sentinel is only its
  // discovery trigger.
  await options.consumeRekick?.();
  // The publication record can appear while the repair journal was being
  // settled. Keep the completed repair, but clean its journal rather than
  // letting the routed-exit follow-on rewrite a newly published stack.
  if (publishedChild !== undefined && await publishedStackRefusal(options.worktree, options.slug, { git: options.git })) {
    const suppressed = await recoverRestackJournal({ ...options, suppressFollowOn: true });
    return suppressed.kind === 'unavailable' ? suppressed : { kind: 'repaired' };
  }
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
    return followOn.kind === 'unavailable'
      ? { kind: 'unavailable', detail: stageDetail('base-refresh restack', followOn.detail) }
      : { kind: 'halted', detail: 'base-refresh restack halted' };
  }
  return { kind: 'repaired' };
}

/**
 * Make every preflight stop durable at its public boundary. Inner operations
 * may already have written a more specific marker; preserve it, but always
 * publish the terminal event exactly once from this wrapper.
 */
export async function runStackPreflight(options: RunStackPreflightOptions): Promise<StackPreflightResult> {
  const haltPath = join(options.worktree, HALT_MARKER);
  const entryHalt = await readFile(haltPath).catch(() => undefined);
  let crossedHaltUnderAuthorization = false;
  const hasMatchingResumeAuthorization = options.hasMatchingResumeAuthorization === undefined
    ? undefined
    : async () => {
      const authorized = await options.hasMatchingResumeAuthorization!();
      crossedHaltUnderAuthorization ||= authorized;
      return authorized;
    };
  const result = await runStackPreflightInner({ ...options, hasMatchingResumeAuthorization });
  if (result.kind !== 'halted' && result.kind !== 'unavailable') return result;

  const existing = await readFile(haltPath).catch(() => undefined);
  const replaceEntryHalt = crossedHaltUnderAuthorization
    && entryHalt !== undefined
    && existing?.equals(entryHalt) === true;
  if (existing === undefined || replaceEntryHalt) {
    const write = await writeHaltMarker(
      options.worktree,
      `${result.detail}\n`,
      result.kind === 'halted' ? result.haltClass ?? 'needs-human' : 'needs-human',
      options.events,
    );
    if (write.status === 'failed') {
      throw new Error(`stack preflight stopped (${result.detail}) but its HALT could not be written: ${write.reason}`);
    }
  }
  const firstLine = replaceEntryHalt ? undefined : existing?.toString('utf8').split('\n', 1)[0]?.trim();
  await options.events?.emit({
    type: 'loop_halt',
    reason: firstLine === undefined || firstLine === '' ? result.detail : `${result.detail}: ${firstLine}`,
  });
  return result;
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
