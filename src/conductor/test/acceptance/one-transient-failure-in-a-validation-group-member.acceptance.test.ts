// Covers: S1.1, S1.2, S1.3, S1.4, S2.1, S2.2, S2.6, S2.8, task:2, task:3, task:4, task:5
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
import { ALL_STEPS } from '../../src/engine/steps.js';
import { startFeatureEventPersistence } from '../../src/engine/event-persister.js';
import { computeTimingRollup } from '../../src/engine/timing-rollup.js';
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
const MT_FAIL = '# Results\n\n| Story | Result |\n|--|--|\n| s1 | FAIL |\n';

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
  it('closes the persisted validation-group execution when a member produces no verdict', async () => {
    const dir = await mkdtemp(join(process.env.TMPDIR!, 'validation-no-verdict-timing-'));
    const statePath = join(dir, 'conduct-state.json');
    const globalEvents = new ConductorEventEmitter();
    const persistence = startFeatureEventPersistence(dir, globalEvents);
    try {
      await seedValidators(dir, statePath);
      const conductor = new Conductor({
        stateFilePath: statePath,
        events: persistence.events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
        fromStep: 'manual_test',
        stepRunner: { run: vi.fn(async (step: StepName) => {
          if (step === 'manual_test') throw new Error('validator process exited without a verdict');
          if (step === 'prd_audit') await writeFile(join(dir, '.pipeline/prd-audit.md'), PRD_PASS);
          if (step === 'architecture_review_as_built') {
            await writeFile(join(dir, '.pipeline/architecture-review-as-built.md'), '# Review\n\nVerdict: APPROVED\n');
          }
          return { success: true } as StepRunResult;
        }) },
      });

      await conductor.run();

      const ledger = (await readFile(join(dir, '.pipeline/events.jsonl'), 'utf8'))
        .split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
      const parallelFailures = ledger.filter((event) => event.type === 'parallel_failure');
      expect(parallelFailures).toEqual([expect.objectContaining({
        step: 'manual_test',
        branch: 'manual_test',
        activeInterval: expect.any(Object),
      })]);
      expect(ledger.filter((event) => event.type === 'step_failed')).toHaveLength(1);
      await expect(computeTimingRollup(dir)).resolves.not.toMatchObject({
        state: 'partial',
        reason: expect.stringMatching(/^open-executions:/),
      });
    } finally {
      persistence.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

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
      emitter.on('loop_halt', event => { events.push(event); });
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
      if (!result.ok) throw result.error;
      const state = result.value as Record<string, unknown>;
      expect(result.ok && result.value.prd_audit).not.toBe('done');
      expect(state.validation__prd_audit).not.toBe('done');
      expect([state.manual_test, state.validation__manual_test]).not.toContain('done');
      expect([state.architecture_review_as_built, state.validation__architecture_review_as_built])
        .toEqual(['done', 'done']);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('does not retain manual_test when its successful dispatch writes FAIL rows', async () => {
    const dir = await mkdtemp(join(process.env.TMPDIR!, 'validation-manual-test-fail-rows-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedValidators(dir, statePath);
      const conductor = new Conductor({
        stateFilePath: statePath, events: new ConductorEventEmitter(), projectRoot: dir, mode: 'auto', daemon: true,
        verifyArtifacts: true, maxRetries: 1, fromStep: 'manual_test',
        stepRunner: { run: vi.fn(async (step: StepName) => {
          if (step === 'manual_test') await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_FAIL);
          if (step === 'prd_audit') throw new Error('sibling crashed');
          if (step === 'architecture_review_as_built') await writeFile(join(dir, '.pipeline/architecture-review-as-built.md'), '# Review\n\nVerdict: APPROVED\n');
          return { success: true } as StepRunResult;
        }) },
      });
      await conductor.run();
      const result = await readState(statePath);
      if (!result.ok) throw result.error;
      const state = result.value as Record<string, unknown>;
      expect([state.manual_test, state.validation__manual_test]).not.toContain('done');
      expect([state.prd_audit, state.validation__prd_audit]).not.toContain('done');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('does not retain a passing sibling when its verdict-run-identity handshake fails', async () => {
    const dir = await mkdtemp(join(process.env.TMPDIR!, 'validation-handshake-retention-'));
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
      // Width-one completion persists the join-equivalent synthetic key without
      // turning that synthetic key into the resume anchor.
      expect(state.last_step).toBe('manual_test');
      // Width-one preserves serial events, so it does not fabricate a
      // parallel_completed event while still converging to join-equivalent state.
      expect(completed).toEqual([]);
      const redispatchStatuses = [state.manual_test, state.prd_audit, state.architecture_review_as_built,
        state.validation__manual_test, state.validation__prd_audit, state.validation__architecture_review_as_built];
      // A fresh all-green group reaches the same six durable member statuses.
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
        validation__prd_audit: 'done', validation__architecture_review_as_built: 'done',
        rebase: 'done', finish: 'done',
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
      const result = await readState(statePath);
      if (!result.ok) throw result.error;
      expect((result.value as Record<string, unknown>).validation__manual_test).toBe('done');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('restages a retained done member through the skip-preserving kickback helper and dispatches it again', async () => {
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
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          calls.push(step);
          if (step === 'manual_test') await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
          if (step === 'prd_audit') await writeFile(join(dir, '.pipeline/prd-audit.md'), PRD_PASS);
          if (step === 'architecture_review_as_built') await writeFile(join(dir, '.pipeline/architecture-review-as-built.md'), '# Review\n\nVerdict: APPROVED\n');
          return { success: true } as StepRunResult;
        }),
      };
      const conductor = new Conductor({
        stateFilePath: statePath, events: new ConductorEventEmitter(), projectRoot: dir, mode: 'auto', daemon: true,
        verifyArtifacts: true, fromStep: 'manual_test',
        stepRunner: runner,
      });
      // A build kickback takes this exact skip-preserving navigation path.
      // Calling the owning seam prevents a manual state edit from masking a
      // regression in markDownstreamStale's retained-member restage.
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

  it('restages and re-dispatches a retained member after post-rebase invalidation touches its gate surface', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'validation-retained-rebase-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedValidators(dir, statePath, {
        manual_test: 'done', prd_audit: 'done', architecture_review_as_built: 'done',
        validation__manual_test: 'done', validation__prd_audit: 'done', validation__architecture_review_as_built: 'done',
        rebase: 'done', finish: 'done',
      });
      const outcome: RebaseOutcome = {
        kind: 'changed',
        // The rebase delta overlaps the retained PRD-audit member's declared
        // feature-runtime surface, so this is an ordinary selective
        // invalidation rather than the uncomputable fail-closed fallback.
        changedCodePaths: ['src/feature.ts'],
        allChangedPaths: ['src/feature.ts'],
        featureSurface: ['src/feature.ts'],
      };
      await applyRebaseVerdicts(dir, outcome, true);
      const seeded = await readState(statePath);
      if (!seeded.ok) throw seeded.error;
      const calls: StepName[] = [];
      const runner: StepRunner = { run: vi.fn(async (step: StepName) => {
        calls.push(step);
        if (step === 'coverage_binding') await writeFile(
          join(dir, '.pipeline/coverage-binding.json'),
          JSON.stringify({ version: 1, slug: 'one-transient-failure-in-a-validation-group-member', runId: 'test-run', status: 'disabled', entries: [] }),
        );
        if (step === 'manual_test') await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
        if (step === 'prd_audit') await writeFile(join(dir, '.pipeline/prd-audit.md'), PRD_PASS);
        if (step === 'architecture_review_as_built') await writeFile(join(dir, '.pipeline/architecture-review-as-built.md'), '# Review\n\nVerdict: APPROVED\n');
        return { success: true } as StepRunResult;
      }) };
      const conductor = new Conductor({
        stateFilePath: statePath, events: new ConductorEventEmitter(), projectRoot: dir, mode: 'auto', daemon: true,
        verifyArtifacts: true, fromStep: 'manual_test',
        stepRunner: runner,
      });
      // Exercise the same rebase-tail branch that consumes the invalidation
      // verdicts and invokes navigateStateBack; do not manufacture a stale
      // state directly in this test.
      const rebaseTail = conductor as unknown as {
        lastRebaseOutcome: RebaseOutcome;
        advanceTail(
          step: (typeof ALL_STEPS)[number],
          state: ConductState,
          stuckGate: Map<StepName, number>,
          steps: typeof ALL_STEPS,
          indexOf: (name: StepName) => number,
        ): Promise<number | null | 'halt'>;
      };
      rebaseTail.lastRebaseOutcome = outcome;
      const rebase = ALL_STEPS.find((step) => step.name === 'rebase');
      if (!rebase) throw new Error('rebase step must be registered');
      await rebaseTail.advanceTail(
        rebase,
        seeded.value,
        new Map(),
        ALL_STEPS,
        (name) => ALL_STEPS.findIndex((step) => step.name === name),
      );
      const restaged = await readState(statePath);
      if (!restaged.ok) throw restaged.error;
      expect(restaged.value.prd_audit).toBe('pending');
      // A real rebase replays the earlier BUILD gates before this validation
      // round. Model their already-green replay here, while retaining the
      // actual post-rebase transition's pending PRD-audit member.
      await writeState(statePath, {
        ...restaged.value,
        acceptance_specs: 'skipped', coverage_binding: 'done', build: 'done', test_suite: 'skipped', build_review: 'skipped', manual_test: 'done',
      } as ConductState);
      await Promise.all(['build', 'test_suite', 'build_review', 'manual_test'].map((step) =>
        writeVerdict(dir, step as StepName, { satisfied: true, checkedAt: Date.now() }),
      ));
      // A fresh run reads the state persisted by the real rebase-tail
      // transition, just as daemon re-dispatch does after that transition.
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
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
