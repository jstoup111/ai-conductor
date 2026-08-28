import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

export const ENGINEER_RUN_MARKER_RELATIVE_PATH = '.pipeline/engineer-run.json';

export interface EngineerRunMarker {
  schemaVersion: 1;
  engineerRunId: string;
  repoRoot: string;
  planSlug: string;
  branch: string;
}

export async function writeEngineerRunMarker(
  worktreePath: string,
  marker: EngineerRunMarker,
): Promise<void> {
  validateMarker(marker);
  const path = join(worktreePath, ENGINEER_RUN_MARKER_RELATIVE_PATH);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp.${process.pid}`;
  await writeFile(temporary, JSON.stringify(marker, null, 2) + '\n', 'utf-8');
  await rename(temporary, path);
}

export async function readEngineerRunMarker(
  worktreePath: string,
): Promise<EngineerRunMarker | null> {
  const path = join(worktreePath, ENGINEER_RUN_MARKER_RELATIVE_PATH);
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Engineer run marker at ${path} is malformed JSON`);
  }
  validateMarker(parsed, path);
  return parsed;
}

function validateMarker(value: unknown, path = 'Engineer run marker'): asserts value is EngineerRunMarker {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} is malformed: expected an object`);
  }
  const marker = value as Record<string, unknown>;
  if (marker.schemaVersion !== 1) {
    throw new Error(`${path} uses unsupported schema version ${JSON.stringify(marker.schemaVersion)}`);
  }
  for (const field of ['engineerRunId', 'repoRoot', 'planSlug', 'branch'] as const) {
    if (typeof marker[field] !== 'string' || marker[field].trim() === '') {
      throw new Error(`${path} is malformed: ${field} must be a non-empty string`);
    }
  }
  if (!isAbsolute(marker.repoRoot as string)) {
    throw new Error(`${path} is malformed: repoRoot must be absolute`);
  }
}
