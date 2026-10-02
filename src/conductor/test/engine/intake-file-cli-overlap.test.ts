// Covers: task:18
// The production CLI and local Git are real; `gh` is a process-boundary stub.
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileP = promisify(execFile);
const cli = resolve(process.cwd(), 'src/intake-file-cli.ts');
const tsx = resolve(process.cwd(), 'node_modules/.bin/tsx');
const roots: string[] = [];
const externalTmpdir = process.env.AI_CONDUCTOR_TEST_ORIGINAL_TMPDIR ?? tmpdir();

interface GhCall {
  readonly cwd: string;
  readonly args: string[];
}

interface Fixture {
  readonly repository: string;
  readonly capture: string;
  readonly env: NodeJS.ProcessEnv;
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileP('git', args, { cwd });
}

async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(externalTmpdir, 'intake-file-cli-overlap-'));
  roots.push(root);
  const repository = join(root, 'target');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  const capture = join(root, 'gh-calls.txt');
  await mkdir(bin, { recursive: true });
  await mkdir(join(home, '.ai-conductor'), { recursive: true });
  await writeFile(join(home, '.ai-conductor', 'config.yml'), 'spec_owner: intake-tester\n');
  await writeFile(join(bin, 'gh'), `#!/usr/bin/env bash
set -euo pipefail
{
  printf 'cwd=%s\\n' "$PWD"
  for arg in "$@"; do printf 'arg=%s\\n' "$arg"; done
  printf -- '--\\n'
} >> "$GH_CAPTURE"
case "\${1:-} \${2:-}" in
  'repo view') printf '%s\\n' '{"nameWithOwner":"acme/target"}' ;;
  'issue list') printf '%s\\n' '[{"number":1579,"body":"Existing work cites src/review/rubric.ts."}]' ;;
  'issue view') printf '%s\\n' 'OPEN' ;;
  'issue create') printf '%s\\n' 'https://github.com/acme/target/issues/300' ;;
  api) printf '%s\\n' '{"id":1000300}' ;;
  *) printf '%s\\n' 'gh stub refused unexpected argv' >&2; exit 19 ;;
esac
`);
  await chmod(join(bin, 'gh'), 0o755);

  await mkdir(repository, { recursive: true });
  await git(repository, ['init', '-q', '-b', 'main']);
  await git(repository, ['config', 'user.email', 'test@example.com']);
  await git(repository, ['config', 'user.name', 'Test User']);
  await git(repository, ['remote', 'add', 'origin', 'https://github.com/acme/target.git']);
  await mkdir(join(repository, 'src', 'review'), { recursive: true });
  await writeFile(join(repository, 'src', 'review', 'rubric.ts'), 'export const rubric = 1;\n');
  await writeFile(join(repository, 'src', 'no-overlap.ts'), 'export const noOverlap = true;\n');
  await git(repository, ['add', '.']);
  await git(repository, ['commit', '-qm', 'initial']);
  await git(repository, ['switch', '-qc', 'feat/daemon-overlap']);
  await writeFile(join(repository, 'src', 'review', 'rubric.ts'), 'export const rubric = 2;\n');
  await git(repository, ['add', '.']);
  await git(repository, ['commit', '-qm', 'overlap rubric']);
  await git(repository, ['switch', '-q', 'main']);

  return {
    repository,
    capture,
    env: {
      ...process.env,
      AI_CONDUCTOR_NO_REAL_EXEC: undefined,
      GH_CAPTURE: capture,
      HOME: home,
      PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      TMPDIR: root,
      TMP: root,
      TEMP: root,
    },
  };
}

function runCli(fixture: Fixture, args: string[]) {
  return spawnSync(tsx, [cli, ...args], {
    cwd: fixture.repository,
    encoding: 'utf8',
    env: fixture.env,
  });
}

async function calls(capture: string): Promise<GhCall[]> {
  const output = await readFile(capture, 'utf8');
  const result: GhCall[] = [];
  let cwd: string | undefined;
  let args: string[] = [];
  for (const line of output.trimEnd().split('\n')) {
    if (line === '--') {
      if (cwd !== undefined) result.push({ cwd, args });
      cwd = undefined;
      args = [];
    } else if (line.startsWith('cwd=')) cwd = line.slice('cwd='.length);
    else if (line.startsWith('arg=')) args.push(line.slice('arg='.length));
  }
  return result;
}

async function clearCalls(capture: string): Promise<void> {
  await writeFile(capture, '');
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('intake-file overlap wiring', () => {
  it('refuses an undecided open-issue overlap before creating an issue', async () => {
    const fixture = await makeFixture();

    const result = runCli(fixture, [
      '--title', 'Rubric overlap', '--body', 'Please update src/review/rubric.ts.', '--size', 'S',
    ]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('acme/target#1579');
    expect(result.stdout).toContain('src/review/rubric.ts');
    expect(result.stdout).toContain('--depends-on acme/target#1579');
    expect(result.stdout).toContain('--decline-overlap acme/target#1579');
    expect(result.stdout).toContain('feat/daemon-overlap');
    expect((await calls(fixture.capture)).some(({ args }) => args[0] === 'issue' && args[1] === 'create')).toBe(false);
  });

  it('files exactly once when the suggested overlap is explicitly declined', async () => {
    const fixture = await makeFixture();
    await clearCalls(fixture.capture);

    const result = runCli(fixture, [
      '--title', 'Rubric overlap', '--body', 'Please update src/review/rubric.ts.', '--size', 'S',
      '--decline-overlap', 'acme/target#1579',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('overlap: declined acme/target#1579');
    expect((await calls(fixture.capture)).filter(({ args }) => args[0] === 'issue' && args[1] === 'create')).toHaveLength(1);
  });

  it('reports no overlap for unrelated evidence and scans only the target checkout branches', async () => {
    const fixture = await makeFixture();
    const { stdout } = await execFileP('git', ['branch', '--show-current'], { cwd: process.cwd() });
    const harnessBranch = stdout.trim();

    const result = runCli(fixture, [
      '--title', 'Unrelated intake', '--body', 'Please update src/no-overlap.ts.', '--size', 'S',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('overlap check: no overlap');
    expect(result.stdout).toContain('dependencies: none');
    expect(result.stdout).not.toContain('feat/daemon-overlap');
    if (harnessBranch) expect(result.stdout).not.toContain(harnessBranch);
  });
});
