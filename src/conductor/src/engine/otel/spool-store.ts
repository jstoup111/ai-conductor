import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

export type SpoolSignal = 'traces' | 'metrics';

export interface SpoolBatch {
  name: string;
  path: string;
  size: number;
}

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

  constructor(private readonly root: string, options: SpoolStoreOptions = {}) {
    this.filesystem = options.filesystem ?? filesystem;
    this.now = options.now ?? Date.now;
    this.pid = options.pid ?? process.pid;
    this.randomBytes = options.randomBytes ?? randomBytes;
  }

  async write(signal: SpoolSignal, body: Uint8Array): Promise<SpoolBatch> {
    const directory = this.directory(signal);
    await this.filesystem.mkdir(directory, { recursive: true, mode: 0o700 });
    const name = `${String(this.now()).padStart(15, '0')}-${this.pid}-${this.randomBytes(4).toString('hex')}.pb`;
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

    return { name, path, size: body.byteLength };
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
        return { name, path, size: (await this.filesystem.stat(path)).size };
      }));
    return batches;
  }

  read(batch: SpoolBatch): Promise<Buffer> {
    return this.filesystem.readFile(batch.path);
  }

  delete(batch: SpoolBatch): Promise<void> {
    return this.filesystem.rm(batch.path, { force: true });
  }

  async totalBytes(signal: SpoolSignal): Promise<number> {
    return (await this.list(signal)).reduce((total, batch) => total + batch.size, 0);
  }

  private directory(signal: SpoolSignal): string {
    return join(this.root, signal);
  }
}
