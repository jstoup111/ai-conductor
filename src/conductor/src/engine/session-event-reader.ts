import { lstat, realpath, readdir, readFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { ConductorEvent, SessionObservationScope } from '../types/events.js';
import { isSessionEventIdentity, SESSION_EVENT_IDENTITY } from '../execution/session-event-identity.js';
import { isFeatureSlug } from './worktree.js';

export const SESSION_EVENTS_DIRECTORY = '.pipeline/session-events';
export const MAX_SESSION_EVENT_RECORD_BYTES = 4_096;
const MAX_INCREMENTAL_READ_BYTES = 64 * 1_024;
const IDENTITY = SESSION_EVENT_IDENTITY;

export type SessionEventReadRecord =
  | { kind: 'event'; path: string; byteOffset: number; event: SessionProducerEvent }
  | { kind: 'diagnostic'; path: string; byteOffset: number; code: 'malformed-json' | 'record-too-large' | 'invalid-attribution' | 'incomplete-record' };

type SessionProducerEvent = Extract<ConductorEvent, {
  type: 'session_command_refused' | 'github_bypass_attempt' | 'github_bypass_result' | 'github_possible_bypass' | 'session_event_delivery_diagnostic';
}>;

type PendingRecord = SessionEventReadRecord & { endOffset?: number };

export interface SessionEventReaderDependencies {
  readonly list?: (path: string) => Promise<Dirent[]>;
  readonly read?: (path: string) => Promise<Buffer>;
}

/**
 * Bounded, acknowledged reader for dispatch-local producer ledgers. It never
 * advances an offset until its caller acknowledges the delivered record.
 */
export class SessionEventReader {
  private readonly offsets = new Map<string, number>();
  private pending: PendingRecord[] = [];
  private readonly list: (path: string) => Promise<Dirent[]>;
  private readonly readFile: (path: string) => Promise<Buffer>;

  constructor({ projectRoot, featureSlug, ...dependencies }: { projectRoot: string; featureSlug?: string } & SessionEventReaderDependencies) {
    this.projectRoot = projectRoot;
    this.featureSlug = featureSlug;
    this.list = dependencies.list ?? ((path) => readdir(path, { withFileTypes: true }));
    this.readFile = dependencies.read ?? readFile;
  }

  private readonly projectRoot: string;
  private readonly featureSlug: string | undefined;

  async read(): Promise<readonly SessionEventReadRecord[]> {
    if (this.pending.length > 0) return this.pending;
    return this.collect(false);
  }

  /** Diagnose an unterminated record only after its producer has settled. */
  async drain(): Promise<readonly SessionEventReadRecord[]> {
    if (this.pending.length > 0) return this.pending;
    return this.collect(true);
  }

  acknowledge(record: SessionEventReadRecord): void {
    const pending = this.pending[0];
    if (!pending || pending !== record) return;
    this.pending.shift();
    if (pending.endOffset !== undefined) this.offsets.set(pending.path, pending.endOffset);
  }

  private async collect(settled: boolean): Promise<readonly SessionEventReadRecord[]> {
    const paths = await this.producerPaths();
    for (const path of paths) {
      const records = await this.readPath(path, settled);
      if (records.length > 0) this.pending.push(...records);
    }
    return this.pending;
  }

  private async producerPaths(): Promise<string[]> {
    const root = join(this.projectRoot, SESSION_EVENTS_DIRECTORY);
    // Refuse a swapped/symlinked ledger root before traversing it.  Producer
    // paths are authoritative filesystem ownership, not a convenience hint.
    try {
      const rootStat = await lstat(root);
      if (rootStat.isSymbolicLink() || resolve(await realpath(root)) !== resolve(root)) {
        this.pending.push({ kind: 'diagnostic', path: root, byteOffset: 0, code: 'invalid-attribution' });
        return [];
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    let dispatches: Dirent[];
    try { dispatches = await this.list(root); } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const paths: string[] = [];
    for (const dispatch of dispatches) {
      if (!dispatch.isDirectory() || !IDENTITY.test(dispatch.name)) continue;
      const dispatchPath = join(root, dispatch.name);
      let producers: Dirent[];
      try { producers = await this.list(dispatchPath); } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      for (const producer of producers) {
        if (producer.isFile() && /^[a-z][a-z0-9-]{0,63}\.jsonl$/.test(producer.name)) {
          const path = join(dispatchPath, producer.name);
          try {
            const canonical = await realpath(path);
            if (within(root, canonical)) paths.push(canonical);
          } catch { /* producer disappeared or is unresolvable; skip it */ }
        }
      }
    }
    return paths.sort();
  }

  private async readPath(path: string, settled: boolean): Promise<PendingRecord[]> {
    let content: Buffer;
    try { content = await this.readFile(path); } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    let offset = this.offsets.get(path) ?? 0;
    if (content.byteLength < offset) offset = 0;
    const unread = content.subarray(offset, offset + MAX_INCREMENTAL_READ_BYTES);
    const records: PendingRecord[] = [];
    let lineStart = 0;
    while (lineStart < unread.byteLength) {
      const lineEnd = unread.indexOf(0x0a, lineStart);
      if (lineEnd === -1) {
        const bytes = unread.byteLength - lineStart;
        if (bytes > MAX_SESSION_EVENT_RECORD_BYTES) {
          // Consume this bounded prefix: leaving an over-sized unterminated
          // record at the offset would hide every later producer record.
          records.push(this.diagnostic(path, offset + lineStart, 'record-too-large', offset + unread.byteLength));
        } else if (settled) {
          records.push(this.diagnostic(path, offset + lineStart, 'incomplete-record'));
        }
        break;
      }
      const line = unread.subarray(lineStart, lineEnd);
      const endOffset = offset + lineEnd + 1;
      if (line.byteLength > MAX_SESSION_EVENT_RECORD_BYTES) {
        records.push(this.diagnostic(path, offset + lineStart, 'record-too-large', endOffset));
      } else if (line.byteLength > 0) {
        records.push(this.parse(path, offset + lineStart, endOffset, line));
      } else {
        records.push({ kind: 'diagnostic', path, byteOffset: offset + lineStart, code: 'malformed-json', endOffset });
      }
      lineStart = lineEnd + 1;
    }
    return records;
  }

  private parse(path: string, byteOffset: number, endOffset: number, line: Buffer): PendingRecord {
    try {
      const value: unknown = JSON.parse(line.toString('utf8'));
      if (!isSessionProducerEvent(value) || !this.belongsToContainingProducer(path, value)) {
        return this.diagnostic(path, byteOffset, 'invalid-attribution', endOffset);
      }
      return { kind: 'event', path, byteOffset, event: value, endOffset };
    } catch {
      return this.diagnostic(path, byteOffset, 'malformed-json', endOffset);
    }
  }

  private diagnostic(path: string, byteOffset: number, code: Extract<SessionEventReadRecord, { kind: 'diagnostic' }>['code'], endOffset?: number): PendingRecord {
    return { kind: 'diagnostic', path, byteOffset, code, endOffset };
  }

  /** Directory ownership is authoritative; a producer cannot claim another dispatch or feature. */
  private belongsToContainingProducer(path: string, event: SessionProducerEvent): boolean {
    if (event.dispatchId !== basename(dirname(path))) return false;
    if (this.featureSlug === undefined) return event.scope.kind === 'project';
    return event.scope.kind === 'feature' && event.scope.featureSlug === this.featureSlug;
  }
}

function within(root: string, candidate: string): boolean {
  const offset = relative(root, candidate);
  return offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset);
}

function isSessionProducerEvent(value: unknown): value is SessionProducerEvent {
  if (!isRecord(value) || !isIdentity(value.eventId) || !isIdentity(value.dispatchId) || !isIdentity(value.provider)
    || typeof value.sourceTime !== 'string' || !Number.isFinite(Date.parse(value.sourceTime)) || !isScope(value.scope)) return false;
  if (value.type === 'session_command_refused') return isSafeValue(value.subcommand);
  if (value.type === 'github_bypass_attempt' || value.type === 'github_possible_bypass') return isSafeValue(value.operation);
  if (value.type === 'github_bypass_result') return isIdentity(value.attemptId) && ['cli-succeeded', 'cli-failed', 'unknown'].includes(String(value.outcome));
  return value.type === 'session_event_delivery_diagnostic'
    && ['producer-path-invalid', 'record-too-large', 'write-failed'].includes(String(value.code));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isScope(value: unknown): value is SessionObservationScope {
  return isRecord(value) && (value.kind === 'project' || (value.kind === 'feature' && isFeatureSlug(value.featureSlug)));
}

function isSafeValue(value: unknown): boolean {
  return value === 'unknown' || isIdentity(value);
}

function isIdentity(value: unknown): value is string {
  return isSessionEventIdentity(value);
}
