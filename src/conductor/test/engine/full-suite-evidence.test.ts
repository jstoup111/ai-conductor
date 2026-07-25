import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FULL_SUITE_EVIDENCE_VERSION,
  readFullSuiteEvidence,
  writeFullSuiteEvidence,
  type FullSuitePassEvidence,
} from '../../src/engine/full-suite-evidence.js';

const PASS_EVIDENCE: FullSuitePassEvidence = {
  version: FULL_SUITE_EVIDENCE_VERSION,
  outcome: 'PASS',
  reason: 'exit_zero',
  fingerprint: 'sha256:content-fingerprint',
  provenanceHeadSha: '0123456789abcdef',
  command: 'npm test',
  workingDirectory: 'src/conductor',
  startedAt: '2026-07-25T12:00:00.000Z',
  endedAt: '2026-07-25T12:02:03.456Z',
  durationMs: 123_456,
  exitCode: 0,
  stdout: '189 tests passed\n',
  stderr: '',
};

const scratches: string[] = [];

async function makeProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'full-suite-evidence-'));
  scratches.push(projectRoot);
  return projectRoot;
}

afterEach(async () => {
  await Promise.all(
    scratches.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('full-suite evidence', () => {
  it('writes the complete versioned PASS contract', async () => {
    const projectRoot = await makeProject();

    await writeFullSuiteEvidence(projectRoot, PASS_EVIDENCE);

    const serialized = JSON.parse(
      await readFile(join(projectRoot, '.pipeline/test-suite-evidence.json'), 'utf8'),
    );
    expect(serialized).toEqual(PASS_EVIDENCE);
  });

  it('round-trips atomically without leaving a temporary file', async () => {
    const projectRoot = await makeProject();

    await writeFullSuiteEvidence(projectRoot, PASS_EVIDENCE);

    const [roundTrip, entries] = await Promise.all([
      readFullSuiteEvidence(projectRoot),
      readdir(join(projectRoot, '.pipeline')),
    ]);
    expect({
      roundTrip,
      temporaryFiles: entries.filter(
        (entry) => entry.startsWith('.test-suite-evidence.') && entry.endsWith('.tmp'),
      ),
    }).toEqual({ roundTrip: PASS_EVIDENCE, temporaryFiles: [] });
  });
});
