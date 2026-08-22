import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Conductor,
  protectedArtifactRefusalResult,
  type StepRunner,
  type StepRunResult,
} from '../../src/engine/conductor.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import * as projectPrelude from '../../src/engine/project-prelude.js';
import * as protectedArtifactSeal from '../../src/engine/protected-artifact-seal.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductorEvent } from '../../src/types/events.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('step refusal event spine', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const buildReviewState = (buildReview: 'done' | 'pending') => ({
    ...Object.fromEntries(
      ALL_STEPS.slice(0, ALL_STEPS.findIndex((step) => step.name === 'build_review'))
        .map((step) => [step.name, 'done']),
    ),
    build_review: buildReview,
  });

  it('returns the protected-artifact refusal result used by the seal dispatch seam', () => {
    const dispatchIssue = 'Protected artifact changed: .docs/plans/feature.md';

    expect(protectedArtifactRefusalResult(dispatchIssue)).toEqual({
      success: false,
      output: dispatchIssue,
      refused: { kind: 'protected-artifact', reason: dispatchIssue },
    });
  });

  it('persists a typed step refusal through events.jsonl', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'step-refusal-'));
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(projectRoot, '.pipeline', 'events.jsonl'), events);
    const result = {
      success: false,
      refused: { kind: 'protected-artifact', reason: 'x' },
    } satisfies StepRunResult;
    const event = {
      type: 'step_refused',
      step: 'build',
      kind: result.refused.kind,
      reason: result.refused.reason,
    } satisfies ConductorEvent;

    persister.start();
    try {
      await events.emit(event);

      const [line] = (await readFile(join(projectRoot, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim()
        .split('\n');
      expect(JSON.parse(line)).toMatchObject(event);
    } finally {
      persister.stop();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('keeps a completed build done after protected-artifact refusal retries halt', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'step-refusal-'));
    const statePath = join(projectRoot, 'conduct-state.json');
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(projectRoot, '.pipeline', 'events.jsonl'), events);
    const dispatchIssue = 'Protected artifact changed: .docs/plans/feature.md';
    await writeFile(statePath, JSON.stringify({ plan: 'done', build: 'done' }), 'utf8');
    vi.spyOn(projectPrelude, 'currentCommitSha').mockResolvedValue('approved-commit');
    let stateAtSealCheck: string | undefined;
    vi.spyOn(protectedArtifactSeal, 'verifyProtectedArtifactSeal').mockImplementation(async () => {
      stateAtSealCheck ??= await readFile(statePath, 'utf8');
      return {
        ok: false,
        reason: dispatchIssue,
      };
    });
    const run = vi.fn(async () => {
      throw new Error('protected-artifact refusal must prevent dispatch');
    });
    const runner: StepRunner = { run };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot,
      config: {} as never,
      fromStep: 'build',
      mode: 'default',
      maxRetries: 2,
    });
    const saveStepStatus = vi.spyOn(
      conductor as unknown as {
        saveConductorStepStatus: (state: unknown, step: string, status: string) => Promise<void>;
      },
      'saveConductorStepStatus',
    );

    persister.start();
    try {
      await conductor.run();
      const records = (await readFile(join(projectRoot, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line));

      expect({
        build: JSON.parse(await readFile(statePath, 'utf8')).build,
        stateBytes: await readFile(statePath, 'utf8'),
        stateAtSealCheck,
        buildStatusWrites: saveStepStatus.mock.calls.filter(([, step]) => step === 'build'),
        runnerCalls: run.mock.calls,
        refusals: records.filter((record) => record.type === 'step_refused'),
        failures: records.filter((record) => record.type === 'step_failed'),
        halt: await readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8'),
        haltClass: await readFile(join(projectRoot, '.pipeline', 'HALT.class'), 'utf8'),
      }).toEqual({
        build: 'done',
        stateBytes: stateAtSealCheck,
        stateAtSealCheck: expect.stringContaining('"build": "done"'),
        buildStatusWrites: [],
        runnerCalls: [],
        refusals: [
          expect.objectContaining({ step: 'build', kind: 'protected-artifact', reason: dispatchIssue }),
          expect.objectContaining({ step: 'build', kind: 'protected-artifact', reason: dispatchIssue }),
        ],
        failures: [],
        halt: dispatchIssue,
        haltClass: 'protected-artifact',
      });
    } finally {
      persister.stop();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('keeps a pending build pending after a single protected-artifact refusal', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'step-refusal-'));
    const statePath = join(projectRoot, 'conduct-state.json');
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(projectRoot, '.pipeline', 'events.jsonl'), events);
    const dispatchIssue = 'Protected artifact changed: .docs/plans/feature.md';
    await writeFile(statePath, JSON.stringify({ plan: 'done', build: 'pending' }), 'utf8');
    vi.spyOn(projectPrelude, 'currentCommitSha').mockResolvedValue('approved-commit');
    vi.spyOn(protectedArtifactSeal, 'verifyProtectedArtifactSeal').mockResolvedValue({
      ok: false,
      reason: dispatchIssue,
    });
    const run = vi.fn(async () => {
      throw new Error('protected-artifact refusal must prevent dispatch');
    });
    const runner: StepRunner = { run };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot,
      config: {} as never,
      fromStep: 'build',
      mode: 'default',
      maxRetries: 1,
    });

    persister.start();
    try {
      await conductor.run();
      const records = (await readFile(join(projectRoot, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line));

      expect({
        build: JSON.parse(await readFile(statePath, 'utf8')).build,
        runnerCalls: run.mock.calls,
        refusals: records.filter((record) => record.type === 'step_refused'),
        failures: records.filter((record) => record.type === 'step_failed'),
      }).toEqual({
        build: 'pending',
        runnerCalls: [],
        refusals: [
          expect.objectContaining({ step: 'build', kind: 'protected-artifact', reason: dispatchIssue }),
        ],
        failures: [],
      });
    } finally {
      persister.stop();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('refuses a missing build-review worktree without changing its completed status', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'step-refusal-missing-worktree-'));
    const statePath = join(stateDir, 'conduct-state.json');
    const missingRoot = join(stateDir, 'removed-worktree');
    const events = new ConductorEventEmitter();
    const reason = `Cannot dispatch 'build_review': its working directory ${missingRoot} does not exist. ` +
      'The feature worktree was removed while the run was in flight. The BRANCH is the ' +
      'source of truth — recreate the worktree from it and recover the .pipeline evidence ' +
      'before resuming, so completed work is not redone.';
    await writeFile(statePath, JSON.stringify(buildReviewState('done')), 'utf8');
    const run = vi.fn(async () => {
      throw new Error('missing worktree refusal must prevent dispatch');
    });
    const refusals: ConductorEvent[] = [];
    const failures: ConductorEvent[] = [];
    const haltReasons: string[] = [];
    events.on('step_refused', (event) => {
      refusals.push(event);
    });
    events.on('step_failed', (event) => {
      failures.push(event);
    });
    events.on('loop_halt', (event) => {
      if (event.type === 'loop_halt') haltReasons.push(event.reason);
    });

    try {
      await new Conductor({
        stateFilePath: statePath,
        stepRunner: { run },
        events,
        projectRoot: missingRoot,
        config: {} as never,
        fromStep: 'build_review',
        mode: 'auto',
        daemon: true,
      }).run();

      expect({
        buildReview: JSON.parse(await readFile(statePath, 'utf8')).build_review,
        runnerCalls: run.mock.calls,
        refusals,
        failures,
        haltReason: haltReasons[0],
      }).toEqual({
        buildReview: 'done',
        runnerCalls: [],
        refusals: [expect.objectContaining({ step: 'build_review', kind: 'missing-worktree', reason })],
        failures: [],
        haltReason: reason,
      });
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it('dispatches build review normally when its worktree is present', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'step-refusal-present-worktree-'));
    const statePath = join(projectRoot, 'conduct-state.json');
    const events = new ConductorEventEmitter();
    await writeFile(statePath, JSON.stringify(buildReviewState('pending')), 'utf8');
    const run = vi.fn(async () => ({ success: false, output: 'expected fixture failure' }));
    const refusals: ConductorEvent[] = [];
    events.on('step_refused', (event) => {
      refusals.push(event);
    });

    try {
      await new Conductor({
        stateFilePath: statePath,
        stepRunner: { run },
        events,
        projectRoot,
        config: {} as never,
        fromStep: 'build_review',
        mode: 'auto',
        daemon: true,
        maxRetries: 1,
      }).run();

      expect({ runnerCalls: run.mock.calls, refusals }).toEqual({
        runnerCalls: [expect.any(Array)],
        refusals: [],
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('keeps a genuine build failure on the failed path when the seal passes', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'step-refusal-'));
    const statePath = join(projectRoot, 'conduct-state.json');
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(projectRoot, '.pipeline', 'events.jsonl'), events);
    await writeFile(statePath, JSON.stringify({ plan: 'done', build: 'pending' }), 'utf8');
    vi.spyOn(projectPrelude, 'currentCommitSha').mockResolvedValue('approved-commit');
    vi.spyOn(projectPrelude, 'currentTreeHash').mockResolvedValue('tree-witness');
    vi.spyOn(protectedArtifactSeal, 'verifyProtectedArtifactSeal').mockResolvedValue({
      ok: true,
      seal: { version: 2, baselineCommit: 'approved-commit', protectedArtifacts: [], rebaselines: [] },
      selfAmendments: [],
    });
    vi.spyOn(protectedArtifactSeal, 'createProtectedArtifactSeal').mockResolvedValue({
      version: 2,
      baselineCommit: 'approved-commit',
      protectedArtifacts: [],
      rebaselines: [],
    });
    const run = vi.fn(async () => ({ success: false, output: 'boom' }));
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run },
      events,
      projectRoot,
      config: {} as never,
      fromStep: 'build',
      mode: 'auto',
      daemon: true,
      maxRetries: 2,
    });

    persister.start();
    try {
      await conductor.run();
      const records = (await readFile(join(projectRoot, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line));
      const outcome = JSON.parse(await readFile(join(projectRoot, '.pipeline', 'build-outcome.json'), 'utf8')) as {
        records: Array<Record<string, unknown>>;
      };

      expect({
        build: JSON.parse(await readFile(statePath, 'utf8')).build,
        runnerCalls: run.mock.calls,
        refusals: records.filter((record) => record.type === 'step_refused'),
        failures: records.filter((record) => record.type === 'step_failed'),
        terminalOutcome: outcome.records.at(-1)?.terminalOutcome,
      }).toEqual({
        build: 'failed',
        runnerCalls: [
          expect.any(Array),
          expect.any(Array),
        ],
        refusals: [],
        failures: [expect.objectContaining({ step: 'build', error: 'boom' })],
        terminalOutcome: 'failed',
      });
    } finally {
      persister.stop();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
