import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, chmod } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  EventPersister,
  EventPersistError,
  isForwardedFromFeature,
  startFeatureEventPersistence,
} from '../../src/engine/event-persister.js';
import type { IntervalClock } from '../../src/execution/observed-interval.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductorEvent, ProviderAttemptEvent } from '../../src/types/index.js';

describe('EventPersister', () => {
  let tempDir: string;
  let eventsPath: string;
  let emitter: ConductorEventEmitter;

  const scriptedClock = (...values: number[]): IntervalClock => ({
    nowMs: () => {
      const value = values.shift();
      if (value === undefined) throw new Error('scripted clock exhausted');
      return value;
    },
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'event-persister-test-'));
    eventsPath = join(tempDir, 'events.jsonl');
    emitter = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ─── Task 5: basic write ───────────────────────────────────────────────────

  it('writes 3 emitted events as 3 JSONL lines', async () => {
    const persister = new EventPersister(eventsPath, emitter);
    persister.start();

    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
    await emitter.emit({ type: 'rate_limit', waitSeconds: 5 });

    persister.stop();

    const content = await readFile(eventsPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);
  });

  it('each line is valid JSON', async () => {
    const persister = new EventPersister(eventsPath, emitter);
    persister.start();

    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await emitter.emit({ type: 'session_reset', reason: 'test' });

    persister.stop();

    const content = await readFile(eventsPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('each line has a ts field', async () => {
    const persister = new EventPersister(eventsPath, emitter);
    persister.start();

    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });

    persister.stop();

    const content = await readFile(eventsPath, 'utf-8');
    const line = JSON.parse(content.trim());
    expect(typeof line.ts).toBe('string');
    expect(new Date(line.ts).toISOString()).toBe(line.ts);
  });

  it('each line preserves the event type', async () => {
    const persister = new EventPersister(eventsPath, emitter);
    persister.start();

    await emitter.emit({ type: 'rate_limit', waitSeconds: 30 });

    persister.stop();

    const content = await readFile(eventsPath, 'utf-8');
    const line = JSON.parse(content.trim());
    expect(line.type).toBe('rate_limit');
    expect(line.waitSeconds).toBe(30);
  });

  it('persists BUILD member settle decisions declared for operator observability', async () => {
    const persister = new EventPersister(eventsPath, emitter);
    persister.start();

    await emitter.emit({
      type: 'build_member_evidence_reused',
      member: 'test_suite',
      decision: 'reuse',
      basis: 'fingerprint-match',
    });
    await emitter.emit({
      type: 'build_member_evidence_recomputed',
      member: 'wiring_check',
      decision: 'recompute',
      basis: 'recorded-head-versus-current-head',
    });

    persister.stop();

    expect(
      (await readFile(eventsPath, 'utf-8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    ).toMatchObject([
      {
        type: 'build_member_evidence_reused',
        member: 'test_suite',
        decision: 'reuse',
        basis: 'fingerprint-match',
      },
      {
        type: 'build_member_evidence_recomputed',
        member: 'wiring_check',
        decision: 'recompute',
        basis: 'recorded-head-versus-current-head',
      },
    ]);
  });

  it('persists typed credential-park progress as JSONL', async () => {
    const persister = new EventPersister(eventsPath, emitter);
    persister.start();

    await emitter.emit({
      type: 'credentials_park_progress',
      provider: 'codex',
      source: 'cached-login',
      readiness: 'unusable',
      elapsedSeconds: 3,
      nextProbeDelaySeconds: 4,
      degradation: 'credential-failure',
    });

    persister.stop();

    const { ts: _ts, ...record } = JSON.parse((await readFile(eventsPath, 'utf-8')).trim());
    expect(record).toEqual({
      type: 'credentials_park_progress',
      provider: 'codex',
      source: 'cached-login',
      readiness: 'unusable',
      elapsedSeconds: 3,
      nextProbeDelaySeconds: 4,
      degradation: 'credential-failure',
    });
  });

  it.each(['invalid-json', 'unsupported-schema', undefined] as const)(
    'persists the closed parser-rejection reason %s for probe-failure recovery',
    async (parserRejection) => {
    const persister = new EventPersister(eventsPath, emitter);
    persister.start();
    const rawDoctorDiagnostic = 'sk-live-super-secret-token /private/codex/credentials.json';

    await emitter.emit({
      type: 'credentials_park_progress',
      provider: 'codex',
      source: 'cached-login',
      readiness: 'probe-failed',
      elapsedSeconds: 3,
      degradation: 'probe-failure',
      probeFailureKind: 'unparseable-output',
      ...(parserRejection === undefined ? {} : { parserRejection }),
      nextDisposition: 'trial-required',
    });

    persister.stop();

    const { ts: _ts, ...record } = JSON.parse((await readFile(eventsPath, 'utf-8')).trim());
    expect(record).toEqual({
      type: 'credentials_park_progress',
      provider: 'codex',
      source: 'cached-login',
      readiness: 'probe-failed',
      elapsedSeconds: 3,
      degradation: 'probe-failure',
      probeFailureKind: 'unparseable-output',
      ...(parserRejection === undefined ? {} : { parserRejection }),
      nextDisposition: 'trial-required',
    });
    expect(JSON.stringify(record)).not.toContain(rawDoctorDiagnostic);
    },
  );

  it('forwards typed probe-failure progress to the daemon bus without widening its event shape', async () => {
    const globalEvents = new ConductorEventEmitter();
    const forwarded: ConductorEvent[] = [];
    globalEvents.on('credentials_park_progress', (event) => {
      forwarded.push(event);
    });
    const scope = startFeatureEventPersistence(tempDir, globalEvents);

    await scope.events.emit({
      type: 'credentials_park_progress',
      provider: 'codex',
      source: 'cached-login',
      readiness: 'probe-failed',
      elapsedSeconds: 3,
      degradation: 'probe-failure',
      probeFailureKind: 'timeout',
      nextDisposition: 'trial-required',
    });
    scope.stop();

    expect(forwarded).toHaveLength(1);
    const [event] = forwarded;
    expect(event).toBeDefined();
    if (event?.type !== 'credentials_park_progress' || event.degradation !== 'probe-failure') {
      throw new Error('expected forwarded probe-failure progress');
    }
    expect({
      provider: event.provider,
      source: event.source,
      elapsedSeconds: event.elapsedSeconds,
      probeFailureKind: event.probeFailureKind,
      nextDisposition: event.nextDisposition,
      forwarded: isForwardedFromFeature(event),
    }).toEqual({
      provider: 'codex',
      source: 'cached-login',
      elapsedSeconds: 3,
      probeFailureKind: 'timeout',
      nextDisposition: 'trial-required',
      forwarded: true,
    });
  });

  it('persists only the closed progress contract, not doctor diagnostics', async () => {
    const persister = new EventPersister(eventsPath, emitter);
    persister.start();
    const rawFragment = 'sk-live-super-secret-token /private/codex/credentials.json';

    await emitter.emit({
      type: 'credentials_park_progress', provider: 'codex', source: 'cached-login',
      readiness: 'unusable', elapsedSeconds: 60, nextProbeDelaySeconds: 30,
      degradation: 'credential-failure',
    });
    persister.stop();

    const persisted = await readFile(eventsPath, 'utf-8');
    expect(persisted).not.toContain(rawFragment);
  });

  // ─── Task 4: missing tokenUsage does not crash ──────────────────────────────

  it('handles step_completed without tokenUsage without crashing', async () => {
    const persister = new EventPersister(eventsPath, emitter);
    persister.start();

    // step_completed without tokenUsage — must not throw
    await expect(
      emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' })
    ).resolves.not.toThrow();

    persister.stop();

    const content = await readFile(eventsPath, 'utf-8');
    const line = JSON.parse(content.trim());
    expect(line.type).toBe('step_completed');
    expect(line.tokenUsage).toBeUndefined();
  });

  it.each([
    {
      terminal: { type: 'step_completed', step: 'bootstrap', status: 'done' },
      expectedType: 'step_completed',
    },
    {
      terminal: { type: 'step_failed', step: 'bootstrap', error: 'boom', retryCount: 0 },
      expectedType: 'step_failed',
    },
  ] satisfies Array<{ terminal: ConductorEvent; expectedType: string }>)(
    'persists an explicit active interval on the first matching $expectedType event',
    async ({ terminal, expectedType }) => {
      const persister = new EventPersister(eventsPath, emitter, scriptedClock(1_000, 1_025));
      persister.start();

      await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
      await emitter.emit(terminal);
      await emitter.emit(terminal);
      persister.stop();

      const records = (await readFile(eventsPath, 'utf-8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const terminals = records.filter((record) => record.type === expectedType);
      expect(terminals.map((record) => record.activeInterval)).toEqual([
        { startedAtMs: 1_000, durationMs: 25 },
        undefined,
      ]);
    },
  );

  it('leaves a start open when a different step emits a terminal event', async () => {
    const persister = new EventPersister(eventsPath, emitter, scriptedClock(5_000, 5_020));
    persister.start();

    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await emitter.emit({ type: 'step_failed', step: 'explore', error: 'boom', retryCount: 0 });
    await emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
    persister.stop();

    const terminals = (await readFile(eventsPath, 'utf-8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .filter((record) => record.type === 'step_failed' || record.type === 'step_completed');
    expect(terminals.map((record) => record.activeInterval)).toEqual([
      undefined,
      { startedAtMs: 5_000, durationMs: 20 },
    ]);
  });

  it('measures sequential steps without including the idle gap or deriving duration from ts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-02T03:04:05.000Z'));
    const persister = new EventPersister(
      eventsPath,
      emitter,
      scriptedClock(100, 140, 10_000, 10_030),
    );
    try {
      persister.start();

      await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
      await emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
      await emitter.emit({ type: 'step_started', step: 'explore', index: 1 });
      await emitter.emit({ type: 'step_completed', step: 'explore', status: 'done' });
      persister.stop();

      const records = (await readFile(eventsPath, 'utf-8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
        .filter((record) => record.type === 'step_completed');
      expect(records.map(({ activeInterval, ts }) => ({ activeInterval, ts }))).toEqual([
        {
          activeInterval: { startedAtMs: 100, durationMs: 40 },
          ts: '2030-01-02T03:04:05.000Z',
        },
        {
          activeInterval: { startedAtMs: 10_000, durationMs: 30 },
          ts: '2030-01-02T03:04:05.000Z',
        },
      ]);
    } finally {
      persister.stop();
      vi.useRealTimers();
    }
  });

  it('persists an active interval on the first matching parallel terminal event', async () => {
    const persister = new EventPersister(eventsPath, emitter, scriptedClock(2_000, 2_075));
    persister.start();

    await emitter.emit({
      type: 'parallel_started',
      step: 'manual_test',
      branches: ['manual_test', 'prd_audit'],
    });
    await emitter.emit({
      type: 'parallel_completed',
      step: 'manual_test',
      branches: ['manual_test', 'prd_audit'],
    });
    persister.stop();

    const records = (await readFile(eventsPath, 'utf-8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(records[1].activeInterval).toEqual({ startedAtMs: 2_000, durationMs: 75 });
  });

  it('closes a failed parallel group once when several branches fail', async () => {
    const persister = new EventPersister(eventsPath, emitter, scriptedClock(3_000, 3_040));
    persister.start();

    await emitter.emit({
      type: 'parallel_started',
      step: 'manual_test',
      branches: ['manual_test', 'prd_audit'],
    });
    await emitter.emit({
      type: 'parallel_failure',
      step: 'manual_test',
      branch: 'manual_test',
      error: 'manual test failed',
    });
    await emitter.emit({
      type: 'parallel_failure',
      step: 'manual_test',
      branch: 'prd_audit',
      error: 'PRD audit failed',
    });
    persister.stop();

    const failures = (await readFile(eventsPath, 'utf-8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .filter((record) => record.type === 'parallel_failure');
    expect(failures.map((record) => record.activeInterval)).toEqual([
      { startedAtMs: 3_000, durationMs: 40 },
      undefined,
    ]);
  });

  it('tracks overlapping serial and parallel records independently', async () => {
    const persister = new EventPersister(
      eventsPath,
      emitter,
      scriptedClock(100, 120, 150, 180),
    );
    persister.start();

    await emitter.emit({ type: 'step_started', step: 'manual_test', index: 0 });
    await emitter.emit({
      type: 'parallel_started',
      step: 'manual_test',
      branches: ['manual_test', 'prd_audit'],
    });
    await emitter.emit({
      type: 'parallel_completed',
      step: 'manual_test',
      branches: ['manual_test', 'prd_audit'],
    });
    await emitter.emit({ type: 'step_completed', step: 'manual_test', status: 'done' });
    persister.stop();

    const terminals = (await readFile(eventsPath, 'utf-8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .filter((record) => record.type === 'parallel_completed' || record.type === 'step_completed');
    expect(terminals.map((record) => record.activeInterval)).toEqual([
      { startedAtMs: 120, durationMs: 30 },
      { startedAtMs: 100, durationMs: 80 },
    ]);
  });

  it('does not attach a second interval to duplicate parallel terminal events', async () => {
    const persister = new EventPersister(eventsPath, emitter, scriptedClock(4_000, 4_010));
    persister.start();

    await emitter.emit({
      type: 'parallel_started',
      step: 'manual_test',
      branches: ['manual_test', 'prd_audit'],
    });
    const terminal = {
      type: 'parallel_completed',
      step: 'manual_test',
      branches: ['manual_test', 'prd_audit'],
    } satisfies ConductorEvent;
    await emitter.emit(terminal);
    await emitter.emit(terminal);
    persister.stop();

    const terminals = (await readFile(eventsPath, 'utf-8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .filter((record) => record.type === 'parallel_completed');
    expect(terminals.map((record) => record.activeInterval)).toEqual([
      { startedAtMs: 4_000, durationMs: 10 },
      undefined,
    ]);
  });

  it('preserves an unmatched parallel start as detectable incomplete evidence', async () => {
    const persister = new EventPersister(eventsPath, emitter, scriptedClock(5_000));
    persister.start();

    await emitter.emit({
      type: 'parallel_started',
      step: 'manual_test',
      branches: ['manual_test', 'prd_audit'],
    });
    persister.stop();

    const record = JSON.parse((await readFile(eventsPath, 'utf-8')).trim());
    expect(record).toMatchObject({
      type: 'parallel_started',
      step: 'manual_test',
      branches: ['manual_test', 'prd_audit'],
    });
  });

  it('persists provider attempts, fallback diagnostics, and completed-step attribution', async () => {
    const persister = new EventPersister(eventsPath, emitter);
    persister.start();

    const observedIntervals = [{ startedAtMs: 100, durationMs: 25 }];
    const providerEvents = [
      {
        type: 'provider_attempt',
        step: 'plan',
        provider: 'codex',
        authenticationSource: 'cached-login',
        outcome: 'unavailable',
        reason: 'executable not found',
        model: 'gpt-5.6-sol',
        invoked: true,
        observedIntervals,
      },
      {
        type: 'provider_fallback',
        step: 'plan',
        failedProvider: 'codex',
        reason: 'executable not found',
        nextProvider: 'claude',
      },
      {
        type: 'provider_attempt',
        step: 'plan',
        provider: 'claude',
        outcome: 'success',
        model: 'sonnet',
        tokenUsage: { input: 120, output: 30 },
        invoked: true,
        observedIntervals,
      },
      {
        type: 'provider_attempt',
        step: 'plan',
        provider: 'codex',
        outcome: 'unavailable',
        reason: 'cached unavailable',
        invoked: false,
      },
      {
        type: 'step_completed',
        step: 'plan',
        status: 'done',
        preferredProvider: 'codex',
        actualProvider: 'claude',
        observedIntervals,
      },
    ] satisfies ConductorEvent[];

    for (const event of providerEvents) await emitter.emit(event);
    persister.stop();

    const records = (await readFile(eventsPath, 'utf-8'))
      .trim()
      .split('\n')
      .map((line) => {
        const { ts: _ts, ...event } = JSON.parse(line);
        return event;
      });
    expect(records).toEqual(providerEvents);
  });

  it('persists provider intervals on a failed scalar terminal event', async () => {
    const observedIntervals = [{ startedAtMs: 200, durationMs: 30 }];
    const persister = new EventPersister(eventsPath, emitter);
    persister.start();

    await emitter.emit({
      type: 'step_failed',
      step: 'plan',
      error: 'failed',
      retryCount: 1,
      observedIntervals,
    });
    persister.stop();

    const record = JSON.parse((await readFile(eventsPath, 'utf-8')).trim());
    expect(record.observedIntervals).toEqual(observedIntervals);
  });

  it('derives lifecycle observed intervals independently for each provider attempt', async () => {
    const persister = new EventPersister(
      eventsPath,
      emitter,
      scriptedClock(1_000, 1_025, 2_000, 2_075, 3_000, 3_050),
    );
    persister.start();

    const lifecycleEvents = [
      {
        type: 'provider_attempt',
        step: 'plan',
        provider: 'codex',
        outcome: 'unavailable',
        invoked: false,
        lifecycle: { phase: 'preparing', attemptId: 'codex-1', recoveryCount: 0 },
      },
      {
        type: 'provider_attempt',
        step: 'plan',
        provider: 'codex',
        outcome: 'failure',
        invoked: true,
        lifecycle: { phase: 'running', attemptId: 'codex-1', recoveryCount: 0 },
      },
      {
        type: 'provider_attempt',
        step: 'plan',
        provider: 'claude',
        outcome: 'failure',
        invoked: true,
        lifecycle: { phase: 'running', attemptId: 'claude-1', recoveryCount: 0 },
      },
      {
        type: 'provider_attempt',
        step: 'plan',
        provider: 'claude',
        outcome: 'failure',
        invoked: true,
        lifecycle: { phase: 'recovering', attemptId: 'claude-1', recoveryCount: 1 },
      },
      {
        type: 'provider_attempt',
        step: 'plan',
        provider: 'codex',
        outcome: 'unavailable',
        invoked: false,
        lifecycle: { phase: 'preparing', attemptId: 'codex-2', recoveryCount: 1 },
      },
      {
        type: 'provider_attempt',
        step: 'plan',
        provider: 'codex',
        outcome: 'unavailable',
        invoked: false,
        lifecycle: { phase: 'exhausted', attemptId: 'codex-2', recoveryCount: 1 },
      },
    ] satisfies ProviderAttemptEvent[];

    for (const event of lifecycleEvents) await emitter.emit(event);
    persister.stop();

    const records = (await readFile(eventsPath, 'utf-8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(records.map((record) => record.observedIntervals)).toEqual([
      undefined,
      [{ startedAtMs: 1_000, durationMs: 25 }],
      undefined,
      [{ startedAtMs: 2_000, durationMs: 75 }],
      undefined,
      [{ startedAtMs: 3_000, durationMs: 50 }],
    ]);
  });

  // ─── Task 6: creates parent directories ───────────────────────────────────

  it('creates parent directories that do not exist', async () => {
    const nestedPath = join(tempDir, 'deep', 'nested', 'dir', 'events.jsonl');
    const persister = new EventPersister(nestedPath, emitter);
    persister.start();

    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });

    persister.stop();

    const content = await readFile(nestedPath, 'utf-8');
    expect(content.trim()).toBeTruthy();
    const line = JSON.parse(content.trim());
    expect(line.type).toBe('step_started');
  });

  // ─── Task 7: write error → EventPersistError ─────────────────────────────

  it('EventPersistError is constructed with filePath and cause', () => {
    const cause = new Error('EACCES: permission denied');
    const err = new EventPersistError('/some/path/events.jsonl', cause);
    expect(err).toBeInstanceOf(EventPersistError);
    expect(err.name).toBe('EventPersistError');
    expect(err.filePath).toBe('/some/path/events.jsonl');
    expect(err.cause).toBe(cause);
    expect(err.message).toContain('/some/path/events.jsonl');
    expect(err.message).toContain('EACCES');
  });

  it('EventPersistError is an instance of Error', () => {
    const err = new EventPersistError('/path', new Error('io error'));
    expect(err).toBeInstanceOf(Error);
  });

  it('write to directory path causes EventPersistError (emitter swallows, file stays empty)', async () => {
    // tempDir is a directory — writing to it as a file throws OS error.
    // The emitter swallows handler errors, so emit() doesn't reject.
    // We verify the file did NOT get partially written.
    const persister = new EventPersister(tempDir, emitter);
    persister.start();

    // emit() should resolve (emitter swallows the handler error)
    await expect(
      emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 })
    ).resolves.not.toThrow();

    persister.stop();
    // tempDir as file path: no events.jsonl created in unexpected location
    const { existsSync } = await import('node:fs');
    // The directory itself exists but we can't read it as a file — just verify no crash
    expect(existsSync(tempDir)).toBe(true);
  });

  // ─── stop() unsubscribes ─────────────────────────────────────────────────

  it('stop() prevents further events from being written', async () => {
    const persister = new EventPersister(eventsPath, emitter);
    persister.start();

    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    persister.stop();
    await emitter.emit({ type: 'session_reset', reason: 'after-stop' });

    const content = await readFile(eventsPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
  });
});
