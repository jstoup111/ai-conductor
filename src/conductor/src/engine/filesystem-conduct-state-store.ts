import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createConductStateLease, type ConductStateLease } from './conduct-state-lease.js';
import { readState } from './state.js';
import {
  evaluateConductStateMutation,
  type StateMutationDiagnostics,
} from './conduct-state-conflicts.js';
import type { ConductState, StateResult } from '../types/state.js';
import type {
  ConductStateStore,
  NamedAtomicStateMutationBatch,
  PrivilegedStateReplacement,
  StateMutation,
  StateMutationResult,
} from './conduct-state-store.js';

/**
 * Persistence seam for the adapter's accepted state snapshots. Later tasks
 * own atomic replacement and local-process serialization behind this boundary.
 */
export interface ConductStatePersistence {
  write(path: string, state: ConductState): Promise<void>;
}

/**
 * Filesystem boundary for atomic state replacement. Keeping this injectable
 * lets tests fail each durability boundary without depending on host I/O.
 */
export interface AtomicStateFilesystem {
  createTemp(directory: string): Promise<AtomicStateTemporaryFile>;
  writeTemp(temp: AtomicStateTemporaryFile, contents: string): Promise<void>;
  syncTemp(temp: AtomicStateTemporaryFile): Promise<void>;
  closeTemp(temp: AtomicStateTemporaryFile): Promise<void>;
  renameTemp(tempPath: string, statePath: string): Promise<void>;
  cleanupTemp(tempPath: string): Promise<void>;
}

export interface AtomicStateTemporaryFile {
  path: string;
  handle?: Awaited<ReturnType<typeof open>>;
}

export interface FilesystemConductStateStore extends ConductStateStore<ConductState> {
  read(): Promise<StateResult<ConductState>>;
}

const defaultAtomicFilesystem: AtomicStateFilesystem = {
  async createTemp(directory): Promise<AtomicStateTemporaryFile> {
    await mkdir(directory, { recursive: true });
    const path = join(directory, `.conduct-state.${process.pid}.${randomUUID()}.tmp`);
    return { path, handle: await open(path, 'wx') };
  },

  async writeTemp(temp, contents): Promise<void> {
    if (!temp.handle) {
      throw new Error(`Temporary state file is not open: ${temp.path}`);
    }
    await temp.handle.writeFile(contents, 'utf-8');
  },

  async syncTemp(temp): Promise<void> {
    if (!temp.handle) {
      throw new Error(`Temporary state file is not open: ${temp.path}`);
    }
    await temp.handle.sync();
  },

  async closeTemp(temp): Promise<void> {
    if (!temp.handle) {
      throw new Error(`Temporary state file is not open: ${temp.path}`);
    }
    await temp.handle.close();
  },

  renameTemp: rename,
  async cleanupTemp(path): Promise<void> {
    await rm(path, { force: true });
  },
};

function createAtomicPersistence(filesystem: AtomicStateFilesystem): ConductStatePersistence {
  return {
    async write(path, state): Promise<void> {
      let temporary: AtomicStateTemporaryFile | undefined;
      let closeAttempted = false;

      try {
        temporary = await filesystem.createTemp(dirname(path));
        await filesystem.writeTemp(temporary, `${JSON.stringify(state, null, 2)}\n`);
        await filesystem.syncTemp(temporary);
        closeAttempted = true;
        await filesystem.closeTemp(temporary);
        await filesystem.renameTemp(temporary.path, path);
      } catch (error) {
        if (temporary && !closeAttempted) {
          try {
            await filesystem.closeTemp(temporary);
          } catch {
            // The original write failure remains the authoritative result.
          }
        }
        if (temporary) {
          try {
            await filesystem.cleanupTemp(temporary.path);
          } catch {
            // Cleanup is best effort; never report success after the write failed.
          }
        }
        throw error;
      }
    },
  };
}

/**
 * Creates the local persistent adapter for the backwards-compatible flat
 * conduct-state JSON file. Every mutation reads the current state immediately
 * before applying its one owned field, so a stale caller snapshot cannot be
 * persisted as a whole-object replacement.
 */
export function createFilesystemConductStateStore(
  path: string,
  persistence?: ConductStatePersistence,
  diagnostics?: StateMutationDiagnostics,
  filesystem: AtomicStateFilesystem = defaultAtomicFilesystem,
  lease: ConductStateLease = createConductStateLease(path),
): FilesystemConductStateStore {
  const resolvedPersistence = persistence ?? createAtomicPersistence(filesystem);

  async function whileHoldingLease(
    mutation: () => Promise<StateMutationResult>,
  ): Promise<StateMutationResult> {
    const acquired = await lease.acquire();
    if (!acquired.ok) return { kind: 'lease', message: acquired.message };

    const result = await mutation();
    const released = await acquired.handle.release();
    return released.ok ? result : { kind: 'lease', message: released.message };
  }

  return {
    read(): Promise<StateResult<ConductState>> {
      return readState(path);
    },

    async apply(mutation: StateMutation<ConductState>): Promise<StateMutationResult> {
      return whileHoldingLease(async () => {
        const current = await readState(path);
        if (!current.ok) {
          return { kind: 'persistence', message: current.error.message };
        }

        const state = current.value;
        const currentValue = (state as Record<string, unknown>)[mutation.field];
        const result = evaluateConductStateMutation(currentValue, mutation, diagnostics);
        if (result.kind !== 'applied') {
          return result;
        }

        const nextState: ConductState = {
          ...state,
          [mutation.field]: mutation.next,
        };
        try {
          await resolvedPersistence.write(path, nextState);
        } catch (error) {
          return { kind: 'persistence', message: `Failed to persist state: ${error}` };
        }
        return { kind: 'applied' };
      });
    },

    async applyBatch(batch: NamedAtomicStateMutationBatch<ConductState>): Promise<StateMutationResult> {
      return whileHoldingLease(async () => {
        const current = await readState(path);
        if (!current.ok) {
          return { kind: 'persistence', message: current.error.message };
        }

        const state = current.value;
        for (const mutation of batch.mutations) {
          const currentValue = (state as Record<string, unknown>)[mutation.field];
          if (!Object.is(currentValue, mutation.expected)) {
            return {
              kind: 'conflict',
              message: `Expected ${mutation.field} to match before ${mutation.intent}`,
            };
          }
        }

        const nextState = batch.mutations.reduce<ConductState>((updated, mutation) => ({
          ...updated,
          [mutation.field]: mutation.next,
        }), state);
        try {
          await resolvedPersistence.write(path, nextState);
        } catch (error) {
          return { kind: 'persistence', message: `Failed to persist state: ${error}` };
        }
        return { kind: 'applied' };
      });
    },

    async replace(
      replacement: PrivilegedStateReplacement<ConductState>,
    ): Promise<StateMutationResult> {
      return whileHoldingLease(async () => {
        // A reset is intentionally destructive, but only after the current
        // document has been proven readable while this writer owns the lease.
        // This keeps corrupt or empty input from being silently overwritten.
        const current = await readState(path);
        if (!current.ok) {
          return { kind: 'persistence', message: current.error.message };
        }

        try {
          await resolvedPersistence.write(path, replacement.next);
        } catch (error) {
          return { kind: 'persistence', message: `Failed to persist state: ${error}` };
        }
        return { kind: 'applied' };
      });
    },
  };
}
