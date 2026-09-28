// Covers: task:10
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor } from '../test-conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { EVENT_SINKS, otelEventTypes } from '../../src/engine/event-sinks.js';
import type { RateLimitEpisode } from '../../src/engine/rate-limit-episode.js';
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

  it('clamps an overlong parsed deadline before entering the episode and recording it', async () => {
    const startedAt = Date.now();
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const episode = {
      enter: vi.fn(),
      clear: vi.fn().mockResolvedValue(undefined),
    } as unknown as RateLimitEpisode;
    const persisted = await runAndReadRateLimitRecord({
      actualProvider: 'claude',
      deadline: startedAt + 24 * 60 * 60 * 1000,
      sleepFn,
      rateLimitEpisode: episode,
    });

    const boundedDeadline = startedAt + 6 * 60 * 60 * 1000;
    expect(persisted).toMatchObject({ deadline: boundedDeadline, waitSeconds: 6 * 60 * 60 });
    expect(episode.enter).toHaveBeenCalledWith(boundedDeadline);
    expect(episode.clear).toHaveBeenCalledOnce();
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it('does not persist a raw account-bearing limit message', async () => {
    const accountIdentifier = 'acct_9c94da18-986e-44a5-93fb-2e4b85f4bd67';
    const persisted = await runAndReadRateLimitRecord({
      actualProvider: 'claude',
      output: `Usage limit reached for account ${accountIdentifier}`,
      usageExhausted: true,
    });

    expect(JSON.stringify(persisted)).not.toContain(accountIdentifier);
    expect(persisted).toMatchObject({ reason: 'usage-exhausted' });
  });

  it('omits an unknown provider rather than persisting an empty provider identifier', async () => {
    const persisted = await runAndReadRateLimitRecord({ actualProvider: '' });

    expect(persisted).not.toHaveProperty('provider');
  });

  it('leaves a pre-change consumer able to read records carrying optional fields', async () => {
    const persisted = await runAndReadRateLimitRecord({
      actualProvider: 'claude',
      deadline: Date.now() + 45_000,
    });

    expect(readPreChangeRateLimitRecord(persisted)).toEqual({ type: 'rate_limit', waitSeconds: 45 });
  });

  it('keeps rate_limit out of the declared OpenTelemetry exporter subscriptions', () => {
    expect(otelEventTypes()).not.toContain('rate_limit');
    expect(EVENT_SINKS.rate_limit).toEqual({ render: true, persist: true, audit: false, otel: false });
  });

  async function runAndReadRateLimitRecord(input: {
    actualProvider?: string;
    deadline?: number;
    waitSeconds?: number;
    output?: string;
    usageExhausted?: boolean;
    sleepFn?: (ms: number) => Promise<void>;
    rateLimitEpisode?: RateLimitEpisode;
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
            output: input.output,
            usageExhausted: input.usageExhausted,
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
        rateLimitEpisode: input.rateLimitEpisode,
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

  function readPreChangeRateLimitRecord(record: Record<string, unknown>): { type: string; waitSeconds: number } {
    return { type: String(record.type), waitSeconds: Number(record.waitSeconds) };
  }
});
