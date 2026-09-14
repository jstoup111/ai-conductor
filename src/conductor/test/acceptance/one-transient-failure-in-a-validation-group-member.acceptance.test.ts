// Covers: S1.1, S1.2, S1.3, S1.4, S2.1, S2.2, S2.5, S2.6, S2.8, S3.2, S3.3,
// S3.4, S3.5, S3.7, task:2, task:3, task:5, task:6, task:7, task:8
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { createFilesystemConductStateStore } from '../../src/engine/filesystem-conduct-state-store.js';
import { readState, writeState } from '../../src/engine/state.js';
import { applyRebaseVerdicts, type RebaseOutcome } from '../../src/engine/rebase.js';
import { writeVerdict } from '../../src/engine/gate-verdicts.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { computeTimingRollup } from '../../src/engine/timing-rollup.js';
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
      events.on('parallel_failure', (event) => { emitted.push(event); });
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
      const groupTerminals = emitted.filter((event) => event.type === 'parallel_failure');
      expect(groupTerminals).toHaveLength(1);
      expect(groupTerminals[0]).toMatchObject({ branch: 'manual_test' });
      expect(emitted.filter((event) => event.type === 'step_failed')).toHaveLength(0);
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
      emitter.on('loop_halt', event => { events.push(event); });
      emitter.on('parallel_failure', event => { events.push(event); });
      emitter.on('step_failed', event => { events.push(event); });
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
      expect(events.map(event => event.type)).toEqual(expect.arrayContaining(['loop_halt', 'parallel_failure']));
      expect(events.map(event => event.type)).not.toContain('step_failed');
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
      if (!result.ok) throw result.error;
      const state = result.value as Record<string, unknown>;
      expect(result.ok && result.value.prd_audit).not.toBe('done');
      expect(state.validation__prd_audit).not.toBe('done');
      expect([state.manual_test, state.validation__manual_test]).not.toContain('done');
      expect([state.architecture_review_as_built, state.validation__architecture_review_as_built])
        .toEqual(['done', 'done']);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('does not retain manual_test when its successful dispatch records FAIL rows', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'validation-manual-test-fail-retention-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedValidators(dir, statePath);
      const runner: StepRunner = { run: vi.fn(async (step: StepName) => {
        if (step === 'manual_test') {
          await writeFile(join(dir, '.pipeline/manual-test-results.md'), '# Results\n\n| Story | Result |\n|--|--|\n| s1 | FAIL |\n');
        }
        if (step === 'prd_audit') throw new Error('sibling crashed');
        if (step === 'architecture_review_as_built') {
          await writeFile(join(dir, '.pipeline/architecture-review-as-built.md'), '# Review\n\nVerdict: APPROVED\n');
        }
        return { success: true } as StepRunResult;
      }) };
      const conductor = new Conductor({
        stateFilePath: statePath, events: new ConductorEventEmitter(), projectRoot: dir, mode: 'auto', daemon: true,
        verifyArtifacts: true, maxRetries: 1, fromStep: 'manual_test',
        stepRunner: runner,
      });
      await conductor.run();
      expect(runner.run).toHaveBeenCalledWith(
        'manual_test', expect.anything(), expect.anything(),
      );
      const result = await readState(statePath);
      if (!result.ok) throw result.error;
      const state = result.value as Record<string, unknown>;
      expect([state.manual_test, state.validation__manual_test]).not.toContain('done');
      expect([state.prd_audit, state.validation__prd_audit]).not.toContain('done');
      expect([state.architecture_review_as_built, state.validation__architecture_review_as_built])
        .toEqual(['done', 'done']);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('does not retain a passing sibling when its verdict-run-identity handshake fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'validation-handshake-retention-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedValidators(dir, statePath);
      const conductor = new Conductor({
        stateFilePath: statePath, events: new ConductorEventEmitter(), projectRoot: dir, mode: 'auto', daemon: true,
        verifyArtifacts: true, maxRetries: 1, fromStep: 'manual_test',
        stepRunner: { run: vi.fn(async (step: StepName) => {
          if (step === 'manual_test') await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
          if (step === 'prd_audit') throw new Error('sibling crashed');
          if (step === 'architecture_review_as_built') await writeFile(join(dir, '.pipeline/architecture-review-as-built.md'), '# Review\n\nVerdict: APPROVED\n');
          return { success: true } as StepRunResult;
        }) },
      });
      (conductor as unknown as {
        verdictDispatchHandshake(name: StepName): Promise<{ done: false; routeClass: 'absent'; reason: string } | undefined>;
      }).verdictDispatchHandshake = async (name) => name === 'manual_test'
        ? { done: false, routeClass: 'absent', reason: 'stale validation run identity' }
        : undefined;
      await conductor.run();
      const result = await readState(statePath);
      if (!result.ok) throw result.error;
      const state = result.value as Record<string, unknown>;
      expect([state.manual_test, state.validation__manual_test]).not.toContain('done');
      expect([state.prd_audit, state.validation__prd_audit]).not.toContain('done');
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
      const events = new ConductorEventEmitter();
      const completed: string[][] = [];
      events.on('parallel_completed', event => {
        if (event.type === 'parallel_completed') completed.push(event.branches);
      });
      const conductor = new Conductor({
        stateFilePath: statePath, events, projectRoot: dir, mode: 'auto', daemon: true,
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
      if (!result.ok) throw result.error;
      const state = result.value as Record<string, unknown>;
      expect([state.manual_test, state.prd_audit, state.architecture_review_as_built,
        state.validation__manual_test, state.validation__prd_audit, state.validation__architecture_review_as_built])
        .toEqual(['done', 'done', 'done', 'done', 'done', 'done']);
      expect(completed).toEqual([['manual_test']]);
      const redispatchStatuses = [state.manual_test, state.prd_audit, state.architecture_review_as_built,
        state.validation__manual_test, state.validation__prd_audit, state.validation__architecture_review_as_built];
      const beforeFresh = await readState(statePath);
      if (!beforeFresh.ok) throw beforeFresh.error;
      await writeState(statePath, {
        ...beforeFresh.value,
        manual_test: 'stale', prd_audit: 'stale', architecture_review_as_built: 'stale',
        validation__manual_test: 'stale', validation__prd_audit: 'stale', validation__architecture_review_as_built: 'stale',
      } as ConductState);
      await new Conductor({
        stateFilePath: statePath, events: new ConductorEventEmitter(), projectRoot: dir, mode: 'auto', daemon: true,
        verifyArtifacts: true, fromStep: 'manual_test',
        stepRunner: { run: vi.fn(async (step: StepName) => {
          if (step === 'manual_test') await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
          if (step === 'prd_audit') await writeFile(join(dir, '.pipeline/prd-audit.md'), PRD_PASS);
          if (step === 'architecture_review_as_built') await writeFile(join(dir, '.pipeline/architecture-review-as-built.md'), '# Review\n\nVerdict: APPROVED\n');
          return { success: true } as StepRunResult;
        }) },
      }).run();
      const fresh = await readState(statePath);
      if (!fresh.ok) throw fresh.error;
      const freshState = fresh.value as Record<string, unknown>;
      expect(redispatchStatuses).toEqual([freshState.manual_test, freshState.prd_audit, freshState.architecture_review_as_built,
        freshState.validation__manual_test, freshState.validation__prd_audit, freshState.validation__architecture_review_as_built]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('retries a re-dispatched member once and then completes without a loop halt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'validation-retained-retry-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedValidators(dir, statePath, {
        manual_test: 'failed', prd_audit: 'done', architecture_review_as_built: 'done',
        validation__prd_audit: 'done', validation__architecture_review_as_built: 'done', rebase: 'done', finish: 'done',
      });
      let attempts = 0;
      const halts: ConductorEvent[] = [];
      const events = new ConductorEventEmitter();
      events.on('loop_halt', event => { halts.push(event); });
      await new Conductor({
        stateFilePath: statePath, events, projectRoot: dir, mode: 'auto', daemon: true,
        verifyArtifacts: true, maxRetries: 2, fromStep: 'manual_test',
        stepRunner: { run: vi.fn(async (step: StepName) => {
          if (step === 'manual_test' && ++attempts === 1) throw new Error('transient runner failure');
          if (step === 'manual_test') await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
          return { success: true } as StepRunResult;
        }) },
      }).run();
      expect(attempts).toBe(2);
      expect(halts).toEqual([]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('restages a retained done member through a build kickback and dispatches it in the next group round', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'validation-retained-kickback-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedValidators(dir, statePath, {
        manual_test: 'done', prd_audit: 'done', architecture_review_as_built: 'done',
        validation__manual_test: 'done', validation__prd_audit: 'done', validation__architecture_review_as_built: 'done',
        rebase: 'done', finish: 'done',
      });
      const seeded = await readState(statePath);
      if (!seeded.ok) throw seeded.error;
      const calls: StepName[] = [];
      const runner: StepRunner = { run: vi.fn(async (step: StepName) => {
        calls.push(step);
        if (step === 'manual_test') await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
        if (step === 'prd_audit') await writeFile(join(dir, '.pipeline/prd-audit.md'), PRD_PASS);
        if (step === 'architecture_review_as_built') await writeFile(join(dir, '.pipeline/architecture-review-as-built.md'), '# Review\n\nVerdict: APPROVED\n');
        return { success: true } as StepRunResult;
      }) };
      const conductor = new Conductor({
        stateFilePath: statePath, events: new ConductorEventEmitter(), projectRoot: dir, mode: 'auto', daemon: true,
        verifyArtifacts: true, fromStep: 'manual_test', stepRunner: runner,
      });
      await (conductor as unknown as {
        navigateStateBack(state: ConductState, target: StepName, steps: typeof ALL_STEPS): Promise<number>;
      }).navigateStateBack(seeded.value, 'build', ALL_STEPS);
      const restaged = await readState(statePath);
      if (!restaged.ok) throw restaged.error;
      expect(restaged.value.manual_test).toBe('stale');
      await conductor.run();
      expect(calls.filter(step => step === 'manual_test')).toEqual(['manual_test']);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('restages and re-dispatches a retained member after a file-changing rebase invalidates its gate', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'validation-retained-rebase-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedValidators(dir, statePath, {
        manual_test: 'done', prd_audit: 'done', architecture_review_as_built: 'done',
        validation__manual_test: 'done', validation__prd_audit: 'done', validation__architecture_review_as_built: 'done',
        rebase: 'done', finish: 'done',
      });
      const outcome: RebaseOutcome = {
        kind: 'changed', changedCodePaths: ['src/feature.ts'], allChangedPaths: ['src/feature.ts'], featureSurface: ['src/feature.ts'],
      };
      await applyRebaseVerdicts(dir, outcome, true);
      const seeded = await readState(statePath);
      if (!seeded.ok) throw seeded.error;
      const calls: StepName[] = [];
      const runner: StepRunner = { run: vi.fn(async (step: StepName) => {
        calls.push(step);
        if (step === 'coverage_binding') await writeFile(join(dir, '.pipeline/coverage-binding.json'), JSON.stringify({ version: 1, slug: 'one-transient-failure-in-a-validation-group-member', runId: 'test-run', status: 'disabled', entries: [] }));
        if (step === 'manual_test') await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
        if (step === 'prd_audit') await writeFile(join(dir, '.pipeline/prd-audit.md'), PRD_PASS);
        if (step === 'architecture_review_as_built') await writeFile(join(dir, '.pipeline/architecture-review-as-built.md'), '# Review\n\nVerdict: APPROVED\n');
        return { success: true } as StepRunResult;
      }) };
      const conductor = new Conductor({
        stateFilePath: statePath, events: new ConductorEventEmitter(), projectRoot: dir, mode: 'auto', daemon: true,
        verifyArtifacts: true, fromStep: 'manual_test', stepRunner: runner,
      });
      const rebaseTail = conductor as unknown as {
        lastRebaseOutcome: RebaseOutcome;
        advanceTail(step: (typeof ALL_STEPS)[number], state: ConductState, stuckGate: Map<StepName, number>, steps: typeof ALL_STEPS, indexOf: (name: StepName) => number): Promise<number | null | 'halt'>;
      };
      rebaseTail.lastRebaseOutcome = outcome;
      const rebase = ALL_STEPS.find((step) => step.name === 'rebase');
      if (!rebase) throw new Error('rebase step must be registered');
      await rebaseTail.advanceTail(rebase, seeded.value, new Map(), ALL_STEPS, (name) => ALL_STEPS.findIndex((step) => step.name === name));
      const restaged = await readState(statePath);
      if (!restaged.ok) throw restaged.error;
      expect(restaged.value.prd_audit).toBe('pending');
      await writeState(statePath, {
        ...restaged.value,
        acceptance_specs: 'skipped', coverage_binding: 'done', build: 'done', test_suite: 'skipped', build_review: 'skipped', manual_test: 'done',
      } as ConductState);
      await Promise.all(['build', 'test_suite', 'build_review', 'manual_test'].map((step) =>
        writeVerdict(dir, step as StepName, { satisfied: true, checkedAt: Date.now() }),
      ));
      await new Conductor({
        stateFilePath: statePath, events: new ConductorEventEmitter(), projectRoot: dir, mode: 'auto', daemon: true,
        verifyArtifacts: true, fromStep: 'manual_test', stepRunner: runner,
      }).run();
      expect(calls.filter(step => step === 'prd_audit')).toEqual(['prd_audit']);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('keeps retained siblings done when the re-dispatched member halts a second time', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'validation-second-halt-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedValidators(dir, statePath, {
        manual_test: 'failed', prd_audit: 'done', architecture_review_as_built: 'done',
        validation__prd_audit: 'done', validation__architecture_review_as_built: 'done', rebase: 'done', finish: 'done',
      });
      await new Conductor({
        stateFilePath: statePath, events: new ConductorEventEmitter(), projectRoot: dir, mode: 'auto', daemon: true,
        verifyArtifacts: true, maxRetries: 2, fromStep: 'manual_test',
        stepRunner: { run: vi.fn(async (step: StepName) => {
          if (step === 'manual_test') throw new Error('second-round crash');
          return { success: true } as StepRunResult;
        }) },
      }).run();
      const result = await readState(statePath);
      if (!result.ok) throw result.error;
      const state = result.value as Record<string, unknown>;
      expect([state.prd_audit, state.validation__prd_audit, state.architecture_review_as_built, state.validation__architecture_review_as_built])
        .toEqual(['done', 'done', 'done', 'done']);
      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf8');
      expect(halt).toContain('manual_test');
      expect(halt).not.toContain('prd_audit');
      expect(halt).not.toContain('architecture_review_as_built');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it.each([
    ['permission denial', 'manual_test', {
      prd_audit: 'done', architecture_review_as_built: 'done',
      validation__prd_audit: 'done', validation__architecture_review_as_built: 'done',
    }],
    ['PLAN_GAP halt', 'prd_audit', {
      manual_test: 'done', architecture_review_as_built: 'done',
      validation__manual_test: 'done', validation__architecture_review_as_built: 'done',
    }],
    ['manual-test no-op cap', 'manual_test', {
      prd_audit: 'done', architecture_review_as_built: 'done',
      validation__prd_audit: 'done', validation__architecture_review_as_built: 'done',
    }],
  ] as const)('closes a retained width-one group after a %s', async (route, entry, retained) => {
    const dir = await mkdtemp(join(tmpdir(), 'validation-retained-terminal-'));
    const statePath = join(dir, 'conduct-state.json');
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(dir, '.pipeline/events.jsonl'), events);
    persister.start();
    try {
      await seedValidators(dir, statePath, retained);
      if (route === 'manual-test no-op cap') {
        await writeFile(join(dir, '.pipeline/kickback-ledger.json'), JSON.stringify({
          version: 1,
          gates: {
            manual_test: {
              count: 1, treeHash: null, lastReason: 'prior validation kickback',
              priorVerdict: false, resolvedBefore: 1,
            },
          },
        }));
      }
      const conductor = new Conductor({
        stateFilePath: statePath, events, projectRoot: dir, mode: 'auto', daemon: true,
        verifyArtifacts: true, maxRetries: 1, fromStep: entry,
        stepRunner: { run: vi.fn(async (step: StepName) => {
          if (route === 'permission denial' && step === 'manual_test') {
            return {
              success: false, permissionDenied: true, actualProvider: 'codex',
              output: 'permission denied',
              authentication: { provider: 'codex', source: 'api-key', state: 'ready' },
            } as StepRunResult;
          }
          if (route === 'manual-test no-op cap' && step === 'manual_test') {
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), '# Results\n\n| Story | Result |\n|--|--|\n| s1 | FAIL |\n');
          }
          if (route === 'PLAN_GAP halt' && step === 'prd_audit') {
            await writeFile(join(dir, '.pipeline/prd-audit.md'), PRD_PASS);
          }
          return { success: true } as StepRunResult;
        }) },
      });
      if (route === 'PLAN_GAP halt') {
        (conductor as unknown as { routeCurrentPrdAudit: () => Promise<unknown> }).routeCurrentPrdAudit = async () => ({
          kind: 'plan-gap-halt', route: { kind: 'halt', haltClass: 'plan-gap', detail: 'unowned PLAN_GAP', findings: [] },
        });
      }
      await conductor.run();
      const ledger = (await readFile(join(dir, '.pipeline/events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
      const terminals = ledger.filter((event) =>
        event.type === 'parallel_failure' && event.step === entry,
      );
      expect(terminals).toHaveLength(1);
      expect(terminals[0]).toMatchObject({
        branch: 'conductor', activeInterval: expect.any(Object),
        error: 'validation group round exited without a join terminal',
      });
      expect(await computeTimingRollup(dir)).not.toMatchObject({
        state: 'partial', reason: `open-executions:parallel:${entry}`,
      });
    } finally {
      persister.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ['no-verdict', async (dir: string, step: StepName) => {
      if (step === 'manual_test') throw new Error('validator crashed');
      return { success: true } as StepRunResult;
    }],
    ['all-green', async (dir: string, step: StepName) => {
      if (step === 'manual_test') await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
      return { success: true } as StepRunResult;
    }],
  ] as const)('keeps exactly one terminal for retained width-one %s rounds', async (_route, run) => {
    const dir = await mkdtemp(join(tmpdir(), 'validation-retained-existing-terminal-'));
    const statePath = join(dir, 'conduct-state.json');
    const events: ConductorEvent[] = [];
    const emitter = new ConductorEventEmitter();
    emitter.on('parallel_failure', event => { events.push(event); });
    emitter.on('parallel_completed', event => { events.push(event); });
    try {
      await seedValidators(dir, statePath, {
        prd_audit: 'done', architecture_review_as_built: 'done',
        validation__prd_audit: 'done', validation__architecture_review_as_built: 'done',
      });
      await new Conductor({
        stateFilePath: statePath, events: emitter, projectRoot: dir, mode: 'auto', daemon: true,
        verifyArtifacts: true, maxRetries: 1, fromStep: 'manual_test',
        stepRunner: { run: (step) => run(dir, step) },
      }).run();
      expect(events.filter(event =>
        (event.type === 'parallel_failure' || event.type === 'parallel_completed') && event.step === 'manual_test',
      )).toHaveLength(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
