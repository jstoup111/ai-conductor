// Covers: task:6
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

  describe('environment-referenced headers', () => {
    const headerConfig = {
      otel: {
        exporter: 'otlp' as const,
        endpoint: 'http://localhost:4318',
        headers: { Authorization: { env: 'OTEL_TEST_AUTHORIZATION' } },
      },
    };

    it('resolves a configured header and reads its environment value on every resolution', () => {
      const previous = process.env.OTEL_TEST_AUTHORIZATION;
      try {
        process.env.OTEL_TEST_AUTHORIZATION = 'first-token';
        expect(resolveOtelConfig(headerConfig, PIPELINE_DIR)).toMatchObject({
          enabled: true,
          headers: { Authorization: 'first-token' },
        });

        process.env.OTEL_TEST_AUTHORIZATION = 'second-token';
        expect(resolveOtelConfig(headerConfig, PIPELINE_DIR)).toMatchObject({
          enabled: true,
          headers: { Authorization: 'second-token' },
        });
      } finally {
        if (previous === undefined) delete process.env.OTEL_TEST_AUTHORIZATION;
        else process.env.OTEL_TEST_AUTHORIZATION = previous;
      }
    });

    it('leaves the resolved result unchanged when headers are absent', () => {
      expect(
        resolveOtelConfig({ otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } }, PIPELINE_DIR),
      ).toEqual({ enabled: true, exporter: 'otlp', endpoint: 'http://localhost:4318' });
    });

    it.each([undefined, ''])('disables otlp when a referenced environment variable is %p', (value) => {
      const previous = process.env.OTEL_TEST_AUTHORIZATION;
      try {
        if (value === undefined) delete process.env.OTEL_TEST_AUTHORIZATION;
        else process.env.OTEL_TEST_AUTHORIZATION = value;

        const result = resolveOtelConfig(headerConfig, PIPELINE_DIR);
        expect(result).toMatchObject({ enabled: false });
        expect((result as { error?: string }).error).toContain('Authorization');
        expect((result as { error?: string }).error).toContain('OTEL_TEST_AUTHORIZATION');
      } finally {
        if (previous === undefined) delete process.env.OTEL_TEST_AUTHORIZATION;
        else process.env.OTEL_TEST_AUTHORIZATION = previous;
      }
    });

    it('retains only header and environment-variable names in the parsed configuration', () => {
      const previous = process.env.OTEL_TEST_AUTHORIZATION;
      try {
        process.env.OTEL_TEST_AUTHORIZATION = 'credential-value';
        resolveOtelConfig(headerConfig, PIPELINE_DIR);
        expect(headerConfig).toEqual({
          otel: {
            exporter: 'otlp',
            endpoint: 'http://localhost:4318',
            headers: { Authorization: { env: 'OTEL_TEST_AUTHORIZATION' } },
          },
        });
        expect(JSON.stringify(headerConfig)).not.toContain('credential-value');
      } finally {
        if (previous === undefined) delete process.env.OTEL_TEST_AUTHORIZATION;
        else process.env.OTEL_TEST_AUTHORIZATION = previous;
      }
    });

    it('accepts a well-formed mapping with no error or warning', () => {
      const previous = process.env.OTEL_TEST_AUTHORIZATION;
      try {
        process.env.OTEL_TEST_AUTHORIZATION = 'valid-token';
        const result = resolveOtelConfig(headerConfig, PIPELINE_DIR);
        expect(result).toEqual({
          enabled: true,
          exporter: 'otlp',
          endpoint: 'http://localhost:4318',
          headers: { Authorization: 'valid-token' },
        });
        expect((result as { error?: string }).error).toBeUndefined();
      } finally {
        if (previous === undefined) delete process.env.OTEL_TEST_AUTHORIZATION;
        else process.env.OTEL_TEST_AUTHORIZATION = previous;
      }
    });

    it.each([
      ['a literal credential', { Authorization: 'literal-credential' }, /Authorization.*literal credential/i],
      ['an unknown reference key', { Authorization: { env: 'OTEL_TEST_AUTHORIZATION', secret: true } }, /Authorization.*\{ env:/i],
      ['an absent reference key', { Authorization: {} }, /Authorization.*\{ env:/i],
      ['a non-string environment variable name', { Authorization: { env: 42 } }, /Authorization.*\{ env:/i],
      ['a non-mapping headers block', 'not-a-mapping', /headers.*mapping/i],
      ['an empty header name', { '': { env: 'OTEL_TEST_AUTHORIZATION' } }, /header ''/i],
      ['a header name containing a control character', { 'Bad\nHeader': { env: 'OTEL_TEST_AUTHORIZATION' } }, /Bad.*Header/i],
    ] as const)('refuses %s by name', (_caseName, headers, errorPattern) => {
      const result = resolveOtelConfig(
        {
          otel: {
            exporter: 'otlp',
            endpoint: 'http://localhost:4318',
            headers,
          } as never,
        },
        PIPELINE_DIR,
      );

      expect(result).toMatchObject({ enabled: false });
      expect((result as { error?: string }).error).toMatch(errorPattern);
    });

    it.each([
      ['grpc protocol', { exporter: 'otlp', endpoint: 'http://localhost:4317', protocol: 'grpc', headers: headerConfig.otel.headers }, /grpc.*headers|headers.*grpc/i],
      ['file exporter', { exporter: 'file', headers: headerConfig.otel.headers }, /file.*headers|headers.*file/i],
    ] as const)('refuses headers with the %s', (_caseName, otel, errorPattern) => {
      const result = resolveOtelConfig({ otel }, PIPELINE_DIR);

      expect(result).toMatchObject({ enabled: false });
      expect((result as { error?: string }).error).toMatch(errorPattern);
    });

    it('never includes an environment value in a header-related error', () => {
      const previous = process.env.OTEL_TEST_AUTHORIZATION;
      const sentinel = 'distinctive-sentinel-secret';
      try {
        process.env.OTEL_TEST_AUTHORIZATION = sentinel;
        const result = resolveOtelConfig(
          {
            otel: {
              exporter: 'otlp',
              endpoint: 'http://localhost:4318',
              headers: { Authorization: { env: 'OTEL_TEST_AUTHORIZATION', secret: true } },
            } as never,
          },
          PIPELINE_DIR,
        );

        const error = (result as { error?: string }).error ?? '';
        expect(error).toContain('Authorization');
        expect(error).toContain('OTEL_TEST_AUTHORIZATION');
        expect(error).not.toContain(sentinel);
      } finally {
        if (previous === undefined) delete process.env.OTEL_TEST_AUTHORIZATION;
        else process.env.OTEL_TEST_AUTHORIZATION = previous;
      }
    });
  });

  describe('project_name', () => {
    it('carries a trimmed configured project name on both enabled variants and omits blank values', () => {
      const configs = [
        resolveOtelConfig(
          { otel: { exporter: 'file', project_name: '  tenant-a  ' } },
          PIPELINE_DIR,
        ),
        resolveOtelConfig(
          {
            otel: {
              exporter: 'otlp',
              endpoint: 'http://localhost:4318',
              project_name: 'tenant-b',
            },
          },
          PIPELINE_DIR,
        ),
        resolveOtelConfig({ otel: { exporter: 'file', project_name: '   ' } }, PIPELINE_DIR),
        resolveOtelConfig({ otel: { exporter: 'file', project_name: '' } }, PIPELINE_DIR),
      ];

      expect(configs).toEqual([
        { enabled: true, exporter: 'file', file: `${PIPELINE_DIR}/otel.jsonl`, projectName: 'tenant-a' },
        {
          enabled: true,
          exporter: 'otlp',
          endpoint: 'http://localhost:4318',
          projectName: 'tenant-b',
        },
        { enabled: true, exporter: 'file', file: `${PIPELINE_DIR}/otel.jsonl` },
        { enabled: true, exporter: 'file', file: `${PIPELINE_DIR}/otel.jsonl` },
      ]);
    });
  });
});
