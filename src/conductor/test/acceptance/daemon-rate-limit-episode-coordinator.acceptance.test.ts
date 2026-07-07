/**
 * RED acceptance specs for "Daemon rate-limit episode coordinator"
 * (jstoup111/ai-conductor#270; ADR adr-2026-07-05-daemon-rate-limit-episode-coordinator.md).
 *
 * Stories: .docs/stories/daemon-api-rate-limit-episode-cascades-into-mass-h.md
 * Plan:    .docs/plans/daemon-api-rate-limit-episode-cascades-into-mass-h.md
 *
 * Technical track (no PRD) — per writing-system-tests §3a, most of the 11
 * stories are single-module and already fully specified as unit tests in the
 * plan's own per-task Steps (T1-4 rate-limit-episode.ts; T9-11/T22 conductor
 * SIGTERM/abortable-wait; T12 shared-backoff — the plan's own Task 12 Steps
 * literally ask for "two injected concurrent features" as ITS OWN RED test;
 * T13/T14 project-prelude, interactive-path only; T18 deadline parsing; T19
 * jitter; T20 HALT self-heal sweep — Task 20's own Steps already specify the
 * stamp-presence/sweep-clears tests at the daemon/rekick unit level). Those
 * are NOT duplicated here; they'll be written during /tdd for each task.
 *
 * This file covers only the flows that genuinely cross 2+ modules through a
 * REAL production entry point, where no single module's unit test can prove
 * the wiring itself works:
 *
 *   - "Dispatch loop pauses NEW feature dispatch during an active episode"
 *     (Task 5-8, 21) — drives the REAL `runDaemon` entry point (not a gate
 *     predicate in isolation); Task 15 explicitly calls for "a real-binary-ish
 *     smoke that a rate-limited prelude does not HALT and gates dispatch."
 *     Covers: active episode suppresses new picks; restart is DEFERRED (not
 *     dropped) while an episode is active (ADR change 11).
 *
 *   - "Session-limit messages classify as rate-limit-family waits" (Task 17,
 *     THE observed 2026-07-03 root cause) — this is explicitly an adversarial
 *     real-input case: the EXACT literal message from `.daemon/daemon.log` is
 *     fed through the REAL classification call site, `ClaudeProvider.invoke`
 *     (only `execa`, the child-process boundary, is mocked — never the
 *     classification logic itself), and the result is then driven through the
 *     REAL `Conductor.run()` step loop. This proves the whole chain end to
 *     end: classification -> episode entry -> conductor wait -> no cascading
 *     HALT -> retry budget preserved. A single-module claude-provider.test.ts
 *     fixture cannot prove the conductor actually reacts correctly to it, and
 *     a conductor.test.ts fixture with a synthetic `rateLimited: true` flag
 *     (Task 9's own unit test) cannot prove the classifier ever PRODUCES that
 *     flag for this literal message — only driving both together closes that
 *     gap.
 *
 * Pre-implementation: none of `rate-limit-episode.ts`, the `DaemonDeps`
 * episode seam, the dispatch gate, the classification hardening, or the
 * episode-aware conductor wait exist yet. Every scenario below is expected to
 * fail on its OBSERVABLE OUTCOME (a dispatch/restart/HALT happens when it
 * shouldn't, or an injected episode spy is never called) rather than on a
 * missing symbol — mirroring the RED style already used by
 * test/acceptance/daemon-lifecycle-controls.test.ts for not-yet-wired
 * production call sites.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runDaemon, type BacklogItem, type DaemonDeps } from '../../src/engine/daemon.js';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { HALT_MARKER } from '../../src/engine/halt-marker.js';

vi.mock('execa', () => ({ execa: vi.fn() }));
import { execa } from 'execa';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';

function items(n: number): BacklogItem[] {
  return Array.from({ length: n }, (_, i) => ({ slug: `f${i}` }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch loop pauses NEW feature dispatch during an active episode (Task 5-8,
// 21) — drives the real `runDaemon` entry point with an injected episode dep
// shaped per the plan's `DaemonDeps.rateLimitEpisode?` seam.
// ─────────────────────────────────────────────────────────────────────────────
describe('acceptance: dispatch loop pauses NEW dispatch during an active rate-limit episode', () => {
  const tempRoots: string[] = [];
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it('an active episode suppresses new picks for an otherwise-eligible backlog, this cycle', async () => {
    const dispatched: string[] = [];
    const deps = {
      discoverBacklog: async () => items(3),
      runFeature: async (it: BacklogItem) => {
        dispatched.push(it.slug);
        return { slug: it.slug, status: 'done' };
      },
      rateLimitEpisode: { active: () => true },
    } as unknown as DaemonDeps;

    await runDaemon(deps, { concurrency: 1, once: true });

    // The episode is active for the whole run — no new feature should ever be
    // picked. Today `rateLimitEpisode` is not consulted at all, so the full
    // eligible backlog dispatches.
    expect(dispatched).toEqual([]);
  });

  it('once the episode clears, normal dispatch resumes for the still-eligible backlog', async () => {
    let active = true;
    const dispatched: string[] = [];
    const deps = {
      discoverBacklog: async () => items(2),
      runFeature: async (it: BacklogItem) => {
        dispatched.push(it.slug);
        return { slug: it.slug, status: 'done' };
      },
      rateLimitEpisode: { active: () => active },
    } as unknown as DaemonDeps;

    await runDaemon(deps, { concurrency: 1, once: true });
    expect(dispatched).toEqual([]); // gated while active

    active = false;
    await runDaemon(deps, { concurrency: 1, once: true });
    expect(dispatched).toEqual(['f0', 'f1']); // resumes once cleared
  });

  it('an autonomous restart at the idle boundary is DEFERRED (not dropped) while the episode is active (ADR change 11)', async () => {
    const triggerSelfRestart = vi.fn(async () => {});
    const deps = {
      discoverBacklog: async () => items(0), // immediately idle
      runFeature: async (it: BacklogItem) => ({ slug: it.slug, status: 'done' as const }),
      hasRestartPending: async () => true,
      triggerSelfRestart,
      rateLimitEpisode: { active: () => true },
    } as unknown as DaemonDeps;

    await runDaemon(deps, { concurrency: 1, once: true });

    // A restart mid-episode would respawn a daemon with no episode memory,
    // immediately re-dispatching the backlog into the still-active limit.
    // Today the restart-pending check has no episode gate at all, so it
    // fires unconditionally.
    expect(triggerSelfRestart).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Session-limit messages classify as rate-limit-family waits — THE observed
// 2026-07-03 root cause. Drives the REAL classification call site
// (`ClaudeProvider.invoke`, only `execa` mocked) through the REAL `Conductor`
// step loop, asserting the whole chain: classify -> episode entry -> wait ->
// no cascading HALT -> retry budget preserved.
// ─────────────────────────────────────────────────────────────────────────────
describe('acceptance: the exact observed session-limit message routes to a coordinated wait, not a cascading HALT', () => {
  const SESSION_LIMIT_MESSAGE =
    "You've hit your session limit · resets 3:20pm (America/New_York)";

  const READY_STATE: ConductState = {
    worktree: 'done',
    memory: 'done',
    explore: 'done',
    complexity: 'done',
    stories: 'done',
    conflict_check: 'done',
    plan: 'done',
    architecture_diagram: 'done',
    architecture_review: 'done',
    acceptance_specs: 'done',
  } as ConductState;

  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;
  const mockedExeca = vi.mocked(execa);

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rate-limit-episode-acceptance-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeState(statePath, READY_STATE);
    mockedExeca.mockReset();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function haltBody(): Promise<string | null> {
    return readFile(join(dir, HALT_MARKER), 'utf-8').catch(() => null);
  }

  it('the literal observed message (regression fixture, .daemon/daemon.log 2026-07-03T18:04) waits and enters the shared episode, never cascading to a HALT nor burning the retry budget', async () => {
    let claudeCalls = 0;
    mockedExeca.mockImplementation((() => {
      claudeCalls++;
      if (claudeCalls === 1) {
        return Promise.resolve({ stdout: SESSION_LIMIT_MESSAGE, stderr: '', exitCode: 1 });
      }
      return Promise.resolve({ stdout: 'done', stderr: '', exitCode: 0 });
    }) as never);

    const provider = new ClaudeProvider();
    const runner: StepRunner = {
      run: async (): Promise<StepRunResult> => {
        const result = await provider.invoke({
          prompt: 'do the work',
          sessionId: 'session-1',
          resume: false,
        });
        return {
          success: result.success,
          rateLimited: result.rateLimited,
          waitSeconds: result.waitSeconds,
          sessionExpired: result.sessionExpired,
        };
      },
    };

    const rateLimitEpisode = { enter: vi.fn(), active: () => false, clear: vi.fn(async () => {}) };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      fromStep: 'build',
      mode: 'auto',
      daemon: true,
      maxRetries: 1, // budget would be exhausted by even ONE mis-classified rate limit
      sleepFn: vi.fn(async () => {}),
      // NOTE: `rateLimitEpisode` is not yet an accepted Conductor constructor
      // option — this is the new seam the plan introduces (Task 10). Passing
      // it now documents the intended wiring; it is inert until implemented.
      rateLimitEpisode,
    } as never);

    await conductor.run();

    // Correct behavior: the rate limit is recognized, so the conductor waits
    // and retries the SAME attempt (attempt-- preserved) — exactly 2 real
    // invocations (the rate-limited probe, then the successful retry).
    expect(claudeCalls).toBe(2);
    // No cascading HALT — the 2026-07-03 incident's defining symptom.
    expect(await haltBody()).toBeNull();
    // The shared coordinator must have seen this episode.
    expect(rateLimitEpisode.enter).toHaveBeenCalled();
  });
});
