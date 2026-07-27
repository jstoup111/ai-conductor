import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { countResolvedTasks } from '../../src/engine/task-progress.js';
import { validateConfig } from '../../src/engine/config.js';
import type { HarnessConfig } from '../../src/types/config.js';
import { runDaemon, type BacklogItem, type DaemonDeps } from '../../src/engine/daemon.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for issue #280 "Daemon halts a build that is making
// forward progress" (.docs/stories/daemon-halts-a-build-that-is-making-forward-progre.md,
// S1-S8; plan: .docs/plans/daemon-halts-a-build-that-is-making-forward-progre.md,
// T1-T13; ADR: .docs/decisions/adr-2026-07-12-progress-aware-build-halt.md).
//
// Technical track, no PRD — no FR-coverage table (§3e out of scope).
//
// NONE of T1-T13 exist yet. Two genuinely different production entry points
// are exercised:
//
//  - S1/S3/S4/S7(kill-switch)/S8(within-dispatch half): the REAL
//    `Conductor.run()` build-step retry loop (conductor.ts ~1621-2460),
//    driven exactly like the existing `describe('build-step stall circuit
//    breaker', ...)` block in test/engine/conductor.test.ts (same
//    `seedAllArtifactsExceptTaskStatus`/`writeTaskStatus` fixture shape,
//    ported here since those helpers are private to that file).
//  - S2/S5/S6/S8(cross-dispatch half): the REAL `runDaemon`/`pickEligible`
//    (daemon.ts:93-141/161-302), driven the same way
//    test/acceptance/daemon-event-driven-wake.test.ts drives it — injected
//    `DaemonDeps` cast `as unknown as DaemonDeps` for seams that don't exist
//    on the interface yet.
//  - S7(config validation): the REAL `validateConfig` (engine/config.ts).
//
// CONFIDENCE NOTE (verify-claims protocol — flagged per the auto-park
// acceptance file's precedent, test/acceptance/task-status-auto-park-
// survivability.acceptance.test.ts):
//
//  - `BuildProgressHaltConfig` shape (`enabled`/`attempt_ceiling`/
//    `dispatch_ceiling`) and the `build_progress_halt` top-level config key —
//    HIGH confidence: plan Task 1 pins this exact type name and field set
//    verbatim (pattern: `OtelConfig`).
//  - The park-reason phrase "progressing ... hit ... attempt ceiling" (S4) —
//    HIGH confidence: ADR D1 pins this phrase verbatim ("build progressing
//    but hit absolute attempt ceiling N").
//  - `lastResolvedCount` as an additive `TaskEvidence`/sidecar field, written
//    at EVERY build-step exit path (success, park, ceiling) — HIGH
//    confidence: plan Task 3/7 pin the field name and the "all paths"
//    requirement verbatim.
//  - `readLastResolvedCount(projectRoot)` as the sidecar accessor's exact
//    name (S8) — MEDIUM confidence: the plan pins the FIELD, not the
//    accessor function name; this mirrors the already-shipped
//    `readNoEvidenceAttempts` accessor in the same file (task-evidence.ts).
//  - `isProgressReKickEligible(slug)` and `progressReKickDispatchCeiling` as
//    NEW `PickEligibleCtx`/`DaemonDeps` fields (S2/S5/S6) — MEDIUM
//    confidence: this test author's plausible construction, not spec-pinned.
//    Grounded in a single, strong structural anchor: plan Task 8 says "In the
//    daemon idle/poll tick... dispatch via the existing idle-loop path" and
//    Task 10 says "Route T8 through the existing started/parked/isParked/
//    isHalted guards (daemon.ts:125-140)" — which is exactly `pickEligible`'s
//    body (confirmed at daemon.ts:116-141), a function that has grown new
//    optional ctx fields for every prior extension (`isHalted` → `isParked`)
//    and whose `DaemonDeps` counterpart already has a same-shaped precedent
//    (`watchHaltCleared`). If T8/T9 land under different names, this file's
//    RED reason (dispatch count never advances) stays valid, but the field
//    names should be re-verified against the landed interface — do not treat
//    them as spec.
//
// Everything NOT called out above (Conductor, runDaemon, pickEligible,
// countResolvedTasks, validateConfig, TaskEvidence's existing shape) is an
// existing, already-shipped production primitive driven for real.
// ─────────────────────────────────────────────────────────────────────────────

// ── Shared conductor.ts-side fixture helpers (ported from
//    test/engine/conductor.test.ts's `describe('build-step stall circuit
//    breaker', ...)` block — those helpers are file-private there). ────────

const RED_EVIDENCE_JSON = JSON.stringify({
  command: 'bundle exec rspec spec/acceptance',
  targetSpecs: ['spec/acceptance/feature_spec.rb'],
  executed: 1,
  passed: 0,
  failed: 1,
  skipped: 0,
  errors: 0,
});

async function seedAllArtifactsExceptTaskStatus(dir: string): Promise<void> {
  const artifacts: Array<[string, string]> = [
    ['.docs/decisions/technical-assessment-2026-07-12.md', 'x'],
    ['.docs/specs/2026-07-12-feature.md', 'x'],
    ['.docs/stories/epic-1/a.md', 'x'],
    ['.docs/conflicts/2026-07-12.md', 'x'],
    ['.docs/plans/2026-07-12-plan.md', 'x'],
    ['.docs/coherence/2026-07-12-plan.md', 'x'],
    ['.docs/architecture/arch.md', 'x'],
    ['.docs/decisions/adr-001.md', 'x'],
    ['spec/acceptance/feature_spec.rb', 'x'],
    ['.pipeline/acceptance-specs-red.json', RED_EVIDENCE_JSON],
    ['.docs/retros/2026-07-12-retro.md', 'x'],
  ];
  for (const [rel, content] of artifacts) {
    const full = join(dir, rel);
    await mkdir(full.substring(0, full.lastIndexOf('/')), { recursive: true });
    await writeFile(full, content);
  }
}

// Writes the plan (Task 1..total headings), the status rows, AND a sidecar
// evidence stamp for every completed id — under the engine-owned task-status
// contract (ADR H6) an unstamped 'completed' row is demoted on every gate
// evaluation, so "progress" in these fixtures must be evidence-backed.
async function writeTaskStatus(dir: string, completed: number, total: number): Promise<void> {
  await mkdir(join(dir, '.pipeline'), { recursive: true });
  await mkdir(join(dir, '.docs/plans'), { recursive: true });
  const planLines: string[] = ['# Plan', ''];
  for (let i = 1; i <= total; i++) {
    planLines.push(`### Task ${i}: Step ${i}`, '');
  }
  await writeFile(join(dir, '.docs/plans/2026-07-12-plan.md'), planLines.join('\n'));
  const tasks: Array<{ id: number; status: string }> = [];
  const stamps: Record<string, { sha: string; form: string }> = {};
  for (let i = 1; i <= total; i++) {
    const done = i <= completed;
    tasks.push({ id: i, status: done ? 'completed' : 'pending' });
    if (done) stamps[String(i)] = { sha: `${'0'.repeat(38)}${String(i).padStart(2, '0')}`, form: 'trailer' };
  }
  await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({ tasks }));
  await writeFile(
    join(dir, '.pipeline/task-evidence.json'),
    JSON.stringify({ evidenceStamps: stamps, noEvidenceAttempts: 0, migrationGrandfather: [] }),
  );
}

// ── Shared daemon.ts-side fixture helper: a real worktree with a real
//    task-status.json + task-evidence.json sidecar (T3's `lastResolvedCount`
//    seeded as-if T7 already wrote it — the fixture models the POST-
//    implementation world so the eligibility bridge below has something real
//    to read). ──────────────────────────────────────────────────────────────

async function seedSidecarProgress(
  worktreeDir: string,
  resolvedNow: number,
  totalTasks: number,
  lastResolvedCount: number,
): Promise<void> {
  await mkdir(join(worktreeDir, '.pipeline'), { recursive: true });
  const tasks = Array.from({ length: totalTasks }, (_, i) => ({
    id: i + 1,
    status: i < resolvedNow ? 'completed' : 'pending',
  }));
  await writeFile(join(worktreeDir, '.pipeline/task-status.json'), JSON.stringify({ tasks }));
  await writeFile(
    join(worktreeDir, '.pipeline/task-evidence.json'),
    JSON.stringify({
      evidenceStamps: {},
      noEvidenceAttempts: 0,
      migrationGrandfather: [],
      lastResolvedCount,
    }),
  );
}

/**
 * Test-authored bridge standing in for the not-yet-existing production
 * eligibility primitive (T8, reading T3/T7's sidecar field). Real fs reads
 * via the already-shipped `countResolvedTasks` — no mocking. Re-kick-eligible
 * exactly per D2: the worktree's CURRENT resolved count exceeds the sidecar's
 * `lastResolvedCount` stamped at the end of the LAST dispatch.
 */
async function computeProgressReKickEligible(worktreeDir: string): Promise<boolean> {
  const current = await countResolvedTasks(worktreeDir);
  let lastResolvedCount = 0;
  try {
    const raw = JSON.parse(await readFile(join(worktreeDir, '.pipeline/task-evidence.json'), 'utf-8')) as {
      lastResolvedCount?: number;
    };
    lastResolvedCount = typeof raw.lastResolvedCount === 'number' ? raw.lastResolvedCount : 0;
  } catch {
    lastResolvedCount = 0; // missing/corrupt sidecar => zero progress (S8)
  }
  return current > lastResolvedCount;
}

// ─────────────────────────────────────────────────────────────────────────────
// S1 — progress retry does not exhaust the halt budget (happy, within-dispatch)
// ─────────────────────────────────────────────────────────────────────────────
describe('S1: progress retry does not exhaust the halt budget (happy, within-dispatch)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'progress-halt-s1-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('a stub runner resolving +1 task per attempt performs MORE than max_retries attempts and eventually resolves every task', async () => {
    await seedAllArtifactsExceptTaskStatus(dir);
    const TOTAL = 6;
    const MAX_RETRIES = 3;
    let progress = 0;
    let buildAttempts = 0;

    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step === 'build') {
          buildAttempts++;
          progress++;
          await writeTaskStatus(dir, progress, TOTAL);
        }
        return { success: true };
      }),
    };

    const failedEvents: unknown[] = [];
    events.on('step_failed', (e) => {
      if (e.type === 'step_failed' && e.step === 'build') failedEvents.push(e);
    });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: MAX_RETRIES,
      daemon: true,
      mode: 'auto',
    });

    await conductor.run();

    // Today's fixed-budget loop halts after exactly MAX_RETRIES attempts even
    // though every single attempt resolved another task — the #280 bug.
    expect(buildAttempts).toBeGreaterThan(MAX_RETRIES);
    expect(failedEvents).toHaveLength(0);
    expect(await countResolvedTasks(dir)).toBe(TOTAL);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S3 — zero-progress still parks at the existing threshold (negative, no regression)
// ─────────────────────────────────────────────────────────────────────────────
describe('S3: zero-progress still parks at the existing threshold (negative, no regression)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'progress-halt-s3-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('a zero-progress runner still parks via checkAndAutoPark at the unchanged threshold, and lastResolvedCount is stamped even on this pre-existing park path', async () => {
    await seedAllArtifactsExceptTaskStatus(dir);
    await writeTaskStatus(dir, 2, 5); // 2/5 resolved — never changes across attempts

    const runner: StepRunner = { run: vi.fn().mockResolvedValue({ success: true }) };

    const loopHaltEvents: Array<{ reason: string }> = [];
    events.on('loop_halt', (e) => {
      if (e.type === 'loop_halt') loopHaltEvents.push({ reason: e.reason });
    });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: 10, // generous — proves the park fires on the noEvidenceAttempts threshold, not maxRetries
      daemon: true,
      mode: 'auto',
    });

    await conductor.run();

    // Regression lock (T6): unchanged today — parks once the durable
    // no-evidence counter reaches its existing threshold, unaffected by this
    // feature's attempt_ceiling.
    expect(loopHaltEvents).toHaveLength(1);
    // Task 15/#773: the per-task evidence-counter halt reason ("no
    // completion evidence after N attempts") was replaced by the
    // wall-clock/attempt-bound no-task-progress halt.
    expect(loopHaltEvents[0].reason).toMatch(/no task progress/);

    // NEW (T3/T7): lastResolvedCount must be stamped at EVERY build-step exit
    // path, including this pre-existing zero-progress park — not just the
    // new success/ceiling paths this feature adds. Absent from the sidecar
    // today.
    const raw = JSON.parse(await readFile(join(dir, '.pipeline/task-evidence.json'), 'utf-8')) as {
      lastResolvedCount?: number;
    };
    expect(raw.lastResolvedCount).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S4 — absolute attempt ceiling backstops slow-drip within a dispatch (negative)
// ─────────────────────────────────────────────────────────────────────────────
describe('S4: absolute attempt ceiling backstops slow-drip within a dispatch (negative)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'progress-halt-s4-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('attempt_ceiling=5 with a +1-per-attempt runner over 100 tasks stops at exactly 5 attempts with a progressing-hit-ceiling reason, never "tasks not completed"', async () => {
    await seedAllArtifactsExceptTaskStatus(dir);
    const TOTAL = 100;
    const CEILING = 5;
    let progress = 0;
    let buildAttempts = 0;

    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step === 'build') {
          buildAttempts++;
          progress++;
          await writeTaskStatus(dir, progress, TOTAL);
        }
        return { success: true };
      }),
    };

    const loopHaltEvents: Array<{ reason: string }> = [];
    events.on('loop_halt', (e) => {
      if (e.type === 'loop_halt') loopHaltEvents.push({ reason: e.reason });
    });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: 3, // far below the ceiling — proves the ceiling (not max_retries) bounds this run
      daemon: true,
      mode: 'auto',
      config: {
        build_progress_halt: { enabled: true, attempt_ceiling: CEILING, dispatch_ceiling: 20 },
      } as HarnessConfig,
    });

    await conductor.run();

    expect(buildAttempts).toBe(CEILING);
    expect(loopHaltEvents).toHaveLength(1);
    expect(loopHaltEvents[0].reason).toMatch(/progressing.*(hit|reached).{0,20}attempt ceiling/i);
    expect(loopHaltEvents[0].reason).not.toMatch(/tasks not completed/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S2 — progressing parked build is re-kicked without a base advance (happy, cross-dispatch)
// ─────────────────────────────────────────────────────────────────────────────
describe('S2: progressing parked build is re-kicked without a base advance (happy, cross-dispatch)', () => {
  let worktreeBase: string;

  beforeEach(async () => {
    worktreeBase = await mkdtemp(join(tmpdir(), 'progress-halt-s2-wt-'));
  });

  afterEach(async () => {
    await rm(worktreeBase, { recursive: true, force: true });
  });

  it('a parked slug whose worktree sidecar shows last-dispatch progress is re-kick-eligible and gets dispatched again with the base sha unchanged', async () => {
    const slug = 'progressing-spec';
    const wt = join(worktreeBase, slug);
    // Now at 5/10 resolved; the sidecar says the LAST dispatch ended at 2 —
    // a positive delta, so D2's eligibility condition holds.
    await seedSidecarProgress(wt, 5, 10, 2);

    let dispatches = 0;
    const halted = new Set<string>();

    const deps = {
      discoverBacklog: async () => [{ slug } as BacklogItem],
      isHalted: async (s: string) => halted.has(s),
      runFeature: async (item: BacklogItem) => {
        dispatches++;
        halted.add(item.slug); // HALT marker written at park time, as makeRunFeature does
        return { slug: item.slug, status: 'halted' as const };
      },
      // No `resolveBaseSha`/`rekickSweep` deps at all — proves the
      // base-advance path is not required to fire (S2's second bullet).
      isProgressReKickEligible: (s: string) => computeProgressReKickEligible(join(worktreeBase, s)),
      sleep: async () => {},
    };

    const res = await runDaemon(deps as unknown as DaemonDeps, {
      concurrency: 1,
      once: false,
      maxIdlePolls: 4,
    });

    // Today: `pickEligible` has no notion of progress-gated eligibility, so
    // once parked (isHalted stays true — no base advance clears it) the slug
    // is never re-dispatched. dispatches stays at 1 forever.
    expect(dispatches).toBeGreaterThanOrEqual(2);
    expect(res.processed.filter((o) => o.slug === slug).length).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S5 — per-spec dispatch ceiling bounds cross-dispatch re-kick (negative)
// ─────────────────────────────────────────────────────────────────────────────
describe('S5: per-spec dispatch ceiling bounds cross-dispatch re-kick (negative)', () => {
  let worktreeBase: string;

  beforeEach(async () => {
    worktreeBase = await mkdtemp(join(tmpdir(), 'progress-halt-s5-wt-'));
  });

  afterEach(async () => {
    await rm(worktreeBase, { recursive: true, force: true });
  });

  it('dispatch_ceiling=3 with a sidecar that always shows last-dispatch progress produces exactly 3 re-kicks, then stops with a recorded reason', async () => {
    const slug = 'ceiling-spec';
    const wt = join(worktreeBase, slug);
    await seedSidecarProgress(wt, 5, 10, 2);

    let dispatches = 0;
    const halted = new Set<string>();
    const ceilingLogLines: string[] = [];

    const deps = {
      discoverBacklog: async () => [{ slug } as BacklogItem],
      isHalted: async (s: string) => halted.has(s),
      runFeature: async (item: BacklogItem) => {
        dispatches++;
        halted.add(item.slug);
        return { slug: item.slug, status: 'halted' as const };
      },
      isProgressReKickEligible: (s: string) => computeProgressReKickEligible(join(worktreeBase, s)),
      // T9: an already-resolved per-spec bound (mirrors `checkAndAutoPark`'s
      // `maxAttempts` — a plain resolved number, not raw HarnessConfig).
      progressReKickDispatchCeiling: 3,
      log: (m: string) => {
        if (/dispatch.?ceiling/i.test(m)) ceilingLogLines.push(m);
      },
      sleep: async () => {},
    };

    const res = await runDaemon(deps as unknown as DaemonDeps, {
      concurrency: 1,
      once: false,
      maxIdlePolls: 8,
    });

    // Today: dispatches never exceeds 1 (no re-kick mechanism at all), so this
    // fails cleanly instead of the expected "1 initial + 3 ceiling-bounded
    // re-kicks = 4".
    expect(dispatches).toBe(4);
    expect(ceilingLogLines.length).toBeGreaterThanOrEqual(1);
    expect(res.processed.filter((o) => o.slug === slug).length).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S6 — re-kick never double-dispatches a live build (negative, safety)
// ─────────────────────────────────────────────────────────────────────────────
describe('S6: re-kick never double-dispatches a live build (negative, safety)', () => {
  let worktreeBase: string;

  beforeEach(async () => {
    worktreeBase = await mkdtemp(join(tmpdir(), 'progress-halt-s6-wt-'));
  });

  afterEach(async () => {
    await rm(worktreeBase, { recursive: true, force: true });
  });

  it('a slug this run already dispatched to completion (done) is never re-kicked by the progress-gated path, while a genuinely parked sibling with progress IS re-kicked in the same run', async () => {
    const doneSlug = 'already-done';
    const progressingSlug = 'progressing-sibling';
    // Both worktrees "look" progress-eligible by the raw delta alone — the
    // guard that matters is the SAME started/parked/isHalted set already used
    // by the base-advance re-kick path (daemon.ts:93-141), not a re-derivation
    // of "is this slug done".
    await seedSidecarProgress(join(worktreeBase, doneSlug), 10, 10, 2);
    await seedSidecarProgress(join(worktreeBase, progressingSlug), 5, 10, 2);

    const dispatchCounts = new Map<string, number>();
    const halted = new Set<string>();

    const deps = {
      discoverBacklog: async () => [{ slug: doneSlug } as BacklogItem, { slug: progressingSlug } as BacklogItem],
      isHalted: async (s: string) => halted.has(s),
      runFeature: async (item: BacklogItem) => {
        dispatchCounts.set(item.slug, (dispatchCounts.get(item.slug) ?? 0) + 1);
        if (item.slug === doneSlug) {
          return { slug: item.slug, status: 'done' as const }; // permanently excluded (started-set guard)
        }
        halted.add(item.slug);
        return { slug: item.slug, status: 'halted' as const };
      },
      isProgressReKickEligible: (s: string) => computeProgressReKickEligible(join(worktreeBase, s)),
      progressReKickDispatchCeiling: 5,
      sleep: async () => {},
    };

    await runDaemon(deps as unknown as DaemonDeps, {
      concurrency: 2,
      once: false,
      maxIdlePolls: 8,
    });

    // Safety invariant (holds today too, by construction of the pre-existing
    // started/done guard — confirms the new eligibility path doesn't bypass
    // it).
    expect(dispatchCounts.get(doneSlug)).toBe(1);
    // The RED-discriminating assertion: today's daemon has no progress-gated
    // re-kick at all, so the sibling never exceeds its single initial
    // dispatch either.
    expect(dispatchCounts.get(progressingSlug)).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S7 — kill switch and config validation (negative, config)
// ─────────────────────────────────────────────────────────────────────────────
describe('S7: kill switch and config validation (negative, config)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'progress-halt-s7-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('kill switch: build_progress_halt.enabled=false reproduces the fixed max_retries halt exactly, while lastResolvedCount bookkeeping (unconditional, not part of "ceiling and re-kick") is still stamped', async () => {
    await seedAllArtifactsExceptTaskStatus(dir);
    const TOTAL = 6;
    const MAX_RETRIES = 3;
    let progress = 0;
    let buildAttempts = 0;

    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step === 'build') {
          buildAttempts++;
          progress++;
          await writeTaskStatus(dir, progress, TOTAL);
        }
        return { success: true };
      }),
    };

    const failedEvents: unknown[] = [];
    events.on('step_failed', (e) => {
      if (e.type === 'step_failed' && e.step === 'build') failedEvents.push(e);
    });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: MAX_RETRIES,
      daemon: true,
      mode: 'auto',
      config: {
        build_progress_halt: { enabled: false, attempt_ceiling: 30, dispatch_ceiling: 20 },
      } as HarnessConfig,
    });

    await conductor.run();

    // Kill switch: exactly today's fixed-budget halt — the bypass never engages.
    expect(buildAttempts).toBe(MAX_RETRIES);
    expect(failedEvents).toHaveLength(1);

    // NEW (T7): the sidecar write is basic bookkeeping, not part of "the
    // ceiling and re-kick" D3 makes inert — it must still be stamped.
    const raw = JSON.parse(await readFile(join(dir, '.pipeline/task-evidence.json'), 'utf-8')) as {
      lastResolvedCount?: number;
    };
    expect(raw.lastResolvedCount).toBe(MAX_RETRIES);
  });

  it('config validation: attempt_ceiling below max_retries or non-positive is rejected with a specific message; a valid block passes', () => {
    const belowMaxRetries = validateConfig({
      build_progress_halt: { enabled: true, attempt_ceiling: 1, dispatch_ceiling: 20 },
      defaults: { max_retries: 3 },
    });
    expect(belowMaxRetries.ok).toBe(false);
    if (!belowMaxRetries.ok) expect(belowMaxRetries.error.message).toMatch(/attempt_ceiling/i);

    const nonPositive = validateConfig({
      build_progress_halt: { enabled: true, attempt_ceiling: 0, dispatch_ceiling: 20 },
    });
    expect(nonPositive.ok).toBe(false);
    if (!nonPositive.ok) expect(nonPositive.error.message).toMatch(/attempt_ceiling/i);

    const valid = validateConfig({
      build_progress_halt: { enabled: true, attempt_ceiling: 30, dispatch_ceiling: 20 },
      defaults: { max_retries: 3 },
    });
    expect(valid.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S8 — corrupt/missing progress inputs never crash the decision (negative, robustness)
// ─────────────────────────────────────────────────────────────────────────────
describe('S8: corrupt/missing progress inputs never crash the decision (negative, robustness)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'progress-halt-s8-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('a truncated task-status.json and a missing sidecar are both treated as zero progress by the new sidecar reader — no exception escapes', async () => {
    await mkdir(join(root, '.pipeline'), { recursive: true });
    // Truncated/corrupt JSON — never valid.
    await writeFile(join(root, '.pipeline/task-status.json'), '{"tasks": [ { "id": 1, "status": "comple');
    // Sidecar entirely missing.

    // Already-shipped, real primitive: confirms the corrupt status file alone
    // is harmless (the OTHER half of the "no exception escapes" contract).
    const resolved = await countResolvedTasks(root);
    expect(resolved).toBe(0);

    // T3/T8/T11: the NEW sidecar accessor that reads `lastResolvedCount`
    // (tolerant `|| 0`, per the plan) does not exist yet.
    const mod = (await import('../../src/engine/task-evidence.js')) as Record<string, unknown>;
    if (typeof mod.readLastResolvedCount !== 'function') {
      throw new Error(
        'expected export "readLastResolvedCount" from task-evidence.ts to be a function (not yet implemented)',
      );
    }
    const readLastResolvedCount = mod.readLastResolvedCount as (projectRoot: string) => Promise<number>;
    const count = await readLastResolvedCount(root);
    expect(count).toBe(0);
  });
});
