/**
 * Covers: S1.1, S1.2, S1.3, S1.4, task:2
 *
 * Acceptance coverage for the v1.0 CLI cutover. The test starts from the
 * operator-visible legacy installation, runs the real installer, and invokes
 * the resulting `conduct` entrypoint. npm and the selected provider are local
 * deterministic fakes; the installer, launcher, and built TS CLI are real.
 */

import { spawnSync } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const INSTALLER = join(REPO_ROOT, 'bin', 'install');
const CANONICAL_LAUNCHER = join(REPO_ROOT, 'bin', 'ai-conductor');

describe('acceptance: conduct migrates onto the only TS CLI', () => {
  let scratch: string;
  let home: string;
  let fakeBin: string;
  let localBin: string;
  let conduct: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'v1-cli-cutover-'));
    home = join(scratch, 'home');
    fakeBin = join(scratch, 'fake-bin');
    localBin = join(home, '.local', 'bin');
    conduct = join(localBin, 'conduct');
    await Promise.all([
      mkdir(fakeBin, { recursive: true }),
      mkdir(localBin, { recursive: true }),
    ]);

    const npm = join(fakeBin, 'npm');
    const codex = join(fakeBin, 'codex');
    const mktemp = join(fakeBin, 'mktemp');
    await writeFile(
      npm,
      '#!/usr/bin/env bash\ncase "${1:-}" in ci|list) exit 0 ;; run) [ "${2:-}" = build ] ;; *) exit 0 ;; esac\n',
      'utf8',
    );
    await writeFile(codex, '#!/usr/bin/env bash\nprintf \'codex-test-double 1.0.0\\n\'\n', 'utf8');
    await writeFile(
      mktemp,
      '#!/usr/bin/env bash\nif [ "$#" -eq 0 ]; then exec /usr/bin/mktemp "${TMPDIR:?}/installer.XXXXXX"; fi\nexec /usr/bin/mktemp "$@"\n',
      'utf8',
    );
    await Promise.all([chmod(npm, 0o755), chmod(codex, 0o755), chmod(mktemp, 0o755)]);

    await symlink(join(scratch, 'legacy-conduct'), conduct);
    env = {
      ...process.env,
      HOME: home,
      PATH: `${fakeBin}${delimiter}${localBin}${delimiter}${process.env.PATH ?? '/usr/bin:/bin'}`,
      TMPDIR: scratch,
      TMP: scratch,
      TEMP: scratch,
    };
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('replaces a legacy install and dispatches help through the TS launcher with one warning', async () => {
    expect(await readlink(conduct)).toBe(join(scratch, 'legacy-conduct'));

    const install = spawnSync(
      INSTALLER,
      ['--update', '--providers', 'codex', '--allow-worktree-root'],
      { env, encoding: 'utf8', timeout: 20_000 },
    );

    expect(install.status, install.stderr).toBe(0);
    expect(install.stdout).toContain('Updated conduct script symlink');
    expect(await readlink(conduct)).toBe(CANONICAL_LAUNCHER);

    const firstLink = await lstat(conduct);
    const secondInstall = spawnSync(
      INSTALLER,
      ['--update', '--providers', 'codex', '--allow-worktree-root'],
      { env, encoding: 'utf8', timeout: 20_000 },
    );
    const secondLink = await lstat(conduct);

    expect(secondInstall.status, secondInstall.stderr).toBe(0);
    expect(secondInstall.stdout).toContain('conduct script already current');
    expect(secondLink.ino).toBe(firstLink.ino);

    const help = spawnSync(conduct, ['--help'], {
      env,
      encoding: 'utf8',
      timeout: 10_000,
    });

    expect(help.status, help.stderr).toBe(0);
    expect(help.stdout).toMatch(/Usage:\s+ai-conductor/i);
    expect(help.stderr.split('\n').filter((line) => line === 'conduct is deprecated; use ai-conductor instead')).toHaveLength(1);
  });
});
