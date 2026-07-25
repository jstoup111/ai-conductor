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
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
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
  it('places one non-disableable BUILD gate after wiring_check and before every SHIP validator', () => {
    const names = ALL_STEPS.map((step) => step.name as string);
    const suiteIndex = names.indexOf('test_suite');

    expect(suiteIndex).toBe(names.indexOf('wiring_check') + 1);
    expect(suiteIndex).toBeLessThan(names.indexOf('manual_test'));
    expect(ALL_STEPS[suiteIndex]).toMatchObject({
      name: 'test_suite',
      phase: 'BUILD',
      enforcement: 'gating',
      prerequisites: ['wiring_check'],
      skippableForTiers: [],
    });
    expect(VALIDATION_GROUP.members).not.toContain('test_suite');
  });

  it('fails the public gate non-zero with actionable evidence, never a passing proof', async () => {
    const result = await invokeSuite({ SUITE_MODE: 'fail:expected-regression' });

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/FAILED|non.?zero|expected-regression/i);
    expect(await readEvidence()).toMatchObject({ outcome: 'FAIL' });
  });
});

describe('Story 2 — direct-Claude parity (FR-2, FR-8)', () => {
  it('orders /test-suite after BUILD and before /manual-test using the TypeScript entry point', async () => {
    const [conduct, harness, skill] = await Promise.all([
      readFile(join(REPO_ROOT, 'skills/conduct/SKILL.md'), 'utf8'),
      readFile(join(REPO_ROOT, 'HARNESS.md'), 'utf8'),
      readFile(join(REPO_ROOT, 'skills/test-suite/SKILL.md'), 'utf8'),
    ]);

    expect(conduct.indexOf('/test-suite')).toBeGreaterThan(conduct.indexOf('/pipeline'));
    expect(conduct.indexOf('/test-suite')).toBeLessThan(conduct.indexOf('/manual-test'));
    expect(harness).toMatch(/BUILD[\s\S]*\/test-suite[\s\S]*SHIP/i);
    expect(skill).toMatch(/conduct-ts test-suite/);
    expect(skill).toMatch(/\/tdd|\/pipeline/);
    expect(skill).not.toMatch(/\bbin\/conduct\b/);
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
      working_directory: 'src/conductor',
      timeout_seconds: 1800,
    });
    expect(template).toMatch(/test_suite:[\s\S]*command:[^\n]*npm test[\s\S]*working_directory:/i);
    expect(JSON.parse(packageJson).scripts.test).toBe('vitest run');
    expect(vitestConfig).toMatch(/include:[^\n]*test\/\*\*\/\*\.test\.ts/);
  });

  it('executes the declared command in its working directory and records one PASS', async () => {
    const result = await invokeSuite();

    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/EXECUTED/i);
    expect(await readCount()).toBe(1);
    expect(await readEvidence()).toMatchObject({
      outcome: 'PASS',
      command: 'node suite.mjs',
    });
  });

  it('fails closed for missing or malformed declaration without writing PASS evidence', async () => {
    await writeProjectFile('.ai-conductor/config.yml', 'test_suite:\n  command: ""\n');

    const result = await invokeSuite();

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/test_suite|command|configuration/i);
    await expect(readEvidence()).resolves.not.toMatchObject({ outcome: 'PASS' });
  });

  it('classifies unlaunchable, timeout, and non-zero commands as distinct blocking outcomes', async () => {
    const cases = [
      { command: 'definitely-not-a-command-940', reason: /resolve|launch|not found/i },
      { command: 'node -e "setTimeout(() => {}, 5000)"', reason: /timeout/i, timeout: 1 },
      { command: 'node -e "process.exit(9)"', reason: /non.?zero|exit.*9/i },
    ];

    for (const testCase of cases) {
      await writeProjectFile(
        '.ai-conductor/config.yml',
        [
          'test_suite:',
          `  command: '${testCase.command.replaceAll("'", "''")}'`,
          '  working_directory: "."',
          `  timeout_seconds: ${testCase.timeout ?? 10}`,
          '',
        ].join('\n'),
      );
      const result = await invokeSuite();
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout + result.stderr).toMatch(testCase.reason);
      expect(await readEvidence()).toMatchObject({ outcome: 'FAIL' });
    }
  });
});

describe('Stories 4 and 5 — reusable current proof (FR-3, FR-4, FR-6, FR-11, FR-12, FR-16)', () => {
  it('launches once across unchanged fallback, gate, and finish-style checks', async () => {
    const first = await invokeSuite();
    const gate = await invokeSuite();
    const finish = await invokeSuite();

    expect(first.exitCode).toBe(0);
    expect(first.stdout + first.stderr).toMatch(/EXECUTED/i);
    expect(gate.exitCode).toBe(0);
    expect(gate.stdout + gate.stderr).toMatch(/REUSED/i);
    expect(finish.exitCode).toBe(0);
    expect(finish.stdout + finish.stderr).toMatch(/REUSED/i);
    expect(await readCount()).toBe(1);
  });

  it('reruns for relevant dirty content while a documentation-only edit remains reusable', async () => {
    expect((await invokeSuite()).exitCode).toBe(0);

    await writeProjectFile('README.md', '# documentation only\n');
    const docsOnly = await invokeSuite();
    expect(docsOnly.exitCode).toBe(0);
    expect(docsOnly.stdout + docsOnly.stderr).toMatch(/REUSED/i);
    expect(await readCount()).toBe(1);

    await writeProjectFile('src/app.ts', 'export const value = 2;\n');
    const sourceChanged = await invokeSuite();
    expect(sourceChanged.exitCode).toBe(0);
    expect(sourceChanged.stdout + sourceChanged.stderr).toMatch(/STALE[\s\S]*EXECUTED|EXECUTED[\s\S]*STALE/i);
    expect(await readCount()).toBe(2);
  });

  it('invalidates on declared environment changes without exposing the environment value', async () => {
    expect((await invokeSuite({ SUITE_MODE: 'first-secret-940' })).exitCode).toBe(0);
    const changed = await invokeSuite({ SUITE_MODE: 'second-secret-940' });
    const serialized = JSON.stringify(await readEvidence());

    expect(changed.exitCode).toBe(0);
    expect(changed.stdout + changed.stderr).toMatch(/STALE|EXECUTED/i);
    expect(await readCount()).toBe(2);
    expect(serialized).not.toContain('first-secret-940');
    expect(serialized).not.toContain('second-secret-940');
  });
});

describe('Story 6 — scoped intermediate verification (FR-5)', () => {
  it('keeps ordinary implementation/review checks scoped and routes broad fallback through the verifier', async () => {
    const expectedScope = new Map<string, RegExp>([
      ['skills/tdd/SKILL.md', /affected\/scoped test set/i],
      ['skills/tdd/references/green.md', /affected|scoped/i],
      ['skills/debugging/SKILL.md', /affected|scoped/i],
      ['skills/pipeline/SKILL.md', /affected-test|union[- ]of[- ]affected/i],
      ['skills/code-review/SKILL.md', /impacted test|union[- ]of[- ]affected/i],
      ['skills/conduct/SKILL.md', /affected-test|union[- ]of[- ]affected/i],
      ['HARNESS.md', /union[- ]of[- ]affected/i],
    ]);
    const files = await Promise.all(
      [...expectedScope].map(
        async ([path, pattern]) =>
          [path, pattern, await readFile(join(REPO_ROOT, path), 'utf8')] as const,
      ),
    );

    for (const [path, pattern, contents] of files) {
      expect(contents, path).toMatch(pattern);
      expect(contents, path).not.toMatch(
        /run the full test suite|full test suite passes|full suite green|always run full suite|pre-batch verification \(full test suite|test results \(full suite output\)/i,
      );
    }

    const tddContents = files.find(([path]) => path === 'skills/tdd/SKILL.md')?.[2] ?? '';
    const redSection = tddContents.match(/### Phase 1: RED([\s\S]*?)### Phase 2: DOMAIN/i)?.[1] ?? '';
    expect(redSection, 'TDD RED section').toMatch(/scoped union of affected tests/i);
    expect(redSection, 'TDD RED section').toMatch(
      /test under change[\s\S]{0,80}expected failing member/i,
    );
    expect(redSection, 'TDD RED section').toMatch(
      /unrelated scoped (?:test )?failure[\s\S]{0,80}block/i,
    );

    const harnessContents = files.find(([path]) => path === 'HARNESS.md')?.[2] ?? '';
    expect(harnessContents, 'HARNESS intermediate test policy').toMatch(
      /RED\/GREEN[^\n]*scoped union of affected tests/i,
    );

    const combined = files.map(([, , contents]) => contents).join('\n');
    expect(combined).toMatch(/conduct-ts test-suite/);
    expect(combined).toMatch(/shared\/core[^\n]*3\+|3\+[^\n]*(?:importer|production module)/i);
    expect(combined).toMatch(/config[^\n]*migrations[^\n]*dependenc[^\n]*test infrastructure/i);
    expect(combined).toMatch(/empty[^\n]*(?:scoped|affected)|(?:scoped|affected)[^\n]*empty/i);
    expect(combined).toMatch(/low-confidence|cannot confidently map/i);
    expect(combined).toMatch(/name[^\n]*trigger|trigger[^\n]*reason/i);
    expect(combined).toMatch(
      /scoped (?:test|set)[^\n]*(?:fail|failure)[^\n]*(?:block|stop)|(?:fail|failure)[^\n]*scoped (?:test|set)[^\n]*(?:block|stop)/i,
    );
    expect(combined).not.toMatch(/skills\/test-suite/);
  });
});

describe('Stories 7–9 — finish, PR/CI, and repair boundaries (FR-13, FR-14, FR-15, FR-17)', () => {
  it('has finish invoke the shared CLI and reuse a current PASS without launching the project suite', async () => {
    const finishSkill = await readFile(join(REPO_ROOT, 'skills/finish/SKILL.md'), 'utf8');
    const gate = await invokeRealSuite();
    const launchesBeforeFinish = await readCount();
    const finishVerification = await invokeRealSuite();
    const launchesAfterFinish = await readCount();

    expect({
      finishUsesSharedCli: finishSkill.includes('conduct-ts test-suite'),
      gateExitCode: gate.exitCode,
      gateOutput: gate.stdout + gate.stderr,
      finishExitCode: finishVerification.exitCode,
      finishOutput: finishVerification.stdout + finishVerification.stderr,
      additionalProjectSuiteLaunches: launchesAfterFinish - launchesBeforeFinish,
    }).toEqual({
      finishUsesSharedCli: true,
      gateExitCode: 0,
      gateOutput: expect.stringMatching(/EXECUTED.*PASS/i),
      finishExitCode: 0,
      finishOutput: expect.stringMatching(/REUSED.*PASS/i),
      additionalProjectSuiteLaunches: 0,
    });
  });

  it('executes exactly once for each standalone missing or stale finish proof', async () => {
    const missingProof = await invokeRealSuite();
    const launchesAfterMissing = await readCount();
    await writeProjectFile('src/app.ts', 'export const value = 2;\n');
    const staleProof = await invokeRealSuite();
    const launchesAfterStale = await readCount();

    expect({
      missingExitCode: missingProof.exitCode,
      missingOutput: missingProof.stdout + missingProof.stderr,
      missingLaunches: launchesAfterMissing,
      staleExitCode: staleProof.exitCode,
      staleOutput: staleProof.stdout + staleProof.stderr,
      staleAdditionalLaunches: launchesAfterStale - launchesAfterMissing,
    }).toEqual({
      missingExitCode: 0,
      missingOutput: expect.stringMatching(/EXECUTED.*PASS/i),
      missingLaunches: 1,
      staleExitCode: 0,
      staleOutput: expect.stringMatching(/EXECUTED.*PASS/i),
      staleAdditionalLaunches: 1,
    });
  });

  it('blocks finish before choices when the shared CLI exits non-zero', async () => {
    const finishSkill = await readFile(join(REPO_ROOT, 'skills/finish/SKILL.md'), 'utf8');
    const suiteSection = finishSkill.slice(
      finishSkill.indexOf('### 1. Fresh Verification'),
      finishSkill.indexOf('### 1b.'),
    );
    const failure = await invokeRealSuite({ SUITE_MODE: 'fail:finish-block' });
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

  it('makes finish supply the only fallback and removes a local suite run from /pr', async () => {
    const [finish, pr] = await Promise.all([
      readFile(join(REPO_ROOT, 'skills/finish/SKILL.md'), 'utf8'),
      readFile(join(REPO_ROOT, 'skills/pr/SKILL.md'), 'utf8'),
    ]);

    expect(finish).toMatch(/conduct-ts test-suite/);
    expect(finish).toMatch(/REUSED|missing|stale/i);
    const rawAggregateCommand = /(?:\bnpm(?: run)? test\b|\bpnpm(?: run)? test\b|\byarn(?: run)? test\b|\bbun test\b|\bnpx vitest run\b|\bgo test\b|\bcargo test\b|bundle exec rspec\b|\bpytest\b|\bmvn test\b|\bgradle test\b|\bdotnet test\b|\bmix test\b|conduct-ts test-suite|full (?:test )?suite)/i;
    for (const command of ['npx vitest run', 'npm run test', 'go test ./...']) {
      expect(command, `raw aggregate guard: ${command}`).toMatch(rawAggregateCommand);
    }
    const prePushSection = pr.slice(
      pr.indexOf('### 5. Pre-Push Verification'),
      pr.indexOf('### 6. Create or Update the PR'),
    );
    expect(prePushSection).not.toMatch(rawAggregateCommand);
    expect(pr).not.toMatch(
      /(?:\bnpm(?: run)? test\b|\bnpx vitest run\b|\bgo test\b|conduct-ts test-suite|full (?:test )?suite)/i,
    );
  });

  it('preserves independent CI, autoresolve, and CI-repair suite execution', async () => {
    const [workflow, autoresolve, ciFix] = await Promise.all([
      readFile(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8'),
      readFile(join(CONDUCTOR_ROOT, 'src/engine/autoresolve.ts'), 'utf8'),
      readFile(join(CONDUCTOR_ROOT, 'src/engine/ci-fix.ts'), 'utf8'),
    ]);

    expect(workflow).toMatch(
      /conductor:[\s\S]*?- run: (?:npm test|npx vitest run)[\s\S]*?working-directory: src\/conductor/i,
    );
    expect(workflow).toMatch(
      /ci-gate:[\s\S]*?needs:[^\n]*conductor[\s\S]*?failure\|cancelled/i,
    );
    expect(workflow).not.toMatch(/test-suite-evidence\.json/);
    expect(autoresolve).toMatch(/suiteCommand|suite command/i);
    expect(ciFix).toMatch(/suite|test/i);
    expect(autoresolve).not.toMatch(/test-suite-evidence\.json/);
    expect(ciFix).not.toMatch(/test-suite-evidence\.json/);
  });
});
