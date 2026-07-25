import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execa } from 'execa';
import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const REAL_CONDUCT_TS = join(REPO_ROOT, 'bin', 'conduct-ts');

let projectRoot: string;
let invocation = 0;

function runRealTestSuite(secret: string) {
  const pipelineDirectory = join(projectRoot, '.pipeline');
  mkdirSync(pipelineDirectory, { recursive: true });
  invocation += 1;
  const stdoutPath = join(pipelineDirectory, `cli-${invocation}.stdout`);
  const stderrPath = join(pipelineDirectory, `cli-${invocation}.stderr`);
  const stdout = openSync(stdoutPath, 'w');
  const stderr = openSync(stderrPath, 'w');
  let status: number | null;
  try {
    status = spawnSync(REAL_CONDUCT_TS, ['test-suite'], {
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
});
