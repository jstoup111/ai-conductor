// Per-dispatch engine pinning: turn the floating `dist` link into one
// immutable engine directory, with a valid supervisor-build fallback.

import { lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { currentTarget } from './engine-store.js';
import { versionIdFromEngineDir, type EngineVersionId } from './engine-version-id.js';

export type EnginePinFallbackReason =
  | 'dangling-dist'
  | 'publish-incomplete'
  | 'unparseable-version-id';

export interface EnginePin {
  engineVersionId: EngineVersionId;
  engineDir: string;
  fallbackReason: EnginePinFallbackReason | undefined;
}

export interface ResolveEnginePinOptions {
  /** Package root that owns the floating `dist` symlink. */
  conductorRoot: string;
  /** Engine-version store root, possibly outside `conductorRoot`. */
  storeRoot: string;
  /** Immutable build directory from which the supervisor itself runs. */
  ownEngineDir: string;
}

function supervisorPin(ownEngineDir: string, fallbackReason: EnginePinFallbackReason): EnginePin {
  const engineVersionId = versionIdFromEngineDir(ownEngineDir);
  if (engineVersionId === undefined) {
    throw new Error(`Supervisor engine directory has no parseable version id: ${ownEngineDir}`);
  }
  return { engineVersionId, engineDir: ownEngineDir, fallbackReason };
}

async function isPublishIncomplete(engineDir: string): Promise<boolean> {
  try {
    await lstat(join(engineDir, '.publish-incomplete'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the engine build for one dispatch. `conductorRoot` locates the
 * floating `dist` link while `storeRoot` locates the immutable version store;
 * they intentionally differ when AI_CONDUCTOR_ENGINE_STORE is configured.
 */
export async function resolveEnginePin({
  conductorRoot,
  storeRoot,
  ownEngineDir,
}: ResolveEnginePinOptions): Promise<EnginePin> {
  try {
    await realpath(join(conductorRoot, 'dist'));
  } catch {
    return supervisorPin(ownEngineDir, 'dangling-dist');
  }

  const versionId = await currentTarget(conductorRoot);
  if (versionId === undefined) {
    return supervisorPin(ownEngineDir, 'unparseable-version-id');
  }

  let engineDir: string;
  try {
    engineDir = await realpath(join(storeRoot, versionId));
  } catch {
    return supervisorPin(ownEngineDir, 'dangling-dist');
  }

  if (versionIdFromEngineDir(engineDir) !== versionId) {
    return supervisorPin(ownEngineDir, 'unparseable-version-id');
  }
  if (await isPublishIncomplete(engineDir)) {
    return supervisorPin(ownEngineDir, 'publish-incomplete');
  }

  return { engineVersionId: versionId, engineDir, fallbackReason: undefined };
}
