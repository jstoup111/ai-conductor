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
  stat(path: string): Promise<{ size: number }>;
}

export interface SpoolStoreOptions {
  filesystem?: SpoolFilesystem;
  maxBytes?: number;
  now?: () => number;
  pid?: number;
  randomBytes?: (size: number) => Buffer;
}

const filesystem: SpoolFilesystem = { mkdir, open, readdir, readFile, rename, rm, stat };

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
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
  private readonly maxBytes: number | undefined;

  constructor(private readonly root: string, options: SpoolStoreOptions = {}) {
    this.filesystem = options.filesystem ?? filesystem;
    this.now = options.now ?? Date.now;
    this.pid = options.pid ?? process.pid;
    this.randomBytes = options.randomBytes ?? randomBytes;
    this.maxBytes = options.maxBytes;
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

    try {
      await handle.writeFile(body);
      await handle.sync();
      await handle.close();
      closed = true;
      await this.filesystem.rename(temporaryPath, path);
    } finally {
      if (!closed) await handle.close().catch(() => undefined);
    }

    const batch = { name, path, size: body.byteLength, items };
    if (this.maxBytes === undefined) return batch;

    let totalBytes = await this.totalBytes();
    let evictedBatches = 0;
    let evictedItems = 0;
    for (const oldest of await this.allBatches()) {
      if (totalBytes <= this.maxBytes) break;
      if (oldest.path === path) continue;
      await this.delete(oldest);
      totalBytes -= oldest.size;
      evictedBatches += 1;
      evictedItems += oldest.items;
    }

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

    const batches = await Promise.all(names
      .filter((name) => name.endsWith('.pb'))
      .sort()
      .map(async (name) => {
        const path = join(directory, name);
        return {
          name,
          path,
          size: (await this.filesystem.stat(path)).size,
          items: this.itemsFromName(name),
        };
      }));
    return batches;
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

  private async allBatches(): Promise<SpoolBatch[]> {
    const signals: readonly SpoolSignal[] = ['traces', 'metrics'];
    const batches = await Promise.all(signals.map((signal) => this.list(signal)));
    return batches.flat().sort((first, second) => first.name.localeCompare(second.name));
  }

  private itemsFromName(name: string): number {
    const match = /-(\d+)\.pb$/.exec(name);
    return match === null ? 1 : Number(match[1]);
  }
}
