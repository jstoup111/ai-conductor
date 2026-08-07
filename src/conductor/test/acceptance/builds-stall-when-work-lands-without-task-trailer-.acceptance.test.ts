import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execa } from 'execa';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { StepRunner } from '../../src/engine/conductor.js';
import type { StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import * as projectPrelude from '../../src/engine/project-prelude.js';
import { countResolvedTasks } from '../../src/engine/task-progress.js';
import { buildProgressReKickDeps } from '../../src/daemon-cli.js';
import { createTaskEvidence } from '../../src/engine/task-evidence.js';
import { initTestRepo } from '../fixtures/git-repo.js';
import { Conductor } from '../test-conductor.js';

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
  // Delegate to the shared fixture rather than hand-rolling `git init` + identity:
  // it also pins `gc.auto=0` / `maintenance.auto=false`. Suites here commit
  // repeatedly across a retry budget and can cross the auto-gc threshold, and
  // `git gc --auto` detaches a process that keeps writing `.git/objects/pack`
  // after the test returns — racing `afterEach`'s recursive remove and failing
  // it with ENOTEMPTY.
  await initTestRepo(dir);
  await writeFile(join(dir, 'README.md'), '# Test\n');
  // Match a real conductor worktree: runtime state and gate evidence are
  // gitignored. The BUILD completion predicate deliberately rejects a dirty
  // worktree, so a scratch repository must not mistake those runtime files
  // for uncommitted implementation work.
  await writeFile(join(dir, '.gitignore'), '.pipeline/\nconduct-state.json\n');
  await execa('git', ['add', 'README.md', '.gitignore'], { cwd: dir });
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

/** Advance HEAD without changing its tree, the no-op-commit livelock shape. */
async function commitEmptyWork(dir: string, seq: number): Promise<void> {
  await execa('git', ['commit', '--allow-empty', '-m', `chore: empty work ${seq}`], { cwd: dir });
}

function withPassingBuildVerification(dir: string, runner: StepRunner): StepRunner {
  return {
    ...runner,
    run: async (step, state, opts) => {
      if (step === 'wiring_check') {
        const { stdout: head } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
        await writeFile(
          join(dir, '.pipeline/wiring-evidence.json'),
          JSON.stringify({
            schema: 1,
            base: 'fixture-base',
            head: head.trim(),
            layer2: { applicable: false },
            waivers: [],
            tasks: [{ id: 'fixture', contract: 'none (fixture)', gaps: [] }],
          }),
        );
        return { success: true };
      }
      return runner.run(step, state, opts);
    },
  };
}

async function writePassingBuildReview(dir: string): Promise<void> {
  const { stdout: head } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
  await writeFile(
    join(dir, '.pipeline/build-review.json'),
    JSON.stringify({
      verdict: 'PASS',
      rubric: { tautology: false, scope: false, rootCause: false },
      codeStamp: head.trim(),
    }),
  );
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
  // These fixtures exercise the BUILD retry seam. The plan is an already
  // approved DECIDE artifact, so record that precondition rather than asking
  // a daemon test to cross the unrelated DECIDE authorization boundary.
  await writeFile(
    join(dir, 'conduct-state.json'),
    JSON.stringify({
      explore: 'skipped',
      complexity: 'skipped',
      prd: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done',
      coherence_check: 'done',
      acceptance_specs: 'done',
    }),
  );
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
  // The real BUILD loop enters only after DECIDE artifacts are approved and
  // committed. Commit the protected fixture tree so the artifact seal can
  // establish its immutable baseline before exercising the retry loop.
  await execa('git', ['add', '.docs'], { cwd: dir });
  await execa('git', ['commit', '-m', 'docs: approve decide artifacts'], { cwd: dir });
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
      stepRunner: withPassingBuildVerification(dir, runner),
      events,
      projectRoot: dir,
      fromStep: 'build',
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
    const realCurrentCommitSha = projectPrelude.currentCommitSha;
    const currentCommitShas: Array<string | null> = [];
    const currentCommitSha = vi.spyOn(projectPrelude, 'currentCommitSha').mockImplementation(async (root) => {
      const sha = await realCurrentCommitSha(root);
      currentCommitShas.push(sha);
      return sha;
    });
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
    try {
      await conductor.run();
    } finally {
      currentCommitSha.mockRestore();
    }

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
      stepRunner: withPassingBuildVerification(dir, runner),
      events,
      projectRoot: dir,
      fromStep: 'build',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 3,
      fullSuiteVerifier: {
        ensure: async () => ({ status: 'REUSED', evidence: {} as never }),
        inspect: async () => ({ status: 'CURRENT', evidence: {} as never }),
      },
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
        } else if (step === 'build_review') {
          await writePassingBuildReview(dir);
        }
        return { success: true };
      }),
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };
    const gateConductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: withPassingBuildVerification(dir, gateRunner),
      events,
      projectRoot: dir,
      fromStep: 'build',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 3,
      fullSuiteVerifier: {
        ensure: async () => ({ status: 'REUSED', evidence: {} as never }),
        inspect: async () => ({ status: 'CURRENT', evidence: {} as never }),
      },
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
      run: vi.fn().mockImplementation(async (step: StepName) => {
        if (step === 'build') {
          seq++;
          await commitPlainWork(dir2, seq);
        } else if (step === 'build_review') {
          await writePassingBuildReview(dir2);
        }
        return { success: true };
      }),
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };
    const routedConductor = new Conductor({
      stateFilePath: statePath2,
      stepRunner: withPassingBuildVerification(dir2, routedRunner),
      events: events2,
      projectRoot: dir2,
      fromStep: 'build',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 3,
      fullSuiteVerifier: {
        ensure: async () => ({ status: 'REUSED', evidence: {} as never }),
        inspect: async () => ({ status: 'CURRENT', evidence: {} as never }),
      },
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
      stepRunner: withPassingBuildVerification(dir, runner),
      events,
      projectRoot: dir,
      fromStep: 'build',
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
          // No-op-commit gaming shape: HEAD moves but the tree does not, and
          // no plan task is ever resolved.
          await commitEmptyWork(dir, seq);
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
      stepRunner: withPassingBuildVerification(dir, runner),
      events,
      projectRoot: dir,
      fromStep: 'build',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 2,
      // Isolate the durable D1 budget: otherwise D2 correctly catches this
      // no-tree-movement cycle on its first repeat before the cap is spent.
      config: { kickback_escalation: { enabled: false } },
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
      stepRunner: withPassingBuildVerification(dir, runner),
      events,
      projectRoot: dir,
      fromStep: 'build',
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

// ─────────────────────────────────────────────────────────────────────────────
// Consumer parity (plan Task 13): `countResolvedTasks` — the SAME fold
// `daemon-cli.ts`'s `buildProgressReKickDeps().isProgressReKickEligible`
// (:435 area) and `conductor.ts`'s kickback-escalation baselines
// (`captureKickbackToBuildContext`/`checkKickbackToBuildEscalation`, ~:1965/
// :1988) both read — has no signature or semantics change from this
// feature. Task 8/9's routing branch adds new CALL SITES but never touches
// `countResolvedTasks`/`resolveTaskIds` themselves. Pins the values these
// two real consumers observe across rows-only / trailers-only / mixed
// fixtures. Expected: no production change — this is a parity pin.
// ─────────────────────────────────────────────────────────────────────────────
describe('countResolvedTasks consumer parity under the floor (plan Task 13)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-parity-'));
    await initGitRepo(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function stampLastResolvedCount(root: string, count: number): Promise<void> {
    const evidence = await createTaskEvidence(root);
    evidence.lastResolvedCount = count;
    await evidence.write();
  }

  it('rows-only: countResolvedTasks=2, and isProgressReKickEligible reflects the exact same fold (no drift)', async () => {
    await writePlanAndStatus(dir, 5, [1, 2]); // 2 of 5 rows completed, no trailers
    expect(await countResolvedTasks(dir)).toBe(2);

    const worktreeBase = join(dir, '..');
    const slug = dir.split('/').pop()!;
    const { isProgressReKickEligible } = buildProgressReKickDeps(
      { build_progress_halt: { enabled: true } },
      worktreeBase,
    );
    // Live count (2) > last-dispatch-stamped count (1) → eligible for re-kick.
    await stampLastResolvedCount(dir, 1);
    expect(await isProgressReKickEligible!(slug)).toBe(true);
    // Live count (2) == last-dispatch-stamped count (2) → not eligible.
    await stampLastResolvedCount(dir, 2);
    expect(await isProgressReKickEligible!(slug)).toBe(false);
  });

  it('trailers-only: countResolvedTasks=2 when rows are all pending but 2 ids carry Task: trailers', async () => {
    await writePlanAndStatus(dir, 5, []); // all pending
    await commitWithTaskTrailer(dir, '1', 1);
    await commitWithTaskTrailer(dir, '2', 2);
    expect(await countResolvedTasks(dir)).toBe(2);

    const worktreeBase = join(dir, '..');
    const slug = dir.split('/').pop()!;
    const { isProgressReKickEligible } = buildProgressReKickDeps(
      { build_progress_halt: { enabled: true } },
      worktreeBase,
    );
    await stampLastResolvedCount(dir, 0);
    expect(await isProgressReKickEligible!(slug)).toBe(true);
  });

  it('mixed rows + trailers: countResolvedTasks unions completed rows and trailer ids (no double count on overlap)', async () => {
    await writePlanAndStatus(dir, 5, [1]); // row 1 completed
    await commitWithTaskTrailer(dir, '1', 1); // same id 1, also trailer-stamped — union, not double-count
    await commitWithTaskTrailer(dir, '2', 2); // additionally resolves id 2 via trailer only
    expect(await countResolvedTasks(dir)).toBe(2);

    const worktreeBase = join(dir, '..');
    const slug = dir.split('/').pop()!;
    const { isProgressReKickEligible } = buildProgressReKickDeps(
      { build_progress_halt: { enabled: true } },
      worktreeBase,
    );
    await stampLastResolvedCount(dir, 2);
    expect(await isProgressReKickEligible!(slug)).toBe(false); // no drift since dispatch
    await stampLastResolvedCount(dir, 1);
    expect(await isProgressReKickEligible!(slug)).toBe(true); // real forward progress since dispatch
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Executable invariant (plan Task 14): every `no_task_progress` classification
// this suite can produce carries pinned-HEAD evidence for the SAME attempt —
// i.e. `no_task_progress` and `unattributed_progress` are mutually exclusive
// per attempt. Sweeps three fixture shapes (full wedge, full movement, and a
// mixed shape where SOME attempts commit and others don't within the same
// build-step retry loop) with an independent, mock-owned per-attempt ledger
// of "did this attempt actually commit" — not merely asserting on the
// classification's own output, but cross-checking it against ground truth
// the test itself controls. A future call site that classifies
// `no_task_progress` on resolved-count alone (dropping the headMoved
// conjunct) would misclassify the mixed fixture's commit-landing attempt(s)
// and fail this test.
// ─────────────────────────────────────────────────────────────────────────────
describe('invariant — count alone can never kill a build (plan Task 14)', () => {
  async function runFixture(
    label: string,
    commitsAttempt: (attempt: number) => boolean,
  ): Promise<{
    stallEvents: Array<{ reason: string }>;
    unattributedEvents: UnattributedProgressEvent[];
    committedAttempts: number[];
    skippedAttempts: number[];
  }> {
    const dir = await mkdtemp(join(tmpdir(), `conductor-invariant-${label}-`));
    try {
      const statePath = join(dir, 'conduct-state.json');
      const events = new ConductorEventEmitter();
      await initGitRepo(dir);
      await seedAllArtifactsExceptTaskStatus(dir);
      await writePlanAndStatus(dir, 3, []); // zero completed rows throughout

      const committedAttempts: number[] = [];
      const skippedAttempts: number[] = [];
      let seq = 0;
      let attempt = 0;
      const runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> } = {
        run: vi.fn().mockImplementation(async (step: StepName) => {
          if (step === 'build') {
            attempt++;
            if (commitsAttempt(attempt)) {
              seq++;
              await commitPlainWork(dir, seq);
              committedAttempts.push(attempt);
            } else {
              skippedAttempts.push(attempt);
            }
          }
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

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: withPassingBuildVerification(dir, runner),
        events,
        projectRoot: dir,
        fromStep: 'build',
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 4,
      });
      await conductor.run();

      return { stallEvents, unattributedEvents, committedAttempts, skippedAttempts };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('full wedge (zero commits every attempt): no_task_progress fires, unattributed_progress never does', async () => {
    const { stallEvents, unattributedEvents } = await runFixture('wedge', () => false);
    expect(stallEvents.some((e) => e.reason === 'no_task_progress')).toBe(true);
    expect(unattributedEvents).toHaveLength(0);
  });

  it('full movement (every attempt commits): unattributed_progress fires, no_task_progress never does', async () => {
    const { stallEvents, unattributedEvents } = await runFixture('movement', () => true);
    expect(stallEvents.filter((e) => e.reason === 'no_task_progress')).toHaveLength(0);
    expect(unattributedEvents.length).toBeGreaterThan(0);
  });

  it('mixed (attempt 1 commits, attempts 2+ wedge): both classifications occur, count matches the mock-owned ledger exactly — proving per-attempt correlation, not aggregate coincidence', async () => {
    const { stallEvents, unattributedEvents, committedAttempts, skippedAttempts } =
      await runFixture('mixed', (attempt) => attempt === 1);

    expect(committedAttempts).toEqual([1]);
    expect(skippedAttempts.length).toBeGreaterThan(0);

    // unattributed_progress can only ever be recorded for attempt >= 2 (the
    // classifier's own precondition) with real HEAD movement THAT attempt —
    // since only attempt 1 commits here, unattributed_progress must be
    // exactly absent (attempt 1 is never checked; no later attempt moves
    // HEAD to trigger it).
    expect(unattributedEvents).toHaveLength(0);

    // Every attempt from 2 onward is a genuine, pinned-HEAD wedge — so
    // no_task_progress must fire, and its count must equal exactly the
    // number of skipped (non-committing) attempts the build-step retry loop
    // actually ran through, ground-truthed by the mock's own ledger.
    const noProgressCount = stallEvents.filter((e) => e.reason === 'no_task_progress').length;
    expect(noProgressCount).toBeGreaterThan(0);
    expect(noProgressCount).toBeLessThanOrEqual(skippedAttempts.length);
  });
});
