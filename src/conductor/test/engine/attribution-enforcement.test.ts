import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isEnforcementConfigured,
  markerPath,
  writeBuildStepMarker,
  removeBuildStepMarker,
  detectZeroWorkProduct,
  resolveAttributionAuditSamplePct,
  readDispatchAttribution,
  detectUnattributedDispatch,
} from '../../src/engine/attribution-enforcement.js';
import type { HarnessConfig } from '../../src/types/config.js';
import { validateConfig } from '../../src/engine/config.js';

// execa is consumed transitively (WorktreeManager); never fork real git.
vi.mock('execa', () => ({ execa: vi.fn() }));

import { ConductorEventEmitter } from '../../src/ui/events.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import type { StepName } from '../../src/types/index.js';
import { ALL_STEPS } from '../../src/engine/steps.js';

// #505 TS-2: enforcement predicate + marker file helpers. The marker file is
// the session-hook-visible signal that inline build work is in flight so
// commits made during that window can be attributed correctly.

describe('isEnforcementConfigured', () => {
  it('returns false when attribution_enforcement_cutover is absent', () => {
    const config = {} as HarnessConfig;
    expect(isEnforcementConfigured(config, new Date('2026-07-10T00:00:00Z'))).toBe(false);
  });

  it('returns true when cutover is in the past', () => {
    const config = { attribution_enforcement_cutover: '2026-01-01T00:00:00Z' } as HarnessConfig;
    expect(isEnforcementConfigured(config, new Date('2026-07-10T00:00:00Z'))).toBe(true);
  });

  it('returns false when cutover is in the future', () => {
    const config = { attribution_enforcement_cutover: '2027-01-01T00:00:00Z' } as HarnessConfig;
    expect(isEnforcementConfigured(config, new Date('2026-07-10T00:00:00Z'))).toBe(false);
  });

  it('returns true when cutover is exactly now (boundary, on/after)', () => {
    const now = new Date('2026-07-10T00:00:00Z');
    const config = { attribution_enforcement_cutover: now.toISOString() } as HarnessConfig;
    expect(isEnforcementConfigured(config, now)).toBe(true);
  });
});

describe('markerPath', () => {
  it('returns .pipeline/build-step-active relative to root', () => {
    expect(markerPath('/some/root')).toBe(join('/some/root', '.pipeline', 'build-step-active'));
  });

  it('throws on empty root', () => {
    expect(() => markerPath('')).toThrow();
  });
});

describe('writeBuildStepMarker / removeBuildStepMarker', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'attribution-enforcement-test-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes an ISO-8601 timestamp to the marker file', () => {
    const now = new Date('2026-07-10T12:34:56.000Z');
    writeBuildStepMarker(root, now);
    const path = markerPath(root);
    expect(existsSync(path)).toBe(true);
    const contents = readFileSync(path, 'utf8').trim();
    expect(contents).toBe(now.toISOString());
  });

  it('creates the .pipeline directory if absent', () => {
    writeBuildStepMarker(root, new Date());
    expect(existsSync(join(root, '.pipeline'))).toBe(true);
  });

  it('removes the marker file', () => {
    writeBuildStepMarker(root, new Date());
    const path = markerPath(root);
    expect(existsSync(path)).toBe(true);
    removeBuildStepMarker(root);
    expect(existsSync(path)).toBe(false);
  });

  it('remove is idempotent — no error if marker absent', () => {
    expect(existsSync(markerPath(root))).toBe(false);
    expect(() => removeBuildStepMarker(root)).not.toThrow();
    expect(() => removeBuildStepMarker(root)).not.toThrow();
  });
});

// #505 TS-3: marker lifecycle wired into the conductor's build-step
// dispatch. The marker must exist only for the duration of a build-step
// session and only when enforcement is configured — cleanup is guaranteed by
// a `finally`, on both the success and error paths.
describe('conductor build-step marker lifecycle', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;
  const PAST_CUTOVER = { attribution_enforcement_cutover: '2026-01-01T00:00:00Z' } as HarnessConfig;
  const FUTURE_CUTOVER = { attribution_enforcement_cutover: '2027-01-01T00:00:00Z' } as HarnessConfig;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-marker-attr-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('marker exists during the build-step session when the cutover has passed', async () => {
    let sawMarkerDuringBuild = false;
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        if (step === 'build') {
          sawMarkerDuringBuild = existsSync(markerPath(dir));
        }
        return { success: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      config: PAST_CUTOVER,
    });

    await conductor.run();

    expect(sawMarkerDuringBuild).toBe(true);
  });

  it('marker is absent after normal session end (finally cleanup)', async () => {
    const runner: StepRunner = {
      run: async (): Promise<StepRunResult> => ({ success: true }),
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      config: PAST_CUTOVER,
    });

    await conductor.run();

    expect(existsSync(markerPath(dir))).toBe(false);
  });

  it('marker is absent after a build session that throws', async () => {
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        if (step === 'build') throw new Error('boom in build');
        return { success: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      config: PAST_CUTOVER,
    });

    // The loop converts the throw into a recoverable HALT; run() must not
    // reject, and the marker must still be cleaned up.
    await expect(conductor.run()).resolves.toBeUndefined();

    expect(existsSync(markerPath(dir))).toBe(false);
  });

  it('marker is never written when enforcement is not configured (cutover absent)', async () => {
    let sawMarkerDuringBuild = false;
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        if (step === 'build') {
          sawMarkerDuringBuild = existsSync(markerPath(dir));
        }
        return { success: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      // no config passed — cutover absent
    });

    await conductor.run();

    expect(sawMarkerDuringBuild).toBe(false);
    expect(existsSync(markerPath(dir))).toBe(false);
  });

  it('marker is never written when the cutover is in the future', async () => {
    let sawMarkerDuringBuild = false;
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        if (step === 'build') {
          sawMarkerDuringBuild = existsSync(markerPath(dir));
        }
        return { success: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      config: FUTURE_CUTOVER,
    });

    await conductor.run();

    expect(sawMarkerDuringBuild).toBe(false);
    expect(existsSync(markerPath(dir))).toBe(false);
  });
});

// #505 TS-15: zero-work-product detection. A build step that dispatched
// nothing (or dispatched work that produced no new commits) is a kickback
// candidate — distinct from a halted session (remediation owns that) and
// from a fully-complete plan (never zero-work, regardless of HEAD movement).
describe('detectZeroWorkProduct', () => {
  let root: string;
  const PAST_CUTOVER = { attribution_enforcement_cutover: '2026-01-01T00:00:00Z' } as HarnessConfig;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'zero-work-detect-test-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeIncompleteTaskStatus(): void {
    mkdirSync(join(root, '.pipeline'), { recursive: true });
    writeFileSync(
      join(root, '.pipeline', 'task-status.json'),
      JSON.stringify({ tasks: [{ id: '1', status: 'pending' }] }),
      'utf8',
    );
  }

  function writeCompleteTaskStatus(): void {
    mkdirSync(join(root, '.pipeline'), { recursive: true });
    writeFileSync(
      join(root, '.pipeline', 'task-status.json'),
      JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }),
      'utf8',
    );
  }

  function writeDispatchCount(lines: number): void {
    mkdirSync(join(root, '.pipeline'), { recursive: true });
    writeFileSync(join(root, '.pipeline', 'dispatch-count'), 'x\n'.repeat(lines), 'utf8');
  }

  function writeHaltMarker(): void {
    mkdirSync(join(root, '.pipeline'), { recursive: true });
    writeFileSync(join(root, '.pipeline', 'halt-user-input-required'), 'stalled\n', 'utf8');
  }

  it('detects zero dispatches + unchanged HEAD + incomplete tasks + no halt marker + enforcement active', async () => {
    writeIncompleteTaskStatus();
    const detected = await detectZeroWorkProduct({
      projectRoot: root,
      config: PAST_CUTOVER,
      headBefore: 'sha-a',
      headAfter: 'sha-a',
    });
    expect(detected).toBe(true);
  });

  it('does NOT detect when the halt marker is present', async () => {
    writeIncompleteTaskStatus();
    writeHaltMarker();
    const detected = await detectZeroWorkProduct({
      projectRoot: root,
      config: PAST_CUTOVER,
      headBefore: 'sha-a',
      headAfter: 'sha-a',
    });
    expect(detected).toBe(false);
  });

  it('detects when dispatches happened but zero commits (HEAD unchanged)', async () => {
    writeIncompleteTaskStatus();
    writeDispatchCount(3);
    const detected = await detectZeroWorkProduct({
      projectRoot: root,
      config: PAST_CUTOVER,
      headBefore: 'sha-a',
      headAfter: 'sha-a',
    });
    expect(detected).toBe(true);
  });

  it('does NOT detect when dispatches happened and HEAD moved (real work)', async () => {
    writeIncompleteTaskStatus();
    writeDispatchCount(3);
    const detected = await detectZeroWorkProduct({
      projectRoot: root,
      config: PAST_CUTOVER,
      headBefore: 'sha-a',
      headAfter: 'sha-b',
    });
    expect(detected).toBe(false);
  });

  it('does NOT detect when all tasks are already complete', async () => {
    writeCompleteTaskStatus();
    const detected = await detectZeroWorkProduct({
      projectRoot: root,
      config: PAST_CUTOVER,
      headBefore: 'sha-a',
      headAfter: 'sha-a',
    });
    expect(detected).toBe(false);
  });

  it('does NOT detect when enforcement is not active (cutover absent)', async () => {
    writeIncompleteTaskStatus();
    const detected = await detectZeroWorkProduct({
      projectRoot: root,
      config: {} as HarnessConfig,
      headBefore: 'sha-a',
      headAfter: 'sha-a',
    });
    expect(detected).toBe(false);
  });
});

describe('readDispatchAttribution', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dispatch-attribution-test-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeDispatchCountRaw(content: string): void {
    mkdirSync(join(root, '.pipeline'), { recursive: true });
    writeFileSync(join(root, '.pipeline', 'dispatch-count'), content, 'utf8');
  }

  it('returns zeros when dispatch-count file is absent', async () => {
    const result = await readDispatchAttribution(root);
    expect(result).toEqual({ attributed: 0, unattributed: 0, taskIds: [] });
  });

  it('returns zeros when dispatch-count file is empty', async () => {
    writeDispatchCountRaw('');
    const result = await readDispatchAttribution(root);
    expect(result).toEqual({ attributed: 0, unattributed: 0, taskIds: [] });
  });

  it('counts an all-"Task: none" file as fully unattributed', async () => {
    writeDispatchCountRaw('Task: none\nTask: none\nTask: none\n');
    const result = await readDispatchAttribution(root);
    expect(result.unattributed).toBe(3);
    expect(result.attributed).toBe(0);
    expect(result.taskIds).toEqual([]);
  });

  it('splits a mixed file into attributed and unattributed counts with ordered task ids', async () => {
    writeDispatchCountRaw('Task: 5\nTask: none\nTask: 7\nTask: none\nTask: 12\n');
    const result = await readDispatchAttribution(root);
    expect(result.attributed).toBe(3);
    expect(result.unattributed).toBe(2);
    expect(result.taskIds).toEqual(['5', '7', '12']);
  });

  it('ignores malformed lines without throwing and without counting them in either bucket', async () => {
    writeDispatchCountRaw(
      'Task: 5\ngarbage line\nTask: none\nnot a task line at all\nTask: 9\n',
    );
    const result = await readDispatchAttribution(root);
    expect(result.attributed).toBe(2);
    expect(result.unattributed).toBe(1);
    expect(result.taskIds).toEqual(['5', '9']);
  });
});

// Task 3 (#671): unattributed-dispatch detection. A build dispatch cycle
// whose dispatch-count lines are all (or mostly) "Task: none" must surface
// its own distinct loud signal — separate from and earlier than
// detectZeroWorkProduct/the evidence gate — naming the unattributed streak.
// Mixed cycles that stay below the threshold remain quiet.
describe('detectUnattributedDispatch', () => {
  it('triggers when every dispatch in the cycle is unattributed ("Task: none")', () => {
    const result = detectUnattributedDispatch({ attributed: 0, unattributed: 3, taskIds: [] });
    expect(result).toEqual({
      triggered: true,
      reason: 'unattributed_dispatch',
      unattributedCount: 3,
    });
  });

  it('stays quiet for a mixed cycle below the threshold', () => {
    const result = detectUnattributedDispatch({ attributed: 5, unattributed: 1, taskIds: ['1', '2', '3', '4', '5'] });
    expect(result).toBeNull();
  });

  it('triggers for a mixed cycle whose unattributed count meets the threshold', () => {
    const result = detectUnattributedDispatch(
      { attributed: 2, unattributed: 3, taskIds: ['1', '2'] },
      3,
    );
    expect(result).toEqual({
      triggered: true,
      reason: 'unattributed_dispatch',
      unattributedCount: 3,
    });
  });

  it('stays quiet when there is no dispatch activity at all', () => {
    const result = detectUnattributedDispatch({ attributed: 0, unattributed: 0, taskIds: [] });
    expect(result).toBeNull();
  });

  it('triggers on default threshold for a mixed cycle that is NOT fully unattributed — rules out an all-unattributed-ratio interpretation', () => {
    // attributed:1, unattributed:3 meets the same default threshold as the
    // all-none (0/3) case above but is not a 100%-unattributed cycle. A
    // ratio-based ("ALL dispatches unattributed") implementation would stay
    // quiet here; the correct count-based implementation must still trigger.
    const result = detectUnattributedDispatch({ attributed: 1, unattributed: 3, taskIds: ['1'] });
    expect(result).toEqual({
      triggered: true,
      reason: 'unattributed_dispatch',
      unattributedCount: 3,
    });
  });

  it('threshold=0 triggers on any nonzero unattributed count', () => {
    const result = detectUnattributedDispatch({ attributed: 4, unattributed: 1, taskIds: ['1', '2', '3', '4'] }, 0);
    expect(result).toEqual({
      triggered: true,
      reason: 'unattributed_dispatch',
      unattributedCount: 1,
    });
  });

  it('threshold=0 with zero unattributed dispatches stays quiet (no dispatch activity is never "unattributed")', () => {
    const result = detectUnattributedDispatch({ attributed: 0, unattributed: 0, taskIds: [] }, 0);
    expect(result).toBeNull();
  });
});

// Task 11: Config keys with clamped parsing — attribution_judge_cutover +
// attribution_audit_sample_pct. Parsing validates the cutover as ISO-8601,
// clamps pct to [0, 100] with startup warning on out-of-range, and defaults
// pct to 10 when absent. Both absent → inert (byte-identical to today).
describe('attribution judge cutover + audit sample pct config parsing (Task 11)', () => {
  it('parses attribution_judge_cutover from config as ISO-8601', () => {
    const config = validateConfig({
      attribution_judge_cutover: '2026-07-15T12:00:00Z',
    });
    expect(config.ok).toBe(true);
    if (config.ok) {
      expect(config.config.attribution_judge_cutover).toBe('2026-07-15T12:00:00Z');
    }
  });

  it('rejects attribution_judge_cutover with non-string value', () => {
    const config = validateConfig({
      attribution_judge_cutover: 123,
    });
    expect(config.ok).toBe(false);
    if (!config.ok) {
      expect(config.error.message).toMatch(/attribution_judge_cutover.*ISO-8601/i);
    }
  });

  it('rejects attribution_judge_cutover with unparseable date', () => {
    const config = validateConfig({
      attribution_judge_cutover: 'not-a-date',
    });
    expect(config.ok).toBe(false);
    if (!config.ok) {
      expect(config.error.message).toMatch(/attribution_judge_cutover.*parseable date/i);
    }
  });

  it('parses attribution_audit_sample_pct from config as integer', () => {
    const config = validateConfig({
      attribution_audit_sample_pct: 50,
    });
    expect(config.ok).toBe(true);
    if (config.ok) {
      expect(config.config.attribution_audit_sample_pct).toBe(50);
    }
  });

  it('clamps attribution_audit_sample_pct to [0, 100]', () => {
    const configHigh = validateConfig({
      attribution_audit_sample_pct: 150,
    });
    expect(configHigh.ok).toBe(true);
    if (configHigh.ok) {
      expect(configHigh.config.attribution_audit_sample_pct).toBe(100);
      expect(configHigh.warnings.length).toBeGreaterThan(0);
      expect(configHigh.warnings[0]).toMatch(/attribution_audit_sample_pct.*clamped.*100/i);
    }

    const configLow = validateConfig({
      attribution_audit_sample_pct: -5,
    });
    expect(configLow.ok).toBe(true);
    if (configLow.ok) {
      expect(configLow.config.attribution_audit_sample_pct).toBe(0);
      expect(configLow.warnings.length).toBeGreaterThan(0);
      expect(configLow.warnings[0]).toMatch(/attribution_audit_sample_pct.*clamped.*0/i);
    }
  });

  it('rejects attribution_audit_sample_pct with non-number value', () => {
    const config = validateConfig({
      attribution_audit_sample_pct: 'not-a-number',
    });
    expect(config.ok).toBe(false);
    if (!config.ok) {
      expect(config.error.message).toMatch(/attribution_audit_sample_pct.*number/i);
    }
  });

  it('defaults attribution_audit_sample_pct to 10 when absent', () => {
    const config = validateConfig({});
    expect(config.ok).toBe(true);
    if (config.ok) {
      expect(config.config.attribution_audit_sample_pct).toBe(10);
    }
  });

  it('allows both keys to be absent (inert defaults)', () => {
    const config = validateConfig({});
    expect(config.ok).toBe(true);
    if (config.ok) {
      expect(config.config.attribution_judge_cutover).toBeUndefined();
      expect(config.config.attribution_audit_sample_pct).toBe(10);
    }
  });

  it('resolveAttributionAuditSamplePct returns config value when set', () => {
    const pct = resolveAttributionAuditSamplePct({ attribution_audit_sample_pct: 75 } as HarnessConfig);
    expect(pct).toBe(75);
  });

  it('resolveAttributionAuditSamplePct returns 10 when absent', () => {
    const pct = resolveAttributionAuditSamplePct({} as HarnessConfig);
    expect(pct).toBe(10);
  });
});

// #505 TS-16: zero-work kickback. Task 15 detects and emits the
// `zero_work_product` event; this responds to it — durable ledger reason,
// corrective retry preamble on the NEXT dispatch, and no interference with
// the existing auto-park threshold or Task 12's durable no-evidence counter.
describe('zero-work kickback (#505 TS-16)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;
  const PAST_CUTOVER = { attribution_enforcement_cutover: '2026-01-01T00:00:00Z' } as HarnessConfig;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zero-work-kickback-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function writeIncompleteTaskStatus(): void {
    mkdirSync(join(dir, '.pipeline'), { recursive: true });
    writeFileSync(
      join(dir, '.pipeline', 'task-status.json'),
      JSON.stringify({ tasks: [{ id: '1', status: 'pending' }] }),
      'utf8',
    );
    // This describe block exercises the zero-work kickback, not the
    // pre-dispatch attribution-machinery guard (Task 5/6, #676) — seed
    // healthy session hooks so that guard doesn't block build dispatch
    // before the zero-work logic under test ever runs.
    const hooksDir = join(dir, '.pipeline', 'session-hooks');
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(join(hooksDir, 'pre-dispatch.sh'), '#!/bin/sh\n', 'utf-8');
    writeFileSync(join(hooksDir, 'post-dispatch.sh'), '#!/bin/sh\n', 'utf-8');
    writeFileSync(join(hooksDir, 'mutation-gate.sh'), '#!/bin/sh\n', 'utf-8');
  }

  function writeCompleteTaskStatus(): void {
    mkdirSync(join(dir, '.pipeline'), { recursive: true });
    writeFileSync(
      join(dir, '.pipeline', 'task-status.json'),
      JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }),
      'utf8',
    );
  }

  /**
   * Pre-seed conduct-state.json so every step BEFORE `build` is already
   * `done` — findResumeIndex then resumes straight at `build`, so
   * `verifyArtifacts: true` only ever gates the build step in this test
   * (earlier steps' artifact globs are irrelevant to Task 16).
   */
  async function seedStateAtBuild(): Promise<void> {
    const buildIdx = ALL_STEPS.findIndex((s) => s.name === 'build');
    const state: Record<string, string> = {};
    for (let i = 0; i < buildIdx; i++) {
      state[ALL_STEPS[i].name] = 'done';
    }
    await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  }

  it('increments noEvidenceAttempts with reason zero_work_product and injects a corrective preamble on the next dispatch', async () => {
    writeIncompleteTaskStatus();
    await seedStateAtBuild();

    const emittedTypes: string[] = [];
    events.on('zero_work_product', (evt) => {
      emittedTypes.push(evt.type);
    });

    let buildCalls = 0;
    let secondCallRetryReason: string | undefined;
    const runner: StepRunner = {
      run: async (step: StepName, _state, opts): Promise<StepRunResult> => {
        if (step === 'build') {
          buildCalls++;
          if (buildCalls === 1) {
            // First attempt: dispatched nothing, no commits — the
            // detector's exact zero-work condition. Leave task-status
            // incomplete so the completion gate misses.
          } else {
            secondCallRetryReason = opts?.retryReason;
            // Second attempt resolves the task so the retry loop can exit
            // cleanly instead of exhausting max_retries.
            writeCompleteTaskStatus();
          }
        }
        return { success: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      config: PAST_CUTOVER,
      verifyArtifacts: true,
    });

    await conductor.run();

    expect(buildCalls).toBeGreaterThanOrEqual(2);
    expect(secondCallRetryReason).toMatch(/zero progress/i);
    expect(secondCallRetryReason).toContain('Previous attempt made zero progress');

    // #570 guard: the kickback path's own `zero_work_product` event must
    // still fire post-fix — this is a wholly separate signal from the
    // attribution judge-lane dispatch that #570 modified.
    expect(emittedTypes).toContain('zero_work_product');

    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');
    const evidence = await createTaskEvidence(dir);
    expect(evidence.noEvidenceAttempts).toBeGreaterThan(0);
    expect(evidence.noEvidenceReasons).toContain('zero_work_product');
  });

  it('#570 guard: a progress-making attempt resets the no-evidence counter and emits no zero_work_product event', async () => {
    writeIncompleteTaskStatus();
    await seedStateAtBuild();

    const emittedTypes: string[] = [];
    events.on('zero_work_product', (evt) => {
      emittedTypes.push(evt.type);
    });

    let buildCalls = 0;
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        if (step === 'build') {
          buildCalls++;
          // First attempt resolves the task — real forward progress, so
          // resolvedTasksAfter > resolvedTasksBefore and
          // areAllTasksComplete() is true, which makes
          // detectZeroWorkProduct short-circuit to false regardless of
          // HEAD movement (no real git needed — execa is mocked in this
          // file).
          writeCompleteTaskStatus();
        }
        return { success: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      config: PAST_CUTOVER,
      verifyArtifacts: true,
    });

    await conductor.run();

    expect(emittedTypes).not.toContain('zero_work_product');

    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');
    const evidence = await createTaskEvidence(dir);
    expect(evidence.noEvidenceAttempts).toBe(0);
    expect(evidence.noEvidenceReasons).toEqual([]);
  });

  it('does not tag noEvidenceReasons with zero_work_product for an ordinary (non-zero-work) completion-gate miss', async () => {
    // Incomplete task-status.json, but enforcement is NOT active (no
    // cutover configured) — detectZeroWorkProduct short-circuits to false,
    // so the miss is an ordinary one, never tagged.
    writeIncompleteTaskStatus();
    await seedStateAtBuild();

    let buildCalls = 0;
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        if (step === 'build') {
          buildCalls++;
          if (buildCalls >= 2) writeCompleteTaskStatus();
        }
        return { success: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      // no config — enforcement not configured
      verifyArtifacts: true,
    });

    await conductor.run();

    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');
    const evidence = await createTaskEvidence(dir);
    expect(evidence.noEvidenceReasons).not.toContain('zero_work_product');
  });
});
