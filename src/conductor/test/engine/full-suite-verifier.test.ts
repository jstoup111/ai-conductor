import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  FULL_SUITE_EVIDENCE_VERSION,
  readFullSuiteEvidence,
  type FullSuitePassEvidence,
} from '../../src/engine/full-suite-evidence.js';
import { FullSuiteVerifier } from '../../src/engine/full-suite-verifier.js';

const scratches: string[] = [];

afterEach(async () => {
  await Promise.all(
    scratches.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('FullSuiteVerifier', () => {
  it('executes once and atomically records current PASS evidence when none exists', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'full-suite-verifier-'));
    scratches.push(projectRoot);
    const workingDirectory = join(projectRoot, 'packages/app');
    await mkdir(join(projectRoot, '.ai-conductor'), { recursive: true });
    await mkdir(workingDirectory, { recursive: true });
    await writeFile(
      join(projectRoot, '.ai-conductor/config.yml'),
      [
        'test_suite:',
        '  command: node suite.mjs --all',
        '  working_directory: packages/app',
        '  timeout_seconds: 42',
        '  environment:',
        '    - SUITE_MODE',
        '',
      ].join('\n'),
      'utf8',
    );
    const environment = { PATH: '/fixture/bin', SUITE_MODE: 'aggregate' };
    const fingerprintCalls: unknown[] = [];
    const executionCalls: unknown[] = [];
    const executionStdout = 'suite mode: aggregate\nunit: pass\nacceptance: pass\n';
    const expectedEvidence: FullSuitePassEvidence = {
      version: FULL_SUITE_EVIDENCE_VERSION,
      outcome: 'PASS',
      reason: 'exit_zero',
      fingerprint: 'sha256:current-inputs',
      provenanceHeadSha: '0123456789abcdef',
      command: 'node suite.mjs --all',
      workingDirectory,
      startedAt: '2026-07-25T15:00:00.000Z',
      endedAt: '2026-07-25T15:00:02.500Z',
      durationMs: 2_500,
      exitCode: 0,
      stdout: 'suite mode: \nunit: pass\nacceptance: pass\n',
      stderr: '',
    };

    const verifier = new FullSuiteVerifier({
      projectRoot,
      environment,
      fingerprint: async (options) => {
        fingerprintCalls.push(options);
        return {
          ok: true,
          fingerprint: {
            digest: expectedEvidence.fingerprint,
            headSha: expectedEvidence.provenanceHeadSha,
          },
        };
      },
      execute: async (options) => {
        executionCalls.push(options);
        return {
          ok: true,
          command: expectedEvidence.command,
          cwd: resolve(projectRoot, 'packages/app'),
          startedAt: expectedEvidence.startedAt,
          endedAt: expectedEvidence.endedAt,
          durationMs: expectedEvidence.durationMs,
          exitCode: 0,
          stdout: executionStdout,
          stderr: expectedEvidence.stderr,
        };
      },
    });

    const result = await verifier.ensure();
    const [persisted, serialized, entries] = await Promise.all([
      readFullSuiteEvidence(projectRoot),
      readFile(join(projectRoot, '.pipeline/test-suite-evidence.json'), 'utf8'),
      readdir(join(projectRoot, '.pipeline')),
    ]);
    expect({
      result,
      fingerprintCalls,
      executionCalls,
      persisted,
      serialized: JSON.parse(serialized),
      temporaryFiles: entries.filter(
        (entry) => entry.startsWith('.test-suite-evidence.') && entry.endsWith('.tmp'),
      ),
    }).toEqual({
      result: { status: 'EXECUTED', evidence: expectedEvidence },
      fingerprintCalls: [
        {
          projectRoot,
          testSuite: {
            command: expectedEvidence.command,
            working_directory: 'packages/app',
            timeout_seconds: 42,
            environment: ['SUITE_MODE'],
          },
          environmentValues: environment,
        },
      ],
      executionCalls: [
        {
          projectRoot,
          testSuite: {
            command: expectedEvidence.command,
            working_directory: 'packages/app',
            timeout_seconds: 42,
            environment: ['SUITE_MODE'],
          },
          environment,
        },
      ],
      persisted: { usable: true, evidence: expectedEvidence },
      serialized: expectedEvidence,
      temporaryFiles: [],
    });
  });

  it('reuses an earlier fallback PASS across callers, reconstruction, and SHA churn', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'full-suite-verifier-reuse-'));
    scratches.push(projectRoot);
    const workingDirectory = join(projectRoot, 'packages/app');
    await mkdir(join(projectRoot, '.ai-conductor'), { recursive: true });
    await mkdir(workingDirectory, { recursive: true });
    await writeFile(
      join(projectRoot, '.ai-conductor/config.yml'),
      [
        'test_suite:',
        '  command: node suite.mjs --all',
        '  working_directory: packages/app',
        '  timeout_seconds: 42',
        '',
      ].join('\n'),
      'utf8',
    );
    const environment = { PATH: '/fixture/bin' };
    const originalHeadSha = '1111111111111111';
    let currentHeadSha = originalHeadSha;
    let executionCount = 0;
    let fingerprintCount = 0;
    const expectedEvidence: FullSuitePassEvidence = {
      version: FULL_SUITE_EVIDENCE_VERSION,
      outcome: 'PASS',
      reason: 'exit_zero',
      fingerprint: 'sha256:byte-identical-content',
      provenanceHeadSha: originalHeadSha,
      command: 'node suite.mjs --all',
      workingDirectory,
      startedAt: '2026-07-25T16:00:00.000Z',
      endedAt: '2026-07-25T16:00:03.000Z',
      durationMs: 3_000,
      exitCode: 0,
      stdout: 'all suites passed\n',
      stderr: '',
    };
    const verifier = () => new FullSuiteVerifier({
      projectRoot,
      environment,
      fingerprint: async () => {
        fingerprintCount += 1;
        return {
          ok: true,
          fingerprint: {
            digest: expectedEvidence.fingerprint,
            headSha: currentHeadSha,
          },
        };
      },
      execute: async () => {
        executionCount += 1;
        return {
          ok: true,
          command: expectedEvidence.command,
          cwd: workingDirectory,
          startedAt: expectedEvidence.startedAt,
          endedAt: expectedEvidence.endedAt,
          durationMs: expectedEvidence.durationMs,
          exitCode: 0,
          stdout: expectedEvidence.stdout,
          stderr: expectedEvidence.stderr,
        };
      },
    });
    const inspect = async () => {
      const reconstructed = verifier() as FullSuiteVerifier & {
        inspect?: () => Promise<unknown>;
      };
      return reconstructed.inspect === undefined
        ? { status: 'UNAVAILABLE' }
        : reconstructed.inspect();
    };

    const fallback = await verifier().ensure();
    const laterCaller = await verifier().ensure();
    const sameHeadInspection = await inspect();
    currentHeadSha = '2222222222222222';
    const reconstructedCaller = await verifier().ensure();
    const changedHeadInspection = await inspect();
    const persisted = await readFullSuiteEvidence(projectRoot);

    expect({
      fallback,
      laterCaller,
      sameHeadInspection,
      reconstructedCaller,
      changedHeadInspection,
      executionCount,
      fingerprintCount,
      persisted,
    }).toEqual({
      fallback: { status: 'EXECUTED', evidence: expectedEvidence },
      laterCaller: { status: 'REUSED', evidence: expectedEvidence },
      sameHeadInspection: { status: 'CURRENT', evidence: expectedEvidence },
      reconstructedCaller: { status: 'REUSED', evidence: expectedEvidence },
      changedHeadInspection: { status: 'CURRENT', evidence: expectedEvidence },
      executionCount: 1,
      fingerprintCount: 5,
      persisted: { usable: true, evidence: expectedEvidence },
    });
  });
});
