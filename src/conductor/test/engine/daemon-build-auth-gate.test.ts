// ─────────────────────────────────────────────────────────────────────────────
// Acceptance-shaped RED specs for FR-6 (.docs/stories/build-auth-token-check-
// and-classify.md, "Missing credential is one waiting condition, not a HALT
// cascade") — .docs/plans/2026-07-22-build-auth-token-check-and-classify.md
// Tasks 13-17, governed by adr-2026-07-22-daemon-level-missing-credential-gate.
//
// These drive the REAL `runDaemon` (src/engine/daemon.ts) — the same function
// production wires in `daemon-cli.ts` — with injected deps, exactly like every
// other gate in this file's sibling `daemon.test.ts` (`isPaused`,
// `rateLimitEpisode`, `isHalted`). `runDaemon` is not a reimplementation of
// production dispatch, it IS production dispatch (daemon-cli.ts calls it
// directly) — so driving it with injected deps satisfies writing-system-tests
// §3b without needing a separate process-level harness. The companion file
// `daemon-cli-build-auth-wiring.test.ts` proves the injected dep is actually
// constructed from the real credential reader in production, not just
// unit-tested in isolation here (the #297/#733 "orphaned primitive" class).
//
// ASSUMPTION FLAGGED (writing-system-tests correctness gate): the exact
// `DaemonDeps` field name for this gate is NOT pinned by the story, PRD, or
// plan (the plan only says "injectable credential-state dep"). This file
// assumes a field named `isBuildAuthMissing` returning `Promise<boolean> |
// boolean`, mirroring the EXISTING `isPaused` gate's shape exactly (same
// boolean-predicate contract, same fail-closed-on-throw posture, same
// optimization-never-authority absence default). Confidence ~70% this is the
// field name the implementer will choose; if a different name is chosen, this
// file's field name must be updated to match — the BEHAVIORAL assertions
// (skip-picks, one log line, zero HALTs, auto-resume, composition) are the
// load-bearing contract from the story and do not change either way.
//
// PRE-FIX RED: `DaemonDeps` has no credential-gate field today, so every test
// below either fails to compile against the (cast) forward-looking type or —
// once the type is widened for this file — passes with the OLD (missing-gate)
// runtime behavior only by accident. In practice these fail because
// `runDaemon` never reads `deps.isBuildAuthMissing` at all yet: dispatch
// proceeds unconditionally regardless of what the fake predicate returns.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import {
  runDaemon,
  type BacklogItem,
  type DaemonDeps,
} from '../../src/engine/daemon.js';

/** Forward-looking overlay — see the ASSUMPTION note above. */
type GatedDeps = DaemonDeps & {
  isBuildAuthMissing?: () => Promise<boolean> | boolean;
};

function items(n: number): BacklogItem[] {
  return Array.from({ length: n }, (_, i) => ({ slug: `f${i}` }));
}

function staticBacklog(list: BacklogItem[]) {
  return async () => list;
}

describe('engine/daemon — build-auth credential gate (FR-6, #483)', () => {
  it('skip-picks: missing credential + N>=2 queued features -> zero dispatches, one waiting-condition log entry, zero HALT markers implied by zero dispatch', async () => {
    const logs: string[] = [];
    const deps: GatedDeps = {
      discoverBacklog: staticBacklog(items(3)),
      runFeature: vi.fn(async (it) => ({ slug: it.slug, status: 'done' })),
      isBuildAuthMissing: async () => true,
      log: (msg) => logs.push(msg),
      sleep: async () => {},
    };

    const res = await runDaemon(deps as DaemonDeps, {
      concurrency: 2,
      once: false,
      maxIdlePolls: 4,
    });

    expect(deps.runFeature).not.toHaveBeenCalled();
    expect(res.processed).toHaveLength(0);

    const waitingLines = logs.filter((l) => /build.?auth|credential/i.test(l));
    // Transition-only: repeated idle polls while the condition is unchanged
    // must not spam a fresh entry every tick.
    expect(waitingLines.length).toBe(1);
  });

  it('a present, verified-fresh credential dispatches normally (gate is transparent when satisfied)', async () => {
    const deps: GatedDeps = {
      discoverBacklog: staticBacklog(items(2)),
      runFeature: vi.fn(async (it) => ({ slug: it.slug, status: 'done' })),
      isBuildAuthMissing: async () => false,
    };

    const res = await runDaemon(deps as DaemonDeps, { concurrency: 2, once: true });

    expect(deps.runFeature).toHaveBeenCalledTimes(2);
    expect(res.processed).toHaveLength(2);
  });

  it('auto-resume: storing a fresh token mid-run lifts the gate and dispatch proceeds in the SAME daemon run, no operator action', async () => {
    let missing = true;
    let dispatched = 0;
    const deps: GatedDeps = {
      discoverBacklog: staticBacklog(items(1)),
      runFeature: async (it) => {
        dispatched += 1;
        return { slug: it.slug, status: 'done' };
      },
      isBuildAuthMissing: async () => missing,
      sleep: async () => {
        // Simulates the operator storing a valid token between poll ticks —
        // no unpark/cleanup call, purely the on-disk condition changing.
        missing = false;
      },
    };

    const res = await runDaemon(deps as DaemonDeps, {
      concurrency: 1,
      once: false,
      maxIdlePolls: 5,
    });

    expect(dispatched).toBe(1);
    expect(res.processed).toHaveLength(1);
  });

  it('freshness required, not mere presence: a predicate reporting whitespace-only content as still-missing keeps the daemon parked', async () => {
    // The gate itself only consults the injected predicate — the "whitespace
    // is still missing" classification is the daemon-build-token reader's
    // job (already covered by test/engine/self-host/daemon-build-token
    // fixtures). Here we only prove the daemon NEVER dispatches while the
    // predicate keeps reporting true, i.e. the gate never free-runs on a
    // stale/cached "ok" the moment ANY file write is observed.
    const deps: GatedDeps = {
      discoverBacklog: staticBacklog(items(1)),
      runFeature: vi.fn(async (it) => ({ slug: it.slug, status: 'done' })),
      isBuildAuthMissing: async () => true, // whitespace-only classifies as missing
      sleep: async () => {},
    };

    const res = await runDaemon(deps as DaemonDeps, {
      concurrency: 1,
      once: false,
      maxIdlePolls: 3,
    });

    expect(deps.runFeature).not.toHaveBeenCalled();
    expect(res.processed).toHaveLength(0);
  });

  it('undefined dep -> byte-identical legacy behavior (optimization-never-authority, matches the isPaused/rateLimitEpisode precedent)', async () => {
    const deps: DaemonDeps = {
      discoverBacklog: staticBacklog(items(2)),
      runFeature: vi.fn(async (it) => ({ slug: it.slug, status: 'done' })),
      // isBuildAuthMissing intentionally absent
    };

    const res = await runDaemon(deps, { concurrency: 2, once: true });

    expect(deps.runFeature).toHaveBeenCalledTimes(2);
    expect(res.processed).toHaveLength(2);
  });

  it('a throwing predicate fails CLOSED (treated as missing, zero dispatch) — never crashes the loop, never silently proceeds', async () => {
    const deps: GatedDeps = {
      discoverBacklog: staticBacklog(items(2)),
      runFeature: vi.fn(async (it) => ({ slug: it.slug, status: 'done' })),
      isBuildAuthMissing: async () => {
        throw new Error('EACCES: cannot read token file');
      },
      sleep: async () => {},
    };

    const res = await runDaemon(deps as DaemonDeps, {
      concurrency: 1,
      once: false,
      maxIdlePolls: 2,
    });

    expect(deps.runFeature).not.toHaveBeenCalled();
    expect(res.processed).toHaveLength(0);
  });

  it('composition: clearing the credential gate ALONE does not dispatch while the daemon is separately PAUSED — gates compose, per the rate-limit-episode precedent', async () => {
    const deps: GatedDeps = {
      discoverBacklog: staticBacklog(items(1)),
      runFeature: vi.fn(async (it) => ({ slug: it.slug, status: 'done' })),
      isBuildAuthMissing: async () => false, // credential fine
      isPaused: async () => true, // but operator paused
    };

    const res = await runDaemon(deps as DaemonDeps, { concurrency: 1, once: true });

    expect(deps.runFeature).not.toHaveBeenCalled();
    expect(res.processed).toHaveLength(0);
  });

  it('composition: a feature already dispatched before the gate engages runs to completion — the gate only ever blocks a NEW pick, never cancels in-flight work', async () => {
    // The gate is consulted only at pick time (mirrors isPaused/rateLimitEpisode:
    // "in-flight work is completely unaffected"). Once the single backlog item
    // is picked with the gate clear, flipping the predicate to `true` for every
    // subsequent poll must not retroactively cancel or fail the in-flight run.
    let pickCount = 0;
    const deps: GatedDeps = {
      discoverBacklog: staticBacklog(items(1)),
      runFeature: async (it) => ({ slug: it.slug, status: 'done' }),
      isBuildAuthMissing: async () => {
        pickCount += 1;
        return pickCount > 1; // clear for the first pick only, then engaged
      },
    };

    const res = await runDaemon(deps as DaemonDeps, { concurrency: 1, once: true });

    expect(res.processed.filter((o) => o.status === 'done')).toHaveLength(1);
  });
});
