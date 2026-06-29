import { describe, it, expect } from 'vitest';
import type { HarnessConfig, OtelConfig } from '../../src/types/config.js';

describe('OtelConfig type on HarnessConfig', () => {
  it('accepts a typed otel field with file exporter', () => {
    const cfg: HarnessConfig = {
      otel: { exporter: 'file', file: '.pipeline/otel.jsonl' },
    };
    expect(cfg.otel).toBeDefined();
    expect(cfg.otel?.exporter).toBe('file');
    expect(cfg.otel?.file).toBe('.pipeline/otel.jsonl');
  });

  it('accepts a typed otel field with otlp exporter', () => {
    const cfg: HarnessConfig = {
      otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' },
    };
    expect(cfg.otel?.exporter).toBe('otlp');
    expect(cfg.otel?.endpoint).toBe('http://localhost:4318');
  });

  it('accepts otel with protocol field', () => {
    const cfg: HarnessConfig = {
      otel: { exporter: 'otlp', endpoint: 'http://localhost:4317', protocol: 'grpc' },
    };
    expect(cfg.otel?.protocol).toBe('grpc');
  });

  it('otel field is optional on HarnessConfig', () => {
    const cfg: HarnessConfig = {};
    expect(cfg.otel).toBeUndefined();
  });

  it('OtelConfig type is exported and usable directly', () => {
    const otelCfg: OtelConfig = { exporter: 'file' };
    expect(otelCfg.exporter).toBe('file');
  });
});
