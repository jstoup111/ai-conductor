import { lstat, readdir } from 'node:fs/promises';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProviderHomeProvisionError } from '../../src/engine/self-host/provider-home.js';
import { provisionLiveProviderHome } from './live-provider-home.js';

describe('provisionLiveProviderHome', () => {
  it('copies skills from the explicit source root into a Claude provider home', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'live-provider-home-source-'));
    const skillsDir = join(sourceRoot, 'skills');

    try {
      await mkdir(join(skillsDir, 'pipeline'), { recursive: true });
      await writeFile(join(skillsDir, 'pipeline', 'SKILL.md'), '# Pipeline\n');

      const home = await provisionLiveProviderHome(sourceRoot);
      try {
        expect(home.childEnv().CLAUDE_CONFIG_DIR).toBe(home.homeDir);
        await expect(
          lstat(join(home.homeDir, 'skills', 'pipeline', 'SKILL.md')),
        ).resolves.toBeDefined();
        const copiedSkills = await lstat(join(home.homeDir, 'skills'));
        expect(copiedSkills.isDirectory()).toBe(true);
        expect(copiedSkills.isSymbolicLink()).toBe(false);
      } finally {
        await home.teardown();
      }
    } finally {
      await rm(sourceRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when the explicit source root has no skills directory', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'live-provider-home-no-skills-'));
    const homesRoot = await mkdtemp(join(tmpdir(), 'live-provider-home-homes-'));

    try {
      const error = await provisionLiveProviderHome(
        sourceRoot,
        undefined,
        homesRoot,
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ProviderHomeProvisionError);
      expect(error).toMatchObject({
        message: expect.stringContaining(`'skills' at ${join(sourceRoot, 'skills')}`),
      });
      expect(await readdir(homesRoot)).toEqual([]);
    } finally {
      await rm(sourceRoot, { recursive: true, force: true });
      await rm(homesRoot, { recursive: true, force: true });
    }
  });
});
