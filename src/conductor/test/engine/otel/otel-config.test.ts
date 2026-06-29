import { describe, it, expect } from 'vitest';
import { resolveOtelConfig } from '../../../src/engine/otel/otel-config.js';

const PIPELINE_DIR = '/tmp/test-pipeline';

describe('resolveOtelConfig', () => {
  describe('absent otel block', () => {
    it('returns { enabled: false } with no error when otel is absent', () => {
      const result = resolveOtelConfig({}, PIPELINE_DIR);
      expect(result.enabled).toBe(false);
      expect((result as { error?: string }).error).toBeUndefined();
    });

    it('returns { enabled: false } when otel is undefined explicitly', () => {
      const result = resolveOtelConfig({ otel: undefined }, PIPELINE_DIR);
      expect(result.enabled).toBe(false);
    });
  });

  describe('exporter: otlp without endpoint', () => {
    it('returns disabled with named error when otlp has no endpoint', () => {
      const result = resolveOtelConfig(
        { otel: { exporter: 'otlp' } },
        PIPELINE_DIR,
      );
      expect(result.enabled).toBe(false);
      expect((result as { error?: string }).error).toMatch(/endpoint/i);
    });

    it('never throws', () => {
      expect(() =>
        resolveOtelConfig({ otel: { exporter: 'otlp' } }, PIPELINE_DIR),
      ).not.toThrow();
    });
  });

  describe('unknown exporter value', () => {
    it('returns disabled with error listing valid options', () => {
      const result = resolveOtelConfig(
        { otel: { exporter: 'kafka' as 'otlp' } },
        PIPELINE_DIR,
      );
      expect(result.enabled).toBe(false);
      const err = (result as { error?: string }).error ?? '';
      expect(err).toMatch(/otlp/);
      expect(err).toMatch(/file/);
    });
  });

  describe('exporter: file', () => {
    it('returns enabled with default path when no file path given', () => {
      const result = resolveOtelConfig(
        { otel: { exporter: 'file' } },
        PIPELINE_DIR,
      );
      expect(result.enabled).toBe(true);
      expect((result as { file?: string }).file).toBe(`${PIPELINE_DIR}/otel.jsonl`);
    });

    it('returns enabled with custom file path when provided', () => {
      const result = resolveOtelConfig(
        { otel: { exporter: 'file', file: '/custom/path.jsonl' } },
        PIPELINE_DIR,
      );
      expect(result.enabled).toBe(true);
      expect((result as { file?: string }).file).toBe('/custom/path.jsonl');
    });
  });

  describe('exporter: otlp with endpoint', () => {
    it('returns enabled with endpoint when valid', () => {
      const result = resolveOtelConfig(
        { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
        PIPELINE_DIR,
      );
      expect(result.enabled).toBe(true);
      expect((result as { endpoint?: string }).endpoint).toBe('http://localhost:4318');
    });

    it('carries protocol when specified', () => {
      const result = resolveOtelConfig(
        { otel: { exporter: 'otlp', endpoint: 'http://localhost:4317', protocol: 'grpc' } },
        PIPELINE_DIR,
      );
      expect(result.enabled).toBe(true);
      expect((result as { protocol?: string }).protocol).toBe('grpc');
    });
  });
});
