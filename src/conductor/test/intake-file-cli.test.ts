// Covers: task:4
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

const CONDUCTOR_ROOT = fileURLToPath(new URL('../', import.meta.url));
const INTAKE_FILE_CLI = join(CONDUCTOR_ROOT, 'src', 'intake-file-cli.ts');
const TSX = join(CONDUCTOR_ROOT, 'node_modules', '.bin', 'tsx');

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function runIntakeFile(options: { failPost43?: boolean; failRead43?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'intake-file-cli-'));
  roots.push(root);
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  const callsPath = join(root, 'gh-calls.jsonl');
  await Promise.all([mkdir(bin), mkdir(home)]);
  await writeFile(join(bin, 'gh-stub.mjs'), `
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.GH_CALLS, JSON.stringify(args) + '\\n');
if (args.join(' ') === 'api user --jq .login') process.stdout.write('intake-bot\\n');
else if (args[0] === 'issue' && args[1] === 'create') process.stdout.write('https://github.com/acme/app/issues/99\\n');
else if (args[0] === 'api' && args[1] === 'repos/acme/app/issues/43' && process.env.FAIL_READ_43 === '1') {
  process.stderr.write('dependency id read failed\\n');
  process.exit(1);
} else if (args[0] === 'api' && /^repos\\/acme\\/app\\/issues\\/(42|43)$/.test(args[1] ?? '')) {
  const number = args[1].split('/').at(-1);
  process.stdout.write(JSON.stringify({ id: 1000000 + Number(number) }) + '\\n');
} else if (args[0] === 'api' && args.some((argument) => argument.includes('dependencies/blocked_by'))) {
  const typedId = args.indexOf('-F') >= 0 && args[args.indexOf('-F') + 1]?.startsWith('issue_id=');
  const rejects43 = args.includes('issue_id=1000043') && process.env.FAIL_POST_43 === '1';
  if (!typedId || rejects43) {
    process.stderr.write('HTTP 422: dependency rejected\\n');
    process.exit(1);
  }
}
`, 'utf8');
  await writeFile(join(bin, 'gh'), '#!/bin/sh\nexec node "$(dirname "$0")/gh-stub.mjs" "$@"\n', 'utf8');
  await chmod(join(bin, 'gh'), 0o755);
  const { AI_CONDUCTOR_NO_REAL_EXEC: _testExecGuard, ...environment } = process.env;

  const result = await execa(TSX, [INTAKE_FILE_CLI,
    '--title', 'Typed dependency', '--body', 'body', '--size', 'S', '--priority', 'low', '--repo', 'acme/app',
    '--depends-on', 'acme/app#42', '--depends-on', 'acme/app#43',
  ], {
    cwd: root,
    reject: false,
    extendEnv: false,
    env: {
      ...environment,
      HOME: home,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      TMPDIR: '/tmp',
      GH_CALLS: callsPath,
      ...(options.failPost43 ? { FAIL_POST_43: '1' } : {}),
      ...(options.failRead43 ? { FAIL_READ_43: '1' } : {}),
    },
  });
  const calls = (await readFile(callsPath, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as string[]);
  return { ...result, calls };
}

describe('intake-file CLI', () => {
  it('reports dependency links and every missing link after a successful filing', async () => {
    const linked = await runIntakeFile();

    // The real entry point reached the fixture-owned process boundary before
    // any assertions rely on its destructive-shaped dependency arguments.
    expect(linked.calls).toContainEqual(expect.arrayContaining(['issue', 'create']));
    expect({ exitCode: linked.exitCode, stdout: linked.stdout, stderr: linked.stderr }).toEqual({
      exitCode: 0,
      stdout: expect.stringMatching(/\[intake-file\] depends-on: acme\/app#42, acme\/app#43/),
      stderr: expect.not.stringContaining('[intake-file] NOT LINKED:'),
    });

    const rejected = await runIntakeFile({ failPost43: true });
    expect(rejected.calls).toContainEqual(expect.arrayContaining(['issue', 'create']));
    expect({ exitCode: rejected.exitCode, stderr: rejected.stderr, finalNotLinked: rejected.stderr.lastIndexOf('[intake-file] NOT LINKED:') > rejected.stderr.lastIndexOf('[intake-file] warning:') }).toEqual({
      exitCode: 0,
      stderr: expect.stringMatching(/\[intake-file\] NOT LINKED: https:\/\/github\.com\/acme\/app\/issues\/99 is not blocked by acme\/app#43 \([\s\S]*HTTP 422: dependency rejected[\s\S]*\)/),
      finalNotLinked: true,
    });

    const unreadable = await runIntakeFile({ failRead43: true });
    expect(unreadable.calls).toContainEqual(expect.arrayContaining(['issue', 'create']));
    expect({ exitCode: unreadable.exitCode, stdout: unreadable.stdout, stderr: unreadable.stderr, finalNotLinked: unreadable.stderr.lastIndexOf('[intake-file] NOT LINKED:') > unreadable.stderr.lastIndexOf('[intake-file] warning:') }).toEqual({
      exitCode: 0,
      stdout: expect.stringContaining('[intake-file] depends-on: acme/app#42'),
      stderr: expect.stringMatching(/\[intake-file\] NOT LINKED: https:\/\/github\.com\/acme\/app\/issues\/99 is not blocked by acme\/app#43 \([\s\S]*dependency id read failed[\s\S]*\)/),
      finalNotLinked: true,
    });
  });
});
