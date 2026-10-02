import { randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_EXPIRY_MS = 60_000;

interface LeaseFileHandle {
  writeFile(contents: string): Promise<void>;
  close(): Promise<void>;
}

interface HeartbeatTimer {
  unref?: () => void;
}

/** Injectable filesystem boundary for lease publication and recovery tests. */
export interface SpoolLeaseFilesystem {
  mkdir(path: string, options: { recursive: true; mode: number }): Promise<string | undefined>;
  open(path: string, flags: string): Promise<LeaseFileHandle>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  link(existingPath: string, newPath: string): Promise<void>;
  rename(source: string, destination: string): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
  writeFile(path: string, contents: string, encoding: 'utf8'): Promise<void>;
}

export interface SpoolLeaseOptions {
  clearInterval?: (timer: HeartbeatTimer) => void;
  filesystem?: Partial<SpoolLeaseFilesystem>;
  isProcessAlive?: (pid: number) => boolean;
  now?: () => number;
  /** Called once ownership is lost, so the associated drainer stops immediately. */
  onLost?: () => void;
  scheduleInterval?: (callback: () => Promise<void>, milliseconds: number) => HeartbeatTimer;
}

export type SpoolLeaseAcquireResult = { acquired: true } | { acquired: false };

interface LeaseRecord {
  pid: number;
  uuid: string;
  heartbeatAt: number;
}

const defaultFilesystem: SpoolLeaseFilesystem = { link, mkdir, open, readFile, rename, rm, writeFile };

function isAlreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'EEXIST';
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function parseLeaseRecord(serialized: string): LeaseRecord | null {
  try {
    const record: unknown = JSON.parse(serialized);
    if (typeof record !== 'object' || record === null) return null;
    const value = record as Record<string, unknown>;
    if (!Number.isInteger(value.pid) || (value.pid as number) <= 0 ||
      typeof value.uuid !== 'string' || value.uuid.length === 0 ||
      typeof value.heartbeatAt !== 'number' || !Number.isFinite(value.heartbeatAt)) {
      return null;
    }
    return { pid: value.pid as number, uuid: value.uuid, heartbeatAt: value.heartbeatAt };
  } catch {
    return null;
  }
}

/**
 * A single-drainer lease for an OTLP spool directory. A stale owner is replaced
 * by publishing a successor through a separate O_EXCL slot, never by opening a
 * window where no lease exists.
 */
export class SpoolLease {
  private readonly filesystem: SpoolLeaseFilesystem;
  private readonly now: () => number;
  private readonly isProcessAlive: (pid: number) => boolean;
  private readonly scheduleInterval: (callback: () => Promise<void>, milliseconds: number) => HeartbeatTimer;
  private readonly clearScheduledInterval: (timer: HeartbeatTimer) => void;
  private readonly onLost: () => void;
  private readonly uuid = randomUUID();
  private heartbeatTimer: HeartbeatTimer | undefined;
  private heartbeatRefresh: Promise<void> | undefined;
  private owned = false;

  constructor(private readonly directory: string, options: SpoolLeaseOptions = {}) {
    this.filesystem = { ...defaultFilesystem, ...options.filesystem };
    this.now = options.now ?? Date.now;
    this.isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
    this.scheduleInterval = options.scheduleInterval ?? ((callback, milliseconds) => setInterval(callback, milliseconds));
    this.clearScheduledInterval = options.clearInterval ?? ((timer) => clearInterval(timer as NodeJS.Timeout));
    this.onLost = options.onLost ?? (() => {});
  }

  async acquire(): Promise<SpoolLeaseAcquireResult> {
    if (this.owned) return { acquired: true };
    await this.filesystem.mkdir(this.directory, { recursive: true, mode: 0o700 });
    return this.tryAcquire();
  }

  async release(): Promise<void> {
    this.stopHeartbeat();
    await this.heartbeatRefresh;
    if (!this.owned) return;
    this.owned = false;

    try {
      const serialized = await this.filesystem.readFile(this.path(), 'utf8');
      if (parseLeaseRecord(serialized)?.uuid !== this.uuid) return;

      // Moving our verified record out of the lease pathname prevents a
      // late unlink from deleting a successor that acquired the now-vacant
      // pathname. A new owner may safely acquire between rename and cleanup.
      const releasingPath = `${this.path()}.${this.uuid}.release`;
      await this.filesystem.rename(this.path(), releasingPath);
      if (parseLeaseRecord(await this.filesystem.readFile(releasingPath, 'utf8'))?.uuid === this.uuid) {
        await this.filesystem.rm(releasingPath, { force: true });
      } else {
        // A successor can replace lease.json after the ownership check but
        // before our rename. Restore that foreign record without overwriting
        // a still newer holder, then remove only our moved-aside pathname.
        try {
          await this.filesystem.link(releasingPath, this.path());
        } catch (error) {
          if (!isAlreadyExists(error)) throw error;
        }
        await this.filesystem.rm(releasingPath, { force: true });
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  private async tryAcquire(): Promise<SpoolLeaseAcquireResult> {
    const record = this.record();
    try {
      await this.create(this.path(), record);
      this.takeOwnership();
      return { acquired: true };
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }

    let predecessor: string;
    try {
      predecessor = await this.filesystem.readFile(this.path(), 'utf8');
    } catch (error) {
      if (isMissing(error)) return this.tryAcquire();
      throw error;
    }
    const holder = parseLeaseRecord(predecessor);
    if (holder !== null && this.isFresh(holder) && this.isProcessAlive(holder.pid)) {
      return { acquired: false };
    }

    if (!await this.createSuccessor(record)) return { acquired: false };

    let current: string;
    try {
      current = await this.filesystem.readFile(this.path(), 'utf8');
    } catch (error) {
      if (!isMissing(error)) throw error;
      await this.filesystem.rm(this.successorPath(), { force: true }).catch(() => undefined);
      return this.tryAcquire();
    }

    try {
      if (current !== predecessor) return { acquired: false };
      await this.filesystem.rename(this.successorPath(), this.path());
      this.takeOwnership();
      return { acquired: true };
    } finally {
      if (!this.owned) await this.filesystem.rm(this.successorPath(), { force: true }).catch(() => undefined);
    }
  }

  private async create(path: string, record: LeaseRecord): Promise<void> {
    const handle = await this.filesystem.open(path, 'wx');
    try {
      await handle.writeFile(JSON.stringify(record));
    } finally {
      await handle.close();
    }
  }

  /**
   * Recovers only a successor whose writer cannot still be holding it. The
   * record is moved and re-read before removal so a racing replacement is
   * never unlinked by this contender.
   */
  private async createSuccessor(record: LeaseRecord): Promise<boolean> {
    try {
      await this.create(this.successorPath(), record);
      return true;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    if (!await this.recoverOrphanSuccessor()) return false;
    try {
      await this.create(this.successorPath(), record);
      return true;
    } catch (error) {
      if (isAlreadyExists(error)) return false;
      throw error;
    }
  }

  private async recoverOrphanSuccessor(): Promise<boolean> {
    const successor = this.successorPath();
    let serialized: string;
    try {
      serialized = await this.filesystem.readFile(successor, 'utf8');
    } catch (error) {
      if (isMissing(error)) return true;
      throw error;
    }
    const holder = parseLeaseRecord(serialized);
    if (holder !== null && this.isFresh(holder) && this.isProcessAlive(holder.pid)) return false;

    const moved = `${successor}.${this.uuid}.${randomUUID()}.orphan`;
    try {
      await this.filesystem.rename(successor, moved);
    } catch (error) {
      if (isMissing(error)) return true;
      throw error;
    }
    try {
      if (await this.filesystem.readFile(moved, 'utf8') === serialized) {
        await this.filesystem.rm(moved, { force: true });
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    return true;
  }

  private record(): LeaseRecord {
    return { pid: process.pid, uuid: this.uuid, heartbeatAt: this.now() };
  }

  private isFresh(record: LeaseRecord): boolean {
    return this.now() - record.heartbeatAt <= HEARTBEAT_EXPIRY_MS;
  }

  private takeOwnership(): void {
    this.owned = true;
    this.heartbeatTimer = this.scheduleInterval(async () => {
      const refresh = this.refreshHeartbeat();
      this.heartbeatRefresh = refresh;
      try {
        await refresh;
      } finally {
        if (this.heartbeatRefresh === refresh) this.heartbeatRefresh = undefined;
      }
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
  }

  private async refreshHeartbeat(): Promise<void> {
    if (!this.owned) return;
    try {
      const serialized = await this.filesystem.readFile(this.path(), 'utf8');
      if (parseLeaseRecord(serialized)?.uuid !== this.uuid) {
        this.loseOwnership();
        return;
      }
      const successor = this.successorPath();
      if (!await this.createSuccessor(this.record())) return;
      if (!this.owned) {
        await this.filesystem.rm(successor, { force: true });
        return;
      }
      // A successor may have won while this holder prepared its atomic update.
      if (await this.filesystem.readFile(this.path(), 'utf8') !== serialized) {
        await this.filesystem.rm(successor, { force: true });
        this.loseOwnership();
        return;
      }
      await this.filesystem.rename(successor, this.path());
    } catch {
      // The next contender may recover a lease whose owner can no longer refresh it.
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) this.clearScheduledInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private loseOwnership(): void {
    if (!this.owned) return;
    this.owned = false;
    this.stopHeartbeat();
    this.onLost();
  }

  private path(): string {
    return join(this.directory, 'lease.json');
  }

  private successorPath(): string {
    return `${this.path()}.next`;
  }
}
