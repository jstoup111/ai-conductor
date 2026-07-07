// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "retro reconstructs friction from the audit trail
// alone" (Story 7,
// .docs/stories/audit-trail-write-completeness-for-retro-under-fre.md).
//
// `src/conductor/src/engine/audit-trail.ts` does not exist yet; every test
// dynamically imports it so a missing module RREDs only that test (§6).
//
// retro's "Data Collection" step (skills/retro/SKILL.md) is a skill-driven
// reading process, not a callable production function — plan Task 19 names
// the acceptable form for this class of story: "a reader (test helper
// mirroring retro's Data Collection)". `reconstructFriction` below is that
// mirror: it reads ONLY `.pipeline/audit-trail/events.jsonl` (never
// `.pipeline/gates/`, never git) and is the acceptance-level assertion that
// the audit trail alone carries enough signal for a fresh-session retro to
// see what a scripted run's own author already knows happened.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import type { StepName, ConductState } from '../../src/types/index.js';
import { writeState } from '../../src/engine/state.js';

async function loadWriter(): Promise<Record<string, any>> {
  return import('../../src/engine/audit-trail.js');
}

interface ReconstructedFriction {
  failures: Array<{ step: unknown; reason: unknown }>;
  retries: Array<{ step: unknown; attempt: unknown; reason: unknown }>;
  /** True when executed steps left no trace of friction at all — an absence
   *  that must be surfaced, never silently read as "nothing went wrong". */
  incomplete: boolean;
}

/** Mirrors retro's Data Collection: events.jsonl ONLY — no gates dir, no git. */
async function reconstructFriction(root: string): Promise<ReconstructedFriction> {
  let lines: string[] = [];
  try {
    const content = await readFile(join(root, '.pipeline/audit-trail/events.jsonl'), 'utf-8');
    lines = content.trim().split('\n').filter(Boolean);
  } catch {
    return { failures: [], retries: [], incomplete: true };
  }
  if (lines.length === 0) return { failures: [], retries: [], incomplete: true };

  const records = lines.map((l) => JSON.parse(l));
  return {
    failures: records.filter((r) => r.event === 'gate_fail').map((r) => ({ step: r.step, reason: r.reason })),
    retries: records
      .filter((r) => r.event === 'retry')
      .map((r) => ({ step: r.step, attempt: r.attempt, reason: r.reason })),
    incomplete: false,
  };
}

describe('Acceptance: retro reconstructs friction from the audit trail alone', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'audit-trail-retro-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('a scripted run with one induced gate failure then a successful retry is fully reconstructable from events.jsonl only', async () => {
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
          return { success: false, output: 'induced gate failure' };
        }
        return { success: true };
      },
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      maxRetries: 2,
    });

    await conductor.run();

    const reconstructed = await reconstructFriction(dir);
    expect(reconstructed.incomplete).toBe(false);
    expect(reconstructed.retries.some((r) => r.step === flakyStep)).toBe(true);
  });

  it('a step executed in strict isolation (fresh process, no prior conversation turns) is reconstructable from the audit trail alone', async () => {
    // Simulates a "fresh session": a brand-new writer instance and a
    // single-step run, nothing carried over from a prior in-memory run.
    // `plan: 'done'` satisfies build's prerequisite gate so the run actually
    // reaches the step runner instead of short-circuiting on gate_blocked.
    await writeState(statePath, { complexity_tier: 'S', plan: 'done' } as ConductState);

    const mod = await loadWriter();
    const AuditTrailWriter = mod.AuditTrailWriter as new (root: string) => {
      subscribe(emitter: ConductorEventEmitter): void;
    };
    const isolatedEmitter = new ConductorEventEmitter();
    const writer = new AuditTrailWriter(dir);
    writer.subscribe(isolatedEmitter);

    let flakyStep: StepName | undefined;
    let calls = 0;
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        calls++;
        if (calls === 1) {
          flakyStep = step;
          return { success: false, output: 'isolated induced failure' };
        }
        return { success: true };
      },
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events: isolatedEmitter,
      maxRetries: 2,
      fromStep: 'build',
    });

    await conductor.run();

    // A brand-new reader process (no shared JS state with the run above).
    const reconstructed = await reconstructFriction(dir);
    expect(reconstructed.incomplete).toBe(false);
    expect(reconstructed.retries.some((r) => r.step === flakyStep)).toBe(true);
  });

  it('missing events.jsonl despite executed steps is reported INCOMPLETE, not "nothing went wrong"', async () => {
    // No writer subscribed at all — steps execute, but the audit trail was
    // never populated (writer failure / not wired). Absence of positive
    // evidence must be surfaced.
    await writeState(statePath, { complexity_tier: 'S' } as ConductState);
    const runner: StepRunner = { run: async (): Promise<StepRunResult> => ({ success: true }) };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
    });

    await conductor.run();

    const reconstructed = await reconstructFriction(dir);
    expect(reconstructed.incomplete).toBe(true);
  });

  it('empty events.jsonl despite executed steps is reported INCOMPLETE', async () => {
    await mkdir(join(dir, '.pipeline/audit-trail'), { recursive: true });
    await (await import('node:fs/promises')).writeFile(join(dir, '.pipeline/audit-trail/events.jsonl'), '');

    const reconstructed = await reconstructFriction(dir);
    expect(reconstructed.incomplete).toBe(true);
  });

  it('skills/retro/SKILL.md names events.jsonl as the gate-history source and specifies INCOMPLETE behavior', async () => {
    const skillPath = fileURLToPath(
      new URL('../../../../skills/retro/SKILL.md', import.meta.url),
    );
    const skillSource = await readFile(skillPath, 'utf-8');
    expect(skillSource).toMatch(/\.pipeline\/audit-trail\/events\.jsonl/);
    expect(skillSource).toMatch(/INCOMPLETE/);
    // Additive, not a replacement: the raw events.jsonl remains the
    // retry-escalation source for retro Part C (conflict resolution 2026-07-07).
    expect(skillSource).toMatch(/\.pipeline\/events\.jsonl/);
  });
});
