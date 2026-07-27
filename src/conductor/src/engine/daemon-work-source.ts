// daemon-work-source.ts — WorkSource seam for the daemon run-loop (ADR-014).
//
// Encapsulates the `discoverTick` closure from daemon-cli.ts behind a
// formalized interface so the run-loop is decoupled from direct fs/git calls
// and tests can inject a fake WorkSource without wiring real I/O.

import type { BacklogItem } from './daemon.js';
import type { OwnerResolution } from './owner-gate/identity.js';
import type { OwnerStamp } from './owner-gate/provenance.js';
import type { DiscoverBacklogOpts, WaitingItem, GatedItem } from './daemon-backlog.js';
import type { BlockerResolver } from './blocker-resolver.js';
import type { PriorityResolution } from './backlog-priority.js';
import { orderBacklog } from './backlog-priority.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public interface
// ─────────────────────────────────────────────────────────────────────────────

/** Abstraction the run-loop calls to fetch the current buildable backlog. */
export interface WorkSource {
  discover(opts: { refresh: boolean }): Promise<BacklogItem[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Local (production) adapter — mirrors the former daemon-cli.ts discoverTick
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Injected I/O primitives for the local production WorkSource. Every dep maps
 * 1-to-1 to what daemon-cli.ts previously referenced as module-level imports
 * inside the `discoverTick` closure.
 *
 * The callback return types use `Promise<T>` (not `boolean | Promise<boolean>`)
 * so they remain directly assignable to the real daemon-backlog.ts function
 * signatures in production while still accepting vitest's mockResolvedValue fakes
 * in tests (which also return Promise<T>).
 */
export interface LocalWorkSourceDeps {
  projectRoot: string;
  baseBranch: string;
  log: (m: string) => void;
  isProcessed: (slug: string) => Promise<boolean>;
  hasWarned: (slug: string) => Promise<boolean>;
  markWarned: (slug: string) => Promise<void>;
  /**
   * Shipped-record cache repair (ADR Decisions 2b/2c): when discovery skips a
   * candidate because a base-branch `.docs/shipped/` record matched (stem or
   * content hash), write the missing `.daemon/processed/` marker so later
   * polls take the ledger fast path. Optional → absent means no repair (the
   * skip itself is still correct).
   */
  repairProcessed?: DiscoverBacklogOpts['repairProcessed'];
  fastForwardRoot: (root: string, log: (m: string) => void) => Promise<unknown>;
  discoverBacklog: (
    root: string,
    isProcessed: (slug: string) => Promise<boolean>,
    log: (m: string) => void,
    opts: DiscoverBacklogOpts,
  ) => Promise<{ items: BacklogItem[]; waiting: WaitingItem[]; gated: GatedItem[] }>;
  /**
   * Owner-gate injectables (all optional → backward compatible; absent = no
   * gate, discovery is byte-for-byte legacy). ADR-1 naming: these carry the
   * OPERATOR concept (`daemonOwner`), never the lock holder.
   *
   * `resolveDaemonOwner` is a THUNK resolved FRESH on every `discover()` pass —
   * there is deliberately no cross-pass caching of the resolved owner, so a
   * reconfigured `spec_owner` (or a changed gh login) takes effect on the very
   * next pass (FR-14). `readStamp` / `readMergeTime` back the gate with real git
   * reads; `cutover` is the configured grandfather instant (or null default).
   */
  resolveDaemonOwner?: () => Promise<OwnerResolution>;
  readStamp?: (slug: string) => Promise<OwnerStamp>;
  readMergeTime?: (slug: string) => Promise<string | null>;
  cutover?: string | null;
  /**
   * Dependency-gate resolver factory (Task rem-fr4-1). Invoked FRESH on every
   * `discover()` pass — never memoized across passes — because
   * `createBlockerResolver()` builds a per-instance memo scoped to a single
   * scan (daemon-backlog.ts:210-221). Reusing one resolver instance across
   * polls would leak stale blocker verdicts into later scans. Absent →
   * `resolver` is omitted from opts and the dependency gate is unwired
   * (legacy byte-for-byte discovery, matching `resolveDaemonOwner`'s
   * optionality pattern above).
   */
  makeResolver?: () => BlockerResolver;
  /**
   * Priority resolver for post-gate ordering (Task 11). Called FRESH on every
   * `discover()` pass AFTER discoverBacklog returns (post-gate) to order items
   * by priority band. Absent → no ordering applied, items returned in discovery
   * order (legacy byte-for-byte behavior, matching optionality pattern of
   * `resolveDaemonOwner` and `makeResolver` above).
   *
   * Fail-closed: if the backlog is empty (all items filtered by gates), the
   * resolver is still called but with zero items, resulting in zero reader calls.
   */
  priorityResolver?: {
    resolve(items: BacklogItem[], options: { refresh: boolean }): Promise<PriorityResolution>;
  };
  /**
   * Owner-gate snapshot sink (Task 12, adr-2026-07-03-gated-snapshot-status-
   * read-model). `discover()`'s outward-facing `WorkSource` contract stays
   * `Promise<BacklogItem[]>` (unchanged, so the run-loop/dashboard callers
   * that widen it via the object-shape return keep working byte-for-byte) —
   * but `gated` is computed INSIDE this closure on every pass and would
   * otherwise be discarded once priority ordering runs. This optional hook
   * is invoked with that exact `gated` list on EVERY `discover()` call —
   * populated, empty, or the identity-unresolved early-return's
   * repo-warning-only list — so a caller (daemon-cli.ts) can persist it via
   * `writeGatedSnapshot` without a second, duplicate `discoverBacklog` call.
   * Errors from this hook are NOT caught here — `writeGatedSnapshot` is
   * itself advisory/never-throws (see gated-snapshot.ts), so a caller wiring
   * anything else here is responsible for its own error containment.
   */
  onGatedDiscovered?: (gated: GatedItem[]) => Promise<void> | void;
}

/**
 * Production WorkSource adapter. Reproduces the former `discoverTick` closure
 * from daemon-cli.ts via injected deps so the logic is testable in isolation.
 *
 * When `refresh` is true the local default branch is fast-forwarded to origin
 * FIRST (so newly merged specs become discoverable), then the backlog is
 * scanned. When `refresh` is false the fast-forward is skipped.
 */
export function localWorkSource(deps: LocalWorkSourceDeps): WorkSource {
  return {
    async discover({ refresh }) {
      if (refresh) await deps.fastForwardRoot(deps.projectRoot, deps.log);
      // Resolve the daemon owner FRESH this pass (no cross-pass cache) so a
      // reconfigured identity takes effect immediately (FR-14). Absent thunk →
      // gate is unwired and discovery behaves exactly as before (legacy).
      const daemonOwner = deps.resolveDaemonOwner
        ? await deps.resolveDaemonOwner()
        : undefined;
      // Only attach the owner-gate opts when the gate is wired, so the legacy
      // path passes an identical opts shape to before.
      const gateOpts: Partial<DiscoverBacklogOpts> = daemonOwner
        ? {
            daemonOwner,
            ...(deps.readStamp ? { readStamp: deps.readStamp } : {}),
            ...(deps.readMergeTime ? { readMergeTime: deps.readMergeTime } : {}),
            cutover: deps.cutover ?? null,
          }
        : {};
      // Fresh resolver instance per pass (never cached across polls) — see
      // `makeResolver` doc above and daemon-backlog.ts:210-221.
      const resolver = deps.makeResolver?.();
      // `gated` is not surfaced through WorkSource.discover()'s return value
      // (that stays `BacklogItem[]` — legacy contract, Task 1) but IS handed
      // to `onGatedDiscovered` below (Task 12) so a caller can snapshot it.
      let { items, waiting, gated } = await deps.discoverBacklog(
        deps.projectRoot,
        (slug) => deps.isProcessed(slug),
        deps.log,
        {
          baseBranch: deps.baseBranch,
          hasWarned: (slug) => deps.hasWarned(slug),
          markWarned: (slug) => deps.markWarned(slug),
          ...(resolver ? { resolver } : {}),
          ...(deps.repairProcessed ? { repairProcessed: deps.repairProcessed } : {}),
          ...gateOpts,
        },
      );

      // Task 12: hand the gated list to the snapshot sink IMMEDIATELY after
      // gated population, before priority ordering (a side effect on `items`,
      // never on `gated`) — the single call site for every pass this
      // WorkSource drives, populated, empty, or identity-unresolved
      // early-return alike.
      await deps.onGatedDiscovered?.(gated);

      // Apply priority ordering AFTER the gate (post-gate). If the backlog is
      // empty (all filtered by gates), the resolver is still called but with
      // zero items, resulting in zero reader calls (fail-closed pattern).
      if (deps.priorityResolver) {
        const resolution = await deps.priorityResolver.resolve(items, { refresh });
        items = orderBacklog(items, resolution);
      }

      return items;
    },
  };
}
