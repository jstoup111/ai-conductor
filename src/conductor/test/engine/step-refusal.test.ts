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
import type { ConductorEvent } from '../../src/types/events.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('step refusal event spine', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
      maxRetries: 2,
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
        halt: await readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8'),
        haltClass: await readFile(join(projectRoot, '.pipeline', 'HALT.class'), 'utf8'),
      }).toEqual({
        build: 'done',
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
});
