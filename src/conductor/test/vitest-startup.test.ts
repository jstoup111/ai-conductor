// Covers: task:4
// The ordinary launcher is exercised as a child process with a fixture-owned
// fake Vitest binary, so this test observes its real pre-spawn environment.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execa } from 'execa';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONDUCTOR_ROOT = fileURLToPath(new URL('../', import.meta.url));

let fixtureRoot: string;
let observationPath: string;

async function launch(env: NodeJS.ProcessEnv = {}) {
  const childEnv = { ...process.env, ...env };
  for (const key of [
    'AI_CONDUCTOR_TEST_TMP_ROOT',
    'AI_CONDUCTOR_TEST_TMP_SCOPE',
    'AI_CONDUCTOR_TEST_ORIGINAL_TMPDIR',
    'GIT_CEILING_DIRECTORIES',
  ]) {
    if (!(key in env)) delete childEnv[key];
  }
  return execa(process.execPath, [join(fixtureRoot, 'scripts', 'run-vitest.mjs'), 'run', 'selected.test.ts'], {
    cwd: fixtureRoot,
    extendEnv: false,
    env: {
      ...childEnv,
      PATH: `${join(fixtureRoot, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
      RUNNER_OBSERVATION_PATH: observationPath,
    },
    reject: false,
  });
}

beforeEach(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'vitest-startup-'));
  observationPath = join(fixtureRoot, 'vitest-observation.json');
  await mkdir(join(fixtureRoot, 'bin'), { recursive: true });
  await mkdir(join(fixtureRoot, 'scripts'), { recursive: true });
  await mkdir(join(fixtureRoot, 'original-tmpdir'));
  await copyFile(
    join(CONDUCTOR_ROOT, 'scripts', 'run-vitest.mjs'),
    join(fixtureRoot, 'scripts', 'run-vitest.mjs'),
  );
  await copyFile(
    join(CONDUCTOR_ROOT, 'scripts', 'vitest-temp.mjs'),
    join(fixtureRoot, 'scripts', 'vitest-temp.mjs'),
  );
  const fakeVitest = join(fixtureRoot, 'bin', 'vitest');
  await writeFile(fakeVitest, [
    '#!/usr/bin/env node',
    "import { writeFile } from 'node:fs/promises';",
    "await writeFile(process.env.RUNNER_OBSERVATION_PATH, JSON.stringify({",
    '  argv: process.argv.slice(2),',
    '  tmpdir: process.env.TMPDIR,',
    '  root: process.env.AI_CONDUCTOR_TEST_TMP_ROOT,',
    '  scope: process.env.AI_CONDUCTOR_TEST_TMP_SCOPE,',
    '  originalTmpdir: process.env.AI_CONDUCTOR_TEST_ORIGINAL_TMPDIR,',
    '  gitCeiling: process.env.GIT_CEILING_DIRECTORIES,',
    '}), \'utf8\');',
    'process.exitCode = Number(process.env.FAKE_VITEST_EXIT_CODE ?? 0);',
    '',
  ].join('\n'), 'utf8');
  await chmod(fakeVitest, 0o755);
});

afterEach(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe('run-vitest startup', () => {
  it('installs its default fixture-local scope before launching Vitest', async () => {
    const originalTmpdir = join(fixtureRoot, 'original-tmpdir');
    const result = await launch({ TMPDIR: originalTmpdir });
    const observation = JSON.parse(await readFile(observationPath, 'utf8')) as Record<string, string>;

    expect(result.exitCode).toBe(0);
    expect(observation.argv).toEqual(['run', 'selected.test.ts']);
    expect(observation.originalTmpdir).toBe(originalTmpdir);
    expect(observation.tmpdir).toBe(observation.root);
    expect(observation.scope).toBe(observation.root);
    expect(observation.root).toMatch(new RegExp(`^${join(fixtureRoot, '.vitest-tmp', 'ai-conductor-vitest-run-')}`));
    expect(observation.gitCeiling?.split(delimiter)).toContain(observation.root);
    expect(existsSync(observation.root)).toBe(false);
  });

  it('installs an explicit storage parent before launching Vitest', async () => {
    const originalTmpdir = join(fixtureRoot, 'original-tmpdir');
    const override = join(fixtureRoot, 'explicit-storage');
    const result = await launch({
      TMPDIR: originalTmpdir,
      AI_CONDUCTOR_TEST_TMP_BASE: override,
    });
    const observation = JSON.parse(await readFile(observationPath, 'utf8')) as Record<string, string>;

    expect(result.exitCode).toBe(0);
    expect(observation.originalTmpdir).toBe(originalTmpdir);
    expect(observation.root).toMatch(new RegExp(`^${join(override, 'ai-conductor-vitest-run-')}`));
    expect(existsSync(observation.root)).toBe(false);
  });

  it('rejects invalid storage before it can launch Vitest', async () => {
    const result = await launch({ AI_CONDUCTOR_TEST_TMP_BASE: 'relative-storage' });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/AI_CONDUCTOR_TEST_TMP_BASE|absolute/i);
    expect(existsSync(observationPath)).toBe(false);
  });

  it('rejects an unavailable override before it can launch Vitest', async () => {
    const unavailableParent = join(fixtureRoot, 'not-a-directory');
    await writeFile(unavailableParent, 'fixture file', 'utf8');

    const result = await launch({ AI_CONDUCTOR_TEST_TMP_BASE: unavailableParent });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/Unable to allocate Vitest temporary storage|not-a-directory/i);
    expect(existsSync(observationPath)).toBe(false);
  });

  it('forwards a nonzero child status and reclaims its owned root', async () => {
    const result = await launch({ FAKE_VITEST_EXIT_CODE: '23' });
    const observation = JSON.parse(await readFile(observationPath, 'utf8')) as Record<string, string>;

    expect(result.exitCode).toBe(23);
    expect(existsSync(observation.root)).toBe(false);
  });
});
