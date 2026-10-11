// Covers: task:10, task:12, rem-as-built-R4
import { describe, expect, it, vi } from 'vitest';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { logEndpoint, sendLogBatch } from '../../../src/engine/otel/log-transport.js';
import { logDestinationId } from '../../../src/engine/otel/log-policy.js';
import { resolveLogConfig } from '../../../src/engine/otel/log-config.js';

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

interface ProtoField { wireType: number; value: number | Uint8Array; }

/** A minimal independent decoder for the resource and record attributes we query. */
function protoFields(body: Uint8Array): Map<number, ProtoField[]> {
  const fields = new Map<number, ProtoField[]>();
  let offset = 0;
  const varint = (): number => {
    let value = 0;
    let shift = 0;
    while (true) {
      const byte = body[offset++];
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7;
    }
  };
  while (offset < body.length) {
    const tag = varint();
    const wireType = tag & 7;
    let value: number | Uint8Array;
    if (wireType === 0) value = varint();
    else if (wireType === 1) { value = body.slice(offset, offset + 8); offset += 8; }
    else if (wireType === 2) { const length = varint(); value = body.slice(offset, offset + length); offset += length; }
    else if (wireType === 5) { value = body.slice(offset, offset + 4); offset += 4; }
    else throw new Error(`unsupported OTLP wire type ${wireType}`);
    const number = tag >>> 3;
    fields.set(number, [...(fields.get(number) ?? []), { wireType, value }]);
  }
  return fields;
}

function embedded(fields: Map<number, ProtoField[]>, number: number): Uint8Array[] {
  return (fields.get(number) ?? []).map((field) => {
    if (!(field.value instanceof Uint8Array)) throw new Error(`field ${number} is not length-delimited`);
    return field.value;
  });
}

function oneEmbedded(fields: Map<number, ProtoField[]>, number: number): Uint8Array {
  const [value] = embedded(fields, number);
  if (value === undefined) throw new Error(`missing OTLP field ${number}`);
  return value;
}

function stringValue(body: Uint8Array): string {
  return new TextDecoder().decode(oneEmbedded(protoFields(body), 1));
}

function attributes(body: Uint8Array, field = 1): Record<string, string> {
  return Object.fromEntries(embedded(protoFields(body), field).map((entry) => {
    const keyValue = protoFields(entry);
    return [new TextDecoder().decode(oneEmbedded(keyValue, 1)), stringValue(oneEmbedded(keyValue, 2))];
  }));
}

function queryableIdentity(body: Uint8Array): { project: string; feature: string } {
  const resourceLogs = protoFields(oneEmbedded(protoFields(body), 1));
  const resource = oneEmbedded(resourceLogs, 1);
  const scopeLogs = protoFields(oneEmbedded(resourceLogs, 2));
  const record = oneEmbedded(scopeLogs, 2);
  return {
    project: attributes(resource)['conductor.project'],
    feature: attributes(record, 6)['conductor.feature'],
  };
}

const record = {
  hrTime: [1, 2] as [number, number], hrTimeObserved: [1, 2] as [number, number],
  resource: resourceFromAttributes({ 'conductor.project': 'project-query-key' }),
  instrumentationScope: { name: 'conductor', version: '1.0.0' },
  severityText: 'INFO', severityNumber: 9, body: 'completed', eventName: 'operational_log',
  attributes: { 'conductor.feature': 'feature-with-full-identity' }, droppedAttributesCount: 0,
} as never;

function resolvedDestination(otel: Record<string, unknown>) {
  const resolved = resolveLogConfig({ otel } as never);
  if (!resolved.enabled) throw new Error(resolved.error);
  return resolved;
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

  it.each([
    ['Loki parent inheritance', {
      exporter: 'otlp', endpoint: 'https://loki.example/otlp', headers: { Authorization: { env: 'LOKI_AUTH' } }, logs: { enabled: true },
    }, 'https://loki.example/otlp/v1/logs', { Authorization: 'Bearer loki-token' }],
    ['Elasticsearch collector override', {
      exporter: 'otlp', endpoint: 'https://ignored.example', headers: { Authorization: { env: 'PARENT_AUTH' } },
      logs: { enabled: true, endpoint: 'https://elastic.example/_otlp/', headers: { Authorization: { env: 'ELASTIC_AUTH' } } },
    }, 'https://elastic.example/_otlp/v1/logs', { Authorization: 'ApiKey elastic-token' }],
    ['Sumo already-suffixed endpoint', {
      exporter: 'file', logs: { enabled: true, endpoint: 'https://sumo.example/v1/logs', headers: { Authorization: { env: 'SUMO_AUTH' } } },
    }, 'https://sumo.example/v1/logs', { Authorization: 'Bearer sumo-token' }],
    ['Datadog empty header replacement', {
      exporter: 'otlp', endpoint: 'https://ignored.example', headers: { Authorization: { env: 'PARENT_AUTH' } },
      logs: { enabled: true, endpoint: 'https://datadog.example', headers: {} },
    }, 'https://datadog.example/v1/logs', {}],
  ] as const)('sends one protobuf contract to %s without retaining resolved credentials', async (_destination, otel, endpoint, expectedHeaders) => {
    const config = resolvedDestination(otel as never);
    const requests: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push([input, init]);
      return new Response(undefined, { status: 200 });
    });
    const result = await sendLogBatch([record], {
      startDir: '/project', destinationId: logDestinationId(config), fetch,
      env: {
        LOKI_AUTH: 'Bearer loki-token', ELASTIC_AUTH: 'ApiKey elastic-token',
        SUMO_AUTH: 'Bearer sumo-token', PARENT_AUTH: 'parent-secret',
      },
      policy: { resolveRoot: async () => '/project', loadConfig: async () => ({ ok: true, config: { otel } as never }) },
    });

    expect(result).toEqual({ ok: true, status: 200 });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = requests[0] ?? [];
    expect(String(url)).toBe(endpoint);
    if (init === undefined) throw new Error('expected log request options');
    expect(init.headers).toEqual({ ...expectedHeaders, 'Content-Type': 'application/x-protobuf' });
    expect(queryableIdentity(new Uint8Array(init.body as ArrayBuffer))).toEqual({
      project: 'project-query-key', feature: 'feature-with-full-identity',
    });
    expect(JSON.stringify(config)).not.toMatch(/loki-token|elastic-token|sumo-token|parent-secret/);
  });

  it.each([
    ['disabled', { ok: true, config: { otel: { logs: { enabled: false } } } }],
    ['invalid', { ok: true, config: { otel: { logs: { enabled: true, endpoint: 'file:///not-otlp' } } } }],
    ['unreadable', { ok: false }],
  ] as const)('does not issue a direct request when current canonical policy is %s', async (_state, current) => {
    const admitted = resolvedDestination(enabledLogConfig().otel);
    let requests = 0;
    const result = await sendLogBatch([], {
      startDir: '/project', destinationId: logDestinationId(admitted),
      policy: {
        resolveRoot: async () => '/project',
        loadConfig: async () => current as never,
      },
      fetch: async () => { requests += 1; return new Response(undefined, { status: 200 }); },
    });

    expect({ result, requests }).toEqual({ result: { ok: false, reason: 'policy' }, requests: 0 });
  });

  it('does not reroute a directly queued batch after its header reference changes', async () => {
    const admitted = resolvedDestination(enabledLogConfig().otel);
    let requests = 0;
    const result = await sendLogBatch([], {
      startDir: '/project', destinationId: logDestinationId(admitted),
      policy: {
        resolveRoot: async () => '/project',
        loadConfig: async () => ({ ok: true, config: {
          otel: { logs: { enabled: true, endpoint: 'https://logs.example', headers: { Authorization: { env: 'ROTATED_REFERENCE' } } } },
        } }),
      },
      fetch: async () => { requests += 1; return new Response(undefined, { status: 200 }); },
    });

    expect({ result, requests }).toEqual({ result: { ok: false, reason: 'policy' }, requests: 0 });
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
        startDir: '/project', destinationId: logDestinationId(resolvedDestination(enabledLogConfig().otel)),
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
        startDir: '/project', destinationId: logDestinationId(resolvedDestination(enabledLogConfig().otel)),
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
