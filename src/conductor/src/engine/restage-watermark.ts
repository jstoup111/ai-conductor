import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveMainRepoRoot } from './park-marker.js';

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
    const parsed = JSON.parse(contents) as RestageWatermarkFile;
    return { kind: 'ok', tasks: parsed.tasks };
  } catch {
    return { kind: 'corrupt', detail: `Unable to parse restage watermark ${path}` };
  }
}

export async function recordRestageWatermarks(
  projectRoot: string,
  stem: string,
  entries: readonly RestageWatermarkEntry[],
): Promise<void> {
  const mainRoot = await resolveMainRepoRoot(projectRoot);
  const path = restageWatermarkPath(mainRoot, stem);
  await mkdir(join(mainRoot, '.daemon', RESTAGE_WATERMARKS_SUBDIR), { recursive: true });

  const watermark: RestageWatermarkFile = {
    version: 1,
    tasks: Object.fromEntries(entries.map(({ id, trailerCount }) => [id, trailerCount])),
  };
  const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(watermark, null, 2) + '\n', 'utf8');
  await rename(temporaryPath, path);
}
