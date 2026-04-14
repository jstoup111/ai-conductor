import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadConfig, validateConfig } from '../../src/engine/config.js';

describe('config', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'config-test-'));
    await mkdir(join(tmpDir, '.harness'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('loadConfig', () => {
    it('returns error with migration message when config missing', async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), 'config-missing-'));
      try {
        const result = await loadConfig(emptyDir);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.type).toBe('missing');
        expect(result.error.message).toContain('Run bin/migrate');
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    });

    it('reports parse error with line number for malformed YAML', async () => {
      const badYaml = `harness_version: ">=1.0.0"
steps:
  disable:
    - valid
  bad_indent
    : broken
`;
      await writeFile(join(tmpDir, '.harness', 'config.yml'), badYaml);

      const result = await loadConfig(tmpDir);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe('parse_error');
      expect(result.error.message).toMatch(/line \d+/i);
    });

    it('parses valid .harness/config.yml and returns HarnessConfig', async () => {
      const configYaml = `
harness_version: ">=1.0.0"
steps:
  disable:
    - architecture-review
skills:
  overrides:
    tdd: custom-tdd
complexity:
  default_tier: M
`;
      await writeFile(join(tmpDir, '.harness', 'config.yml'), configYaml);

      const result = await loadConfig(tmpDir, '1.0.0');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.harness_version).toBe('>=1.0.0');
      expect(result.config.steps?.disable).toEqual(['architecture-review']);
      expect(result.config.skills?.overrides?.tdd).toBe('custom-tdd');
      expect(result.config.complexity?.default_tier).toBe('M');
      expect(result.warnings).toEqual([]);
    });
  });
});
