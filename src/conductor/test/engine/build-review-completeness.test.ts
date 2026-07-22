// Regression tests: build_review's existing fail-closed predicate (checkGateCompletion
// -> checkStepCompletion's build_review branch in src/engine/artifacts.ts) correctly
// covers the completeness rubric dimension added alongside tautology/scope/rootCause.
// No new production behavior is expected here — this locks in that the pre-existing
// missing/stale/malformed/FAIL handling also applies when completeness is the sole
// FAIL-triggering rubric item.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { checkGateCompletion } from '../../src/engine/gate-verdicts.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState, StepName } from '../../src/types/index.js';

describe('engine/artifacts — build_review predicate (completeness-driven, fail-closed)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-review-completeness-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function verdict(obj: unknown) {
    const full = join(dir, '.pipeline/build-review.json');
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, JSON.stringify(obj));
    return full;
  }

  it('fails when no verdict artifact is present at all', async () => {
    const r = await checkGateCompletion(dir, 'build_review');
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/no build-review verdict/i);
    expect(r.routeClass).toBe('absent');
  });

  it('fails when the verdict artifact predates the current session (stale)', async () => {
    const full = await verdict({
      verdict: 'PASS',
      rubric: { tautology: false, scope: false, rootCause: false, completeness: false },
    });
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await utimes(full, old, old);
    const sessionStartedAt = Date.now();
    const r = await checkGateCompletion(dir, 'build_review', { sessionStartedAt });
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/no fresh verdict/i);
    expect(r.routeClass).toBe('absent');
  });

  it('fails on malformed JSON without crashing', async () => {
    const full = join(dir, '.pipeline/build-review.json');
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, '{ not valid json');
    const sessionStartedAt = Date.now() - 1000;
    await expect(checkGateCompletion(dir, 'build_review', { sessionStartedAt })).resolves.toMatchObject({
      done: false,
      routeClass: 'absent',
    });
  });

  it('fails validateBuildReviewVerdict (e.g. missing rubric) without crashing', async () => {
    await verdict({ verdict: 'PASS' });
    const sessionStartedAt = Date.now() - 1000;
    const r = await checkGateCompletion(dir, 'build_review', { sessionStartedAt });
    expect(r.done).toBe(false);
    expect(r.routeClass).toBe('absent');
  });

  it('fails and arms kickback when only rubric.completeness is FAIL (all other rubric items PASS)', async () => {
    await verdict({
      verdict: 'FAIL',
      reasons: ['implementation addresses only part of the declared scope — missing negative-path handling'],
      rubric: { tautology: false, scope: false, rootCause: false, completeness: true },
    });
    const sessionStartedAt = Date.now() - 1000;
    const r = await checkGateCompletion(dir, 'build_review', { sessionStartedAt });
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/implementation addresses only part of the declared scope/);
    expect(r.routeClass).toBe('named-route');
  });

  it('passes on a fresh valid PASS verdict that includes completeness: false', async () => {
    await verdict({
      verdict: 'PASS',
      rubric: { tautology: false, scope: false, rootCause: false, completeness: false },
    });
    const sessionStartedAt = Date.now() - 1000;
    const r = await checkGateCompletion(dir, 'build_review', { sessionStartedAt });
    expect(r.done).toBe(true);
    expect(r.routeClass).toBeUndefined();
  });
});

// Task 8 (#773): fail-closed on LLM/grader unavailability. build_review's
// grader is dispatched through the SAME StepRunner infrastructure as every
// other judgement gate — there is no build_review-specific dispatch path.
// These are regression locks proving that when the dispatch itself never
// produces a fresh verdict (retry-ladder exhaustion) or errors out mid-flight
// (rate-limit/session/auth), no PASS artifact appears, checkGateCompletion
// keeps the step not-done, and the generic HALT/park machinery — not a
// build_review-specific one — is what fires.
describe('engine/conductor — build_review fails closed when the grader dispatch is unavailable (#773 Task 8)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-review-dispatch-unavailable-'));
    statePath = join(dir, '.pipeline', 'state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seedToBuildReview(): Promise<void> {
    const seed = (await readState(statePath)).ok
      ? (await readState(statePath)).value
      : ({} as ConductState);
    (seed as Record<string, unknown>).complexity_tier = 'M';
    for (const s of ALL_STEPS) {
      if (s.name === 'build_review') break;
      (seed as Record<string, unknown>)[s.name] = 'done';
    }
    await writeState(statePath, seed as ConductState);
  }

  it('retry-ladder exhaustion on build_review: no PASS artifact, step stays not-done, generic HALT fires (not a silent pass)', async () => {
    await seedToBuildReview();

    // The grader dispatch simply never succeeds and never writes a verdict —
    // exactly what a full ladder-exhaustion (all providers/retries burned)
    // looks like from the conductor's point of view.
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName): Promise<StepRunResult> => {
        if (step === 'build_review') {
          return { success: false, output: 'grader dispatch failed: retry ladder exhausted' };
        }
        return { success: true };
      }),
    };

    let halted = false;
    events.on('loop_halt', () => {
      halted = true;
    });

    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'build_review',
      verifyArtifacts: true,
      mode: 'auto',
      maxRetries: 1,
    });

    await conductor.run();

    // No verdict artifact was ever written by the failed dispatch.
    await expect(readFile(join(dir, '.pipeline/build-review.json'), 'utf-8')).rejects.toThrow();

    // The predicate agrees: not done.
    const r = await checkGateCompletion(dir, 'build_review');
    expect(r.done).toBe(false);

    // And the generic dispatch-failure handling — the same HALT path every
    // other step's ladder exhaustion routes through — fired.
    expect(halted).toBe(true);
    const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
    expect(halt).toMatch(/build_review/);

    // The step was never marked done in state.
    const finalState = (await readState(statePath)).ok
      ? (await readState(statePath)).value
      : ({} as ConductState);
    expect((finalState as Record<string, unknown>).build_review).not.toBe('done');
  });

  it('rate-limit/session/auth error mid-dispatch on build_review: no PASS artifact written, generic RateLimitEpisode handling engages (not a build_review-specific path)', async () => {
    await seedToBuildReview();

    let attempt = 0;
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName): Promise<StepRunResult> => {
        if (step === 'build_review') {
          attempt++;
          if (attempt === 1) {
            // Mid-dispatch rate-limit/session/auth signal — the grader
            // process never got far enough to produce a verdict.
            return { success: false, rateLimited: true, waitSeconds: 5 };
          }
          return { success: true };
        }
        return { success: true };
      }),
    };

    const rateLimitEvents: Array<{ waitSeconds: number }> = [];
    events.on('rate_limit', (e) => {
      if (e.type === 'rate_limit') rateLimitEvents.push({ waitSeconds: e.waitSeconds });
    });

    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'build_review',
      verifyArtifacts: true,
      maxRetries: 2,
      sleepFn,
      onRecovery: vi.fn().mockResolvedValue('quit' as const),
    });

    await conductor.run();

    // The generic rate-limit machinery (shared with every other gate) fired
    // for build_review — no build_review-specific dispatch-failure path.
    expect(rateLimitEvents).toHaveLength(1);
    expect(rateLimitEvents[0].waitSeconds).toBe(5);

    // The first (failed) dispatch never produced a PASS artifact. Since the
    // second attempt returns bare success (no verdict write either), the
    // predicate still fails closed — proving the rate-limited attempt never
    // slipped a PASS through.
    const r = await checkGateCompletion(dir, 'build_review');
    expect(r.done).toBe(false);

    const finalState = (await readState(statePath)).ok
      ? (await readState(statePath)).value
      : ({} as ConductState);
    expect((finalState as Record<string, unknown>).build_review).not.toBe('done');
  });
});
