import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execa } from 'execa';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepName } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for #859 "Trailer-union build completion"
// (.docs/stories/trailer-union-build-completion.md, S2/S4;
//  plan: .docs/plans/trailer-union-build-completion.md, T4-T9;
//  ADR: adr-2026-07-23-trailer-union-build-step-routing).
//
// Technical track, no PRD — no FR-coverage table (§3e out of scope).
//
// These drive the REAL production entry point — `Conductor.run()`'s build-step
// retry loop (conductor.ts ~3576-3767), the same loop
// `test/engine/conductor.test.ts`'s `describe('build-step stall circuit
// breaker', ...)` block exercises — rather than calling
// `checkStepCompletion('build', ctx)` directly. The #859 regression is a
// LOOP-LEVEL misread (an all-evidenced build stalls instead of advancing to
// `build_review`), so a unit test of the predicate alone can pass while the
// real loop still stalls; only driving the loop end-to-end proves the fix
// reaches the call site that actually stalled in production.
//
// Currently (pre-Task-4) `artifacts.ts`'s `build:` predicate computes
// `unresolved` from task-status.json ROWS ONLY (artifacts.ts:1304), so a
// build whose evidence lives entirely in `Task:` commit trailers with zero
// `completed` rows reads as not-done and the loop below stalls/halts instead
// of advancing — this is the RED failure these specs pin.
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

// Fast-forwards every pre-build step's completion check by seeding the
// artifacts each already requires — ported verbatim from
// test/engine/conductor.test.ts's stall-breaker fixture (`
// seedAllArtifactsExceptTaskStatus`), which is file-private there.
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
// `completedIds` become `completed` rows; every other id is `pending`. Per
// artifacts.ts's Task 10 (#773) comment, a `completed` row is never demoted
// for lacking an evidence-sidecar stamp, so no `task-evidence.json` sidecar
// is required to model "row-resolved" progress.
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

describe('#859 trailer-union build completion (real Conductor.run() loop)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;
  let stepOrder: StepName[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-trailer-union-'));
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

  function makeConductor(maxRetries = 1): {
    conductor: Conductor;
    runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> };
    stallEvents: Array<{ reason: string }>;
  } {
    const runner: StepRunner & {
      runInteractive: ReturnType<typeof vi.fn>;
      run: ReturnType<typeof vi.fn>;
    } = {
      run: vi.fn().mockResolvedValue({ success: true }),
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };
    const stallEvents: Array<{ reason: string }> = [];
    events.on('build_stall', (e) => {
      if (e.type === 'build_stall') stallEvents.push({ reason: e.reason });
    });
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
    return { conductor, runner, stallEvents };
  }

  it('all tasks trailer-resolved, ZERO completed rows (the exact #859/flow-examples-#786 shape) → build exits to build_review, never stalls', async () => {
    await writePlanAndStatus(dir, 5, []); // zero completed rows
    for (let i = 1; i <= 5; i++) {
      await commitWithTaskTrailer(dir, String(i), i);
    }

    const { conductor, stallEvents } = makeConductor(1);
    await conductor.run();

    expect(stallEvents).toHaveLength(0);
    expect(stepOrder).toContain('build');
    expect(stepOrder).toContain('build_review');
    // build_review must come strictly after build — proves the build step
    // itself resolved 'done' in a single attempt rather than being kicked
    // into the stall/halt path.
    expect(stepOrder.indexOf('build_review')).toBeGreaterThan(stepOrder.indexOf('build'));
  });

  it('mixed evidence — some rows completed, rest trailer-only — build exits to build_review', async () => {
    await writePlanAndStatus(dir, 5, [1, 2]); // rows 1-2 completed
    for (let i = 3; i <= 5; i++) {
      await commitWithTaskTrailer(dir, String(i), i); // 3-5 trailer-only
    }

    const { conductor, stallEvents } = makeConductor(1);
    await conductor.run();

    expect(stallEvents).toHaveLength(0);
    expect(stepOrder.indexOf('build_review')).toBeGreaterThan(stepOrder.indexOf('build'));
  });

  it('halt marker present alongside full trailer evidence → build does NOT exit; marker precedence is unchanged', async () => {
    await writePlanAndStatus(dir, 5, []); // zero completed rows
    for (let i = 1; i <= 5; i++) {
      await commitWithTaskTrailer(dir, String(i), i); // full trailer evidence
    }
    await writeFile(join(dir, '.pipeline/halt-user-input-required'), 'scope mismatch');

    const { conductor, runner, stallEvents } = makeConductor(3);
    await conductor.run();

    // The halt marker must win even though every task is trailer-resolved —
    // an explicit halt is never overridden by evidence.
    expect(stallEvents.some((e) => e.reason === 'halt_marker')).toBe(true);
    expect(stepOrder).not.toContain('build_review');
    expect(runner.runInteractive).toHaveBeenCalledWith('build');
  });

  it('genuine stall (no trailers, no completed rows, count pinned across attempts) still halts no_task_progress; build_review is never reached', async () => {
    await writePlanAndStatus(dir, 5, []); // zero completed rows, no trailer commits at all

    const { conductor, stallEvents } = makeConductor(3);
    await conductor.run();

    expect(stallEvents).toHaveLength(1);
    expect(stallEvents[0].reason).toBe('no_task_progress');
    expect(stepOrder).not.toContain('build_review');
  });
});
