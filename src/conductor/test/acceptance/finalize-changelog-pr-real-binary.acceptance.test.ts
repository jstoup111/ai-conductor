/**
 * RED acceptance specs for changelog implementation-PR finalization.
 *
 * Story: Finalize the changelog link without weakening finish.
 *
 * The tests spawn the real conduct-ts binary. This proves argv dispatch reaches
 * the finalizer and changes the real filesystem; direct unit coverage cannot
 * detect an unwired production command.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

const REPO_ROOT = join(process.cwd(), '..', '..');
const REAL_CONDUCT_TS = join(REPO_ROOT, 'bin', 'conduct-ts');
const PR_URL = 'https://github.com/acme/conductor/pull/42';

describe('conduct-ts finalize-changelog-pr — real-binary flow', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'finalize-changelog-pr-'));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('replaces the one implementation token with the canonical GitHub PR link', async () => {
    const changelog =
      '## [Unreleased]\n\n' +
      '- Add a repository-local documentation gate ({{IMPLEMENTATION_PR}}).\n';
    await writeFile(join(cwd, 'CHANGELOG.md'), changelog, 'utf-8');

    const result = await execa(
      REAL_CONDUCT_TS,
      ['finalize-changelog-pr', '--pr-url', PR_URL],
      { cwd, reject: false, timeout: 10_000 },
    );

    expect(result.exitCode).toBe(0);
    expect(await readFile(join(cwd, 'CHANGELOG.md'), 'utf-8')).toBe(
      '## [Unreleased]\n\n' +
        '- Add a repository-local documentation gate ' +
        '([implementation PR #42](https://github.com/acme/conductor/pull/42)).\n',
    );
  }, 20_000);

  it('refuses duplicate tokens without changing either byte', async () => {
    const changelog =
      '## [Unreleased]\n\n' +
      '- Add one behavior ({{IMPLEMENTATION_PR}}).\n' +
      '- Add another behavior ({{IMPLEMENTATION_PR}}).\n';
    await writeFile(join(cwd, 'CHANGELOG.md'), changelog, 'utf-8');

    const result = await execa(
      REAL_CONDUCT_TS,
      ['finalize-changelog-pr', '--pr-url', PR_URL],
      { cwd, reject: false, timeout: 10_000 },
    );

    expect(result.exitCode).not.toBe(0);
    expect(await readFile(join(cwd, 'CHANGELOG.md'), 'utf-8')).toBe(changelog);
  }, 20_000);

  it('refuses malformed use without launching a feature pipeline', async () => {
    const result = await execa(REAL_CONDUCT_TS, ['finalize-changelog-pr'], {
      cwd,
      reject: false,
      timeout: 10_000,
    });

    expect(result.exitCode).not.toBe(0);
    expect(await readdir(cwd)).toEqual([]);
  }, 20_000);
});
