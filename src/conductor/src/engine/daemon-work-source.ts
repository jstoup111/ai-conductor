// daemon-work-source.ts — WorkSource seam for the daemon run-loop (ADR-014).
//
// Encapsulates the `discoverTick` closure from daemon-cli.ts behind a
// formalized interface so the run-loop is decoupled from direct fs/git calls
// and tests can inject a fake WorkSource without wiring real I/O.

import type { BacklogItem } from './daemon.js';
import type { OwnerResolution } from './owner-gate/identity.js';
import type { OwnerStamp } from './owner-gate/provenance.js';
import type { DiscoverBacklogOpts } from './daemon-backlog.js';

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
  fastForwardRoot: (root: string, log: (m: string) => void) => Promise<void>;
  discoverBacklog: (
    root: string,
    isProcessed: (slug: string) => Promise<boolean>,
    log: (m: string) => void,
    opts: DiscoverBacklogOpts,
  ) => Promise<BacklogItem[]>;
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
      return deps.discoverBacklog(
        deps.projectRoot,
        (slug) => deps.isProcessed(slug),
        deps.log,
        {
          baseBranch: deps.baseBranch,
          hasWarned: (slug) => deps.hasWarned(slug),
          markWarned: (slug) => deps.markWarned(slug),
          ...gateOpts,
        },
      );
    },
  };
}
