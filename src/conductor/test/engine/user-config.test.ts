import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  readUserConfig,
  writeUserConfig,
  readLegacyJson,
} from '../../src/engine/user-config.js';

describe('user-config', () => {
  let dir: string;
  let cfgPath: string;
  let legacyPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'user-config-test-'));
    cfgPath = join(dir, 'config.yml');
    legacyPath = join(dir, 'legacy.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('readUserConfig', () => {
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

  describe('readLegacyJson', () => {
    it('returns null when legacy file missing', async () => {
      expect(await readLegacyJson(legacyPath)).toBeNull();
    });

    it('translates camelCase JSON fields to snake_case conductor block', async () => {
      await writeFile(
        legacyPath,
        JSON.stringify({
          updateChannel: 'tagged',
          autoCheck: true,
          currentVersion: 'v1.2.3',
          lastCheckedAt: '2026-04-18T00:00:00Z',
        }),
      );
      const result = await readLegacyJson(legacyPath);
      expect(result?.update_channel).toBe('tagged');
      expect(result?.auto_check).toBe(true);
      expect(result?.current_version).toBe('v1.2.3');
      expect(result?.last_checked_at).toBe('2026-04-18T00:00:00Z');
    });

    it('ignores unknown keys and invalid update_channel', async () => {
      await writeFile(
        legacyPath,
        JSON.stringify({
          updateChannel: 'unknown',
          random: 42,
        }),
      );
      const result = await readLegacyJson(legacyPath);
      expect(result?.update_channel).toBeUndefined();
    });

    it('returns null on invalid JSON', async () => {
      await writeFile(legacyPath, 'not json');
      expect(await readLegacyJson(legacyPath)).toBeNull();
    });
  });
});
