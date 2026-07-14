/**
 * Acceptance specs for the rerun-vs-route retry classifier (#646).
 *
 * Story source: .docs/stories/retry-classify-rerun-vs-route.md
 * Plan: .docs/plans/retry-classify-rerun-vs-route.md (Task 4 RED tests)
 *
 * These drive a real `Conductor.run()` through the SHIP-tail verdict steps
 * (`architecture_review_as_built`, `build_review`, `prd_audit`) with a fake
 * `StepRunner`, asserting on the `retry_decision`/`step_retry`/`kickback`/
 * `loop_halt` events and the HALT marker — the loop-level behavior the
 * classifier is meant to change. Pure classifyRetryDecision truth-table
 * coverage and routeClass-facet coverage belong to the TDD phase's unit
 * tests (artifacts.test.ts), not here.
 *
 * ASSUMPTION (surfaced, ~75% confidence, inferred from the plan's Task 2
 * rule text): signal (b) "identical-repeat" is not gated on routeClass —
 * it fires whenever `attempt >= 2 && priorReason === completion.reason &&
 * inputsUnchanged`, regardless of whether the facet was 'named-route' or
 * 'absent'. Story 3/4 in the source story frame this via a "build_review
 * FAIL...does not set 'named-route'" scenario, but the real build_review
 * predicate (artifacts.ts:1236) only ever sets 'named-route' on a fresh,
 * *valid, parsed* FAIL — never leaves it unset for a FAIL. The only real
 * production path that reaches attempt-1-reruns-without-named-route for
 * build_review is a persistently MISSING/malformed verdict (routeClass
 * 'absent'). These specs use that fixture (Stories 3/4/6 below) as the
 * closest reachable analog. If Task 2 scopes signal (b) to only apply
 * atop a 'named-route' facet, these three specs need their fixture
 * swapped for one with a real parsed (but non-deterministic-looking)
 * FAIL — confirm during Task 2/4 implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import type { StepName } from '../../src/types/index.js';

// ── shared fixtures ───────────────────────────────────────────────────────

const AUDIT_HEADER = '| FR | Verdict | Gap-class | Evidence | Accepted? |\n|--|--|--|--|--|\n';

/** All steps before `target` marked 'done'; tail starts exactly at `target`. */
async function seedTailAt(
  statePath: string,
  target: StepName,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const { ALL_STEPS } = await import('../../src/engine/steps.js');
  const state: Record<string, unknown> = {
    complexity_tier: 'M',
    feature_desc: 'feat',
  };
  for (const s of ALL_STEPS) {
    if (s.name === target) break;
    state[s.name] = 'done';
  }
  await writeState(statePath, { ...state, ...extra } as unknown as ConductState);
  await mkdir(join(statePath, '..', '.pipeline'), { recursive: true });
  await writeFile(
    join(statePath, '..', '.pipeline/task-status.json'),
    JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
  );
}

/** A remediate runner that writes a routable (non-halt) plan targeting `build`. */
function withRemediation(
  dir: string,
  handlers: Record<string, (opts?: { retryReason?: string }) => Promise<void>>,
): StepRunner {
  const calls: StepName[] = [];
  const runner: StepRunner = {
    run: async (step, _state, opts) => {
      calls.push(step);
      if (step === 'remediate') {
        await mkdir(join(dir, '.pipeline'), { recursive: true });
        await writeFile(
          join(dir, '.pipeline/remediation.json'),
          JSON.stringify({
            dispositions: [
              {
                id: 'gap-1',
                disposition: 'build',
                category: null,
                rationale: 'fix the flagged drift',
                tasks: [],
              },
            ],
          }),
        );
        return { success: true };
      }
      const h = handlers[step];
      if (h) await h(opts);
      return { success: true };
    },
  };
  (runner as unknown as { __calls: StepName[] }).__calls = calls;
  return runner;
}

describe('integration/retry-classify (#646)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'retry-classify-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await mkdir(join(dir, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function collect() {
    const retryDecisions: Array<Record<string, unknown>> = [];
    const stepRetries: Array<{ step: string; attempt: number }> = [];
    const kickbacks: Array<{ from: string; to: string }> = [];
    let halted = false;
    events.on('retry_decision' as never, ((e: Record<string, unknown>) => {
      retryDecisions.push(e);
    }) as never);
    events.on('step_retry', (e) => {
      if (e.type === 'step_retry') stepRetries.push({ step: e.step, attempt: e.attempt });
    });
    events.on('kickback', (e) => {
      if (e.type === 'kickback') kickbacks.push({ from: e.from, to: e.to });
    });
    events.on('loop_halt', () => {
      halted = true;
    });
    return { retryDecisions, stepRetries, kickbacks, halted: () => halted };
  }

  // ── Story 1: as-built BLOCKED routes on try 1 ───────────────────────────

  it('Story 1: fresh as-built BLOCKED verdict routes on try 1, no second attempt', async () => {
    await seedTailAt(statePath, 'architecture_review_as_built');
    const runner = withRemediation(dir, {
      architecture_review_as_built: async () => {
        await mkdir(join(dir, '.pipeline'), { recursive: true });
        await writeFile(
          join(dir, '.pipeline/architecture-review-as-built.md'),
          '# As-Built Review\n\nVerdict: BLOCKED\n',
        );
      },
      build: async () => {},
    });
    const { retryDecisions, stepRetries, kickbacks } = collect();

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 3,
      fromStep: 'architecture_review_as_built',
    });
    await conductor.run();

    const calls = (runner as unknown as { __calls: StepName[] }).__calls;
    // Only one as-built dispatch — no second same-step attempt burned.
    expect(calls.filter((s) => s === 'architecture_review_as_built')).toHaveLength(1);
    expect(stepRetries.filter((r) => r.step === 'architecture_review_as_built')).toHaveLength(0);

    // Control drops into the existing as-built planRemediation routing.
    expect(kickbacks).toContainEqual({ from: 'architecture_review_as_built', to: 'build' });

    expect(retryDecisions).toContainEqual(
      expect.objectContaining({ decision: 'route', signal: 'named-route', attempt: 1 }),
    );
  });

  // ── Story 2: absent verdict still reruns ────────────────────────────────

  it('Story 2: absent as-built verdict reruns (no route on nothing)', async () => {
    await seedTailAt(statePath, 'architecture_review_as_built');
    let attempts = 0;
    const runner = withRemediation(dir, {
      architecture_review_as_built: async () => {
        attempts++;
        if (attempts >= 2) {
          await mkdir(join(dir, '.pipeline'), { recursive: true });
          await writeFile(
            join(dir, '.pipeline/architecture-review-as-built.md'),
            '# As-Built Review\n\nVerdict: APPROVED\n',
          );
        }
        // attempt 1: writes nothing — artifact absent.
      },
    });
    const { retryDecisions, stepRetries } = collect();

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 3,
      fromStep: 'architecture_review_as_built',
    });
    await conductor.run();

    expect(stepRetries.filter((r) => r.step === 'architecture_review_as_built').length).toBeGreaterThanOrEqual(1);
    expect(retryDecisions).toContainEqual(
      expect.objectContaining({ decision: 'rerun' }),
    );
    expect(
      retryDecisions.find((d) => d.decision === 'rerun'),
    ).not.toHaveProperty('signal', 'named-route');
  });

  // ── Story 3: identical repeat on unchanged inputs routes on try 2 ───────

  it('Story 3: build_review byte-identical failure on unchanged inputs routes on try 2', async () => {
    await seedTailAt(statePath, 'build_review');
    // Broken grader: never writes .pipeline/build-review.json. Completion
    // reason is a static string, so it is byte-identical every attempt, and
    // the artifact never exists (mtime "unchanged" — both absent).
    const runner = withRemediation(dir, {
      build_review: async () => {},
    });
    const { retryDecisions, stepRetries } = collect();

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 5,
      fromStep: 'build_review',
    });
    await conductor.run();

    const calls = (runner as unknown as { __calls: StepName[] }).__calls;
    // Attempt 1 reruns, attempt 2 routes — never burns through to attempt 3.
    expect(calls.filter((s) => s === 'build_review')).toHaveLength(2);
    expect(stepRetries.filter((r) => r.step === 'build_review')).toHaveLength(1);
    expect(retryDecisions).toContainEqual(
      expect.objectContaining({ decision: 'route', signal: 'identical-repeat', attempt: 2 }),
    );
  });

  // ── Story 4: input changed between attempts still reruns ───────────────

  it('Story 4: same reason but advancing artifact mtime keeps rerunning', async () => {
    await seedTailAt(statePath, 'build_review');
    // The grader rewrites an invalid (malformed) verdict every attempt — the
    // completion reason text is identical each time, but the file's mtime
    // advances on every rewrite, so inputs are NOT proven unchanged.
    const runner = withRemediation(dir, {
      build_review: async () => {
        await mkdir(join(dir, '.pipeline'), { recursive: true });
        await writeFile(join(dir, '.pipeline/build-review.json'), 'not json');
      },
    });
    const { retryDecisions, stepRetries } = collect();

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 3,
      fromStep: 'build_review',
    });
    await conductor.run();

    const calls = (runner as unknown as { __calls: StepName[] }).__calls;
    // Never routes — burns every attempt.
    expect(calls.filter((s) => s === 'build_review').length).toBeGreaterThanOrEqual(3);
    expect(stepRetries.filter((r) => r.step === 'build_review').length).toBeGreaterThanOrEqual(2);
    for (const d of retryDecisions) {
      expect(d.decision).not.toBe('route');
    }
  });

  // ── Story 5: kill-switch off is an exact revert ─────────────────────────

  it('Story 5: retry_routing.enabled=false burns retries then routes at step_failed, no retry_decision', async () => {
    await seedTailAt(statePath, 'architecture_review_as_built');
    const runner = withRemediation(dir, {
      architecture_review_as_built: async () => {
        await mkdir(join(dir, '.pipeline'), { recursive: true });
        await writeFile(
          join(dir, '.pipeline/architecture-review-as-built.md'),
          '# As-Built Review\n\nVerdict: BLOCKED\n',
        );
      },
      build: async () => {},
    });
    const { retryDecisions, stepRetries, kickbacks } = collect();

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 2,
      fromStep: 'architecture_review_as_built',
      config: { retry_routing: { enabled: false } } as never,
    });
    await conductor.run();

    // Old behaviour: burns the full retry budget on the same fresh verdict.
    expect(stepRetries.filter((r) => r.step === 'architecture_review_as_built').length).toBeGreaterThanOrEqual(1);
    // Still eventually routes via the pre-existing planRemediation call at
    // step_failed — exact revert, not a behavioural regression.
    expect(kickbacks).toContainEqual({ from: 'architecture_review_as_built', to: 'build' });
    // No retry_decision telemetry when the classifier is bypassed.
    expect(retryDecisions).toHaveLength(0);
  });

  it('Story 5: an absent/malformed retry_routing block still resolves to enabled:true', async () => {
    await seedTailAt(statePath, 'architecture_review_as_built');
    const runner = withRemediation(dir, {
      architecture_review_as_built: async () => {
        await mkdir(join(dir, '.pipeline'), { recursive: true });
        await writeFile(
          join(dir, '.pipeline/architecture-review-as-built.md'),
          '# As-Built Review\n\nVerdict: BLOCKED\n',
        );
      },
      build: async () => {},
    });
    const { retryDecisions, stepRetries } = collect();

    // No retry_routing key at all — default must be enabled:true (routes on
    // try 1, same as Story 1) rather than silently disabling the classifier.
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 3,
      fromStep: 'architecture_review_as_built',
    });
    await conductor.run();

    expect(stepRetries.filter((r) => r.step === 'architecture_review_as_built')).toHaveLength(0);
    expect(retryDecisions).toContainEqual(
      expect.objectContaining({ decision: 'route', signal: 'named-route' }),
    );
  });

  it('Story 5 (config validation): retry_routing becomes a known top-level key', async () => {
    const { validateConfig } = await import('../../src/engine/config.js');
    // A well-formed block must not be rejected as an unknown top-level key
    // (this is the real RED signal — today ANY retry_routing key is
    // rejected before its contents are even inspected).
    const clean = validateConfig({ retry_routing: { enabled: true } });
    expect(clean.ok).toBe(true);
  });

  it('Story 5 (config validation): an unknown key inside retry_routing is rejected by its OWN nested check', async () => {
    const { validateConfig } = await import('../../src/engine/config.js');
    const result = validateConfig({ retry_routing: { enabled: true, bogus: 1 } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Must name the nested key specifically ("retry_routing.bogus" /
      // "Unknown key in retry_routing"), not the generic top-level-key
      // rejection message that fires today for any unrecognized block.
      expect(result.error.message).toMatch(/retry_routing/);
      expect(result.error.message).not.toMatch(/^Unknown top-level key/);
    }
  });

  // ── Story 6: routed HALT names the unchanged input ──────────────────────

  it('Story 6: an identical-repeat routed HALT names the unchanged input, not "retries exhausted"', async () => {
    await seedTailAt(statePath, 'build_review');
    // Same broken-grader fixture as Story 3: routes via identical-repeat on
    // attempt 2. build_review's own kickback path requires a parsed FAIL
    // verdict (never produced here), so the routed break falls straight
    // into the generic auto-mode HALT — the exact seam this story targets.
    const runner = withRemediation(dir, {
      build_review: async () => {},
    });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 5,
      fromStep: 'build_review',
    });
    await conductor.run();

    const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
    expect(halt).not.toMatch(/retries exhausted/);
    expect(halt).toMatch(/unchanged/i);
    expect(halt).toMatch(/build-review\.json/);
  });

  // ── Story 7: prd_audit behaviour is preserved, not duplicated ───────────

  it('Story 7: a fresh blocking prd_audit still routes on try 1 (single evaluation)', async () => {
    await seedTailAt(statePath, 'prd_audit', { build_review: 'skipped' });
    const runner = withRemediation(dir, {
      prd_audit: async () => {
        await mkdir(join(dir, '.pipeline'), { recursive: true });
        await writeFile(
          join(dir, '.pipeline/prd-audit.md'),
          '# PRD Audit\n\n' + AUDIT_HEADER + '| FR-3 | DIVERGED | intended-drift | baz.ts:88 | no |\n',
        );
      },
    });
    const { stepRetries } = collect();

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 3,
      fromStep: 'prd_audit',
    });
    await conductor.run();

    const calls = (runner as unknown as { __calls: StepName[] }).__calls;
    // No wasted retry on prd_audit itself — the classifier defers to the
    // existing classifyPrdAuditGaps short-circuit, not a duplicated one.
    expect(calls.filter((s) => s === 'prd_audit')).toHaveLength(1);
    expect(stepRetries.filter((r) => r.step === 'prd_audit')).toHaveLength(0);

    const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8').catch(() => null);
    // intended-drift is a DECIDE-target gap — no autonomous fix disposition
    // in this fixture, so the run halts rather than kicking back to build;
    // the point under test is that prd_audit itself never retried.
    expect(halt).not.toBeNull();
  });
});
