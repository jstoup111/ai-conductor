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
