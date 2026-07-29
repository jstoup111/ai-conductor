import { access, mkdir, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import {
  HALT_CLASS_MARKER,
  HALT_MARKER,
  readHaltClass,
} from './halt-marker.js';

const MIGRATION_NAME = 'halt-classification-v1';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function stampLegacy(worktreePath: string): Promise<void> {
  const destination = join(worktreePath, HALT_CLASS_MARKER);
  const temporary = `${destination}.tmp`;
  try {
    await writeFile(temporary, 'legacy', 'utf-8');
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function errorCode(error: unknown): string {
  if (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && typeof error.code === 'string'
  ) {
    return error.code;
  }
  return 'UNKNOWN';
}

/**
 * Stamp live HALTs created before total classification as legacy exactly once.
 *
 * The daemon invokes this while holding exclusive ownership. A completion
 * watermark is atomically published only after every discovered HALT has been
 * inspected and any missing classification has been stamped.
 */
export async function migrateLegacyHaltClasses(
  projectRoot: string,
  worktreeBase: string,
  log: (message: string) => void,
): Promise<void> {
  const migrationDirectory = join(projectRoot, '.daemon', 'migrations');
  const watermark = join(migrationDirectory, MIGRATION_NAME);
  if (await exists(watermark)) return;

  let entries: Dirent[];
  try {
    entries = await readdir(worktreeBase, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    entries = [];
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const worktreePath = join(worktreeBase, entry.name);
    if (!(await exists(join(worktreePath, HALT_MARKER)))) continue;
    if ((await readHaltClass(worktreePath)) !== 'unclassified') continue;
    try {
      await stampLegacy(worktreePath);
      log(`[halt-class-migration] stamped ${entry.name} as legacy`);
    } catch (error) {
      log(
        `[halt-class-migration] failed to stamp ${entry.name} as legacy (${errorCode(error)}); left unclassified`,
      );
    }
  }

  await mkdir(migrationDirectory, { recursive: true });
  const temporaryWatermark = `${watermark}.tmp`;
  try {
    await writeFile(temporaryWatermark, 'complete\n', 'utf-8');
    await rename(temporaryWatermark, watermark);
  } catch (error) {
    await unlink(temporaryWatermark).catch(() => {});
    throw error;
  }
  log(`[halt-class-migration] completed ${MIGRATION_NAME}`);
}
