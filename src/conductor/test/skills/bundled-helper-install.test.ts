import { spawnSync } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const harnessRoot = resolve(process.cwd(), '../..');
const installer = join(harnessRoot, 'bin', 'install');
const temporaryRoots: string[] = [];

async function makeToolStubs(root: string): Promise<string> {
  const stubs = join(root, 'stubs');
  await mkdir(stubs, { recursive: true });
  await Promise.all([
    writeFile(join(stubs, 'node'), '#!/usr/bin/env bash\nprintf \'v26.0.0\\n\'\n'),
    writeFile(join(stubs, 'npm'), '#!/usr/bin/env bash\nexit 0\n'),
    ...['rtk', 'claude', 'codex', 'uv'].map((tool) =>
      writeFile(join(stubs, tool), '#!/usr/bin/env bash\nexit 0\n'),
    ),
  ]);
  await Promise.all(['node', 'npm', 'rtk', 'claude', 'codex', 'uv'].map((tool) => chmod(join(stubs, tool), 0o755)));
  return stubs;
}

function runInstall(home: string, stubs: string, args: string[]) {
  return spawnSync('timeout', ['15s', installer, ...args, '--allow-worktree-root'], {
    cwd: harnessRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      PATH: `${stubs}:${join(home, '.local', 'bin')}:/usr/bin:/bin`,
    },
  });
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('bundled intake helper installation', () => {
  it('keeps the helper executable through both installed provider catalogs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bundled-helper-install-'));
    temporaryRoots.push(root);
    const home = join(root, 'home');
    const stubs = await makeToolStubs(root);

    const install = runInstall(home, stubs, ['--update', '--providers', 'claude,codex']);
    expect(install.status, install.stderr).toBe(0);

    for (const providerPath of [
      join(home, '.claude', 'skills', 'intake', 'scripts', 'intake-file'),
      join(home, '.agents', 'skills', 'intake', 'scripts', 'intake-file'),
    ]) {
      await expect(access(providerPath, constants.X_OK)).resolves.toBeUndefined();
    }

    const check = runInstall(home, stubs, ['--check', '--providers', 'claude,codex']);
    expect(check.status, `${check.stdout}\n${check.stderr}`).toBe(0);
    expect(`${check.stdout}\n${check.stderr}`).not.toMatch(/(?:stale|drift).*intake|intake.*(?:stale|drift)/i);
  });
});
