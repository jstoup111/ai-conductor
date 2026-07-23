/**
 * Acceptance specs for .docs/stories/per-feature-token-accounting.md Story 2
 * (#537), governed by .docs/plans/per-feature-token-accounting.md Tasks 3-4.
 *
 * WHY ACCEPTANCE-LEVEL (not unit): the `step_completed` event type
 * (src/types/events.ts:26) ALREADY declares an optional `tokenUsage` field,
 * and `EventPersister` (event-persister.ts) already persists every
 * `step_completed` event generically to `.pipeline/events.jsonl` — so a unit
 * test on either of those in isolation would stay green. The actual bug is at
 * the wiring seam in between: the real emit call site
 * (`conductor.ts:5127` — `await emitTracked({ type: 'step_completed', step:
 * step.name, status: 'done', tail })`) never reads `result.tokenUsage` (or a
 * resolved `model`) at all, so the field is silently dropped before it ever
 * reaches the emitter or the ledger — the "new field on the type, orphaned at
 * the one call site that populates it" failure class writing-system-tests
 * §3b exists to catch. This file drives the real `Conductor.run()` entry
 * point (same convention as
 * build-auth-token-check-and-classify.acceptance.test.ts) with a fake
 * `StepRunner`, and reads the real `.pipeline/events.jsonl` written by a real
 * `EventPersister` attached to the real event emitter — proving the full
 * chain: step result -> emitted event -> persisted ledger line.
 *
 * PRE-FIX RED: as of this file's authoring, `StepRunResult` has no
 * `tokenUsage`/`model` fields (plan Task 3 adds them) and the emit call site
 * ignores them regardless (plan Task 4). Every scenario below fails today —
 * the emitted/persisted `step_completed` event for the target step carries
 * neither `tokenUsage` nor `model`, and the unmetered negative has no
 * `unmetered` marker at all.
 *
 * ASSUMPTION FLAGGED (per verify-claims / writing-system-tests correctness
 * gate): the story pins the event's presence of `tokenUsage` + `model` (happy)
 * and an explicit "unmetered" marker (negative) but not the exact property
 * name/shape for that marker beyond "explicit unmetered marker". This file
 * asserts an `unmetered: true` boolean field, mirroring the `authFailure`/
 * `rateLimited` boolean-flag convention already used on sibling event/result
 * types in this codebase (events.ts, conductor.ts StepRunResult). Confidence
 * ~80% (inferred from repo convention, not directly pinned by story text) —
 * flagged for operator confirmation rather than silently assumed elsewhere.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('execa', () => ({ execa: vi.fn() }));

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import type { StepName, ConductState } from '../../src/types/index.js';
import type { ConductorEvent } from '../../src/types/index.js';

describe('acceptance: tokenUsage + model reach step_completed and the events.jsonl ledger (Story 2, #537)', () => {
  let dir: string;
  let statePath: string;
  let eventsLogPath: string;
  let events: ConductorEventEmitter;
  let persister: EventPersister;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'token-ledger-'));
    statePath = join(dir, 'conduct-state.json');
    eventsLogPath = join(dir, '.pipeline', 'events.jsonl');
    events = new ConductorEventEmitter();
    persister = new EventPersister(eventsLogPath, events);
    persister.start();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** Records every emitted step_completed event, keyed by step name. */
  function trackStepCompletions(): Map<string, ConductorEvent> {
    const seen = new Map<string, ConductorEvent>();
    events.on('step_completed', (e) => {
      const evt = e as unknown as { step: string };
      seen.set(evt.step, e as ConductorEvent);
    });
    return seen;
  }

  async function ledgerLinesFor(step: string): Promise<Record<string, unknown>[]> {
    const raw = await readFile(eventsLogPath, 'utf-8').catch(() => '');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((e) => e.type === 'step_completed' && e.step === step);
  }

  /**
   * Runner: TARGET_STEP returns the given result; every other step succeeds
   * plainly (undocumented usage), except HALT_STEP which fails forever with
   * NO special flag, so the retry ladder exhausts and the run halts right
   * after TARGET_STEP's own step_completed has already been emitted/persisted
   * — bounding the run to exactly the observation we need (same "run past the
   * target then halt" convention as retry-as-escalation.acceptance.test.ts).
   */
  function makeRunner(targetStep: StepName, targetResult: StepRunResult, haltStep: StepName): StepRunner {
    return {
      run: vi.fn(async (step: StepName): Promise<StepRunResult> => {
        if (step === targetStep) return targetResult;
        if (step === haltStep) return { success: false, output: 'permanent failure' };
        return { success: true };
      }),
    };
  }

  it('happy: a metered step_completed event carries tokenUsage + model, and the same fields land in .pipeline/events.jsonl', async () => {
    const seen = trackStepCompletions();
    const targetResult = {
      success: true,
      tokenUsage: { input: 1200, output: 340, cacheRead: 500, cacheCreation: 0 },
      model: 'claude-sonnet-5',
    } as unknown as StepRunResult;

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeRunner('plan', targetResult, 'acceptance_specs'),
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      maxRetries: 1,
    });

    await conductor.run();

    const emitted = seen.get('plan') as unknown as {
      tokenUsage?: { input: number; output: number };
      model?: string;
    };
    expect(emitted).toBeDefined();
    expect(emitted.tokenUsage).toEqual({ input: 1200, output: 340, cacheRead: 500, cacheCreation: 0 });
    expect(emitted.model).toBe('claude-sonnet-5');

    const lines = await ledgerLinesFor('plan');
    expect(lines).toHaveLength(1);
    expect(lines[0].tokenUsage).toEqual({ input: 1200, output: 340, cacheRead: 500, cacheCreation: 0 });
    expect(lines[0].model).toBe('claude-sonnet-5');
  });

  it('negative: an unmetered step still emits + persists step_completed, with an explicit unmetered marker — never silently omitted', async () => {
    const seen = trackStepCompletions();
    // No tokenUsage at all — the Story 1 "unparseable result" / interactive-step case.
    const targetResult = { success: true } as StepRunResult;

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeRunner('plan', targetResult, 'acceptance_specs'),
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      maxRetries: 1,
    });

    await conductor.run();

    const emitted = seen.get('plan') as unknown as { tokenUsage?: unknown; unmetered?: boolean } | undefined;
    // The event for this step must exist at all — never dropped from the ledger.
    expect(emitted).toBeDefined();
    expect(emitted!.tokenUsage).toBeUndefined();
    expect(emitted!.unmetered).toBe(true);

    const lines = await ledgerLinesFor('plan');
    expect(lines).toHaveLength(1);
    expect(lines[0].unmetered).toBe(true);
  });
});
