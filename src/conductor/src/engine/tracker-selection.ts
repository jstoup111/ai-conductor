import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { validateTrackerConfig } from './config.js';
import type { TrackerConfig } from '../types/config.js';

export type TrackerSelection = TrackerConfig;

export type TrackerSelectionResult =
  | { ok: true; selection: TrackerSelection }
  | { ok: false; reason: 'invalid-config'; detail: string };

const githubSelection: TrackerSelection = { backend: 'github' };

/**
 * Resolve the tracker block from a project's raw config without validating
 * unrelated project configuration.
 */
export async function resolveTrackerSelection(projectPath: string): Promise<TrackerSelectionResult> {
  let raw: string;
  try {
    raw = await readFile(join(projectPath, '.ai-conductor', 'config.yml'), 'utf8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: true, selection: githubSelection };
    }
    return {
      ok: false,
      reason: 'invalid-config',
      detail: 'Failed to read tracker configuration',
    };
  }

  let parsed: unknown;
  try {
    parsed = loadYaml(raw.trim() === '' ? '{}' : raw);
  } catch {
    return {
      ok: false,
      reason: 'invalid-config',
      detail: 'Failed to parse tracker configuration',
    };
  }

  const tracker = parsed !== null && typeof parsed === 'object'
    ? (parsed as Record<string, unknown>).tracker
    : undefined;
  const validationError = validateTrackerConfig(tracker);
  if (validationError) {
    return { ok: false, reason: 'invalid-config', detail: validationError.message };
  }

  return {
    ok: true,
    selection: tracker === undefined ? githubSelection : tracker as TrackerSelection,
  };
}
