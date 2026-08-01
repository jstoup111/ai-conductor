import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProviderLifecycleState } from './provider-lifecycle.js';

export interface ProviderLifecycleEpisodeStoreFileOperations {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  writeFile(path: string, content: string): Promise<unknown>;
  rename(from: string, to: string): Promise<unknown>;
}

export interface ProviderLifecycleEpisodeStore {
  writeProviderLifecycleEpisode(projectRoot: string, lifecycle: ProviderLifecycleState): Promise<void>;
}

const defaultFileOperations: ProviderLifecycleEpisodeStoreFileOperations = {
  mkdir,
  writeFile,
  rename,
};

function episodePath(projectRoot: string, logicalStep: string): string {
  return join(projectRoot, '.pipeline', `provider-lifecycle-${logicalStep}.json`);
}

export function createProviderLifecycleEpisodeStore(
  fileOperations: ProviderLifecycleEpisodeStoreFileOperations = defaultFileOperations,
): ProviderLifecycleEpisodeStore {
  return {
    async writeProviderLifecycleEpisode(projectRoot, lifecycle): Promise<void> {
      const path = episodePath(projectRoot, lifecycle.attempt.logicalStep);
      const directory = join(projectRoot, '.pipeline');
      const temporaryPath = join(
        directory,
        `.provider-lifecycle-${lifecycle.attempt.logicalStep}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
      );

      await fileOperations.mkdir(directory, { recursive: true });
      try {
        await fileOperations.writeFile(temporaryPath, `${JSON.stringify(lifecycle, null, 2)}\n`);
        await fileOperations.rename(temporaryPath, path);
      } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
      }
    },
  };
}

const defaultStore = createProviderLifecycleEpisodeStore();

export async function writeProviderLifecycleEpisode(
  projectRoot: string,
  lifecycle: ProviderLifecycleState,
): Promise<void> {
  await defaultStore.writeProviderLifecycleEpisode(projectRoot, lifecycle);
}

export async function readProviderLifecycleEpisode(
  projectRoot: string,
  logicalStep: string,
): Promise<ProviderLifecycleState | undefined> {
  try {
    return JSON.parse(await readFile(episodePath(projectRoot, logicalStep), 'utf-8')) as ProviderLifecycleState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function clearProviderLifecycleEpisode(projectRoot: string, logicalStep: string): Promise<void> {
  await rm(episodePath(projectRoot, logicalStep), { force: true });
}
