import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

export type SpoolSignal = 'traces' | 'metrics';

export interface SpoolBatch {
  name: string;
  path: string;
  size: number;
  items: number;
}

export type SpoolWriteResult =
  | (SpoolBatch & {
      rejectedOversize: false;
      rejectedItems: 0;
      evictedBatches: number;
      evictedItems: number;
    })
  | {
      rejectedOversize: true;
      rejectedItems: number;
      evictedBatches: 0;
      evictedItems: 0;
    };

interface SpoolFileHandle {
  writeFile(data: Uint8Array): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

/** Injectable filesystem boundary for durability and publication failure tests. */
export interface SpoolFilesystem {
  mkdir(path: string, options: { recursive: true; mode: number }): Promise<string | undefined>;
  open(path: string, flags: string): Promise<SpoolFileHandle>;
  readdir(path: string): Promise<string[]>;
  readFile(path: string): Promise<Buffer>;
  rename(source: string, destination: string): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
  stat(path: string): Promise<{ size: number; mtimeMs: number }>;
}

export interface SpoolStoreOptions {
  filesystem?: SpoolFilesystem;
  maxBytes?: number;
  now?: () => number;
  pid?: number;
  randomBytes?: (size: number) => Buffer;
  /** Monotonic-enough clock for lock deadlines and stale-owner checks. */
  lockNow?: () => number;
  /** Bound contention so an unavailable cap lock falls back to direct export. */
  capLockAcquireTimeoutMs?: number;
  /** Injectable liveness probe for crash-recovery tests. */
  isProcessAlive?: (pid: number) => boolean;
  /** Injectable retry seam; production retries on the next event-loop turn. */
  yieldForCapLock?: () => Promise<void>;
}

const filesystem: SpoolFilesystem = { mkdir, open, readdir, readFile, rename, rm, stat };
const TEMPORARY_FILE_GRACE_MS = 60_000;
const CAP_LOCK_ACQUIRE_TIMEOUT_MS = 1_000;

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function alreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'EEXIST';
}

function yieldForCapLock(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM proves a process exists but is not signalable; only ESRCH is dead.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

interface LockOwner {
  pid: number;
  token: string;
}

function lockOwner(contents: Buffer): LockOwner | undefined {
  try {
    const parsed: unknown = JSON.parse(contents.toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || !('pid' in parsed) || !('token' in parsed)) return undefined;
    const { pid, token } = parsed as { pid?: unknown; token?: unknown };
    return typeof pid === 'number' && Number.isInteger(pid) && pid > 0 && typeof token === 'string' && token.length > 0
      ? { pid, token }
      : undefined;
  } catch {
    return undefined;
  }
}

function isOwner(contents: Buffer, owner: LockOwner): boolean {
  const current = lockOwner(contents);
  return current?.pid === owner.pid && current.token === owner.token;
}

/**
 * Stores immutable OTLP/HTTP protobuf request bodies. A final .pb file is only
 * visible after its same-directory temporary file has been fsynced and renamed.
 */
export class SpoolStore {
  private readonly filesystem: SpoolFilesystem;
  private readonly now: () => number;
  private readonly pid: number;
  private readonly randomBytes: (size: number) => Buffer;
  private readonly lockNow: () => number;
  private readonly maxBytes: number | undefined;
  private readonly capLockAcquireTimeoutMs: number;
  private readonly processIsAlive: (pid: number) => boolean;
  private readonly yieldForCapLock: () => Promise<void>;

  constructor(
    private readonly root: string,
    options: SpoolStoreOptions = {},
  ) {
    this.filesystem = options.filesystem ?? filesystem;
    this.now = options.now ?? Date.now;
    this.pid = options.pid ?? process.pid;
    this.randomBytes = options.randomBytes ?? randomBytes;
    this.lockNow = options.lockNow ?? Date.now;
    this.maxBytes = options.maxBytes;
    this.capLockAcquireTimeoutMs = options.capLockAcquireTimeoutMs ?? CAP_LOCK_ACQUIRE_TIMEOUT_MS;
    this.processIsAlive = options.isProcessAlive ?? isProcessAlive;
    this.yieldForCapLock = options.yieldForCapLock ?? yieldForCapLock;
  }

  write(signal: SpoolSignal, body: Uint8Array): Promise<SpoolBatch>;
  write(signal: SpoolSignal, body: Uint8Array, items: number): Promise<SpoolWriteResult>;
  async write(signal: SpoolSignal, body: Uint8Array, items = 1): Promise<SpoolBatch | SpoolWriteResult> {
    if (this.maxBytes !== undefined && body.byteLength > this.maxBytes) {
      return { rejectedOversize: true, rejectedItems: items, evictedBatches: 0, evictedItems: 0 };
    }

    const directory = this.directory(signal);
    await this.filesystem.mkdir(directory, { recursive: true, mode: 0o700 });
    const name = `${String(this.now()).padStart(15, '0')}-${this.pid}-${this.randomBytes(4).toString('hex')}-${items}.pb`;
    const path = join(directory, name);
    const temporaryPath = `${path}.${this.randomBytes(4).toString('hex')}.tmp`;
    const handle = await this.filesystem.open(temporaryPath, 'wx');
    let closed = false;
    let published = false;
    let evictedBatches = 0;
    let evictedItems = 0;

    try {
      await handle.writeFile(body);
      await handle.sync();
      await handle.close();
      closed = true;

      // Keep the just-fsynced batch private while accounting for it. Once the
      // rename publishes it, write() must return immediately so an SDK success
      // callback cannot race a drainer through more store I/O.
      const maxBytes = this.maxBytes;
      if (maxBytes === undefined) {
        await this.filesystem.rename(temporaryPath, path);
      } else {
        await this.withCapLock(async () => {
          await this.removeStaleTemporaryFiles();
          let totalBytes = await this.totalBytes();
          for (const oldest of await this.allBatches()) {
            if (totalBytes + body.byteLength <= maxBytes) break;
            await this.delete(oldest);
            totalBytes -= oldest.size;
            evictedBatches += 1;
            evictedItems += oldest.items;
          }
          await this.filesystem.rename(temporaryPath, path);
        });
      }
      published = true;
    } finally {
      if (!closed) await handle.close().catch(() => undefined);
      if (!published) await this.filesystem.rm(temporaryPath, { force: true }).catch(() => undefined);
    }

    const batch = { name, path, size: body.byteLength, items };
    if (this.maxBytes === undefined) return batch;

    return { ...batch, rejectedOversize: false, rejectedItems: 0, evictedBatches, evictedItems };
  }

  async list(signal: SpoolSignal): Promise<SpoolBatch[]> {
    const directory = this.directory(signal);
    let names: string[];
    try {
      names = await this.filesystem.readdir(directory);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }

    const entries = await Promise.all(
      names
        .filter((name) => name.endsWith('.pb'))
        .sort()
        .map(async (name) => {
          const path = join(directory, name);
          try {
            return {
              name,
              path,
              size: (await this.filesystem.stat(path)).size,
              items: this.itemsFromName(name),
            };
          } catch (error) {
            // A drainer may delete a batch after readdir but before stat. It was
            // already delivered, so it must not make a concurrent listing fail.
            if (isMissing(error)) return undefined;
            throw error;
          }
        }),
    );
    return entries.filter((batch): batch is SpoolBatch => batch !== undefined);
  }

  read(batch: SpoolBatch): Promise<Buffer> {
    return this.filesystem.readFile(batch.path);
  }

  delete(batch: SpoolBatch): Promise<void> {
    return this.filesystem.rm(batch.path, { force: true });
  }

  async totalBytes(signal?: SpoolSignal): Promise<number> {
    const signals: readonly SpoolSignal[] = signal === undefined ? ['traces', 'metrics'] : [signal];
    const batches = await Promise.all(signals.map((currentSignal) => this.list(currentSignal)));
    return batches.flat().reduce((total, batch) => total + batch.size, 0);
  }

  private directory(signal: SpoolSignal): string {
    return join(this.root, signal);
  }

  /** Serializes cap eviction and publication across independent writer runtimes. */
  private async withCapLock<T>(operation: () => Promise<T>): Promise<T> {
    const lockPath = join(this.root, '.cap.lock');
    let lock: SpoolFileHandle;
    let owner: LockOwner;
    const deadline = this.lockNow() + this.capLockAcquireTimeoutMs;
    for (;;) {
      if (this.lockNow() >= deadline) {
        throw new Error(`Timed out acquiring spool cap lock after ${this.capLockAcquireTimeoutMs}ms`);
      }
      if (await this.reclaimAbandonedCapRecoveryLocks(lockPath)) {
        await this.yieldForCapLock();
        continue;
      }
      try {
        lock = await this.filesystem.open(lockPath, 'wx');
        owner = { pid: this.pid, token: this.randomBytes(16).toString('hex') };
        break;
      } catch (error) {
        if (!alreadyExists(error)) throw error;
        if (await this.reclaimAbandonedCapLock(lockPath)) continue;
        if (this.lockNow() >= deadline) {
          throw new Error(`Timed out acquiring spool cap lock after ${this.capLockAcquireTimeoutMs}ms`);
        }
        await this.yieldForCapLock();
      }
    }

    let value: T | undefined;
    let failure: unknown;
    try {
      await lock.writeFile(Buffer.from(JSON.stringify({ ...owner, createdAt: this.lockNow() })));
      await lock.sync();
      value = await operation();
    } catch (error) {
      failure = error;
    }
    const releaseFailures: unknown[] = [];
    try {
      await lock.close();
    } catch (error) {
      releaseFailures.push(error);
    }
    try {
      await this.removeOwnedLock(lockPath, owner);
    } catch (error) {
      releaseFailures.push(error);
    }
    if (failure !== undefined || releaseFailures.length > 0) {
      throw new AggregateError(
        [...(failure === undefined ? [] : [failure]), ...releaseFailures],
        'Spool cap lock operation or release failed',
      );
    }
    return value as T;
  }

  /**
   * Every recovery attempt is keyed by the cap owner's immutable token. That
   * makes one reclaimer the sole actor allowed to remove that incarnation;
   * later cap owners have another token and are never addressed by stale work.
   */
  private async reclaimAbandonedCapLock(lockPath: string): Promise<boolean> {
    let observed: LockOwner;
    try {
      observed = lockOwner(await this.filesystem.readFile(lockPath))!;
    } catch (error) {
      if (isMissing(error)) return true;
      throw error;
    }
    if (observed === undefined || this.processIsAlive(observed.pid)) return false;

    const recoveryPath = `${lockPath}.reclaim.${observed.token}`;
    let recovery: SpoolFileHandle;
    const recoveryOwner = { pid: this.pid, token: this.randomBytes(16).toString('hex') };
    try {
      recovery = await this.filesystem.open(recoveryPath, 'wx');
    } catch (error) {
      if (alreadyExists(error)) {
        await this.reclaimOrphanedCapRecoveryLock(recoveryPath);
        return false;
      }
      throw error;
    }

    let reclaimed = false;
    let failure: unknown;
    try {
      await recovery.writeFile(Buffer.from(JSON.stringify({ ...recoveryOwner, createdAt: this.lockNow() })));
      await recovery.sync();
      try {
        const current = await this.filesystem.readFile(lockPath);
        // A recovery marker blocks new contenders before this unlink. Its
        // owner-keyed name also means no second stale reclaimer can repeat it.
        if (isOwner(current, observed) && !this.processIsAlive(observed.pid)) {
          await this.removeOwnedLock(lockPath, observed);
          reclaimed = true;
        }
      } catch (error) {
        if (isMissing(error)) {
          reclaimed = true;
        } else {
          throw error;
        }
      }
    } catch (error) {
      failure = error;
    }
    const releaseFailures: unknown[] = [];
    try {
      await recovery.close();
    } catch (error) {
      releaseFailures.push(error);
    }
    try {
      await this.removeOwnedLock(recoveryPath, recoveryOwner);
    } catch (error) {
      releaseFailures.push(error);
    }
    if (failure !== undefined || releaseFailures.length > 0) {
      throw new AggregateError(
        [...(failure === undefined ? [] : [failure]), ...releaseFailures],
        'Spool cap lock recovery failed',
      );
    }
    return reclaimed;
  }

  /** A crashed reclaimer can be removed only when its own recorded owner is dead. */
  private async reclaimOrphanedCapRecoveryLock(recoveryPath: string): Promise<void> {
    let contents: Buffer;
    try {
      contents = await this.filesystem.readFile(recoveryPath);
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    const owner = lockOwner(contents);
    if (owner !== undefined && !this.processIsAlive(owner.pid)) await this.removeOwnedLock(recoveryPath, owner);
  }

  /** Returns true while a live or unproven recovery marker owns the gap. */
  private async reclaimAbandonedCapRecoveryLocks(lockPath: string): Promise<boolean> {
    let names: string[];
    try {
      names = await this.filesystem.readdir(this.root);
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
    const prefix = `${lockPath.split('/').pop()}.reclaim.`;
    let blocked = false;
    for (const name of names.filter((candidate) => candidate.startsWith(prefix))) {
      const path = join(this.root, name);
      await this.reclaimOrphanedCapRecoveryLock(path);
      try {
        const owner = lockOwner(await this.filesystem.readFile(path));
        if (owner === undefined || this.processIsAlive(owner.pid)) blocked = true;
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    return blocked;
  }

  /** Never remove a reused path unless it still contains this caller's token. */
  private async removeOwnedLock(path: string, owner: LockOwner): Promise<void> {
    let contents: Buffer;
    try {
      contents = await this.filesystem.readFile(path);
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    if (isOwner(contents, owner)) await this.filesystem.rm(path, { force: true });
  }

  private async allBatches(): Promise<SpoolBatch[]> {
    const signals: readonly SpoolSignal[] = ['traces', 'metrics'];
    const batches = await Promise.all(signals.map((signal) => this.list(signal)));
    return batches.flat().sort((first, second) => first.name.localeCompare(second.name));
  }

  /** Keep crash-orphaned publication files from bypassing the spool byte cap. */
  private async removeStaleTemporaryFiles(): Promise<void> {
    await Promise.all(
      (['traces', 'metrics'] as const).map(async (signal) => {
        const directory = this.directory(signal);
        let names: string[];
        try {
          names = await this.filesystem.readdir(directory);
        } catch (error) {
          if (isMissing(error)) return;
          throw error;
        }
        await Promise.all(
          names
            .filter((name) => name.endsWith('.tmp'))
            .map(async (name) => {
              const path = join(directory, name);
              try {
                if (this.now() - (await this.filesystem.stat(path)).mtimeMs >= TEMPORARY_FILE_GRACE_MS) {
                  await this.filesystem.rm(path, { force: true });
                }
              } catch (error) {
                if (!isMissing(error)) throw error;
              }
            }),
        );
      }),
    );
  }

  private itemsFromName(name: string): number {
    const match = /-(\d+)\.pb$/.exec(name);
    return match === null ? 1 : Number(match[1]);
  }
}
