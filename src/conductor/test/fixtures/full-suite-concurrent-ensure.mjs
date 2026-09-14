import { FullSuiteVerifier } from '../../src/engine/full-suite-verifier.ts';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const projectRoot = process.argv[2];
const resultPath = process.argv[3];
if (projectRoot === undefined || resultPath === undefined) {
  throw new Error('project root and result path arguments are required');
}

const verifier = new FullSuiteVerifier({ projectRoot });
const inspection = process.argv[4] === '--with-inspection'
  ? await verifier.inspect()
  : undefined;
if (inspection !== undefined) {
  const barrier = join(projectRoot, '.pipeline/inspected-callers');
  await mkdir(barrier, { recursive: true });
  await writeFile(join(barrier, String(process.pid)), 'inspected', 'utf8');
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if ((await readdir(barrier)).length >= 2) break;
    await delay(10);
  }
  if ((await readdir(barrier)).length < 2) {
    throw new Error('timed out waiting for concurrent callers to inspect');
  }
}
const result = await verifier.ensure(inspection);
await writeFile(resultPath, JSON.stringify(result), 'utf8');
