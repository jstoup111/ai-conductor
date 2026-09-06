import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveMainRepoRoot } from './park-marker.js';
import { TASK_ID_PATTERN } from './plan-task-parse.js';

const RESTAGE_WATERMARKS_SUBDIR = 'restage-watermarks';

interface RestageWatermarkFile {
  version: 1;
  tasks: Record<string, number>;
}

export type RestageWatermarkReadResult =
  | { kind: 'absent' }
  | { kind: 'ok'; tasks: Record<string, number> }
  | { kind: 'corrupt'; detail: string };

export interface RestageWatermarkEntry {
  id: string;
  trailerCount: number;
}

export type RecordRestageWatermarksResult =
  | { kind: 'ok' }
  | { kind: 'failed'; detail: string };

export interface RecordRestageWatermarksDependencies {
  resolveMainRepoRoot?: typeof resolveMainRepoRoot;
}

const TASK_ID = new RegExp(`^${TASK_ID_PATTERN}$`);

function isRestageWatermarkFile(value: unknown): value is RestageWatermarkFile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2 || !Object.hasOwn(record, 'version') || !Object.hasOwn(record, 'tasks')) return false;
  if (record.version !== 1 || typeof record.tasks !== 'object' || record.tasks === null || Array.isArray(record.tasks)) {
    return false;
  }
  return Object.entries(record.tasks).every(([id, count]) => TASK_ID.test(id) && typeof count === 'number' && Number.isInteger(count) && count >= 0);
}

export function restageWatermarkPath(mainRoot: string, stem: string): string {
  return join(mainRoot, '.daemon', RESTAGE_WATERMARKS_SUBDIR, `${stem}.json`);
}

export async function readRestageWatermarks(
  projectRoot: string,
  stem: string,
): Promise<RestageWatermarkReadResult> {
  const mainRoot = await resolveMainRepoRoot(projectRoot);
  const path = restageWatermarkPath(mainRoot, stem);
  let contents: string;
  try {
    contents = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' };
    return { kind: 'corrupt', detail: `Unable to read restage watermark ${path}` };
  }

  try {
    const parsed: unknown = JSON.parse(contents);
    if (!isRestageWatermarkFile(parsed)) {
      return { kind: 'corrupt', detail: `Invalid restage watermark ${path}` };
    }
    return { kind: 'ok', tasks: parsed.tasks };
  } catch {
    return { kind: 'corrupt', detail: `Unable to parse restage watermark ${path}` };
  }
}

export async function recordRestageWatermarks(
  projectRoot: string,
  stem: string,
  entries: readonly RestageWatermarkEntry[],
  dependencies: RecordRestageWatermarksDependencies = {},
): Promise<RecordRestageWatermarksResult> {
  let mainRoot: string;
  try {
    mainRoot = await (dependencies.resolveMainRepoRoot ?? resolveMainRepoRoot)(projectRoot);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { kind: 'failed', detail: `Unable to resolve main root for restage watermark: ${detail}` };
  }
  const path = restageWatermarkPath(mainRoot, stem);
  await mkdir(join(mainRoot, '.daemon', RESTAGE_WATERMARKS_SUBDIR), { recursive: true });

  let existingTasks: Record<string, number> = {};
  try {
    const contents = await readFile(path, 'utf8');
    existingTasks = (JSON.parse(contents) as RestageWatermarkFile).tasks;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const tasks = { ...existingTasks };
  for (const { id, trailerCount } of entries) {
    if (!(id in tasks)) tasks[id] = trailerCount;
  }
  const watermark: RestageWatermarkFile = {
    version: 1,
    tasks,
  };
  const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(watermark, null, 2) + '\n', 'utf8');
  await rename(temporaryPath, path);
  return { kind: 'ok' };
}
