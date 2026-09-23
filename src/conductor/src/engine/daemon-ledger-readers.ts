import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface DaemonExitRecord {
  [field: string]: unknown;
  type: 'daemon_exited';
  pid: number;
  code: number | null;
  signal: string | null;
  at: string;
}

export interface DaemonMemorySample {
  type: 'daemon_memory_sample';
  [field: string]: unknown;
}

export type DaemonLedgerReadResult<T> =
  | { event: T | null; skipped: number }
  | { error: Error };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readLastMatching<T>(
  path: string,
  matches: (event: Record<string, unknown>) => T | undefined,
): Promise<DaemonLedgerReadResult<T>> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { event: null, skipped: 0 };
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  let event: T | null = null;
  let skipped = 0;
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }
    if (isRecord(parsed)) {
      const matched = matches(parsed);
      if (matched !== undefined) event = matched;
    }
  }
  return { event, skipped };
}

function daemonExitRecord(event: Record<string, unknown>): DaemonExitRecord | undefined {
  if (event.type === 'daemon_exited'
    && typeof event.pid === 'number'
    && (typeof event.code === 'number' || event.code === null)
    && (typeof event.signal === 'string' || event.signal === null)
    && typeof event.at === 'string') {
    return event as unknown as DaemonExitRecord;
  }
  return undefined;
}

function daemonMemorySample(event: Record<string, unknown>): DaemonMemorySample | undefined {
  return event.type === 'daemon_memory_sample' ? event as DaemonMemorySample : undefined;
}

export function readLastExit(root: string, pid: number): Promise<DaemonLedgerReadResult<DaemonExitRecord>> {
  return readLastMatching(
    join(root, '.daemon', 'exit-events.jsonl'),
    (event) => {
      const exit = daemonExitRecord(event);
      return exit?.pid === pid ? exit : undefined;
    },
  );
}

export function readLastMemorySample(root: string): Promise<DaemonLedgerReadResult<DaemonMemorySample>> {
  return readLastMatching(join(root, '.daemon', 'events.jsonl'), daemonMemorySample);
}
