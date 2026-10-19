// executor-records.ts — durable references from feature executors to their
// pinned engine builds. These records answer what is true now and are read by
// name as authority for successor takeover and engine-store GC (event-spine
// exception C), rather than serving as an occurrence channel.

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const EXECUTORS_DIRECTORY = 'executors';

export interface ExecutorRecord {
  pid: number;
  engineDir: string;
  engineVersionId: string;
  startedAt: string;
}

export type ExecutorRecordEntry =
  | { kind: 'record'; slug: string; record: ExecutorRecord }
  | { kind: 'unreadable'; slug: string };

/**
 * Process operations are explicit dependencies so ordinary tests never probe
 * or signal a real process. Production defaults are deliberately narrow:
 * liveness is a signal-0 probe, the command line comes from procfs, and only
 * a confirmed executor entrypoint receives SIGTERM.
 */
export interface ExecutorRecordProcessBoundaries {
  isPidAlive(pid: number): boolean | Promise<boolean>;
  readCommandLine(pid: number): string | Promise<string>;
  kill(pid: number, signal: NodeJS.Signals): void | Promise<void>;
}

function executorsDirectory(repoRoot: string): string {
  return join(repoRoot, '.daemon', EXECUTORS_DIRECTORY);
}

function executorRecordPath(repoRoot: string, slug: string): string {
  return join(executorsDirectory(repoRoot), `${slug}.json`);
}

function isExecutorRecord(value: unknown): value is ExecutorRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const candidate = value as Record<string, unknown>;
  return Number.isInteger(candidate.pid)
    && (candidate.pid as number) > 0
    && typeof candidate.engineDir === 'string'
    && candidate.engineDir.length > 0
    && typeof candidate.engineVersionId === 'string'
    && candidate.engineVersionId.length > 0
    && typeof candidate.startedAt === 'string'
    && candidate.startedAt.length > 0;
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM proves that a process exists even though this supervisor cannot
    // signal it. Any other failure is conservatively left to the command-line
    // confirmation / kill path rather than being treated as a dead record.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function defaultReadCommandLine(pid: number): Promise<string> {
  return readFile(`/proc/${pid}/cmdline`, 'utf8');
}

function defaultKill(pid: number, signal: NodeJS.Signals): void {
  process.kill(pid, signal);
}

const defaultProcessBoundaries: ExecutorRecordProcessBoundaries = {
  isPidAlive: defaultIsPidAlive,
  readCommandLine: defaultReadCommandLine,
  kill: defaultKill,
};

/** Atomically replace the named executor's current durable reference record. */
export async function writeExecutorRecord(
  repoRoot: string,
  slug: string,
  record: ExecutorRecord,
): Promise<void> {
  const directory = executorsDirectory(repoRoot);
  const recordPath = executorRecordPath(repoRoot, slug);
  const temporaryPath = join(directory, `.${slug}.${randomUUID()}.tmp`);

  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporaryPath, JSON.stringify(record), 'utf8');
    // Same-directory rename is an atomic publication: readers observe either
    // the prior complete record or this complete record, never a torn JSON file.
    await rename(temporaryPath, recordPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

/** Remove a record once its executor has exited; absence is already settled. */
export async function removeExecutorRecord(repoRoot: string, slug: string): Promise<void> {
  await rm(executorRecordPath(repoRoot, slug), { force: true });
}

/**
 * Lists every named record without collapsing corruption into absence. A
 * consumer such as engine-store GC can therefore fail closed on uncertainty.
 */
export async function listExecutorRecords(repoRoot: string): Promise<ExecutorRecordEntry[]> {
  let names: string[];
  try {
    names = await readdir(executorsDirectory(repoRoot));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const recordNames = names.filter((name) => name.endsWith('.json')).sort();
  return Promise.all(recordNames.map(async (name): Promise<ExecutorRecordEntry> => {
    const slug = name.slice(0, -'.json'.length);
    try {
      const raw = await readFile(join(executorsDirectory(repoRoot), name), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!isExecutorRecord(parsed)) return { kind: 'unreadable', slug };
      return { kind: 'record', slug, record: parsed };
    } catch {
      return { kind: 'unreadable', slug };
    }
  }));
}

function commandLineMatchesExecutor(record: ExecutorRecord, commandLine: string): boolean {
  // Linux procfs is NUL-delimited. The whitespace fallback keeps the injected
  // test seam readable while still requiring both exact executor arguments.
  const argumentsList = commandLine.includes('\0')
    ? commandLine.split('\0').filter(Boolean)
    : commandLine.trim().split(/\s+/).filter(Boolean);
  return argumentsList.includes(join(record.engineDir, 'index.js'))
    && argumentsList.includes('executor-child');
}

/**
 * Reconcile records left by a predecessor before it dispatches another child.
 * Dead and nonmatching records are stale authority and are removed. A live
 * matching child is terminated only after a fresh command-line read directly
 * before the kill; unreadable records remain for downstream fail-closed users.
 */
export async function sweepExecutorRecordsOnBoot(
  repoRoot: string,
  processBoundaries: ExecutorRecordProcessBoundaries = defaultProcessBoundaries,
): Promise<void> {
  const entries = await listExecutorRecords(repoRoot);
  for (const entry of entries) {
    if (entry.kind === 'unreadable') continue;

    if (!await processBoundaries.isPidAlive(entry.record.pid)) {
      await removeExecutorRecord(repoRoot, entry.slug);
      continue;
    }

    // Keep this read adjacent to the kill so a command line observed during a
    // prior record scan can never authorize signalling a reused pid.
    const commandLine = await processBoundaries.readCommandLine(entry.record.pid);
    if (!commandLineMatchesExecutor(entry.record, commandLine)) {
      await removeExecutorRecord(repoRoot, entry.slug);
      continue;
    }

    try {
      await processBoundaries.kill(entry.record.pid, 'SIGTERM');
    } catch (error) {
      // A process that exited in the liveness-to-kill race has no remaining
      // executor to protect, so its stale record can safely be cleared. Any
      // other failure preserves the authority record for a later safe retry.
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      await removeExecutorRecord(repoRoot, entry.slug);
      continue;
    }

    // SIGTERM only requests exit. Keep the durable pin if the child is still
    // alive: GC must not discard its engine build, and a later successor can
    // retry the takeover rather than dispatching through a false absence.
    if (!await processBoundaries.isPidAlive(entry.record.pid)) {
      await removeExecutorRecord(repoRoot, entry.slug);
    }
  }
}
