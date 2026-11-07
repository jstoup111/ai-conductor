import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ENGINE_STORE_ENV_VAR = 'AI_CONDUCTOR_ENGINE_STORE';

export const TEMP_ENGINE_VERSION_ID = '20261107T000000Z-0123456789ab';

export interface TempEngineStore {
  engineRoot: {
    conductorRoot: string;
    ownEngineDir: string;
  };
  teardown(): Promise<void>;
}

/**
 * Creates a complete minimal published-engine layout for daemon composition
 * tests and restores the process-global store override when released.
 */
export async function useTempEngineStore(
  versionId = TEMP_ENGINE_VERSION_ID,
): Promise<TempEngineStore> {
  const conductorRoot = await mkdtemp(join(tmpdir(), 'in-memory-engine-store-'));
  const storeRoot = join(conductorRoot, 'dist-versions');
  const ownEngineDir = join(storeRoot, versionId);
  const previousStoreRoot = process.env[ENGINE_STORE_ENV_VAR];

  await mkdir(ownEngineDir, { recursive: true });
  await symlink(join('dist-versions', versionId), join(conductorRoot, 'dist'), 'dir');
  process.env[ENGINE_STORE_ENV_VAR] = storeRoot;

  return {
    engineRoot: { conductorRoot, ownEngineDir },
    async teardown(): Promise<void> {
      if (previousStoreRoot === undefined) delete process.env[ENGINE_STORE_ENV_VAR];
      else process.env[ENGINE_STORE_ENV_VAR] = previousStoreRoot;
      await rm(conductorRoot, { recursive: true, force: true });
    },
  };
}
