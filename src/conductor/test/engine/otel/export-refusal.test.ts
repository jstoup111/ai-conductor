import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildExporters } from '../../../src/engine/otel/transport.js';
import type { ResolvedOtelConfig } from '../../../src/engine/otel/otel-config.js';
import {
  OTEL_SMOKE_ENV,
  OTLP_EXPORT_REFUSAL,
  otlpExportRefusal,
} from '../../../src/engine/otel/export-refusal.js';

const refusalEnv = { AI_CONDUCTOR_NO_REAL_EXEC: '1' };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('otlpExportRefusal', () => {
  it('refuses an OTLP export in a marked test run and names both controls', () => {
    const refusal = otlpExportRefusal(refusalEnv);

    expect(refusal).toBe(OTLP_EXPORT_REFUSAL);
    expect(refusal).toContain('AI_CONDUCTOR_NO_REAL_EXEC');
    expect(refusal).toContain('AI_CONDUCTOR_OTEL_SMOKE');
  });

  it('allows the explicit smoke-tier opt-in', () => {
    expect(otlpExportRefusal({ ...refusalEnv, [OTEL_SMOKE_ENV]: '1' })).toBeNull();
  });

  it.each(['true', '0', '', ' 1 '])('refuses non-exact smoke opt-in value %j', (smokeOptIn) => {
    expect(otlpExportRefusal({ ...refusalEnv, [OTEL_SMOKE_ENV]: smokeOptIn })).toContain(
      'AI_CONDUCTOR_NO_REAL_EXEC',
    );
  });

  it('allows exports whenever its supplied environment lacks the test marker', () => {
    vi.stubEnv('AI_CONDUCTOR_NO_REAL_EXEC', '1');

    expect(otlpExportRefusal({ [OTEL_SMOKE_ENV]: '1' })).toBeNull();
    expect(otlpExportRefusal({})).toBeNull();
  });
});

describe('buildExporters without the test marker', () => {
  const config: Extract<ResolvedOtelConfig, { enabled: true; exporter: 'otlp' }> = {
    enabled: true,
    exporter: 'otlp',
    endpoint: 'http://localhost:4318',
    provenance: { commit: true, pr: true, issue: true, feature: true },
  };

  it('builds the same exporter types whether the smoke opt-in is unset or set', () => {
    vi.stubEnv('AI_CONDUCTOR_NO_REAL_EXEC', undefined);
    vi.stubEnv(OTEL_SMOKE_ENV, undefined);
    const withoutOptIn = buildExporters(config);

    vi.stubEnv(OTEL_SMOKE_ENV, 'anything');
    const withOptIn = buildExporters(config);

    expect(withOptIn.spanExporter).toBeInstanceOf(withoutOptIn.spanExporter.constructor);
    expect(withOptIn.metricExporter).toBeInstanceOf(withoutOptIn.metricExporter.constructor);
  });
});
