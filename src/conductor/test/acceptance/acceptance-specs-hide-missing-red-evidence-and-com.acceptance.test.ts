/**
 * Acceptance specs for #1246: acceptance_specs RED evidence visibility and
 * completion-wait discrimination.
 *
 * Acceptance-level coverage is intentionally limited to the cross-component
 * flows in Stories 2-8:
 *
 * - Conductor.run -> completion predicate -> self-heal -> enriched root marker
 *   -> acceptance_red events -> EventPersister -> events.jsonl.
 * - persisted step/RED lifecycle + heartbeat -> scanInheritedState -> the
 *   operator-facing daemon dashboard line.
 *
 * Story 1's individual marker-shape/counter cases and the remaining boundary
 * branches are single-operation contracts. They are unit-covered by plan Tasks
 * 1-8, 13-17, and 18-20 rather than duplicated here.
 *
 * Production call sites exercised for the RED-state derivation:
 * - src/engine/conductor.ts (the real acceptance_specs step path)
 * - src/engine/acceptance-red-runner.ts (through that step path)
 * - src/engine/daemon-dashboard.ts (the real persisted-state reader/renderer)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('execa', () => ({
  execa: vi.fn(() => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })),
}));
vi.mock('../../src/engine/self-host/operator-credentials.js', () => ({
  readOperatorCredentialsState: vi.fn().mockResolvedValue('fresh'),
  waitForCredentialsChange: vi.fn(),
}));
vi.mock('../../src/engine/self-host/sandbox-build-env.js', () => ({
  provisionSandboxBuildEnv: vi.fn(),
  realSandboxFs: {},
  SandboxProvisionError: class SandboxProvisionError extends Error {},
}));
vi.mock('../../src/engine/rebase.js', async () => {
  const actual = await vi.importActual('../../src/engine/rebase.js');
  return { ...actual, performRebase: vi.fn().mockResolvedValue({ kind: 'noop' }) };
});

import { Conductor } from '../../src/engine/conductor.js';
import type { ConductorOptions, StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { scanInheritedState, renderDashboard } from '../../src/engine/daemon-dashboard.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState, StepName } from '../../src/types/index.js';

const FEATURE_SPEC = 'test/acceptance/feature.acceptance.test.ts';
const GREEN_REASON =
  'acceptance-specs RED run shows 0 failed — RED not established; the generated specs must FAIL before implementation';

type AcceptanceRedLedgerEvent = {
  type: 'acceptance_red';
  state: 'required' | 'pending' | 'satisfied' | 'rejected';
  step: 'acceptance_specs';
  reason?: string;
  viaException?: boolean;
};

function runner(): StepRunner {
  return {
    run: async (): Promise<StepRunResult> => ({ success: true }),
    resetSession: async () => {},
  };
}

async function seedOnlyAcceptanceSpecs(statePath: string): Promise<void> {
  const loaded = await readState(statePath);
  const state = (loaded.ok ? loaded.value : {}) as Record<string, unknown>;
  for (const step of ALL_STEPS) {
    if (step.name !== 'acceptance_specs') state[step.name] = 'done';
  }
  state.complexity_tier = 'M';
  state.feature_desc = 'acceptance-specs-hide-missing-red-evidence-and-com';
  state.track = 'technical';
  await writeState(statePath, state as unknown as ConductState);
}

async function readLedger(path: string): Promise<Record<string, unknown>[]> {
  const raw = await readFile(path, 'utf-8').catch(() => '');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('acceptance_specs provenance and RED lifecycle use the real Conductor step path', () => {
  let root: string;
  let statePath: string;
  let eventsPath: string;
  let events: ConductorEventEmitter;
  let persister: EventPersister;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'acceptance-red-lifecycle-'));
    statePath = join(root, 'conduct-state.json');
    eventsPath = join(root, '.pipeline', 'events.jsonl');
    events = new ConductorEventEmitter();
    persister = new EventPersister(eventsPath, events);
    persister.start();
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await mkdir(join(root, 'test', 'acceptance'), { recursive: true });
    await writeFile(join(root, FEATURE_SPEC), '// committed acceptance spec\n', 'utf-8');
    await seedOnlyAcceptanceSpecs(statePath);
  });

  afterEach(async () => {
    persister.stop();
    await rm(root, { recursive: true, force: true });
  });

  function conductor(overrides: Partial<ConductorOptions> = {}): Conductor {
    return new Conductor({
      stateFilePath: statePath,
      stepRunner: runner(),
      events,
      projectRoot: root,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
      fromStep: 'acceptance_specs',
      escalateBuildFailure: async () => ({}),
      ...overrides,
    });
  }

  async function writeRunContract(): Promise<void> {
    await writeFile(
      join(root, '.pipeline', 'acceptance-specs-run.json'),
      JSON.stringify({
        command: 'npm test -- test/acceptance/feature.acceptance.test.ts',
        cwd: '.',
        targetSpecs: [FEATURE_SPEC],
      }),
      'utf-8',
    );
  }

  it('recovers a legacy marker once, writes provenance at the authoritative root, and records refusal then satisfaction on the event spine', async () => {
    await writeRunContract();
    await writeFile(
      join(root, '.pipeline', 'acceptance-specs-red.json'),
      JSON.stringify({
        command: 'npm test -- test/acceptance/feature.acceptance.test.ts',
        targetSpecs: [FEATURE_SPEC],
        executed: 1,
        passed: 0,
        failed: 1,
        skipped: 0,
        errors: 0,
      }),
      'utf-8',
    );

    const exec = vi.fn(async () => ({
      executed: 1,
      passed: 0,
      failed: 1,
      skipped: 0,
      errors: 0,
      failingTests: [
        {
          name: 'records the intended missing acceptance RED lifecycle',
          reason: 'expected acceptance_red satisfied event, but none was emitted',
        },
      ],
      intentRationale:
        'The missing event is the operator-visible behavior introduced by this feature.',
    }));

    await conductor({ acceptanceRedExec: exec }).run();

    expect(exec).toHaveBeenCalledTimes(1);
    const marker = JSON.parse(
      await readFile(join(root, '.pipeline', 'acceptance-specs-red.json'), 'utf-8'),
    ) as Record<string, unknown>;
    expect(marker).toMatchObject({
      command: 'npm test -- test/acceptance/feature.acceptance.test.ts',
      targetSpecs: [FEATURE_SPEC],
      failed: 1,
      failingTests: [
        {
          name: 'records the intended missing acceptance RED lifecycle',
          reason: 'expected acceptance_red satisfied event, but none was emitted',
        },
      ],
    });
    expect(Date.parse(String(marker.ranAt))).not.toBeNaN();
    expect(String(marker.intentRationale).trim()).not.toBe('');

    const state = await readState(statePath);
    expect(state.ok && state.value.acceptance_specs).toBe('done');

    const redEvents = (await readLedger(eventsPath)).filter(
      (event): event is AcceptanceRedLedgerEvent => event.type === 'acceptance_red',
    );
    expect(redEvents.map((event) => event.state)).toEqual([
      'required',
      'rejected',
      'pending',
      'satisfied',
    ]);
    expect(redEvents.find((event) => event.state === 'rejected')?.reason).toMatch(
      /failingTests|ranAt|intentRationale/,
    );
  });

  it('refuses a green run with the unchanged reason and never emits a satisfied lifecycle event', async () => {
    await writeRunContract();
    const exec = vi.fn(async () => ({
      executed: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      errors: 0,
      failingTests: [],
      ranAt: new Date().toISOString(),
      intentRationale: 'The suite executed but did not establish RED.',
    }));

    await conductor({ acceptanceRedExec: exec }).run();

    const state = await readState(statePath);
    expect(state.ok && state.value.acceptance_specs).not.toBe('done');

    const redEvents = (await readLedger(eventsPath)).filter(
      (event): event is AcceptanceRedLedgerEvent => event.type === 'acceptance_red',
    );
    const rejected = redEvents.find((event) => event.state === 'rejected');
    expect(rejected?.reason).toBe(GREEN_REASON);
    expect(redEvents.some((event) => event.state === 'satisfied')).toBe(false);
  });

  it('accepts an attributable remediation exception but reports the pass as waived, never proven RED', async () => {
    await writeFile(
      join(root, '.pipeline', 'acceptance-specs-red.json'),
      JSON.stringify({
        command: 'npm test -- test/acceptance/feature.acceptance.test.ts',
        targetSpecs: [FEATURE_SPEC],
        executed: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
        errors: 0,
        failingTests: [],
        ranAt: new Date().toISOString(),
        intentRationale: 'A recorded remediation combined the test and production repair.',
        exception: {
          kind: 'remediation',
          reason: 'The accepted remediation required one atomic test-and-production repair.',
          attribution: 'remediation #1246 approved by operator',
        },
      }),
      'utf-8',
    );

    await conductor().run();

    const state = await readState(statePath);
    expect(state.ok && state.value.acceptance_specs).toBe('done');

    const redEvents = (await readLedger(eventsPath)).filter(
      (event): event is AcceptanceRedLedgerEvent => event.type === 'acceptance_red',
    );
    expect(redEvents).toContainEqual(
      expect.objectContaining({
        type: 'acceptance_red',
        state: 'satisfied',
        step: 'acceptance_specs',
        viaException: true,
      }),
    );
  });
});

describe('daemon status distinguishes working from waiting using persisted lifecycle evidence', () => {
  let root: string;
  let worktreeBase: string;
  let processedDir: string;
  let worktree: string;
  let pipeline: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'acceptance-red-status-'));
    worktreeBase = join(root, '.worktrees');
    processedDir = join(root, '.daemon', 'processed');
    worktree = join(worktreeBase, 'acceptance-red-feature');
    pipeline = join(worktree, '.pipeline');
    await mkdir(pipeline, { recursive: true });
    await writeFile(
      join(pipeline, 'conduct-state.json'),
      JSON.stringify({ acceptance_specs: 'in_progress', complexity_tier: 'M' }),
      'utf-8',
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('transitions the operator line from working with fresh telemetry to waiting on the exact refused completion condition', async () => {
    const dispatchStarted = Date.now() - 15_000;
    await writeFile(
      join(pipeline, 'events.jsonl'),
      [
        JSON.stringify({
          type: 'step_started',
          step: 'acceptance_specs',
          index: 11,
          ts: new Date(dispatchStarted).toISOString(),
        }),
        JSON.stringify({
          type: 'acceptance_red',
          step: 'acceptance_specs',
          state: 'required',
          viaException: false,
          ts: new Date(dispatchStarted + 1_000).toISOString(),
        }),
      ].join('\n') + '\n',
      'utf-8',
    );
    await writeFile(
      join(pipeline, 'step-heartbeat'),
      JSON.stringify({
        step: 'acceptance_specs',
        ts: new Date(Date.now() - 2_000).toISOString(),
      }),
      'utf-8',
    );

    const workingState = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [],
    });
    const working = renderDashboard(workingState);
    expect(working).toContain('working');
    expect(working).toContain('acceptance_specs');
    expect(working).toContain('RED: required');
    expect(working).toMatch(/heartbeat|activity telemetry/i);
    expect(working).toContain('children: unknown');

    await writeFile(
      join(pipeline, 'events.jsonl'),
      [
        JSON.stringify({
          type: 'step_started',
          step: 'acceptance_specs',
          index: 11,
          ts: new Date(dispatchStarted).toISOString(),
        }),
        JSON.stringify({
          type: 'acceptance_red',
          step: 'acceptance_specs',
          state: 'pending',
          viaException: false,
          ts: new Date().toISOString(),
        }),
        JSON.stringify({
          type: 'acceptance_red',
          step: 'acceptance_specs',
          state: 'rejected',
          reason: GREEN_REASON,
          viaException: false,
          ts: new Date().toISOString(),
        }),
      ].join('\n') + '\n',
      'utf-8',
    );

    const waitingState = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [],
    });
    const waiting = renderDashboard(waitingState);
    expect(waiting).toContain('waiting');
    expect(waiting).toContain('RED: rejected');
    expect(waiting).toContain(GREEN_REASON);
    expect(waiting).toContain('children: unknown');
  });
});
