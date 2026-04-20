import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { discoverPlugins } from '../../src/engine/plugin-loader.js';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('discoverPlugins', () => {
  let registry: PluginRegistry;
  let globalDir: string;
  let projectDir: string;

  beforeEach(() => {
    registry = new PluginRegistry();
    globalDir = mkdtempSync(join(tmpdir(), 'plugin-global-'));
    projectDir = mkdtempSync(join(tmpdir(), 'plugin-project-'));
  });

  afterEach(() => {
    rmSync(globalDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  describe('happy path: global plugin discovery', () => {
    it('discovers and registers a plugin from globalDir', async () => {
      const pluginDir = join(globalDir, 'my-provider');
      mkdirSync(pluginDir);
      const manifestPath = join(pluginDir, 'plugin.yml');
      writeFileSync(
        manifestPath,
        `kind: llm_provider
name: my-provider
entrypoint: index.ts`
      );

      // Mock the import() to avoid actually loading the plugin
      const mockInstance = { name: 'my-provider-instance' };
      vi.doMock(join(pluginDir, 'index.ts'), () => mockInstance, { virtual: true });

      await discoverPlugins(globalDir, projectDir, registry);

      // After discovery, registry should have the plugin registered
      registry.markInitialized();
      const retrieved = registry.get('llm_provider', 'my-provider');
      expect(retrieved).toBeDefined();
    });
  });

  describe('happy path: project-local plugin discovery', () => {
    it('discovers and registers a plugin from projectDir', async () => {
      const pluginDir = join(projectDir, 'project-provider');
      mkdirSync(pluginDir);
      const manifestPath = join(pluginDir, 'plugin.yml');
      writeFileSync(
        manifestPath,
        `kind: llm_provider
name: project-provider
entrypoint: index.ts`
      );

      await discoverPlugins(globalDir, projectDir, registry);

      registry.markInitialized();
      const retrieved = registry.get('llm_provider', 'project-provider');
      expect(retrieved).toBeDefined();
    });
  });

  describe('happy path: shadowing precedence', () => {
    it('registers project-local plugin over global plugin with same kind and name', async () => {
      // Global plugin
      const globalPluginDir = join(globalDir, 'my-provider');
      mkdirSync(globalPluginDir);
      writeFileSync(
        join(globalPluginDir, 'plugin.yml'),
        `kind: llm_provider
name: my-provider
entrypoint: index.ts`
      );

      // Project-local plugin with same kind+name
      const projectPluginDir = join(projectDir, 'my-provider');
      mkdirSync(projectPluginDir);
      writeFileSync(
        join(projectPluginDir, 'plugin.yml'),
        `kind: llm_provider
name: my-provider
entrypoint: index.ts`
      );

      const spy = vi.spyOn(console, 'debug');
      await discoverPlugins(globalDir, projectDir, registry);

      // Verify debug log was emitted for shadowing
      expect(spy).toHaveBeenCalledWith(expect.stringMatching(/llm_provider/));
      expect(spy).toHaveBeenCalledWith(expect.stringMatching(/my-provider/));

      spy.mockRestore();
    });
  });

  describe('happy path: missing directories', () => {
    it('does not throw error when globalDir does not exist', async () => {
      const nonExistentGlobal = join(tmpdir(), 'nonexistent-global-12345');
      await expect(discoverPlugins(nonExistentGlobal, projectDir, registry)).resolves.not.toThrow();
    });

    it('does not throw error when projectDir does not exist', async () => {
      const nonExistentProject = join(tmpdir(), 'nonexistent-project-12345');
      await expect(discoverPlugins(globalDir, nonExistentProject, registry)).resolves.not.toThrow();
    });

    it('does not throw error when both directories do not exist', async () => {
      const nonExistentGlobal = join(tmpdir(), 'nonexistent-global-12345');
      const nonExistentProject = join(tmpdir(), 'nonexistent-project-12345');
      await expect(discoverPlugins(nonExistentGlobal, nonExistentProject, registry)).resolves.not.toThrow();
    });
  });

  describe('happy path: mixed plugins', () => {
    it('registers one plugin from global and one from project without shadowing', async () => {
      // Global plugin (llm_provider kind)
      const globalPluginDir = join(globalDir, 'global-provider');
      mkdirSync(globalPluginDir);
      writeFileSync(
        join(globalPluginDir, 'plugin.yml'),
        `kind: llm_provider
name: global-provider
entrypoint: index.ts`
      );

      // Project plugin (ui_renderer kind) - different kind, no shadowing
      const projectPluginDir = join(projectDir, 'project-renderer');
      mkdirSync(projectPluginDir);
      writeFileSync(
        join(projectPluginDir, 'plugin.yml'),
        `kind: ui_renderer
name: project-renderer
entrypoint: index.ts`
      );

      await discoverPlugins(globalDir, projectDir, registry);

      registry.markInitialized();
      expect(registry.list('llm_provider')).toContain('global-provider');
      expect(registry.list('ui_renderer')).toContain('project-renderer');
    });
  });
});
