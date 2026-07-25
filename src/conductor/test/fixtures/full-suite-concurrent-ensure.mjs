import { FullSuiteVerifier } from '../../src/engine/full-suite-verifier.ts';
import { writeFile } from 'node:fs/promises';

const projectRoot = process.argv[2];
const resultPath = process.argv[3];
if (projectRoot === undefined || resultPath === undefined) {
  throw new Error('project root and result path arguments are required');
}

const result = await new FullSuiteVerifier({ projectRoot }).ensure();
await writeFile(resultPath, JSON.stringify(result), 'utf8');
