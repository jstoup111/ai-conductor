export const OTEL_SMOKE_ENV = 'AI_CONDUCTOR_OTEL_SMOKE';

export const OTLP_EXPORT_REFUSAL =
  '[otel] OTLP export refused: AI_CONDUCTOR_NO_REAL_EXEC=1 marks a test run; ' +
  'set AI_CONDUCTOR_OTEL_SMOKE=1 only in a smoke-tier test to opt in';

/**
 * Decides whether an OTLP network export is allowed for the supplied environment.
 *
 * The decision is intentionally pure so every OTLP export path, including a future
 * durable-spool drainer, can use identical test-run protection.
 */
export function otlpExportRefusal(env: NodeJS.ProcessEnv): string | null {
  if (env.AI_CONDUCTOR_NO_REAL_EXEC === '1' && env[OTEL_SMOKE_ENV] !== '1') {
    return OTLP_EXPORT_REFUSAL;
  }
  return null;
}
