import { join } from 'node:path';
import type { HarnessConfig } from '../../types/config.js';

const VALID_EXPORTERS = ['otlp', 'file'] as const;
const DEFAULT_FILE = 'otel.jsonl';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasHeaderEntries(headers: unknown): boolean {
  return headers !== undefined && (!isPlainObject(headers) || Object.keys(headers).length > 0);
}

function renderedHeaderName(header: string): string {
  return header === '' ? "''" : JSON.stringify(header);
}

function unsupportedHeaderTransportError(headers: unknown, transport: string): string {
  const firstHeader = isPlainObject(headers) ? Object.entries(headers)[0] : undefined;
  if (!firstHeader) return `otel headers are unsupported with the ${transport}.`;

  const [header, reference] = firstHeader;
  const environmentVariable = isPlainObject(reference) && typeof reference.env === 'string'
    ? reference.env
    : undefined;
  return `otel header ${renderedHeaderName(header)}${environmentVariable ? ` references environment variable '${environmentVariable}' and` : ''} is unsupported with the ${transport}.`;
}

/**
 * Resolved OTel config. A discriminated union:
 *   { enabled: false }            — exporter is off; error is set if config was invalid
 *   { enabled: true, ...fields }  — exporter is active with validated transport fields
 *
 * `resolveOtelConfig` NEVER throws. All invalid configs produce `enabled: false` + `error`.
 */
export type ResolvedOtelConfig =
  | { enabled: false; error?: string }
  | {
      enabled: true;
      exporter: 'otlp';
      endpoint: string;
      protocol?: 'http/protobuf' | 'grpc';
      headers?: Record<string, string>;
      projectName?: string;
    }
  | { enabled: true; exporter: 'file'; file: string; projectName?: string };

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

  const { exporter, endpoint, file, protocol, headers, project_name } = otel;
  const projectName = project_name?.trim() || undefined;

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
    if (headers !== undefined && !isPlainObject(headers)) {
      return {
        enabled: false,
        error: 'otel headers must be a mapping from header names to { env: <variable name> } references.',
      };
    }

    if (hasHeaderEntries(headers) && protocol === 'grpc') {
      return {
        enabled: false,
        error: unsupportedHeaderTransportError(headers, 'grpc protocol'),
      };
    }

    const resolvedHeaders: Record<string, string> = Object.create(null);
    if (headers && hasHeaderEntries(headers)) {
      for (const [header, reference] of Object.entries(headers)) {
        const headerName = renderedHeaderName(header);
        if (header === '' || /[\x00-\x1F\x7F]/.test(header)) {
          return {
            enabled: false,
            error: `otel header ${headerName} must be a non-empty name without control characters.`,
          };
        }
        if (typeof reference === 'string') {
          return {
            enabled: false,
            error: `otel header ${headerName} refuses a literal credential in configuration; use { env: <variable name> }.`,
          };
        }
        const environmentVariable = isPlainObject(reference) && typeof reference.env === 'string'
          ? reference.env
          : undefined;
        if (!isPlainObject(reference) || Object.keys(reference).length !== 1 || !('env' in reference) || environmentVariable === undefined || environmentVariable === '') {
          return {
            enabled: false,
            error: `otel header ${headerName}${environmentVariable ? ` references environment variable '${environmentVariable}',` : ''} must use the supported reference form { env: <variable name> }.`,
          };
        }
        const value = process.env[environmentVariable];
        if (!value) {
          return {
            enabled: false,
            error: `otel header ${headerName} references environment variable '${environmentVariable}', which is unset or empty.`,
          };
        }
        resolvedHeaders[header] = value;
      }
    }

    return {
      enabled: true,
      exporter: 'otlp',
      endpoint,
      ...(protocol ? { protocol } : {}),
      ...(hasHeaderEntries(headers) ? { headers: resolvedHeaders } : {}),
      ...(projectName ? { projectName } : {}),
    };
  }

  // exporter === 'file'
  if (hasHeaderEntries(headers)) {
    return {
      enabled: false,
      error: unsupportedHeaderTransportError(headers, 'file exporter'),
    };
  }
  const resolvedFile = file ?? join(pipelineDir, DEFAULT_FILE);
  return {
    enabled: true,
    exporter: 'file',
    file: resolvedFile,
    ...(projectName ? { projectName } : {}),
  };
}
