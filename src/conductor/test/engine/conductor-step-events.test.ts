// Covers: task:2
// Covers: task:4
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { Conductor } from '../test-conductor.js';
import type { ConductorEvent } from '../../src/types/events.js';

describe('Conductor step close events', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('emits the resolved effort and complexity tier when a step completes', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR!, 'conductor-step-events-'));
    directories.push(projectRoot);
    const stateFilePath = join(projectRoot, 'conduct-state.json');
    await writeFile(stateFilePath, JSON.stringify({ complexity_tier: 'M' }));

    const events = new ConductorEventEmitter();
    const completed: ConductorEvent[] = [];
    events.on('step_completed', (event) => { completed.push(event); });
    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      events,
      fromStep: 'explore',
      stepRunner: {
        run: async () => ({ success: true, effort: 'high' }),
      },
    });

    await conductor.run();

    expect(completed.find((event) => event.type === 'step_completed' && event.step === 'explore')).toMatchObject({
      effort: 'high',
      tier: 'M',
    });
  });

  it('emits resolved effort and complexity tier when a step fails', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR!, 'conductor-step-events-'));
    directories.push(projectRoot);
    const stateFilePath = join(projectRoot, 'conduct-state.json');
    await writeFile(stateFilePath, JSON.stringify({ complexity_tier: 'M' }));

    const events = new ConductorEventEmitter();
    const failed: ConductorEvent[] = [];
    events.on('step_failed', (event) => { failed.push(event); });
    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      events,
      fromStep: 'explore',
      mode: 'auto',
      maxRetries: 1,
      stepRunner: {
        run: async () => ({ success: false, output: 'explore failed', effort: 'high' }),
      },
    });

    await conductor.run();

    expect(failed.find((event) => event.type === 'step_failed' && event.step === 'explore')).toMatchObject({
      effort: 'high',
      tier: 'M',
    });
  });

  it('omits unresolved dimensions when a step fails', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR!, 'conductor-step-events-'));
    directories.push(projectRoot);
    const stateFilePath = join(projectRoot, 'conduct-state.json');

    const events = new ConductorEventEmitter();
    const failed: ConductorEvent[] = [];
    events.on('step_failed', (event) => { failed.push(event); });
    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      events,
      fromStep: 'explore',
      mode: 'auto',
      maxRetries: 1,
      stepRunner: { run: async () => ({ success: false, output: 'explore failed' }) },
    });

    await conductor.run();

    const event = failed.find((candidate) => candidate.type === 'step_failed' && candidate.step === 'explore');
    expect(event).toBeDefined();
    expect(event).not.toHaveProperty('effort');
    expect(event).not.toHaveProperty('tier');
  });

  it('emits dispatch dimensions on retries after a runner failure', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR!, 'conductor-step-events-'));
    directories.push(projectRoot);
    const stateFilePath = join(projectRoot, 'conduct-state.json');
    await writeFile(stateFilePath, JSON.stringify({ complexity_tier: 'M' }));

    const events = new ConductorEventEmitter();
    const retries: ConductorEvent[] = [];
    events.on('step_retry', (event) => { retries.push(event); });
    let attempts = 0;
    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      events,
      fromStep: 'explore',
      maxRetries: 2,
      stepRunner: {
        run: async (step) => {
          if (step !== 'explore' || ++attempts > 1) return { success: true };
          return {
            success: false,
            output: 'explore failed',
            model: 'gpt-5.6-luna',
            effort: 'high',
            actualProvider: 'codex',
          };
        },
      },
    });

    await conductor.run();

    expect(retries.find((event) => event.type === 'step_retry' && event.step === 'explore')).toMatchObject({
      model: 'gpt-5.6-luna',
      effort: 'high',
      provider: 'codex',
      tier: 'M',
    });
  });

  it('emits dispatch dimensions on retries after a completion check fails', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR!, 'conductor-step-events-'));
    directories.push(projectRoot);
    const stateFilePath = join(projectRoot, 'conduct-state.json');
    await writeFile(stateFilePath, JSON.stringify({ complexity_tier: 'M' }));

    const events = new ConductorEventEmitter();
    const retries: ConductorEvent[] = [];
    events.on('step_retry', (event) => { retries.push(event); });
    let memoryCalls = 0;
    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      events,
      fromStep: 'memory',
      maxRetries: 2,
      verifyArtifacts: true,
      config: { steps: { memory: { completion_artifact: '.pipeline/memory-pass' } } },
      stepRunner: {
        run: async () => {
          memoryCalls++;
          return {
          success: true,
          model: 'gpt-5.6-luna',
          effort: 'high',
          actualProvider: 'codex',
          };
        },
        runInteractive: async () => {},
      },
      onRecovery: async () => 'quit',
    });

    await conductor.run();

    expect(memoryCalls).toBeGreaterThan(0);
    expect(retries.find((event) => event.type === 'step_retry' && event.step === 'memory')).toMatchObject({
      model: 'gpt-5.6-luna',
      effort: 'high',
      provider: 'codex',
      tier: 'M',
    });
  });

  it('omits unresolved dimensions after a runner failure', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR!, 'conductor-step-events-'));
    directories.push(projectRoot);
    const stateFilePath = join(projectRoot, 'conduct-state.json');

    const events = new ConductorEventEmitter();
    const retries: ConductorEvent[] = [];
    events.on('step_retry', (event) => { retries.push(event); });
    let exploreAttempts = 0;
    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      events,
      fromStep: 'explore',
      maxRetries: 2,
      stepRunner: {
        run: async (step) => {
          if (step === 'explore' && ++exploreAttempts === 1) {
            return { success: false, output: 'explore failed' };
          }
          return { success: true };
        },
      },
    });

    await conductor.run();

    const retry = retries.find((event) => event.type === 'step_retry' && event.step === 'explore');
    expect(retry).toBeDefined();
    for (const dimension of ['model', 'effort', 'provider', 'tier']) {
      expect(retry).not.toHaveProperty(dimension);
    }
  });

  it('omits unresolved dimensions after a completion check failure', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR!, 'conductor-step-events-'));
    directories.push(projectRoot);
    const stateFilePath = join(projectRoot, 'conduct-state.json');

    const events = new ConductorEventEmitter();
    const retries: ConductorEvent[] = [];
    events.on('step_retry', (event) => { retries.push(event); });
    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      events,
      fromStep: 'memory',
      maxRetries: 2,
      verifyArtifacts: true,
      config: { steps: { memory: { completion_artifact: '.pipeline/memory-pass' } } },
      stepRunner: { run: async () => ({ success: true }), runInteractive: async () => {} },
      onRecovery: async () => 'quit',
    });

    await conductor.run();

    const retry = retries.find((event) => event.type === 'step_retry' && event.step === 'memory');
    expect(retry).toBeDefined();
    for (const dimension of ['model', 'effort', 'provider', 'tier']) {
      expect(retry).not.toHaveProperty(dimension);
    }
  });

  it('carries the failed provider exit facts on a retry before a later success', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR!, 'conductor-step-events-'));
    directories.push(projectRoot);
    const stateFilePath = join(projectRoot, 'conduct-state.json');
    const events = new ConductorEventEmitter();
    const retries: ConductorEvent[] = [];
    events.on('step_retry', (event) => { retries.push(event); });
    let attempts = 0;
    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      events,
      fromStep: 'explore',
      maxRetries: 2,
      stepRunner: {
        run: async (step) => {
          if (step !== 'explore' || ++attempts > 1) return { success: true };
          return {
            success: false,
            output: 'provider failed',
            exitFacts: { processErrorCode: 'EACCES', exitCode: 126, signal: 'SIGTERM' },
          };
        },
      },
    });

    await conductor.run();

    expect(retries.find((event) => event.type === 'step_retry' && event.step === 'explore')).toMatchObject({
      providerExit: { processErrorCode: 'EACCES', exitCode: 126, signal: 'SIGTERM' },
    });
  });

  it('carries only the final failed provider exit facts on terminal failure', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR!, 'conductor-step-events-'));
    directories.push(projectRoot);
    const stateFilePath = join(projectRoot, 'conduct-state.json');
    const events = new ConductorEventEmitter();
    const retries: ConductorEvent[] = [];
    const failures: ConductorEvent[] = [];
    events.on('step_retry', (event) => { retries.push(event); });
    events.on('step_failed', (event) => { failures.push(event); });
    let attempts = 0;
    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      events,
      fromStep: 'explore',
      mode: 'auto',
      maxRetries: 2,
      stepRunner: {
        run: async () => {
          attempts++;
          return attempts === 1
            ? { success: false, output: 'first failure', exitFacts: { exitCode: 1 } }
            : { success: false, output: 'final failure', exitFacts: { processErrorCode: 'ENOENT', signal: 'SIGKILL' } };
        },
      },
    });

    await conductor.run();

    expect(retries.find((event) => event.type === 'step_retry' && event.step === 'explore')).toMatchObject({
      providerExit: { exitCode: 1 },
    });
    expect(failures.find((event) => event.type === 'step_failed' && event.step === 'explore')).toMatchObject({
      providerExit: { processErrorCode: 'ENOENT', signal: 'SIGKILL' },
    });
  });

  it('keeps ordinary failures and legacy event JSON compatible', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR!, 'conductor-step-events-'));
    directories.push(projectRoot);
    const stateFilePath = join(projectRoot, 'conduct-state.json');
    const events = new ConductorEventEmitter();
    const failures: ConductorEvent[] = [];
    events.on('step_failed', (event) => { failures.push(event); });
    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      events,
      fromStep: 'explore',
      mode: 'auto',
      maxRetries: 1,
      stepRunner: { run: async () => ({ success: false, output: 'ordinary failure' }) },
    });

    await conductor.run();

    const failure = failures.find((event) => event.type === 'step_failed' && event.step === 'explore');
    expect(failure).toMatchObject({ error: 'ordinary failure', retryCount: 1 });
    expect(failure).not.toHaveProperty('providerExit');
    for (const line of [
      JSON.stringify({ type: 'step_retry', step: 'explore', attempt: 2, maxAttempts: 2, reason: 'legacy failure' }),
      JSON.stringify({ type: 'step_failed', step: 'explore', error: 'legacy failure', retryCount: 2 }),
    ]) {
      expect(JSON.parse(line)).not.toHaveProperty('providerExit');
    }
  });
});
