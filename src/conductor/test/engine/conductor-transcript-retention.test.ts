// Covers: task:12, task:18, task:rem-prd-audit-rem-vg-S2.10, task:rem-prd-audit-rem-vg-S6.2, task:rem-prd-audit-rem-vg-S6.4, task:rem-prd-audit-R2, task:rem-prd-audit-R3, task:rem-as-built-rem-ab-capture-dispatch-seq, task:rem-as-built-rem-ab-settle-by-dispatch, task:rem-prd-audit-rem-settle-aux-captures-per-dispatch
import { describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Conductor } from '../../src/engine/conductor.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { executeProviderCandidates, type ProviderExecutionContext } from '../../src/engine/provider-execution.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionScope } from '../../src/engine/provider-session.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { providerDescriptor } from '../../src/execution/provider-catalog.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS, VALIDATION_GROUP } from '../../src/engine/steps.js';
import type { StepRunner } from '../../src/engine/step-runner-types.js';
import type { SelfHostGuardrails } from '../../src/engine/self-host/wiring.js';
import { transcriptOwnerDirectory } from '../../src/engine/self-host/transcript-harvest.js';
import { transcriptOwnerStep, transcriptSettlementKey } from '../../src/engine/self-host/transcript-retention.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

// @ts-expect-error A rubric is a member identity, never a lifecycle StepName.
transcriptSettlementKey({ step: 'rubric-security', runId: 'review', attempt: 1 });

describe('conductor transcript retention wiring', () => {
  it('removes the retention capture listener when its run ends', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conductor-transcript-listener-cleanup-'));
    const events = new ConductorEventEmitter();
    const handlers = events as unknown as {
      handlers: Map<string, Set<unknown>>;
    };
    try {
      const conductor = new Conductor({
        projectRoot: root,
        stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
        events,
        stepRunner: { run: async () => ({ success: true }) },
      });

      expect(handlers.handlers.get('provider_transcripts_captured')).toHaveLength(1);

      await conductor.run();

      expect(handlers.handlers.get('provider_transcripts_captured')).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('constructs retention without overriding its production caps', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conductor-transcript-caps-'));
    try {
      const conductor = new Conductor({
        projectRoot: root,
        stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
        events: new ConductorEventEmitter(),
        stepRunner: { run: async () => ({ success: true }) },
      });
      const retention = (conductor as unknown as {
        transcriptRetention: { maxCaptures: number; maxBytes: number };
      }).transcriptRetention;

      expect(retention.maxCaptures).toBe(20);
      expect(retention.maxBytes).toBe(1_073_741_824);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('settles failed, stalled, halted, and non-build successful captures on the event spine', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conductor-transcript-retention-'));
    const events = new ConductorEventEmitter();
    new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      events,
      stepRunner: { run: async () => ({ success: true }) },
    });
    const capture = async (step: 'build' | 'test_suite', name: string) => {
      const path = join('.pipeline', 'transcripts', step, name);
      await mkdir(join(root, path), { recursive: true });
      await writeFile(join(root, path, 'session.jsonl'), '{}\n');
      await events.emit({ type: 'provider_transcripts_captured', step, runId: 'r', attempt: 1,
        provider: 'codex', path, files: 1, bytes: 3, interrupted: false, skipped: 0, omittedLines: 0 });
      return path;
    };
    try {
      const failed = await capture('build', 'failed');
      await events.emit({ type: 'step_failed', step: 'build', error: 'failed', retryCount: 1 });
      await expect(access(join(root, failed))).resolves.toBeUndefined();

      const stalled = await capture('build', 'stalled');
      await events.emit({ type: 'build_stall', step: 'build', reason: 'no_task_progress', resolvedBefore: 7, resolvedAfter: 7 });
      await expect(access(join(root, stalled))).resolves.toBeUndefined();

      const halted = await capture('build', 'halted');
      await events.emit({ type: 'loop_halt', step: 'build', reason: 'halted' });
      await expect(access(join(root, halted))).resolves.toBeUndefined();

      const completed = await capture('test_suite', 'completed');
      await events.emit({ type: 'step_completed', step: 'test_suite', status: 'done' });
      await expect(access(join(root, completed))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('retains a failed build_review member attempt and prunes only its successful retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conductor-transcript-member-retry-'));
    const events = new ConductorEventEmitter();
    const lifecycle: Array<{ type: string; path: string }> = [];
    events.on('provider_transcripts_retained', (event) => {
      if (event.type === 'provider_transcripts_retained') lifecycle.push(event);
    });
    events.on('provider_transcripts_pruned', (event) => {
      if (event.type === 'provider_transcripts_pruned') lifecycle.push(event);
    });
    new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      events,
      stepRunner: { run: async () => ({ success: true }), selfHostRunId: () => 'review' },
    });
    const first = join('.pipeline', 'transcripts', 'build_review', 'attempt-1');
    const second = join('.pipeline', 'transcripts', 'build_review', 'attempt-2');
    try {
      await mkdir(join(root, first), { recursive: true });
      await writeFile(join(root, first, 'session.jsonl'), '{}\n');
      await events.emit({
        type: 'provider_transcripts_captured', owner: { kind: 'configured-group-member', parentGroup: 'ship_validation', member: 'build_review' }, step: 'build_review', runId: 'review', attempt: 1,
        member: 'build_review', provider: 'codex', path: first, files: 1, bytes: 3,
        interrupted: false, skipped: 0, omittedLines: 0,
      });
      await events.emit({
        type: 'step_retry', step: 'build_review', attempt: 2, maxAttempts: 3, reason: 'retry',
        executionContext: {
          executionId: 'member-retry',
          subject: { kind: 'configured-member', parentGroup: 'ship_validation', member: 'build_review' },
        },
      });
      await mkdir(join(root, second), { recursive: true });
      await writeFile(join(root, second, 'session.jsonl'), '{}\n');
      await events.emit({
        type: 'provider_transcripts_captured', owner: { kind: 'configured-group-member', parentGroup: 'ship_validation', member: 'build_review' }, step: 'build_review', runId: 'review', attempt: 2,
        member: 'build_review', provider: 'codex', path: second, files: 1, bytes: 3,
        interrupted: false, skipped: 0, omittedLines: 0,
      });
      await events.emit({
        type: 'step_completed', step: 'manual_test', status: 'done',
        executionContext: {
          executionId: 'member-retry',
          subject: { kind: 'configured-member', parentGroup: 'ship_validation', member: 'build_review' },
        },
      });

      expect(lifecycle).toEqual([
        { type: 'provider_transcripts_retained', path: first },
        { type: 'provider_transcripts_pruned', path: second },
      ]);
      await expect(access(join(root, first))).resolves.toBeUndefined();
      await expect(access(join(root, second))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('retains every auxiliary build_review capture before an unscoped retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conductor-transcript-unscoped-review-retry-'));
    const events = new ConductorEventEmitter();
    const lifecycle: Array<{ type: string; path: string }> = [];
    events.on('provider_transcripts_retained', (event) => {
      if (event.type === 'provider_transcripts_retained') lifecycle.push(event);
    });
    events.on('provider_transcripts_pruned', (event) => {
      if (event.type === 'provider_transcripts_pruned') lifecycle.push(event);
    });
    new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      events,
      stepRunner: { run: async () => ({ success: true }), selfHostRunId: () => 'review' },
    });
    const captures = [
      { member: 'rubric-security', path: join('.pipeline', 'transcripts', 'build_review', 'security-attempt-1') },
      { member: 'rubric-quality', path: join('.pipeline', 'transcripts', 'build_review', 'quality-attempt-1') },
    ];
    try {
      for (const capture of captures) {
        await mkdir(join(root, capture.path), { recursive: true });
        await writeFile(join(root, capture.path, 'session.jsonl'), '{}\n');
        await events.emit({
          type: 'provider_transcripts_captured', step: 'build_review', runId: 'review', attempt: 1,
          member: capture.member, provider: 'codex', path: capture.path, files: 1, bytes: 3,
          interrupted: false, skipped: 0, omittedLines: 0,
        });
      }

      await events.emit({ type: 'step_retry', step: 'build_review', attempt: 2, maxAttempts: 3, reason: 'retry' });
      await events.emit({ type: 'step_completed', step: 'build_review', status: 'done' });

      expect(lifecycle).toEqual(captures.map(({ path }) => ({ type: 'provider_transcripts_retained', path })));
      for (const { path } of captures) await expect(access(join(root, path))).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('retains main and rubric captures from an earlier configured-member dispatch through its successful settle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conductor-transcript-configured-member-auxiliary-retry-'));
    const events = new ConductorEventEmitter();
    const retained: string[] = [];
    events.on('provider_transcripts_retained', (event) => {
      if (event.type === 'provider_transcripts_retained') retained.push(event.path);
    });
    new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      events,
      stepRunner: { run: async () => ({ success: true }), selfHostRunId: () => 'configured-member-retry' },
    });
    const main = join('.pipeline', 'transcripts', 'build_review', 'main-dispatch-1');
    const rubric = join('.pipeline', 'transcripts', 'build_review', 'rubric-dispatch-1');
    const executionContext = {
      executionId: 'configured-member-retry',
      subject: { kind: 'configured-member' as const, parentGroup: 'explore', member: 'build_review' },
    };
    try {
      for (const [path, owner, member] of [
        [main, { kind: 'registered-step' as const, step: 'build_review' }, undefined],
        [rubric, { kind: 'configured-group-member' as const, parentGroup: 'build_review', member: 'rubric-security' }, 'rubric-security'],
      ] as const) {
        await mkdir(join(root, path), { recursive: true });
        await writeFile(join(root, path, 'session.jsonl'), '{}\n');
        await events.emit({
          type: 'provider_transcripts_captured', owner, step: 'build_review', runId: 'configured-member-retry', attempt: 1,
          ...(member === undefined ? {} : { member }), provider: 'codex', path, files: 1, bytes: 3,
          interrupted: false, skipped: 0, omittedLines: 0,
        });
      }

      await events.emit({
        type: 'step_retry', step: 'explore', attempt: 1, maxAttempts: 2, reason: 'configured member retry', executionContext,
      });
      await events.emit({ type: 'step_completed', step: 'explore', status: 'done', executionContext });

      expect(retained).toEqual([main, rubric]);
      await expect(access(join(root, main))).resolves.toBeUndefined();
      await expect(access(join(root, rubric))).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('prunes every successful build_review rubric capture at its own identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conductor-transcript-rubric-success-'));
    const events = new ConductorEventEmitter();
    const pruned: string[] = [];
    events.on('provider_transcripts_pruned', (event) => {
      if (event.type === 'provider_transcripts_pruned') pruned.push(event.path);
    });
    new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      events,
      stepRunner: { run: async () => ({ success: true }), selfHostRunId: () => 'review' },
    });
    const captures = ['rubric-security', 'rubric-quality'].map((member) => ({
      member,
      path: join('.pipeline', 'transcripts', 'build_review', member),
    }));
    try {
      for (const capture of captures) {
        await mkdir(join(root, capture.path), { recursive: true });
        await writeFile(join(root, capture.path, 'session.jsonl'), '{}\n');
        await events.emit({
          type: 'provider_transcripts_captured', step: 'build_review', runId: 'review', attempt: 1,
          member: capture.member, provider: 'codex', path: capture.path, files: 1, bytes: 3,
          interrupted: false, skipped: 0, omittedLines: 0,
        });
      }

      await events.emit({ type: 'step_completed', step: 'build_review', status: 'done' });

      expect(pruned.sort()).toEqual(captures.map(({ path }) => path).sort());
      for (const { path } of captures) await expect(access(join(root, path))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('retains an interrupted dispatch capture in the same run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conductor-transcript-interrupted-'));
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
    persister.start();
    const retained: string[] = [];
    events.on('provider_transcripts_retained', (event) => {
      if (event.type === 'provider_transcripts_retained') retained.push(event.path);
    });
    new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      events,
      stepRunner: { run: async () => ({ success: true }), selfHostRunId: () => 'interrupted' },
    });
    const path = join('.pipeline', 'transcripts', 'build', 'interrupted');
    try {
      await mkdir(join(root, path), { recursive: true });
      await writeFile(join(root, path, 'session.jsonl'), '{}\n');
      await events.emit({
        type: 'provider_transcripts_captured', step: 'build', runId: 'interrupted', attempt: 1,
        provider: 'codex', path, files: 1, bytes: 3, interrupted: false, skipped: 0, omittedLines: 0,
      });
      await events.emit({ type: 'step_interrupted', step: 'build', reason: 'controlled shutdown' });

      expect(retained).toEqual([path]);
      await expect(access(join(root, path))).resolves.toBeUndefined();
      const ledger = (await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line) as { type: string; path?: string });
      expect(ledger).toEqual(expect.arrayContaining([expect.objectContaining({
        type: 'provider_transcripts_retained',
        path,
        ts: expect.any(String),
      })]));
    } finally {
      persister.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('retains earlier same-attempt captures through the configured-member retry dispatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conductor-transcript-configured-retry-'));
    const events = new ConductorEventEmitter();
    const lifecycle: Array<{ type: string; path: string }> = [];
    events.on('provider_transcripts_retained', (event) => {
      if (event.type === 'provider_transcripts_retained') lifecycle.push(event);
    });
    events.on('provider_transcripts_pruned', (event) => {
      if (event.type === 'provider_transcripts_pruned') lifecycle.push(event);
    });
    const state = { complexity_tier: 'M' } as never;
    await writeState(join(root, '.pipeline', 'conduct-state.json'), state);
    let dispatch = 0;
    const runner: StepRunner = {
      selfHostRunId: () => 'configured-retry',
      run: async (_step, _state, _options) => {
        dispatch += 1;
        const path = join('.pipeline', 'transcripts', 'build_review', `dispatch-${dispatch}`);
        await mkdir(join(root, path), { recursive: true });
        await writeFile(join(root, path, 'session.jsonl'), '{}\n');
        await events.emit({
          type: 'provider_transcripts_captured', owner: { kind: 'configured-group-member', parentGroup: 'explore', member: 'build_review' }, step: 'build_review', runId: 'configured-retry',
          // The group retry budget restarts at one; capture identity is the
          // directory/dispatch sequence, not this lifecycle attempt.
          attempt: 1, member: dispatch === 1 ? 'rubric-security' : 'build_review',
          provider: 'codex', path, files: 1, bytes: 3,
          interrupted: false, skipped: 0, omittedLines: 0,
        });
        if (dispatch === 1) {
          const rubricPath = join('.pipeline', 'transcripts', 'build_review', 'rubric-dispatch-1');
          await mkdir(join(root, rubricPath), { recursive: true });
          await writeFile(join(root, rubricPath, 'session.jsonl'), '{}\n');
          await events.emit({
            type: 'provider_transcripts_captured',
            owner: { kind: 'configured-group-member', parentGroup: 'build_review', member: 'rubric-security' },
            step: 'build_review', runId: 'configured-retry', attempt: 1, member: 'rubric-security',
            provider: 'codex', path: rubricPath, files: 1, bytes: 3,
            interrupted: false, skipped: 0, omittedLines: 0,
          });
        }
        return { success: dispatch === 2 };
      },
    };
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      events,
      stepRunner: runner,
      config: { steps: { explore: { max_retries: 2 } } } as never,
    });
    try {
      await (conductor as unknown as {
        runParallelGroupViaCore: (group: 'explore', branches: readonly { name: string }[], current: typeof state) => Promise<unknown>;
      }).runParallelGroupViaCore('explore', [{ name: 'build_review' }], state);

      expect(lifecycle).toEqual([
        { type: 'provider_transcripts_retained', path: join('.pipeline', 'transcripts', 'build_review', 'dispatch-1') },
        { type: 'provider_transcripts_retained', path: join('.pipeline', 'transcripts', 'build_review', 'rubric-dispatch-1') },
        { type: 'provider_transcripts_pruned', path: join('.pipeline', 'transcripts', 'build_review', 'dispatch-2') },
      ]);
      await expect(access(join(root, '.pipeline', 'transcripts', 'build_review', 'dispatch-1'))).resolves.toBeUndefined();
      await expect(access(join(root, '.pipeline', 'transcripts', 'build_review', 'rubric-dispatch-1'))).resolves.toBeUndefined();
      await expect(access(join(root, '.pipeline', 'transcripts', 'build_review', 'dispatch-2'))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('retains earlier same-attempt captures through the built-in validation-member retry dispatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conductor-transcript-validation-retry-'));
    const events = new ConductorEventEmitter();
    const lifecycle: Array<{ type: string; path: string }> = [];
    events.on('provider_transcripts_retained', (event) => {
      if (event.type === 'provider_transcripts_retained') lifecycle.push(event);
    });
    events.on('provider_transcripts_pruned', (event) => {
      if (event.type === 'provider_transcripts_pruned') lifecycle.push(event);
    });
    const retriedMember = VALIDATION_GROUP.members[0];
    const state = {
      ...Object.fromEntries(ALL_STEPS.map(({ name }) => [name, 'done'])),
      [retriedMember]: 'pending',
      complexity_tier: 'M',
      track: 'technical',
      feature_desc: 'transcript-validation-retry',
    } as never;
    await writeState(join(root, '.pipeline', 'conduct-state.json'), state);
    let retries = 0;
    const runner: StepRunner = {
      selfHostRunId: () => 'validation-retry',
      run: async (step) => {
        if (step !== retriedMember) return { success: true };
        retries += 1;
        const path = join('.pipeline', 'transcripts', retriedMember, `dispatch-${retries}`);
        await mkdir(join(root, path), { recursive: true });
        await writeFile(join(root, path, 'session.jsonl'), '{}\n');
        await events.emit({
          type: 'provider_transcripts_captured', step: retriedMember, runId: 'validation-retry',
          attempt: 1, provider: 'codex', path, files: 1, bytes: 3,
          interrupted: false, skipped: 0, omittedLines: 0,
        });
        if (retries === 1) {
          const rubricPath = join('.pipeline', 'transcripts', retriedMember, 'rubric-dispatch-1');
          await mkdir(join(root, rubricPath), { recursive: true });
          await writeFile(join(root, rubricPath, 'session.jsonl'), '{}\n');
          await events.emit({
            type: 'provider_transcripts_captured',
            owner: { kind: 'configured-group-member', parentGroup: retriedMember, member: 'rubric-security' },
            step: retriedMember, runId: 'validation-retry', attempt: 1, member: 'rubric-security',
            provider: 'codex', path: rubricPath, files: 1, bytes: 3,
            interrupted: false, skipped: 0, omittedLines: 0,
          });
        }
        return { success: retries === 2 };
      },
    };
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      events,
      stepRunner: runner,
      fromStep: retriedMember,
      mode: 'auto',
      maxRetries: 2,
      verifyArtifacts: false,
    });
    try {
      await conductor.run();

      expect(lifecycle).toEqual([
        { type: 'provider_transcripts_retained', path: join('.pipeline', 'transcripts', retriedMember, 'dispatch-1') },
        { type: 'provider_transcripts_retained', path: join('.pipeline', 'transcripts', retriedMember, 'rubric-dispatch-1') },
        { type: 'provider_transcripts_pruned', path: join('.pipeline', 'transcripts', retriedMember, 'dispatch-2') },
      ]);
      await expect(access(join(root, '.pipeline', 'transcripts', retriedMember, 'dispatch-1'))).resolves.toBeUndefined();
      await expect(access(join(root, '.pipeline', 'transcripts', retriedMember, 'rubric-dispatch-1'))).resolves.toBeUndefined();
      await expect(access(join(root, '.pipeline', 'transcripts', retriedMember, 'dispatch-2'))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('retains a needs-human refusal through the step event spine', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conductor-transcript-needs-human-'));
    const events = new ConductorEventEmitter();
    const retained: string[] = [];
    events.on('provider_transcripts_retained', (event) => {
      if (event.type === 'provider_transcripts_retained') retained.push(event.path);
    });
    new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      events,
      stepRunner: { run: async () => ({ success: true }) },
    });
    const path = join('.pipeline', 'transcripts', 'build', 'needs-human');
    try {
      await mkdir(join(root, path), { recursive: true });
      await writeFile(join(root, path, 'session.jsonl'), '{}\n');
      await events.emit({ type: 'provider_transcripts_captured', step: 'build', runId: 'run', attempt: 1,
        provider: 'codex', path, files: 1, bytes: 3, interrupted: false, skipped: 0, omittedLines: 0 });
      await events.emit({ type: 'step_refused', step: 'build', kind: 'needs-human', reason: 'operator action required' });

      await expect(access(join(root, path))).resolves.toBeUndefined();
      expect(retained).toEqual([path]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('prunes a successful configured-member capture once and does not retain it on reconciliation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conductor-transcript-member-success-'));
    const events = new ConductorEventEmitter();
    const pruned: string[] = [];
    const ledger: unknown[] = [];
    events.on('provider_transcripts_captured', (event) => { ledger.push(event); });
    events.on('provider_transcripts_pruned', (event) => {
      if (event.type === 'provider_transcripts_pruned') {
        pruned.push(event.path);
        ledger.push(event);
      }
    });
    new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      events,
      stepRunner: { run: async () => ({ success: true }) },
    });
    const path = join('.pipeline', 'transcripts', 'build_review', 'successful-member');
    try {
      await mkdir(join(root, path), { recursive: true });
      await writeFile(join(root, path, 'session.jsonl'), '{}\n');
      await events.emit({
        type: 'provider_transcripts_captured', owner: { kind: 'configured-group-member', parentGroup: 'ship_validation', member: 'build_review' }, step: 'build_review', runId: 'review', attempt: 1,
        member: 'build_review', provider: 'codex', path, files: 1, bytes: 3,
        interrupted: false, skipped: 0, omittedLines: 0,
      });
      await events.emit({
        type: 'step_completed', step: 'manual_test', status: 'done',
        executionContext: {
          executionId: 'member-success',
          subject: { kind: 'configured-member', parentGroup: 'ship_validation', member: 'build_review' },
        },
      });
      await expect(access(join(root, path))).rejects.toThrow();
      expect(pruned).toEqual([path]);

      // A later startup consults the spine, not the mere existence of a
      // capture directory; a pruned capture must never be recovered/retained.
      await mkdir(join(root, path), { recursive: true });
      await writeFile(join(root, path, 'session.jsonl'), '{}\n');
      await mkdir(join(root, '.pipeline'), { recursive: true });
      await writeFile(join(root, '.pipeline', 'events.jsonl'), `${ledger.map((event) => JSON.stringify(event)).join('\n')}\n`);
      new Conductor({
        projectRoot: root,
        stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
        events,
        stepRunner: { run: async () => ({ success: true }) },
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(pruned).toEqual([path]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('retains a failed self-host provider attempt and prunes only its successful retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conductor-transcript-provider-retry-'));
    const events = new ConductorEventEmitter();
    const lifecycle: Array<{ type: string; path: string }> = [];
    events.on('provider_transcripts_retained', (event) => {
      if (event.type === 'provider_transcripts_retained') lifecycle.push(event);
    });
    events.on('provider_transcripts_pruned', (event) => {
      if (event.type === 'provider_transcripts_pruned') lifecycle.push(event);
    });

    let invocations = 0;
    const dispatched: Array<{ step: string; captureAttempt: number | undefined }> = [];
    const transcriptWrites: Array<{ path: string; content: string }> = [];
    const runtime = {
      key: 'codex',
      provider: {
        lifecycleCapability: { synchronousSpawnPermit: true },
        resolveSelfHostExecutable: async () => 'codex',
        prepareSelfHostAuth: async () => ({ args: [] }),
        invoke: async () => {
          invocations++;
          return {
            success: invocations === 3,
            output: 'provider result',
            exitCode: invocations === 3 ? 0 : 1,
            ...(invocations === 2 ? { rateLimited: true, waitSeconds: 0 } : {}),
          };
        },
      },
      policy: providerDescriptor('codex').modelPolicy,
      builtIn: true,
      availability: new ModelAvailability([]),
    };
    const runtimes = new ProviderRuntimeSet([runtime] as never);
    const providerExecution: ProviderExecutionContext = {
      runtimes,
      sessions: {} as never,
      configuredProviders: ['codex'],
    };
    const runner: StepRunner = {
      selfHostRunId: () => 'retry-flow',
      run: async (step, _state, options) => {
        dispatched.push({ step, captureAttempt: options?.captureAttempt });
        if (step !== 'build') return { success: true };
        const result = await executeProviderCandidates({
          step,
          configuredProviders: ['codex'],
          preferredProvider: 'codex',
          runtimes,
          sessions: new ProviderSessionScope(() => 'test-session'),
          config: { llm_provider: 'codex' } as never,
          runId: 'retry-flow',
          attempt: options?.attempt,
          captureAttempt: options?.captureAttempt,
          prepareCandidateSelfHost: providerExecution.prepareCandidateSelfHost,
          options: { prompt: 'Build.', cwd: root },
        });
        if (result.success) {
          await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({
            tasks: [{ id: 'retry-task', status: 'completed' }],
          }));
        }
        return {
          success: result.success,
          output: result.output,
          ...(result.rateLimited ? { rateLimited: true, waitSeconds: result.waitSeconds } : {}),
        };
      },
    };
    const firstCapture = '{"attempt":1,"message":"first dispatch"}\n';
    const guardrails: SelfHostGuardrails = {
      resolveHarnessRoot: async () => root,
      resolveInstalledHarnessRoot: async () => ({ status: 'ok', root }),
      relink: async () => {},
      provisionSandbox: async () => { throw new Error('Codex must use provider-home isolation'); },
      provisionProviderHome: async (options) => ({
        provider: 'codex', homeDir: root, childEnv: () => ({}), childArgs: () => [],
        teardown: async () => {
          const identity = options.captureIdentity!;
          if (!('owner' in identity) || identity.owner === undefined) {
            throw new Error('expected current transcript owner identity');
          }
          const path = join('.pipeline', 'transcripts', transcriptOwnerDirectory(identity.owner), `${identity.runId}-a${identity.attempt}-codex`);
          const content = identity.attempt === 1
            ? firstCapture
            : `{"attempt":${identity.attempt},"message":"dispatch ${identity.attempt}"}\n`;
          await mkdir(join(root, path), { recursive: true });
          await writeFile(join(root, path, 'session.jsonl'), content);
          transcriptWrites.push({ path, content });
          await events.emit({ type: 'provider_transcripts_captured', owner: identity.owner, step: transcriptOwnerStep(identity.owner),
            runId: identity.runId, attempt: identity.attempt, provider: 'codex', path,
            files: 1, bytes: 3, interrupted: false, skipped: 0, omittedLines: 0 });
        },
      }),
      versionGate: async () => ({ ok: true }),
      releaseGate: async () => ({ ok: true }),
    };
    try {
      await mkdir(join(root, 'skills'));
      await mkdir(join(root, '.docs', 'plans'), { recursive: true });
      await mkdir(join(root, '.pipeline'), { recursive: true });
      await writeFile(join(root, '.docs', 'plans', 'retry.md'), '### Task 1: Retry transcript capture\n');
      await writeFile(join(root, '.pipeline', 'conduct-state.json'), JSON.stringify({
        feature_desc: 'retry-flow', complexity_tier: 'S', track: 'technical',
        bootstrap: 'done', memory: 'done', assess: 'done', explore: 'done', prd: 'skipped',
        complexity: 'done', stories: 'done', conflict_check: 'done', plan: 'done',
        coherence_check: 'done', plan_review: 'done', coverage_binding: 'done',
        architecture_diagram: 'done', architecture_review: 'done', worktree: 'done',
        acceptance_specs: 'done',
      }));
      await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({
        tasks: [{ id: 'retry-task', status: 'pending' }],
      }));
      const conductor = new Conductor({
        projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
        featureSlug: 'retry-flow', events, stepRunner: runner, providerExecution,
        selfHostGuardrails: guardrails, daemon: true, selfHost: true, fromStep: 'build',
        mode: 'auto', verifyArtifacts: false, maxRetries: 2, sleepFn: async () => {},
        config: { llm_provider: 'codex', harness_self_host: { sandbox_build_env: true, build_auth: { mode: 'api-key' } } } as never,
      });
      await conductor.run();

      const first = join('.pipeline', 'transcripts', 'build', 'retry-flow-a1-codex');
      const second = join('.pipeline', 'transcripts', 'build', 'retry-flow-a2-codex');
      const third = join('.pipeline', 'transcripts', 'build', 'retry-flow-a3-codex');
      expect({ invocations, dispatched }).toEqual({
        invocations: 3,
        dispatched: [
          { step: 'build', captureAttempt: 1 },
          { step: 'build', captureAttempt: 2 },
          { step: 'build', captureAttempt: 3 },
        ],
      });
      expect(lifecycle).toEqual([
        { type: 'provider_transcripts_retained', path: first },
        { type: 'provider_transcripts_retained', path: second },
        { type: 'provider_transcripts_pruned', path: third },
      ]);
      expect(transcriptWrites).toEqual([
        { path: first, content: firstCapture },
        { path: second, content: '{"attempt":2,"message":"dispatch 2"}\n' },
        { path: third, content: '{"attempt":3,"message":"dispatch 3"}\n' },
      ]);
      await expect(access(join(root, second))).resolves.toBeUndefined();
      await expect(readFile(join(root, second, 'session.jsonl'), 'utf8')).resolves.toBe(
        '{"attempt":2,"message":"dispatch 2"}\n',
      );
      await expect(access(join(root, third))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
