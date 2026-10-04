// Covers: task:1

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import {
  readUserConfig,
  userConfigPath,
  writeUserConfig,
} from '../../src/engine/user-config.js';

describe('user-config', () => {
  let dir: string;
  let cfgPath: string;
  let originalUserConfigDir: string | undefined;
  let originalHome: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'user-config-test-'));
    cfgPath = join(dir, 'config.yml');
    originalUserConfigDir = process.env.AI_CONDUCTOR_USER_CONFIG_DIR;
    originalHome = process.env.HOME;
  });

  afterEach(async () => {
    if (originalUserConfigDir === undefined) {
      delete process.env.AI_CONDUCTOR_USER_CONFIG_DIR;
    } else {
      process.env.AI_CONDUCTOR_USER_CONFIG_DIR = originalUserConfigDir;
    }
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await rm(dir, { recursive: true, force: true });
  });

  describe('userConfigPath', () => {
    it('uses a non-empty user-config directory override by default', () => {
      const override = join(dir, 'override');
      process.env.AI_CONDUCTOR_USER_CONFIG_DIR = override;

      expect(userConfigPath()).toBe(join(override, 'config.yml'));
    });

    it.each([undefined, '', '   '])(
      'uses the home default when the override is %j',
      (override) => {
        if (override === undefined) {
          delete process.env.AI_CONDUCTOR_USER_CONFIG_DIR;
        } else {
          process.env.AI_CONDUCTOR_USER_CONFIG_DIR = override;
        }

        expect(userConfigPath()).toBe(join(homedir(), '.ai-conductor', 'config.yml'));
      },
    );

    it('gives an explicit home argument precedence over the override', () => {
      process.env.AI_CONDUCTOR_USER_CONFIG_DIR = join(dir, 'override');
      const explicitHome = join(dir, 'explicit-home');

      expect(userConfigPath(explicitHome)).toBe(join(explicitHome, '.ai-conductor', 'config.yml'));
    });
  });

  describe('readUserConfig', () => {
    it('treats a missing override config as empty without falling back to HOME', async () => {
      const override = join(dir, 'override-without-config');
      const plantedHome = join(dir, 'planted-home');
      process.env.AI_CONDUCTOR_USER_CONFIG_DIR = override;
      process.env.HOME = plantedHome;
      const plantedConfig = join(plantedHome, '.ai-conductor', 'config.yml');
      await writeUserConfig({ conductor: { update_channel: 'main' } }, plantedConfig);

      await expect(readUserConfig()).resolves.toEqual({ config: {}, existed: false });
    });

    it('returns empty config when file missing', async () => {
      const result = await readUserConfig(cfgPath);
      expect(result.existed).toBe(false);
      expect(result.config).toEqual({});
    });

    it('parses a valid YAML file', async () => {
      await writeFile(
        cfgPath,
        'conductor:\n  update_channel: tagged\nmarkdown_viewer:\n  preset: glow\n  command: glow\n  args: ["-p", "-w", "80", "{file}"]\n  mode: inline\n',
      );
      const result = await readUserConfig(cfgPath);
      expect(result.existed).toBe(true);
      expect(result.parseError).toBeUndefined();
      expect(result.config.conductor?.update_channel).toBe('tagged');
      expect(result.config.markdown_viewer?.preset).toBe('glow');
    });

    it('returns parseError on malformed YAML', async () => {
      await writeFile(cfgPath, 'bad: yaml:\n  : broken\n');
      const result = await readUserConfig(cfgPath);
      expect(result.parseError).toBeDefined();
      expect(result.config).toEqual({});
    });

    it('returns empty config on empty file', async () => {
      await writeFile(cfgPath, '');
      const result = await readUserConfig(cfgPath);
      expect(result.existed).toBe(true);
      expect(result.config).toEqual({});
    });

    it('rejects array root with parseError', async () => {
      await writeFile(cfgPath, '- one\n- two\n');
      const result = await readUserConfig(cfgPath);
      expect(result.parseError).toMatch(/mapping/i);
    });
  });

  describe('writeUserConfig', () => {
    it('creates parent directory and writes YAML', async () => {
      const nested = join(dir, 'nested', 'config.yml');
      await writeUserConfig(
        {
          markdown_viewer: {
            preset: 'code',
            command: 'code',
            args: ['--wait', '{file}'],
            mode: 'blocking',
          },
        },
        nested,
      );
      const text = await readFile(nested, 'utf-8');
      expect(text).toContain('markdown_viewer');
      expect(text).toContain('code');
      expect(text).toContain('blocking');
    });

    it('round-trips through readUserConfig', async () => {
      await writeUserConfig(
        {
          conductor: { update_channel: 'main', auto_check: false },
        },
        cfgPath,
      );
      const result = await readUserConfig(cfgPath);
      expect(result.config.conductor?.update_channel).toBe('main');
      expect(result.config.conductor?.auto_check).toBe(false);
    });
  });
});
