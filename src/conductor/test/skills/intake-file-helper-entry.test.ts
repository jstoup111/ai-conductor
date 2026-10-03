// Covers: task:3
// The helper and CLI are real; gh is a local process-boundary stub.
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { externalFixturePrefix } from '../tmpdir-leak-guard.js';

const helper = resolve(process.cwd(), '../../skills/intake/scripts/intake-file');
const cli = resolve(process.cwd(), 'src/intake-file-cli.ts');
const tsx = resolve(process.cwd(), 'node_modules/.bin/tsx');
const tsconfig = resolve(process.cwd(), 'tsconfig.json');
const roots: string[] = [];

interface GhCall {
  readonly cwd: string;
  readonly args: string[];
}

async function makeFixture(): Promise<{ caller: string; capture: string; env: NodeJS.ProcessEnv }> {
  const root = await mkdtemp(externalFixturePrefix('intake-helper'));
  roots.push(root);
  const caller = join(root, 'consumer');
  const home = join(root, 'home');
  const stubDirectory = join(root, 'bin');
  const capture = join(root, 'gh-calls.txt');
  await mkdir(stubDirectory, { recursive: true });
  await writeFile(join(stubDirectory, 'gh'), `#!/usr/bin/env bash
set -euo pipefail
{
  printf 'cwd=%s\\n' "$PWD"
  for arg in "$@"; do printf 'arg=%s\\n' "$arg"; done
  printf -- '--\\n'
} >> "$GH_CAPTURE"
if [ "$#" -eq 4 ] && [ "$1" = repo ] && [ "$2" = view ] && [ "$3" = --json ] && [ "$4" = nameWithOwner ]; then
  printf '%s\\n' '{"nameWithOwner":"acme/consumer"}'
  exit 0
fi
printf '%s\\n' 'gh stub refused non-repository-view call' >&2
exit 19
`);
  await chmod(join(stubDirectory, 'gh'), 0o755);
  await mkdir(caller, { recursive: true });
  await mkdir(join(home, '.ai-conductor'), { recursive: true });
  await writeFile(join(home, '.ai-conductor', 'config.yml'), 'spec_owner: intake-tester\n');
  return {
    caller,
    capture,
    env: {
      ...process.env,
      AI_CONDUCTOR_NO_REAL_EXEC: undefined,
      GH_CAPTURE: capture,
      HOME: home,
      PATH: `${stubDirectory}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      TMPDIR: root,
      TMP: root,
      TEMP: root,
    },
  };
}

async function recordedCalls(capture: string): Promise<GhCall[]> {
  const lines = (await readFile(capture, 'utf8')).trimEnd().split('\n');
  const calls: GhCall[] = [];
  let cwd: string | undefined;
  let args: string[] = [];
  for (const line of lines) {
    if (line === '--') {
      if (cwd !== undefined) calls.push({ cwd, args });
      cwd = undefined;
      args = [];
    } else if (line.startsWith('cwd=')) {
      cwd = line.slice('cwd='.length);
    } else if (line.startsWith('arg=')) {
      args.push(line.slice('arg='.length));
    }
  }
  return calls;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('intake-file bundled helper entry point', () => {
  it('keeps the caller repository as the production gh adapter cwd', async () => {
    const fixture = await makeFixture();

    spawnSync(helper, ['--title', 'Caller cwd', '--body', 'body', '--size', 'S'], {
      cwd: fixture.caller,
      encoding: 'utf8',
      env: fixture.env,
    });

    const calls = await recordedCalls(fixture.capture);
    // This must precede assertions about the mocked call: configuration alone
    // is not proof that the production adapter actually reached the stub.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toEqual({
      cwd: fixture.caller,
      args: ['repo', 'view', '--json', 'nameWithOwner'],
    });
    expect(calls[0]?.cwd).not.toBe(resolve(process.cwd(), '../..'));
  });

  it('returns the CLI usage without reaching gh when required arguments are absent', async () => {
    const fixture = await makeFixture();

    const helperResult = spawnSync(helper, [], { cwd: fixture.caller, encoding: 'utf8', env: fixture.env });
    const directResult = spawnSync(tsx, ['--tsconfig', tsconfig, cli], {
      cwd: fixture.caller,
      encoding: 'utf8',
      env: fixture.env,
    });

    expect(helperResult.status).not.toBe(0);
    expect(directResult.status).not.toBe(0);
    expect(helperResult.stderr).toContain('Usage: intake-file');
    expect(directResult.stderr).toContain('Usage: intake-file');
    await expect(readFile(fixture.capture, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
