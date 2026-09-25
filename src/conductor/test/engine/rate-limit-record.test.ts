// Covers: task:10
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor } from '../test-conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { EVENT_SINKS } from '../../src/engine/event-sinks.js';
import type { ConductorEvent } from '../../src/types/events.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('rate-limit record attribution', () => {
  let projectRoot: string;
  let stateFilePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'rate-limit-record-'));
    stateFilePath = join(projectRoot, 'conduct-state.json');
    events = new ConductorEventEmitter();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-25T00:00:00.000Z'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('keeps a pre-change rate-limit record unchanged and on its existing sink', async () => {
    const eventsPath = join(projectRoot, 'events.jsonl');
    const persister = new EventPersister(eventsPath, events);
    persister.start();

    const historical: ConductorEvent = { type: 'rate_limit', waitSeconds: 30 };
    await events.emit(historical);
    persister.stop();

    const [persisted] = (await readFile(eventsPath, 'utf8')).trim().split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(persisted).toMatchObject(historical);
    expect(persisted).not.toHaveProperty('provider');
    expect(persisted).not.toHaveProperty('deadline');
    expect(EVENT_SINKS.rate_limit).toEqual({ render: true, persist: true, audit: false, otel: false });
  });

  it('persists the exhausted provider and parsed deadline from the rate-limited result', async () => {
    const deadline = Date.now() + 45_000;
    const persisted = await runAndReadRateLimitRecord({
      actualProvider: 'claude',
      deadline,
      waitSeconds: 5,
    });

    expect(persisted).toMatchObject({
      type: 'rate_limit',
      provider: 'claude',
      deadline,
      waitSeconds: 45,
    });
  });

  it('persists the exhausted provider and fallback deadline actually used for the wait', async () => {
    const startedAt = Date.now();
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const persisted = await runAndReadRateLimitRecord({
      actualProvider: 'codex',
      waitSeconds: 12,
      sleepFn,
    });

    expect(sleepFn).toHaveBeenCalledWith(12_000);
    expect(persisted).toMatchObject({
      type: 'rate_limit',
      provider: 'codex',
      deadline: startedAt + 12_000,
      waitSeconds: 12,
    });
  });

  async function runAndReadRateLimitRecord(input: {
    actualProvider: string;
    deadline?: number;
    waitSeconds?: number;
    sleepFn?: (ms: number) => Promise<void>;
  }): Promise<Record<string, unknown>> {
    const eventsPath = join(projectRoot, 'events.jsonl');
    const persister = new EventPersister(eventsPath, events);
    persister.start();
    let attempts = 0;
    const runner: StepRunner = {
      run: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) {
          return {
            success: false,
            rateLimited: true,
            actualProvider: input.actualProvider,
            deadline: input.deadline,
            waitSeconds: input.waitSeconds,
          };
        }
        return { success: true };
      }),
    };

    try {
      await new Conductor({
        projectRoot,
        stateFilePath,
        events,
        stepRunner: runner,
        sleepFn: input.sleepFn ?? vi.fn().mockResolvedValue(undefined),
      }).run();
    } finally {
      persister.stop();
    }

    const record = (await readFile(eventsPath, 'utf8')).trim().split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((event) => event.type === 'rate_limit');
    expect(record).toBeDefined();
    return record!;
  }
});
