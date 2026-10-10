// Covers: task:2, task:3
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor } from '../test-conductor.js';
import type { StepRunner, StepRunOptions } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { readState, writeState } from '../../src/engine/state.js';
import { persistAsBuiltVerdict } from '../../src/engine/as-built-verdict-store.js';
import { persistPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';
import type { AsBuiltPolicy } from '../../src/engine/as-built-policy.js';
import type { ConductState, ConductorEvent, StepName } from '../../src/types/index.js';

const AS_BUILT_POLICY: AsBuiltPolicy = {
  reachability: { enabled: true, reason: 'fixture' },
  planGap: { enabled: true, reason: 'fixture' },
  adrCompliance: { enabled: false, reason: 'fixture' },
  diagramDrift: { enabled: false, reason: 'fixture' },
};

const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(): Promise<{ dir: string; statePath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'validation-group-handshake-retry-'));
  fixtures.push(dir);
  const statePath = join(dir, 'conduct-state.json');
  const state: Record<string, unknown> = {};
  for (const step of ALL_STEPS) {
    if (step.name === 'manual_test') break;
    state[step.name] = 'done';
  }
  Object.assign(state, {
    complexity_tier: 'M', track: 'product', feature_desc: 'validation-group-handshake-retry',
    build_review: 'done', rebase: 'done', finish: 'done',
  });
  await writeState(statePath, state as ConductState);
  await mkdir(join(dir, '.pipeline'), { recursive: true });
  await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }));
  return { dir, statePath };
}

async function writePrdPass(dir: string, options?: StepRunOptions): Promise<void> {
  await persistPrdAuditVerdict(dir, {
    complete: true,
    judgment: {
      version: 'v1',
      criterionJudgments: [{
        criterion: { storyId: '1', ordinal: 1 }, criterionId: 'S1.1', grade: 'PASS',
        evidence: 'fixture:1', rationale: 'fixture current verdict', requirementAssociations: [], evidenceTaskIds: [],
      }],
      noOwnerObservations: [],
    },
    diagnostics: [], recordedDispositions: [],
  }, { attemptId: options?.runId ?? 'fixture-run', codeStamp: 'fixture-head' });
}

async function writeAsBuiltPass(dir: string, options?: StepRunOptions): Promise<void> {
  await persistAsBuiltVerdict(dir, {
    version: 'v2', verdict: 'APPROVED', reachability: [], driftNotes: [],
  }, { attemptId: options?.runId ?? 'fixture-run', codeStamp: null, policy: AS_BUILT_POLICY });
}

describe('validation-group dispatch handshake retries', () => {
  it('retries only a stale prd_audit dispatch and completes the validation group after its fresh verdict', async () => {
    const { dir, statePath } = await fixture();
    const calls: StepName[] = [];
    const events: ConductorEvent[] = [];
    const emitter = new ConductorEventEmitter();
    for (const type of ['step_retry', 'loop_halt', 'kickback'] as const) emitter.on(type, (event) => events.push(event));
    let prdAttempts = 0;
    const runner: StepRunner = {
      run: vi.fn(async (step, _state, options) => {
        calls.push(step);
        if (step === 'manual_test') {
          await writeFile(join(dir, '.pipeline/manual-test-results.md'), '# Results\n\n| Story | Result |\n|--|--|\n| s1 | PASS |\n');
        } else if (step === 'prd_audit') {
          prdAttempts += 1;
          if (prdAttempts === 2) await writePrdPass(dir, options);
        } else if (step === 'architecture_review_as_built') {
          await writeAsBuiltPass(dir, options);
        }
        return { success: true };
      }),
    };

    await new Conductor({
      projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events: emitter,
      fromStep: 'manual_test', mode: 'auto', daemon: true, verifyArtifacts: true,
      config: { gate_code_validity: { enabled: false }, defaults: { max_retries: 2 } },
    }).run();

    expect(calls.filter((step) => step === 'prd_audit')).toHaveLength(2);
    expect(calls.filter((step) => step === 'manual_test')).toHaveLength(1);
    expect(calls.filter((step) => step === 'architecture_review_as_built')).toHaveLength(1);
    const result = await readState(statePath);
    expect(result.ok && result.value).toMatchObject({
      manual_test: 'done', prd_audit: 'done', architecture_review_as_built: 'done',
      validation__manual_test: 'done', validation__prd_audit: 'done', validation__architecture_review_as_built: 'done',
    });
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).rejects.toThrow();
    expect(events.filter((event) => event.type === 'kickback')).toHaveLength(0);
    expect(events.filter((event) => event.type === 'loop_halt')).toHaveLength(0);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'step_retry', step: 'prd_audit', reason: expect.stringContaining('produced no verdict'),
    }));
  });

  it.each(['manual_test', 'prd_audit', 'architecture_review_as_built'] as const)(
    'includes the %s handshake reason in its retry event',
    async (member) => {
      const { dir, statePath } = await fixture();
      const retries: ConductorEvent[] = [];
      const emitter = new ConductorEventEmitter();
      emitter.on('step_retry', (event) => retries.push(event));
      const runner: StepRunner = { run: vi.fn(async () => ({ success: true })) };
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events: emitter,
        fromStep: 'manual_test', mode: 'auto', daemon: true, verifyArtifacts: true,
        config: { gate_code_validity: { enabled: false }, defaults: { max_retries: 2 } },
      });
      (conductor as unknown as { verdictDispatchHandshake(step: StepName): Promise<{ done: false; routeClass: 'absent'; reason: string } | undefined> }).verdictDispatchHandshake =
        async (step) => step === member ? { done: false, routeClass: 'absent', reason: `${member} handshake absent` } : undefined;

      await conductor.run();

      expect(retries).toContainEqual(expect.objectContaining({
        type: 'step_retry', step: member, reason: expect.stringContaining(`${member} handshake absent`),
      }));
    },
  );

  it('keeps verification-off validation members dispatch-success-only', async () => {
    const { dir, statePath } = await fixture();
    const calls: StepName[] = [];
    const conductor = new Conductor({
      projectRoot: dir, stateFilePath: statePath,
      stepRunner: { run: vi.fn(async (step) => {
        calls.push(step);
        return { success: true };
      }) },
      events: new ConductorEventEmitter(), fromStep: 'manual_test', mode: 'auto', daemon: true,
      verifyArtifacts: false, config: { defaults: { max_retries: 2 } },
    });
    const handshake = vi.spyOn(conductor as unknown as {
      verdictDispatchHandshake: (step: StepName) => Promise<{ done: false; routeClass: 'absent'; reason: string }>;
    }, 'verdictDispatchHandshake').mockResolvedValue({ done: false, routeClass: 'absent', reason: 'missing verdict' });

    await conductor.run();

    for (const member of ['manual_test', 'prd_audit', 'architecture_review_as_built'] as const) {
      expect(calls.filter((step) => step === member)).toHaveLength(1);
    }
    expect(handshake).toHaveBeenCalledTimes(3);
    const result = await readState(statePath);
    expect(result.ok && result.value).toMatchObject({
      manual_test: 'done', prd_audit: 'done', architecture_review_as_built: 'done',
    });
  });

  it('observes a failed prd_audit dispatch at terminal settlement', async () => {
    const { dir, statePath } = await fixture();
    const emitter = new ConductorEventEmitter();
    const conductor = new Conductor({
      projectRoot: dir, stateFilePath: statePath,
      stepRunner: { run: vi.fn(async (step) => step === 'prd_audit' ? { success: false, output: 'audit failed' } : { success: true }) },
      events: emitter, fromStep: 'manual_test', mode: 'auto', daemon: true, verifyArtifacts: true,
      config: { gate_code_validity: { enabled: false }, defaults: { max_retries: 1 } },
    });
    const handshake = vi.spyOn(conductor as unknown as { verdictDispatchHandshake: (step: StepName) => Promise<undefined> }, 'verdictDispatchHandshake')
      .mockResolvedValue(undefined);

    await conductor.run();

    expect(handshake).toHaveBeenCalledWith('prd_audit', expect.any(String), expect.any(Number), 'audit failed');
  });

  it.each([2, 1])(
    'halts after %i prd_audit success-without-verdict attempt(s), retaining its satisfied validation siblings',
    async (maxRetries) => {
      const { dir, statePath } = await fixture();
      const calls: StepName[] = [];
      const events: ConductorEvent[] = [];
      const emitter = new ConductorEventEmitter();
      for (const type of ['kickback', 'loop_halt'] as const) emitter.on(type, (event) => events.push(event));
      const runner: StepRunner = {
        run: vi.fn(async (step, _state, options) => {
          calls.push(step);
          if (step === 'manual_test') {
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), '# Results\n\n| Story | Result |\n|--|--|\n| s1 | PASS |\n');
          } else if (step === 'prd_audit') {
            await writePrdPass(dir, options);
          } else if (step === 'architecture_review_as_built') {
            await writeAsBuiltPass(dir, options);
          }
          return { success: true };
        }),
      };
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events: emitter,
        fromStep: 'manual_test', mode: 'auto', daemon: true, verifyArtifacts: true,
        config: { gate_code_validity: { enabled: false }, defaults: { max_retries: maxRetries } },
      });
      const commitStateChanges = vi.spyOn(conductor as unknown as {
        commitStateChanges: (
          state: ConductState,
          name: string,
          changes: Record<string, unknown>,
        ) => Promise<void>;
      }, 'commitStateChanges');
      vi.spyOn(conductor as unknown as {
        verdictDispatchHandshake: (step: StepName) => Promise<{
          done: false;
          routeClass: 'absent';
          reason: string;
        } | undefined>;
      }, 'verdictDispatchHandshake').mockImplementation(async (step) =>
        step === 'prd_audit'
          ? {
              done: false,
              routeClass: 'absent',
              reason: 'post-dispatch verdict write handshake failed for prd_audit: fixture verdict is stale',
            }
          : undefined,
      );

      await conductor.run();

      expect(calls.filter((step) => step === 'prd_audit')).toHaveLength(maxRetries);
      expect(calls.filter((step) => step === 'manual_test')).toHaveLength(1);
      expect(calls.filter((step) => step === 'architecture_review_as_built')).toHaveLength(1);
      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf8');
      expect(halt).toContain('branch "prd_audit"');
      expect(halt).toContain(`after ${maxRetries} attempts`);
      expect(halt).toContain('produced no-verdict');
      expect(halt).toContain('post-dispatch verdict write handshake failed for prd_audit');
      await expect(readFile(join(dir, '.pipeline/HALT.class'), 'utf8')).resolves.toBe('needs-human');
      expect(commitStateChanges).toHaveBeenCalledWith(
        expect.anything(),
        'fail manual_test validation group',
        expect.objectContaining({
          manual_test: 'done', validation__manual_test: 'done',
          architecture_review_as_built: 'done', validation__architecture_review_as_built: 'done',
          prd_audit: 'failed', last_step: 'manual_test',
        }),
      );
      expect(events.filter((event) => event.type === 'kickback')).toHaveLength(0);
      expect(events.filter((event) => event.type === 'loop_halt')).toHaveLength(1);
      expect(calls).not.toContain('remediate');
      expect((await readKickbackLedger(dir)).gates.prd_audit).toBeUndefined();
    },
  );
});
