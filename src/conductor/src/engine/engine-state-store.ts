import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createConductStateLease, type ConductStateLease } from './conduct-state-lease.js';

/** The additive, backwards-compatible JSON document held in engine-state.json. */
export type EngineState = Record<string, unknown>;

export type EngineStateReadResult =
  | { ok: true; value: EngineState }
  | { ok: false; kind: 'filesystem' | 'malformed' | 'incompatible'; message: string };

export type EngineStateUpdateResult =
  | { ok: true }
  | {
    ok: false;
    kind: 'filesystem' | 'malformed' | 'incompatible' | 'lease' | 'persistence';
    message: string;
  };

export interface EngineStateTemporaryFile {
  path: string;
  handle?: Awaited<ReturnType<typeof open>>;
}

/** Injectable durability boundary for the engine-state atomic replacement. */
export interface EngineStateFilesystem {
  createTemporary(directory: string): Promise<EngineStateTemporaryFile>;
  writeTemporary(temporary: EngineStateTemporaryFile, contents: string): Promise<void>;
  closeTemporary(temporary: EngineStateTemporaryFile): Promise<void>;
  renameTemporary(source: string, destination: string): Promise<void>;
  cleanupTemporary(path: string): Promise<void>;
}

export interface EngineStateStoreOptions {
  filesystem?: EngineStateFilesystem;
  lease?: ConductStateLease;
}

export interface EngineStateStore {
  read(): Promise<EngineStateReadResult>;
  update(mutator: (current: Readonly<EngineState>) => EngineState | Promise<EngineState>): Promise<EngineStateUpdateResult>;
}

const defaultFilesystem: EngineStateFilesystem = {
  async createTemporary(directory): Promise<EngineStateTemporaryFile> {
    await mkdir(directory, { recursive: true });
    const path = join(directory, `.engine-state.${process.pid}.${randomUUID()}.tmp`);
    return { path, handle: await open(path, 'wx') };
  },
  async writeTemporary(temporary, contents): Promise<void> {
    if (!temporary.handle) throw new Error(`Temporary engine state file is not open: ${temporary.path}`);
    await temporary.handle.writeFile(contents, 'utf8');
  },
  async closeTemporary(temporary): Promise<void> {
    if (!temporary.handle) throw new Error(`Temporary engine state file is not open: ${temporary.path}`);
    await temporary.handle.close();
  },
  renameTemporary: rename,
  cleanupTemporary: (path) => rm(path, { force: true }),
};

/**
 * Serializes acquisition attempts made by stores in this process. The durable
 * lease remains the cross-process authority, but this closes its brief
 * directory-created/owner-published interval for independent local callers.
 */
const localUpdateTails = new Map<string, Promise<void>>();

async function serializeLocalUpdate<T>(statePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = localUpdateTails.get(statePath);
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolve) => { release = resolve; });
  localUpdateTails.set(statePath, current);
  await previous;
  try {
    return await operation();
  } finally {
    release?.();
    if (localUpdateTails.get(statePath) === current) localUpdateTails.delete(statePath);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function isRecord(value: unknown): value is EngineState {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads existing engine state. A missing file is the only legacy-empty state;
 * every present but unreadable control document remains a typed refusal.
 */
export async function readEngineState(path: string): Promise<EngineStateReadResult> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (isMissing(error)) return { ok: true, value: {} };
    return { ok: false, kind: 'filesystem', message: `Failed to read engine state: ${message(error)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, kind: 'malformed', message: 'Engine state contains invalid JSON' };
  }
  if (!isRecord(parsed)) {
    return { ok: false, kind: 'malformed', message: 'Engine state must be a JSON object' };
  }
  if (Object.hasOwn(parsed, 'repairObligations') && !isRecord(parsed.repairObligations)) {
    return {
      ok: false,
      kind: 'incompatible',
      message: 'Engine state repairObligations section is incompatible',
    };
  }
  return { ok: true, value: parsed };
}

async function writeAtomically(
  statePath: string,
  state: EngineState,
  filesystem: EngineStateFilesystem,
): Promise<void> {
  let temporary: EngineStateTemporaryFile | undefined;
  let closed = false;
  try {
    temporary = await filesystem.createTemporary(dirname(statePath));
    await filesystem.writeTemporary(temporary, `${JSON.stringify(state, null, 2)}\n`);
    await filesystem.closeTemporary(temporary);
    closed = true;
    await filesystem.renameTemporary(temporary.path, statePath);
  } catch (error) {
    if (temporary && !closed) await filesystem.closeTemporary(temporary).catch(() => undefined);
    if (temporary) await filesystem.cleanupTemporary(temporary.path).catch(() => undefined);
    throw error;
  }
}

/**
 * Creates the one serialized read-modify-write boundary for engine-state.json.
 * The lease covers the read, mutation, and rename, so independently-created
 * stores cannot overwrite one another's sibling fields.
 */
export function createEngineStateStore(
  statePath: string,
  options: EngineStateStoreOptions = {},
): EngineStateStore {
  const filesystem = options.filesystem ?? defaultFilesystem;
  const lease = options.lease ?? createConductStateLease(statePath, { label: 'engine-state' });

  return {
    read: () => readEngineState(statePath),

    async update(mutator): Promise<EngineStateUpdateResult> {
      return serializeLocalUpdate(statePath, async () => {
        const acquired = await lease.acquire();
        if (!acquired.ok) return { ok: false, kind: 'lease', message: acquired.message };

        let result: EngineStateUpdateResult;
        try {
          const current = await readEngineState(statePath);
          if (!current.ok) {
            result = current;
          } else {
            const next = await mutator(current.value);
            if (!isRecord(next)) {
              result = { ok: false, kind: 'incompatible', message: 'Engine state update must return a JSON object' };
            } else {
              try {
                await writeAtomically(statePath, next, filesystem);
                result = { ok: true };
              } catch (error) {
                result = { ok: false, kind: 'persistence', message: `Failed to persist engine state: ${message(error)}` };
              }
            }
          }
        } catch (error) {
          result = { ok: false, kind: 'filesystem', message: `Failed to update engine state: ${message(error)}` };
        } finally {
          const released = await acquired.handle.release();
          if (!released.ok) result = { ok: false, kind: 'lease', message: released.message };
        }
        return result;
      });
    },
  };
}
