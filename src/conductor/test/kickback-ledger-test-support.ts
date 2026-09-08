import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { KickbackLedger } from '../src/engine/kickback-ledger.js';

/** Seed durable ledger state for tests without exporting a production writer. */
export async function writeKickbackLedger(projectRoot: string, ledger: KickbackLedger): Promise<void> {
  const path = join(projectRoot, '.pipeline', 'kickback-ledger.json');
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.test-seed.tmp`;
  await writeFile(temporary, JSON.stringify(ledger, null, 2));
  await rename(temporary, path);
}
