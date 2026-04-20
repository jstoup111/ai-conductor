import { describe, it, expect } from 'vitest';
import { validateManifest, PluginManifestError } from '../../src/engine/plugin-manifest.js';
import { PluginVersionError } from '../../src/types/plugin.js';

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
});
