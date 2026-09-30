// Covers: task:1
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const sourceHelper = resolve(process.cwd(), '../../skills/intake/scripts/intake-file');
const temporaryRoots: string[] = [];
const systemPath = '/usr/bin:/bin';
const externalTmpdir = process.env.AI_CONDUCTOR_TEST_ORIGINAL_TMPDIR ?? tmpdir();

function controlledPath(stubDirectory: string): string {
  return `${stubDirectory}:${systemPath}`;
}

async function fixture(): Promise<{ root: string; helper: string; capture: string; makeCaller(name: string): Promise<string> }> {
  const root = await mkdtemp(join(externalTmpdir, 'bundled-intake-helper-'));
  temporaryRoots.push(root);
  const harness = join(root, 'harness');
  const helper = join(harness, 'skills', 'intake', 'scripts', 'intake-file');
  const conductor = join(harness, 'src', 'conductor');
  const capture = join(root, 'tsx-capture.txt');
  await mkdir(join(conductor, 'node_modules', '.bin'), { recursive: true });
  await mkdir(join(conductor, 'src'), { recursive: true });
  await mkdir(dirname(helper), { recursive: true });
  await copyFile(sourceHelper, helper);
  await writeFile(join(conductor, 'src', 'intake-file-cli.ts'), '');
  await writeFile(join(conductor, 'node_modules', '.bin', 'tsx'), `#!/bin/bash
set -euo pipefail
printf '%s\\n' "$PWD" "$@" > "$CAPTURE"
if [ "\${STUB_EXIT:-0}" -ne 0 ]; then
  printf '%s\\n' "simulated \${STUB_FAILURE:-unknown} failure" >&2
  exit "$STUB_EXIT"
fi
`);
  await chmod(join(conductor, 'node_modules', '.bin', 'tsx'), 0o755);
  return {
    root,
    helper,
    capture,
    async makeCaller(name: string): Promise<string> {
      const caller = join(root, name);
      await mkdir(caller, { recursive: true });
      return caller;
    },
  };
}

async function capturedLines(path: string): Promise<string[]> {
  return (await readFile(path, 'utf8')).trimEnd().split('\n');
}

async function makePathDirectory(root: string): Promise<string> {
  const pathDirectory = join(root, 'path-stubs');
  await mkdir(pathDirectory, { recursive: true });
  await symlink(process.execPath, join(pathDirectory, 'node'));
  return pathDirectory;
}

async function makePathCommand(root: string, target: string): Promise<string> {
  const pathDirectory = await makePathDirectory(root);
  await symlink(target, join(pathDirectory, 'ai-conductor'));
  return pathDirectory;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('bundled intake helper', () => {
  it('resolves a symlinked skill to its harness while preserving the caller directory and argument order', async () => {
    const setup = await fixture();
    const caller = await setup.makeCaller('consumer-repo');
    const linkedSkill = join(setup.root, 'consumer', '.agents', 'skills', 'intake');
    await mkdir(dirname(linkedSkill), { recursive: true });
    await symlink(join(setup.root, 'harness', 'skills', 'intake'), linkedSkill, 'dir');

    const result = spawnSync(join(linkedSkill, 'scripts', 'intake-file'), [
      '--title', 'A title', '--body', 'A body', '--size', 'M', '--priority', 'high',
      '--depends-on', 'owner/repo#1', '--depends-on', 'owner/repo#2',
    ], { cwd: caller, encoding: 'utf8', env: { ...process.env, CAPTURE: setup.capture } });

    expect(result.status).toBe(0);
    expect(await capturedLines(setup.capture)).toEqual([
      caller,
      '--tsconfig', join(setup.root, 'harness', 'src', 'conductor', 'tsconfig.json'),
      join(setup.root, 'harness', 'src', 'conductor', 'src', 'intake-file-cli.ts'),
      '--title', 'A title', '--body', 'A body', '--size', 'M', '--priority', 'high',
      '--depends-on', 'owner/repo#1', '--depends-on', 'owner/repo#2',
    ]);
  });

  it('finds a fixture harness from a deeply copied helper', async () => {
    const setup = await fixture();
    const caller = await setup.makeCaller('caller');
    const deepHelper = join(setup.root, 'harness', 'nested', 'bundle', 'scripts', 'intake-file');
    await mkdir(dirname(deepHelper), { recursive: true });
    await copyFile(setup.helper, deepHelper);
    await chmod(deepHelper, 0o755);

    const result = spawnSync(deepHelper, ['--title', 'Deep', '--body', 'body'], {
      cwd: caller, encoding: 'utf8', env: { ...process.env, CAPTURE: setup.capture },
    });

    expect(result.status).toBe(0);
    expect((await capturedLines(setup.capture)).slice(0, 5)).toEqual([
      caller,
      '--tsconfig', join(setup.root, 'harness', 'src', 'conductor', 'tsconfig.json'),
      join(setup.root, 'harness', 'src', 'conductor', 'src', 'intake-file-cli.ts'),
      '--title',
    ]);
  });

  it('skips a nearer ancestor with only the intake source and uses a qualifying harness above it', async () => {
    const setup = await fixture();
    const caller = await setup.makeCaller('caller');
    const nestedHarness = join(setup.root, 'harness', 'nested');
    const deepHelper = join(nestedHarness, 'bundle', 'scripts', 'intake-file');
    await mkdir(join(nestedHarness, 'src', 'conductor', 'src'), { recursive: true });
    await mkdir(dirname(deepHelper), { recursive: true });
    await copyFile(setup.helper, deepHelper);
    await chmod(deepHelper, 0o755);
    await writeFile(join(nestedHarness, 'src', 'conductor', 'src', 'intake-file-cli.ts'), '');

    const result = spawnSync(deepHelper, ['--title', 'Nested', '--body', 'body'], {
      cwd: caller, encoding: 'utf8', env: { CAPTURE: setup.capture, PATH: systemPath },
    });

    expect(result.status).toBe(0);
    expect((await capturedLines(setup.capture))[3]).toBe(
      join(setup.root, 'harness', 'src', 'conductor', 'src', 'intake-file-cli.ts'),
    );
  });

  it('falls back through a physically resolved ai-conductor PATH entry when no ancestor qualifies', async () => {
    const setup = await fixture();
    const caller = await setup.makeCaller('caller');
    const isolatedHelper = join(setup.root, 'outside', 'scripts', 'intake-file');
    const harnessCommand = join(setup.root, 'harness', 'bin', 'ai-conductor');
    await mkdir(dirname(isolatedHelper), { recursive: true });
    await mkdir(dirname(harnessCommand), { recursive: true });
    await copyFile(setup.helper, isolatedHelper);
    await chmod(isolatedHelper, 0o755);
    await writeFile(harnessCommand, '#!/usr/bin/env bash\n');
    await chmod(harnessCommand, 0o755);
    const pathDirectory = await makePathCommand(setup.root, harnessCommand);

    const result = spawnSync(isolatedHelper, ['--title', 'Fallback', '--body', 'body'], {
      cwd: caller, encoding: 'utf8', env: { CAPTURE: setup.capture, PATH: controlledPath(pathDirectory) },
    });

    expect(result.status).toBe(0);
    expect((await capturedLines(setup.capture))[3]).toBe(
      join(setup.root, 'harness', 'src', 'conductor', 'src', 'intake-file-cli.ts'),
    );
  });

  it('reports the walked-from helper and PATH result when neither candidate qualifies', async () => {
    const setup = await fixture();
    const caller = await setup.makeCaller('caller');
    const isolatedHelper = join(setup.root, 'outside', 'scripts', 'intake-file');
    const unqualifiedCommand = join(setup.root, 'unqualified', 'bin', 'ai-conductor');
    await mkdir(dirname(isolatedHelper), { recursive: true });
    await mkdir(dirname(unqualifiedCommand), { recursive: true });
    await copyFile(setup.helper, isolatedHelper);
    await chmod(isolatedHelper, 0o755);
    await writeFile(unqualifiedCommand, '#!/usr/bin/env bash\n');
    await chmod(unqualifiedCommand, 0o755);
    const pathDirectory = await makePathCommand(setup.root, unqualifiedCommand);

    const result = spawnSync(isolatedHelper, ['--title', 'Missing', '--body', 'body'], {
      cwd: caller, encoding: 'utf8', env: { CAPTURE: setup.capture, PATH: controlledPath(pathDirectory) },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(isolatedHelper);
    expect(result.stderr).toContain(join(pathDirectory, 'ai-conductor'));
    await expect(readFile(setup.capture, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports when ai-conductor is unavailable on PATH and runs no stub', async () => {
    const setup = await fixture();
    const caller = await setup.makeCaller('caller');
    const isolatedHelper = join(setup.root, 'outside', 'scripts', 'intake-file');
    await mkdir(dirname(isolatedHelper), { recursive: true });
    await copyFile(setup.helper, isolatedHelper);
    await chmod(isolatedHelper, 0o755);
    const pathDirectory = await makePathDirectory(setup.root);

    const result = spawnSync(isolatedHelper, ['--title', 'Missing', '--body', 'body'], {
      cwd: caller, encoding: 'utf8', env: { CAPTURE: setup.capture, PATH: controlledPath(pathDirectory) },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('no ai-conductor found on PATH');
    await expect(readFile(setup.capture, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves a non-zero engine exit, including a simulated issue-create failure', async () => {
    const setup = await fixture();
    const caller = await setup.makeCaller('caller');

    const result = spawnSync(setup.helper, ['--title', 'Failure', '--body', 'body'], {
      cwd: caller, encoding: 'utf8', env: {
        ...process.env, CAPTURE: setup.capture, STUB_FAILURE: 'issue-create', STUB_EXIT: '3',
      },
    });

    expect(result.status).toBe(3);
    expect(result.stderr).toContain('simulated issue-create failure');
  });

  it('keeps an unrelated caller directory when the helper is invoked relatively', async () => {
    const setup = await fixture();
    const caller = await setup.makeCaller('unrelated/caller');
    const relativeHelper = relative(caller, setup.helper);

    const result = spawnSync(relativeHelper, ['--title', 'Relative', '--body', 'body'], {
      cwd: caller, encoding: 'utf8', env: { ...process.env, CAPTURE: setup.capture },
    });

    expect(result.status).toBe(0);
    expect((await capturedLines(setup.capture))[0]).toBe(caller);
  });
});
