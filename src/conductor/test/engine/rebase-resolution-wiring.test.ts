/**
 * Wiring tests for the gated rebase-conflict resolution sub-loop in the
 * conductor's engine-native `rebase` step (Tasks 3, 10–13 of the
 * rebase-resolution-skill plan).
 *
 * These tests exercise the full Conductor path with:
 *   - daemon: true  (only daemon branches invoke the real git rebase)
 *   - an ISOLATED throwaway git repo  (NEVER the live checkout)
 *   - a fake StepRunner that provides resolveRebaseConflict
 *
 * NO vi.mock('execa') — real git is intentional here. The conductor's git
 * calls in runRebaseStep route through makeGitRunner(projectRoot); all other
 * steps use the fake runner.run() and never touch git.
 *
 * Loop contract exercised:
 *   1. daemon conflict → resolver resolves it  → no HALT, succeeded event
 *   2. cap=0           → resolver never called → HALT written (FR-7)
 *   3. resolver throws → degrades to HALT
 *   4. rebase_resolution_attempt event carries {index, cap}
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState } from '../../src/types/index.js';
import type { ResolutionContext, ResolutionAttempt } from '../../src/engine/rebase.js';

const execFile = promisify(execFileCb);

// ── Fixture helpers ───────────────────────────────────────────────────────────

/**
 * Seed state with every step BEFORE 'rebase' marked done/skipped so the
 * conductor can start at `fromStep: 'rebase'` without failing gate checks.
 * `retro` is skipped because the daemon always skips it.
 */
async function seedPreRebaseState(statePath: string): Promise<void> {
  const state: ConductState = {};
  for (const s of ALL_STEPS) {
    if (s.name === 'rebase') break;
    (state as Record<string, unknown>)[s.name] = s.name === 'retro' ? 'skipped' : 'done';
  }
  await writeState(statePath, state);
}

/**
 * Build a throwaway repo where `feat` branch and `main` conflict on `a.ts`.
 * After setup HEAD is on `feat` — the conductor will rebase it onto `main`.
 */
async function buildConflictRepo(): Promise<{
  repo: string;
  g: (args: string[]) => ReturnType<typeof execFile>;
  gc: (args: string[]) => ReturnType<typeof execFile>;
}> {
  const repo = await mkdtemp(join(tmpdir(), 'rebase-wiring-'));
  const g = (args: string[]) => execFile('git', args, { cwd: repo });
  const gc = (args: string[]) =>
    execFile('git', ['-c', 'core.editor=true', ...args], { cwd: repo });

  await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  await g(['config', 'user.email', 't@t.com']);
  await g(['config', 'user.name', 'T']);
  await writeFile(join(repo, 'a.ts'), 'base\n');
  await g(['add', '.']);
  await g(['commit', '-q', '-m', 'init']);

  await g(['checkout', '-q', '-b', 'feat']);
  await writeFile(join(repo, 'a.ts'), 'feature\n');
  await g(['commit', '-q', '-am', 'feat: change a']);

  await g(['checkout', '-q', 'main']);
  await writeFile(join(repo, 'a.ts'), 'mainchange\n');
  await g(['commit', '-q', '-am', 'main: change a']);

  // HEAD on feat — conflict guaranteed when conductor rebases onto main
  await g(['checkout', '-q', 'feat']);

  return { repo, g, gc };
}

// ── Wiring tests ──────────────────────────────────────────────────────────────

describe('runRebaseStep wiring — gated resolution sub-loop (daemon:true, real git)', () => {
  let repo: string;
  let g: (args: string[]) => ReturnType<typeof execFile>;
  let gc: (args: string[]) => ReturnType<typeof execFile>;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    ({ repo, g, gc } = await buildConflictRepo());
    statePath = join(repo, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await seedPreRebaseState(statePath);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  // ── Test 1 ───────────────────────────────────────────────────────────────

  it('resolver resolves conflict → no HALT written, resolver was called, succeeded event emitted', async () => {
    let resolverCalled = false;
    let succeededEmitted = false;

    events.on('rebase_resolution_succeeded', (e) => {
      if (e.type === 'rebase_resolution_succeeded') succeededEmitted = true;
    });

    const runner: StepRunner = {
      run: vi.fn().mockResolvedValue({ success: true } satisfies StepRunResult),
      resolveRebaseConflict: async (ctx: ResolutionContext): Promise<ResolutionAttempt> => {
        resolverCalled = true;
        // Resolve the conflict: write merged content, stage, and continue
        await writeFile(join(ctx.projectRoot, 'a.ts'), 'merged\n');
        await g(['add', 'a.ts']);
        await gc(['rebase', '--continue']);
        return { resolved: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: repo,
      daemon: true,
      mode: 'auto',
      fromStep: 'rebase',
    });

    await conductor.run();

    // Resolver was called exactly once
    expect(resolverCalled).toBe(true);

    // HALT file NOT written (conflict was resolved)
    const haltExists = await access(join(repo, '.pipeline/HALT')).then(() => true, () => false);
    expect(haltExists).toBe(false);

    // rebase_resolution_succeeded event was emitted
    expect(succeededEmitted).toBe(true);
  });

  // ── Test 2 ───────────────────────────────────────────────────────────────

  it('cap=0 → resolveRebaseConflict never called, HALT written (FR-7: unchanged behavior)', async () => {
    let resolverCalled = false;

    const runner: StepRunner = {
      run: vi.fn().mockResolvedValue({ success: true } satisfies StepRunResult),
      resolveRebaseConflict: async (): Promise<ResolutionAttempt> => {
        resolverCalled = true;
        return { resolved: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: repo,
      daemon: true,
      mode: 'auto',
      fromStep: 'rebase',
      config: { rebase_resolution_attempts: 0 },
    });

    await conductor.run();

    // Resolver NEVER called — cap of 0 disables auto-resolution
    expect(resolverCalled).toBe(false);

    // HALT file written (same as pre-resolution behavior)
    const haltExists = await access(join(repo, '.pipeline/HALT')).then(() => true, () => false);
    expect(haltExists).toBe(true);
  });

  // ── Test 3 ───────────────────────────────────────────────────────────────

  it('resolver throws → degrades gracefully to HALT (not a crash)', async () => {
    const runner: StepRunner = {
      run: vi.fn().mockResolvedValue({ success: true } satisfies StepRunResult),
      resolveRebaseConflict: async (): Promise<ResolutionAttempt> => {
        throw new Error('Claude session expired during conflict resolution');
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: repo,
      daemon: true,
      mode: 'auto',
      fromStep: 'rebase',
    });

    // conductor.run() must NOT throw — exceptions in resolveRebaseConflict are
    // caught and converted to resolved:false, which causes a HALT (not a crash).
    await expect(conductor.run()).resolves.not.toThrow();

    // HALT file written
    const haltExists = await access(join(repo, '.pipeline/HALT')).then(() => true, () => false);
    expect(haltExists).toBe(true);
  });

  // ── Test 4 ───────────────────────────────────────────────────────────────

  it('rebase_resolution_attempt event emitted with correct {index, cap} on at least one attempt', async () => {
    const attemptEvents: Array<{ index: number; cap: number }> = [];

    events.on('rebase_resolution_attempt', (e) => {
      if (e.type === 'rebase_resolution_attempt') {
        attemptEvents.push({ index: e.index, cap: e.cap });
      }
    });

    const runner: StepRunner = {
      run: vi.fn().mockResolvedValue({ success: true } satisfies StepRunResult),
      resolveRebaseConflict: async (ctx: ResolutionContext): Promise<ResolutionAttempt> => {
        // Resolve the conflict cleanly so the rebase finishes
        await writeFile(join(ctx.projectRoot, 'a.ts'), 'merged\n');
        await g(['add', 'a.ts']);
        await gc(['rebase', '--continue']);
        return { resolved: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: repo,
      daemon: true,
      mode: 'auto',
      fromStep: 'rebase',
      // Default cap is 3 (DEFAULT_REBASE_RESOLUTION_ATTEMPTS)
    });

    await conductor.run();

    // At least one attempt event was emitted
    expect(attemptEvents.length).toBeGreaterThanOrEqual(1);

    // First attempt: index=1, cap=3 (default)
    expect(attemptEvents[0]).toEqual({ index: 1, cap: 3 });
  });
});
