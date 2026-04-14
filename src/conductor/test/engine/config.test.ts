import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadConfig, validateConfig, type ConfigResult } from '../../src/engine/config.js';

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

    it('accepts config when harness version satisfies constraint', async () => {
      const configYaml = `harness_version: ">=1.0.0"\n`;
      await writeFile(join(tmpDir, '.harness', 'config.yml'), configYaml);

      const result = await loadConfig(tmpDir, '1.0.0');
      expect(result.ok).toBe(true);
    });

    it('rejects config when version too low', async () => {
      const configYaml = `harness_version: ">=2.0.0"\n`;
      await writeFile(join(tmpDir, '.harness', 'config.yml'), configYaml);

      const result = await loadConfig(tmpDir, '1.0.0');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe('version_mismatch');
      expect(result.error.message).toContain('1.0.0');
      expect(result.error.message).toContain('>=2.0.0');
    });

    it('parses valid .harness/config.yml and returns HarnessConfig', async () => {
      const configYaml = `
harness_version: ">=1.0.0"
steps:
  disable:
    - memory
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
      expect(result.config.steps?.disable).toEqual(['memory']);
      expect(result.config.skills?.overrides?.tdd).toBe('custom-tdd');
      expect(result.config.complexity?.default_tier).toBe('M');
      expect(result.warnings).toEqual([]);
    });
  });

  describe('validateConfig', () => {
    it('rejects steps.disable as string (not array)', () => {
      const result = validateConfig({
        steps: { disable: 'architecture-review' },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe('validation_error');
      expect(result.error.message).toContain('steps.disable must be an array');
    });

    it('rejects disabling gating step with error message', () => {
      const result = validateConfig({
        steps: { disable: ['stories'] },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe('validation_error');
      expect(result.error.message).toContain('stories');
      expect(result.error.message).toMatch(/gating/i);
    });

    it('rejects disabling structural step with error message', () => {
      const result = validateConfig({
        steps: { disable: ['build'] },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe('validation_error');
      expect(result.error.message).toContain('build');
    });

    it('warns on unknown step name in steps.disable', () => {
      const result = validateConfig({
        steps: { disable: ['nonexistent_step'] },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('nonexistent_step');
    });

    it('warns on unknown top-level keys but does not fail', () => {
      const result = validateConfig({
        harness_version: '>=1.0.0',
        unknown_key: 'value',
        another_unknown: 42,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings).toHaveLength(2);
      expect(result.warnings[0]).toContain('unknown_key');
      expect(result.warnings[1]).toContain('another_unknown');
    });
  });
});
