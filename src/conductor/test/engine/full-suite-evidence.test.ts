import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FULL_SUITE_DIAGNOSTIC_LIMIT,
  FULL_SUITE_EVIDENCE_VERSION,
  FULL_SUITE_TRUNCATION_MARKER,
  readFullSuiteEvidence,
  sanitizeFullSuiteDiagnosticOutput,
  writeFullSuiteEvidence,
  type FullSuiteFailEvidence,
  type FullSuitePassEvidence,
} from '../../src/engine/full-suite-evidence.js';

const CATEGORY_FINGERPRINTS = {
  additional_inputs: 'category:additional_inputs',
  dependencies: 'category:dependencies',
  environment: 'category:environment',
  migrations: 'category:migrations',
  project_config: 'category:project_config',
  source: 'category:source',
  test_infrastructure: 'category:test_infrastructure',
  tests: 'category:tests',
};

const PASS_EVIDENCE: FullSuitePassEvidence = {
  version: FULL_SUITE_EVIDENCE_VERSION,
  outcome: 'PASS',
  reason: 'exit_zero',
  fingerprint: 'sha256:content-fingerprint',
  categoryFingerprints: CATEGORY_FINGERPRINTS,
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

const FAIL_EVIDENCE: FullSuiteFailEvidence = {
  version: FULL_SUITE_EVIDENCE_VERSION,
  outcome: 'FAIL',
  reason: 'nonzero_exit',
  fingerprint: 'sha256:content-fingerprint',
  provenanceHeadSha: '0123456789abcdef',
  command: 'npm test',
  workingDirectory: 'src/conductor',
  startedAt: '2026-07-25T12:00:00.000Z',
  endedAt: '2026-07-25T12:00:03.000Z',
  durationMs: 3_000,
  exitCode: 7,
  signal: null,
  stdout: 'tests started\n',
  stderr: 'terminal failure\n',
};

const SIGNAL_EVIDENCE: FullSuiteFailEvidence = {
  ...FAIL_EVIDENCE,
  reason: 'signal',
  exitCode: null,
  signal: 'SIGTERM',
};

const scratches: string[] = [];

async function makeProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'full-suite-evidence-'));
  scratches.push(projectRoot);
  return projectRoot;
}

async function writePersisted(projectRoot: string, value: unknown): Promise<void> {
  const path = join(projectRoot, '.pipeline/test-suite-evidence.json');
  await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
  await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
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
    }).toEqual({
      roundTrip: { usable: true, evidence: PASS_EVIDENCE },
      temporaryFiles: [],
    });
  });

  it('treats legacy v1 PASS evidence as unsupported rather than reusable', async () => {
    const projectRoot = await makeProject();
    await writePersisted(projectRoot, { ...PASS_EVIDENCE, version: 1 });

    await expect(readFullSuiteEvidence(projectRoot)).resolves.toEqual({
      usable: false,
      reason: 'unsupported_version',
    });
  });

  it('treats v2 PASS evidence as unsupported rather than reusable', async () => {
    const projectRoot = await makeProject();
    await writePersisted(projectRoot, { ...PASS_EVIDENCE, version: 2 });

    await expect(readFullSuiteEvidence(projectRoot)).resolves.toEqual({
      usable: false,
      reason: 'unsupported_version',
    });
  });

  it('never removes another active writer temporary file', async () => {
    const projectRoot = await makeProject();
    const activeTemporary = join(
      projectRoot,
      '.pipeline/.test-suite-evidence.other-writer.tmp',
    );
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(activeTemporary, 'active writer', 'utf8');

    await writeFullSuiteEvidence(projectRoot, PASS_EVIDENCE);

    await expect(Promise.all([
      readFile(activeTemporary, 'utf8'),
      readFullSuiteEvidence(projectRoot),
    ])).resolves.toEqual([
      'active writer',
      { usable: true, evidence: PASS_EVIDENCE },
    ]);
  });

  it.each([
    {
      name: 'a missing target',
      arrange: async () => undefined,
      expected: { usable: false, reason: 'missing' },
    },
    {
      name: 'malformed JSON',
      arrange: async (projectRoot: string) => writePersisted(projectRoot, '{broken'),
      expected: { usable: false, reason: 'corrupt' },
    },
    {
      name: 'the wrong contract shape',
      arrange: async (projectRoot: string) =>
        writePersisted(projectRoot, {
          version: FULL_SUITE_EVIDENCE_VERSION,
          outcome: 'PASS',
        }),
      expected: { usable: false, reason: 'corrupt' },
    },
    {
      name: 'oversized persisted diagnostics',
      arrange: async (projectRoot: string) =>
        writePersisted(projectRoot, {
          ...PASS_EVIDENCE,
          stdout: 'x'.repeat(FULL_SUITE_DIAGNOSTIC_LIMIT + 1),
        }),
      expected: { usable: false, reason: 'corrupt' },
    },
    {
      name: 'oversized persisted command metadata',
      arrange: async (projectRoot: string) =>
        writePersisted(projectRoot, {
          ...PASS_EVIDENCE,
          command: 'x'.repeat(FULL_SUITE_DIAGNOSTIC_LIMIT + 1),
        }),
      expected: { usable: false, reason: 'corrupt' },
    },
    {
      name: 'oversized persisted working-directory metadata',
      arrange: async (projectRoot: string) =>
        writePersisted(projectRoot, {
          ...PASS_EVIDENCE,
          workingDirectory: '界'.repeat(FULL_SUITE_DIAGNOSTIC_LIMIT),
        }),
      expected: { usable: false, reason: 'corrupt' },
    },
    {
      name: 'persisted non-ASCII diagnostics over the UTF-8 byte limit',
      arrange: async (projectRoot: string) =>
        writePersisted(projectRoot, {
          ...PASS_EVIDENCE,
          stdout: '界'.repeat(6_000),
        }),
      expected: { usable: false, reason: 'corrupt' },
    },
    {
      name: 'persisted emoji diagnostics over the UTF-8 byte limit',
      arrange: async (projectRoot: string) =>
        writePersisted(projectRoot, {
          ...PASS_EVIDENCE,
          stdout: '🙂'.repeat(5_000),
        }),
      expected: { usable: false, reason: 'corrupt' },
    },
    {
      name: 'an unknown contract version',
      arrange: async (projectRoot: string) =>
        writePersisted(projectRoot, { ...PASS_EVIDENCE, version: 99 }),
      expected: { usable: false, reason: 'unsupported_version' },
    },
    {
      name: 'torn-write temporary residue',
      arrange: async (projectRoot: string) => {
        await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
        await writeFile(
          join(projectRoot, '.pipeline/.test-suite-evidence.123.crashed.tmp'),
          JSON.stringify(PASS_EVIDENCE),
          'utf8',
        );
      },
      expected: { usable: false, reason: 'incomplete_write' },
    },
    {
      name: 'a persisted FAIL result',
      arrange: async (projectRoot: string) => writePersisted(projectRoot, FAIL_EVIDENCE),
      expected: { usable: false, reason: 'not_pass', evidence: FAIL_EVIDENCE },
    },
    {
      name: 'a FAIL result with a successful exit code',
      arrange: async (projectRoot: string) =>
        writePersisted(projectRoot, { ...FAIL_EVIDENCE, exitCode: 0 }),
      expected: { usable: false, reason: 'corrupt' },
    },
    {
      name: 'a non-signal FAIL result carrying a signal',
      arrange: async (projectRoot: string) =>
        writePersisted(projectRoot, { ...FAIL_EVIDENCE, signal: 'SIGTERM' }),
      expected: { usable: false, reason: 'corrupt' },
    },
    {
      name: 'a signal FAIL result without a signal',
      arrange: async (projectRoot: string) =>
        writePersisted(projectRoot, { ...SIGNAL_EVIDENCE, signal: null }),
      expected: { usable: false, reason: 'corrupt' },
    },
    {
      name: 'a signal FAIL result with an exit code',
      arrange: async (projectRoot: string) =>
        writePersisted(projectRoot, { ...SIGNAL_EVIDENCE, exitCode: 143 }),
      expected: { usable: false, reason: 'corrupt' },
    },
    {
      name: 'a signal FAIL result with an unknown signal',
      arrange: async (projectRoot: string) =>
        writePersisted(projectRoot, { ...SIGNAL_EVIDENCE, signal: 'NOT_A_SIGNAL' }),
      expected: { usable: false, reason: 'corrupt' },
    },
    {
      name: 'a non-file evidence target',
      arrange: async (projectRoot: string) =>
        mkdir(join(projectRoot, '.pipeline/test-suite-evidence.json'), {
          recursive: true,
        }),
      expected: { usable: false, reason: 'io_error' },
    },
  ])('fails closed without throwing for $name', async ({ arrange, expected }) => {
    const projectRoot = await makeProject();
    await arrange(projectRoot);

    expect(await readFullSuiteEvidence(projectRoot)).toEqual(expected);
  });

  it('writes FAIL evidence atomically and returns it only as non-reusable', async () => {
    const projectRoot = await makeProject();

    await writeFullSuiteEvidence(projectRoot, FAIL_EVIDENCE);

    const [serialized, result, entries] = await Promise.all([
      readFile(join(projectRoot, '.pipeline/test-suite-evidence.json'), 'utf8'),
      readFullSuiteEvidence(projectRoot),
      readdir(join(projectRoot, '.pipeline')),
    ]);
    expect({
      persisted: JSON.parse(serialized),
      result,
      temporaryFiles: entries.filter(
        (entry) => entry.startsWith('.test-suite-evidence.') && entry.endsWith('.tmp'),
      ),
    }).toEqual({
      persisted: FAIL_EVIDENCE,
      result: { usable: false, reason: 'not_pass', evidence: FAIL_EVIDENCE },
      temporaryFiles: [],
    });
  });

  it('round-trips signal failure evidence without losing its signal', async () => {
    const projectRoot = await makeProject();

    await writeFullSuiteEvidence(projectRoot, SIGNAL_EVIDENCE);

    expect(await readFullSuiteEvidence(projectRoot)).toEqual({
      usable: false,
      reason: 'not_pass',
      evidence: SIGNAL_EVIDENCE,
    });
  });

  it.each([
    {
      name: 'a secret equal to the old replacement marker',
      output: 'before [REDACTED] after',
      secrets: ['[REDACTED]'],
    },
    {
      name: 'replacement order creating an earlier secret',
      output: 'abcx',
      secrets: ['[REDACTED]x', 'abc'],
    },
    {
      name: 'a secret equal to the truncation marker',
      output: `head${'x'.repeat(FULL_SUITE_DIAGNOSTIC_LIMIT * 2)}tail`,
      secrets: [FULL_SUITE_TRUNCATION_MARKER],
    },
  ])('never leaves $name', ({ output, secrets }) => {
    const sanitized = sanitizeFullSuiteDiagnosticOutput(output, secrets);

    expect(secrets.filter((secret) => sanitized.includes(secret))).toEqual([]);
  });

  it('redacts secrets and bounds both diagnostic streams while retaining their ends', async () => {
    const projectRoot = await makeProject();
    const secrets = ['stdout-secret-940', 'stderr-secret-940'];
    const evidence: FullSuiteFailEvidence = {
      ...FAIL_EVIDENCE,
      stdout: `stdout beginning 测试🧪\n${secrets[0]}\n${'🙂'.repeat(FULL_SUITE_DIAGNOSTIC_LIMIT)}\n${secrets[1]}\nstdout terminal failure 🚨`,
      stderr: `stderr beginning 界\n${secrets[1]}\n${'界'.repeat(FULL_SUITE_DIAGNOSTIC_LIMIT)}\n${secrets[0]}\nstderr terminal error 🚨`,
    };

    await writeFullSuiteEvidence(projectRoot, evidence, secrets);

    const serialized = await readFile(
      join(projectRoot, '.pipeline/test-suite-evidence.json'),
      'utf8',
    );
    const persisted = JSON.parse(serialized) as FullSuiteFailEvidence;
    expect({
      secretResidue: secrets.filter((secret) => serialized.includes(secret)),
      invalidUtf8Replacement: `${persisted.stdout}${persisted.stderr}`.includes('\uFFFD'),
      stdoutWithinLimit:
        Buffer.byteLength(persisted.stdout, 'utf8') <= FULL_SUITE_DIAGNOSTIC_LIMIT,
      stdoutRetainsEnds:
        persisted.stdout.startsWith('stdout beginning 测试🧪') &&
        persisted.stdout.endsWith('stdout terminal failure 🚨'),
      stdoutMarked: persisted.stdout.includes(FULL_SUITE_TRUNCATION_MARKER),
      stderrWithinLimit:
        Buffer.byteLength(persisted.stderr, 'utf8') <= FULL_SUITE_DIAGNOSTIC_LIMIT,
      stderrRetainsEnds:
        persisted.stderr.startsWith('stderr beginning 界') &&
        persisted.stderr.endsWith('stderr terminal error 🚨'),
      stderrMarked: persisted.stderr.includes(FULL_SUITE_TRUNCATION_MARKER),
    }).toEqual({
      secretResidue: [],
      invalidUtf8Replacement: false,
      stdoutWithinLimit: true,
      stdoutRetainsEnds: true,
      stdoutMarked: true,
      stderrWithinLimit: true,
      stderrRetainsEnds: true,
      stderrMarked: true,
    });
  });

  it('sanitizes and bounds every diagnostic metadata field before persistence', async () => {
    const projectRoot = await makeProject();
    const secret = 'metadata-secret-940';
    const evidence: FullSuiteFailEvidence = {
      ...FAIL_EVIDENCE,
      command: secret,
      workingDirectory: secret,
      stdout: secret,
      stderr: secret,
    };

    await writeFullSuiteEvidence(projectRoot, evidence, [secret]);

    const serialized = await readFile(
      join(projectRoot, '.pipeline/test-suite-evidence.json'),
      'utf8',
    );
    expect({
      leaked: serialized.includes(secret),
      persisted: JSON.parse(serialized),
      readback: await readFullSuiteEvidence(projectRoot),
    }).toEqual({
      leaked: false,
      persisted: {
        ...evidence,
        command: null,
        workingDirectory: null,
        stdout: '',
        stderr: '',
      },
      readback: {
        usable: false,
        reason: 'not_pass',
        evidence: {
          ...evidence,
          command: null,
          workingDirectory: null,
          stdout: '',
          stderr: '',
        },
      },
    });
  });

  it('bounds non-secret command and working-directory diagnostics', async () => {
    const projectRoot = await makeProject();
    const evidence: FullSuiteFailEvidence = {
      ...FAIL_EVIDENCE,
      command: `command-start-${'x'.repeat(FULL_SUITE_DIAGNOSTIC_LIMIT * 2)}-command-end`,
      workingDirectory:
        `directory-start-${'界'.repeat(FULL_SUITE_DIAGNOSTIC_LIMIT)}-directory-end`,
    };

    await writeFullSuiteEvidence(projectRoot, evidence);

    const persisted = JSON.parse(await readFile(
      join(projectRoot, '.pipeline/test-suite-evidence.json'),
      'utf8',
    )) as FullSuiteFailEvidence;
    expect({
      commandWithinLimit:
        persisted.command !== null &&
        Buffer.byteLength(persisted.command, 'utf8') <= FULL_SUITE_DIAGNOSTIC_LIMIT,
      commandRetainsEnds:
        persisted.command?.startsWith('command-start-') === true &&
        persisted.command.endsWith('-command-end'),
      directoryWithinLimit:
        persisted.workingDirectory !== null &&
        Buffer.byteLength(persisted.workingDirectory, 'utf8') <=
          FULL_SUITE_DIAGNOSTIC_LIMIT,
      directoryRetainsEnds:
        persisted.workingDirectory?.startsWith('directory-start-') === true &&
        persisted.workingDirectory.endsWith('-directory-end'),
    }).toEqual({
      commandWithinLimit: true,
      commandRetainsEnds: true,
      directoryWithinLimit: true,
      directoryRetainsEnds: true,
    });
  });
});
