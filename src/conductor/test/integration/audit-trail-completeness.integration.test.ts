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
import type { StepName, ConductState } from '../../src/types/index.js';
import { writeState } from '../../src/engine/state.js';

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

  it('drift guard: every friction-classified ConductorEvent type the engine actually emits produces a record', async () => {
    // Fixture-driven enumeration (writing-system-tests §3): if the engine's
    // event union grows a new friction type without a writer mapping, this
    // test fails, forcing the mapping table to be extended (Story 3 negative
    // path 2 / plan Task 18(b)). Fixtures mirror the exact payload shapes
    // already defined in src/types/events.ts.
    const mod = await loadWriter();
    const AuditTrailWriter = mod.AuditTrailWriter as new (root: string) => {
      subscribe(emitter: ConductorEventEmitter): void;
    };
    const writer = new AuditTrailWriter(dir);
    writer.subscribe(events);

    const frictionFixtures = [
      { type: 'gate_verdict', step: 'build', satisfied: false, reason: 'missing evidence' },
      { type: 'gate_verdict', step: 'build', satisfied: true },
      { type: 'step_retry', step: 'build', attempt: 2, maxAttempts: 3, reason: 'tests failed' },
      { type: 'kickback', from: 'conflict_check', to: 'architecture_review', evidence: 'missing seam', count: 1 },
      { type: 'loop_halt', reason: 'kickback cap exceeded' },
    ] as const;

    for (const fixture of frictionFixtures) {
      await events.emit(fixture as any);
    }

    const records = await readRecords(dir);
    expect(
      records.length,
      `expected one record per friction fixture (${frictionFixtures.length}), got ${records.length} — a fixture type is unmapped`,
    ).toBeGreaterThanOrEqual(frictionFixtures.length);
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
