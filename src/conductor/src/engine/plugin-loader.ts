import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { loadManifestFromFile } from './plugin-manifest.js';
import { PluginRegistry } from './plugin-registry.js';
import { PluginManifestError, PluginLoadError } from '../types/plugin.js';
import { ClaudeProvider } from '../execution/claude-provider.js';
import { TerminalSubscriber } from '../ui/subscriber.js';
import type { ConductorEventEmitter } from '../ui/events.js';
import type { RenderEvent } from '../ui/create-renderer.js';

/**
 * Discovers and registers plugins from filesystem directories.
 * Scans globalDir and projectDir for plugin subdirectories, loading plugin.yml
 * from each. Project-local plugins shadow global plugins with the same kind+name.
 * Missing directories are skipped without error.
 *
 * @param globalDir Path to global plugins directory (e.g., ~/.ai-conductor/plugins/)
 * @param projectDir Path to project-local plugins directory (e.g., .ai-conductor/plugins/)
 * @param registry PluginRegistry to register discovered plugins into
 */
export async function discoverPlugins(
  globalDir: string,
  projectDir: string,
  registry: PluginRegistry
): Promise<void> {
  // Load global plugins first
  if (existsSync(globalDir)) {
    const entries = readdirSync(globalDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const manifestPath = join(globalDir, entry.name, 'plugin.yml');
        try {
          const manifest = loadManifestFromFile(manifestPath);
          // For now, we're just registering the manifest; actual plugin loading
          // will be done in Task 10. Here we just validate and register metadata.
          registry.register(manifest.kind, manifest.name, manifest);
        } catch (err) {
          if (err instanceof PluginManifestError) {
            // Skip invalid plugins in auto-discovery (Task 10 behavior preview)
            console.warn(`Skipping plugin ${entry.name}: ${err.message}`);
          }
        }
      }
    }
  }

  // Load project-local plugins (these shadow global plugins with same kind+name)
  if (existsSync(projectDir)) {
    const entries = readdirSync(projectDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const manifestPath = join(projectDir, entry.name, 'plugin.yml');
        try {
          const manifest = loadManifestFromFile(manifestPath);
          // Check if we're shadowing a global plugin
          const globalPlugins = registry.list(manifest.kind);
          if (globalPlugins.includes(manifest.name)) {
            console.debug(
              `Plugin shadowing: kind=${manifest.kind}, name=${manifest.name}; ` +
              `project-local at ${projectDir} overrides global at ${globalDir}`
            );
          }
          // Register project-local plugin (overwrites global if same kind+name)
          registry.register(manifest.kind, manifest.name, manifest);
        } catch (err) {
          if (err instanceof PluginManifestError) {
            // Skip invalid plugins in auto-discovery
            console.warn(`Skipping plugin ${entry.name}: ${err.message}`);
          }
        }
      }
    }
  }
}

/**
 * Registers built-in plugins (ClaudeProvider, TerminalSubscriber) into the registry.
 * Task 11: ClaudeProvider registers as llm_provider:claude
 * Task 12: TerminalSubscriber registers as ui_renderer:terminal
 * @returns TerminalSubscriber instance so caller can call start()/stop()
 */
export function registerBuiltins(
  registry: PluginRegistry,
  events: ConductorEventEmitter,
  renderEvent: RenderEvent
): TerminalSubscriber {
  // Task 11: Register ClaudeProvider
  registry.register('llm_provider', 'claude', new ClaudeProvider());

  // Task 12: Register TerminalSubscriber
  const subscriber = new TerminalSubscriber(events, renderEvent);
  registry.register('ui_renderer', 'terminal', subscriber);

  return subscriber;
}
