import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isEnforcementConfigured,
  markerPath,
  writeBuildStepMarker,
  removeBuildStepMarker,
  detectZeroWorkProduct,
} from '../../src/engine/attribution-enforcement.js';
import type { HarnessConfig } from '../../src/types/config.js';

// execa is consumed transitively (WorktreeManager); never fork real git.
vi.mock('execa', () => ({ execa: vi.fn() }));

import { ConductorEventEmitter } from '../../src/ui/events.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import type { StepName } from '../../src/types/index.js';

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
