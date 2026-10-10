// Covers: task:6
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

const conductorRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtureRoots: string[] = [];

afterEach(async () => {
  await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function childEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !(
      key.startsWith('VITEST')
      || key === 'NODE_OPTIONS'
      || key.startsWith('AI_CONDUCTOR_TEST_')
    )),
  );
  const bin = join(conductorRoot, 'node_modules', '.bin');
  environment.PATH = environment.PATH ? `${bin}${delimiter}${environment.PATH}` : bin;
  return { ...environment, ...extra };
}

async function fixture(caseFiles: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ci-progress-reporter-'));
  fixtureRoots.push(root);

  await Promise.all([
    mkdir(join(root, 'scripts'), { recursive: true }),
    mkdir(join(root, 'test', 'reporters'), { recursive: true }),
    mkdir(join(root, 'cases'), { recursive: true }),
  ]);
  await Promise.all([
    copyFile(join(conductorRoot, 'scripts', 'run-vitest.mjs'), join(root, 'scripts', 'run-vitest.mjs')),
    copyFile(join(conductorRoot, 'scripts', 'vitest-temp.mjs'), join(root, 'scripts', 'vitest-temp.mjs')),
    copyFile(join(conductorRoot, 'test', 'reporters', 'ci-progress-reporter.ts'), join(root, 'test', 'reporters', 'ci-progress-reporter.ts')),
    writeFile(join(root, 'vitest.config.mjs'), `export default { test: {
  include: ['cases/**/*.case.mjs'],
  globals: true,
  pool: 'forks',
  maxWorkers: 1,
  setupFiles: [],
  globalSetup: [],
} };
`),
    ...Object.entries(caseFiles).map(([path, source]) => writeFile(join(root, 'cases', path), source)),
  ]);
  return root;
}

function lineIndex(stdout: string, line: string): number {
  return stdout.split(/\r?\n/).findIndex(candidate => candidate === line);
}

function assertStartedBeforeDone(stdout: string, path: string, state: 'passed' | 'failed'): void {
  const start = lineIndex(stdout, `[ci-progress] start ${path}`);
  const done = stdout.split(/\r?\n/).findIndex(line => line.startsWith(`[ci-progress] done ${path} ${state} `));
  expect(start).toBeGreaterThanOrEqual(0);
  expect(done).toBeGreaterThan(start);
}

describe('ci-progress reporter real Vitest child runs', () => {
  it('names passing and failing files before Vitest prints its summary', async () => {
    const root = await fixture({
      'pass.case.mjs': "test('works', () => expect(1).toBe(1));\n",
      'fail.case.mjs': "test('breaks', () => expect(1).toBe(2));\n",
    });
    const result = await execa(process.execPath, [
      join(root, 'scripts', 'run-vitest.mjs'),
      'run',
      '--config', 'vitest.config.mjs',
      '--reporter=dot',
      '--reporter=./test/reporters/ci-progress-reporter.ts',
    ], { cwd: root, env: childEnvironment(), reject: false, encoding: 'utf8' });

    expect(result.exitCode).toBe(1);
    assertStartedBeforeDone(result.stdout, 'cases/pass.case.mjs', 'passed');
    assertStartedBeforeDone(result.stdout, 'cases/fail.case.mjs', 'failed');
    const failedTest = lineIndex(result.stdout, '[ci-progress] failed test: breaks');
    const summary = result.stdout.split(/\r?\n/).findIndex(line => line.includes('Test Files'));
    expect(failedTest).toBeGreaterThanOrEqual(0);
    expect(summary).toBeGreaterThan(failedTest);
  });

  it('keeps progress output before the package test summary and success marker', async () => {
    const root = await fixture({
      'first.case.mjs': "test('first works', () => expect(true).toBe(true));\n",
      'second.case.mjs': "test('second works', () => expect(true).toBe(true));\n",
    });
    const { scripts: { test: testScript } } = JSON.parse(await readFile(join(conductorRoot, 'package.json'), 'utf8')) as {
      scripts: { test: string };
    };
    const result = await execa('sh', [
      '-c', `${testScript} --config vitest.config.mjs --reporter=./test/reporters/ci-progress-reporter.ts`,
    ], { cwd: root, env: childEnvironment(), reject: false, encoding: 'utf8' });

    expect(result.exitCode).toBe(0);
    assertStartedBeforeDone(result.stdout, 'cases/first.case.mjs', 'passed');
    assertStartedBeforeDone(result.stdout, 'cases/second.case.mjs', 'passed');
    const summary = result.stdout.split(/\r?\n/).findIndex(line => line.includes('Test Files'));
    expect(summary).toBeGreaterThanOrEqual(0);
    expect(result.stdout.split(/\r?\n/).findIndex(line => line.startsWith('[ci-progress] done cases/first.case.mjs passed '))).toBeLessThan(summary);
    expect(result.stdout.split(/\r?\n/).findIndex(line => line.startsWith('[ci-progress] done cases/second.case.mjs passed '))).toBeLessThan(summary);
    expect(result.stdout.split(/\r?\n/).slice(summary).join('\n')).not.toContain('[ci-progress]');
    expect(result.stdout.trim().split(/\r?\n/).at(-1)).toBe('AGGREGATE_TEST_SUITE_PASS');
  });

  it('keeps the started file visible when Vitest is killed during its import', async () => {
    const token = randomUUID();
    const root = await fixture({
      'kill.case.mjs': `if (process.env.CI_PROGRESS_KILL_TOKEN === ${JSON.stringify(token)}
  && process.ppid !== Number(process.env.CI_PROGRESS_OUTER_PID)) {
  process.kill(process.ppid, 'SIGKILL');
  setTimeout(() => process.kill(process.pid, 'SIGKILL'), 500);
}
test('unreachable', () => expect(true).toBe(true));
`,
    });
    const result = await execa(process.execPath, [
      join(root, 'scripts', 'run-vitest.mjs'),
      'run',
      '--config', 'vitest.config.mjs',
      '--reporter=dot',
      '--reporter=./test/reporters/ci-progress-reporter.ts',
    ], {
      cwd: root,
      env: childEnvironment({ CI_PROGRESS_KILL_TOKEN: token, CI_PROGRESS_OUTER_PID: String(process.pid) }),
      reject: false,
      encoding: 'utf8',
    });

    expect(result.signal).toBe('SIGKILL');
    expect(lineIndex(result.stdout, '[ci-progress] start cases/kill.case.mjs')).toBeGreaterThanOrEqual(0);
    expect(result.stdout).not.toMatch(/(?:^|\n)\[ci-progress\] done cases\/kill\.case\.mjs /);
    expect(result.stderr).toContain('[run-vitest] vitest terminated by signal SIGKILL');
  });
});
