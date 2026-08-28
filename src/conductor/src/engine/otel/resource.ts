import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { resourceFromAttributes, type Resource } from '@opentelemetry/resources';

const SERVICE_NAME = 'ai-conductor';

export interface ResourceContext {
  /** Absolute path to the .pipeline directory. Used to read conduct-session-id. */
  pipelineDir: string;
  /** Feature name / description. Defaults to 'unknown'. */
  feature?: string;
  /** Project name. Defaults to 'unknown'. */
  project?: string;
  /** Resolved project identity for service.instance.id. Defaults to 'unknown'. */
  projectName?: string;
  /** Git branch for the active run. Defaults to 'unknown'. */
  branch?: string;
  /** Harness engine version for the active run. Defaults to 'unknown'. */
  engineVersion?: string;
  /**
   * Override the run id. When supplied, the session-id file and generated id
   * are both bypassed. Used by tests that need deterministic run ids.
   */
  runId?: string;
}

/**
 * Which signal a Resource is being built for. Metric backends fold the whole
 * resource attribute set into `target_info`'s label set, so a run-varying
 * attribute on the metric Resource mints a series per run exactly as a
 * data-point attribute would. Traces carry no such cost — each trace is unique
 * already — so the run id and the engine version ride the trace scope only.
 * See adr-014's 2026-08-28 amendment.
 */
export type ResourceSignal = 'metrics' | 'traces';

/**
 * Build an OTel Resource with conductor-specific attributes (FR-6).
 *
 * `conductor.run.id` resolution order:
 *   1. `ctx.runId` if supplied (test/injection override)
 *   2. Content of `.pipeline/conduct-session-id` (sync read; file may not exist)
 *   3. Freshly generated and persisted UUID (reused after process restart)
 *
 * This function is synchronous and NEVER throws — missing session-id file results
 * in a generated id.
 */
export function buildResource(ctx: ResourceContext, signal: ResourceSignal = 'traces'): Resource {
  const feature = ctx.feature ?? 'unknown';
  const project = ctx.project ?? 'unknown';
  const projectName = ctx.projectName ?? 'unknown';
  const branch = ctx.branch ?? 'unknown';

  const featureStable = {
    'service.name': SERVICE_NAME,
    'service.instance.id': `${projectName}/${feature}`,
    'conductor.feature': feature,
    'conductor.project': project,
    'conductor.branch': branch,
  };
  // Every value above is fixed for a feature's lifetime, so `target_info` holds
  // one row per feature rather than one per run. Resolving the run id is also
  // skipped here: it writes the session-id file as a side effect, and the
  // metric scope has no use for the value.
  if (signal === 'metrics') return resourceFromAttributes(featureStable);

  return resourceFromAttributes({
    ...featureStable,
    'conductor.run.id': ctx.runId ?? resolveRunId(ctx.pipelineDir),
    'conductor.engine.version': ctx.engineVersion ?? 'unknown',
  });
}

function resolveRunId(pipelineDir: string): string {
  try {
    const content = readFileSync(join(pipelineDir, 'conduct-session-id'), 'utf-8');
    const trimmed = content.trim();
    if (trimmed.length > 0) return trimmed;
  } catch {
    // File absent or unreadable — create the feature-run identity below.
  }
  const runId = uuidv4();
  try {
    mkdirSync(pipelineDir, { recursive: true });
    writeFileSync(join(pipelineDir, 'conduct-session-id'), runId, 'utf-8');
  } catch {
    // Telemetry setup must remain best-effort; the in-process ID is still valid.
  }
  return runId;
}
