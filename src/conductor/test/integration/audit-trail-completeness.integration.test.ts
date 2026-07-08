// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "Every executed step leaves positive evidence —
// including non-verdict steps" (Story 3,
// .docs/stories/audit-trail-write-completeness-for-retro-under-fre.md).
//
// `src/conductor/src/engine/audit-trail.ts` (`AuditTrailWriter`) does not exist
// yet — every test below dynamically imports it so a missing module RREDs only
// that test with "Cannot find module" (the correct pre-implementation RED; a
// top-level static import would instead fail the whole file at collection,
// which writing-system-tests §6 disallows as a RED substitute).
//
// These specs drive the REAL `Conductor` engine (`src/engine/conductor.ts`)
// through a full multi-step run — the "executed ⊆ recorded" invariant is a
// property of a whole run, not any single mapped-event unit test, so it
// belongs at this acceptance layer per §3a (2+ steps/operations in sequence).
// Per-event-type mapping content (gate_pass/gate_fail fields, kickback cause,
// retry attempt/reason) is unit-covered in the writer's own test suite
// (audit-trail.test.ts, plan tasks 1–12) and is NOT re-asserted here.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import type { StepName, ConductState, ConductorEvent } from '../../src/types/index.js';
import { writeState } from '../../src/engine/state.js';

/**
 * Compile-time drift guard (writing-system-tests §3 / plan Task 18(b)):
 * a `Record` keyed by every literal of `ConductorEvent['type']` — TypeScript
 * fails to compile this file if the union in `src/types/events.ts` grows a
 * new member without a classification being added here. Values must mirror
 * `SUBSCRIBED_EVENT_TYPES` in `src/engine/audit-trail.ts` (kept in sync by
 * code review, not import, because that array is intentionally unexported —
 * this test's whole job is to independently notice when it goes stale).
 *
 * 'friction-mapped'      — ADR 2026-07-07 lists this as a friction event the
 *                           writer allowlists; the fixture below MUST produce
 *                           a record.
 * 'not-audited-by-design' — UI-only, transport-only, or out-of-ADR-scope
 *                           (e.g. tier/config/mode/when skips deliberately
 *                           leave zero audit records per the "skipped ⇒
 *                           absent" invariant); the fixture below MUST NOT
 *                           produce a record.
 */
const EVENT_TYPE_CLASSIFICATION: Record<
  ConductorEvent['type'],
  'friction-mapped' | 'not-audited-by-design'
> = {
  step_started: 'not-audited-by-design',
  step_completed: 'friction-mapped', // positive evidence (gate_pass) when no verdict already recorded
  step_failed: 'not-audited-by-design', // superseded by step_retry / gate_verdict on the same step
  step_retry: 'friction-mapped',
  checkpoint_reached: 'not-audited-by-design',
  recovery_needed: 'not-audited-by-design',
  gate_blocked: 'not-audited-by-design',
  tier_skip: 'not-audited-by-design', // skipped steps must have zero records
  config_skip: 'not-audited-by-design', // skipped steps must have zero records
  navigation_back: 'not-audited-by-design',
  rate_limit: 'not-audited-by-design',
  session_reset: 'not-audited-by-design',
  credentials_park: 'not-audited-by-design',
  feature_complete: 'not-audited-by-design',
  dashboard_refresh: 'not-audited-by-design',
  auto_heal: 'not-audited-by-design',
  mode_skip: 'not-audited-by-design', // skipped steps must have zero records
  build_stall: 'not-audited-by-design',
  renderer_error: 'not-audited-by-design',
  when_skip: 'not-audited-by-design', // skipped steps must have zero records
  parallel_started: 'not-audited-by-design',
  parallel_completed: 'not-audited-by-design',
  parallel_failure: 'not-audited-by-design',
  gate_verdict: 'friction-mapped',
  kickback: 'friction-mapped',
  loop_halt: 'friction-mapped',
  loop_converged: 'not-audited-by-design',
  rebase_noop: 'not-audited-by-design',
  rebase_changed: 'not-audited-by-design',
  rebase_changelog_resolved: 'not-audited-by-design',
  rebase_conflict_halt: 'not-audited-by-design',
  rebase_resolution_attempt: 'not-audited-by-design',
  rebase_resolution_succeeded: 'not-audited-by-design',
  rebase_resolution_failed: 'not-audited-by-design',
  rebase_resolution_exhausted: 'not-audited-by-design',
  auto_park: 'not-audited-by-design',
  halt_cleared: 'friction-mapped',
};

/** One minimally-valid fixture per `ConductorEvent` member, keyed by type. */
const EVENT_FIXTURES: { [K in ConductorEvent['type']]: Extract<ConductorEvent, { type: K }> } = {
  step_started: { type: 'step_started', step: 'build', index: 0 },
  step_completed: { type: 'step_completed', step: 'build', status: 'done' },
  step_failed: { type: 'step_failed', step: 'build', error: 'boom', retryCount: 1 },
  step_retry: { type: 'step_retry', step: 'build', attempt: 2, maxAttempts: 3, reason: 'tests failed' },
  checkpoint_reached: { type: 'checkpoint_reached', step: 'build' },
  recovery_needed: { type: 'recovery_needed', step: 'build', options: ['retry'] },
  gate_blocked: { type: 'gate_blocked', step: 'build', reason: 'blocked' },
  tier_skip: { type: 'tier_skip', step: 'conflict_check', tier: 'S' },
  config_skip: { type: 'config_skip', step: 'conflict_check' },
  navigation_back: { type: 'navigation_back', from: 'build', to: 'plan' },
  rate_limit: { type: 'rate_limit', waitSeconds: 30 },
  session_reset: { type: 'session_reset', reason: 'restart' },
  credentials_park: { type: 'credentials_park', reason: 'no creds' },
  feature_complete: { type: 'feature_complete' },
  dashboard_refresh: { type: 'dashboard_refresh' },
  auto_heal: { type: 'auto_heal', step: 'build', healed: 1, skipped: 0 },
  mode_skip: { type: 'mode_skip', step: 'bootstrap', mode: 'fresh', reason: 'already bootstrapped' },
  build_stall: {
    type: 'build_stall',
    step: 'build',
    reason: 'no_task_progress',
    resolvedBefore: 0,
    resolvedAfter: 1,
  },
  renderer_error: { type: 'renderer_error', rendererName: 'console', error: 'oops' },
  when_skip: { type: 'when_skip', step: 'build', expression: '${foo}' },
  parallel_started: { type: 'parallel_started', step: 'build', branches: ['a', 'b'] },
  parallel_completed: { type: 'parallel_completed', step: 'build', branches: ['a', 'b'] },
  parallel_failure: { type: 'parallel_failure', step: 'build', branch: 'a', error: 'boom' },
  gate_verdict: { type: 'gate_verdict', step: 'build', satisfied: true },
  kickback: { type: 'kickback', from: 'conflict_check', to: 'architecture_review', evidence: 'missing seam', count: 1 },
  loop_halt: { type: 'loop_halt', reason: 'kickback cap exceeded' },
  loop_converged: { type: 'loop_converged' },
  rebase_noop: { type: 'rebase_noop' },
  rebase_changed: { type: 'rebase_changed', changedPaths: ['a.ts'] },
  rebase_changelog_resolved: { type: 'rebase_changelog_resolved' },
  rebase_conflict_halt: { type: 'rebase_conflict_halt', reason: 'conflict', conflicts: ['a.ts'] },
  rebase_resolution_attempt: { type: 'rebase_resolution_attempt', index: 1, cap: 3 },
  rebase_resolution_succeeded: { type: 'rebase_resolution_succeeded' },
  rebase_resolution_failed: { type: 'rebase_resolution_failed' },
  rebase_resolution_exhausted: { type: 'rebase_resolution_exhausted' },
  auto_park: { type: 'auto_park', slug: 'my-feature', reason: 'no evidence' },
  halt_cleared: { type: 'halt_cleared', step: 'build', cause: 'operator' },
};

async function loadWriter(): Promise<Record<string, any>> {
  return import('../../src/engine/audit-trail.js');
}

async function readRecords(root: string): Promise<Array<Record<string, unknown>>> {
  try {
    const content = await readFile(join(root, '.pipeline/audit-trail/events.jsonl'), 'utf-8');
    return content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

describe('Acceptance: audit-trail completeness — executed steps leave positive evidence', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'audit-trail-completeness-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('a full clean run (tier S) records every executed step and NO skipped step', async () => {
    // Tier S skips conflict_check and architecture_diagram (proven in
    // conductor.test.ts's own tier-S tests) — the invariant is executed ⊆
    // recorded, so those two must be provably absent, not merely unchecked.
    await writeState(statePath, { complexity_tier: 'S' } as ConductState);

    const mod = await loadWriter();
    const AuditTrailWriter = mod.AuditTrailWriter as new (root: string) => {
      subscribe(emitter: ConductorEventEmitter): void;
    };
    const writer = new AuditTrailWriter(dir);
    writer.subscribe(events);

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
    });

    await conductor.run();

    expect(stepsRun).not.toContain('conflict_check');
    expect(stepsRun).not.toContain('architecture_diagram');

    const records = await readRecords(dir);
    const recordedSteps = new Set(records.map((r) => r.step));

    // executed ⊆ recorded
    const uniqueExecuted = new Set(stepsRun);
    for (const step of uniqueExecuted) {
      expect(recordedSteps.has(step), `expected a record for executed step "${step}"`).toBe(true);
    }

    // skipped steps must not fabricate evidence
    expect(recordedSteps.has('conflict_check')).toBe(false);
    expect(recordedSteps.has('architecture_diagram')).toBe(false);
  });

  it('a step that fails then succeeds on retry still ends up with positive evidence, not just the retry record', async () => {
    await writeState(statePath, { complexity_tier: 'S' } as ConductState);

    const mod = await loadWriter();
    const AuditTrailWriter = mod.AuditTrailWriter as new (root: string) => {
      subscribe(emitter: ConductorEventEmitter): void;
    };
    const writer = new AuditTrailWriter(dir);
    writer.subscribe(events);

    let calls = 0;
    let flakyStep: StepName | undefined;
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        calls++;
        if (calls === 1) {
          flakyStep = step;
          return { success: false, output: 'transient error' };
        }
        return { success: true };
      },
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      maxRetries: 3,
    });

    await conductor.run();

    const records = await readRecords(dir);
    expect(records.some((r) => r.step === flakyStep && r.event === 'retry')).toBe(true);
    expect(
      records.some((r) => r.step === flakyStep && r.event === 'gate_pass'),
      'the eventually-successful step must leave positive evidence, not only its retry record',
    ).toBe(true);
  });

  it('drift guard: every ConductorEvent type is classified, and the writer honors that classification', async () => {
    // Enumeration-driven (writing-system-tests §3): EVENT_TYPE_CLASSIFICATION
    // above is a `Record` keyed by the full `ConductorEvent['type']` union —
    // TypeScript itself refuses to compile this file if a new event type is
    // added without a classification, which is the actual drift guard (a
    // hand-written fixture list can silently go stale; a missing `Record`
    // key cannot). This test then checks the writer's runtime behavior
    // agrees with each classification, one event type at a time, so a
    // failure names the exact offending type instead of an aggregate count.
    const mod = await loadWriter();
    const AuditTrailWriter = mod.AuditTrailWriter as new (root: string) => {
      subscribe(emitter: ConductorEventEmitter): void;
    };
    const writer = new AuditTrailWriter(dir);
    writer.subscribe(events);

    for (const [type, classification] of Object.entries(EVENT_TYPE_CLASSIFICATION) as Array<
      [ConductorEvent['type'], 'friction-mapped' | 'not-audited-by-design']
    >) {
      const before = (await readRecords(dir)).length;
      await events.emit(EVENT_FIXTURES[type]);
      const after = (await readRecords(dir)).length;

      if (classification === 'friction-mapped') {
        expect(
          after,
          `expected event type "${type}" (classified friction-mapped) to append a record — the writer's allowlist no longer matches this test's classification`,
        ).toBeGreaterThan(before);
      } else {
        expect(
          after,
          `expected event type "${type}" (classified not-audited-by-design) to append NO record, but one was written — either update the writer's allowlist or this classification`,
        ).toBe(before);
      }
    }
  });

  it('a UI-only event with no writer mapping produces no record and no error (allowlist, not a catch-all)', async () => {
    const mod = await loadWriter();
    const AuditTrailWriter = mod.AuditTrailWriter as new (root: string) => {
      subscribe(emitter: ConductorEventEmitter): void;
    };
    const writer = new AuditTrailWriter(dir);
    writer.subscribe(events);

    await events.emit({ type: 'step_started', step: 'build', index: 0 });
    await events.emit({ type: 'dashboard_refresh' });

    const records = await readRecords(dir);
    expect(records).toHaveLength(0);
  });
});
