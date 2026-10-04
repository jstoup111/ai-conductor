// Covers: task:3
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { userConfigReadCommand, userConfigSetCommand } from '../src/cli.js';

describe.sequential('CLI user-config run isolation', () => {
  let home: string;
  let scoped: string;
  const originalHome = process.env.HOME;
  const originalScoped = process.env.AI_CONDUCTOR_USER_CONFIG_DIR;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'cli-user-home-'));
    scoped = await mkdtemp(join(tmpdir(), 'cli-user-scoped-'));
    await mkdir(join(home, '.ai-conductor'), { recursive: true });
    await writeFile(join(home, '.ai-conductor', 'config.yml'), 'spec_owner: home-owner\n', 'utf8');
    process.env.HOME = home;
    process.env.AI_CONDUCTOR_USER_CONFIG_DIR = scoped;
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
    if (originalScoped === undefined) delete process.env.AI_CONDUCTOR_USER_CONFIG_DIR;
    else process.env.AI_CONDUCTOR_USER_CONFIG_DIR = originalScoped;
    await Promise.all([rm(home, { recursive: true, force: true }), rm(scoped, { recursive: true, force: true })]);
  });

  it('writes and reads through the run-scoped location without touching HOME', async () => {
    expect(await userConfigSetCommand({ kind: 'user-config-set', path: 'spec_owner', value: 'run-owner' })).toBe(0);
    let output = '';
    expect(await userConfigReadCommand({ kind: 'user-config-read', path: 'spec_owner' }, (value) => { output += value; })).toBe(0);

    expect(output).toBe('run-owner\n');
    expect(await readFile(join(scoped, 'config.yml'), 'utf8')).toContain('run-owner');
    expect(await readFile(join(home, '.ai-conductor', 'config.yml'), 'utf8')).toBe('spec_owner: home-owner\n');
  });
});
