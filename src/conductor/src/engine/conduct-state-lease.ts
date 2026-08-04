import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const DEFAULT_WAIT_TIMEOUT_MS = 1_000;
const DEFAULT_RETRY_DELAY_MS = 10;
const LEASE_OWNER_FILE = 'owner.json';

export interface ConductStateLeaseFilesystem {
  /** Atomically creates a previously absent lease directory. */
  acquireDirectory(path: string): Promise<void>;
  writeOwner(path: string, contents: string): Promise<void>;
  readOwner(path: string): Promise<string>;
  releaseDirectory(path: string): Promise<void>;
}

export interface ConductStateLeaseOwner {
  version: 1;
  pid: number;
  token: string;
  acquiredAt: string;
}

export interface ConductStateLeaseHandle {
  release(): Promise<{ ok: true } | { ok: false; message: string }>;
}

export type ConductStateLeaseAcquireResult =
  | { ok: true; handle: ConductStateLeaseHandle }
  | { ok: false; message: string };

export interface ConductStateLease {
  acquire(): Promise<ConductStateLeaseAcquireResult>;
}

export interface ConductStateLeaseOptions {
  filesystem?: ConductStateLeaseFilesystem;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  newToken?: () => string;
  pid?: number;
  waitTimeoutMs?: number;
  retryDelayMs?: number;
}

const defaultFilesystem: ConductStateLeaseFilesystem = {
  acquireDirectory: (path) => mkdir(path),
  writeOwner: (path, contents) => writeFile(path, contents, { encoding: 'utf8', flag: 'wx' }),
  readOwner: (path) => readFile(path, 'utf8'),
  releaseDirectory: (path) => rm(path, { recursive: true }),
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAlreadyHeld(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'EEXIST';
}

function ownerPath(leasePath: string): string {
  return `${leasePath}/${LEASE_OWNER_FILE}`;
}

/**
 * Serializes mutation evaluation and persistence for one local state path.
 * Recovery of an existing lease deliberately belongs to Task 9; this task
 * only waits for its owner to release it within a bounded interval.
 */
export function createConductStateLease(
  statePath: string,
  options: ConductStateLeaseOptions = {},
): ConductStateLease {
  const filesystem = options.filesystem ?? defaultFilesystem;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? delay;
  const newToken = options.newToken ?? randomUUID;
  const pid = options.pid ?? process.pid;
  const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const leasePath = `${statePath}.lease`;

  return {
    async acquire(): Promise<ConductStateLeaseAcquireResult> {
      const startedAt = now();
      const token = newToken();
      const owner: ConductStateLeaseOwner = {
        version: 1,
        pid,
        token,
        acquiredAt: new Date(startedAt).toISOString(),
      };
      const serializedOwner = `${JSON.stringify(owner)}\n`;

      while (true) {
        try {
          await filesystem.acquireDirectory(leasePath);
        } catch (error) {
          if (!isAlreadyHeld(error)) {
            return { ok: false, message: `Unable to acquire conduct-state lease: ${errorMessage(error)}` };
          }

          const elapsedMs = now() - startedAt;
          if (elapsedMs >= waitTimeoutMs) {
            return { ok: false, message: `Unable to acquire conduct-state lease within ${waitTimeoutMs}ms` };
          }
          try {
            await wait(Math.min(retryDelayMs, waitTimeoutMs - elapsedMs));
          } catch (waitError) {
            return { ok: false, message: `Interrupted while waiting for conduct-state lease: ${errorMessage(waitError)}` };
          }
          continue;
        }

        try {
          await filesystem.writeOwner(ownerPath(leasePath), serializedOwner);
        } catch (error) {
          await filesystem.releaseDirectory(leasePath).catch(() => undefined);
          return { ok: false, message: `Unable to record conduct-state lease owner: ${errorMessage(error)}` };
        }

        return {
          ok: true,
          handle: {
            async release(): Promise<{ ok: true } | { ok: false; message: string }> {
              try {
                if (await filesystem.readOwner(ownerPath(leasePath)) !== serializedOwner) {
                  return { ok: false, message: 'Conduct-state lease ownership was lost before release' };
                }
                await filesystem.releaseDirectory(leasePath);
                return { ok: true };
              } catch (error) {
                return { ok: false, message: `Unable to release conduct-state lease: ${errorMessage(error)}` };
              }
            },
          },
        };
      }
    },
  };
}
