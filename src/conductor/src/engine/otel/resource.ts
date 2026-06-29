import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { Resource } from '@opentelemetry/resources';

const SERVICE_NAME = 'ai-conductor';

export interface ResourceContext {
  /** Absolute path to the .pipeline directory. Used to read conduct-session-id. */
  pipelineDir: string;
  /** Feature name / description. Defaults to 'unknown'. */
  feature?: string;
  /** Project name. Defaults to 'unknown'. */
  project?: string;
  /**
   * Override the run id. When supplied, the session-id file and generated id
   * are both bypassed. Used by tests that need deterministic run ids.
   */
  runId?: string;
}

/**
 * Build an OTel Resource with conductor-specific attributes (FR-6).
 *
 * `conductor.run.id` resolution order:
 *   1. `ctx.runId` if supplied (test/injection override)
 *   2. Content of `.pipeline/conduct-session-id` (sync read; file may not exist)
 *   3. Freshly generated UUID (guarantees non-empty; two calls produce distinct ids)
 *
 * This function is synchronous and NEVER throws — missing session-id file results
 * in a generated id.
 */
export function buildResource(ctx: ResourceContext): Resource {
  const runId = ctx.runId ?? resolveRunId(ctx.pipelineDir);
  const feature = ctx.feature ?? 'unknown';
  const project = ctx.project ?? 'unknown';

  return new Resource({
    'service.name': SERVICE_NAME,
    'conductor.run.id': runId,
    'conductor.feature': feature,
    'conductor.project': project,
  });
}

function resolveRunId(pipelineDir: string): string {
  try {
    const content = readFileSync(join(pipelineDir, 'conduct-session-id'), 'utf-8');
    const trimmed = content.trim();
    if (trimmed.length > 0) return trimmed;
  } catch {
    // File absent or unreadable — fall through to generated id.
  }
  return uuidv4();
}
