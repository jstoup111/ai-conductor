import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execa } from 'execa';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepName } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import * as projectPrelude from '../../src/engine/project-prelude.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "Builds stall when work lands without Task: trailer
// stamps" (commit-movement liveness floor).
// (.docs/stories/builds-stall-when-work-lands-without-task-trailer-.md, Story 1;
//  plan: .docs/plans/builds-stall-when-work-lands-without-task-trailer-.md, Task 2;
//  ADR: adr-2026-07-23-commit-movement-liveness-floor).
//
// Technical track, no PRD — no FR-coverage table (§3e out of scope).
//
// These drive the REAL production entry point — `Conductor.run()`'s build-step
// retry loop (conductor.ts ~3191-4270) — the same loop
// `test/engine/conductor.test.ts`'s `describe('build-step stall circuit
// breaker', ...)` block exercises, rather than a predicate helper in
// isolation. The regression is a LOOP-LEVEL misread (a build with real,
// committed-but-unattributed work reads as `no_task_progress` and terminally
// HALTs), so only driving the loop end-to-end with real git commits proves
// the fix reaches the call site that actually stalled in production.
//
// Currently (pre-fix) the breaker's classification at conductor.ts:3834 is
// `attempt >= 2 && resolvedTasksAfter <= resolvedTasksBefore` — it never
// looks at whether HEAD moved, so an attempt that lands a real (but
// trailer-less) commit is misread as zero-work exactly like a genuinely
// wedged attempt. This is the RED failure these specs pin.
//
// Dedup note (§2 overlap check): Story 1's negative path "count pinned AND
// HEAD identical → stalled = 'no_task_progress' exactly as today" is already
// covered by trailer-union-build-completion.acceptance.test.ts's "genuine
// stall (no trailers, no completed rows, count pinned across attempts) still
// halts no_task_progress" test, and by test/engine/conductor.test.ts's
// "triggers build_stall after two retries with zero new task completions"
// (which runs in a non-git dir, so `currentCommitSha` fails on every call —
// that test already pins Story 1's negative path "sha-read failure degrades
// to unmoved / fail-closed" as a side effect of having no git repo at all).
// Neither is duplicated here. Story 1's negative path 3 (an explicit,
// git-repo-present SHA-read-failure injection) is deferred to plan Task 5,
// which owns that RED cycle directly.
// ─────────────────────────────────────────────────────────────────────────────

async function initGitRepo(dir: string): Promise<void> {
  await execa('git', ['init', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Test User'], { cwd: dir });
  await writeFile(join(dir, 'README.md'), '# Test\n');
  await execa('git', ['add', 'README.md'], { cwd: dir });
  await execa('git', ['commit', '-m', 'Initial commit'], { cwd: dir });
}

async function commitWithTaskTrailer(dir: string, taskId: string, seq: number): Promise<void> {
  const file = `work-${seq}.txt`;
  await writeFile(join(dir, file), `work for task ${taskId}\n`);
  await execa('git', ['add', file], { cwd: dir });
  await execa(
    'git',
    ['commit', '-m', `feat: implement task ${taskId}\n\nTask: ${taskId}\n`],
    { cwd: dir },
  );
}

// Real committed work that carries NO `Task:` trailer — models the
// "20-commit/3-trailer" regression shape where the majority of an attempt's
// commits are never attributed to a plan task id.
async function commitPlainWork(dir: string, seq: number): Promise<void> {
  const file = `unattributed-work-${seq}.txt`;
  await writeFile(join(dir, file), `unattributed work ${seq}\n`);
  await execa('git', ['add', file], { cwd: dir });
  await execa('git', ['commit', '-m', `chore: unattributed work ${seq}`], { cwd: dir });
}

// Fast-forwards every pre-build step's completion check by seeding the
// artifacts each already requires — ported verbatim from
// test/engine/conductor.test.ts's stall-breaker fixture (`
// seedAllArtifactsExceptTaskStatus`), which is file-private there, and from
// trailer-union-build-completion.acceptance.test.ts's copy of the same.
async function seedAllArtifactsExceptTaskStatus(dir: string): Promise<void> {
  const artifacts: Array<[string, string]> = [
    ['.docs/decisions/technical-assessment-2026-07-23.md', 'x'],
    ['.docs/specs/2026-07-23-feature.md', 'x'],
    ['.docs/stories/epic-1/a.md', 'x'],
    ['.docs/conflicts/2026-07-23.md', 'x'],
    ['.docs/architecture/arch.md', 'x'],
    ['.docs/decisions/adr-001.md', 'x'],
    ['.docs/coherence/coherence.md', 'x'],
    ['spec/acceptance/feature_spec.rb', 'x'],
    [
      '.pipeline/acceptance-specs-red.json',
      JSON.stringify({
        command: 'bundle exec rspec spec/acceptance',
        targetSpecs: ['spec/acceptance/feature_spec.rb'],
        executed: 1,
        passed: 0,
        failed: 1,
        skipped: 0,
        errors: 0,
      }),
    ],
    ['.docs/retros/2026-07-23-retro.md', 'x'],
  ];
  for (const [rel, content] of artifacts) {
    const full = join(dir, rel);
    await mkdir(full.substring(0, full.lastIndexOf('/')), { recursive: true });
    await writeFile(full, content);
  }
}

// Writes the plan (Task 1..total headings) and task-status.json rows.
// `completedIds` become `completed` rows; every other id is `pending`.
async function writePlanAndStatus(
  dir: string,
  total: number,
  completedIds: number[] = [],
): Promise<void> {
  await mkdir(join(dir, '.pipeline'), { recursive: true });
  await mkdir(join(dir, '.docs/plans'), { recursive: true });
  const planLines: string[] = ['# Plan', ''];
  for (let i = 1; i <= total; i++) {
    planLines.push(`### Task ${i}: Step ${i}`, '');
  }
  await writeFile(join(dir, '.docs/plans/2026-07-23-plan.md'), planLines.join('\n'));
  const completed = new Set(completedIds);
  const tasks = Array.from({ length: total }, (_, idx) => {
    const id = idx + 1;
    return { id, status: completed.has(id) ? 'completed' : 'pending' };
  });
  await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({ tasks }));
}

interface UnattributedProgressEvent {
  type: 'unattributed_progress';
  step: string;
  attempt: number;
  resolvedCount: number;
  headBefore: string | null;
  headAfter: string | null;
}

describe('commit-movement liveness floor (real Conductor.run() build retry loop)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;
  let stepOrder: StepName[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-liveness-floor-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    stepOrder = [];
    events.on('step_started', (e) => {
      if (e.type === 'step_started') stepOrder.push(e.step);
    });
    await initGitRepo(dir);
    await seedAllArtifactsExceptTaskStatus(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function makeConductor(
    maxRetries: number,
    runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> },
  ): {
    conductor: Conductor;
    stallEvents: Array<{ reason: string }>;
    unattributedEvents: UnattributedProgressEvent[];
    onRecovery: ReturnType<typeof vi.fn>;
  } {
    const stallEvents: Array<{ reason: string }> = [];
    events.on('build_stall', (e) => {
      if (e.type === 'build_stall') stallEvents.push({ reason: e.reason });
    });
    const unattributedEvents: UnattributedProgressEvent[] = [];
    // `unattributed_progress` does not exist in the ConductorEvent union yet
    // (plan Task 1) — subscribe by raw type string so this spec exercises
    // the real event bus rather than a type that hasn't been added.
    events.on('unattributed_progress' as unknown as never, ((e: unknown) => {
      const evt = e as UnattributedProgressEvent;
      if (evt.type === 'unattributed_progress') unattributedEvents.push(evt);
    }) as never);
    const onRecovery = vi.fn().mockResolvedValue('quit' as const);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries,
      onRecovery,
    });
    return { conductor, stallEvents, unattributedEvents, onRecovery };
  }

  it('attempt >= 2, resolved count pinned, HEAD moves every attempt (real commits, no Task: trailer) → never classified as a stall; unattributed_progress emitted', async () => {
    await writePlanAndStatus(dir, 3, []); // zero completed rows, zero trailer commits ever land

    let seq = 0;
    const runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> } = {
      run: vi.fn().mockImplementation(async () => {
        seq++;
        await commitPlainWork(dir, seq); // real commit, unattributed — HEAD moves, resolved count stays 0
        return { success: true };
      }),
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };

    const { conductor, stallEvents, unattributedEvents } = makeConductor(3, runner);
    await conductor.run();

    expect(stallEvents.filter((e) => e.reason === 'no_task_progress')).toHaveLength(0);
    expect(unattributedEvents.length).toBeGreaterThan(0);
    for (const e of unattributedEvents) {
      expect(e.step).toBe('build');
      expect(e.resolvedCount).toBe(0);
      expect(e.headBefore).toBeTruthy();
      expect(e.headAfter).toBeTruthy();
      expect(e.headBefore).not.toBe(e.headAfter);
    }

    // No path may write the "resolved tasks stayed at" terminal-HALT text —
    // that string is only ever constructed at the exact no_task_progress
    // classification site (conductor.ts:3839), so if no attempt classified
    // no_task_progress, no HALT write can contain it either.
    const haltContent = await readFile(join(dir, '.pipeline/HALT'), 'utf-8').catch(() => null);
    expect(haltContent ?? '').not.toMatch(/resolved tasks stayed at/);
  });

  it('regression fixture — sparse trailers (minority of tasks trailer-stamped), commits land every attempt → zero no_task_progress classifications across the full retry budget', async () => {
    await writePlanAndStatus(dir, 10, []); // 10-task plan, zero completed rows
    // Pre-seed a MINORITY of tasks as trailer-resolved before the loop even
    // starts — mirrors the "trailers for only 3 task ids" regression shape.
    await commitWithTaskTrailer(dir, '1', 1);
    await commitWithTaskTrailer(dir, '2', 2);
    await commitWithTaskTrailer(dir, '3', 3);

    let seq = 100;
    const runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> } = {
      run: vi.fn().mockImplementation(async () => {
        seq++;
        await commitPlainWork(dir, seq); // every attempt lands real, unattributed work
        return { success: true };
      }),
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };

    const { conductor, stallEvents } = makeConductor(4, runner);
    await conductor.run();

    expect(stallEvents.filter((e) => e.reason === 'no_task_progress')).toHaveLength(0);
    const haltContent = await readFile(join(dir, '.pipeline/HALT'), 'utf-8').catch(() => null);
    expect(haltContent ?? '').not.toMatch(/resolved tasks stayed at/);
  });

  it('resolved count MOVES every attempt → existing #280 progress-bypass fires exactly as today; the floor adds no interference', async () => {
    await writePlanAndStatus(dir, 3, []);

    let taskSeq = 0;
    const runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> } = {
      run: vi.fn().mockImplementation(async () => {
        taskSeq++;
        await commitWithTaskTrailer(dir, String(taskSeq), taskSeq); // count strictly increases each attempt
        return { success: true };
      }),
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };

    const { conductor, stallEvents, unattributedEvents } = makeConductor(3, runner);
    await conductor.run();

    expect(stallEvents.filter((e) => e.reason === 'no_task_progress')).toHaveLength(0);
    // The floor is scoped to the pinned-count case only — a count that
    // genuinely moves must never emit the liveness-floor telemetry event.
    expect(unattributedEvents).toHaveLength(0);
  });

  it('halt marker present AND HEAD moves this attempt → stalled = halt_marker; explicit halt is never overridden by commit movement', async () => {
    await writePlanAndStatus(dir, 3, []);
    await writeFile(join(dir, '.pipeline/halt-user-input-required'), 'scope mismatch');

    let seq = 0;
    const runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> } = {
      run: vi.fn().mockImplementation(async () => {
        seq++;
        await commitPlainWork(dir, seq); // HEAD moves even though the halt marker is set
        return { success: true };
      }),
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };

    const { conductor, stallEvents, unattributedEvents } = makeConductor(3, runner);
    await conductor.run();

    expect(stallEvents.some((e) => e.reason === 'halt_marker')).toBe(true);
    expect(stallEvents.some((e) => e.reason === 'no_task_progress')).toBe(false);
    expect(unattributedEvents).toHaveLength(0);
  });

  it('C2 — attempt 1 lands one commit, attempts 2..N land nothing (count pinned) → attempts 2+ still classify no_task_progress and HALT; per-attempt baseline, not per-step', async () => {
    // Proves per-attempt granularity: a per-step-baseline implementation
    // (comparing every attempt's HEAD against `headShaBeforeBuild`, captured
    // once at step entry) would incorrectly read every later attempt as
    // "live" because HEAD moved once, at attempt 1, somewhere in the step.
    // The correct per-attempt implementation re-baselines
    // `headShaAttemptStart` to the attempt-end SHA after each attempt, so
    // attempts 2..N — which land zero commits — see HEAD unmoved relative to
    // THEIR OWN start and classify no_task_progress exactly as today.
    await writePlanAndStatus(dir, 3, []); // zero completed rows; no trailer commits ever land

    let seq = 0;
    let calls = 0;
    const runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> } = {
      run: vi.fn().mockImplementation(async () => {
        calls++;
        if (calls === 1) {
          seq++;
          await commitPlainWork(dir, seq); // ONLY attempt 1 lands a real commit
        }
        // attempts 2..N: no commit, count stays pinned at 0
        return { success: true };
      }),
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };

    const { conductor, stallEvents, unattributedEvents, onRecovery } = makeConductor(3, runner);
    await conductor.run();

    // Attempt 1 lands the only commit but the breaker only classifies from
    // attempt >= 2, so attempt 1 itself never gets checked (no
    // unattributed_progress, no stall). Attempts 2+: HEAD did NOT move
    // relative to THEIR OWN start (attempt 1's single commit is stale
    // history by then) — classified no_task_progress, same as if no commit
    // had ever landed in the step at all.
    expect(stallEvents.filter((e) => e.reason === 'no_task_progress').length).toBeGreaterThan(0);
    expect(unattributedEvents).toHaveLength(0);

    // The build must still reach the same terminal outcome as today's
    // genuine-wedge path — one early commit must not blind the wedge
    // detector for the rest of the step. This fixture runs non-daemon (no
    // `daemon: true` on the Conductor), so the recovery menu (`onRecovery`),
    // not the `.pipeline/HALT` file, is the terminal signal — the HALT file
    // is daemon-only (see conductor.ts's `LOOP_HALT_MARKER` write sites,
    // all gated on `this.daemon`).
    expect(onRecovery).toHaveBeenCalled();
    const haltContent = await readFile(join(dir, '.pipeline/HALT'), 'utf-8').catch(() => null);
    expect(haltContent).toBeNull();
  });

  it('Story 1 negative path 3 — SHA read fails (returns null) on one side of the comparison, count pinned → still classifies no_task_progress (fail-closed, never fabricates liveness from missing data)', async () => {
    await writePlanAndStatus(dir, 3, []); // zero completed rows, count pinned at 0 throughout

    const realCurrentCommitSha = projectPrelude.currentCommitSha;
    const spy = vi.spyOn(projectPrelude, 'currentCommitSha');
    let call = 0;
    spy.mockImplementation(async (root: string) => {
      call++;
      // Fail exactly one read per attempt (simulating a transient git
      // error / unreadable SHA) so the comparison always has one null
      // side and one real side — this must NEVER be read as "moved".
      if (call % 2 === 0) return null;
      return realCurrentCommitSha(root);
    });

    const runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> } = {
      run: vi.fn().mockImplementation(async () => {
        // No commit lands — count stays pinned regardless of SHA reads.
        return { success: true };
      }),
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };

    const { conductor, stallEvents, unattributedEvents } = makeConductor(3, runner);
    await conductor.run();
    spy.mockRestore();

    // The floor must degrade fail-closed: a null/unreadable SHA read must
    // never suppress the genuine no_task_progress stall it would otherwise
    // classify. It may only ever cause a stall to still fire — never mask one.
    expect(stallEvents.some((e) => e.reason === 'no_task_progress')).toBe(true);
    expect(unattributedEvents).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RED spec for plan Task 7 ("budget exhaustion with real work must route to
// build_review"). Tasks 1-6 (already landed) stop the retry loop from
// MISCLASSIFYING an unattributed-but-real-work attempt as `no_task_progress`
// — but they do not yet decide what happens when the fixed `stepMaxRetries`
// budget is exhausted while EVERY attempt moved HEAD (i.e. every attempt
// classified `unattributed_progress`, never `no_task_progress`). Today,
// conductor.ts's exhaustion tail (~4386-5154) always treats a non-succeeded
// build step as a hard failure and falls through to the generic
// "step 'build' failed in auto mode (retries exhausted)" HALT
// (conductor.ts:5130) via LOOP_HALT_MARKER — there is no routing to
// build_review for this case yet (that's plan Task 8, GREEN). This spec
// pins the desired end-state and MUST fail against today's code.
// ─────────────────────────────────────────────────────────────────────────────
describe('budget exhaustion with real, unattributed commits every attempt (RED — plan Task 7)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-exhaustion-routing-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await initGitRepo(dir);
    await seedAllArtifactsExceptTaskStatus(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('every attempt moves HEAD (unattributed_progress, never no_task_progress) → step advances to build_review, no terminal no_task_progress HALT is written, and the routed reason names the unresolved plan task ids', async () => {
    // 3-task plan, zero completed rows — none of the 3 plan task ids ever
    // resolve across the whole retry budget, but every attempt lands a real,
    // trailer-less commit (HEAD moves every time).
    await writePlanAndStatus(dir, 3, []);

    let seq = 0;
    const runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> } = {
      run: vi.fn().mockImplementation(async () => {
        seq++;
        await commitPlainWork(dir, seq); // real commit, unattributed — HEAD moves every attempt
        // Deliberately never satisfy the build-step completion gate so the
        // loop runs out the full fixed retry budget.
        return { success: true };
      }),
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };

    const stallEvents: Array<{ reason: string }> = [];
    events.on('build_stall', (e) => {
      if (e.type === 'build_stall') stallEvents.push({ reason: e.reason });
    });
    const unattributedEvents: UnattributedProgressEvent[] = [];
    events.on('unattributed_progress' as unknown as never, ((e: unknown) => {
      const evt = e as UnattributedProgressEvent;
      if (evt.type === 'unattributed_progress') unattributedEvents.push(evt);
    }) as never);
    const stepStarts: StepName[] = [];
    events.on('step_started', (e) => {
      if (e.type === 'step_started') stepStarts.push(e.step);
    });

    // Daemon + auto mode: the exhaustion-tail HALT/routing behavior this
    // spec targets is gated on `this.daemon` / `this.mode === 'auto'` (see
    // conductor.ts's LOOP_HALT_MARKER write sites and the auto-mode
    // unattended-failure branch at ~4386-5154).
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 3,
    });

    await conductor.run();

    // (a) step advances to build_review, not HALT.
    expect(stepStarts).toContain('build_review');

    // No attempt should ever have classified no_task_progress — every
    // attempt moved HEAD.
    expect(stallEvents.filter((e) => e.reason === 'no_task_progress')).toHaveLength(0);
    expect(unattributedEvents.length).toBeGreaterThan(0);

    // (b) no terminal no_task_progress HALT is written for the `build` step
    // itself — this spec targets only the `build` → `build_review` routing
    // seam (plan Task 8). `build_review` and any step beyond it are
    // downstream, unrelated gates with their own completion criteria (this
    // fixture's stub runner never satisfies them, e.g. no build-review.json
    // verdict), so a HALT from one of THOSE steps exhausting its own retry
    // budget is expected and does not indicate a routing regression. What
    // must never appear is the specific no_task_progress/"resolved tasks
    // stayed at" text this fix exists to prevent.
    const haltContent = await readFile(join(dir, '.pipeline/HALT'), 'utf-8').catch(() => null);
    expect(haltContent ?? '').not.toMatch(/no_task_progress/);
    expect(haltContent ?? '').not.toMatch(/resolved tasks stayed at/);

    // (c) the routed reason names the unresolved plan task ids (1, 2, 3 —
    // none of them ever resolved across the exhausted budget).
    const stateContent = await readFile(statePath, 'utf-8').catch(() => null);
    const combined = `${haltContent ?? ''}\n${stateContent ?? ''}`;
    expect(combined).toMatch(/\b1\b/);
    expect(combined).toMatch(/\b2\b/);
    expect(combined).toMatch(/\b3\b/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C1 identity test (plan Task 9): the routed exit added in Task 8 MUST reuse
// the exact same advance seam `completion.done` uses — no second, divergent
// "success" code path. Runs one fixture to a normal `completion.done` advance
// (all plan tasks trailer-stamped, gate satisfied on attempt 1) and one to a
// routed advance (Task 7/8's shape — zero resolved rows, every attempt moves
// HEAD, budget exhausts), then asserts the persisted `build` step state and
// the build → build_review transition shape are identical between the two.
// ─────────────────────────────────────────────────────────────────────────────
describe('C1 — one advance seam, identity-asserted (plan Task 9)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-advance-identity-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await initGitRepo(dir);
    await seedAllArtifactsExceptTaskStatus(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('gate advance (completion.done on attempt 1) and routed advance (budget exhausted, commit movement) persist identical build-step state and transition shape', async () => {
    // ── Fixture A: gate advance — every plan task trailer-stamped, so
    // `completion.done` is true on the very first attempt. ──────────────────
    await writePlanAndStatus(dir, 3, []);
    const stepStartsGate: StepName[] = [];
    events.on('step_started', (e) => {
      if (e.type === 'step_started') stepStartsGate.push(e.step);
    });
    const gateRunner: StepRunner & { runInteractive: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> } = {
      run: vi.fn().mockImplementation(async (step: StepName) => {
        // Only the `build` step needs to land the trailer commits that
        // satisfy `completion.done` — every other step in the chain (worktree,
        // memory, explore, ...) just needs to return success so its own
        // (glob-satisfied-by-the-seed) completion check passes.
        if (step === 'build') {
          await commitWithTaskTrailer(dir, '1', 1);
          await commitWithTaskTrailer(dir, '2', 2);
          await commitWithTaskTrailer(dir, '3', 3);
        }
        return { success: true };
      }),
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };
    const gateConductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: gateRunner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 3,
    });
    await gateConductor.run();

    const gateStateRaw = await readFile(statePath, 'utf-8');
    const gateState = JSON.parse(gateStateRaw) as Record<string, unknown>;

    // ── Fixture B: routed advance — same 3-task plan, zero resolved rows,
    // every attempt lands real unattributed commits, budget exhausts. ───────
    const dir2 = await mkdtemp(join(tmpdir(), 'conductor-advance-identity-'));
    const statePath2 = join(dir2, 'conduct-state.json');
    const events2 = new ConductorEventEmitter();
    await initGitRepo(dir2);
    await seedAllArtifactsExceptTaskStatus(dir2);
    await writePlanAndStatus(dir2, 3, []);
    const stepStartsRouted: StepName[] = [];
    events2.on('step_started', (e) => {
      if (e.type === 'step_started') stepStartsRouted.push(e.step);
    });
    let seq = 0;
    const routedRunner: StepRunner & { runInteractive: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> } = {
      run: vi.fn().mockImplementation(async () => {
        seq++;
        await commitPlainWork(dir2, seq);
        return { success: true };
      }),
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };
    const routedConductor = new Conductor({
      stateFilePath: statePath2,
      stepRunner: routedRunner,
      events: events2,
      projectRoot: dir2,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 3,
    });
    await routedConductor.run();

    const routedStateRaw = await readFile(statePath2, 'utf-8');
    const routedState = JSON.parse(routedStateRaw) as Record<string, unknown>;

    await rm(dir2, { recursive: true, force: true });

    // Same advance seam → same persisted `build` step status in both cases.
    expect(gateState.build).toBe('done');
    expect(routedState.build).toBe('done');
    expect(gateState.build).toBe(routedState.build);

    // Same next-step scheduling shape: from `build` onward, both runs pick
    // the identical sequence of steps (the SAME advanceTail selection code
    // path — a divergent second advance path could plausibly pick a
    // different next step, insert/skip a transition, or otherwise diverge).
    const gateBuildIdx = stepStartsGate.indexOf('build');
    const routedBuildIdx = stepStartsRouted.indexOf('build');
    expect(gateBuildIdx).toBeGreaterThanOrEqual(0);
    expect(routedBuildIdx).toBeGreaterThanOrEqual(0);
    expect(stepStartsGate.slice(gateBuildIdx)).toEqual(stepStartsRouted.slice(routedBuildIdx));
    expect(stepStartsGate).toContain('build_review');
    expect(stepStartsRouted).toContain('build_review');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wedge preservation (plan Task 10): the routing seam added in Task 8 is
// gated strictly on `anyAttemptMovedHead` — a genuine wedge (zero commits
// across every attempt, resolved-count pinned) must still hit today's
// #569 remediation-prompt synthesis and terminal no_task_progress HALT path
// exactly as before. No production code change is expected for this task;
// this pins the pre-existing behavior so a future change to the Task 8
// routing branch cannot silently widen it to swallow real stalls.
// ─────────────────────────────────────────────────────────────────────────────
describe('genuine wedge preserved — remediation and HALT shapes unchanged (plan Task 10)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-wedge-preserved-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await initGitRepo(dir);
    await seedAllArtifactsExceptTaskStatus(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('budget exhausts with zero commits across every build attempt → #569 remediation prompt synthesized, terminal no_task_progress HALT written, no routing to build_review', async () => {
    // 3-task plan, zero completed rows, and — unlike every other fixture in
    // this file — the `build` step NEVER lands a commit. HEAD never moves,
    // resolved count never moves: a genuine wedge.
    await writePlanAndStatus(dir, 3, []);

    const runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> } = {
      run: vi.fn().mockResolvedValue({ success: true }),
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };

    const stallEvents: Array<{ reason: string }> = [];
    events.on('build_stall', (e) => {
      if (e.type === 'build_stall') stallEvents.push({ reason: e.reason });
    });
    const unattributedEvents: unknown[] = [];
    events.on('unattributed_progress' as unknown as never, ((e: unknown) => {
      unattributedEvents.push(e);
    }) as never);
    const stepStarts: StepName[] = [];
    events.on('step_started', (e) => {
      if (e.type === 'step_started') stepStarts.push(e.step);
    });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 3,
    });

    await conductor.run();

    // Never routed — no attempt ever moved HEAD, so Task 8's routing branch
    // must never engage.
    expect(stepStarts).not.toContain('build_review');
    expect(unattributedEvents).toHaveLength(0);

    // Classified as a genuine wedge, same as today.
    expect(stallEvents.some((e) => e.reason === 'no_task_progress')).toBe(true);

    // #569 remediation prompt synthesis shape is preserved — this fixture's
    // stub `stepRunner.run('remediate', ...)` returns success without
    // writing a usable `.pipeline/remediation.json`, so the dispatch
    // degrades and the synthesized question surfaces into the stall
    // question evidence file exactly as it does today.
    const questionContent = await readFile(
      join(dir, '.pipeline/build-stall-question.md'),
      'utf-8',
    ).catch(() => null);
    expect(questionContent).toMatch(/^Build stall: no forward progress \(resolved \d+ → \d+ tasks\)\. Completion gate: .+\.$/m);

    // Terminal HALT reason shape preserved — "build stalled: no task
    // progress…" — and it must be the ONLY reason on disk (never overwritten
    // by, nor coexisting with, a routed reason).
    const haltContent = await readFile(join(dir, '.pipeline/HALT'), 'utf-8').catch(() => null);
    expect(haltContent).toMatch(/build stalled: no task progress/);

    // No routed reason was ever recorded into state — the field Task 8
    // introduced stays entirely absent on the genuine-wedge path.
    const stateContent = await readFile(statePath, 'utf-8').catch(() => null);
    const state = stateContent ? (JSON.parse(stateContent) as Record<string, unknown>) : {};
    expect(state.build_routed_reason).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Kickback bound on routed builds (plan Task 11): a build that only ever
// reaches `build_review` via Task 8's routed exit must inherit the SAME
// `MAX_KICKBACKS_PER_GATE` bound a normal completion.done-advanced build
// gets — the routed entry must never bypass the anti-ping-pong counter.
// Covers the no-op-commit gaming shape too: an operator (or a misbehaving
// agent) could try to farm the routed seam by landing trivial commits every
// attempt without ever resolving a plan task; this proves that shape still
// terminates at the cap instead of looping forever.
// ─────────────────────────────────────────────────────────────────────────────
describe('routed builds inherit the kickback bound (plan Task 11)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-routed-kickback-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await initGitRepo(dir);
    await seedAllArtifactsExceptTaskStatus(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('routed build → build_review FAIL, repeated, stops at MAX_KICKBACKS_PER_GATE (no infinite route→FAIL loop); no-op-commit gaming is bounded the same way', async () => {
    // 3-task plan, zero completed rows — no attempt ever resolves a plan
    // task, so every `build` dispatch exhausts its retry budget and reaches
    // `build_review` only via Task 8's routed exit (never completion.done).
    await writePlanAndStatus(dir, 3, []);

    let seq = 0;
    const runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> } = {
      run: vi.fn().mockImplementation(async (step: StepName) => {
        if (step === 'build') {
          seq++;
          // No-op-commit gaming shape: a trivial, content-varying commit
          // every attempt — real HEAD movement, never a resolved task.
          await commitPlainWork(dir, seq);
        } else if (step === 'build_review') {
          const { stdout: headSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
          await writeFile(
            join(dir, '.pipeline/build-review.json'),
            JSON.stringify({
              verdict: 'FAIL',
              reasons: ['no plan task was ever resolved'],
              rubric: { completeness: true },
              codeStamp: headSha.trim(),
            }),
          );
        }
        return { success: true };
      }),
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };

    const kickbackEvents: Array<{ from: string; to: string; count: number }> = [];
    events.on('kickback', (e) => {
      if (e.type === 'kickback') kickbackEvents.push({ from: e.from, to: e.to, count: e.count });
    });
    const stepStarts: StepName[] = [];
    events.on('step_started', (e) => {
      if (e.type === 'step_started') stepStarts.push(e.step);
    });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 2,
    });

    await conductor.run();

    // The routed seam engaged repeatedly — build_review was reached more
    // than once, each time via Task 8's routing branch (the plan never
    // resolves, so completion.done for `build` is never true).
    expect(stepStarts.filter((s) => s === 'build_review').length).toBeGreaterThan(1);

    // Kickback fired, from build_review to build, bounded by the cap — never
    // an unbounded route→FAIL loop.
    expect(kickbackEvents.length).toBeGreaterThan(0);
    expect(kickbackEvents.length).toBeLessThanOrEqual(2); // MAX_KICKBACKS_PER_GATE
    for (const k of kickbackEvents) {
      expect(k.from).toBe('build_review');
      expect(k.to).toBe('build');
    }

    // Terminal state: bounded HALT naming the kickback cap, not an infinite
    // loop (the run always returns from conductor.run()).
    const haltContent = await readFile(join(dir, '.pipeline/HALT'), 'utf-8').catch(() => null);
    expect(haltContent).toMatch(/build_review FAIL unresolved after \d+ build kickback\(s\) \(cap 2\)/);

    // The routed reason was recorded on (at least) the first routed entry —
    // proof the routed path, not completion.done, is what fed build_review
    // each cycle.
    const stateContent = await readFile(statePath, 'utf-8').catch(() => null);
    const state = stateContent ? (JSON.parse(stateContent) as Record<string, unknown>) : {};
    expect(typeof state.build_routed_reason).toBe('string');
    expect(state.build_routed_reason as string).toMatch(/routed: unresolved \[1, 2, 3\]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C3 end-to-end (plan Task 12): routing is explicit, never a silent
// always-pass. A 3-task plan where tasks 1 and 2 resolve (trailer-stamped on
// attempt 1) but task 3 never does: `build` still routes forward via Task 8
// (real commit movement keeps landing, budget exhausts) rather than HALTing
// — but the gap is never swallowed. Both the kickback re-dispatch context
// (the retry hint handed back to `build`) AND the routed-reason persisted to
// state name task 3, specifically, as the unresolved id.
// ─────────────────────────────────────────────────────────────────────────────
describe('C3 — routing-only is never always-pass (plan Task 12)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-c3-e2e-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await initGitRepo(dir);
    await seedAllArtifactsExceptTaskStatus(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('plan of 3 tasks, 1 and 2 resolved, 3 never resolved → build routes forward; build_review FAIL names task 3; kickback context AND routed-reason both name task 3', async () => {
    await writePlanAndStatus(dir, 3, []);

    let buildAttempt = 0;
    const buildRetryReasons: Array<string | undefined> = [];
    const runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> } = {
      run: vi.fn().mockImplementation(async (step: StepName, _state, opts) => {
        if (step === 'build') {
          buildAttempt++;
          buildRetryReasons.push(opts?.retryReason);
          if (buildAttempt === 1) {
            // Attempt 1 (of this build-step dispatch): resolve tasks 1 and
            // 2, task 3 deliberately never gets a trailer.
            await commitWithTaskTrailer(dir, '1', 1);
            await commitWithTaskTrailer(dir, '2', 2);
          } else {
            // Every later attempt still lands real, unattributed commit
            // movement — task 3 stays unresolved, but the loop never wedges.
            await commitPlainWork(dir, buildAttempt);
          }
        } else if (step === 'build_review') {
          const { stdout: headSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
          await writeFile(
            join(dir, '.pipeline/build-review.json'),
            JSON.stringify({
              verdict: 'FAIL',
              reasons: ['plan task 3 was never resolved'],
              rubric: { completeness: true },
              codeStamp: headSha.trim(),
            }),
          );
        }
        return { success: true };
      }),
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };

    const stepStarts: StepName[] = [];
    events.on('step_started', (e) => {
      if (e.type === 'step_started') stepStarts.push(e.step);
    });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 2,
    });

    await conductor.run();

    // Routed forward at least once — build_review was reached even though
    // task 3 never resolved.
    expect(stepStarts).toContain('build_review');

    // Kickback re-dispatch context (the retry hint `build` receives on its
    // NEXT dispatch, after build_review's FAIL) names task 3's gap.
    const hintsAfterKickback = buildRetryReasons.filter((r) => r !== undefined);
    expect(hintsAfterKickback.length).toBeGreaterThan(0);
    expect(hintsAfterKickback.some((r) => r!.includes('plan task 3 was never resolved'))).toBe(
      true,
    );

    // The routed-reason persisted to state also names task 3, specifically
    // — never silently drops the gap, and never mis-names a resolved task
    // (1 or 2) as unresolved.
    const stateContent = await readFile(statePath, 'utf-8').catch(() => null);
    const state = stateContent ? (JSON.parse(stateContent) as Record<string, unknown>) : {};
    expect(typeof state.build_routed_reason).toBe('string');
    const routedReason = state.build_routed_reason as string;
    expect(routedReason).toMatch(/routed: unresolved \[3\]/);
    expect(routedReason).not.toMatch(/unresolved \[.*\b1\b.*\]/);
    expect(routedReason).not.toMatch(/unresolved \[.*\b2\b.*\]/);
  });
});
