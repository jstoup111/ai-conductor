// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "Daemon Event-Driven Wake for Parked (HALTED)
// Features" (intake issue jstoup111/ai-conductor#111).
//
// Stories: .docs/stories/daemon-event-driven-wake-for-parked-halted-feature.md
// Plan:    .docs/plans/daemon-event-driven-wake-for-parked-halted-feature.md (18 tasks)
// ADR:     .docs/decisions/adr-2026-07-04-event-driven-halt-clear-wake.md (D1-D7, APPROVED)
//
// Per writing-system-tests §3a, single-operation stories are unit-covered by
// the plan's own per-task tests (test/engine/daemon.test.ts, test/waker.test.ts,
// test/daemon-command.test.ts, etc. written during /pipeline+/tdd) and are NOT
// duplicated here. Only genuinely composed, cross-component/cross-iteration
// flows get a case in this file:
//
//   - "Event-driven re-dispatch on HALT clear" (happy path only) — composes
//     THREE things across loop iterations: watcher registration on park, the
//     `Promise.race([sleep, waker.armed()])` wake vs. timeout arm, and the
//     `isHalted` re-verification dispatch gate. Included. The story's own
//     granular negative variants (wake-while-inFlight) are explicitly assigned
//     by the story's own Done-When to a per-task daemon.test.ts test (Task 8)
//     — not duplicated here, but the "spurious wake while still halted is a
//     no-op" negative path is folded into the SAME composed test below (it's
//     the same race/gate machinery, not a separate concern) rather than
//     restated as its own case.
//   - "Watcher lifecycle bound to park/unpark" — composed: register on park,
//     dispose BEFORE re-dispatch reuses the slug, dispose-all on the daemon's
//     final return, across two concurrent slugs and multiple loop iterations.
//     Included.
//   - "Poll backstop and shared discovery timer" — composed: which race arm
//     resolved determines `discoverBacklog({refresh})`'s flag on that
//     iteration. Included, sharing the wake-arm setup with the first test.
//
// Explicitly EXCLUDED (with reasons):
//   - "Latched single-shot Waker" — a single pure unit (`waker.ts`'s
//     `wake()`/`armed()` in isolation, no daemon.ts involvement). Unit-covered
//     by Task 2/3's `test/waker.test.ts`. Duplicating it here would just
//     re-test the same pure function through an extra I/O-heavy harness.
//   - "`--no-watch` flag and `idle-poll` default change", CLI-parsing half —
//     single-operation flag parsing, unit-covered by Task 13's
//     `daemon-command.test.ts`.
//   - "`--no-watch`" negative path ("disabling watch never disables
//     unparking") — deliberately NOT included as an acceptance case. Per the
//     ADR (D3, "watch is an optimization, never dispatch authority"), an
//     absent `watchHaltCleared` dep is BY CONSTRUCTION a no-op at the core:
//     the wake arm of the race simply never resolves, so the loop degrades
//     to the exact pre-existing sleep-only behavior — identical before and
//     after this feature lands. A test asserting that would pass today AND
//     after implementation (a false "RED"), which would corrupt this file's
//     RED evidence (§6/step-3 requires `passed: 0`). This guarantee is
//     already exercised by the pre-existing regression test in
//     `test/engine/daemon.test.ts` ("re-dispatches a halted feature after its
//     HALT marker is cleared", ~line 177) and is reconfirmed by Task 15's own
//     per-task regression check — not restated here.
//   - "Transition-only, status-preserving logging" — on inspection, the
//     resume-vs-start distinction is a single `log()` call-site change in
//     core `dispatch()`, and the story's own Done-When assigns it directly to
//     a per-task daemon.test.ts test (Task 16). The per-slug "unchanged status
//     emits nothing across N ticks" and fetch onset/recovery dedup live
//     entirely in `daemon-cli.ts`'s not-yet-existing log layer (Task 16/17),
//     which is not reachable through the core `runDaemon` entry point at all
//     (no CLI process boundary is being driven here) — there is no composed,
//     multi-component flow to exercise from this file. Fully unit/per-task
//     covered; excluded like the Waker story.
//
// NONE of this feature's production code exists yet: `DaemonDeps` has no
// `watchHaltCleared` field, `runDaemon`'s idle wait is a bare `sleep()` (no
// race), and there is no watcher registration/disposal or refresh-arm
// tracking. `deps` objects below are cast `as unknown as DaemonDeps` (mirrors
// the pattern in `daemon-lifecycle-controls.test.ts`) so the not-yet-declared
// `watchHaltCleared` seam type-checks structurally today without tripping the
// TS excess-property check — vitest (esbuild, type-stripped) runs these
// regardless, and that is what actually gates this skill's RED evidence.
// Every test below is expected to fail on OBSERVABLE OUTCOME (no re-dispatch
// happens; a dispose spy is never called; a refresh flag is wrong) rather
// than on a missing symbol/module — the correct RED shape for an unwired
// seam per §3d. Every fake `sleep` below never resolves once idle, so a
// missing wake-race implementation fails via a bounded `vi.waitFor`/test
// timeout, never an unbounded hang.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { runDaemon, type BacklogItem, type DaemonDeps } from '../../src/engine/daemon.js';

function items(n: number): BacklogItem[] {
  return Array.from({ length: n }, (_, i) => ({ slug: `f${i}` }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Event-driven re-dispatch: register + wake-vs-sleep race + isHalted gate.
// ─────────────────────────────────────────────────────────────────────────────
describe('Event-driven re-dispatch on HALT clear (composed: watcher + race + gate)', () => {
  it(
    'a parked feature re-dispatches via the wake arm without the sleep tick ever resolving; a spurious wake while still halted is a no-op',
    async () => {
      const halted = new Set<string>();
      const clearedCallbacks = new Map<string, () => void>();
      let dispatches = 0;

      const deps = {
        discoverBacklog: async () => items(1), // halted !== processed: f0 stays in the backlog
        isHalted: async (slug: string) => halted.has(slug),
        runFeature: async (it: BacklogItem) => {
          dispatches++;
          if (dispatches === 1) {
            halted.add(it.slug);
            return { slug: it.slug, status: 'halted' as const, reason: 'needs human' };
          }
          return { slug: it.slug, status: 'done' as const };
        },
        watchHaltCleared: (slug: string, onCleared: () => void) => {
          clearedCallbacks.set(slug, onCleared);
          return () => clearedCallbacks.delete(slug);
        },
        // Never resolves once idle — only the wake arm of the race can unblock
        // this test. If no wake race exists yet, this run hangs into the
        // per-test timeout below rather than looping forever.
        sleep: async () => new Promise<void>(() => {}),
      };

      const resultPromise = runDaemon(deps as unknown as DaemonDeps, {
        concurrency: 1,
        once: false,
        maxItems: 2, // stop once both the halted and the resumed-done outcome are collected
      });

      await vi.waitFor(() => expect(clearedCallbacks.has('f0')).toBe(true), { timeout: 2000 });

      // Spurious/duplicate event while HALT is still present (ADR D3: watch is
      // an optimization, never dispatch authority — `isHalted` re-verification
      // is the sole gate). Must be a complete no-op.
      clearedCallbacks.get('f0')!();
      await new Promise((r) => setTimeout(r, 20));
      expect(dispatches).toBe(1);

      // Genuinely clear it and fire again — THIS is what must unblock the loop.
      halted.delete('f0');
      clearedCallbacks.get('f0')!();

      const res = await resultPromise;
      expect(dispatches).toBe(2);
      expect(res.processed.filter((o) => o.status === 'done')).toHaveLength(1);
    },
    3000,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Watcher lifecycle: register on park, dispose before re-dispatch reuses the
// slug, dispose-all remaining watchers before the daemon's single return.
// ─────────────────────────────────────────────────────────────────────────────
describe('Watcher lifecycle bound to park/unpark', () => {
  it(
    'registers a watcher when a feature parks, disposes it before re-dispatch, and disposes all remaining watchers on exit',
    async () => {
      const registered: string[] = [];
      const clearedCallbacks = new Map<string, () => void>();
      const disposeSpies = new Map<string, ReturnType<typeof vi.fn>>();
      let dispatches = 0;

      const deps = {
        // f0 parks then resumes; f1 parks and stays parked through daemon exit.
        discoverBacklog: async () => items(2),
        isHalted: async (slug: string) => slug === 'f1' || (slug === 'f0' && dispatches < 1),
        runFeature: async (it: BacklogItem) => {
          dispatches++;
          if (it.slug === 'f1') return { slug: it.slug, status: 'halted' as const };
          if (dispatches <= 1) return { slug: it.slug, status: 'halted' as const };
          return { slug: it.slug, status: 'done' as const };
        },
        watchHaltCleared: (slug: string, onCleared: () => void) => {
          registered.push(slug);
          clearedCallbacks.set(slug, onCleared);
          const spy = vi.fn();
          disposeSpies.set(slug, spy);
          return spy;
        },
        sleep: async () => new Promise<void>(() => {}),
      };

      const resultPromise = runDaemon(deps as unknown as DaemonDeps, {
        concurrency: 2,
        once: false,
        maxItems: 3, // f0-halted, f1-halted, f0-done outcomes
      });

      await vi.waitFor(() => expect(registered).toContain('f0'), { timeout: 2000 });
      await vi.waitFor(() => expect(registered).toContain('f1'), { timeout: 2000 });

      // Clearing f0 and firing its wake must re-dispatch it, disposing its
      // watcher BEFORE runFeature could tear down its worktree.
      clearedCallbacks.get('f0')!();

      const res = await resultPromise;

      expect(disposeSpies.get('f0')).toHaveBeenCalledTimes(1); // disposed on re-dispatch
      expect(disposeSpies.get('f1')).toHaveBeenCalledTimes(1); // disposed on final exit (still parked)
      expect(res.processed.filter((o) => o.slug === 'f0' && o.status === 'done')).toHaveLength(1);
    },
    3000,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Poll backstop and shared discovery timer: which race arm resolved decides
// the `discoverBacklog({refresh})` flag for that iteration.
// ─────────────────────────────────────────────────────────────────────────────
describe('Poll backstop and shared discovery timer (D3/D5: no network on unpark)', () => {
  it(
    'a wake-arm iteration recovers the cleared feature via a local (refresh:false) scan — never triggering the refresh:true network sweep',
    async () => {
      const refreshCalls: boolean[] = [];
      const clearedCallbacks = new Map<string, () => void>();
      let dispatches = 0;

      const deps = {
        discoverBacklog: async (opts: { refresh: boolean }) => {
          refreshCalls.push(opts.refresh);
          return items(1);
        },
        isHalted: async (slug: string) => slug === 'f0' && dispatches < 1,
        runFeature: async (it: BacklogItem) => {
          dispatches++;
          if (dispatches === 1) return { slug: it.slug, status: 'halted' as const };
          return { slug: it.slug, status: 'done' as const };
        },
        watchHaltCleared: (slug: string, onCleared: () => void) => {
          clearedCallbacks.set(slug, onCleared);
          return () => clearedCallbacks.delete(slug);
        },
        sleep: async () => new Promise<void>(() => {}),
      };

      const resultPromise = runDaemon(deps as unknown as DaemonDeps, {
        concurrency: 1,
        once: false,
        maxItems: 2,
      });

      await vi.waitFor(() => expect(clearedCallbacks.has('f0')).toBe(true), { timeout: 2000 });
      clearedCallbacks.get('f0')!();

      await resultPromise;

      expect(refreshCalls.some((r) => r === true)).toBe(false);
    },
    3000,
  );
});
