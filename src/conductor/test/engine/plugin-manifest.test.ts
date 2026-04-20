import { describe, it, expect } from 'vitest';
import { validateManifest, loadManifestFromFile, PluginManifestError } from '../../src/engine/plugin-manifest.js';
import { PluginVersionError } from '../../src/types/plugin.js';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('validateManifest', () => {
  describe('required fields', () => {
    it('throws PluginManifestError naming "entrypoint" when entrypoint is missing', () => {
      const manifest = {
        kind: 'llm_provider',
        name: 'test',
      };
      expect(() => validateManifest(manifest)).toThrow(PluginManifestError);
      expect(() => validateManifest(manifest)).toThrow(/entrypoint/);
    });

    it('throws PluginManifestError naming "kind" when kind is missing', () => {
      const manifest = {
        name: 'test',
        entrypoint: 'index.ts',
      };
      expect(() => validateManifest(manifest)).toThrow(PluginManifestError);
      expect(() => validateManifest(manifest)).toThrow(/kind/);
    });

    it('throws PluginManifestError naming "name" when name is missing', () => {
      const manifest = {
        kind: 'llm_provider',
        entrypoint: 'index.ts',
      };
      expect(() => validateManifest(manifest)).toThrow(PluginManifestError);
      expect(() => validateManifest(manifest)).toThrow(/name/);
    });

    it('returns PluginManifest when all required fields are present', () => {
      const manifest = {
        kind: 'llm_provider',
        name: 'test',
        entrypoint: 'index.ts',
      };
      const result = validateManifest(manifest);
      expect(result).toHaveProperty('kind', 'llm_provider');
      expect(result).toHaveProperty('name', 'test');
      expect(result).toHaveProperty('entrypoint', 'index.ts');
    });
  });

  describe('harness_version semver compatibility', () => {
    it('throws PluginVersionError when harness_version is incompatible with current harness', () => {
      const manifest = {
        kind: 'llm_provider',
        name: 'test',
        entrypoint: 'index.ts',
        harness_version: '^2.0.0',
      };
      try {
        validateManifest(manifest);
        expect.fail('Should have thrown PluginVersionError');
      } catch (err) {
        expect((err as any).name).toBe('PluginVersionError');
        expect(String(err)).toMatch(/2\.0\.0/);
        expect(String(err)).toMatch(/0\.99/);
      }
    });

    it('passes validation when harness_version is compatible (^0.99.0)', () => {
      const manifest = {
        kind: 'llm_provider',
        name: 'test',
        entrypoint: 'index.ts',
        harness_version: '^0.99.0',
      };
      const result = validateManifest(manifest);
      expect(result.harness_version).toBe('^0.99.0');
    });

    it('passes validation when harness_version is compatible (>=0.99.0 <1.0.0)', () => {
      const manifest = {
        kind: 'llm_provider',
        name: 'test',
        entrypoint: 'index.ts',
        harness_version: '>=0.99.0 <1.0.0',
      };
      const result = validateManifest(manifest);
      expect(result.harness_version).toBe('>=0.99.0 <1.0.0');
    });

    it('passes validation when harness_version is not specified', () => {
      const manifest = {
        kind: 'llm_provider',
        name: 'test',
        entrypoint: 'index.ts',
      };
      const result = validateManifest(manifest);
      expect(result).toBeDefined();
    });
  });

  describe('loadManifestFromFile', () => {
    it('throws PluginManifestError with file path when file is missing', () => {
      const missingPath = join(tmpdir(), 'nonexistent-manifest-12345.yml');
      expect(() => loadManifestFromFile(missingPath)).toThrow(PluginManifestError);
      try {
        loadManifestFromFile(missingPath);
        expect.fail('Should have thrown PluginManifestError');
      } catch (err) {
        expect(String(err)).toMatch(missingPath);
      }
    });

    it('throws PluginManifestError with file path and YAML error message for malformed YAML', () => {
      const tmpFile = join(tmpdir(), `malformed-${Date.now()}.yml`);
      const malformedYaml = `kind: [ unclosed`;
      writeFileSync(tmpFile, malformedYaml, 'utf-8');
      try {
        expect(() => loadManifestFromFile(tmpFile)).toThrow(PluginManifestError);
        try {
          loadManifestFromFile(tmpFile);
          expect.fail('Should have thrown PluginManifestError');
        } catch (err) {
          expect(String(err)).toMatch(tmpFile);
          expect(String(err)).toMatch(/unclosed|mapping/i);
        }
      } finally {
        unlinkSync(tmpFile);
      }
    });

    it('returns validated PluginManifest for valid YAML file', () => {
      const tmpFile = join(tmpdir(), `valid-${Date.now()}.yml`);
      const validYaml = `kind: llm_provider
name: test-plugin
entrypoint: index.ts`;
      writeFileSync(tmpFile, validYaml, 'utf-8');
      try {
        const result = loadManifestFromFile(tmpFile);
        expect(result.kind).toBe('llm_provider');
        expect(result.name).toBe('test-plugin');
        expect(result.entrypoint).toBe('index.ts');
      } finally {
        unlinkSync(tmpFile);
      }
    });

    it('returns validated PluginManifest with all fields from valid YAML file', () => {
      const tmpFile = join(tmpdir(), `complete-${Date.now()}.yml`);
      const validYaml = `kind: ui_renderer
name: my-renderer
entrypoint: src/index.ts
harness_version: ^0.99.0
capabilities:
  async: true`;
      writeFileSync(tmpFile, validYaml, 'utf-8');
      try {
        const result = loadManifestFromFile(tmpFile);
        expect(result.kind).toBe('ui_renderer');
        expect(result.name).toBe('my-renderer');
        expect(result.entrypoint).toBe('src/index.ts');
        expect(result.harness_version).toBe('^0.99.0');
        expect(result.capabilities?.async).toBe(true);
      } finally {
        unlinkSync(tmpFile);
      }
    });
  });
});
