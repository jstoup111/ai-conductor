import { describe, it, expect } from 'vitest';
import { discoverPlugins } from '../../src/engine/plugin-loader.js';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { join } from 'path';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, cpSync } from 'fs';
import { tmpdir } from 'os';
import { readFileSync } from 'fs';

/**
 * Task 5: Integration test — plugin loader discovers json-stdout-subscriber
 * from the plugins/ directory and registers it as ui_renderer:json-stdout.
 *
 * Also verifies: JsonStdoutSubscriber is NOT imported directly in index.ts
 * (the plugin loader handles discovery, not hardcoded imports).
 */

// Path to the json-stdout-subscriber plugin source
const PLUGIN_SRC_DIR = join(
  new URL('../../../../plugins/json-stdout-subscriber', import.meta.url).pathname
);

describe('json-stdout-subscriber plugin discovery', () => {
  it('discovers and registers json-stdout plugin from plugins/ directory', async () => {
    // Create a temp plugins directory with just the json-stdout-subscriber
    const tempPluginsDir = mkdtempSync(join(tmpdir(), 'plugins-discovery-'));
    const tempPluginDir = join(tempPluginsDir, 'json-stdout-subscriber');
    const emptyGlobalDir = mkdtempSync(join(tmpdir(), 'no-global-plugins-'));

    try {
      // Copy plugin directory (plugin.yml + compiled JS for the loader)
      mkdirSync(tempPluginDir, { recursive: true });

      // Copy the plugin.yml manifest
      const manifest = readFileSync(join(PLUGIN_SRC_DIR, 'plugin.yml'), 'utf-8');
      writeFileSync(join(tempPluginDir, 'plugin.yml'), manifest);

      // Write a compiled JS version of the plugin for the ESM loader
      writeFileSync(
        join(tempPluginDir, 'index.js'),
        `
export class JsonStdoutSubscriber {
  constructor() { this._started = false; }
  start() { this._started = true; }
  stop() { this._started = false; }
  handle(event) {
    if (!this._started) return;
    process.stdout.write(JSON.stringify({ ...event, ts: new Date().toISOString() }) + '\\n');
  }
}
export default new JsonStdoutSubscriber();
`
      );

      const registry = new PluginRegistry();
      await discoverPlugins(emptyGlobalDir, tempPluginsDir, registry);
      registry.markInitialized();

      const plugin = registry.get('ui_renderer', 'json-stdout');
      expect(plugin).toBeDefined();
      expect(typeof (plugin as { start?: unknown }).start).toBe('function');
      expect(typeof (plugin as { stop?: unknown }).stop).toBe('function');
      expect(typeof (plugin as { handle?: unknown }).handle).toBe('function');
    } finally {
      rmSync(tempPluginsDir, { recursive: true, force: true });
      rmSync(emptyGlobalDir, { recursive: true, force: true });
    }
  });

  it('does NOT require JsonStdoutSubscriber to be referenced in src/conductor/src/index.ts', () => {
    const indexPath = join(
      new URL('../../src/index.ts', import.meta.url).pathname
    );
    const indexContent = readFileSync(indexPath, 'utf-8');
    expect(indexContent).not.toMatch(/JsonStdoutSubscriber/);
    expect(indexContent).not.toMatch(/json-stdout-subscriber/);
  });

  it('PluginNotFoundError thrown when json-stdout plugin not in discovery dir (Task 7)', async () => {
    // Config says ui_renderer: json-stdout, but plugin not in discovery path
    const { PluginNotFoundError } = await import('../../src/types/plugin.js');
    const emptyGlobalDir = mkdtempSync(join(tmpdir(), 'no-global-'));
    const emptyProjectDir = mkdtempSync(join(tmpdir(), 'no-project-'));

    try {
      const registry = new PluginRegistry();
      await discoverPlugins(emptyGlobalDir, emptyProjectDir, registry);
      registry.markInitialized();

      // Attempting to get ui_renderer:json-stdout should throw PluginNotFoundError
      expect(() => registry.get('ui_renderer', 'json-stdout')).toThrow(PluginNotFoundError);
    } finally {
      rmSync(emptyGlobalDir, { recursive: true, force: true });
      rmSync(emptyProjectDir, { recursive: true, force: true });
    }
  });
});
