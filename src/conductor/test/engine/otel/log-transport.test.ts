// Covers: task:10, task:12, rem-as-built-R4
import { describe, expect, it, vi } from 'vitest';
import { logEndpoint, sendLogBatch } from '../../../src/engine/otel/log-transport.js';

function enabledLogConfig() {
  return {
    otel: {
      logs: {
        enabled: true,
        endpoint: 'https://logs.example',
        headers: { Authorization: { env: 'LOG_TOKEN' } },
      },
    },
  };
}

describe('log transport', () => {
  it('normalizes all destination recipes to one /v1/logs suffix', () => {
    expect([
      logEndpoint('https://loki.example/otlp'),
      logEndpoint('https://collector.example/v1/logs'),
      logEndpoint('https://sumo.example/v1/logs/v1/logs'),
      logEndpoint('https://datadog.example///'),
    ]).toEqual([
      'https://loki.example/otlp/v1/logs',
      'https://collector.example/v1/logs',
      'https://sumo.example/v1/logs',
      'https://datadog.example/v1/logs',
    ]);
  });

  it('never begins a late request after its shared authorization deadline', async () => {
    let fetches = 0;
    const result = await sendLogBatch([], {
      startDir: '/project', destinationId: 'destination', timeoutMs: 1,
      policy: { resolveRoot: async () => new Promise(() => undefined) },
      fetch: async () => { fetches += 1; return new Response(undefined, { status: 200 }); },
    });
    expect({ result, fetches }).toEqual({ result: { ok: false, reason: 'timeout' }, fetches: 0 });
  });

  it('cancels credential resolution at the one shared delivery deadline', async () => {
    vi.useFakeTimers();
    let fetches = 0;
    let credentialSignal: AbortSignal | undefined;
    let resolveCredentials!: (headers: Record<string, string>) => void;
    try {
      const result = sendLogBatch([], {
        startDir: '/project', destinationId: 'https://logs.example/v1/logs|Authorization=$LOG_TOKEN',
        policy: {
          resolveRoot: async () => '/project',
          loadConfig: async () => ({ ok: true, config: enabledLogConfig() }),
        },
        resolveCredentials: async (_references, _env, signal) => {
          credentialSignal = signal;
          return new Promise<Record<string, string>>((resolve) => { resolveCredentials = resolve; });
        },
        fetch: async () => { fetches += 1; return new Response(undefined, { status: 200 }); },
      });
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(result).resolves.toEqual({ ok: false, reason: 'timeout' });
      expect(credentialSignal?.aborted).toBe(true);
      expect(fetches).toBe(0);
      resolveCredentials({ Authorization: 'late-token' });
      vi.runAllTicks();
      expect(fetches).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not fetch when a canonical policy read completes after its deadline', async () => {
    vi.useFakeTimers();
    let resolveRoot!: (root: string) => void;
    let fetches = 0;
    try {
      const result = sendLogBatch([], {
        startDir: '/project', destinationId: 'https://logs.example/v1/logs|Authorization=$LOG_TOKEN',
        policy: {
          resolveRoot: (_startDir, signal) => new Promise<string>((resolve) => {
            resolveRoot = resolve;
            signal?.addEventListener('abort', () => undefined, { once: true });
          }),
          loadConfig: async () => ({ ok: true, config: enabledLogConfig() }),
        },
        fetch: async () => { fetches += 1; return new Response(undefined, { status: 200 }); },
      });
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(result).resolves.toEqual({ ok: false, reason: 'timeout' });
      resolveRoot('/project');
      vi.runAllTicks();
      expect(fetches).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
