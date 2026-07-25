import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const FULL_SUITE_EVIDENCE_VERSION = 1 as const;
export const FULL_SUITE_EVIDENCE_PATH = '.pipeline/test-suite-evidence.json';

export interface FullSuitePassEvidence {
  version: typeof FULL_SUITE_EVIDENCE_VERSION;
  outcome: 'PASS';
  reason: 'exit_zero';
  fingerprint: string;
  provenanceHeadSha: string;
  command: string;
  workingDirectory: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  exitCode: 0;
  stdout: string;
  stderr: string;
}

export async function writeFullSuiteEvidence(
  projectRoot: string,
  evidence: FullSuitePassEvidence,
): Promise<void> {
  const directory = join(projectRoot, '.pipeline');
  const destination = join(projectRoot, FULL_SUITE_EVIDENCE_PATH);
  const temporary = join(
    directory,
    `.test-suite-evidence.${process.pid}.${randomUUID()}.tmp`,
  );
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readFullSuiteEvidence(
  projectRoot: string,
): Promise<FullSuitePassEvidence> {
  const serialized = await readFile(
    join(projectRoot, FULL_SUITE_EVIDENCE_PATH),
    'utf8',
  );
  return JSON.parse(serialized) as FullSuitePassEvidence;
}
