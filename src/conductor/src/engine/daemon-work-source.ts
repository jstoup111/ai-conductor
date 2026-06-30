// daemon-work-source.ts — WorkSource seam for the daemon run-loop (ADR-014).
//
// Encapsulates the `discoverTick` closure from daemon-cli.ts behind a
// formalized interface so the run-loop is decoupled from direct fs/git calls
// and tests can inject a fake WorkSource without wiring real I/O.

import type { BacklogItem } from './daemon.js';

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
    opts: {
      baseBranch: string;
      hasWarned: (slug: string) => Promise<boolean>;
      markWarned: (slug: string) => Promise<void>;
    },
  ) => Promise<BacklogItem[]>;
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
      return deps.discoverBacklog(
        deps.projectRoot,
        (slug) => deps.isProcessed(slug),
        deps.log,
        {
          baseBranch: deps.baseBranch,
          hasWarned: (slug) => deps.hasWarned(slug),
          markWarned: (slug) => deps.markWarned(slug),
        },
      );
    },
  };
}
