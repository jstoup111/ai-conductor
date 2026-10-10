// Covers: task:1
import { describe, expect, it } from 'vitest';
import { resolveLogConfig } from '../../../src/engine/otel/log-config.js';

const parent = {
  exporter: 'otlp' as const,
  endpoint: 'http://collector.example:4318',
  headers: { Authorization: { env: 'OTEL_LOG_TEST_TOKEN' } },
};

describe('resolveLogConfig', () => {
  it('inherits a valid HTTP OTLP parent endpoint and header references, resolving the logs destination exactly', () => {
    const previous = process.env.OTEL_LOG_TEST_TOKEN;
    const secret = 'configured-log-token';
    try {
      process.env.OTEL_LOG_TEST_TOKEN = secret;
      const result = resolveLogConfig({ otel: { ...parent, logs: { enabled: true } } } as never);

      expect(result).toEqual({
        enabled: true,
        endpoint: 'http://collector.example:4318/v1/logs',
        headerReferences: { Authorization: { env: 'OTEL_LOG_TEST_TOKEN' } },
        spool: { enabled: true, maxBytes: 67_108_864 },
      });
      expect(JSON.stringify(result)).toContain('OTEL_LOG_TEST_TOKEN');
      expect(JSON.stringify(result)).not.toContain(secret);
    } finally {
      if (previous === undefined) delete process.env.OTEL_LOG_TEST_TOKEN;
      else process.env.OTEL_LOG_TEST_TOKEN = previous;
    }
  });

  it('uses an explicit logs endpoint in preference to the parent endpoint', () => {
    expect(resolveLogConfig({
      otel: {
        ...parent,
        logs: { enabled: true, endpoint: 'https://logs.example/custom/ingest' },
      },
    } as never)).toMatchObject({
      enabled: true,
      endpoint: 'https://logs.example/custom/ingest/v1/logs',
    });
  });

  it('replaces inherited header references with explicit log headers, including an empty mapping', () => {
    const previous = process.env.OTEL_LOG_API_KEY;
    const secret = 'configured-log-api-key';
    try {
      process.env.OTEL_LOG_API_KEY = secret;
      const custom = resolveLogConfig({
        otel: {
          ...parent,
          logs: { enabled: true, headers: { 'X-Log-Key': { env: 'OTEL_LOG_API_KEY' } } },
        },
      } as never);
      const empty = resolveLogConfig({
        otel: { ...parent, logs: { enabled: true, headers: {} } },
      } as never);

      expect(custom).toEqual({
        enabled: true,
        endpoint: 'http://collector.example:4318/v1/logs',
        headerReferences: { 'X-Log-Key': { env: 'OTEL_LOG_API_KEY' } },
        spool: { enabled: true, maxBytes: 67_108_864 },
      });
      expect(JSON.stringify(custom)).toContain('OTEL_LOG_API_KEY');
      expect(JSON.stringify(custom)).not.toContain(secret);
      expect(empty).toEqual({
        enabled: true,
        endpoint: 'http://collector.example:4318/v1/logs',
        headerReferences: {},
        spool: { enabled: true, maxBytes: 67_108_864 },
      });
    } finally {
      if (previous === undefined) delete process.env.OTEL_LOG_API_KEY;
      else process.env.OTEL_LOG_API_KEY = previous;
    }
  });

  it('configures log spooling independently, with a 64 MiB default and a positive byte cap', () => {
    const defaults = resolveLogConfig(
      { otel: { ...parent, logs: { enabled: true } } } as never,
    );
    const disabled = resolveLogConfig(
      { otel: { ...parent, logs: { enabled: true, spool: { enabled: false, max_bytes: 4096 } } } } as never,
    );
    const sized = resolveLogConfig(
      { otel: { ...parent, logs: { enabled: true, spool: { enabled: true, max_bytes: 4096 } } } } as never,
    );

    expect(defaults).toMatchObject({ enabled: true, spool: { enabled: true, maxBytes: 67_108_864 } });
    expect(disabled).toMatchObject({ enabled: true, spool: { enabled: false, maxBytes: 4096 } });
    expect(sized).toMatchObject({ enabled: true, spool: { enabled: true, maxBytes: 4096 } });
  });

  it.each([
    ['logs are absent', { otel: parent }],
    ['logs are explicitly disabled', { otel: { ...parent, logs: { enabled: false } } }],
  ])('returns disabled when %s', (_caseName, config) => {
    expect(resolveLogConfig(config as never)).toEqual({ enabled: false });
  });
});
