/**
 * Acceptance specs for Story 7 in
 * .docs/stories/build-review-repeats-aggregate-verification-despit.md.
 *
 * The checked-in npm scripts are exercised through real npm argument forwarding in
 * an isolated package. A fake `vitest` executable records the runner argv, keeping
 * this acceptance test away from the repository's aggregate suite and every third
 * party boundary.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execa } from 'execa';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONDUCTOR_ROOT = fileURLToPath(new URL('../../', import.meta.url));

let fixtureRoot: string;
let runnerArgvPath: string;

async function invokeScript(script: 'test' | 'test:changed', selectors: string[]) {
  return execa('npm', ['run', script, '--', ...selectors], {
    cwd: fixtureRoot,
    env: {
      ...process.env,
      PATH: `${join(fixtureRoot, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
      RUNNER_ARGV_PATH: runnerArgvPath,
    },
    reject: false,
  });
}

beforeEach(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'scoped-script-forwarding-'));
  runnerArgvPath = join(fixtureRoot, 'runner-argv.json');

  const sourcePackage = JSON.parse(
    await readFile(join(CONDUCTOR_ROOT, 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };

  await mkdir(join(fixtureRoot, 'bin'), { recursive: true });
  await writeFile(
    join(fixtureRoot, 'package.json'),
    JSON.stringify({ name: 'scoped-script-fixture', private: true, scripts: sourcePackage.scripts }),
    'utf8',
  );

  const fakeVitest = join(fixtureRoot, 'bin', 'vitest');
  await writeFile(
    fakeVitest,
    [
      '#!/usr/bin/env node',
      "import { writeFile } from 'node:fs/promises';",
      "const args = process.argv.slice(2);",
      "await writeFile(process.env.RUNNER_ARGV_PATH, JSON.stringify(args), 'utf8');",
      "if (args.includes('failing.spec.ts')) process.exitCode = 7;",
      '',
    ].join('\n'),
    'utf8',
  );
  await chmod(fakeVitest, 0o755);
});

afterEach(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe('Story 7: npm scripts preserve scoped test selection', () => {
  it.each(['test', 'test:changed'] as const)(
    '%s forwards a space-bearing selector to the runner as one argument',
    async (script) => {
      const selector = 'test/acceptance/path with space.spec.ts';
      const result = await invokeScript(script, [selector]);
      const runnerArgv = JSON.parse(await readFile(runnerArgvPath, 'utf8')) as string[];

      expect({
        exitCode: result.exitCode,
        selectorCount: runnerArgv.filter((arg) => arg === selector).length,
      }).toEqual({ exitCode: 0, selectorCount: 1 });
      expect(result.stdout).not.toContain(selector);
    },
  );

  it('propagates a selected test failure and withholds the aggregate success sentinel', async () => {
    const result = await invokeScript('test', ['failing.spec.ts']);

    expect(result.exitCode).toBe(7);
    expect(result.stdout).not.toContain('AGGREGATE_TEST_SUITE_PASS');
  });
});
