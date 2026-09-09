// Covers: S1.1, S1.2, S1.3, S1.4, S2.1, S2.2, S2.6, S2.8, task:2, task:5
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { createFilesystemConductStateStore } from '../../src/engine/filesystem-conduct-state-store.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState, ConductorEvent, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const PRD_PASS = [
  '# PRD Audit',
  '',
  '**PRD:** none',
  '',
  '## Verdict Table',
  '',
  '| Criterion | Grade | Plan task | Evidence |',
  '|---|---|---|---|',
  '| S1.1 | PASS | — | evidence.ts:1 |',
  '',
].join('\n');

const MT_PASS = '# Results\n\n| Story | Result |\n|--|--|\n| s1 | PASS |\n';

async function seedValidators(
  dir: string,
  statePath: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const state: Record<string, unknown> = {};
  for (const step of ALL_STEPS) {
    if (step.name === 'manual_test') break;
    state[step.name] = 'done';
  }
  Object.assign(state, {
    complexity_tier: 'M', track: 'product',
    feature_desc: 'one-transient-failure-in-a-validation-group-member',
    build_review: 'done', ...overrides,
  });
  await writeState(statePath, state as ConductState);
  await mkdir(join(dir, '.pipeline'), { recursive: true });
  await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }));
}

describe('validation-group no-verdict sibling retention (#1425)', () => {
  it('halts for the failed member while retaining both siblings that passed the joined gate checks', async () => {
    const dir = await mkdtemp(join(process.env.TMPDIR!, 'validation-retain-siblings-'));
    const statePath = join(dir, 'conduct-state.json');

    try {
      const state: Record<string, unknown> = {};
      for (const step of ALL_STEPS) {
        if (step.name === 'manual_test') break;
        state[step.name] = 'done';
      }
      Object.assign(state, {
        complexity_tier: 'M',
        track: 'product',
        feature_desc: 'one-transient-failure-in-a-validation-group-member',
        build_review: 'done',
      });
      await writeState(statePath, state as unknown as ConductState);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
      );

      const calls: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          calls.push(step);
          if (step === 'manual_test') {
            throw new Error('validator process exited before writing its verdict');
          }
          if (step === 'prd_audit') {
            await writeFile(join(dir, '.pipeline/prd-audit.md'), PRD_PASS);
          }
          if (step === 'architecture_review_as_built') {
            await writeFile(
              join(dir, '.pipeline/architecture-review-as-built.md'),
              '# As-Built Architecture Review\n\nVerdict: APPROVED\n',
            );
          }
          return { success: true } as StepRunResult;
        }),
      };

      const emitted: ConductorEvent[] = [];
      const events = new ConductorEventEmitter();
      events.on('loop_halt', (event) => { emitted.push(event); });
      events.on('step_failed', (event) => { emitted.push(event); });
      events.on('kickback', (event) => { emitted.push(event); });

      const stateStore = createFilesystemConductStateStore(statePath);
      const applyBatch = vi.spyOn(stateStore, 'applyBatch');
      const conductor = new Conductor({
        stateFilePath: statePath,
        stateStore,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 2,
        fromStep: 'manual_test',
      });
      await conductor.run();

      expect(calls.filter((step) => step === 'manual_test')).toHaveLength(2);
      expect(calls).toContain('prd_audit');
      expect(calls).toContain('architecture_review_as_built');
      expect(calls).not.toContain('remediate');

      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(result.value).toMatchObject({
        prd_audit: 'done',
        architecture_review_as_built: 'done',
        validation__prd_audit: 'done',
        validation__architecture_review_as_built: 'done',
        manual_test: 'failed',
        last_step: 'manual_test',
      });
      expect((result.value as Record<string, unknown>).validation__manual_test).not.toBe('done');

      const haltCommits = applyBatch.mock.calls
        .map(([batch]) => batch)
        .filter((batch) => batch.name === 'fail manual_test validation group');
      expect(haltCommits).toHaveLength(1);
      expect(haltCommits[0]?.mutations).toEqual(expect.arrayContaining([
        expect.objectContaining({ field: 'prd_audit', next: 'done' }),
        expect.objectContaining({ field: 'architecture_review_as_built', next: 'done' }),
        expect.objectContaining({ field: 'validation__prd_audit', next: 'done' }),
        expect.objectContaining({ field: 'validation__architecture_review_as_built', next: 'done' }),
        expect.objectContaining({ field: 'manual_test', next: 'failed' }),
        expect.objectContaining({ field: 'last_step', next: 'manual_test' }),
      ]));

      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf8');
      expect(halt).toContain('manual_test');
      expect(halt).toContain('validator process exited before writing its verdict');
      await expect(readFile(join(dir, '.pipeline/HALT.class'), 'utf8')).resolves.toBe('needs-human');
      await expect(readFile(join(dir, '.pipeline/remediation.json'), 'utf8')).rejects.toThrow();
      expect(emitted.filter((event) => event.type === 'loop_halt')).toHaveLength(1);
      expect(emitted.filter((event) => event.type === 'step_failed')).toHaveLength(1);
      expect(emitted.filter((event) => event.type === 'kickback')).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('continues to the halt when the atomic retention commit is rejected', async () => {
    const dir = await mkdtemp(join(process.env.TMPDIR!, 'validation-retention-rejection-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedValidators(dir, statePath);
      const events: ConductorEvent[] = [];
      const emitter = new ConductorEventEmitter();
      emitter.on('loop_halt', event => events.push(event));
      emitter.on('step_failed', event => events.push(event));
      const store = createFilesystemConductStateStore(statePath);
      const applyBatch = vi.spyOn(store, 'applyBatch');
      applyBatch.mockImplementation(async (batch) => {
        if (batch.name === 'fail manual_test validation group') throw new Error('atomic store unavailable');
        return await createFilesystemConductStateStore(statePath).applyBatch(batch);
      });
      const log = vi.fn();
      const conductor = new Conductor({
        stateFilePath: statePath, stateStore: store, events: emitter, projectRoot: dir,
        mode: 'auto', daemon: true, verifyArtifacts: true, maxRetries: 1, fromStep: 'manual_test', log,
        stepRunner: { run: vi.fn(async (step: StepName) => {
          if (step === 'manual_test') throw new Error('runner died');
          if (step === 'prd_audit') await writeFile(join(dir, '.pipeline/prd-audit.md'), PRD_PASS);
          if (step === 'architecture_review_as_built') await writeFile(join(dir, '.pipeline/architecture-review-as-built.md'), '# Review\n\nVerdict: APPROVED\n');
          return { success: true } as StepRunResult;
        }) },
      });
      await expect(conductor.run()).resolves.toBeUndefined();
      await expect(readFile(join(dir, '.pipeline/HALT.class'), 'utf8')).resolves.toBe('needs-human');
      expect(events.map(event => event.type)).toEqual(expect.arrayContaining(['loop_halt', 'step_failed']));
      expect(log).toHaveBeenCalledWith(expect.stringContaining('could not persist satisfied siblings'));
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('does not retain a sibling whose objective gate is unsatisfied', async () => {
    const dir = await mkdtemp(join(process.env.TMPDIR!, 'validation-unvalidated-sibling-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedValidators(dir, statePath);
      const conductor = new Conductor({
        stateFilePath: statePath, events: new ConductorEventEmitter(), projectRoot: dir, mode: 'auto', daemon: true,
        verifyArtifacts: true, maxRetries: 1, fromStep: 'manual_test',
        stepRunner: { run: vi.fn(async (step: StepName) => {
          if (step === 'manual_test') throw new Error('runner died');
          // `prd_audit` reports dispatch success but deliberately writes no
          // verdict artifact, so its objective gate remains unsatisfied.
          if (step === 'architecture_review_as_built') await writeFile(join(dir, '.pipeline/architecture-review-as-built.md'), '# Review\n\nVerdict: APPROVED\n');
          return { success: true } as StepRunResult;
        }) },
      });
      await conductor.run();
      const result = await readState(statePath);
      expect(result.ok && result.value.prd_audit).not.toBe('done');
      expect(result.ok && result.value.validation__prd_audit).not.toBe('done');
      expect(result.ok && [result.value.architecture_review_as_built, result.value.validation__architecture_review_as_built])
        .toEqual(['done', 'done']);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('re-dispatches only the failed member after the HALT is cleared', async () => {
    const dir = await mkdtemp(join(process.env.TMPDIR!, 'validation-retained-redispatch-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedValidators(dir, statePath, {
        manual_test: 'failed', prd_audit: 'done', architecture_review_as_built: 'done',
        validation__prd_audit: 'done', validation__architecture_review_as_built: 'done',
        rebase: 'done', finish: 'done',
      });
      const calls: StepName[] = [];
      const conductor = new Conductor({
        stateFilePath: statePath, events: new ConductorEventEmitter(), projectRoot: dir, mode: 'auto', daemon: true,
        verifyArtifacts: true, maxRetries: 2, fromStep: 'manual_test',
        stepRunner: { run: vi.fn(async (step: StepName) => {
          calls.push(step);
          if (step === 'manual_test') await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
          return { success: true } as StepRunResult;
        }) },
      });
      await conductor.run();
      expect(calls).toEqual(['manual_test']);
      const result = await readState(statePath);
      expect(result.ok && [result.value.manual_test, result.value.prd_audit, result.value.architecture_review_as_built,
        result.value.validation__prd_audit, result.value.validation__architecture_review_as_built])
        .toEqual(['done', 'done', 'done', 'done', 'done']);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
