import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execa } from 'execa';
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const REAL_CONDUCT_TS = join(REPO_ROOT, 'bin', 'conduct-ts');

let projectRoot: string;
let invocation = 0;

function runRealTestSuite(secret: string, argv: string[] = ['test-suite']) {
  const pipelineDirectory = join(projectRoot, '.pipeline');
  mkdirSync(pipelineDirectory, { recursive: true });
  invocation += 1;
  const stdoutPath = join(pipelineDirectory, `cli-${invocation}.stdout`);
  const stderrPath = join(pipelineDirectory, `cli-${invocation}.stderr`);
  const stdout = openSync(stdoutPath, 'w');
  const stderr = openSync(stderrPath, 'w');
  let status: number | null;
  try {
    status = spawnSync(REAL_CONDUCT_TS, argv, {
      cwd: projectRoot,
      env: { ...process.env, SUITE_SECRET: secret },
      stdio: ['ignore', stdout, stderr],
    }).status;
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
  return {
    exitCode: status,
    stdout: readFileSync(stdoutPath, 'utf8'),
    stderr: readFileSync(stderrPath, 'utf8'),
  };
}

async function writeProjectFile(path: string, contents: string): Promise<void> {
  const destination = join(projectRoot, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, contents, 'utf8');
}

beforeEach(async () => {
  invocation = 0;
  projectRoot = await mkdtemp(join(tmpdir(), 'test-suite-cli-real-binary-'));
  await writeProjectFile(
    '.ai-conductor/config.yml',
    [
      'test_suite:',
      '  command: node suite.mjs',
      '  working_directory: .',
      '  timeout_seconds: 30',
      '  environment:',
      '    - SUITE_SECRET',
      '',
    ].join('\n'),
  );
  await writeProjectFile('.gitignore', '.pipeline/\n');
  await writeProjectFile(
    'suite.mjs',
    [
      "import { mkdir, readFile, writeFile } from 'node:fs/promises';",
      "const path = '.pipeline/suite-launches';",
      "await mkdir('.pipeline', { recursive: true });",
      "const previous = await readFile(path, 'utf8').catch(() => '0');",
      "await writeFile(path, String(Number(previous) + 1), 'utf8');",
      "console.log(`suite passed ${process.env.SUITE_SECRET ?? ''}`);",
      '',
    ].join('\n'),
  );
  await execa('git', ['init', '-q', '-b', 'main'], { cwd: projectRoot });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: projectRoot });
  await execa('git', ['config', 'user.name', 'Test'], { cwd: projectRoot });
  await execa('git', ['add', '.'], { cwd: projectRoot });
  await execa('git', ['commit', '-q', '-m', 'fixture'], { cwd: projectRoot });
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe('conduct-ts test-suite real-binary acceptance', () => {
  it('executes once, reuses the canonical PASS, and never exposes declared environment values', async () => {
    const secret = 'real-binary-suite-secret-940';
    const first = runRealTestSuite(secret);
    const second = runRealTestSuite(secret);
    const [launches, serializedEvidence] = await Promise.all([
      readFile(join(projectRoot, '.pipeline/suite-launches'), 'utf8'),
      readFile(join(projectRoot, '.pipeline/test-suite-evidence.json'), 'utf8'),
    ]);

    expect({
      firstExitCode: first.exitCode,
      firstOutput: `${first.stdout}\n${first.stderr}`,
      secondExitCode: second.exitCode,
      secondOutput: `${second.stdout}\n${second.stderr}`,
      launches,
      leaked:
        `${first.stdout}${first.stderr}${second.stdout}${second.stderr}${serializedEvidence}`
          .includes(secret),
    }).toEqual({
      firstExitCode: 0,
      firstOutput: expect.stringMatching(/EXECUTED.*PASS/i),
      secondExitCode: 0,
      secondOutput: expect.stringMatching(/REUSED.*PASS/i),
      launches: '1',
      leaked: false,
    });
  }, 30_000);

  it('rejects unknown argv without launching the suite or falling through to the pipeline', async () => {
    const result = runRealTestSuite('misuse-secret-940', ['test-suite', '--unknown']);

    expect({
      exitCode: result.exitCode,
      output: `${result.stdout}\n${result.stderr}`,
      suiteLaunched: existsSync(join(projectRoot, '.pipeline/suite-launches')),
      pipelineStarted: existsSync(join(projectRoot, '.pipeline/conduct-state.json')),
    }).toEqual({
      exitCode: 1,
      output: expect.stringMatching(/Usage: conduct-ts test-suite[\s\S]*\/tdd or \/pipeline/i),
      suiteLaunched: false,
      pipelineStarted: false,
    });
  }, 30_000);

  it('fails closed with actionable guidance when test_suite config is missing', async () => {
    await rm(join(projectRoot, '.ai-conductor/config.yml'));

    const result = runRealTestSuite('missing-config-secret-940');

    expect({ exitCode: result.exitCode, output: `${result.stdout}\n${result.stderr}` }).toEqual({
      exitCode: 1,
      output: expect.stringMatching(
        /FAILED.*evidence=missing_config.*test_suite.*\/tdd or \/pipeline/is,
      ),
    });
  }, 30_000);

  it('fails closed with actionable guidance when test_suite config is invalid', async () => {
    await writeProjectFile(
      '.ai-conductor/config.yml',
      ['test_suite:', '  command: ""', '  environment:', '    - SUITE_SECRET', ''].join('\n'),
    );

    const secret = 'invalid-config-secret-940';
    const result = runRealTestSuite(secret);

    expect({
      exitCode: result.exitCode,
      output: `${result.stdout}\n${result.stderr}`,
      leaked: `${result.stdout}${result.stderr}`.includes(secret),
    }).toEqual({
      exitCode: 1,
      output: expect.stringMatching(
        /FAILED.*evidence=invalid_config.*test_suite.*\/tdd or \/pipeline/is,
      ),
      leaked: false,
    });
  }, 30_000);

  it('blocks a stale rerun that exits nonzero and never exposes declared environment values', async () => {
    const secret = 'stale-nonzero-secret-940';
    const pass = runRealTestSuite(secret);
    await writeProjectFile(
      'suite.mjs',
      [
        "console.log(`suite failed ${process.env.SUITE_SECRET ?? ''}`);",
        "console.error(`suite stderr ${process.env.SUITE_SECRET ?? ''}`);",
        'process.exitCode = 7;',
        '',
      ].join('\n'),
    );

    const failure = runRealTestSuite(secret);
    const serializedEvidence = await readFile(
      join(projectRoot, '.pipeline/test-suite-evidence.json'),
      'utf8',
    );

    expect({
      passExitCode: pass.exitCode,
      failureExitCode: failure.exitCode,
      output: `${failure.stdout}\n${failure.stderr}`,
      leaked: `${failure.stdout}${failure.stderr}${serializedEvidence}`.includes(secret),
    }).toEqual({
      passExitCode: 0,
      failureExitCode: 1,
      output: expect.stringMatching(
        /FAILED.*evidence=nonzero_exit.*freshness=source_changed.*\/tdd or \/pipeline/is,
      ),
      leaked: false,
    });
  }, 30_000);

  it('blocks a timed-out suite and never exposes declared environment values', async () => {
    await writeProjectFile(
      '.ai-conductor/config.yml',
      [
        'test_suite:',
        '  command: node suite.mjs',
        '  working_directory: .',
        '  timeout_seconds: 0.05',
        '  environment:',
        '    - SUITE_SECRET',
        '',
      ].join('\n'),
    );
    await writeProjectFile(
      'suite.mjs',
      [
        "console.log(`suite waiting ${process.env.SUITE_SECRET ?? ''}`);",
        'await new Promise((resolve) => setTimeout(resolve, 10_000));',
        '',
      ].join('\n'),
    );

    const secret = 'timeout-secret-940';
    const result = runRealTestSuite(secret);
    const serializedEvidence = await readFile(
      join(projectRoot, '.pipeline/test-suite-evidence.json'),
      'utf8',
    );

    expect({
      exitCode: result.exitCode,
      output: `${result.stdout}\n${result.stderr}`,
      leaked: `${result.stdout}${result.stderr}${serializedEvidence}`.includes(secret),
    }).toEqual({
      exitCode: 1,
      output: expect.stringMatching(/FAILED.*evidence=timeout.*\/tdd or \/pipeline/is),
      leaked: false,
    });
  }, 30_000);
});
