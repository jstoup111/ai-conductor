// daemon-log.ts — Append-only daemon activity log + read/tail/follow primitives.
//
// The daemon runs in a tmux session you may not be attached to (ADR-014), so its
// `console.log('[daemon] …')` lines — including the per-feature BUILD progress
// rendered by `renderDaemonEvent` — would otherwise be visible only while connected.
// To make daemon *activity* observable (not just liveness) at any time and to keep a
// durable record, `runDaemonMode` tees its `log()` sink into this
// file, and `conduct daemon logs` reads it back.
//
// The pidfile name and the O_EXCL create flag are confined to daemon-lock.ts by a
// boundary test. This module only needs the `.daemon/` dir, obtained from the
// exported `daemonDir()` helper — it never touches the pidfile.

import { createWriteStream } from 'node:fs';
import { mkdir, stat, rename, readFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { daemonDir } from './daemon-lock.js';

const DAEMON_LOG_NAME = 'daemon.log';
const ROTATED_LOG_NAME = 'daemon.log.1';
/** Single-file rotation cap (~1 MB). On open, an oversized log is moved aside once. */
const ROTATE_SIZE_BYTES = 1_000_000;

/** Absolute path to a repo's daemon activity log. */
export function daemonLogPath(repoPath: string): string {
  return join(daemonDir(repoPath), DAEMON_LOG_NAME);
}

/**
 * Stamp one already-prefixed daemon log line (`[daemon] …`) with a leading
 * ISO-8601 UTC timestamp for the durable record read via `conduct daemon logs`.
 * The clock is injected so the format is deterministic under test. Timestamps
 * land only in the persisted log — the live tmux console stays uncluttered.
 */
export function formatDaemonLogLine(line: string, now: Date = new Date()): string {
  return `${now.toISOString()} ${line}`;
}

/** Append-only sink returned by openDaemonLog. */
export interface DaemonLogSink {
  /** Append a line (a trailing newline is added if absent). Buffered + ordered. */
  write(line: string): void;
  /** Flush and close the underlying stream (await for clean shutdown). */
  close(): Promise<void>;
  /** Best-effort synchronous close for crash/exit backstops (cannot await). */
  closeSync(): void;
}

/**
 * Open the daemon activity log for appending. Ensures `.daemon/` exists, performs
 * a simple one-file size-cap rotation (oversized log → `daemon.log.1`), then opens
 * the log in append mode. Independent of the process's stdio, so the activity record
 * persists whether or not anyone is attached to the daemon's tmux session.
 */
export async function openDaemonLog(repoPath: string): Promise<DaemonLogSink> {
  const dir = daemonDir(repoPath);
  await mkdir(dir, { recursive: true });
  const logPath = daemonLogPath(repoPath);

  // One-file rotation: if the existing log exceeds the cap, move it aside once
  // (overwriting any prior rotation) before opening fresh in append mode.
  try {
    const st = await stat(logPath);
    if (st.size > ROTATE_SIZE_BYTES) {
      await rename(logPath, join(dir, ROTATED_LOG_NAME));
    }
  } catch {
    // No existing log (ENOENT) or un-stat-able — nothing to rotate.
  }

  const stream = createWriteStream(logPath, { flags: 'a' });
  return {
    write(line: string): void {
      stream.write(line.endsWith('\n') ? line : `${line}\n`);
    },
    close(): Promise<void> {
      return new Promise<void>((resolve) => stream.end(resolve));
    },
    closeSync(): void {
      // Best-effort flush; the fd is reclaimed by the runtime on teardown.
      stream.end();
    },
  };
}

/** Result of reading a daemon log — never throws; the caller renders each case. */
export type LogReadResult =
  | { status: 'ok'; lines: string[]; mtime: Date }
  | { status: 'missing' }
  | { status: 'unreadable'; error: string };

/**
 * Read the last `n` non-empty lines of a repo's daemon log (`n <= 0` → all lines).
 * Returns a typed result rather than throwing: a missing log is a normal state
 * (daemon never ran), and an unreadable `.daemon/` degrades gracefully.
 */
export async function tailDaemonLog(repoPath: string, n: number): Promise<LogReadResult> {
  const logPath = daemonLogPath(repoPath);
  let mtime: Date;
  try {
    mtime = (await stat(logPath)).mtime;
  } catch (err) {
    return classifyReadError(err);
  }
  let content: string;
  try {
    content = await readFile(logPath, 'utf8');
  } catch (err) {
    return classifyReadError(err);
  }
  const allLines = content.split('\n').filter((l) => l.length > 0);
  const lines = n > 0 ? allLines.slice(-n) : allLines;
  return { status: 'ok', lines, mtime };
}

function classifyReadError(err: unknown): LogReadResult {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') return { status: 'missing' };
  return { status: 'unreadable', error: (err as Error).message };
}

/** Handle returned by followDaemonLog. */
export interface FollowHandle {
  /** Stop the interval timer (no-op if already stopped). */
  stop(): void;
  /** Run one poll cycle now — exposed for deterministic testing. */
  poll(): Promise<void>;
}

export interface FollowOpts {
  /** Poll interval in ms (default 1000). */
  intervalMs?: number;
  /** Byte offset to start following from (default 0 → emits whole file first tick). */
  startOffset?: number;
  /** Start the interval timer automatically (default true). Tests pass false. */
  auto?: boolean;
  /**
   * Unref the poll timer so it never keeps the process alive (default true —
   * safe for embedders). A foreground `tail -f` MUST pass false: nothing else
   * holds the event loop open (a SIGINT listener does not), so an unref'd
   * follower exits the moment the initial snapshot finishes printing.
   */
  unref?: boolean;
}

/**
 * `tail -f` semantics: poll the log for growth and emit each newly-appended line
 * via `onLine`. Tracks a byte offset; a shrink (rotation/truncation) resets it to
 * 0 so following continues across a rotation. Read errors on a given tick are
 * swallowed — the next tick retries. The CLI prints the existing tail first, then
 * follows from current EOF (`startOffset = size`) so only new lines stream.
 */
export function followDaemonLog(
  repoPath: string,
  onLine: (line: string) => void,
  opts: FollowOpts = {},
): FollowHandle {
  const logPath = daemonLogPath(repoPath);
  const intervalMs = opts.intervalMs ?? 1000;
  let offset = opts.startOffset ?? 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const poll = async (): Promise<void> => {
    let size: number;
    try {
      size = (await stat(logPath)).size;
    } catch {
      return; // missing/unreadable this tick — retry next tick
    }
    if (size < offset) offset = 0; // rotated/truncated → restart from the top
    if (size === offset) return;

    let fh: Awaited<ReturnType<typeof open>>;
    try {
      fh = await open(logPath, 'r');
    } catch {
      return;
    }
    try {
      const len = size - offset;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, offset);
      offset = size;
      for (const line of buf.toString('utf8').split('\n')) {
        if (line.length > 0) onLine(line);
      }
    } finally {
      await fh.close();
    }
  };

  const stop = (): void => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  if (opts.auto ?? true) {
    timer = setInterval(() => {
      void poll();
    }, intervalMs);
    // Don't keep the event loop alive solely for the poll timer — unless the
    // caller is a foreground follower whose only reason to stay alive IS this
    // timer (see FollowOpts.unref).
    if ((opts.unref ?? true) && typeof timer.unref === 'function') timer.unref(); // portability-ok: guarded typeof check; only detaches this internal poll interval from process exit, no effect on daemon lifecycle or output
  }

  return { stop, poll };
}
