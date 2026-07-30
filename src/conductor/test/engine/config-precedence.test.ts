import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const userConfigFixture = vi.hoisted(() => ({ path: '' }));

vi.mock('../../src/engine/user-config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/user-config.js')>();
  return {
    ...actual,
    readUserConfig: (path?: string) => actual.readUserConfig(path ?? userConfigFixture.path),
  };
});

import { loadMergedConfig } from '../../src/engine/config.js';

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  userConfigFixture.path = '';
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('loadMergedConfig precedence', () => {
  it('preserves a user-only non-default value when the project omits it', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'config-precedence-project-'));
    const isolatedHome = await mkdtemp(join(tmpdir(), 'config-precedence-home-'));
    tempDirs.push(projectRoot, isolatedHome);

    await mkdir(join(projectRoot, '.ai-conductor'), { recursive: true });
    await writeFile(join(projectRoot, '.ai-conductor', 'config.yml'), '{}\n', 'utf8');

    userConfigFixture.path = join(isolatedHome, '.ai-conductor', 'config.yml');
    await mkdir(join(isolatedHome, '.ai-conductor'), { recursive: true });
    await writeFile(
      userConfigFixture.path,
      'auto_restart_on_stale_engine: true\n',
      'utf8',
    );

    const result = await loadMergedConfig(projectRoot);

    expect(
      result.ok ? result.config.auto_restart_on_stale_engine : result,
    ).toBe(true);
  });
});
