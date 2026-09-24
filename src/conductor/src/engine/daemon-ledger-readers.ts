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
  ts?: string;
  [field: string]: unknown;
}

export type DaemonTimelineRecord = DaemonExitRecord | DaemonMemorySample;

export type DaemonLedgerReadResult<T> =
  | { event: T | null; skipped: number }
  | { error: Error };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readLastMatching<T>(
  path: string,
  matches: (event: Record<string, unknown>) => T | undefined,
  timestamp: (event: T) => string | undefined,
): Promise<DaemonLedgerReadResult<T>> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { event: null, skipped: 0 };
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  let event: T | null = null;
  let latestTimestamp: number | null = null;
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
      if (matched !== undefined) {
        const candidateTimestamp = Date.parse(timestamp(matched) ?? '');
        // Timestamp order is authoritative when both records carry parseable
        // timestamps. Equal or unparseable timestamps preserve append order.
        if (event === null || Number.isNaN(candidateTimestamp) || latestTimestamp === null || candidateTimestamp >= latestTimestamp) {
          event = matched;
          latestTimestamp = Number.isNaN(candidateTimestamp) ? null : candidateTimestamp;
        }
      }
    }
  }
  return { event, skipped };
}

async function readTimelineLedger(path: string): Promise<DaemonLedgerReadResult<DaemonTimelineRecord[]>> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { event: [], skipped: 0 };
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  const event: DaemonTimelineRecord[] = [];
  let skipped = 0;
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed)) {
        skipped += 1;
      } else {
        const record = daemonExitRecord(parsed) ?? daemonMemorySample(parsed);
        if (record) event.push(record);
      }
    } catch {
      skipped += 1;
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
    (exit) => exit.at,
  );
}

/** Read both daemon ledgers as one timestamp-ordered diagnostic timeline. */
export async function readDaemonTimeline(root: string): Promise<DaemonLedgerReadResult<DaemonTimelineRecord[]>> {
  const [exits, samples] = await Promise.all([
    readTimelineLedger(join(root, '.daemon', 'exit-events.jsonl')),
    readTimelineLedger(join(root, '.daemon', 'events.jsonl')),
  ]);
  if ('error' in exits) return exits;
  if ('error' in samples) return samples;

  return {
    event: [...(exits.event ?? []), ...(samples.event ?? [])]
      .map((record, index) => ({ record, index, timestamp: Date.parse(record.type === 'daemon_exited' ? record.at : record.ts ?? '') }))
      .sort((left, right) => {
        if (Number.isNaN(left.timestamp) || Number.isNaN(right.timestamp)) return left.index - right.index;
        return left.timestamp - right.timestamp || left.index - right.index;
      })
      .map(({ record }) => record),
    skipped: exits.skipped + samples.skipped,
  };
}
