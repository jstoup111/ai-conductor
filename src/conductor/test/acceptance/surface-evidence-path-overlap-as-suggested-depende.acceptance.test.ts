/**
 * Acceptance coverage for the intake filer's overlap-decision lifecycle.
 *
 * Covers: S10.1, S10.2, S11.2, S12.2, task:18
 * Covers: FR-10, FR-11, FR-12, FR-17
 *
 * This drives the real CLI twice from a target-repository checkout. GitHub is
 * the only third-party boundary, so a fixture-owned `gh` executable records
 * every attempted operation and returns deterministic tracker data.
 */

import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

const CONDUCTOR_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const INTAKE_FILE_CLI = join(CONDUCTOR_ROOT, 'src', 'intake-file-cli.ts');
const TSX = join(CONDUCTOR_ROOT, 'node_modules', '.bin', 'tsx');
const TARGET_REPOSITORY = 'acme/widgets';
const OVERLAPPING_ISSUE = `${TARGET_REPOSITORY}#1579`;
const SHARED_PATH = 'src/review/rubric.ts';

const roots: string[] = [];
// tsx uses a fixed `tsx-<uid>` directory below the temporary directory. Give
// each fixture a short, checkout-relative spelling so concurrent CLI fixtures
// neither exceed the Unix-socket limit nor contend for `/tmp/tsx-<uid>`.
const childTmpdir = process.platform === 'linux' ? '/proc/self/cwd' : undefined;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(cwd: string, args: string[]): Promise<void> {
  await execa('git', args, { cwd });
}

async function makeTargetCheckout(root: string): Promise<string> {
  const checkout = join(root, 'checkout');
  await mkdir(join(checkout, 'src', 'review'), { recursive: true });
  await git(checkout, ['init', '-b', 'main']);
  await git(checkout, ['config', 'user.name', 'Acceptance Fixture']);
  await git(checkout, ['config', 'user.email', 'fixture@example.test']);
  await writeFile(join(checkout, SHARED_PATH), 'export const rubric = true;\n', 'utf8');
  await git(checkout, ['add', SHARED_PATH]);
  await git(checkout, ['commit', '-m', 'fixture base']);
  await git(checkout, ['remote', 'add', 'origin', `https://github.com/${TARGET_REPOSITORY}.git`]);
  const head = (await execa('git', ['rev-parse', 'HEAD'], { cwd: checkout })).stdout.trim();
  await git(checkout, ['update-ref', 'refs/remotes/origin/main', head]);
  return checkout;
}

async function makeGhStub(root: string): Promise<{ bin: string; callsPath: string }> {
  const bin = join(root, 'bin');
  const callsPath = join(root, 'gh-calls.jsonl');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'gh-stub.mjs'), `
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
appendFileSync(process.env.GH_CALLS, JSON.stringify(args) + '\\n');

if (args.join(' ') === 'api user --jq .login') {
  process.stdout.write('intake-bot\\n');
} else if (args[0] === 'repo' && args[1] === 'view') {
  process.stdout.write(JSON.stringify({ nameWithOwner: '${TARGET_REPOSITORY}' }) + '\\n');
} else if (args[0] === 'issue' && args[1] === 'list') {
  process.stdout.write(JSON.stringify([{ number: 1579, body: 'Observed in ${SHARED_PATH}' }]) + '\\n');
} else if (args[0] === 'issue' && args[1] === 'view') {
  process.stdout.write(JSON.stringify({ state: 'OPEN' }) + '\\n');
} else if (args[0] === 'issue' && args[1] === 'create') {
  process.stdout.write('https://github.com/${TARGET_REPOSITORY}/issues/2000\\n');
} else if (args[0] === 'api' && args[1] === 'repos/${TARGET_REPOSITORY}/issues/1579') {
  process.stdout.write(JSON.stringify({ id: 1001579, number: 1579, state: 'open' }) + '\\n');
} else {
  process.stdout.write('{}\\n');
}
`, 'utf8');
  await writeFile(join(bin, 'gh'), '#!/bin/sh\nexec node "$(dirname "$0")/gh-stub.mjs" "$@"\n', 'utf8');
  await chmod(join(bin, 'gh'), 0o755);
  return { bin, callsPath };
}

async function readCalls(callsPath: string): Promise<string[][]> {
  const raw = await readFile(callsPath, 'utf8').catch(() => '');
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line) as string[]);
}

describe('intake overlap decisions precede issue creation', () => {
  it('refuses an undecided overlap, then creates exactly one issue after an explicit decline', async () => {
    const root = await mkdtemp(join(tmpdir(), 'intake-overlap-acceptance-'));
    roots.push(root);
    const checkout = await makeTargetCheckout(root);
    const { bin, callsPath } = await makeGhStub(root);
    const home = join(root, 'home');
    await mkdir(home);
    const {
      AI_CONDUCTOR_NO_REAL_EXEC: _testExecGuard,
      CONDUCT_GH_REAL_EXECUTABLE: _managedGhBypass,
      ...environment
    } = process.env;
    const env = {
      ...environment,
      HOME: home,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      // Keep the fixture's physical files in Vitest's run root, but shorten
      // tsx's Unix-socket pathname without sharing another fixture's socket.
      TMPDIR: childTmpdir ?? root,
      TMP: childTmpdir ?? root,
      TEMP: childTmpdir ?? root,
      GH_CALLS: callsPath,
    };
    const commonArgs = [
      INTAKE_FILE_CLI,
      '--title', 'Review overlap',
      '--body', `Observed at ${SHARED_PATH}:41`,
      '--size', 'S',
      '--priority', 'high',
      '--repo', TARGET_REPOSITORY,
    ];

    const refused = await execa(TSX, commonArgs, {
      cwd: checkout,
      env,
      extendEnv: false,
      reject: false,
    });

    expect({ exitCode: refused.exitCode, stdout: refused.stdout, stderr: refused.stderr }).toEqual({
      exitCode: 1,
      stdout: expect.stringMatching(
        new RegExp(`${OVERLAPPING_ISSUE.replace('/', '\\/')}[\\s\\S]*${SHARED_PATH.replaceAll('/', '\\/')}[\\s\\S]*--depends-on ${OVERLAPPING_ISSUE.replace('/', '\\/')}[\\s\\S]*--decline-overlap ${OVERLAPPING_ISSUE.replace('/', '\\/')}`),
      ),
      stderr: expect.any(String),
    });
    expect((await readCalls(callsPath)).filter((args) => args[0] === 'issue' && args[1] === 'create')).toHaveLength(0);

    const completed = await execa(TSX, [...commonArgs, '--decline-overlap', OVERLAPPING_ISSUE], {
      cwd: checkout,
      env,
      extendEnv: false,
      reject: false,
    });

    expect(completed.exitCode).toBe(0);
    expect(completed.stdout).toContain(`[intake-file] overlap: declined ${OVERLAPPING_ISSUE}`);
    expect(completed.stdout).toContain('[intake-file] dependencies: none');
    expect((await readCalls(callsPath)).filter((args) => args[0] === 'issue' && args[1] === 'create')).toHaveLength(1);
  });
});
