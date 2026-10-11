// Covers: rem-as-built-R6, task:23
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { wireOtelLogs, type OtelLogOwner } from '../../../src/engine/otel/wire.js';

const lifecycle = vi.hoisted(() => ({
  forceFlush: vi.fn<() => Promise<void>>(),
  shutdown: vi.fn<() => Promise<void>>(),
}));
const readLogPolicy = vi.hoisted(() => vi.fn());

vi.mock('@opentelemetry/sdk-logs', () => ({
  LoggerProvider: class {
    getLogger(): { emit: () => void } { return { emit: () => {} }; }
    forceFlush(): Promise<void> { return lifecycle.forceFlush(); }
    shutdown(): Promise<void> { return lifecycle.shutdown(); }
  },
}));

vi.mock('../../../src/engine/otel/log-policy.js', () => ({
  readLogPolicy,
}));

function healthyLogPolicy() {
  return {
    sendable: true as const,
    root: '/project',
    destinationId: 'https://logs.example/v1/logs|',
    config: {
      enabled: true as const,
      endpoint: 'https://logs.example/v1/logs',
      spool: { enabled: false, maxBytes: 1024 },
    },
  };
}

beforeEach(() => {
  readLogPolicy.mockResolvedValue(healthyLogPolicy());
});

afterEach(() => {
  vi.useRealTimers();
  lifecycle.forceFlush.mockReset();
  lifecycle.shutdown.mockReset();
  readLogPolicy.mockReset();
  readLogPolicy.mockResolvedValue(healthyLogPolicy());
});

async function createOwner(): Promise<OtelLogOwner> {
  const owner = await wireOtelLogs({
    otel: {
      exporter: 'otlp', endpoint: 'https://logs.example', logs: { enabled: true, spool: { enabled: false } },
    },
  } as never, {
    pipelineDir: '/project/.pipeline', project: '/project', branch: undefined, engineVersion: undefined, harnessVersion: undefined,
  }, new ConductorEventEmitter());
  expect(owner).not.toBeNull();
  return owner!;
}

describe('wireOtelLogs shutdown budget', () => {
  it('uses one two-second deadline across flush and shutdown', async () => {
    vi.useFakeTimers();
    lifecycle.forceFlush.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 1_500)));
    lifecycle.shutdown.mockImplementation(() => new Promise(() => {}));
    const owner = await createOwner();

    let finished = false;
    const stopping = owner.stop().then(() => { finished = true; });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(lifecycle.shutdown).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(499);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await stopping;
    expect(finished).toBe(true);
  });

  it('still attempts shutdown within the shared deadline when flush rejects', async () => {
    lifecycle.forceFlush.mockRejectedValue(new Error('flush failed'));
    lifecycle.shutdown.mockResolvedValue(undefined);
    const owner = await createOwner();

    await owner.stop();

    expect(lifecycle.forceFlush).toHaveBeenCalledTimes(1);
    expect(lifecycle.shutdown).toHaveBeenCalledTimes(1);
  });
});

describe('wireOtelLogs failure isolation', () => {
  it('keeps an unexpected policy-read failure local and returns no log owner', async () => {
    readLogPolicy.mockRejectedValueOnce(new Error('policy reader exploded'));
    const events = new ConductorEventEmitter();
    const errors: string[] = [];
    events.on('renderer_error', (event) => {
      if (event.type === 'renderer_error') errors.push(event.error);
    });

    await expect(wireOtelLogs({
      otel: { exporter: 'file', logs: { enabled: true, endpoint: 'https://logs.example' } },
    } as never, {
      pipelineDir: '/project/.pipeline', project: '/project', branch: undefined, engineVersion: undefined, harnessVersion: undefined,
    }, events)).resolves.toBeNull();

    expect(errors).toEqual(['[otel] log policy setup failed; logs remain local']);
  });
});
