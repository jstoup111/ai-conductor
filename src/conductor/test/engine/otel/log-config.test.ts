// Covers: task:1, task:2
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../../src/engine/config.js';
import { resolveLogConfig } from '../../../src/engine/otel/log-config.js';
import { resolveOtelConfig } from '../../../src/engine/otel/otel-config.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

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

  it.each([
    ['nonboolean enabled', { enabled: 'yes' }, /otel\.logs\.enabled.*boolean/i],
    ['an unknown vendor selector', { enabled: true, vendor: 'loki' }, /unknown otel\.logs\.vendor/i],
    ['a malformed header reference', { enabled: true, headers: { Authorization: 'literal-token' } }, /otel\.logs\.headers\.Authorization/i],
    ['an unknown retention key', { enabled: true, spool: { retain_forever: true } }, /unknown otel\.logs\.spool\.retain_forever/i],
    ['a nonboolean retention switch', { enabled: true, spool: { enabled: 'yes' } }, /otel\.logs\.spool\.enabled.*boolean/i],
    ['a zero retention cap', { enabled: true, spool: { max_bytes: 0 } }, /otel\.logs\.spool\.max_bytes.*positive integer/i],
    ['a negative retention cap', { enabled: true, spool: { max_bytes: -1 } }, /otel\.logs\.spool\.max_bytes.*positive integer/i],
    ['a fractional retention cap', { enabled: true, spool: { max_bytes: 1.5 } }, /otel\.logs\.spool\.max_bytes.*positive integer/i],
    ['a nonnumeric retention cap', { enabled: true, spool: { max_bytes: 'many' } }, /otel\.logs\.spool\.max_bytes.*positive integer/i],
  ])('disables logs with a safe key-specific error for %s', (_caseName, logs, error) => {
    const result = resolveLogConfig({ otel: { ...parent, logs } } as never);

    expect(result).toMatchObject({ enabled: false, error: expect.stringMatching(error) });
  });

  it.each([
    ['a file parent', { exporter: 'file', logs: { enabled: true } }, /otel\.logs\.endpoint/i],
    ['a gRPC parent', { ...parent, protocol: 'grpc', logs: { enabled: true } }, /otel\.logs\.endpoint/i],
    ['no parent destination', { logs: { enabled: true } }, /otel\.logs\.endpoint/i],
    ['userinfo in the explicit endpoint', { exporter: 'file', logs: { enabled: true, endpoint: 'https://token@logs.example/v1' } }, /otel\.logs\.endpoint/i],
    ['a query in the explicit endpoint', { exporter: 'file', logs: { enabled: true, endpoint: 'https://logs.example/v1?token=secret' } }, /otel\.logs\.endpoint/i],
    ['a fragment in the explicit endpoint', { exporter: 'file', logs: { enabled: true, endpoint: 'https://logs.example/v1#secret' } }, /otel\.logs\.endpoint/i],
    ['a non-HTTP endpoint', { exporter: 'file', logs: { enabled: true, endpoint: 'ftp://logs.example/v1' } }, /otel\.logs\.endpoint/i],
  ])('refuses %s without exposing endpoint credentials', (_caseName, otel, error) => {
    const result = resolveLogConfig({ otel } as never);
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({ enabled: false, error: expect.stringMatching(error) });
    expect(serialized).not.toMatch(/token@|token=secret|#secret/i);
  });

  it('loads valid logs while leaving malformed log-only settings isolated from valid parent telemetry', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'log-config-loader-'));
    tempDirs.push(projectRoot);
    await mkdir(join(projectRoot, '.ai-conductor'));
    await writeFile(join(projectRoot, '.ai-conductor', 'config.yml'), [
      'otel:',
      '  exporter: file',
      '  file: retained-parent.jsonl',
      '  logs:',
      '    enabled: true',
      '    endpoint: https://logs.example/ingest',
    ].join('\n'));

    const valid = await loadConfig(projectRoot);
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    expect(resolveLogConfig(valid.config)).toMatchObject({ enabled: true, endpoint: 'https://logs.example/ingest/v1/logs' });

    await writeFile(join(projectRoot, '.ai-conductor', 'config.yml'), [
      'otel:',
      '  exporter: file',
      '  file: retained-parent.jsonl',
      '  logs:',
      '    enabled: true',
      '    vendor: unapproved',
    ].join('\n'));

    const malformed = await loadConfig(projectRoot);
    expect(malformed.ok).toBe(true);
    if (!malformed.ok) return;
    expect(resolveOtelConfig(malformed.config, join(projectRoot, '.pipeline'))).toMatchObject({
      enabled: true,
      exporter: 'file',
      file: 'retained-parent.jsonl',
    });
    expect(resolveLogConfig(malformed.config)).toMatchObject({
      enabled: false,
      error: expect.stringMatching(/unknown otel\.logs\.vendor/i),
    });
  });
});
