// Covers: task:10, task:12
import { describe, expect, it } from 'vitest';
import { logEndpoint, sendLogBatch } from '../../../src/engine/otel/log-transport.js';

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
});
