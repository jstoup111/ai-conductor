import { join } from 'node:path';
import { slugify } from './worktree.js';

/**
 * Per-feature state, session id, and event log live under
 * `<projectRoot>/.pipeline/features/<slug>/`. This keeps two features in
 * the same project root from sharing a single conduct-state.json (and a
 * single Claude session id) before each one moves into its own worktree.
 *
 * `<projectRoot>/.pipeline/` itself still hosts cross-feature artifacts:
 *   - `project-state.json` (bootstrap_mode and any future project-scoped keys)
 *   - the `features/` parent directory.
 */
export interface FeaturePaths {
  pipelineDir: string;
  stateFilePath: string;
  sessionIdPath: string;
  eventsLogPath: string;
}

export const FEATURES_DIR = 'features';

export function rootPipelineDir(projectRoot: string): string {
  return join(projectRoot, '.pipeline');
}

export function projectStatePath(projectRoot: string): string {
  return join(rootPipelineDir(projectRoot), 'project-state.json');
}

export function featurePipelineDir(projectRoot: string, slug: string): string {
  return join(rootPipelineDir(projectRoot), FEATURES_DIR, slug);
}

export function resolveFeaturePaths(projectRoot: string, featureDesc: string): FeaturePaths {
  const slug = slugify(featureDesc);
  const pipelineDir = featurePipelineDir(projectRoot, slug);
  return {
    pipelineDir,
    stateFilePath: join(pipelineDir, 'conduct-state.json'),
    sessionIdPath: join(pipelineDir, 'conduct-session-id'),
    eventsLogPath: join(pipelineDir, 'events.jsonl'),
  };
}

/**
 * Paths used when no feature is in scope (e.g., `--cleanup`, or commands
 * that scan-and-pick before they know which feature to operate on).
 * `stateFilePath` here points at the legacy root location for the duration
 * of the migration window — it should NOT be used to read/write live state.
 */
export function resolveRootPaths(projectRoot: string): FeaturePaths {
  const pipelineDir = rootPipelineDir(projectRoot);
  return {
    pipelineDir,
    stateFilePath: join(pipelineDir, 'conduct-state.json'),
    sessionIdPath: join(pipelineDir, 'conduct-session-id'),
    eventsLogPath: join(pipelineDir, 'events.jsonl'),
  };
}
