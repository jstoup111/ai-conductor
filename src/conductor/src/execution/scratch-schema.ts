import * as fsp from 'node:fs/promises';
import { isAbsolute, join, normalize, relative, sep } from 'node:path';

/**
 * Materialize a short-lived provider input inside an already-acquired scratch
 * home. The attempt owner owns the home and removes it through its existing
 * teardown; callers must not create a parallel scratch lifetime for a file.
 */
export async function writeScratchSchema(options: {
  readonly worktreeRoot: string;
  readonly homeDir: string;
  readonly schema: Readonly<Record<string, unknown>>;
}): Promise<string> {
  const scratchRoot = join(normalize(options.worktreeRoot), '.daemon', 'scratch');
  const homeDir = normalize(options.homeDir);
  const fromScratchRoot = relative(scratchRoot, homeDir);
  if (
    fromScratchRoot === '' ||
    fromScratchRoot === '..' ||
    fromScratchRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromScratchRoot)
  ) {
    throw new Error(`provider scratch home is outside the worktree scratch root: ${homeDir}`);
  }

  const schemaPath = join(homeDir, 'output-schema.json');
  await fsp.writeFile(schemaPath, JSON.stringify(options.schema), 'utf8');
  return schemaPath;
}
