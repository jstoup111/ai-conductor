import { afterEach, describe, expect, it } from 'vitest';
import {
  chmod,
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { fingerprintFullSuiteInputs } from '../../src/engine/full-suite-fingerprint.js';
import type { TestSuiteConfig } from '../../src/types/config.js';

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

const DEFAULT_TEST_SUITE: TestSuiteConfig = {
  command: 'npm test',
  working_directory: '.',
  timeout_seconds: 1800,
};

async function fingerprintResult(
  repo: string,
  testSuite: TestSuiteConfig = DEFAULT_TEST_SUITE,
  environmentValues: NodeJS.ProcessEnv = {},
  fileHasher?: (path: string) => Promise<string>,
) {
  return fingerprintFullSuiteInputs({
    projectRoot: repo,
    testSuite,
    environmentValues,
    fileHasher,
  });
}

async function fingerprint(
  repo: string,
  testSuite: TestSuiteConfig = DEFAULT_TEST_SUITE,
  environmentValues: NodeJS.ProcessEnv = {},
) {
  const result = await fingerprintResult(repo, testSuite, environmentValues);
  if (!result.ok) {
    throw new Error(`Unexpected indeterminate fingerprint: ${result.reason.code}`);
  }
  return result.fingerprint;
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

  it('includes every normalized test_suite execution field', async () => {
    const repo = await makeRepo({
      'config/extra.bin': 'config\n',
      'src/main.ts': 'main\n',
    });
    const baseline = await fingerprint(repo);
    const changed = await Promise.all([
      fingerprint(repo, { ...DEFAULT_TEST_SUITE, command: 'npm run test:all' }),
      fingerprint(repo, { ...DEFAULT_TEST_SUITE, working_directory: 'src' }),
      fingerprint(repo, { ...DEFAULT_TEST_SUITE, timeout_seconds: 900 }),
      fingerprint(repo, { ...DEFAULT_TEST_SUITE, inputs: ['config/extra.bin'] }),
      fingerprint(repo, { ...DEFAULT_TEST_SUITE, environment: ['CI'] }),
    ]);

    expect(changed.every((entry) => entry.digest !== baseline.digest)).toBe(true);
  });

  it.each([
    ['package-lock.json', '{"lockfileVersion": 3}\n', '{"lockfileVersion": 4}\n'],
    ['db/migrations/001.sql', 'CREATE TABLE one;\n', 'CREATE TABLE two;\n'],
    ['test/setup.ts', 'export const setup = 1;\n', 'export const setup = 2;\n'],
  ])('invalidates when broad tracked input %s changes', async (path, before, after) => {
    const repo = await makeRepo({ [path]: before, 'src/main.ts': 'main\n' });
    const baseline = await fingerprint(repo);

    await writeProjectFile(repo, path, after);

    expect((await fingerprint(repo)).digest).not.toBe(baseline.digest);
  });

  it('includes declared ignored input content', async () => {
    const repo = await makeRepo({
      '.gitignore': 'private/*.bin\n',
      'src/main.ts': 'main\n',
    });
    await writeProjectFile(repo, 'private/state.bin', 'first\n');
    const config = { ...DEFAULT_TEST_SUITE, inputs: ['private/*.bin'] };
    const before = await fingerprint(repo, config);

    await writeProjectFile(repo, 'private/state.bin', 'second\n');

    expect((await fingerprint(repo, config)).digest).not.toBe(before.digest);
  });

  it('normalizes declaration and glob expansion ordering', async () => {
    const repo = await makeRepo({
      '.gitignore': 'fixtures/\n',
      'src/main.ts': 'main\n',
    });
    await writeProjectFile(repo, 'fixtures/a.bin', 'a\n');
    await writeProjectFile(repo, 'fixtures/z.bin', 'z\n');
    const forward = await fingerprint(repo, {
      ...DEFAULT_TEST_SUITE,
      inputs: ['fixtures/a.bin', 'fixtures/*.bin'],
      environment: ['BETA', 'ALPHA'],
    });
    const reverse = await fingerprint(repo, {
      ...DEFAULT_TEST_SUITE,
      inputs: ['fixtures/*.bin', 'fixtures/a.bin'],
      environment: ['ALPHA', 'BETA'],
    });

    expect(reverse.digest).toBe(forward.digest);
  });

  it('distinguishes set, changed, and unset declared environment values', async () => {
    const repo = await makeRepo({ 'src/main.ts': 'main\n' });
    const config = { ...DEFAULT_TEST_SUITE, environment: ['SUITE_SECRET'] };
    const first = await fingerprint(repo, config, { SUITE_SECRET: 'alpha' });
    const changed = await fingerprint(repo, config, { SUITE_SECRET: 'beta' });
    const unset = await fingerprint(repo, config, {});

    expect(new Set([first.digest, changed.digest, unset.digest]).size).toBe(3);
  });

  it('treats inherited object properties as unset environment names', async () => {
    const repo = await makeRepo({ 'src/main.ts': 'main\n' });
    const config = { ...DEFAULT_TEST_SUITE, environment: ['toString'] };
    const unset = await fingerprintResult(repo, config, {});
    const set = await fingerprintResult(
      repo,
      config,
      { toString: 'declared-value' } as unknown as NodeJS.ProcessEnv,
    );

    expect({
      unsetOk: unset.ok,
      setOk: set.ok,
      digestChanged:
        unset.ok && set.ok && unset.fingerprint.digest !== set.fingerprint.digest,
    }).toEqual({ unsetOk: true, setOk: true, digestChanged: true });
  });

  it('never returns declared environment values in plaintext', async () => {
    const repo = await makeRepo({ 'src/main.ts': 'main\n' });
    const secret = 'do-not-store-this-secret';
    const result = await fingerprintResult(
      repo,
      { ...DEFAULT_TEST_SUITE, environment: ['SUITE_SECRET'] },
      { SUITE_SECRET: secret },
    );

    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('returns typed indeterminate for a missing declared input', async () => {
    const repo = await makeRepo({ 'src/main.ts': 'main\n' });

    const result = await fingerprintResult(repo, {
      ...DEFAULT_TEST_SUITE,
      inputs: ['missing/*.bin'],
    });

    expect(result).toMatchObject({
      ok: false,
      reason: { code: 'missing_input', path: 'missing/*.bin' },
    });
  });

  it('returns typed indeterminate for a root-escaping declared input', async () => {
    const repo = await makeRepo({ 'src/main.ts': 'main\n' });

    const result = await fingerprintResult(repo, {
      ...DEFAULT_TEST_SUITE,
      inputs: ['../outside.bin'],
    });

    expect(result).toMatchObject({
      ok: false,
      reason: { code: 'invalid_input', path: '../outside.bin' },
    });
  });

  it('returns typed indeterminate when a glob root symlink escapes the project', async () => {
    const repo = await makeRepo({ 'src/main.ts': 'main\n' });
    const outside = await mkdtemp(join(tmpdir(), 'full-suite-fingerprint-outside-'));
    scratches.push(outside);
    await writeProjectFile(outside, 'nested/secret.bin', 'outside\n');
    await symlink(outside, join(repo, 'linked'));

    const result = await fingerprintResult(repo, {
      ...DEFAULT_TEST_SUITE,
      inputs: ['linked/nested/*.bin'],
    });

    expect(result).toMatchObject({
      ok: false,
      reason: { code: 'invalid_input', path: 'linked/nested/*.bin' },
    });
  });

  it('returns typed indeterminate when a required input cannot be hashed', async () => {
    const repo = await makeRepo({
      '.gitignore': 'private.bin\n',
      'src/main.ts': 'main\n',
    });
    await writeProjectFile(repo, 'private.bin', 'unreadable\n');

    const result = await fingerprintResult(
      repo,
      { ...DEFAULT_TEST_SUITE, inputs: ['private.bin'] },
      {},
      async (path) => {
        if (path.endsWith('private.bin')) {
          throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
        }
        return 'injected-content-digest';
      },
    );

    expect(result).toMatchObject({
      ok: false,
      reason: { code: 'input_read_failed', path: 'private.bin' },
    });
  });
});
