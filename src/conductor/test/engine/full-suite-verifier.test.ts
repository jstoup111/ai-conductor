import { afterEach, describe, expect, it } from 'vitest';
import { execa } from 'execa';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FULL_SUITE_EVIDENCE_VERSION,
  readFullSuiteEvidence,
  writeFullSuiteEvidence,
  type FullSuitePassEvidence,
} from '../../src/engine/full-suite-evidence.js';
import type { FullSuiteExecutionResult } from '../../src/engine/full-suite-executor.js';
import { FullSuiteVerifier } from '../../src/engine/full-suite-verifier.js';

const scratches: string[] = [];
const CONDUCTOR_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TSX_LOADER = join(CONDUCTOR_ROOT, 'node_modules/tsx/dist/loader.mjs');
const CONCURRENT_ENSURE_FIXTURE = join(
  CONDUCTOR_ROOT,
  'test/fixtures/full-suite-concurrent-ensure.mjs',
);
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

async function writeProjectFile(
  projectRoot: string,
  path: string,
  contents: string,
): Promise<void> {
  const destination = join(projectRoot, path);
  await mkdir(resolve(destination, '..'), { recursive: true });
  await writeFile(destination, contents, 'utf8');
}

async function makeFingerprintProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'full-suite-verifier-matrix-'));
  scratches.push(projectRoot);
  const files: Record<string, string> = {
    '.ai-conductor/config.yml': [
      'test_suite:',
      '  command: node suite.mjs --all',
      '  working_directory: .',
      '  timeout_seconds: 42',
      '  inputs:',
      '    - private/state.bin',
      '  environment:',
      '    - SUITE_MODE',
      '',
    ].join('\n'),
    '.gitignore': 'private/*.bin\n.pipeline/\n',
    'README.md': '# fixture\n',
    'db/migrations/001.sql': 'CREATE TABLE one;\n',
    'package-lock.json': '{"lockfileVersion":3}\n',
    'requirements.txt': 'pytest==8.0.0\n',
    'src/app.ts': 'export const value = 1;\n',
    'test/app.test.ts': 'test("value", () => {});\n',
    'test/setup.ts': 'export const setup = 1;\n',
  };
  for (const [path, contents] of Object.entries(files)) {
    await writeProjectFile(projectRoot, path, contents);
  }
  await writeProjectFile(projectRoot, 'private/state.bin', 'private state one\n');
  await execa('git', ['init', '-q', '-b', 'main'], { cwd: projectRoot });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: projectRoot });
  await execa('git', ['config', 'user.name', 'Test'], { cwd: projectRoot });
  await execa('git', ['add', '.'], { cwd: projectRoot });
  await execa('git', ['commit', '-q', '-m', 'fixture'], { cwd: projectRoot });
  return projectRoot;
}

async function makeConfiguredProject(prefix: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), prefix));
  scratches.push(projectRoot);
  await writeProjectFile(
    projectRoot,
    '.ai-conductor/config.yml',
    'test_suite:\n  command: node suite.mjs --all\n  environment:\n    - SUITE_SECRET\n',
  );
  return projectRoot;
}

afterEach(async () => {
  await Promise.all(
    scratches.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('FullSuiteVerifier', () => {
  it('keeps raw secret-bearing config in memory while returning only sanitized PASS evidence', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'full-suite-secret-metadata-pass-'));
    scratches.push(projectRoot);
    const secret = 'configured-metadata-secret-940';
    await writeProjectFile(
      projectRoot,
      '.ai-conductor/config.yml',
      [
        'test_suite:',
        `  command: ${secret}`,
        `  working_directory: ${secret}`,
        '  environment:',
        '    - SUITE_SECRET',
        '',
      ].join('\n'),
    );
    await mkdir(join(projectRoot, secret), { recursive: true });
    let receivedConfig: unknown;
    const verifier = new FullSuiteVerifier({
      projectRoot,
      environment: { SUITE_SECRET: secret },
      fingerprint: async (options) => {
        receivedConfig = options.testSuite;
        return {
          ok: true,
          fingerprint: {
            digest: 'sha256:secret-metadata-pass',
            headSha: 'head-secret-metadata-pass',
            categoryFingerprints: CATEGORY_FINGERPRINTS,
          },
        };
      },
      execute: async (options) => {
        expect(options.testSuite).toEqual({
          command: secret,
          working_directory: secret,
          environment: ['SUITE_SECRET'],
        });
        return {
          ok: true,
          command: secret,
          cwd: secret,
          startedAt: '2026-07-25T15:00:00.000Z',
          endedAt: '2026-07-25T15:00:01.000Z',
          durationMs: 1_000,
          exitCode: 0,
          stdout: secret,
          stderr: secret,
        };
      },
    });

    const result = await verifier.ensure();
    const serialized = await readFile(
      join(projectRoot, '.pipeline/test-suite-evidence.json'),
      'utf8',
    );

    expect(receivedConfig).toEqual({
      command: secret,
      working_directory: secret,
      environment: ['SUITE_SECRET'],
    });
    expect({
      resultLeaks: JSON.stringify(result).includes(secret),
      serializedLeaks: serialized.includes(secret),
      result,
    }).toEqual({
      resultLeaks: false,
      serializedLeaks: false,
      result: {
        status: 'EXECUTED',
        freshness: { status: 'STALE', reason: 'missing' },
        evidence: expect.objectContaining({
          outcome: 'PASS',
          command: null,
          workingDirectory: null,
          stdout: '',
          stderr: '',
        }),
      },
    });
  });

  it('sanitizes secret-bearing config and diagnostics from preflight results', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'full-suite-secret-preflight-'));
    scratches.push(projectRoot);
    const secret = 'configured-preflight-secret-940';
    await writeProjectFile(
      projectRoot,
      '.ai-conductor/config.yml',
      [
        'test_suite:',
        `  command: ${secret}`,
        `  working_directory: ${secret}`,
        '  environment:',
        '    - SUITE_SECRET',
        '',
      ].join('\n'),
    );
    const verifier = new FullSuiteVerifier({
      projectRoot,
      environment: { SUITE_SECRET: secret },
      fingerprint: async () => ({
        ok: false,
        reason: {
          code: 'input_read_failed',
          message: secret,
          path: secret,
        },
      }),
      execute: async () => {
        throw new Error('preflight failures must not execute');
      },
    });

    const result = await verifier.ensure();
    const serialized = await readFile(
      join(projectRoot, '.pipeline/test-suite-evidence.json'),
      'utf8',
    );

    expect({
      resultLeaks: JSON.stringify(result).includes(secret),
      serializedLeaks: serialized.includes(secret),
      result,
    }).toEqual({
      resultLeaks: false,
      serializedLeaks: false,
      result: {
        status: 'FAILED',
        reason: 'preflight_failed',
        message: '',
        evidence: expect.objectContaining({
          command: null,
          workingDirectory: null,
          stderr: '',
        }),
      },
    });
  });

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
      categoryFingerprints: CATEGORY_FINGERPRINTS,
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
            categoryFingerprints: CATEGORY_FINGERPRINTS,
          },
        };
      },
      execute: async (options) => {
        executionCalls.push(options);
        return {
          ok: true,
          // Fixture-constructed above with a literal string; FullSuitePassEvidence
          // widens `command` to `string | null` to cover the general artifact
          // shape, but this test's evidence is never actually null.
          command: expectedEvidence.command!,
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
      result: {
        status: 'EXECUTED',
        freshness: { status: 'STALE', reason: 'missing' },
        evidence: expectedEvidence,
      },
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
    let currentCategoryFingerprints = CATEGORY_FINGERPRINTS;
    let executionCount = 0;
    let fingerprintCount = 0;
    const expectedEvidence: FullSuitePassEvidence = {
      version: FULL_SUITE_EVIDENCE_VERSION,
      outcome: 'PASS',
      reason: 'exit_zero',
      fingerprint: 'sha256:byte-identical-content',
      categoryFingerprints: CATEGORY_FINGERPRINTS,
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
            categoryFingerprints: currentCategoryFingerprints,
          },
        };
      },
      execute: async () => {
        executionCount += 1;
        return {
          ok: true,
          // See the other execute() stub above: fixture-constructed with a
          // literal string, never actually null at runtime.
          command: expectedEvidence.command!,
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
    currentCategoryFingerprints = {
      ...CATEGORY_FINGERPRINTS,
      source: 'diagnostic-category-metadata-does-not-change-reuse',
    };
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
      fallback: {
        status: 'EXECUTED',
        freshness: { status: 'STALE', reason: 'missing' },
        evidence: expectedEvidence,
      },
      laterCaller: { status: 'REUSED', evidence: expectedEvidence },
      sameHeadInspection: { status: 'CURRENT', evidence: expectedEvidence },
      reconstructedCaller: { status: 'REUSED', evidence: expectedEvidence },
      changedHeadInspection: { status: 'CURRENT', evidence: expectedEvidence },
      executionCount: 1,
      fingerprintCount: 5,
      persisted: { usable: true, evidence: expectedEvidence },
    });
  });

  it('classifies the complete mutation matrix and reruns only content-stale inputs', async () => {
    const mutationCases: Array<{
      name: string;
      mutate: (projectRoot: string) => Promise<void>;
      environment?: NodeJS.ProcessEnv;
      reason?: string;
    }> = [
      {
        name: 'source',
        reason: 'source_changed',
        mutate: (root) => writeProjectFile(root, 'src/app.ts', 'export const value = 2;\n'),
      },
      {
        name: 'tests',
        reason: 'tests_changed',
        mutate: (root) => writeProjectFile(root, 'test/app.test.ts', 'test("changed", () => {});\n'),
      },
      {
        name: 'project config',
        reason: 'project_config_changed',
        mutate: async (root) => {
          const path = join(root, '.ai-conductor/config.yml');
          await writeFile(path, `${await readFile(path, 'utf8')}# changed\n`, 'utf8');
        },
      },
      {
        name: 'package lock',
        reason: 'dependencies_changed',
        mutate: (root) => writeProjectFile(root, 'package-lock.json', '{"lockfileVersion":4}\n'),
      },
      {
        name: 'requirements.txt',
        reason: 'dependencies_changed',
        mutate: (root) => writeProjectFile(root, 'requirements.txt', 'pytest==8.1.0\n'),
      },
      {
        name: 'migration',
        reason: 'migrations_changed',
        mutate: (root) => writeProjectFile(root, 'db/migrations/001.sql', 'CREATE TABLE two;\n'),
      },
      {
        name: 'test infrastructure',
        reason: 'test_infrastructure_changed',
        mutate: (root) => writeProjectFile(root, 'test/setup.ts', 'export const setup = 2;\n'),
      },
      {
        name: 'declared ignored input',
        reason: 'additional_inputs_changed',
        mutate: (root) => writeProjectFile(root, 'private/state.bin', 'private state two\n'),
      },
      {
        name: 'declared environment',
        reason: 'environment_changed',
        environment: { PATH: '/fixture/bin', SUITE_MODE: 'second' },
        mutate: async () => undefined,
      },
      {
        name: 'mixed docs and code',
        reason: 'source_changed',
        mutate: async (root) => {
          await writeProjectFile(root, 'README.md', '# changed docs\n');
          await writeProjectFile(root, 'src/app.ts', 'export const value = 3;\n');
        },
      },
      {
        name: 'docs only',
        mutate: (root) => writeProjectFile(root, 'README.md', '# changed docs only\n'),
      },
    ];
    const observed: unknown[] = [];

    for (const testCase of mutationCases) {
      const projectRoot = await makeFingerprintProject();
      let launches = 0;
      const createVerifier = (environment: NodeJS.ProcessEnv) => new FullSuiteVerifier({
        projectRoot,
        environment,
        execute: async () => {
          launches += 1;
          return {
            ok: true,
            command: 'node suite.mjs --all',
            cwd: projectRoot,
            startedAt: '2026-07-25T17:00:00.000Z',
            endedAt: '2026-07-25T17:00:01.000Z',
            durationMs: 1_000,
            exitCode: 0,
            stdout: 'all suites passed\n',
            stderr: '',
          };
        },
      });
      const initialEnvironment = { PATH: '/fixture/bin', SUITE_MODE: 'first' };
      const baseline = await createVerifier(initialEnvironment).ensure();
      await testCase.mutate(projectRoot);
      const verifier = createVerifier(testCase.environment ?? initialEnvironment);
      const inspection = await verifier.inspect();
      const ensured = await verifier.ensure();
      const freshness = 'freshness' in ensured ? ensured.freshness : undefined;

      observed.push({
        name: testCase.name,
        baseline: baseline.status,
        inspection: inspection.status === 'STALE'
          ? `${inspection.status}:${inspection.reason}`
          : inspection.status,
        ensured: ensured.status,
        freshness,
        launches,
      });
    }

    expect(observed).toEqual(mutationCases.map((testCase) => testCase.name === 'docs only'
      ? {
          name: testCase.name,
          baseline: 'EXECUTED',
          inspection: 'CURRENT',
          ensured: 'REUSED',
          freshness: undefined,
          launches: 1,
        }
      : {
          name: testCase.name,
          baseline: 'EXECUTED',
          inspection: `STALE:${testCase.reason}`,
          ensured: 'EXECUTED',
          freshness: { status: 'STALE', reason: testCase.reason },
          launches: 2,
        }));
  });

  it('reuses proof when suite execution writes only git-ignored coverage output', async () => {
    const projectRoot = await makeFingerprintProject();
    const sourcePath = join(projectRoot, 'src/app.ts');
    const wiringPath = join(projectRoot, '.ai-conductor/config.yml');
    await writeFile(
      join(projectRoot, '.gitignore'),
      'private/*.bin\n.pipeline/\ncoverage/\n',
      'utf8',
    );
    await execa('git', ['add', '.gitignore'], { cwd: projectRoot });
    await execa('git', ['commit', '-q', '-m', 'ignore coverage output'], {
      cwd: projectRoot,
    });
    const [sourceBefore, wiringBefore] = await Promise.all([
      readFile(sourcePath),
      readFile(wiringPath),
    ]);
    let executions = 0;
    const createVerifier = () => new FullSuiteVerifier({
      projectRoot,
      environment: { SUITE_MODE: 'coverage' },
      execute: async () => {
        executions += 1;
        await writeProjectFile(
          projectRoot,
          'coverage/coverage-final.json',
          '{"src/app.ts":{"lines":{"pct":100}}}\n',
        );
        return {
          ok: true,
          command: 'node suite.mjs --all',
          cwd: projectRoot,
          startedAt: '2026-07-29T12:00:00.000Z',
          endedAt: '2026-07-29T12:00:01.000Z',
          durationMs: 1_000,
          exitCode: 0,
          stdout: 'all suites passed\n',
          stderr: '',
        };
      },
    });

    const first = await createVerifier().ensure();
    const second = await createVerifier().ensure();
    const [sourceAfter, wiringAfter, coverage, ignored] = await Promise.all([
      readFile(sourcePath),
      readFile(wiringPath),
      readFile(join(projectRoot, 'coverage/coverage-final.json'), 'utf8'),
      execa('git', ['check-ignore', 'coverage/coverage-final.json'], {
        cwd: projectRoot,
      }),
    ]);

    expect({
      statuses: [first.status, second.status],
      executions,
      coverage,
      ignored: ignored.stdout,
      sourceBytesUnchanged: sourceAfter.equals(sourceBefore),
      wiringBytesUnchanged: wiringAfter.equals(wiringBefore),
    }).toEqual({
      statuses: ['EXECUTED', 'REUSED'],
      executions: 1,
      coverage: '{"src/app.ts":{"lines":{"pct":100}}}\n',
      ignored: 'coverage/coverage-final.json',
      sourceBytesUnchanged: true,
      wiringBytesUnchanged: true,
    });
  });

  it('reports multiple changed input categories in deterministic order', async () => {
    const projectRoot = await makeFingerprintProject();
    let launches = 0;
    const createVerifier = () => new FullSuiteVerifier({
      projectRoot,
      environment: { SUITE_MODE: 'first' },
      execute: async () => {
        launches += 1;
        return {
          ok: true,
          command: 'node suite.mjs --all',
          cwd: projectRoot,
          startedAt: '2026-07-25T17:00:00.000Z',
          endedAt: '2026-07-25T17:00:01.000Z',
          durationMs: 1_000,
          exitCode: 0,
          stdout: 'all suites passed\n',
          stderr: '',
        };
      },
    });
    await createVerifier().ensure();
    await writeProjectFile(projectRoot, 'src/app.ts', 'export const value = 4;\n');
    await writeProjectFile(projectRoot, 'requirements.txt', 'pytest==9.0.0\n');

    const inspection = await createVerifier().inspect();
    const ensured = await createVerifier().ensure();

    expect({
      inspection,
      ensured: ensured.status,
      freshness: 'freshness' in ensured ? ensured.freshness : undefined,
      launches,
    }).toEqual({
      inspection: {
        status: 'STALE',
        reason: 'multiple_categories_changed',
        changedCategories: ['dependencies', 'source'],
      },
      ensured: 'EXECUTED',
      freshness: {
        status: 'STALE',
        reason: 'multiple_categories_changed',
        changedCategories: ['dependencies', 'source'],
      },
      launches: 2,
    });
  });

  it('attributes simultaneous source and environment changes across verifier instances', async () => {
    const projectRoot = await makeFingerprintProject();
    let launches = 0;
    const createVerifier = (suiteMode: string) => new FullSuiteVerifier({
      projectRoot,
      environment: { PATH: '/fixture/bin', SUITE_MODE: suiteMode },
      execute: async () => {
        launches += 1;
        return {
          ok: true,
          command: 'node suite.mjs --all',
          cwd: projectRoot,
          startedAt: '2026-07-25T17:00:00.000Z',
          endedAt: '2026-07-25T17:00:01.000Z',
          durationMs: 1_000,
          exitCode: 0,
          stdout: 'all suites passed\n',
          stderr: '',
        };
      },
    });
    await createVerifier('first').ensure();
    await writeProjectFile(projectRoot, 'src/app.ts', 'export const value = 5;\n');

    const inspection = await createVerifier('second').inspect();
    const ensured = await createVerifier('second').ensure();

    expect({
      inspection,
      ensured: ensured.status,
      freshness: 'freshness' in ensured ? ensured.freshness : undefined,
      launches,
    }).toEqual({
      inspection: {
        status: 'STALE',
        reason: 'multiple_categories_changed',
        changedCategories: ['environment', 'source'],
      },
      ensured: 'EXECUTED',
      freshness: {
        status: 'STALE',
        reason: 'multiple_categories_changed',
        changedCategories: ['environment', 'source'],
      },
      launches: 2,
    });
  });

  it('treats deletion of the private environment key as environment-only staleness', async () => {
    const projectRoot = await makeFingerprintProject();
    const environment = { PATH: '/fixture/bin', SUITE_MODE: 'stable' };
    const execute = async () => ({
      ok: true as const,
      command: 'node suite.mjs --all',
      cwd: projectRoot,
      startedAt: '2026-07-25T17:00:00.000Z',
      endedAt: '2026-07-25T17:00:01.000Z',
      durationMs: 1_000,
      exitCode: 0 as const,
      stdout: 'all suites passed\n',
      stderr: '',
    });
    await new FullSuiteVerifier({ projectRoot, environment, execute }).ensure();
    await rm(join(projectRoot, '.pipeline/test-suite-environment.key'));

    await expect(
      new FullSuiteVerifier({ projectRoot, environment, execute }).inspect(),
    ).resolves.toEqual({ status: 'STALE', reason: 'environment_changed' });
  });

  it('reruns once and replaces every computable unusable evidence state', async () => {
    const states: Array<{
      name: string;
      reason: string;
      arrange: (projectRoot: string) => Promise<void>;
    }> = [
      { name: 'missing', reason: 'missing', arrange: async () => undefined },
      {
        name: 'previous FAIL',
        reason: 'not_pass',
        arrange: (projectRoot) => writeFullSuiteEvidence(projectRoot, {
          version: FULL_SUITE_EVIDENCE_VERSION,
          outcome: 'FAIL',
          reason: 'nonzero_exit',
          fingerprint: 'sha256:current',
          provenanceHeadSha: 'head-before',
          command: 'node suite.mjs --all',
          workingDirectory: projectRoot,
          startedAt: '2026-07-25T16:59:00.000Z',
          endedAt: '2026-07-25T16:59:01.000Z',
          durationMs: 1_000,
          exitCode: 7,
          signal: null,
          stdout: '',
          stderr: 'failed\n',
        }),
      },
      {
        name: 'corrupt',
        reason: 'corrupt',
        arrange: (root) => writeProjectFile(root, '.pipeline/test-suite-evidence.json', '{'),
      },
      {
        name: 'unsupported',
        reason: 'unsupported_version',
        arrange: (root) => writeProjectFile(
          root,
          '.pipeline/test-suite-evidence.json',
          JSON.stringify({ version: 999, outcome: 'PASS' }),
        ),
      },
      {
        name: 'incomplete',
        reason: 'incomplete_write',
        arrange: (root) => writeProjectFile(
          root,
          '.pipeline/.test-suite-evidence.crashed.tmp',
          'partial',
        ),
      },
    ];
    const observed: unknown[] = [];

    for (const state of states) {
      const projectRoot = await makeConfiguredProject('full-suite-verifier-state-');
      await state.arrange(projectRoot);
      let launches = 0;
      const verifier = new FullSuiteVerifier({
        projectRoot,
        fingerprint: async () => ({
          ok: true,
          fingerprint: {
            digest: 'sha256:current',
            headSha: 'head-current',
            categoryFingerprints: CATEGORY_FINGERPRINTS,
          },
        }),
        execute: async () => {
          launches += 1;
          return {
            ok: true,
            command: 'node suite.mjs --all',
            cwd: projectRoot,
            startedAt: '2026-07-25T17:00:00.000Z',
            endedAt: '2026-07-25T17:00:01.000Z',
            durationMs: 1_000,
            exitCode: 0,
            stdout: 'passed\n',
            stderr: '',
          };
        },
      });

      const result = await verifier.ensure();
      observed.push({
        name: state.name,
        result: result.status,
        freshness: 'freshness' in result ? result.freshness : undefined,
        launches,
        persisted: await readFullSuiteEvidence(projectRoot),
      });
    }

    expect(observed).toEqual(states.map((state) => ({
      name: state.name,
      result: 'EXECUTED',
      freshness: { status: 'STALE', reason: state.reason },
      launches: 1,
      persisted: {
        usable: true,
        evidence: expect.objectContaining({
          outcome: 'PASS',
          fingerprint: 'sha256:current',
          provenanceHeadSha: 'head-current',
        }),
      },
    })));
  });

  it('preserves an active foreign evidence temp while replacing incomplete evidence', async () => {
    const projectRoot = await makeConfiguredProject('full-suite-foreign-temp-');
    const foreignTemporary = join(
      projectRoot,
      '.pipeline/.test-suite-evidence.foreign-writer.tmp',
    );
    await writeProjectFile(
      projectRoot,
      '.pipeline/.test-suite-evidence.foreign-writer.tmp',
      'active foreign writer',
    );
    let launches = 0;
    const result = await new FullSuiteVerifier({
      projectRoot,
      fingerprint: async () => ({
        ok: true,
        fingerprint: {
          digest: 'sha256:current',
          headSha: 'head-current',
          categoryFingerprints: CATEGORY_FINGERPRINTS,
        },
      }),
      execute: async () => {
        launches += 1;
        return {
          ok: true,
          command: 'node suite.mjs --all',
          cwd: projectRoot,
          startedAt: '2026-07-25T17:00:00.000Z',
          endedAt: '2026-07-25T17:00:01.000Z',
          durationMs: 1_000,
          exitCode: 0,
          stdout: 'passed\n',
          stderr: '',
        };
      },
    }).ensure();

    expect({
      result: result.status,
      freshness: 'freshness' in result ? result.freshness : undefined,
      foreignTemporary: await readFile(foreignTemporary, 'utf8').catch(() => null),
      persisted: await readFullSuiteEvidence(projectRoot),
      launches,
    }).toMatchObject({
      result: 'EXECUTED',
      freshness: { status: 'STALE', reason: 'incomplete_write' },
      foreignTemporary: 'active foreign writer',
      persisted: { usable: true, evidence: { outcome: 'PASS' } },
      launches: 1,
    });
  });

  it('fails closed with actionable reasons when freshness or persistence is indeterminate', async () => {
    const projectRoot = await makeConfiguredProject('full-suite-verifier-indeterminate-');
    let launches = 0;
    const execution = async () => {
      launches += 1;
      return {
        ok: true as const,
        command: 'node suite.mjs --all',
        cwd: projectRoot,
        startedAt: '2026-07-25T17:00:00.000Z',
        endedAt: '2026-07-25T17:00:01.000Z',
        durationMs: 1_000,
        exitCode: 0 as const,
        stdout: 'passed\n',
        stderr: '',
      };
    };
    const fingerprintFailure = await new FullSuiteVerifier({
      projectRoot,
      execute: execution,
      fingerprint: async () => ({
        ok: false,
        reason: {
          code: 'input_read_failed',
          message: 'Unable to hash verification input: src/app.ts',
          path: 'src/app.ts',
        },
      }),
    }).ensure();
    const readFailure = await new FullSuiteVerifier({
      projectRoot,
      execute: execution,
      fingerprint: async () => ({
        ok: true,
        fingerprint: {
          digest: 'sha256:current',
          headSha: 'head-current',
          categoryFingerprints: CATEGORY_FINGERPRINTS,
        },
      }),
      readEvidence: async () => ({ usable: false, reason: 'io_error' }),
    } as ConstructorParameters<typeof FullSuiteVerifier>[0]).ensure();
    const writeFailureRoot = await makeConfiguredProject(
      'full-suite-verifier-write-failure-',
    );
    const writeFailure = await new FullSuiteVerifier({
      projectRoot: writeFailureRoot,
      execute: execution,
      fingerprint: async () => ({
        ok: true,
        fingerprint: {
          digest: 'sha256:current',
          headSha: 'head-current',
          categoryFingerprints: CATEGORY_FINGERPRINTS,
        },
      }),
      writeEvidence: async () => {
        throw new Error('fixture write failure');
      },
    } as ConstructorParameters<typeof FullSuiteVerifier>[0]).ensure();
    const invalidConfigRoot = await makeConfiguredProject('full-suite-verifier-invalid-');
    await writeProjectFile(
      invalidConfigRoot,
      '.ai-conductor/config.yml',
      'test_suite:\n  command: ""\n',
    );
    const invalidConfig = await new FullSuiteVerifier({
      projectRoot: invalidConfigRoot,
      execute: execution,
    }).ensure();
    const preflightWriteRoot = await mkdtemp(join(tmpdir(), 'full-suite-preflight-write-'));
    scratches.push(preflightWriteRoot);
    const preflightWriteFailure = await new FullSuiteVerifier({
      projectRoot: preflightWriteRoot,
      writeEvidence: async () => {
        throw new Error('fixture preflight write failure');
      },
    } as ConstructorParameters<typeof FullSuiteVerifier>[0]).ensure();
    const preflightReadRoot = await mkdtemp(join(tmpdir(), 'full-suite-preflight-read-'));
    scratches.push(preflightReadRoot);
    const preflightReadFailure = await new FullSuiteVerifier({
      projectRoot: preflightReadRoot,
      writeEvidence: async () => undefined,
      readEvidence: async () => {
        throw new Error('fixture preflight read failure');
      },
    } as ConstructorParameters<typeof FullSuiteVerifier>[0]).ensure();

    expect({
      fingerprintFailure,
      readFailure,
      writeFailure,
      invalidConfig,
      preflightWriteFailure,
      preflightReadFailure,
      launches,
    }).toEqual({
      fingerprintFailure: {
        status: 'FAILED',
        reason: 'preflight_failed',
        message: 'Unable to hash verification input: src/app.ts',
        evidence: expect.objectContaining({
          outcome: 'FAIL',
          reason: 'preflight_failed',
          stderr: 'Unable to hash verification input: src/app.ts',
        }),
      },
      readFailure: {
        status: 'FAILED',
        reason: 'internal_error',
        message: 'Unable to read full-suite evidence',
      },
      writeFailure: {
        status: 'FAILED',
        reason: 'internal_error',
        message: 'Unable to persist full-suite PASS evidence',
        freshness: { status: 'STALE', reason: 'missing' },
      },
      invalidConfig: {
        status: 'FAILED',
        reason: 'invalid_config',
        message: expect.stringMatching(/test_suite|command/i),
        evidence: expect.objectContaining({
          outcome: 'FAIL',
          reason: 'invalid_config',
          stderr: expect.stringMatching(/test_suite|command/i),
        }),
      },
      preflightWriteFailure: {
        status: 'FAILED',
        reason: 'internal_error',
        message: 'Unable to persist full-suite preflight FAIL evidence',
      },
      preflightReadFailure: {
        status: 'FAILED',
        reason: 'internal_error',
        message: 'Unable to read persisted full-suite preflight FAIL evidence',
      },
      launches: 1,
    });
  });

  it('atomically persists every fail-closed preflight result without making it reusable', async () => {
    const secret = 'preflight-secret-value';
    const cases = [
      {
        name: 'missing config',
        reason: 'missing_config',
        message: expect.stringMatching(/config/i),
        arrange: async () => {
          const projectRoot = await mkdtemp(join(tmpdir(), 'full-suite-preflight-missing-'));
          scratches.push(projectRoot);
          return { projectRoot, options: {} };
        },
      },
      {
        name: 'invalid config',
        reason: 'invalid_config',
        message: expect.stringMatching(/test_suite|command/i),
        arrange: async () => {
          const projectRoot = await mkdtemp(join(tmpdir(), 'full-suite-preflight-invalid-'));
          scratches.push(projectRoot);
          await writeProjectFile(
            projectRoot,
            '.ai-conductor/config.yml',
            'test_suite:\n  command: ""\n',
          );
          return { projectRoot, options: {} };
        },
      },
      {
        name: 'fingerprint indeterminate',
        reason: 'preflight_failed',
        message: 'Unable to hash verification input: ',
        arrange: async () => {
          const projectRoot = await makeConfiguredProject('full-suite-preflight-fingerprint-');
          return {
            projectRoot,
            options: {
              environment: { SUITE_SECRET: secret },
              fingerprint: async () => ({
                ok: false as const,
                reason: {
                  code: 'input_read_failed' as const,
                  message: `Unable to hash verification input: ${secret}`,
                  path: 'src/app.ts',
                },
              }),
            },
          };
        },
      },
    ];
    const observed: unknown[] = [];

    for (const testCase of cases) {
      const { projectRoot, options } = await testCase.arrange();
      let launches = 0;
      const createVerifier = () => new FullSuiteVerifier({
        projectRoot,
        execute: async () => {
          launches += 1;
          throw new Error('preflight failures must not execute');
        },
        ...options,
      } as ConstructorParameters<typeof FullSuiteVerifier>[0]);
      const first = await createVerifier().ensure();
      const persistedAfterFirst = await readFullSuiteEvidence(projectRoot);
      const second = await createVerifier().ensure();
      const persistedAfterSecond = await readFullSuiteEvidence(projectRoot);

      observed.push({
        name: testCase.name,
        first,
        persistedAfterFirst,
        second,
        persistedAfterSecond,
        launches,
        leaked: JSON.stringify({ first, persistedAfterFirst, second }).includes(secret),
      });
    }

    expect(observed).toEqual(cases.map((testCase) => ({
      name: testCase.name,
      first: {
        status: 'FAILED',
        reason: testCase.reason,
        message: testCase.message,
        evidence: expect.objectContaining({
          outcome: 'FAIL',
          reason: testCase.reason,
          fingerprint: null,
          provenanceHeadSha: null,
          stderr: testCase.message,
        }),
      },
      persistedAfterFirst: {
        usable: false,
        reason: 'not_pass',
        evidence: expect.objectContaining({
          outcome: 'FAIL',
          reason: testCase.reason,
          stderr: testCase.message,
        }),
      },
      second: {
        status: 'FAILED',
        reason: testCase.reason,
        message: testCase.message,
        evidence: expect.objectContaining({
          outcome: 'FAIL',
          reason: testCase.reason,
          stderr: testCase.message,
        }),
      },
      persistedAfterSecond: {
        usable: false,
        reason: 'not_pass',
        evidence: expect.objectContaining({
          outcome: 'FAIL',
          reason: testCase.reason,
          stderr: testCase.message,
        }),
      },
      launches: 0,
      leaked: false,
    })));
  });

  it('persists sanitized correlated FAIL evidence without making it reusable', async () => {
    const failures = [
      { name: 'nonzero', reason: 'nonzero_exit' as const, exitCode: 7, signal: null },
      { name: 'signal', reason: 'signal' as const, exitCode: null, signal: 'SIGTERM' as NodeJS.Signals },
    ];
    const observed: unknown[] = [];

    for (const failure of failures) {
      const projectRoot = await makeConfiguredProject('full-suite-verifier-failure-');
      const secret = `secret-${failure.name}`;
      let launches = 0;
      const verifier = new FullSuiteVerifier({
        projectRoot,
        environment: { SUITE_SECRET: secret },
        fingerprint: async () => ({
          ok: true,
          fingerprint: {
            digest: 'sha256:failing',
            headSha: 'head-failing',
            categoryFingerprints: CATEGORY_FINGERPRINTS,
          },
        }),
        execute: async () => {
          launches += 1;
          return {
            ok: false,
            reason: failure.reason,
            command: 'node suite.mjs --all',
            cwd: projectRoot,
            startedAt: '2026-07-25T17:00:00.000Z',
            endedAt: '2026-07-25T17:00:01.000Z',
            durationMs: 1_000,
            exitCode: failure.exitCode,
            signal: failure.signal,
            stdout: `started ${secret}\n`,
            stderr: `failed ${secret}\n`,
          } as FullSuiteExecutionResult;
        },
      });

      const first = await verifier.ensure();
      const persisted = await readFullSuiteEvidence(projectRoot);
      const second = await verifier.ensure();
      observed.push({
        name: failure.name,
        first,
        persisted,
        second: second.status,
        launches,
        leaked: JSON.stringify({ first, persisted }).includes(secret),
      });
    }

    expect(observed).toEqual(failures.map((failure) => ({
      name: failure.name,
      first: {
        status: 'FAILED',
        reason: failure.reason,
        message: 'failed \n',
        freshness: { status: 'STALE', reason: 'missing' },
        evidence: expect.objectContaining({
          outcome: 'FAIL',
          reason: failure.reason,
          exitCode: failure.exitCode,
          signal: failure.signal,
          fingerprint: 'sha256:failing',
          provenanceHeadSha: 'head-failing',
          stdout: 'started \n',
          stderr: 'failed \n',
        }),
      },
      persisted: {
        usable: false,
        reason: 'not_pass',
        evidence: expect.objectContaining({
          outcome: 'FAIL',
          reason: failure.reason,
          exitCode: failure.exitCode,
          signal: failure.signal,
        }),
      },
      second: 'FAILED',
      launches: 2,
      leaked: false,
    })));
  });

  it('executes exactly once across concurrent verifier processes for one worktree', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'full-suite-verifier-processes-'));
    scratches.push(projectRoot);
    await writeProjectFile(projectRoot, '.gitignore', '.pipeline/\n');
    await writeProjectFile(
      projectRoot,
      '.ai-conductor/config.yml',
      'test_suite:\n  command: node suite.mjs\n  timeout_seconds: 10\n',
    );
    await writeProjectFile(projectRoot, 'src/app.ts', 'export const value = 1;\n');
    await writeProjectFile(
      projectRoot,
      'suite.mjs',
      [
        "import { mkdir, writeFile } from 'node:fs/promises';",
        "import { setTimeout as delay } from 'node:timers/promises';",
        "await mkdir('.pipeline/launches', { recursive: true });",
        "await writeFile(`.pipeline/launches/${process.pid}`, 'launched');",
        'await delay(250);',
        "console.log('all suites passed');",
        '',
      ].join('\n'),
    );
    await execa('git', ['init', '-q', '-b', 'main'], { cwd: projectRoot });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: projectRoot });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: projectRoot });
    await execa('git', ['add', '.'], { cwd: projectRoot });
    await execa('git', ['commit', '-q', '-m', 'fixture'], { cwd: projectRoot });

    const resultPaths = [
      join(projectRoot, '.pipeline/caller-1.json'),
      join(projectRoot, '.pipeline/caller-2.json'),
    ];
    const invoke = (resultPath: string) => execa(
      process.execPath,
      [
        '--import',
        TSX_LOADER,
        CONCURRENT_ENSURE_FIXTURE,
        projectRoot,
        resultPath,
      ],
      { cwd: CONDUCTOR_ROOT },
    );
    await Promise.all(resultPaths.map(invoke));
    const results = await Promise.all(resultPaths.map(async (path) =>
      JSON.parse(await readFile(path, 'utf8')) as { status: string }));
    const launches = await readdir(join(projectRoot, '.pipeline/launches'));

    expect({
      statuses: results.map(({ status }) => status).sort(),
      launches: launches.length,
      persisted: await readFullSuiteEvidence(projectRoot),
    }).toMatchObject({
      statuses: ['EXECUTED', 'REUSED'],
      launches: 1,
      persisted: { usable: true, evidence: { outcome: 'PASS' } },
    });
  }, 20_000);

  it('never displaces a replacement canonical lock during stale recovery', async () => {
    const projectRoot = await makeConfiguredProject('full-suite-lock-replacement-');
    const lockPath = join(projectRoot, '.pipeline/test-suite.lock');
    const staleOwner = {
      version: 1,
      pid: 2_147_483_647,
      token: 'stale-owner',
      acquiredAt: '2026-07-25T12:00:00.000Z',
    };
    const replacementOwner = {
      version: 1,
      pid: process.pid,
      token: 'replacement-live-owner',
      acquiredAt: '2026-07-25T19:00:00.000Z',
    };
    await writeProjectFile(
      projectRoot,
      '.pipeline/test-suite.lock/owner.json',
      JSON.stringify(staleOwner),
    );
    let executions = 0;
    const verificationOptions = {
      projectRoot,
      fingerprint: async () => ({
        ok: true as const,
        fingerprint: {
          digest: 'sha256:current',
          headSha: 'head-current',
          categoryFingerprints: CATEGORY_FINGERPRINTS,
        },
      }),
      execute: async () => {
        executions += 1;
        return {
          ok: true as const,
          command: 'node suite.mjs --all',
          cwd: projectRoot,
          startedAt: '2026-07-25T19:00:00.000Z',
          endedAt: '2026-07-25T19:00:01.000Z',
          durationMs: 1_000,
          exitCode: 0 as const,
          stdout: 'passed\n',
          stderr: '',
        };
      },
    };
    const racingResult = await new FullSuiteVerifier({
      ...verificationOptions,
      lock: {
        waitTimeoutMs: 0,
        processIsLive: () => {
          rmSync(lockPath, { recursive: true });
          mkdirSync(lockPath, { recursive: true });
          writeFileSync(
            join(lockPath, 'owner.json'),
            `${JSON.stringify(replacementOwner)}\n`,
            'utf8',
          );
          return false;
        },
      },
    }).ensure();
    const canonicalOwner = await readFile(join(lockPath, 'owner.json'), 'utf8')
      .then((serialized) => JSON.parse(serialized))
      .catch(() => null);
    const blockedResult = await new FullSuiteVerifier({
      ...verificationOptions,
      lock: { waitTimeoutMs: 0 },
    }).ensure();

    expect({ racingResult, canonicalOwner, blockedResult, executions }).toEqual({
      racingResult: {
        status: 'FAILED',
        reason: 'internal_error',
        message: 'Full-suite lock ownership changed during stale recovery',
      },
      canonicalOwner: replacementOwner,
      blockedResult: {
        status: 'FAILED',
        reason: 'internal_error',
        message: 'Unable to acquire full-suite verification lock within 0ms',
      },
      executions: 0,
    });
  });

  it('recovers a provably dead owner but refuses a live verification lock', async () => {
    const makeLockedProject = async (pid: number, token: string) => {
      const projectRoot = await makeConfiguredProject('full-suite-verifier-lock-');
      await writeProjectFile(
        projectRoot,
        '.pipeline/test-suite.lock/owner.json',
        JSON.stringify({
          version: 1,
          pid,
          token,
          acquiredAt: '2026-07-25T12:00:00.000Z',
        }),
      );
      return projectRoot;
    };
    let executions = 0;
    const verifier = (projectRoot: string) => new FullSuiteVerifier({
      projectRoot,
      fingerprint: async () => ({
        ok: true,
        fingerprint: {
          digest: 'sha256:current',
          headSha: 'head-current',
          categoryFingerprints: CATEGORY_FINGERPRINTS,
        },
      }),
      execute: async () => {
        executions += 1;
        return {
          ok: true,
          command: 'node suite.mjs --all',
          cwd: projectRoot,
          startedAt: '2026-07-25T18:00:00.000Z',
          endedAt: '2026-07-25T18:00:01.000Z',
          durationMs: 1_000,
          exitCode: 0,
          stdout: 'passed\n',
          stderr: '',
        };
      },
      lock: {
        waitTimeoutMs: 0,
        wait: async () => undefined,
      },
    } as ConstructorParameters<typeof FullSuiteVerifier>[0]);
    const staleRoot = await makeLockedProject(2_147_483_647, 'stale-owner');
    const staleResult = await verifier(staleRoot).ensure();
    const staleLockEntries = await readdir(join(staleRoot, '.pipeline'));
    const liveRoot = await makeLockedProject(process.pid, 'live-owner');
    const liveResult = await verifier(liveRoot).ensure();
    const uncertainRoot = await makeLockedProject(process.pid, 'uncertain-owner');
    const uncertainResult = await new FullSuiteVerifier({
      projectRoot: uncertainRoot,
      execute: async () => {
        executions += 1;
        throw new Error('must not execute while lock ownership is uncertain');
      },
      lock: {
        waitTimeoutMs: 0,
        processIsLive: () => {
          throw new Error('liveness probe denied');
        },
      },
    } as ConstructorParameters<typeof FullSuiteVerifier>[0]).ensure();

    expect({
      staleResult: staleResult.status,
      staleLockRemains: staleLockEntries.includes('test-suite.lock'),
      liveResult,
      uncertainResult,
      executions,
    }).toEqual({
      staleResult: 'EXECUTED',
      staleLockRemains: false,
      liveResult: {
        status: 'FAILED',
        reason: 'internal_error',
        message: 'Unable to acquire full-suite verification lock within 0ms',
      },
      uncertainResult: {
        status: 'FAILED',
        reason: 'internal_error',
        message: 'Unable to verify full-suite lock owner liveness: liveness probe denied',
      },
      executions: 1,
    });
  });
});
