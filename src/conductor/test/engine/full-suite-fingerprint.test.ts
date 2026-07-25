import { afterEach, describe, expect, it } from 'vitest';
import {
  chmod,
  mkdir,
  mkdtemp,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { fingerprintFullSuiteInputs } from '../../src/engine/full-suite-fingerprint.js';

const execFile = promisify(execFileCallback);
const scratches: string[] = [];

async function git(repo: string, args: string[]): Promise<string> {
  const result = await execFile('git', args, { cwd: repo });
  return result.stdout.trim();
}

async function writeProjectFile(repo: string, path: string, content: string): Promise<void> {
  const destination = join(repo, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

async function makeRepo(files: Record<string, string>): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'full-suite-fingerprint-'));
  scratches.push(repo);
  await git(repo, ['init', '-q', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'test@example.com']);
  await git(repo, ['config', 'user.name', 'Test']);
  await git(repo, ['config', 'commit.gpgsign', 'false']);
  for (const [path, content] of Object.entries(files)) {
    await writeProjectFile(repo, path, content);
  }
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-q', '-m', 'initial']);
  return repo;
}

async function fingerprint(repo: string) {
  return fingerprintFullSuiteInputs({ projectRoot: repo });
}

afterEach(async () => {
  while (scratches.length > 0) {
    await rm(scratches.pop()!, { recursive: true, force: true });
  }
});

describe('fingerprintFullSuiteInputs', () => {
  it('is deterministic for unchanged tracked content', async () => {
    const repo = await makeRepo({ 'src/main.ts': 'export const value = 1;\n' });

    expect((await fingerprint(repo)).digest).toBe((await fingerprint(repo)).digest);
  });

  it('includes tracked file paths', async () => {
    const repo = await makeRepo({ 'src/old.ts': 'same content\n' });
    const before = await fingerprint(repo);

    await mkdir(join(repo, 'lib'), { recursive: true });
    await rename(join(repo, 'src/old.ts'), join(repo, 'lib/new.ts'));
    await git(repo, ['add', '-A']);

    expect((await fingerprint(repo)).digest).not.toBe(before.digest);
  });

  it('observes unstaged tracked-file edits', async () => {
    const repo = await makeRepo({ 'src/main.ts': 'export const value = 1;\n' });
    const before = await fingerprint(repo);

    await writeProjectFile(repo, 'src/main.ts', 'export const value = 2;\n');

    expect((await fingerprint(repo)).digest).not.toBe(before.digest);
  });

  it('observes staged tracked-file edits', async () => {
    const repo = await makeRepo({ 'src/main.ts': 'export const value = 1;\n' });
    const before = await fingerprint(repo);

    await writeProjectFile(repo, 'src/main.ts', 'export const value = 2;\n');
    await git(repo, ['add', 'src/main.ts']);

    expect((await fingerprint(repo)).digest).not.toBe(before.digest);
  });

  it('includes non-ignored untracked files', async () => {
    const repo = await makeRepo({ 'src/main.ts': 'export const value = 1;\n' });
    const before = await fingerprint(repo);

    await writeProjectFile(repo, 'test/new.test.ts', 'test("new", () => {});\n');

    expect((await fingerprint(repo)).digest).not.toBe(before.digest);
  });

  it('excludes ignored untracked files', async () => {
    const repo = await makeRepo({
      '.gitignore': '*.log\n',
      'src/main.ts': 'export const value = 1;\n',
    });
    const before = await fingerprint(repo);

    await writeProjectFile(repo, 'debug.log', 'ignored diagnostics\n');

    expect((await fingerprint(repo)).digest).toBe(before.digest);
  });

  it('distinguishes a tracked deletion from a path absent at HEAD', async () => {
    const repo = await makeRepo({
      'src/deleted.ts': 'delete me\n',
      'src/main.ts': 'keep me\n',
    });
    await unlink(join(repo, 'src/deleted.ts'));
    const deleted = await fingerprint(repo);

    await git(repo, ['add', '-u']);
    await git(repo, ['commit', '-q', '-m', 'remove deleted file']);

    expect((await fingerprint(repo)).digest).not.toBe(deleted.digest);
  });

  it('includes executable mode', async () => {
    const repo = await makeRepo({ 'bin/check': '#!/bin/sh\nexit 0\n' });
    await chmod(join(repo, 'bin/check'), 0o644);
    const nonExecutable = await fingerprint(repo);

    await chmod(join(repo, 'bin/check'), 0o755);

    expect((await fingerprint(repo)).digest).not.toBe(nonExecutable.digest);
  });

  it('is independent of file creation and enumeration order', async () => {
    const repo = await makeRepo({ 'src/main.ts': 'main\n' });
    await writeProjectFile(repo, 'z-last.txt.bin', 'last\n');
    await writeProjectFile(repo, 'a-first.txt.bin', 'first\n');
    const firstOrder = await fingerprint(repo);

    await unlink(join(repo, 'z-last.txt.bin'));
    await unlink(join(repo, 'a-first.txt.bin'));
    await writeProjectFile(repo, 'a-first.txt.bin', 'first\n');
    await writeProjectFile(repo, 'z-last.txt.bin', 'last\n');

    expect((await fingerprint(repo)).digest).toBe(firstOrder.digest);
  });

  it('records HEAD separately as provenance', async () => {
    const repo = await makeRepo({ 'src/main.ts': 'main\n' });

    expect((await fingerprint(repo)).headSha).toBe(await git(repo, ['rev-parse', 'HEAD']));
  });

  it('preserves the digest across SHA-only churn', async () => {
    const repo = await makeRepo({ 'src/main.ts': 'main\n' });
    const before = await fingerprint(repo);

    await git(repo, ['commit', '-q', '--allow-empty', '-m', 'sha churn']);
    const after = await fingerprint(repo);

    expect({ sameDigest: after.digest === before.digest, headChanged: after.headSha !== before.headSha })
      .toEqual({ sameDigest: true, headChanged: true });
  });

  it('preserves the digest across documentation-only changes', async () => {
    const repo = await makeRepo({
      '.docs/specs/feature.md': 'original spec\n',
      'CHANGELOG.md': '# Changelog\n',
      'README.md': '# Project\n',
      'src/main.ts': 'main\n',
    });
    const before = await fingerprint(repo);

    await writeProjectFile(repo, '.docs/specs/feature.md', 'updated spec\n');
    await writeProjectFile(repo, 'CHANGELOG.md', '# Updated changelog\n');
    await writeProjectFile(repo, 'README.md', '# Updated project\n');

    expect((await fingerprint(repo)).digest).toBe(before.digest);
  });
});
