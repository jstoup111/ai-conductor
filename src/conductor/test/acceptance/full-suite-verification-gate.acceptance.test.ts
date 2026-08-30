// Covers: task:1
/**
 * Product acceptance specs for issue #940.
 *
 * Covers: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-9, FR-10,
 * FR-11, FR-12, FR-13, FR-14, FR-15, FR-16, FR-17.
 *
 * These specs drive the real TypeScript entry point with a real Git worktree,
 * project-owned suite process, YAML configuration, and filesystem evidence.
 * They deliberately do not import the not-yet-existing verifier internals.
 * Workflow-surface assertions read the production skill/config files that a
 * direct operator or CI actually consumes.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execa, type ResultPromise } from 'execa';
import { spawnSync } from 'node:child_process';
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_STEPS, VALIDATION_GROUP } from '../../src/engine/steps.js';
import { loadConfig } from '../../src/engine/config.js';

const CONDUCTOR_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REPO_ROOT = join(CONDUCTOR_ROOT, '..', '..');
const REAL_CONDUCT_TS = join(REPO_ROOT, 'bin', 'conduct-ts');
const SOURCE_INDEX = join(CONDUCTOR_ROOT, 'src', 'index.ts');
const TSX_LOADER = join(CONDUCTOR_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');
const EVIDENCE_PATH = '.pipeline/test-suite-evidence.json';
const COUNTER_PATH = '.pipeline/test-suite-count';

type CliResult = Awaited<ResultPromise>;

let scratchParent: string;
let repo: string;
let realSuiteInvocation = 0;

async function git(args: string[]): Promise<void> {
  await execa('git', args, { cwd: repo });
}

async function writeProjectFile(path: string, contents: string): Promise<void> {
  const absolute = join(repo, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, contents, 'utf8');
}

async function writeSuiteConfig(overrides = ''): Promise<void> {
  await writeProjectFile(
    '.ai-conductor/config.yml',
    [
      'test_suite:',
      '  command: "node suite.mjs"',
      '  working_directory: "."',
      '  timeout_seconds: 10',
      '  environment:',
      '    - SUITE_MODE',
      overrides,
      '',
    ].join('\n'),
  );
}

async function invokeSuite(
  env: Record<string, string | undefined> = {},
): Promise<CliResult> {
  return execa(
    process.execPath,
    ['--import', TSX_LOADER, SOURCE_INDEX, 'test-suite'],
    {
      cwd: repo,
      env: {
        ...process.env,
        AI_CONDUCTOR_NO_REAL_EXEC: '1',
        ...env,
      },
      reject: false,
      timeout: 20_000,
    },
  );
}

function invokeRealSuite(
  env: Record<string, string | undefined> = {},
): { exitCode: number | null; stdout: string; stderr: string } {
  const pipelineDirectory = join(repo, '.pipeline');
  mkdirSync(pipelineDirectory, { recursive: true });
  realSuiteInvocation += 1;
  const stdoutPath = join(pipelineDirectory, `finish-cli-${realSuiteInvocation}.stdout`);
  const stderrPath = join(pipelineDirectory, `finish-cli-${realSuiteInvocation}.stderr`);
  const stdout = openSync(stdoutPath, 'w');
  const stderr = openSync(stderrPath, 'w');
  let exitCode: number | null;
  try {
    exitCode = spawnSync(REAL_CONDUCT_TS, ['test-suite'], {
      cwd: repo,
      env: { ...process.env, ...env },
      stdio: ['ignore', stdout, stderr],
      timeout: 20_000,
    }).status;
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
  return {
    exitCode,
    stdout: readFileSync(stdoutPath, 'utf8'),
    stderr: readFileSync(stderrPath, 'utf8'),
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\\"'\\\"'")}'`;
}

function invokeScriptWithFakeVitest(
  script: string,
  argumentsToForward: string[],
): { exitCode: number | null; stdout: string; stderr: string; runnerArguments: string[] } {
  const binDirectory = join(scratchParent, 'fake-bin');
  const runnerArgumentsPath = join(scratchParent, 'fake-vitest-arguments');
  mkdirSync(binDirectory, { recursive: true });
  const fakeVitestPath = join(binDirectory, 'vitest');
  writeFileSync(
    fakeVitestPath,
    [
      '#!/bin/sh',
      'printf "%s\\n" "$@" > "$FAKE_VITEST_ARGUMENTS"',
      'for argument in "$@"; do',
      '  if [ "$argument" = "__fake_vitest_failure__" ]; then',
      '    exit 23',
      '  fi',
      'done',
      '',
    ].join('\n'),
    'utf8',
  );
  chmodSync(fakeVitestPath, 0o755);

  const result = spawnSync(
    'sh',
    ['-c', `${script} ${argumentsToForward.map(shellQuote).join(' ')}`],
    {
      cwd: CONDUCTOR_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        FAKE_VITEST_ARGUMENTS: runnerArgumentsPath,
        PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
      },
    },
  );

  return {
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    runnerArguments: readFileSync(runnerArgumentsPath, 'utf8').trim().split('\n'),
  };
}

async function readCount(): Promise<number> {
  const raw = await readFile(join(repo, COUNTER_PATH), 'utf8');
  return Number.parseInt(raw.trim(), 10);
}

async function readEvidence(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(repo, EVIDENCE_PATH), 'utf8')) as Record<string, unknown>;
}

beforeEach(async () => {
  realSuiteInvocation = 0;
  scratchParent = await mkdtemp(join(tmpdir(), 'full-suite-gate-940-'));
  repo = join(scratchParent, 'repo');
  await mkdir(repo);
  await writeProjectFile('.gitignore', '.pipeline/\n');
  await writeProjectFile('src/app.ts', 'export const value = 1;\n');
  await writeProjectFile('README.md', '# fixture\n');
  await writeProjectFile(
    'suite.mjs',
    [
      "import { mkdir, readFile, writeFile } from 'node:fs/promises';",
      "await mkdir('.pipeline', { recursive: true });",
      "let count = 0;",
      "try { count = Number.parseInt(await readFile('.pipeline/test-suite-count', 'utf8'), 10); } catch {}",
      "await writeFile('.pipeline/test-suite-count', String(count + 1));",
      "if (process.env.SUITE_MODE?.startsWith('fail:')) {",
      "  console.error(`aggregate failure ${process.env.SUITE_MODE}`);",
      '  process.exit(7);',
      '}',
      "console.log('unit: pass');",
      "console.log('acceptance: pass');",
      '',
    ].join('\n'),
  );
  await writeSuiteConfig();
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'test@example.com']);
  await git(['config', 'user.name', 'Test']);
  await git(['add', '.']);
  await git(['commit', '-q', '-m', 'fixture']);
});

afterEach(async () => {
  await rm(scratchParent, { recursive: true, force: true });
});

describe('Story 1 — automated pre-SHIP gate (FR-1, FR-7)', () => {
  it('places one non-disableable BUILD gate before every SHIP validator', () => {
    const names = ALL_STEPS.map((step) => step.name as string);
    const suiteIndex = names.indexOf('test_suite');

    expect(suiteIndex).toBeLessThan(names.indexOf('manual_test'));
    expect(ALL_STEPS[suiteIndex]).toMatchObject({
      name: 'test_suite',
      phase: 'BUILD',
      enforcement: 'gating',
      prerequisites: ['build'],
      skippableForTiers: [],
    });
    expect(VALIDATION_GROUP.members).not.toContain('test_suite');
  });

  it('fails the public gate non-zero with actionable evidence, never a passing proof', async () => {
    const result = await invokeSuite({ SUITE_MODE: 'fail:expected-regression' });

    expect(result.exitCode).not.toBe(0);
    expect(await readEvidence()).toMatchObject({
      outcome: 'FAIL',
      reason: 'nonzero_exit',
      command: 'node suite.mjs',
    });
  });
});

describe('Story 3 — project-owned aggregate operation (FR-9, FR-10)', () => {
  it('checks in an aggregate declaration that includes ordinary and acceptance tests', async () => {
    const [projectConfig, template, packageJson, vitestConfig] = await Promise.all([
      loadConfig(REPO_ROOT),
      readFile(join(REPO_ROOT, 'templates/ai-conductor-config.yml.template'), 'utf8'),
      readFile(join(CONDUCTOR_ROOT, 'package.json'), 'utf8'),
      readFile(join(CONDUCTOR_ROOT, 'vitest.config.ts'), 'utf8'),
    ]);

    expect(projectConfig.ok && projectConfig.config.test_suite).toEqual({
      command: 'npm test',
      scoped_command: './node_modules/.bin/vitest run {selectors}',
      working_directory: 'src/conductor',
      timeout_seconds: 1800,
      verification: {
        mode: 'aggregate',
        drift_budget: {
          additional_inputs: 'none',
          dependencies: 'none',
          environment: 'none',
          migrations: 'none',
          project_config: 'none',
          // Declared budget: one aggregate run per feature, held across a
          // lap that changes at most six files in either category. The four
          // categories left at 'none' above are unbudgetable and always
          // re-run.
          source: 6,
          test_infrastructure: 'none',
          tests: 3,
        },
      },
    });
    expect(template).toMatch(/test_suite:[\s\S]*command:[^\n]*npm test[\s\S]*working_directory:/i);
    const testScript = JSON.parse(packageJson).scripts.test as string;
    // Every invocation goes through the Node 26 temp-dir wrapper
    // (`scripts/run-vitest.mjs`), so no bare `vitest run` survives.
    expect(testScript.match(/run-vitest\.mjs run/g)).toHaveLength(1);
    expect(testScript).not.toMatch(/(^|[^-])vitest run/);

    // The no-argument branch is the aggregate gate's command. Any positional
    // path passed there narrows the run to those paths, silently dropping
    // every tier it omits while `AGGREGATE_TEST_SUITE_PASS` still prints —
    // which is how `test/acceptance/**` (171 files) and `test/types/**` (3)
    // once left the default run undetected. The default must therefore carry
    // no path filter and inherit the config's `include` whole.
    const defaultBranch = testScript.slice(testScript.indexOf('else'), testScript.indexOf('fi &&'));
    expect(defaultBranch).not.toMatch(/(^|\s)(\.\/)?test\//);

    expect(vitestConfig).toMatch(/include:[^\n]*test\/\*\*\/\*\.test\.ts/);
    expect(vitestConfig).toMatch(/pool:\s*'forks'/);
    // vitest 4 removed `poolOptions`; the fork cap is `maxWorkers` now. It
    // must stay at 2 — 3 is the count that gets OOM-killed on this host.
    expect(vitestConfig).toMatch(/maxWorkers:\s*2/);
    expect(vitestConfig).not.toMatch(/poolOptions/);
  });

  it('executes the declared command in its working directory and records one PASS', async () => {
    const result = await invokeSuite();

    expect(result.exitCode).toBe(0);
    expect(await readCount()).toBe(1);
    expect(await readEvidence()).toMatchObject({
      outcome: 'PASS',
      command: 'node suite.mjs',
    });
  });

});

describe('Story 7 — package-script selector forwarding (Task 17)', () => {
  it('keeps the legacy trailing-echo shape detectable by the fake runner', async () => {
    const packageJson = JSON.parse(await readFile(join(CONDUCTOR_ROOT, 'package.json'), 'utf8')) as {
      scripts: { test: string };
    };
    const selector = '__fake_vitest_selector__';
    const legacy = "vitest run --reporter=dot --silent --slowTestThreshold=1800000 && echo 'AGGREGATE_TEST_SUITE_PASS'";
    const legacyResult = invokeScriptWithFakeVitest(legacy, [selector]);

    expect(packageJson.scripts.test).not.toBe(legacy);
    expect(legacyResult).toMatchObject({
      exitCode: 0,
      stdout: `AGGREGATE_TEST_SUITE_PASS ${selector}\n`,
      runnerArguments: expect.not.arrayContaining([selector]),
    });
  });

  it.each(['test', 'test:changed'] as const)(
    'forwards selectors to Vitest and preserves runner failures for %s',
    async (scriptName) => {
      const packageJson = JSON.parse(await readFile(join(CONDUCTOR_ROOT, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      };
      const selector = `test/${scriptName.replace(':', '-')}-selector.test.ts`;
      const successful = invokeScriptWithFakeVitest(packageJson.scripts[scriptName], [selector]);
      const failing = invokeScriptWithFakeVitest(packageJson.scripts[scriptName], ['__fake_vitest_failure__']);

      expect(successful).toMatchObject({
        exitCode: 0,
        stdout: 'AGGREGATE_TEST_SUITE_PASS\n',
        runnerArguments: expect.arrayContaining([selector]),
      });
      expect(successful.stdout).not.toContain(selector);
      expect(failing).toMatchObject({
        exitCode: 23,
        stdout: '',
        runnerArguments: expect.arrayContaining(['__fake_vitest_failure__']),
      });
      expect(failing.stdout).not.toContain('AGGREGATE_TEST_SUITE_PASS');
    },
  );
});

describe('Stories 4 and 5 — reusable current proof (FR-3, FR-4, FR-6, FR-11, FR-12, FR-16)', () => {
  it('launches once across unchanged fallback, gate, and finish-style checks', async () => {
    const first = await invokeSuite();
    const gate = await invokeSuite();
    const finish = await invokeSuite();

    expect(first.exitCode).toBe(0);
    expect(gate.exitCode).toBe(0);
    expect(finish.exitCode).toBe(0);
    expect(await readCount()).toBe(1);
  });

  it('reruns for relevant dirty content while a documentation-only edit remains reusable', async () => {
    expect((await invokeSuite()).exitCode).toBe(0);

    await writeProjectFile('README.md', '# documentation only\n');
    const docsOnly = await invokeSuite();
    expect(docsOnly.exitCode).toBe(0);
    expect(await readCount()).toBe(1);

    await writeProjectFile('src/app.ts', 'export const value = 2;\n');
    const sourceChanged = await invokeSuite();
    expect(sourceChanged.exitCode).toBe(0);
    expect(await readCount()).toBe(2);
  });

  it('invalidates on declared environment changes without exposing the environment value', async () => {
    expect((await invokeSuite({ SUITE_MODE: 'first-secret-940' })).exitCode).toBe(0);
    const changed = await invokeSuite({ SUITE_MODE: 'second-secret-940' });
    const serialized = JSON.stringify(await readEvidence());

    expect(changed.exitCode).toBe(0);
    expect(await readCount()).toBe(2);
    expect(serialized).not.toContain('first-secret-940');
    expect(serialized).not.toContain('second-secret-940');
  });
});

describe('Stories 7–9 — finish, PR/CI, and repair boundaries (FR-13, FR-14, FR-15, FR-17)', () => {
  it('has finish invoke the shared CLI and reuse a current PASS without launching the project suite', async () => {
    const finishSkill = await readFile(join(REPO_ROOT, 'skills/finish/SKILL.md'), 'utf8');
    const gate = invokeRealSuite();
    const launchesBeforeFinish = await readCount();
    const finishVerification = invokeRealSuite();
    const launchesAfterFinish = await readCount();

    expect({
      finishUsesConfiguredVerifier: /configured aggregate verifier/i.test(finishSkill),
      gateExitCode: gate.exitCode,
      gateOutput: gate.stdout + gate.stderr,
      finishExitCode: finishVerification.exitCode,
      finishOutput: finishVerification.stdout + finishVerification.stderr,
      additionalProjectSuiteLaunches: launchesAfterFinish - launchesBeforeFinish,
    }).toEqual({
      finishUsesConfiguredVerifier: true,
      gateExitCode: 0,
      gateOutput: expect.stringMatching(/EXECUTED.*PASS/i),
      finishExitCode: 0,
      finishOutput: expect.stringMatching(/REUSED.*PASS/i),
      additionalProjectSuiteLaunches: 0,
    });
  });

  it('blocks finish before choices when the shared CLI exits non-zero', async () => {
    const finishSkill = await readFile(join(REPO_ROOT, 'skills/finish/SKILL.md'), 'utf8');
    const suiteSection = finishSkill.slice(
      finishSkill.indexOf('### 1. Fresh Verification'),
      finishSkill.indexOf('### 1b.'),
    );
    const failure = invokeRealSuite({ SUITE_MODE: 'fail:finish-block' });
    const finishChoiceExists = await readFile(join(repo, '.pipeline/finish-choice'), 'utf8')
      .then(() => true)
      .catch(() => false);

    expect({
      exitCode: failure.exitCode,
      output: failure.stdout + failure.stderr,
      contractStopsBeforeChoice:
        /non-?zero[\s\S]*STOP[\s\S]*(?:choice|options)[\s\S]*finish-choice/i.test(suiteSection),
      finishChoiceExists,
    }).toEqual({
      exitCode: 1,
      output: expect.stringMatching(/FAILED.*evidence=nonzero_exit.*\/tdd or \/pipeline/is),
      contractStopsBeforeChoice: true,
      finishChoiceExists: false,
    });
  });

});
