import { join } from 'node:path';
import type { HarnessConfig } from '../../types/config.js';

const VALID_EXPORTERS = ['otlp', 'file'] as const;
const DEFAULT_FILE = 'otel.jsonl';

/**
 * Resolved OTel config. A discriminated union:
 *   { enabled: false }            — exporter is off; error is set if config was invalid
 *   { enabled: true, ...fields }  — exporter is active with validated transport fields
 *
 * `resolveOtelConfig` NEVER throws. All invalid configs produce `enabled: false` + `error`.
 */
export type ResolvedOtelConfig =
  | { enabled: false; error?: string }
  | { enabled: true; exporter: 'otlp'; endpoint: string; protocol?: 'http/protobuf' | 'grpc' }
  | { enabled: true; exporter: 'file'; file: string };

/**
 * Parse and validate the `otel:` block from `config`. Returns a discriminated
 * `ResolvedOtelConfig`. Never throws.
 *
 * @param config   - The HarnessConfig (or partial) to read `otel` from.
 * @param pipelineDir - Absolute path to `.pipeline/` for resolving default file path.
 */
export function resolveOtelConfig(
  config: Pick<HarnessConfig, 'otel'>,
  pipelineDir: string,
): ResolvedOtelConfig {
  const otel = config.otel;

  // Absent block → disabled, no error (FR-1 default-off).
  if (!otel) {
    return { enabled: false };
  }

  const { exporter, endpoint, file, protocol } = otel;

  // Unknown exporter → disabled + named error listing valid options.
  if (!VALID_EXPORTERS.includes(exporter as (typeof VALID_EXPORTERS)[number])) {
    return {
      enabled: false,
      error: `Unknown otel exporter '${exporter}'. Valid options: ${VALID_EXPORTERS.join(', ')}.`,
    };
  }

  if (exporter === 'otlp') {
    // OTLP without endpoint → disabled + named error.
    if (!endpoint) {
      return {
        enabled: false,
        error:
          "otel exporter='otlp' requires an 'endpoint' URL (e.g. http://localhost:4318). " +
          'No endpoint was provided.',
      };
    }
    return {
      enabled: true,
      exporter: 'otlp',
      endpoint,
      ...(protocol ? { protocol } : {}),
    };
  }

  // exporter === 'file'
  const resolvedFile = file ?? join(pipelineDir, DEFAULT_FILE);
  return {
    enabled: true,
    exporter: 'file',
    file: resolvedFile,
  };
}
